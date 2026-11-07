package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestInspirationToolRespectsWorkbenchFeature(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	if err := db.AutoMigrate(&model.WorkbenchTool{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.WorkbenchTool{ID: "hall-tool", Name: "工具", Kind: "image", Enabled: true, CapabilityJSON: "{}", GuideJSON: "{}"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: model.InspirationSettingPrefix + "tool", ValueJSON: `{"version":1,"type":"tool","toolId":"hall-tool","enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	for _, enabled := range []bool{false, true} {
		value := `{"imageWorkbenchEnabled":false}`
		if enabled {
			value = `{"imageWorkbenchEnabled":true}`
		}
		if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: value}); err != nil {
			t.Fatal(err)
		}
		items, err := svc.Inspirations(nil, false)
		if err != nil || (len(items) == 1) != enabled {
			t.Fatalf("feature=%v items=%v err=%v", enabled, items, err)
		}
	}
}
