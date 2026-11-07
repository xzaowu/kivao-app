package payment

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestEpayRPCArtifactDispatchesSelectedPaymentMethod(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("type") != "wxpay" || r.Form.Get("out_trade_no") != "RPC-METHOD-TEST" || r.Form.Get("sign") == "" {
			t.Fatal("RPC method selection was lost")
		}
		_, _ = w.Write([]byte(`{"code":1,"payurl":"https://fake-gateway.example/checkout"}`))
	}))
	defer server.Close()
	directory, err := filepath.Abs("../../../plugin-packages/official-payment-epay")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "epay", PluginID: "official-payment-epay", PluginVersion: "1.0.10"}, directory, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	config := Config{"pid": "test", "key": "synthetic-only", "gateway": server.URL, "payType": "alipay", "payTypes": "alipay,wxpay"}
	request := CreateRequest{MerchantOrderNo: "RPC-METHOD-TEST", AmountFen: 100, Currency: "CNY", NotifyURL: "https://merchant.example/notify", PaymentMethod: "wxpay"}
	if _, err := provider.CreateOrder(context.Background(), config, request); err != nil {
		t.Fatal(err)
	}
	request.PaymentMethod = "qqpay"
	if _, err := provider.CreateOrder(context.Background(), config, request); err == nil {
		t.Fatal("disabled method accepted by shipped artifact")
	}
	if calls != 1 {
		t.Fatal("disabled method reached fake gateway")
	}
	if _, err := provider.DownloadTradeBill(context.Background(), config, time.Now()); !errors.Is(err, ErrTradeBillNotFound) {
		t.Fatalf("shipped plugin lost missing-bill meaning across RPC: %v", err)
	}
}
