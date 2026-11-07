package protocol

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPaymentMethodManifestRejectsInvalidOptions(t *testing.T) {
	raw, err := os.ReadFile("../../../plugin-packages/official-payment-epay/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, methods := range [][]ManifestPaymentMethod{
		{{ID: "alipay", Label: "支付宝"}, {ID: "alipay", Label: "重复"}},
		{{ID: "bad method", Label: "无效"}},
		{{ID: "wxpay", Label: ""}},
	} {
		var parsed Manifest
		if err := json.Unmarshal(raw, &parsed); err != nil {
			t.Fatal(err)
		}
		parsed.Contributes.PaymentProviders[0].PaymentMethods = methods
		if err := validatePaymentProviderContributions(parsed); err == nil {
			t.Fatal("invalid payment method declaration accepted")
		}
	}
}
