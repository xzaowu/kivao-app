package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestVideoDepthCaptureCatalogDefaults(t *testing.T) {
	svc, _, _, _ := newAppearanceTestService(t)
	svc.pluginRuntime = nil
	profile := DefaultModelCapabilityConfigForModel(VolcengineMediaKitVideoDepthProtocol, "standard")
	encoded, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	cm := model.ChannelModel{ID: "depth-catalog", ModelKey: "standard", Protocol: model.ChannelInterfaceType(VolcengineMediaKitVideoDepthProtocol), Capability: "video", CapabilityConfigJSON: string(encoded), PriceTiers: []model.ChannelModelPriceTier{{ID: "depth-free", SelectorJSON: `{"operation":"depth_capture"}`, Resolution: "*", Enabled: true, PriceConfigured: true, BillingMode: "per_second", UnitPriceMicrocredits: 0}}}
	public, err := svc.sanitizeChannelModel(&cm)
	if err != nil {
		t.Fatalf("configured depth model omitted from catalog: %v", err)
	}
	if !public.Available {
		t.Fatal("zero-price processing model must remain available")
	}
	if _, exists := public.DefaultOptions["vquality"]; exists {
		t.Fatal("depth catalog must not invent a resolution option")
	}
}

func TestVideoDepthCaptureUsesActualOutputDuration(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	resource := model.Resource{ID: "depth-output", UserID: admin.ID, Kind: "video", Status: model.ResourceStatusReady, DurationMs: 2100}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	task := model.Task{UserID: admin.ID, Type: "video", InputJSON: `{"config":{"videoSeconds":"19"},"metadata":{"videoProcessing":true,"videoEditOperation":"depth_capture"}}`, ResultJSON: `{"videos":[{"storageKey":"resource:depth-output"}],"usage":{"outputDurationSeconds":18.625}}`}
	if ms, handled, err := svc.VideoProcessingOutputDurationMs(task); err != nil || !handled || ms != 2100 {
		t.Fatalf("persisted output duration = %d, handled=%v, err=%v", ms, handled, err)
	}
	if err := db.Create(&model.CreditAccount{UserID: admin.ID, AvailableMicrocredits: 1000, ReservedMicrocredits: 1900}).Error; err != nil {
		t.Fatal(err)
	}
	order := model.BillingOrder{ID: "depth-order", UserID: admin.ID, IdempotencyKey: "depth-task", Capability: "video", BillingMode: "per_second", UnitPriceMicrocredits: 100, MultiplierBasisPoints: 10000, Quantity: 19, AmountMicrocredits: 1900, ReservedAmountMicrocredits: 1900, Status: model.BillingStatusRunning, BillingCostSnapshot: model.BillingCostSnapshot{CostBillingMode: "per_second", CostQuantity: 19}}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	task.BillingOrderID = order.ID
	for range 2 {
		if handled, err := svc.settleVideoProcessingBilling(task, "stub-request"); !handled || err != nil {
			t.Fatalf("depth settlement handled=%v err=%v", handled, err)
		}
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", admin.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&order, "id = ?", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 2600 || account.ReservedMicrocredits != 0 || order.Quantity != 3 || order.ActualAmountMicrocredits != 300 || order.RefundedAmountMicrocredits != 1600 || order.CostQuantity != 3 {
		t.Fatal("depth output settlement or repeat-settlement balance mismatch")
	}
	task.ResultJSON = `{"usage":{"outputDurationSeconds":18.625}}`
	if ms, handled, err := svc.VideoProcessingOutputDurationMs(task); err != nil || !handled || ms != 18625 {
		t.Fatalf("provider output duration = %d, handled=%v, err=%v", ms, handled, err)
	}
	task.ResultJSON = `{}`
	if _, handled, err := svc.VideoProcessingOutputDurationMs(task); !handled || err == nil {
		t.Fatal("missing output duration must require reconciliation, not use reserved seconds")
	}
}

