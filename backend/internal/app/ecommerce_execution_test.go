package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
)

func TestEcommerceNativeStubPipelineSettlesAndRegistersImages(t *testing.T) {
	t.Setenv("AI_MODE", "disabled")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
	t.Setenv("REDIS_URL", "")
	s, db, p := ecommerceFixture(t)
	s = New(s.repo, s.dataDir)
	s.disablePiRuntime = true
	picture := mediaTestPNG(t)
	resource, err := s.UploadResourceFile("user", "product.png", int64(len(picture)), "image", 2, 3, 0, bytes.NewReader(picture))
	if err != nil {
		t.Fatal(err)
	}
	p.Draft.References = []ecommerce.Reference{{ResourceID: resource.ID, Role: "primary"}}
	p, err = s.SaveEcommerceDraft("user", p.ID, EcommerceProjectRequest{Revision: p.Revision, ClientKey: uuid.NewString(), Draft: p.Draft})
	if err != nil {
		t.Fatal(err)
	}
	var textCalls, imageCalls atomic.Int32
	plan := ecommerce.Plan{Summary: "测试套图", Images: []ecommerce.Image{{ID: "image-1", Title: "商品全貌", Prompt: "保留商品外观"}, {ID: "image-2", Title: "商品细节", Prompt: "保留可见细节"}}}
	planJSON, _ := json.Marshal(plan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method %s", r.Method)
			http.Error(w, "unexpected", 400)
			return
		}
		if strings.Contains(r.URL.Path, "chat/completions") {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				return
			}
			encoded, _ := json.Marshal(body)
			if !bytes.Contains(encoded, []byte("data:image/png;base64,")) {
				t.Error("native reference bytes missing")
			}
			text := ecommerceDirectionsJSON()
			if textCalls.Add(1) == 2 {
				text = string(planJSON)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": text}}}, "usage": map[string]any{"prompt_tokens": 100, "completion_tokens": 100}})
		} else if strings.Contains(r.URL.Path, "images/") {
			imageCalls.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
		} else {
			t.Errorf("unexpected local stub path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": server.URL, "api_key": "local-stub-only"}).Error; err != nil {
		t.Fatal(err)
	}
	profile := DefaultModelCapabilityConfigForModel("chat-completion", "text-test")
	streaming := false
	profile.Text.Streaming = &streaming
	profile.Text.References.MaxImages = 8
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	var lastRequestID string
	execute := func(stage string) *model.Task {
		t.Helper()
		req := ecommerceQuoted(t, s, p, stage)
		lastRequestID = req.RequestID
		task, err := s.SubmitEcommerceTask("user", p.ID, req)
		if err != nil {
			t.Fatal(err)
		}
		claimed, err := s.repo.ClaimNextTask("ecommerce-test", time.Minute)
		if err != nil || claimed == nil || claimed.ID != task.ID {
			t.Fatal("claim", err)
		}
		if err := s.taskWorker().processClaimedTask(claimed, nil); err != nil {
			t.Fatal(err)
		}
		saved, err := s.repo.Task(task.ID)
		if err != nil || saved.Status != model.TaskStatusSucceeded {
			t.Fatalf("native stage %s failed: status=%s error=%s read=%v", stage, saved.Status, saved.Error, err)
		}
		p, err = s.EcommerceProject("user", p.ID)
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	vision := execute("vision")
	p, err = s.AcceptEcommerceStage("user", p.ID, EcommerceAcceptRequest{Revision: p.Revision, TaskID: vision.ID, DirectionID: "direction-1"})
	if err != nil {
		t.Fatal(err)
	}
	planning := execute("planning")
	p, err = s.AcceptEcommerceStage("user", p.ID, EcommerceAcceptRequest{Revision: p.Revision, TaskID: planning.ID})
	if err != nil {
		t.Fatal(err)
	}
	image := execute("image")
	if textCalls.Load() != 2 || imageCalls.Load() != 1 {
		t.Fatalf("unexpected generation counts %d %d", textCalls.Load(), imageCalls.Load())
	}
	var orders []model.BillingOrder
	if err := db.Find(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if len(orders) != 3 {
		t.Fatal("billing orders missing")
	}
	for _, o := range orders {
		if o.Status != model.BillingStatusSettled {
			t.Fatalf("stage not settled: %s", o.Status)
		}
	}
	var account model.CreditAccount
	db.First(&account, "user_id = ?", "user")
	if account.ReservedMicrocredits != 0 || account.AvailableMicrocredits != 9700 {
		t.Fatalf("unbalanced local credits %d %d", account.ReservedMicrocredits, account.AvailableMicrocredits)
	}
	var assets []model.Asset
	db.Where("user_id = ?", "user").Find(&assets)
	if len(assets) != 1 || !strings.Contains(assets[0].PayloadJSON, `"taskId":"`+image.ID+`"`) {
		t.Fatal("native output was not registered in asset library")
	}
	var result map[string]any
	if json.Unmarshal([]byte(image.ResultJSON), &result) != nil || !strings.Contains(image.ResultJSON, "/resources/") {
		t.Fatal("image not materialized as durable resource")
	}
	// Polling the completed receipt is read only, including after compaction.
	public, err := s.EcommerceReceipt("user", p.ID, lastRequestID)
	if err != nil || public == nil || public.ID != image.ID {
		t.Fatal("completed receipt lost", err)
	}
	if textCalls.Load() != 2 || imageCalls.Load() != 1 {
		t.Fatal("receipt replayed a provider request")
	}
}
