package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/database"
	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func ecommerceFixture(t *testing.T) (*Service, *gorm.DB, *EcommerceProjectView) {
	t.Helper()
	s, db, _ := workbenchBatchFixture(t)
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	profile.Text.References.MaxImages = 8
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	imageProfile := DefaultModelCapabilityConfigForModel("openai-image", "gpt-image-1")
	imageProfile.Image.Size = ImageSizeConfig{Parameter: "size", Values: []string{"1024x1024"}, Default: "1024x1024", DefaultTier: "1k", Presets: []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024}}}
	imageProfile, imageErr := NormalizeModelCapabilityConfigForModel("image", "openai-image", "gpt-image-1", imageProfile, s.protocolRegistry())
	if imageErr != nil {
		t.Fatal("fixture model contract:", imageErr)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "batch-image").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, imageProfile)).Error; err != nil {
		t.Fatal(err)
	}
	settings, _ := json.Marshal(EcommerceSettings{Vision: EcommerceModelChoice{ChannelID: "channel", Model: "text-test"}, Planning: EcommerceModelChoice{ChannelID: "channel", Model: "text-test"}})
	for _, row := range []any{&model.Resource{ID: "product", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 20}, &model.SystemSetting{Key: ecommerceSettingsKey, ValueJSON: string(settings)}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	features := defaultFeatureAvailability()
	features.EcommerceEnabled = true
	features.ImageWorkbenchEnabled = true
	encoded, _ := json.Marshal(features)
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", featureAvailabilitySettingKey).Update("value_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	project, err := s.CreateEcommerceProject("user", EcommerceProjectRequest{ID: uuid.NewString(), Draft: ecommerce.Draft{ProductName: "测试商品", Description: "只使用可见包装资料", Platform: "小红书", Language: "中文", ImageType: "main", Count: 2, References: []ecommerce.Reference{{ResourceID: "product", Role: "primary"}}}})
	if err != nil {
		t.Fatal(err)
	}
	return s, db, project
}

