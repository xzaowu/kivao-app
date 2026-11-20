package app

import (
	"errors"
	"strings"
	"sync"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/workbench"
)

func TestTryOnConcurrentAdmissionAndLateReceipt(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2"))
	for _, record := range []any{
		&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceEnabled":true,"imageWorkbenchEnabled":true,"creditsEnabled":true}`},
		&model.ChannelModel{ID: "tryon-img", ChannelID: "channel", ModelKey: "gpt-image-2", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 200, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "tryon-img", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 200, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	const batchID = "tryon_outfit_abcd1234"
	image := WorkbenchTaskInput{Kind: "image", Prompt: "展示服装", Parameters: map[string]any{"size": "1024x1024", "count": 1}, Model: "gpt-image-2", ChannelID: "channel", Batch: &workbench.TaskBatch{ID: batchID, Count: 1, SlotKey: "outfit-0-1"}}
	second := &Service{repo: repository.New(db), dataDir: s.dataDir, disablePiRuntime: true}
	var wg sync.WaitGroup
	gate := make(chan struct{})
	ids := make([]string, 2)
	errs := make([]error, 2)
	for index, server := range []*Service{s, second} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-gate
			task, err := server.CreateWorkbenchTask("user", image, "", "")
			errs[index] = err
			if task != nil {
				ids[index] = task.ID
			}
		}()
	}
	close(gate)
	wg.Wait()
	if errs[0] != nil || errs[1] != nil || ids[0] == "" || ids[0] != ids[1] {
		t.Fatalf("concurrent submits: ids=%v err=%v", ids, errs)
	}
	plan := creationTextRequest()
	plan.Input["metadata"] = map[string]any{"source": "ecommerce-tryon", "stage": "tryon-planning", "tryonFunction": "outfit", "tryonBatchId": batchID}
	p1, err := s.CreateTask("user", plan)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := second.CreateTask("user", plan)
	if err != nil || p1.ID != p2.ID {
		t.Fatalf("planning replay=%v err=%v", p2, err)
	}
	newSlot := *image.Batch
	newSlot.SlotKey = "v-next"
	image.Batch = &newSlot
	next, err := s.CreateWorkbenchTask("user", image, "", "")
	if err != nil || next.ID == ids[0] {
		t.Fatalf("new slot=%v err=%v", next, err)
	}
	if err := db.Exec("CREATE TRIGGER reject_tryon_receipt BEFORE INSERT ON try_on_task_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END").Error; err != nil {
		t.Fatal(err)
	}
	newSlot.SlotKey = "uncommitted"
	if _, err := s.CreateWorkbenchTask("user", image, "", ""); err == nil || !strings.Contains(err.Error(), "injected receipt failure") {
		t.Fatalf("expected receipt insert rollback, got %v", err)
	}
	if err := db.Exec("DROP TRIGGER reject_tryon_receipt").Error; err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{&model.Task{}, &model.TryOnTaskReceipt{}, &model.BillingOrder{}} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil || count != 3 {
			t.Fatalf("%T count=%d err=%v", record, count, err)
		}
	}
	tasks, err := s.TryOnBatchTasks("user", batchID)
	if err != nil || len(tasks) != 3 {
		t.Fatalf("read receipts=%d err=%v", len(tasks), err)
	}
	seen := map[string]bool{}
	for _, task := range tasks {
		if task.ClientContext == nil || task.ClientContext.BatchID != batchID {
			t.Fatal("batch context missing")
		}
		seen[task.ClientContext.BatchSlotKey] = true
	}
	if !seen["outfit-0-1"] || !seen["v-next"] || !seen[tryOnPlanningSlot] {
		t.Fatalf("slot keys=%v", seen)
	}
	if other, err := s.TryOnBatchTasks("other", batchID); err != nil || len(other) != 0 {
		t.Fatalf("cross-user receipt: items=%d err=%v", len(other), err)
	}
	if err := db.Model(&model.Task{}).Where("user_id = ?", "user").Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	failed, err := s.Task("user", ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.BillingOrder{}).Where("task_id = ?", failed.ID).Update("status", model.BillingStatusRefunded).Error; err != nil {
		t.Fatal(err)
	}
	retried, err := s.RetryTask("user", failed.ID, failed.UpdatedAt)
	if err != nil || retried.Status != model.TaskStatusQueued {
		t.Fatalf("retry=%v err=%v", retried, err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", failed.ID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	late, err := s.RetryTask("user", failed.ID, failed.UpdatedAt)
	if err != nil || late.Status != model.TaskStatusFailed {
		t.Fatalf("stale retry requeued second failure: task=%v err=%v", late, err)
	}
	if _, err := s.DeleteTryOnBatch("user", batchID); err != nil {
		t.Fatal(err)
	}
	for _, slot := range []string{"outfit-0-1", "v-late"} {
		newSlot.SlotKey = slot
		_, err := second.CreateWorkbenchTask("user", image, "", "")
		var conflict *AppError
		if !errors.As(err, &conflict) || conflict.Status != 409 || conflict.Reason != "tryon_batch_deleted" {
			t.Fatalf("late slot %s err=%v", slot, err)
		}
	}
	var count int64
	if err := db.Model(&model.BillingOrder{}).Count(&count).Error; err != nil || count != 4 {
		t.Fatalf("late or deleted billing=%d err=%v", count, err)
	}
}
