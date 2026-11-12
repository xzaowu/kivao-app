package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestAutomaticBillingReleaseRequiresConfirmedEvidence(t *testing.T) {
	for _, mode := range []string{"not_submitted", "provider_failed", "running_task", "uncertain_order", "unknown", "missing_diagnostic", "result", "draft", "recovery", "successful_call", "other_order_failure", "cancellation_pending", "no_task", "replaced_order"} {
		t.Run(mode, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			created, err := s.CreateTask("user", creationTextRequest())
			if err != nil {
				t.Fatal(err)
			}
			task, err := s.repo.Task(created.ID)
			if err != nil {
				t.Fatal(err)
			}
			orderID := task.BillingOrderID
			task.Status = model.TaskStatusFailed
			recordTaskDiagnostic(task, "execution", "provider_execution_failed", "not_submitted", "correct_input", nil)
			status := model.BillingStatusReserved
			switch mode {
			case "running_task":
				task.Status = model.TaskStatusRunning
			case "uncertain_order":
				status = model.BillingStatusUncertain
			case "unknown", "other_order_failure":
				recordTaskDiagnostic(task, "execution", "provider_execution_failed", "unknown", "reconcile_submission", nil)
			case "missing_diagnostic":
				task.ExecutionDiagnosticJSON = ""
			case "result":
				task.ResultJSON = `{"text":"already generated"}`
			case "draft":
				task.TextDraft = "partial generated text"
			case "recovery":
				task.MediaRecoveryJSON = "test-checkpoint"
			case "cancellation_pending":
				task.ProviderCancelStatus = model.ProviderCancelStatusRequested
			case "replaced_order":
				task.BillingOrderID = "new-attempt"
			case "provider_failed":
				task.ProviderRequestID = "test-provider-request"
				recordTaskDiagnostic(task, "execution", "provider_execution_failed", "accepted", "correct_input", nil)
			}
			if err := db.Save(task).Error; err != nil {
				t.Fatal(err)
			}
			if mode == "no_task" {
				if err := db.Delete(task).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Model(&model.BillingOrder{}).Where("id = ?", orderID).Updates(map[string]any{"status": status, "updated_at": time.Now().Add(-time.Hour)}).Error; err != nil {
				t.Fatal(err)
			}
			if mode == "provider_failed" || mode == "successful_call" || mode == "other_order_failure" {
				call := model.ApiCallLog{ID: "evidence", UserID: task.UserID, TaskID: task.ID, BillingOrderID: orderID, Billable: true, RequestKind: "create", Status: model.ApiCallStatusFailed, ErrorCode: "task_failed"}
				if mode == "successful_call" {
					call.Status, call.ErrorCode = model.ApiCallStatusSucceeded, ""
				}
				if mode == "other_order_failure" {
					call.BillingOrderID = "another-attempt"
				}
				if err := db.Create(&call).Error; err != nil {
					t.Fatal(err)
				}
			}
			// Test-only setting and data; no administrator or provider request is sent.
			if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: billingAutoRefundSettingKey, ValueJSON: `{"enabled":true}`}); err != nil {
				t.Fatal(err)
			}
			before, err := s.repo.CreditAccount(task.UserID)
			if err != nil {
				t.Fatal(err)
			}
			wantChanges := 0
			if mode == "not_submitted" || mode == "provider_failed" {
				wantChanges = 1
			}
			if got := s.autoRefundReviewBilling(t.Context()); got != wantChanges {
				t.Fatalf("changed=%d want=%d", got, wantChanges)
			}
			if got := s.autoRefundReviewBilling(t.Context()); got != 0 {
				t.Fatalf("second scan repeated refund: %d", got)
			}
			order, err := s.repo.BillingOrder(orderID)
			if err != nil {
				t.Fatal(err)
			}
			delta := int64(0)
			if wantChanges == 1 {
				delta = order.AmountMicrocredits
				if order.Status != model.BillingStatusRefunded || order.ResolutionNote != billingAutoRefundNote {
					t.Fatalf("refund and resolution were not committed together: %s", order.Status)
				}
			} else if order.Status != status || order.ResolutionNote != "" {
				t.Fatal("ambiguous evidence changed billing state")
			}
			after, err := s.repo.CreditAccount(task.UserID)
			if err != nil || after.AvailableMicrocredits != before.AvailableMicrocredits+delta || after.ReservedMicrocredits != before.ReservedMicrocredits-delta {
				t.Fatalf("unexpected ledger balance: before=%+v after=%+v err=%v", before, after, err)
			}
			var refunds int64
			if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", orderID, model.CreditLedgerRefund).Count(&refunds).Error; err != nil || refunds != int64(wantChanges) {
				t.Fatalf("refund entries=%d want=%d err=%v", refunds, wantChanges, err)
			}
		})
	}
}
