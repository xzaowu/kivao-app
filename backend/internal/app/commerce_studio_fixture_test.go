package app

import (
	"gorm.io/gorm"
	"testing"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func creationTestServiceOnDatabase(t *testing.T, db *gorm.DB) (*Service, *gorm.DB, string, CreationGuard) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s := &Service{
		repo: repository.New(db), dataDir: t.TempDir(),
		disablePiRuntime: true, legacyCloudAgentRootTask: true,
	}
	t.Cleanup(func() {
		s.closeCloudAgentPiRunners()
		s.closeApprovedCloudAgentMediaWaiters()
		_ = sqlDB.Close()
	})
	capabilityConfig := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test"))
	for _, item := range []any{&model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}, &model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "受控测试"}, &model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: capabilityConfig, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}, &model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000}} {
		if err = db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	detail, err := s.CreateCreationRun("user", CreationRequest{ClientKey: "client", State: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	id := detail.Run.ID
	if _, err = s.ChangeCreationRun("user", id, "claim", CreationRequest{ExpectedEpoch: 0, CreationGuard: CreationGuard{Owner: "page"}}); err != nil {
		t.Fatal(err)
	}
	return s, db, id, CreationGuard{ExecutionEpoch: 1, Owner: "page"}
}