func TestEcommerceFeatureClosurePreservesReceiptsAndRejectsUnsentWork(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	s, db, p := ecommerceFixture(t)
	req := ecommerceQuoted(t, s, p, "vision")
	task, err := s.SubmitEcommerceTask("user", p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	flags := defaultFeatureAvailability()
	raw, _ := json.Marshal(flags)
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", featureAvailabilitySettingKey).Update("value_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.EcommerceProject("user", p.ID); err != nil {
		t.Fatal("history hidden when closed", err)
	}
	if got, err := s.SubmitEcommerceTask("user", p.ID, req); err != nil || got.ID != task.ID {
		t.Fatal("receipt lost when closed", err)
	}
	changed := req
	changed.RequestID = uuid.NewString()
	if _, err := s.SubmitEcommerceTask("user", p.ID, changed); err == nil {
		t.Fatal("closed feature created work")
	}
	s.activeCancels = make(map[string]context.CancelFunc)
	claimed, err := s.repo.ClaimNextTask("ecommerce-closed-test", time.Minute)
	if err != nil || claimed == nil {
		t.Fatal("claim", err)
	}
	if err := s.taskWorker().processClaimedTask(claimed, nil); err != nil {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != 403 {
			t.Fatal(err)
		}
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed {
		t.Fatal("unsent task was dispatched", err)
	}
	var account model.CreditAccount
	db.First(&account, "user_id = ?", "user")
	if account.AvailableMicrocredits != 10000 || account.ReservedMicrocredits != 0 {
		t.Fatal("unsent reservation not refunded")
	}
	stored.ProviderRequestID = "local-accepted-job"
	if err := s.requireEcommerceExecution(*stored); err != nil {
		t.Fatal("accepted work lost reconciliation", err)
	}
}

func TestEcommerceRejectsPriceDriftAndInactiveUsers(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	req := ecommerceQuoted(t, s, p, "vision")
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier").Update("unit_price_microcredits", 200).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitEcommerceTask("user", p.ID, req); err == nil {
		t.Fatal("price drift accepted")
	}
	assertWorkbenchBatchAccounting(t, db, 0)
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveEcommerceDraft("user", p.ID, EcommerceProjectRequest{Revision: p.Revision, Draft: p.Draft, ClientKey: uuid.NewString()}); err == nil {
		t.Fatal("inactive user wrote project")
	}
}

func TestEcommerceUncertainRegenerationRequiresReconciliation(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	p = ecommerceReadyPlan(t, s, db, p)
	task, err := s.SubmitEcommerceTask("user", p.ID, ecommerceQuoted(t, s, p, "image"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	db.First(&stored, "id = ?", task.ID)
	if err := db.Model(&model.BillingOrder{}).Where("id = ?", stored.BillingOrderID).Update("status", model.BillingStatusUncertain).Error; err != nil {
		t.Fatal(err)
	}
	p, err = s.EcommerceProject("user", p.ID)
	if err != nil {
		t.Fatal(err)
	}
	req := EcommerceTaskRequest{Revision: p.Revision, RequestID: uuid.NewString(), Stage: "image", ImageID: "image-1", Model: EcommerceModelChoice{ChannelID: "channel", Model: "gpt-image-1"}, Size: "1024x1024"}
	if _, err := s.QuoteEcommerceTask("user", p.ID, req); err == nil {
		t.Fatal("unresolved charge allowed regeneration")
	}
	if err := db.Model(&model.BillingOrder{}).Where("id = ?", stored.BillingOrderID).Update("status", model.BillingStatusSettled).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&stored).Update("media_recovery_json", "encrypted-fixture-checkpoint").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.QuoteEcommerceTask("user", p.ID, req); err == nil {
		t.Fatal("pending media save allowed regeneration")
	}
	assertWorkbenchBatchAccounting(t, db, 3)
}

func TestEcommercePostgresConcurrentCASAndReceipt(t *testing.T) {
	_, source, p := ecommerceFixture(t)
	base, db := newProjectNameConflictPostgresService(t)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, bucket := range []any{&[]model.User{}, &[]model.ModelChannel{}, &[]model.ChannelModel{}, &[]model.ChannelModelPriceTier{}, &[]model.SystemSetting{}, &[]model.CreditAccount{}, &[]model.Resource{}, &[]model.EcommerceProject{}} {
		if err := source.Find(bucket).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(bucket).Error; err != nil {
			t.Fatal(err)
		}
	}
	s := &Service{repo: base.repo, dataDir: t.TempDir(), disablePiRuntime: true}
	req := ecommerceQuoted(t, s, p, "vision")
	other := &Service{repo: repository.New(db), dataDir: s.dataDir, disablePiRuntime: true}
	var wg sync.WaitGroup
	for _, svc := range []*Service{s, other} {
		wg.Add(1)
		go func(svc *Service) { defer wg.Done(); _, _ = svc.SubmitEcommerceTask("user", p.ID, req) }(svc)
	}
	wg.Wait()
	got, err := s.SubmitEcommerceTask("user", p.ID, req)
	if err != nil || got == nil {
		t.Fatal("original request not recoverable", err)
	}
	assertWorkbenchBatchAccounting(t, db, 1)
	current, err := s.EcommerceProject("user", p.ID)
	if err != nil || current.State.VisionTaskID != got.ID || current.Revision != p.Revision+1 {
		t.Fatal("task and project not committed together", err)
	}
	second, err := s.CreateEcommerceProject("user", EcommerceProjectRequest{ID: uuid.NewString(), Draft: p.Draft})
	if err != nil {
		t.Fatal(err)
	}
	original := ecommerceQuoted(t, s, second, "vision")
	stop := EcommerceProjectRequest{Revision: second.Revision, ClientKey: uuid.NewString(), NewRound: true, Draft: second.Draft}
	var admitted *model.Task
	var fenced *EcommerceProjectView
	var admissionErr, fenceErr error
	wg.Add(2)
	go func() { defer wg.Done(); admitted, admissionErr = s.SubmitEcommerceTask("user", second.ID, original) }()
	go func() { defer wg.Done(); fenced, fenceErr = other.SaveEcommerceDraft("user", second.ID, stop) }()
	wg.Wait()
	if admissionErr == nil {
		if fenceErr == nil || admitted == nil {
			t.Fatal("late admission and termination both won")
		}
		assertWorkbenchBatchAccounting(t, db, 2)
	} else {
		if fenceErr != nil || fenced == nil {
			t.Fatal("neither admission nor termination committed", admissionErr, fenceErr)
		}
		if _, err := s.SubmitEcommerceTask("user", second.ID, original); err == nil {
			t.Fatal("old request revived after fence")
		}
		assertWorkbenchBatchAccounting(t, db, 1)
	}
}

func TestEcommerceNewRoundFencesUnknownRequestAndReplaysLostResponse(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	original := ecommerceQuoted(t, s, p, "vision")
	stop := EcommerceProjectRequest{Revision: p.Revision, Draft: p.Draft, ClientKey: uuid.NewString(), NewRound: true}
	next, err := s.SaveEcommerceDraft("user", p.ID, stop)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.SaveEcommerceDraft("user", p.ID, stop)
	if err != nil || replay.ActiveRoundID != next.ActiveRoundID || replay.Revision != next.Revision {
		t.Fatal("lost termination response created another round", err)
	}
	if _, err := s.SubmitEcommerceTask("user", p.ID, original); err == nil {
		t.Fatal("terminated unknown request admitted")
	}
	receipt, err := s.EcommerceReceipt("user", p.ID, original.RequestID)
	if err != nil || receipt != nil {
		t.Fatal("termination invented a task", err)
	}
	assertWorkbenchBatchAccounting(t, db, 0)
}

func ecommerceQuoted(t *testing.T, s *Service, p *EcommerceProjectView, stage string) EcommerceTaskRequest {
	t.Helper()
	req := EcommerceTaskRequest{Revision: p.Revision, RequestID: uuid.NewString(), Stage: stage}
	if stage == "image" {
		req.ImageID = "image-1"
		req.Model = EcommerceModelChoice{ChannelID: "channel", Model: "gpt-image-1"}
		req.Size = "1024x1024"
		req.ImageResolution = "1k"
	}
	quote, err := s.QuoteEcommerceTask("user", p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	req.QuoteHash, req.MaxCharge, req.QuoteExpiresAt = quote.QuoteHash, quote.AmountMicrocredits, quote.ExpiresAt
	return req
}

func ecommerceDirectionsJSON() string {
	value := ecommerce.Directions{ProductSummary: "测试商品", ConfirmedFacts: []string{"包装可见"}, UncertainFacts: []string{"成分未知"}}
	for _, id := range []string{"direction-1", "direction-2", "direction-3", "direction-4"} {
		value.Directions = append(value.Directions, ecommerce.Direction{ID: id, Name: "自然风格", Description: "自然光下完整保留商品外观"})
	}
	raw, _ := json.Marshal(value)
	return string(raw)
}

func ecommerceFinish(t *testing.T, db *gorm.DB, task *model.Task, text string) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"text": text})
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
}

