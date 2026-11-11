package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestTaskBillingSummarySeparatesReservationsChargesAndRefunds(t *testing.T) {
	for _, status := range []model.BillingStatus{model.BillingStatusReserved, model.BillingStatusRunning, model.BillingStatusSettled, model.BillingStatusRefunded, model.BillingStatusUncertain} {
		t.Run(string(status), func(t *testing.T) {
			order := model.BillingOrder{Status: status, AmountMicrocredits: 1000000, ActualAmountMicrocredits: 600000, RefundedAmountMicrocredits: 400000}
			result := taskSummariesForOutputWithBilling([]model.Task{{ID: "task"}}, map[string]model.BillingOrder{"task": order})
			payload, err := json.Marshal(result[0].Billing)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]any
			if err := json.Unmarshal(payload, &fields); err != nil {
				t.Fatal(err)
			}
			if fields["reservedMicrocredits"] != float64(1000000) || fields["amountMicrocredits"] != float64(1000000) || fields["refundedMicrocredits"] != float64(400000) {
				t.Fatalf("incorrect billing amounts: %s", payload)
			}
			charged, exists := fields["chargedMicrocredits"]
			if exists != (status == model.BillingStatusSettled) || (exists && charged != float64(600000)) {
				t.Fatalf("only settled orders may report a charge: %s", payload)
			}
		})
	}
	zero := taskBillingSummary(model.BillingOrder{Status: model.BillingStatusSettled})
	if zero.ChargedMicrocredits == nil || *zero.ChargedMicrocredits != 0 {
		t.Fatal("a settled zero-charge order must remain distinguishable from an unsettled order")
	}
}
