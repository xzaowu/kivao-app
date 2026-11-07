package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestWorkbenchMediaIsKeptByDetachedResourceCleanup(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	tool := model.WorkbenchTool{ID: "example-tool", Name: "示例工具", Enabled: false,
		CapabilityJSON: `{"inputContract":{"slots":[{"coverResourceId":"slot-cover","sampleResourceId":"notice"}]}}`,
		GuideJSON:      `{"resultExample":{"items":[{"resourceId":"example","kind":"video"}],"imageResourceIds":["legacy-image"],"videoResourceId":"legacy-video"}}`}
	if err := db.Create(&tool).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: model.WorkbenchExamplesSettingPrefix + model.WorkbenchKindImage, ValueJSON: `{"items":[{"resourceId":"default-example","kind":"image"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-48 * time.Hour)
	if err := db.Create(&model.SystemSetting{Key: model.InspirationSettingPrefix + "entry", ValueJSON: `{"resourceId":"inspiration-media","mediaKind":"image","additionalExamples":[{"resourceId":"inspiration-extra","mediaKind":"video"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	resources := []model.Resource{}
	for _, id := range []string{"slot-cover", "notice", "example", "legacy-image", "legacy-video", "default-example", "inspiration-media", "inspiration-extra"} {
		resource := model.Resource{ID: id, UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/" + id, CreatedAt: old, UpdatedAt: old}
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
		resources = append(resources, resource)
	}
	if err := svc.cleanupDetachedUserResources("user-1", resources); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("user_id = ?", "user-1").Count(&count).Error; err != nil || count != 8 {
		t.Fatalf("configured media removed: count=%d err=%v", count, err)
	}
}
