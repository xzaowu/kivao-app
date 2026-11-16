package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"
)

// Only Descriptor is used by the read path. Any payment RPC would fail this fixture.
type catalogTestProvider struct {
	payment.Provider
	descriptor payment.Descriptor
}

func (p catalogTestProvider) Descriptor() payment.Descriptor { return p.descriptor }

func TestPaymentProviderCatalogReadsFreshConfigurationAndRedactsSecrets(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.PaymentProviderConfig{}, &model.PluginPlatformState{}); err != nil {
		t.Fatal(err)
	}
	manifest := bundledPaymentPluginManifests()[0]
	manifest.Metadata.ID = "catalog-test"
	manifest.Contributes.PaymentProviders[0].ID = "catalog-provider"
	manifest.Contributes.PaymentProviders[0].MethodsField = "methods"
	manifest.Contributes.PaymentProviders[0].Methods = []protocol.ManifestPaymentMethod{{ID: "card", Label: "Card"}}
	manifest.Configuration.Fields = []protocol.ManifestField{{Name: "methods", Type: "string"}, {Name: "secret", Type: "string", Secret: true}}
	raw, _ := json.Marshal(manifest)
	registry, err := payment.NewRegistry(catalogTestProvider{descriptor: payment.Descriptor{ID: "catalog-provider", PluginID: "catalog-test", Name: "Catalog"}})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir(), paymentRegistry: registry, pluginRuntime: &pluginRuntime{plugins: map[string]pluginRecord{
		"catalog-test": {Raw: raw, Metadata: manifest.Metadata, Source: PluginOriginUploaded, Status: "enabled"},
	}}}
	cipher, err := svc.encryptSettingSecret(`{"methods":"card","secret":"synthetic-test-value","settlementCurrency":"USD"}`)
	if err != nil {
		t.Fatal(err)
	}
	config := model.PaymentProviderConfig{ID: "config", ProviderID: "catalog-provider", PluginID: "catalog-test", Version: 1, Enabled: true, CloseAfterMinutes: 15, ConfigCipher: cipher}
	if err := db.Create(&config).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.PluginPlatformState{PluginID: "catalog-test", Available: true}).Error; err != nil {
		t.Fatal(err)
	}
	actor := &model.User{ID: "catalog-user"}
	if _, err := svc.PaymentProviders(nil); err == nil {
		t.Fatal("anonymous catalog access accepted")
	}
	if _, err := svc.AdminPaymentProviders(actor); err == nil {
		t.Fatal("non-admin configuration access accepted")
	}
	items, err := svc.PaymentProviders(actor)
	if err != nil || len(items) != 1 {
		t.Fatalf("catalog size=%d err=%v", len(items), err)
	}
	if items[0].SettlementCurrency != "USD" || len(items[0].Methods) != 1 || items[0].Methods[0].Name != "Card" {
		t.Fatal("currency/method configuration was lost")
	}
	admin, err := svc.AdminPaymentProviders(&model.User{ID: "admin", Role: model.UserRoleAdmin})
	if err != nil || len(admin) != 1 {
		t.Fatalf("admin catalog size=%d err=%v", len(admin), err)
	}
	if !admin[0].SecretConfigured["secret"] || admin[0].Values["secret"] != "" || admin[0].Values["methods"] != "card" {
		t.Fatal("admin secret/config contract changed")
	}
	encoded, _ := json.Marshal(admin)
	if strings.Contains(string(encoded), "synthetic-test-value") {
		t.Fatal("secret leaked in catalog")
	}
	manifest.Contributes.PaymentProviders[0].Methods[0].Label = "Updated card"
	raw, _ = json.Marshal(manifest)
	svc.pluginRuntime.mu.Lock()
	record := svc.pluginRuntime.plugins["catalog-test"]
	record.Raw = raw
	svc.pluginRuntime.plugins["catalog-test"] = record
	svc.pluginRuntime.mu.Unlock()
	items, err = svc.PaymentProviders(actor)
	if err != nil || len(items) != 1 || items[0].Methods[0].Name != "Updated card" {
		t.Fatal("next request did not see updated plugin manifest")
	}
	if err := db.Model(&model.PluginPlatformState{}).Where("plugin_id = ?", "catalog-test").Update("available", false).Error; err != nil {
		t.Fatal(err)
	}
	items, err = svc.PaymentProviders(actor)
	if err != nil || len(items) != 0 {
		t.Fatal("next request did not see disabled plugin")
	}
}

// Synthetic manifests model the parsing hot path, not live endpoint latency.
func BenchmarkPaymentProviderManifestSnapshots(b *testing.B) {
	svc := &Service{pluginRuntime: &pluginRuntime{plugins: map[string]pluginRecord{}}}
	for i := 0; i < 118; i++ {
		manifest := protocol.Manifest{Metadata: protocol.Metadata{ID: fmt.Sprintf("catalog-%03d", i), Description: strings.Repeat("x", 24*1024)}}
		if i < 5 {
			manifest.Contributes.PaymentProviders = []protocol.ManifestPaymentProvider{{ID: fmt.Sprintf("provider-%d", i)}}
		}
		raw, _ := json.Marshal(manifest)
		svc.pluginRuntime.plugins[manifest.Metadata.ID] = pluginRecord{Raw: raw, Metadata: manifest.Metadata, Status: "enabled"}
	}
	b.Run("previous_repeated_snapshots", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			for i := 0; i < 5; i++ {
				id := fmt.Sprintf("provider-%d", i)
				_, _ = paymentManifestFromPlugins(id, svc.Plugins())
				_, _ = svc.pluginStateForUser(nil, fmt.Sprintf("catalog-%03d", i), svc.Plugins())
				_, _ = paymentProviderOptionsWithPlugins(id, payment.Config{}, svc.Plugins())
			}
		}
	})
	b.Run("one_request_snapshot", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			plugins := svc.Plugins()
			for i := 0; i < 5; i++ {
				id := fmt.Sprintf("provider-%d", i)
				_, _ = paymentManifestFromPlugins(id, plugins)
				_, _ = svc.pluginStateForUser(nil, fmt.Sprintf("catalog-%03d", i), plugins)
				_, _ = paymentProviderOptionsWithPlugins(id, payment.Config{}, plugins)
			}
		}
	})
}
