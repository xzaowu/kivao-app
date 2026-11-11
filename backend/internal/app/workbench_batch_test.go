package app

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/workbench"
)

func workbenchBatchFixture(t *testing.T) (*Service, *gorm.DB, WorkbenchTaskInput) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	return s, db, seedWorkbenchBatchModel(t, db)
}

func seedWorkbenchBatchModel(t *testing.T, db *gorm.DB) WorkbenchTaskInput {
	t.Helper()
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-1")
	for _, item := range []any{
		&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"imageWorkbenchEnabled":true}`},
		&model.ChannelModel{ID: "batch-image", ChannelID: "channel", ModelKey: "gpt-image-1", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, Enabled: true, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile)},
		&model.ChannelModelPriceTier{ID: "batch-price", ChannelModelID: "batch-image", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	return WorkbenchTaskInput{Kind: "image", Prompt: "A local test image", Model: "gpt-image-1", ChannelID: "channel", Parameters: map[string]any{"count": 1, "size": "1024x1024"}, Batch: &workbench.TaskBatch{ID: "local-batch-0001", Index: 0, Count: 2}}
}

func assertWorkbenchBatchAccounting(t *testing.T, db *gorm.DB, tasks int64) {
	t.Helper()
	for _, record := range []any{&model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil || count != tasks {
			t.Fatalf("%T count=%d want=%d error=%v", record, count, tasks, err)
		}
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 10000-100*tasks || account.ReservedMicrocredits != 100*tasks {
		t.Fatalf("duplicate reservation: available=%d reserved=%d", account.AvailableMicrocredits, account.ReservedMicrocredits)
	}
}

func TestWorkbenchBatchReplayAndReceipt(t *testing.T) {
	s, db, req := workbenchBatchFixture(t)
	first, err := s.CreateWorkbenchTask("user", req, "trace-one", "request-one")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		replay, err := s.CreateWorkbenchTask("user", req, "new-trace", "new-request")
		if err != nil || replay.ID != first.ID {
			t.Fatalf("replay did not return the original receipt: %v", err)
		}
	}
	receipt, err := s.WorkbenchBatchTask("user", "image", req.Batch.ID, 0)
	if err != nil || receipt == nil || receipt.ID != first.ID {
		t.Fatalf("lost response cannot be recovered: %v", err)
	}
	for _, query := range []struct {
		user, kind, batch string
		index             int
	}{
		{"other-user", "image", req.Batch.ID, 0}, {"user", "image", req.Batch.ID, 1}, {"user", "image", "other-batch", 0},
	} {
		result, err := s.WorkbenchBatchTask(query.user, query.kind, query.batch, query.index)
		if err != nil || result != nil {
			t.Fatalf("receipt leaked or invented: %v", err)
		}
	}
	encoded, _ := json.Marshal(receipt)
	if strings.Contains(string(encoded), "workbenchRequestHash") {
		t.Fatal("internal request fingerprint exposed")
	}
	summaries, err := s.WorkbenchTasks("user", "image", false, 10)
	if err != nil || len(summaries) != 1 || summaries[0].ClientContext == nil || summaries[0].ClientContext.BatchID != req.Batch.ID || summaries[0].ClientContext.BatchCount != 2 {
		t.Fatalf("batch grouping absent from summary: %v", err)
	}
	var public struct {
		Workbench struct {
			Batch *workbench.TaskBatch `json:"batch"`
		} `json:"workbench"`
	}
	if err := json.Unmarshal([]byte(receipt.InputJSON), &public); err != nil || public.Workbench.Batch == nil || *public.Workbench.Batch != *req.Batch {
		t.Fatal("safe batch identity absent from task restore input")
	}
	assertWorkbenchBatchAccounting(t, db, 1)
	var stored model.Task
	if err := db.First(&stored, "id = ?", first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&stored).Update("input_json", compactTaskInputJSON(stored.InputJSON)).Error; err != nil {
		t.Fatal(err)
	}
	if replay, err := s.CreateWorkbenchTask("user", req, "", ""); err != nil || replay.ID != first.ID {
		t.Fatalf("compaction broke replay: %v", err)
	}
	changed := req
	changed.Prompt = "Changed intent"
	if _, err := s.CreateWorkbenchTask("user", changed, "", ""); err == nil {
		t.Fatal("same batch item accepted different input")
	} else {
		var appErr *kernel.AppError
		if !errors.As(err, &appErr) || appErr.Status != 409 {
			t.Fatalf("wrong conflict: %v", err)
		}
	}
	assertWorkbenchBatchAccounting(t, db, 1)
	// A new item may reserve once; a legacy, non-batch request remains independent.
	second := *req.Batch
	second.Index = 1
	req.Batch = &second
	if _, err := s.CreateWorkbenchTask("user", req, "", ""); err != nil {
		t.Fatal(err)
	}
	assertWorkbenchBatchAccounting(t, db, 2)
	req.Batch = nil
	if _, err := s.CreateWorkbenchTask("user", req, "", ""); err != nil {
		t.Fatal(err)
	}
	assertWorkbenchBatchAccounting(t, db, 3)
}

func TestWorkbenchBatchConcurrentCreationAndRollback(t *testing.T) {
	s, db, req := workbenchBatchFixture(t)
	// Separate service mutexes emulate requests reaching different backend instances.
	other := &Service{repo: repository.New(db), dataDir: s.dataDir, disablePiRuntime: true}
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, svc := range []*Service{s, other} {
		wg.Add(1)
		go func(svc *Service) {
			defer wg.Done()
			<-start
			_, _ = svc.CreateWorkbenchTask("user", req, "", "")
		}(svc)
	}
	close(start)
	wg.Wait()
	// SQLite may reject a racing writer with SQLITE_BUSY. Retrying the same
	// identity after it settles must return one task and one reservation.
	if _, err := s.CreateWorkbenchTask("user", req, "", ""); err != nil {
		t.Fatal(err)
	}
	assertWorkbenchBatchAccounting(t, db, 1)
	var task model.Task
	if err := db.First(&task).Error; err != nil {
		t.Fatal(err)
	}
	var order model.BillingOrder
	if err := db.First(&order).Error; err != nil {
		t.Fatal(err)
	}
	order.ID = newID()
	task.BillingOrderID = order.ID
	if err := s.repo.CreateTaskWithCreditReservation(&task, &order, 100); err == nil {
		t.Fatal("duplicate task primary key was accepted")
	}
	assertWorkbenchBatchAccounting(t, db, 1)
}

func TestWorkbenchBatchRejectsInvalidInputBeforeReservation(t *testing.T) {
	s, db, req := workbenchBatchFixture(t)
	for _, batch := range []*workbench.TaskBatch{
		{ID: "short", Count: 1}, {ID: "invalid/batch", Count: 1}, {ID: "invalid-batch", Count: 0},
		{ID: "invalid-batch", Index: -1, Count: 2}, {ID: "invalid-batch", Index: 2, Count: 2}, {ID: "invalid-batch", Count: 21},
	} {
		req.Batch = batch
		if _, err := s.CreateWorkbenchTask("user", req, "", ""); err == nil {
			t.Fatal("invalid batch accepted")
		}
	}
	req.Batch = &workbench.TaskBatch{ID: "valid-batch", Count: 1}
	req.Model = "missing-model"
	if _, err := s.CreateWorkbenchTask("user", req, "", ""); err == nil {
		t.Fatal("invalid model accepted")
	}
	if _, err := s.CreateWorkbenchTask("", req, "", ""); err == nil {
		t.Fatal("missing user accepted")
	}
	assertWorkbenchBatchAccounting(t, db, 0)
}

func TestWorkbenchBatchLimitsDoNotDuplicateReservation(t *testing.T) {
	s, db, req := workbenchBatchFixture(t)
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateWorkbenchTask("user", req, "", ""); err == nil {
		t.Fatal("insufficient balance accepted")
	}
	for _, record := range []any{&model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("rejected task left %T writes", record)
		}
	}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 10000).Error; err != nil {
		t.Fatal(err)
	}
	policy := defaultRuntimePolicy()
	policy.Task.ActiveTaskLimit = 1
	if _, err := s.UpdateRuntimePolicySetting(&model.User{ID: "test-admin", Role: model.UserRoleAdmin}, policy); err != nil {
		t.Fatal(err)
	}
	first, err := s.CreateWorkbenchTask("user", req, "", "")
	if err != nil {
		t.Fatal(err)
	}
	// A receipt must remain readable even after this task fills the active limit.
	if replay, err := s.CreateWorkbenchTask("user", req, "", ""); err != nil || replay.ID != first.ID {
		t.Fatalf("active limit blocked a receipt: %v", err)
	}
	second := *req.Batch
	second.Index = 1
	req.Batch = &second
	if _, err := s.CreateWorkbenchTask("user", req, "", ""); err == nil {
		t.Fatal("active limit bypassed")
	}
	assertWorkbenchBatchAccounting(t, db, 1)
	if err := db.Model(&model.Task{}).Where("id = ?", first.ID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateWorkbenchTask("user", req, "", ""); err != nil {
		t.Fatal(err)
	}
	assertWorkbenchBatchAccounting(t, db, 2)
}
