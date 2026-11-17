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
	cm := model.ChannelModel{ID: "depth-catalog", ModelKey: "standard", Protocol: model.ChannelInterfaceType(VolcengineMediaKitVideoDepthProtocol), Capability: "video", CapabilityConfigJSON: string(encoded), PriceTiers: []model.ChannelModelPriceTier{{ID: "depth-free", SelectorJSON: `{"operation":"depth"}`, Resolution: "*", Enabled: true, PriceConfigured: true, BillingMode: "per_second", UnitPriceMicrocredits: 0}}}
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
	task := model.Task{UserID: admin.ID, Type: "video", InputJSON: `{"config":{"videoSeconds":"19"},"metadata":{"videoProcessing":true,"videoEditOperation":"depth"}}`, ResultJSON: `{"videos":[{"storageKey":"resource:depth-output"}],"usage":{"outputDurationSeconds":18.625}}`}
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
