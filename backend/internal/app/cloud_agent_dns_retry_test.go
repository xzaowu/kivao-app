package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCloudAgentDNSRetryClassificationPreservesSubmissionBoundary(t *testing.T) {
	for _, test := range []struct {
		name       string
		status     model.TaskStatus
		kind       string
		providerID string
		media      string
		submitted  bool
		outcome    string
		code       string
		want       bool
	}{
		{name: "failed text DNS", status: model.TaskStatusFailed, kind: "canvas_text", code: string(ReasonUpstreamDNSFailed), outcome: "unknown", want: true},
		{name: "accepted text", status: model.TaskStatusFailed, kind: "canvas_text", code: string(ReasonUpstreamDNSFailed), providerID: "accepted-task"},
		{name: "submitted diagnostic", status: model.TaskStatusFailed, kind: "canvas_text", code: string(ReasonUpstreamDNSFailed), submitted: true, outcome: "accepted"},
		{name: "accepted diagnostic", status: model.TaskStatusFailed, kind: "canvas_text", code: string(ReasonUpstreamDNSFailed), outcome: "accepted"},
		{name: "media recovery", status: model.TaskStatusFailed, kind: "canvas_text", code: string(ReasonUpstreamDNSFailed), media: "checkpoint"},
		{name: "video is not a model step", status: model.TaskStatusFailed, kind: "canvas_video", code: string(ReasonUpstreamDNSFailed)},
		{name: "succeeded", status: model.TaskStatusSucceeded, kind: "canvas_text", code: string(ReasonUpstreamDNSFailed)},
		{name: "cancelled", status: model.TaskStatusCancelled, kind: "canvas_text", code: string(ReasonUpstreamDNSFailed)},
		{name: "plain error text is not diagnostic", status: model.TaskStatusFailed, kind: "canvas_text", code: string(ReasonInternal)},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			diagnostic, err := json.Marshal(model.TaskExecutionDiagnostic{Code: test.code, Phase: "execution", TaskSubmitted: test.submitted, SubmissionOutcome: test.outcome})
			if err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "dns-task", UserID: "test-user", Type: test.kind, Status: test.status, Error: "外部服务域名解析失败", ProviderRequestID: test.providerID, MediaRecoveryJSON: test.media, ExecutionDiagnosticJSON: string(diagnostic)}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			if got := s.cloudAgentModelTaskRetryable(task.ID); got != test.want {
				t.Fatalf("retryable=%t, want %t", got, test.want)
			}
			var count int64
			if err := db.Model(&model.BillingOrder{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("classification changed billing: %d %v", count, err)
			}
		})
	}
}

func TestCloudAgentDNSRetryUsesExistingStepLimitWithoutProviderCalls(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	s.cloudAgentModelRetryBase = time.Millisecond
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := s.cloudAgentPiModel(ctx, "user", root.ID, map[string]json.RawMessage{"messages": json.RawMessage(`[{"role":"user","content":"本地重试验证"}]`), "thinkingLevel": json.RawMessage(`"off"`)})
		done <- err
	}()
	seen := map[string]bool{}
	for len(seen) <= cloudAgentModelStepRetries {
		select {
		case err := <-done:
			t.Fatalf("bridge ended before retry budget: %d %v", len(seen), err)
		default:
		}
		run, err := s.repo.CloudAgent("user", root.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			t.Fatal(err)
		}
		if state.ActiveTaskID != "" && !seen[state.ActiveTaskID] {
			task, err := s.repo.TaskForUser("user", state.ActiveTaskID)
			if err != nil {
				t.Fatal(err)
			}
			if task.Operation == cloudAgentStepOperation {
				seen[task.ID] = true
				diagnostic, err := json.Marshal(model.TaskExecutionDiagnostic{Code: string(ReasonUpstreamDNSFailed), Phase: "execution", SubmissionOutcome: "unknown", RetryClass: "reconcile_submission"})
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "外部服务域名解析失败", "execution_diagnostic_json": string(diagnostic)}).Error; err != nil {
					t.Fatal(err)
				}
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("retry fixture deadline")
		case <-time.After(10 * time.Millisecond):
		}
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("DNS failures reported success")
		}
	case <-ctx.Done():
		t.Fatal("retry budget did not stop the model step")
	}
	if len(seen) != 4 {
		t.Fatalf("steps=%d, want original plus 3 retries", len(seen))
	}
	var calls int64
	if err := db.Model(&model.ApiCallLog{}).Count(&calls).Error; err != nil || calls != 0 {
		t.Fatalf("fixture sent provider calls: %d %v", calls, err)
	}
}
