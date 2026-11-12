package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestTextCompletionFailurePreservesDraftAndReservation(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv("REDIS_URL", "")
	for _, wire := range textCompletionFixtures() {
		for _, scenario := range []string{"missing_terminal", "incomplete", "error_after_text"} {
			t.Run(wire.wire+"/"+scenario, func(t *testing.T) {
				s, db := newProviderTerminalTestService(t)
				coordinator, err := platform.NewCoordinator("sqlite")
				if err != nil {
					t.Fatal(err)
				}
				s.coordinator = coordinator
				s.platform = platform.New(s.repo, s.coordinator, platformHost{svc: s})
				expires := time.Now().Add(time.Hour)
				task := &model.Task{ID: newID(), UserID: "stream-user", Type: "canvas_text", Status: model.TaskStatusRunning, LeaseOwner: "worker", LeaseExpiresAt: &expires, RouteRun: 1}
				order := model.BillingOrder{ID: newID(), UserID: task.UserID, TaskID: task.ID, IdempotencyKey: newID(), Status: model.BillingStatusRunning, AmountMicrocredits: 100, ReservedAmountMicrocredits: 100}
				task.BillingOrderID = order.ID
				for _, row := range []any{task, &order, &model.CreditAccount{UserID: task.UserID, AvailableMicrocredits: 900, ReservedMicrocredits: 100}} {
					if err := db.Create(row).Error; err != nil {
						t.Fatal(err)
					}
				}
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, wire.delta)
					if scenario == "incomplete" {
						fmt.Fprint(w, wire.incomplete)
					} else if scenario == "error_after_text" {
						fmt.Fprint(w, "event: error\ndata: {\"error\":{\"message\":\"tool_choice unsupported secret-sentinel\"}}\n\n")
					}
				}))
				defer server.Close()
				ctx := withProtocolRegistry(withProviderAnalytics(context.Background(), s, *task), loadOfficialFallbackRegistry())
				result, runErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: "test", StreamText: true,
					Config: providerConfig{BaseURL: server.URL, Model: "test", InterfaceType: wire.interfaceID},
					OnTextDelta: func(delta string) {
						if _, err := s.AppendTaskTextDelta(task.UserID, task.ID, delta); err != nil {
							t.Errorf("persist delta: %v", err)
						}
					},
				})
				if result != nil || runErr == nil || calls.Load() != 1 {
					t.Fatalf("result=%v error=%v calls=%d", result, runErr, calls.Load())
				}
				if err := s.terminalCoordinator().handleExecutionFailure(task, runErr, false, false); !errors.Is(err, runErr) {
					t.Fatalf("terminal failure lost: %v", err)
				}
				replay, err := s.TaskTextReplay(task.UserID, task.ID, 0)
				if err != nil || replay.Status != model.TaskStatusFailed || !replay.Complete || replay.TextDraft != "draft" || replay.FinalText != "" {
					t.Fatalf("replay=%+v err=%v", replay, err)
				}
				stored, err := s.repo.Task(task.ID)
				if err != nil || stored.ResultJSON != "" {
					t.Fatalf("partial result persisted as success: %+v %v", stored, err)
				}
				gotOrder, err := s.repo.BillingOrder(order.ID)
				if err != nil || gotOrder.Status != model.BillingStatusUncertain {
					t.Fatalf("billing=%+v err=%v", gotOrder, err)
				}
				var account model.CreditAccount
				if err := db.First(&account, "user_id = ?", task.UserID).Error; err != nil {
					t.Fatal(err)
				}
				if account.AvailableMicrocredits != 900 || account.ReservedMicrocredits != 100 {
					t.Fatalf("reservation changed: %+v", account)
				}
				if err := s.taskBilling().CheckRetryEligibility(order.ID); !errors.Is(err, errTaskBillingReview) {
					t.Fatalf("billing review gate lost: %v", err)
				}
				var retryErr *AppError
				if _, err := s.RetryTask(task.UserID, task.ID); !errors.As(err, &retryErr) || retryErr.Status != http.StatusBadRequest {
					t.Fatalf("unreviewed retry not rejected by public API: %v", err)
				}
				if _, err := s.AppendTaskTextDelta(task.UserID, task.ID, "late"); err == nil {
					t.Fatal("late delta accepted after failure")
				}
				if _, err := s.TaskTextReplay("other-user", task.ID, 0); err == nil {
					t.Fatal("draft leaked across users")
				}
				if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: billingAutoRefundSettingKey, ValueJSON: `{"enabled":true}`}); err != nil {
					t.Fatal(err)
				}
				if changed := s.autoRefundReviewBilling(t.Context()); changed != 0 {
					t.Fatalf("incomplete stream automatically refunded: %d", changed)
				}
				var ledgerCount int64
				if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ?", order.ID).Count(&ledgerCount).Error; err != nil || ledgerCount != 0 {
					t.Fatalf("unexpected settlement/refund entries: %d %v", ledgerCount, err)
				}
				if calls.Load() != 1 {
					t.Fatalf("failure recovery resent generation: %d", calls.Load())
				}
			})
		}
	}
}
