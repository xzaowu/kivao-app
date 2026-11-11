package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

type workerBillingStartFailureRepository struct {
	taskBillingRepository
	startErr error
	readErr  error
	calls    int
}

func (r *workerBillingStartFailureRepository) MarkBillingRunning(string) error {
	r.calls++
	return r.startErr
}

func (r *workerBillingStartFailureRepository) BillingOrder(id string) (*model.BillingOrder, error) {
	if r.readErr != nil {
		return nil, r.readErr
	}
	return r.taskBillingRepository.BillingOrder(id)
}

func TestWorkerBillingStartFailurePreservesSubmittedReservation(t *testing.T) {
	for _, tc := range []struct {
		name, providerID, dispatch                   string
		uncertainOrder, timeout, readFailure, review bool
	}{
		{name: "not_submitted"},
		{name: "provider_accepted", providerID: "local-provider-job", review: true},
		{name: "route_accepted", dispatch: "accepted", review: true},
		{name: "route_submission_unknown", dispatch: "submission_unknown", review: true},
		{name: "existing_review", uncertainOrder: true, review: true},
		{name: "billing_timeout", timeout: true, review: true},
		{name: "billing_read_failure", readFailure: true, review: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			task := &model.Task{ID: newID(), UserID: "billing-test-user", Type: "canvas_text", Status: model.TaskStatusQueued,
				InputJSON: `{"mode":"text","config":{"channelId":"system-channel"}}`, RouteRun: 1, ProviderRequestID: tc.providerID}
			order := &model.BillingOrder{ID: newID(), UserID: task.UserID, TaskID: task.ID, IdempotencyKey: newID(),
				Status: model.BillingStatusReserved, AmountMicrocredits: 100, ReservedAmountMicrocredits: 100}
			if tc.uncertainOrder {
				order.Status = model.BillingStatusUncertain
			}
			task.BillingOrderID = order.ID
			attempt := &model.RouteAttempt{ID: newID(), TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: 1,
				Status: "selected", DispatchState: "not_sent"}
			if tc.dispatch != "" {
				attempt.DispatchState, attempt.ProviderRequestID = tc.dispatch, "local-route-job"
			}
			for _, item := range []any{task, order, attempt, &model.CreditAccount{UserID: task.UserID, AvailableMicrocredits: 900, ReservedMicrocredits: 100}} {
				if err := db.Create(item).Error; err != nil {
					t.Fatal(err)
				}
			}
			failure := errors.New("injected billing start failure")
			if tc.timeout {
				failure = errors.New("injected billing timeout")
			}
			billingRepo := &workerBillingStartFailureRepository{taskBillingRepository: s.repo, startErr: failure}
			if tc.readFailure {
				billingRepo.readErr = errors.New("injected billing read failure")
			}
			s.taskBillingCoordinator = newTaskBillingCoordinator(billingRepo)
			probe := &queuedChannelExecutionProbe{Service: s}
			s.taskRouteExecutor = &taskRouteExecutor{port: probe}
			claimed, err := s.repo.ClaimNextTask("billing-worker", time.Minute)
			if err != nil || claimed == nil {
				t.Fatalf("claim: %v", err)
			}
			if err = s.taskWorker().processClaimedTask(claimed, nil); !errors.Is(err, failure) {
				t.Fatalf("worker did not preserve billing error: %v", err)
			}
			stored, err := s.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if billingRepo.calls != 1 || probe.calls != 0 || stored.Status != model.TaskStatusFailed || stored.LeaseOwner != "" || !strings.Contains(stored.Stage, "计费准备失败") {
				t.Fatalf("worker failed outside billing preparation: starts=%d providerCalls=%d status=%s stage=%s", billingRepo.calls, probe.calls, stored.Status, stored.Stage)
			}
			got, err := s.repo.BillingOrder(order.ID)
			if err != nil {
				t.Fatal(err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", task.UserID).Error; err != nil {
				t.Fatal(err)
			}
			wantStatus, available, reserved := model.BillingStatusRefunded, int64(1000), int64(0)
			wantOutcome := "not_submitted"
			if tc.review {
				wantStatus, available, reserved, wantOutcome = model.BillingStatusUncertain, 900, 100, "unknown"
			}
			diagnostic := taskExecutionDiagnostic(stored)
			if got.Status != wantStatus || account.AvailableMicrocredits != available || account.ReservedMicrocredits != reserved || diagnostic == nil || diagnostic.SubmissionOutcome != wantOutcome {
				t.Fatalf("unsafe billing outcome: order=%s available=%d reserved=%d diagnostic=%+v", got.Status, account.AvailableMicrocredits, account.ReservedMicrocredits, diagnostic)
			}
		})
	}
}