func TestVideoDepthCaptureAdmissionAndDefaults(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	svc.pluginRuntime = nil
	profile := DefaultModelCapabilityConfigForModel(VolcengineMediaKitVideoDepthProtocol, "standard")
	if profile.Video.Processing.MaxSourceSeconds != 60 || len(profile.Video.Resolutions) != 0 {
		t.Fatal("unsafe default profile")
	}
	profile.Video.Processing.MaxSourceSeconds = 600
	if err := validateVideoCapabilityConfig(profile.Video); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(profile)
	cm := model.ChannelModel{ID: "depth-model", ChannelID: "depth-channel", ModelKey: "standard", Protocol: model.ChannelInterfaceType(VolcengineMediaKitVideoDepthProtocol), Capability: "video", Enabled: true, CapabilityConfigJSON: string(encoded)}
	if err := db.Create(&cm).Error; err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "depth-source", UserID: admin.ID, Kind: "video", Status: model.ResourceStatusReady, MimeType: "video/mp4", Width: 1440, Height: 2560, DurationMs: 18_625}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	input := func() map[string]any {
		return map[string]any{"mode": "video", "config": map[string]any{"channelId": "depth-channel", "model": "standard", "vquality": "4k", "videoSeconds": "1", "fpsBand": "le120"}, "referenceVideos": []any{map[string]any{"storageKey": "resource:depth-source", "durationMs": 1}}, "metadata": map[string]any{"providerOptions": map[string]any{VolcengineMediaKitVideoDepthProtocol: map[string]any{"fps": 120, "bitrate": 9000}}}, "capabilityOptions": map[string]any{"vquality": "4k", "fpsBand": "le120"}}
	}
	valid := input()
	admission, err := svc.prepareVideoProcessingTask(admin.ID, valid)
	if err != nil || admission == nil {
		t.Fatalf("depth admission failed: %v", err)
	}
	config := valid["config"].(map[string]any)
	metadata := valid["metadata"].(map[string]any)
	options := metadata["providerOptions"].(map[string]any)[VolcengineMediaKitVideoDepthProtocol].(map[string]any)
	if config["videoSeconds"] != "19" || config["vquality"] != nil || config["fpsBand"] != nil || len(options) != 0 || metadata["videoEditOperation"] != VideoProcessingOperationDepthCapture {
		t.Fatal("client overrides escaped admission")
	}
	if _, err := svc.prepareVideoProcessingTask("other-user", input()); err == nil {
		t.Fatal("foreign resource accepted")
	}
	tooMany := input()
	tooMany["referenceVideos"] = []any{map[string]any{"storageKey": "resource:depth-source"}, map[string]any{"storageKey": "resource:depth-source"}}
	if _, err := svc.prepareVideoProcessingTask(admin.ID, tooMany); err == nil {
		t.Fatal("multiple videos accepted")
	}
	for _, change := range []map[string]any{{"duration_ms": 600_001}, {"width": 3840, "height": 2160}, {"width": 0}, {"status": "uploading"}} {
		if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Updates(change).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := svc.prepareVideoProcessingTask(admin.ID, input()); err == nil {
			t.Fatal("invalid source accepted")
		}
		if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Updates(map[string]any{"duration_ms": resource.DurationMs, "width": resource.Width, "height": resource.Height, "status": resource.Status}).Error; err != nil {
			t.Fatal(err)
		}
	}
	selector := skuSelectorForIntent(ModelRequestIntent{Capability: "video", Operation: VideoProcessingOperationDepthCapture, Inputs: map[string]int{"video": 1}})
	if selector["operation"] != VideoProcessingOperationDepthCapture {
		t.Fatal("depth billed as video generation")
	}
	profile.Video.Processing.FPSPolicy = VideoProcessingFPSUserSelect
	if err := validateVideoCapabilityConfig(profile.Video); err == nil {
		t.Fatal("depth FPS controls accepted")
	}
}
