package workbench

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestDefaultExamplesAreSeparateAuthorizedAndPreserved(t *testing.T) {
	s, db, audit := newWorkbenchTest(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, resource := range []model.Resource{
		{ID: "image", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "video", UserID: "admin", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "foreign", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	empty, err := s.DefaultExamples(KindImage)
	if err != nil || len(empty.Items) != 0 {
		t.Fatalf("empty default: %v", err)
	}
	image := ResultExample{Items: []ResultExampleItem{{ResourceID: "image", Kind: "image", Title: "默认图片", Description: "图片说明"}}}
	if _, err := s.SaveDefaultExamples(&model.User{ID: "user", Role: model.UserRoleUser}, KindImage, image); err == nil {
		t.Fatal("ordinary user changed defaults")
	}
	if _, err := s.AdminDefaultExamples(nil, KindImage); err == nil {
		t.Fatal("anonymous admin read accepted")
	}
	if _, err := s.SaveDefaultExamples(admin, KindImage, image); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveDefaultExamples(admin, KindVideo, ResultExample{Items: []ResultExampleItem{{ResourceID: "video", Kind: "video", Title: "默认视频"}}}); err != nil {
		t.Fatal(err)
	}
	got, err := s.DefaultExamples(KindImage)
	if err != nil || len(got.Items) != 1 || got.Items[0].Title != "默认图片" || got.Items[0].URL != "/api/public/resources/image" {
		t.Fatalf("image default: %v, %v", got, err)
	}
	for _, item := range []ResultExampleItem{{ResourceID: "foreign", Kind: "image"}, {ResourceID: "video", Kind: "image"}} {
		if _, err := s.SaveDefaultExamples(admin, KindImage, ResultExample{Items: []ResultExampleItem{item}}); err == nil {
			t.Fatal("invalid resource accepted")
		}
	}
	setting, err := s.repo.SystemSetting(model.WorkbenchExamplesSettingPrefix + KindImage)
	if err != nil || strings.Contains(setting.ValueJSON, "/api/") || !strings.Contains(setting.ValueJSON, "默认图片") {
		t.Fatal("stored default was overwritten or includes a display URL")
	}
	if _, err := s.SaveDefaultExamples(admin, "unknown", image); err == nil {
		t.Fatal("unknown kind accepted")
	}
	if _, err := s.SaveDefaultExamples(admin, KindImage, ResultExample{Items: []ResultExampleItem{}}); err != nil {
		t.Fatal(err)
	}
	imageDefault, _ := s.DefaultExamples(KindImage)
	videoDefault, _ := s.DefaultExamples(KindVideo)
	if len(imageDefault.Items) != 0 || len(videoDefault.Items) != 1 || audit.audited != 3 {
		t.Fatal("clear crossed workbench kinds or audit missing")
	}
}
