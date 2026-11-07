package app

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"
)

type methodTestProvider struct {
	payment.Provider
	descriptor payment.Descriptor
	requests   []payment.CreateRequest
}

func (p *methodTestProvider) Descriptor() payment.Descriptor { return p.descriptor }
func (p *methodTestProvider) ValidateConfig(config payment.Config) error {
	_, _, err := payment.AvailablePaymentMethods(p.descriptor, config)
	return err
}
func (p *methodTestProvider) CreateOrder(_ context.Context, config payment.Config, request payment.CreateRequest) (payment.Checkout, error) {
	method, err := payment.ResolvePaymentMethod(p.descriptor, config, request.PaymentMethod)
	if err != nil {
		return payment.Checkout{}, err
	}
	request.PaymentMethod = method
	p.requests = append(p.requests, request)
	return payment.Checkout{Mode: "redirect", Value: "https://fake-gateway.example/checkout", ExpiresAt: request.ExpiresAt}, nil
}
func (p *methodTestProvider) QueryOrder(_ context.Context, _ payment.Config, request payment.QueryRequest) (payment.Result, error) {
	return payment.Result{MerchantOrderNo: request.MerchantOrderNo, ProviderStatus: "pending", AmountFen: 100, Currency: "CNY"}, nil
}

func TestPaymentMethodOrderIdentityAndPinnedConfiguration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.TopupProduct{}, &model.PaymentOrder{}, &model.PaymentProviderConfig{}, &model.PluginPlatformState{}, &model.UserPluginState{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../plugin-packages/official-payment-epay/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest protocol.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	provider := &methodTestProvider{descriptor: payment.DescriptorFromManifest(manifest, manifest.Contributes.PaymentProviders[0])}
	registry, err := payment.NewRegistry(provider)
	if err != nil {
		t.Fatal(err)
	}
	center := &pluginRuntime{plugins: map[string]pluginRecord{manifest.Metadata.ID: {Raw: raw, Metadata: manifest.Metadata, Status: "enabled", Source: PluginOriginUploaded}}}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir(), pluginRuntime: center, paymentRegistry: registry}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	user := &model.User{ID: "buyer", Role: model.UserRoleUser}
	values := map[string]string{"publicBaseUrl": "https://merchant.example", "pid": "test-merchant", "key": "synthetic-only", "gateway": "https://fake-gateway.example", "payType": "alipay", "payTypes": "alipay,wxpay"}
	config, err := svc.UpdatePaymentProviderConfig(admin, "epay", UpdatePaymentProviderConfigRequest{Enabled: true, CloseAfterMinutes: 10, Values: values})
	if err != nil {
		t.Fatal(err)
	}
	if len(config.PaymentMethods) != 2 || config.DefaultPaymentMethod != "alipay" {
		t.Fatal("configured public method choices missing")
	}
	product := model.TopupProduct{ID: "test-product", Name: "test", AmountFen: 100, Currency: "CNY", CreditsMicrocredits: 100, Enabled: true}
	if err := db.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	request := CreatePaymentOrderRequest{ProductID: product.ID, ProviderID: "epay", PaymentMethod: "wxpay", IdempotencyKey: "method-order"}
	order, err := svc.CreatePaymentOrder(context.Background(), user, request)
	if err != nil {
		t.Fatal(err)
	}
	if order.PaymentMethod != "wxpay" || len(provider.requests) != 1 || provider.requests[0].PaymentMethod != "wxpay" {
		t.Fatal("selected method was not persisted and dispatched")
	}
	if _, err := svc.CreatePaymentOrder(context.Background(), user, request); err != nil || len(provider.requests) != 1 {
		t.Fatal("retry submitted another gateway order")
	}
	request.PaymentMethod = "alipay"
	if _, err := svc.CreatePaymentOrder(context.Background(), user, request); err == nil {
		t.Fatal("idempotency key accepted another method")
	}
	request.IdempotencyKey = "invalid-method"
	request.PaymentMethod = "qqpay"
	if _, err := svc.CreatePaymentOrder(context.Background(), user, request); err == nil {
		t.Fatal("disabled method accepted")
	}
	var count int64
	if err := db.Model(&model.PaymentOrder{}).Count(&count).Error; err != nil || count != 1 || len(provider.requests) != 1 {
		t.Fatal("invalid request created order or reached gateway")
	}
	values["payTypes"] = "alipay"
	if _, err := svc.UpdatePaymentProviderConfig(admin, "epay", UpdatePaymentProviderConfigRequest{Enabled: true, CloseAfterMinutes: 10, Values: values}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RefreshPaymentCheckout(context.Background(), user, order.ID); err != nil {
		t.Fatal(err)
	}
	if len(provider.requests) != 2 || provider.requests[1].PaymentMethod != "wxpay" {
		t.Fatal("refresh used current config or another method")
	}
	// Legacy orders have no method column value and must keep their original version's default.
	if err := db.Model(&model.PaymentOrder{}).Where("id = ?", order.ID).Update("payment_method", "").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.PaymentOrder{}).Where("id = ?", order.ID).Update("checkout_expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RefreshPaymentCheckout(context.Background(), user, order.ID); err != nil {
		t.Fatal(err)
	}
	if provider.requests[len(provider.requests)-1].PaymentMethod != "alipay" {
		t.Fatal("legacy order did not use original default")
	}
}
