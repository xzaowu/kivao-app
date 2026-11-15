package app

import (
	"bytes"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestInspirationShowcaseUploadSniffsTypeAndKeepsDraftPrivate(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	pngBytes := append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0}, 32)...)
	resource, err := svc.UploadInspirationExample(admin, "image", multipartFileHeader(t, "example.png", "text/plain", pngBytes))
	if err != nil {
		t.Fatal(err)
	}
	if resource.Provider != "local" || resource.MimeType != "image/png" {
		t.Fatal("upload did not use validated local storage")
	}
	if _, err := svc.PrepareInspirationExampleDelivery(nil, resource.ID, ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("new upload was public before save")
	}
	delivery, err := svc.PrepareInspirationExampleDelivery(admin, resource.ID, ResourceAccessOptions{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Stream != nil {
		delivery.Stream.Body.Close()
	}
	if _, err := svc.UploadInspirationExample(admin, "image", multipartFileHeader(t, "fake.png", "image/png", []byte("not an image"))); err == nil {
		t.Fatal("spoofed MIME was accepted")
	}
}

func TestInspirationShowcasePublicationOwnershipAndRange(t *testing.T) {
	svc, db, dir, admin := newAppearanceTestService(t)
	resources := []model.Resource{
		{ID: "showcase-image", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "showcase/image.png", MimeType: "image/png", Size: 14},
		{ID: "showcase-video", UserID: admin.ID, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "showcase/video.mp4", MimeType: "video/mp4", Size: 14},
		{ID: "private-image", UserID: "other-admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "showcase/private.png", MimeType: "image/png", Size: 13},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	writeAppearanceResourceFixtures(t, dir, resources)
	user := &model.User{ID: "ordinary", Role: model.UserRoleUser, Status: model.UserStatusActive}
	value := InspirationShowcase{InspirationID: "original:sample", Title: "测试灵感", Enabled: true, Examples: []InspirationExample{
		{ResourceID: "showcase-image", Type: "image", Title: "图片效果", MediaURL: "https://untrusted.example/private"},
		{ResourceID: "showcase-video", Type: "video", Title: "视频效果", Description: "完整展示"},
	}}
	if _, err := svc.SaveInspirationShowcase(user, value); err == nil {
		t.Fatal("ordinary user published examples")
	}
	if _, err := svc.InspirationShowcases(user); err == nil {
		t.Fatal("ordinary user read admin config")
	}
	if _, err := svc.PrepareInspirationExampleDelivery(nil, "showcase-image", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("unpublished image was public")
	}
	if _, err := svc.PrepareInspirationExampleDelivery(admin, "private-image", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("other administrator's draft was previewable")
	}
	value.Examples[0].ResourceID = "private-image"
	if _, err := svc.SaveInspirationShowcase(admin, value); err == nil {
		t.Fatal("private foreign image was publishable")
	}
	value.Examples[0].ResourceID = "showcase-image"
	saved, err := svc.SaveInspirationShowcase(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Examples[0].MediaURL != "" {
		t.Fatal("client supplied URL retained")
	}
	public, err := svc.InspirationShowcases(nil)
	if err != nil || len(public) != 1 || !strings.HasPrefix(public[0].Examples[0].MediaURL, "/api/public/inspirations/showcases/media/") {
		t.Fatalf("invalid public projection: %v %#v", err, public)
	}
	delivery, err := svc.PrepareInspirationExampleDelivery(nil, "showcase-video", ResourceAccessOptions{}, "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Stream == nil || delivery.Stream.AcceptRanges != "bytes" {
		t.Fatalf("invalid range delivery: %#v", delivery)
	}
	delivery.Stream.Body.Close()
	if _, err := svc.PrepareInspirationExampleDelivery(nil, "private-image", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("unrelated private resource was public")
	}
	saved.Enabled = false
	if _, err := svc.SaveInspirationShowcase(admin, *saved); err != nil {
		t.Fatal(err)
	}
	public, err = svc.InspirationShowcases(nil)
	if err != nil || len(public) != 0 {
		t.Fatal("disabled examples listed publicly")
	}
	if _, err := svc.PrepareInspirationExampleDelivery(nil, "showcase-video", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("disabled video remained public")
	}
	if len(svc.siteResourceReferences([]string{"showcase-image"})["showcase-image"]) == 0 {
		t.Fatal("disabled examples lost deletion protection")
	}
	saved.Examples = nil
	if _, err := svc.SaveInspirationShowcase(admin, *saved); err != nil {
		t.Fatal(err)
	}
	if len(svc.siteResourceReferences([]string{"showcase-image"})["showcase-image"]) != 0 {
		t.Fatal("removed example still referenced")
	}
}

func TestInspirationShowcaseValidationAndCorruptConfig(t *testing.T) {
	for _, value := range []InspirationShowcase{
		{InspirationID: "", Title: "标题"},
		{InspirationID: "custom:local", Title: "标题"},
		{InspirationID: "original:sample", Title: "标题", Enabled: true},
		{InspirationID: "original:sample", Title: "标题", Examples: []InspirationExample{{ResourceID: "1", Type: "audio"}}},
		{InspirationID: "original:sample", Title: "标题", Examples: []InspirationExample{{ResourceID: "1", Type: "image"}, {ResourceID: "1", Type: "image"}}},
		{InspirationID: "original:sample", Title: "标题", Examples: make([]InspirationExample, 11)},
	} {
		if _, err := normalizeInspirationShowcase(value); err == nil {
			t.Fatalf("invalid input accepted: %#v", value)
		}
	}
	svc, db, _, _ := newAppearanceTestService(t)
	if err := db.Create(&model.SystemSetting{Key: inspirationShowcasePrefix + "bad", ValueJSON: "{broken"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.InspirationShowcases(nil); err == nil {
		t.Fatal("corrupt config silently accepted")
	}
	if len(svc.siteResourceReferences([]string{"candidate"})["candidate"]) == 0 {
		t.Fatal("corrupt config did not block cleanup")
	}
}

func TestInspirationShowcaseRejectsRemoteWrongTypeAndUnreadyResources(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	for _, resource := range []model.Resource{
		{ID: "remote", Provider: "s3", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 1},
		{ID: "wrong", Provider: "local", Kind: "video", Status: model.ResourceStatusReady, MimeType: "video/mp4", Size: 1},
		{ID: "unready", Provider: "local", Kind: "image", Status: "pending", MimeType: "image/png", Size: 1},
		{ID: "oversize", Provider: "local", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 11 << 20},
	} {
		resource.UserID = admin.ID
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
		value := InspirationShowcase{InspirationID: "original:sample", Title: "标题", Enabled: true, Examples: []InspirationExample{{Type: "image", ResourceID: resource.ID}}}
		if _, err := svc.SaveInspirationShowcase(admin, value); err == nil {
			t.Fatalf("invalid resource %s accepted", resource.ID)
		}
	}
}
