package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

func TestCreateWorkbenchDepthTaskUsesMeasuredSourceAndDedicatedModel(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	profile, err := json.Marshal(DefaultModelCapabilityConfigForModel(VolcengineMediaKitVideoDepthProtocol, "standard"))
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"videoWorkbenchEnabled":true}`},
		&model.ChannelModel{ID: "depth-model", ChannelID: "channel", ModelKey: "depth-local", ProviderModelKey: "standard", Capability: "video", Protocol: model.ChannelInterfaceType(VolcengineMediaKitVideoDepthProtocol), Enabled: true, CapabilityConfigJSON: string(profile)},
		&model.ChannelModelPriceTier{ID: "depth-price", ChannelModelID: "depth-model", SelectorKey: `{"operation":"depth_capture"}`, SelectorJSON: `{"operation":"depth_capture"}`, Resolution: "*", BillingMode: "per_second", UnitPriceMicrocredits: 10, Enabled: true, PriceConfigured: true},
		&model.Resource{ID: "depth-source", UserID: "user", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady, Width: 1280, Height: 720, DurationMs: 6250},
		&model.WorkbenchTool{ID: "depth-tool", Kind: "video", Name: "深度动作捕捉", Enabled: true, Version: 1, CapabilityJSON: `{"processingOperation":"depth_capture","inputContract":{"promptRequired":false,"minTextReferences":0,"slots":[{"key":"source_video","name":"源视频","mediaTypes":["video"],"required":true,"minCount":1,"maxCount":1}]}}`},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := WorkbenchTaskInput{Kind: "video", ToolID: "depth-tool", Model: "depth-local", ChannelID: "channel", References: []workbench.TaskReference{{ResourceID: "depth-source", Kind: "video", SlotKey: "source_video"}}}
	task, err := s.CreateWorkbenchTask("user", req, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if task.Operation != VideoProcessingOperationDepthCapture {
		t.Fatal("depth task became normal video generation")
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", task.BillingOrderID).Error; err != nil {
		t.Fatal(err)
	}
	if order.Quantity != 7 || order.AmountMicrocredits != 70 || order.PriceTierID != "depth-price" {
		t.Fatalf("source-based reservation mismatch: quantity=%d amount=%d", order.Quantity, order.AmountMicrocredits)
	}
	for _, mutate := range []func(*WorkbenchTaskInput){func(r *WorkbenchTaskInput) { r.Model = "text-test" }, func(r *WorkbenchTaskInput) { r.Parameters = map[string]any{"seconds": 1} }} {
		bad := req
		mutate(&bad)
		if _, err := s.CreateWorkbenchTask("user", bad, "", ""); err == nil {
			t.Fatal("invalid depth selection accepted")
		}
	}
	var count int64
	if err := db.Model(&model.BillingOrder{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("rejected request created an extra billing order")
	}
}
