package workbench

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestMultipleExamplesPersistAndKeepLegacyExamples(t *testing.T) {
	s, db, _ := newWorkbenchTest(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, resource := range []model.Resource{
		{ID: "photo", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "clip", UserID: "admin", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "foreign", UserID: "other", Kind: "video", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	input := ToolInput{Kind: KindVideo, CategoryID: "product", Name: "Examples", Enabled: true, Guide: json.RawMessage(`{"resultExample":{"items":[{"resourceId":"clip","kind":"video","title":"同城到店","description":"视频说明"},{"resourceId":"photo","kind":"image","title":"图片标题","description":"图片说明"}]}}`)}
	tool, err := s.CreateTool(admin, input)
	if err != nil {
		t.Fatal(err)
	}
	public, err := s.PublicTools(KindVideo)
	if err != nil || len(public[0].ResultExample.Items) != 2 {
		t.Fatalf("public: %v", err)
	}
	items := public[0].ResultExample.Items
	if items[0].Title != "同城到店" || items[0].Description != "视频说明" || items[0].URL != "/api/public/resources/clip" || items[1].URL != "/api/public/resources/photo" {
		t.Fatalf("examples: %#v", items)
	}
	for _, item := range []string{
		`{"resourceId":"foreign","kind":"video"}`,
		`{"resourceId":"photo","kind":"video"}`,
		`{"resourceId":"photo","kind":"audio"}`,
		`{"resourceId":"","kind":"image"}`,
	} {
		invalid := input
		invalid.Guide = json.RawMessage(`{"resultExample":{"items":[` + item + `]}}`)
		if _, err := s.UpdateTool(admin, tool.ID, invalid); err == nil {
			t.Fatalf("invalid example accepted: %s", item)
		}
	}
	wrongKind := input
	wrongKind.IconResourceID = "photo"
	wrongKind.Guide = json.RawMessage(`{"resultExample":{"items":[{"resourceId":"photo","kind":"image"},{"resourceId":"photo","kind":"video"}]}}`)
	if _, err := s.UpdateTool(admin, tool.ID, wrongKind); err == nil {
		t.Fatal("deduplication bypassed media kind check")
	}
	legacy := resultExampleView(ResultExample{Title: "旧标题", Description: "旧说明", ImageResourceIDs: []string{"photo"}, VideoResourceID: "clip"})
	if len(legacy.Items) != 2 || legacy.Items[1].Title != "旧标题" || legacy.Items[0].Description != "旧说明" {
		t.Fatal("legacy examples lost")
	}
	input.Guide = json.RawMessage(`{"resultExample":{"items":[],"videoResourceId":"clip"}}`)
	cleared, err := s.UpdateTool(admin, tool.ID, input)
	if err != nil || len(cleared.ResultExample.Items) != 0 || cleared.ResultExample.VideoResourceID != "" {
		t.Fatal("explicit removal restored a legacy video")
	}
	tooMany := make([]ResultExampleItem, 21)
	if _, err := normalizeCatalogConfig(catalogConfig{ResultExample: ResultExample{Items: tooMany}}); err == nil {
		t.Fatal("unbounded list accepted")
	}
	if _, err := normalizeCatalogConfig(catalogConfig{ResultExample: ResultExample{Items: []ResultExampleItem{{ResourceID: "clip", Kind: "video", Description: strings.Repeat("字", 2001)}}}}); err == nil {
		t.Fatal("oversized description accepted")
	}
}
