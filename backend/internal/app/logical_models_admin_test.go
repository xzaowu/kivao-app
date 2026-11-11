package app

import (
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func adminLogicalModelFixture(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	svc, db := newModelCatalogTestService(t)
	t.Cleanup(func() { _ = svc.Close() })
	if err := db.AutoMigrate(&model.LogicalModelRevision{}, &model.LogicalModelRoute{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	profile, err := json.Marshal(DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-model"))
	if err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: "channel", Name: "Test channel", Scope: model.ChannelScopeSystem, Enabled: true, APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	for index, id := range []string{"damaged", "healthy"} {
		items := []any{
			&model.ChannelModel{ID: id + "-cm", ChannelID: channel.ID, ModelKey: id, ProviderModelKey: "private-provider-" + id, Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: string(profile), Enabled: true, PriceConfigured: true, BillingMode: "fixed_request", UnitPriceMicrocredits: 1000000},
			&model.LogicalModel{ID: id, Code: id, Name: id, Capability: "text", Enabled: true, SortOrder: index, ActiveRevisionID: id + "-revision", PricePolicy: "channel", BillingMode: "fixed_request"},
			&model.LogicalModelRevision{ID: id + "-revision", LogicalModelID: id, Version: 1, CapabilitySpecJSON: `{"version":1,"capability":"text"}`, DefaultOptionsJSON: `{}`},
			&model.LogicalModelRoute{ID: id + "-route", LogicalModelRevisionID: id + "-revision", ChannelModelID: id + "-cm", Enabled: true, Weight: 1},
		}
		for _, item := range items {
			if err := db.Create(item).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	return svc, db, &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
}

func TestAdminLogicalModelsIsolatesInvalidConfigurations(t *testing.T) {
	for _, tc := range []struct {
		name    string
		table   any
		id      string
		column  string
		invalid string
	}{
		{"invalid product JSON", &model.LogicalModelRevision{}, "damaged-revision", "capability_spec_json", `not-json synthetic-private-marker`},
		{"invalid defaults JSON", &model.LogicalModelRevision{}, "damaged-revision", "default_options_json", `not-json synthetic-private-marker`},
		{"missing route model", &model.LogicalModelRoute{}, "damaged-route", "channel_model_id", "missing-channel-model"},
		{"invalid channel capability", &model.ChannelModel{}, "damaged-cm", "capability_config_json", `not-json synthetic-private-marker`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db, actor := adminLogicalModelFixture(t)
			before, err := svc.AdminLogicalModels(actor)
			if err != nil || len(before) != 2 || !before[0].Available || !before[1].Available {
				t.Fatalf("fixture is not healthy before corruption: err=%v", err)
			}
			var original string
			if err := db.Model(tc.table).Select(tc.column).Where("id = ?", tc.id).Scan(&original).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(tc.table).Where("id = ?", tc.id).Update(tc.column, tc.invalid).Error; err != nil {
				t.Fatal(err)
			}
			items, err := svc.AdminLogicalModels(actor)
			if err != nil {
				t.Fatalf("one broken model must not hide healthy models: %v", err)
			}
			if len(items) != 2 || items[0].ID != "damaged" || items[1].ID != "healthy" {
				t.Fatal("both models must remain visible in their original order")
			}
			bad, good := items[0], items[1]
			if bad.Available || !bad.Enabled || bad.ConfigurationError == "" || bad.ActiveRevisionID != "damaged-revision" || bad.RevisionVersion != 1 || bad.Code != "damaged" || bad.Name != "damaged" || bad.Capability != "text" {
				t.Fatal("the broken entry must retain its identity and enabled state but be unavailable for repair")
			}
			if bad.Routes == nil || len(bad.Routes) != 0 || !good.Available || good.ConfigurationError != "" || len(good.Routes) != 1 {
				t.Fatal("broken route projections must be empty without affecting healthy entries")
			}
			encoded, err := json.Marshal(items)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(encoded), "synthetic-private-marker") {
				t.Fatal("raw corrupt configuration must not be included in the response")
			}
			var persisted model.LogicalModel
			if err := db.First(&persisted, "id = ?", "damaged").Error; err != nil {
				t.Fatal(err)
			}
			if !persisted.Enabled || persisted.ActiveRevisionID != "damaged-revision" {
				t.Fatal("listing must not mutate model availability settings or revision bindings")
			}
			if err := db.Model(tc.table).Where("id = ?", tc.id).Update(tc.column, original).Error; err != nil {
				t.Fatal(err)
			}
			repaired, err := svc.AdminLogicalModels(actor)
			if err != nil || len(repaired) != 2 || !repaired[0].Available || repaired[0].ConfigurationError != "" || len(repaired[0].Routes) != 1 {
				t.Fatalf("repair must restore the normal projection: err=%v", err)
			}
		})
	}
}

func TestAdminLogicalModelsStillRequiresAdministrator(t *testing.T) {
	// A missing repository makes accidental database access before the permission check fail.
	svc := &Service{}
	for _, actor := range []*model.User{nil, {ID: "ordinary-user", Role: model.UserRoleUser}} {
		items, err := svc.AdminLogicalModels(actor)
		if err == nil || items != nil {
			t.Fatal("unauthenticated and non-admin callers must not receive the administrator catalog")
		}
	}
}

func TestAdminLogicalModelsDoesNotHideDatabaseFailure(t *testing.T) {
	svc, db, actor := adminLogicalModelFixture(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
	items, err := svc.AdminLogicalModels(actor)
	if err == nil || items != nil {
		t.Fatal("a database failure must not be disguised as a successful partial catalog")
	}
}