func ecommerceReadyPlan(t *testing.T, s *Service, db *gorm.DB, p *EcommerceProjectView) *EcommerceProjectView {
	t.Helper()
	vision, err := s.SubmitEcommerceTask("user", p.ID, ecommerceQuoted(t, s, p, "vision"))
	if err != nil {
		t.Fatal(err)
	}
	ecommerceFinish(t, db, vision, ecommerceDirectionsJSON())
	p, err = s.EcommerceProject("user", p.ID)
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.AcceptEcommerceStage("user", p.ID, EcommerceAcceptRequest{Revision: p.Revision, TaskID: vision.ID, DirectionID: "direction-1"})
	if err != nil {
		t.Fatal(err)
	}
	planning, err := s.SubmitEcommerceTask("user", p.ID, ecommerceQuoted(t, s, p, "planning"))
	if err != nil {
		t.Fatal(err)
	}
	plan := ecommerce.Plan{Summary: "两张商品图", Images: []ecommerce.Image{{ID: "image-1", Title: "全貌", Prompt: "完整展示真实商品"}, {ID: "image-2", Title: "细节", Prompt: "展示商品可见细节"}}}
	raw, _ := json.Marshal(plan)
	ecommerceFinish(t, db, planning, string(raw))
	p, err = s.EcommerceProject("user", p.ID)
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.AcceptEcommerceStage("user", p.ID, EcommerceAcceptRequest{Revision: p.Revision, TaskID: planning.ID})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestEcommerceQuoteReplayAndTenantIsolation(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	req := ecommerceQuoted(t, s, p, "vision")
	assertWorkbenchBatchAccounting(t, db, 0)
	task, err := s.SubmitEcommerceTask("user", p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		replay, err := s.SubmitEcommerceTask("user", p.ID, req)
		if err != nil || replay.ID != task.ID {
			t.Fatal("replay lost receipt", err)
		}
	}
	assertWorkbenchBatchAccounting(t, db, 1)
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&stored).Update("input_json", compactTaskInputJSON(stored.InputJSON)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitEcommerceTask("user", p.ID, req); err != nil {
		t.Fatal("compaction lost idempotency", err)
	}
	changed := req
	changed.Stage = "planning"
	if _, err := s.SubmitEcommerceTask("user", p.ID, changed); err == nil {
		t.Fatal("identity reused for changed content")
	}
	if _, err := s.EcommerceReceipt("other", p.ID, req.RequestID); err == nil {
		t.Fatal("cross user receipt visible")
	}
	receipt, err := s.EcommerceReceipt("user", p.ID, req.RequestID)
	if err != nil || receipt.ID != task.ID || strings.Contains(receipt.InputJSON, "ecommerceRequestHash") {
		t.Fatal("receipt missing or internal fingerprint exposed", err)
	}
}

func TestEcommerceQuoteChangeInsufficientBalanceAndStaleRevisionDoNotBind(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	req := ecommerceQuoted(t, s, p, "vision")
	bad := req
	bad.MaxCharge++
	if _, err := s.SubmitEcommerceTask("user", p.ID, bad); err == nil {
		t.Fatal("unconfirmed quote accepted")
	}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitEcommerceTask("user", p.ID, req); err == nil {
		t.Fatal("balance bypassed")
	}
	current, err := s.EcommerceProject("user", p.ID)
	if err != nil || current.Revision != p.Revision || current.State.VisionTaskID != "" {
		t.Fatal("failed reserve mutated project", err)
	}
	var tasks int64
	db.Model(&model.Task{}).Count(&tasks)
	if tasks != 0 {
		t.Fatal("failed reserve left a task")
	}
	bad = req
	bad.Revision++
	if _, err := s.QuoteEcommerceTask("user", p.ID, bad); err == nil {
		t.Fatal("stale revision quoted")
	}
}

func TestEcommerceConcurrentSameIntentReservesOnce(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	req := ecommerceQuoted(t, s, p, "vision")
	other := &Service{repo: repository.New(db), dataDir: s.dataDir, disablePiRuntime: true}
	var wg sync.WaitGroup
	for _, svc := range []*Service{s, other} {
		wg.Add(1)
		go func(svc *Service) { defer wg.Done(); _, _ = svc.SubmitEcommerceTask("user", p.ID, req) }(svc)
	}
	wg.Wait()
	if _, err := s.SubmitEcommerceTask("user", p.ID, req); err != nil {
		t.Fatal(err)
	}
	assertWorkbenchBatchAccounting(t, db, 1)
}

func TestEcommerceNativeImageParametersAndSavingProjectIdentity(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	p = ecommerceReadyPlan(t, s, db, p)
	req := ecommerceQuoted(t, s, p, "image")
	task, err := s.SubmitEcommerceTask("user", p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.InputJSON, "canvasSize") {
		t.Fatal("unsupported canvasSize sent")
	}
	if target, err := s.mediaTaskProject(&stored); err != nil || target != "" {
		t.Fatal("ecommerce output cannot enter user asset library", err)
	}
	if _, err := s.CreateTask("user", CreateTaskRequest{ProjectID: p.ID, Type: "canvas_text", Prompt: "bypass", Input: map[string]any{"mode": "text", "config": map[string]any{"channelId": "channel", "model": "text-test"}}}); err == nil {
		t.Fatal("public task API bypassed ecommerce admission")
	}
	assertWorkbenchBatchAccounting(t, db, 3)
}

func TestEcommerceRoundsArePagedIdempotentAndProtectResources(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	p = ecommerceReadyPlan(t, s, db, p)
	snapshot, err := s.repo.ResourceReferenceSnapshotExcludingAssets("user", nil, []string{"product"})
	if err != nil {
		t.Fatal(err)
	}
	protected := false
	for _, doc := range snapshot.Documents {
		protected = protected || doc.Kind == "商品套图" && assets.DocumentReferences(doc.PrimaryJSON, map[string]struct{}{"product": {}})
	}
	if !protected {
		t.Fatal("product reference not protected")
	}
	req := EcommerceProjectRequest{Revision: p.Revision, NewRound: true, ClientKey: uuid.NewString(), Draft: p.Draft}
	req.Draft.Description = "第二轮"
	next, err := s.SaveEcommerceDraft("user", p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveEcommerceDraft("user", p.ID, req); err != nil {
		t.Fatal("same round replay not idempotent", err)
	}
	rounds, err := s.EcommerceRounds("user", p.ID, 1)
	if err != nil || len(rounds) != 1 || rounds[0].ID == next.ActiveRoundID || next.State.Plan != nil {
		t.Fatal("round boundaries invalid", err)
	}
	if _, err := s.EcommerceRounds("other", p.ID, 1); err == nil {
		t.Fatal("cross user history visible")
	}
	if _, err := s.EcommerceRounds("user", p.ID, 0); err == nil {
		t.Fatal("unbounded history accepted")
	}
}

func TestEcommerceStructuredResultRejectsInvalidOutputInDefaultMode(t *testing.T) {
	t.Setenv("AI_MODE", "disabled")
	s, db, p := ecommerceFixture(t)
	task, err := s.SubmitEcommerceTask("user", p.ID, ecommerceQuoted(t, s, p, "vision"))
	if err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	db.First(&stored, "id = ?", task.ID)
	if err := s.validateEcommerceResult(stored, map[string]any{"text": "plain chat or incomplete JSON"}); err == nil {
		t.Fatal("invalid text accepted as successful directions")
	}
	if err := s.validateEcommerceResult(stored, map[string]any{"text": ecommerceDirectionsJSON()}); err != nil {
		t.Fatal(err)
	}
}

func TestEcommercePresentationUsesNativeQuoteAndPreservesSavedPlan(t *testing.T) {
	s, db, p := ecommerceFixture(t)
	p = ecommerceReadyPlan(t, s, db, p)
	copy := "  日常收纳，\n轻装出门。  "
	var err error
	p, err = s.EditEcommerceImage("user", p.ID, "image-1", EcommerceImageEdit{Revision: p.Revision, Title: "编辑后的方案名称", Copy: copy, Prompt: "完整展示商品；允许标题贴边出血"})
	if err != nil {
		t.Fatal(err)
	}
	req := ecommerceQuoted(t, s, p, "image")
	var before model.EcommerceProject
	if err := db.First(&before, "id = ?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	prepared, err := s.prepareEcommerceTask("user", p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prepared.task.Prompt, "上图文案："+copy+"\n") || !strings.Contains(prepared.task.Prompt, "8%–92%") || strings.Contains(prepared.task.Prompt, "编辑后的方案名称") {
		t.Fatal("native quote lost approved copy or used the UI title")
	}
	// Quoting must not rewrite the reviewed plan or reserve image credits.
	var after model.EcommerceProject
	if err := db.First(&after, "id = ?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	if before.PlanJSON != after.PlanJSON || before.Revision != after.Revision {
		t.Fatal("quote mutated the saved plan")
	}
	assertWorkbenchBatchAccounting(t, db, 2)
	task, err := s.SubmitEcommerceTask("user", p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Prompt != prepared.task.Prompt {
		t.Fatal("quoted and admitted execution prompts diverged")
	}
	var input map[string]any
	if json.Unmarshal([]byte(stored.InputJSON), &input) != nil || !strings.Contains(stored.InputJSON, "8%–92%") || strings.Contains(stored.InputJSON, "canvasSize") {
		t.Fatal("native provider input lost presentation or parameters changed")
	}
	assertWorkbenchBatchAccounting(t, db, 3)
}
