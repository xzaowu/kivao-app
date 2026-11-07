package paymentsdk

import "testing"

func TestPaymentMethodsExplicitAllowlistAndLegacyDefault(t *testing.T) {
	descriptor := Descriptor{PaymentMethods: []PaymentMethod{{ID: "alipay", Label: "支付宝"}, {ID: "wxpay", Label: "微信支付"}}}
	for _, config := range []Config{{}, {"payType": "wxpay"}, {"payType": "custom-legacy"}} {
		methods, defaultID, err := AvailablePaymentMethods(descriptor, config)
		if err != nil || len(methods) != 1 || methods[0].ID != defaultID {
			t.Fatalf("legacy default failed: %#v, %v", methods, err)
		}
	}
	config := Config{"payType": "alipay", "payTypes": "alipay, wxpay,alipay"}
	methods, _, err := AvailablePaymentMethods(descriptor, config)
	if err != nil || len(methods) != 2 {
		t.Fatalf("invalid list: %#v %v", methods, err)
	}
	if chosen, err := ResolvePaymentMethod(descriptor, config, "wxpay"); err != nil || chosen != "wxpay" {
		t.Fatal("enabled method rejected")
	}
	if chosen, err := ResolvePaymentMethod(descriptor, config, ""); err != nil || chosen != "alipay" {
		t.Fatal("default changed")
	}
	for _, invalid := range []Config{{"payType": "wxpay", "payTypes": "alipay"}, {"payTypes": "alipay,unknown"}, {"payTypes": ","}} {
		if _, _, err := AvailablePaymentMethods(descriptor, invalid); err == nil {
			t.Fatal("invalid configuration accepted")
		}
	}
	if _, err := ResolvePaymentMethod(descriptor, Config{}, "wxpay"); err == nil {
		t.Fatal("unconfigured method accepted")
	}
	if method, err := ResolvePaymentMethod(descriptor, Config{"payType": "custom-legacy", "payTypes": "custom-legacy,alipay"}, "custom-legacy"); err != nil || method != "custom-legacy" {
		t.Fatal("existing gateway-specific default was lost")
	}
	if _, err := ResolvePaymentMethod(Descriptor{}, Config{}, "wxpay"); err == nil {
		t.Fatal("method accepted by non-participating provider")
	}
}
