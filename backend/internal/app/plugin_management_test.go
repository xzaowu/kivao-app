package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newPluginManagementTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.PluginPlatformState{}, &model.UserPluginState{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), pluginRuntime: center}, db
}

func TestApplicationPluginUsesAdministratorStateForAllUsers(t *testing.T) {
	svc, db := newPluginManagementTestService(t)
	user := &model.User{ID: "user-1", Role: model.UserRoleUser}
	other := &model.User{ID: "user-2", Role: model.UserRoleUser}
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	for _, state := range []model.UserPluginState{
		{ID: "old-on", UserID: user.ID, PluginID: WorkflowPluginRunningHub, Enabled: true},
		{ID: "old-off", UserID: other.ID, PluginID: WorkflowPluginRunningHub, Enabled: false},
	} {
		if err := db.Create(&state).Error; err != nil {
			t.Fatal(err)
		}
	}

	states, err := svc.PluginStatesForUser(user)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := states["editor-shell"]; exists {
		t.Fatal("retired manual editor is still offered as an application")
	}
	initial := states[WorkflowPluginRunningHub]
	if initial.PlatformAvailable || initial.UserEnabled || initial.EffectiveEnabled || initial.CanToggle {
		t.Fatalf("initial RunningHub state = %#v", initial)
	}
	if _, err := svc.SetUserPluginEnabled(user, WorkflowPluginRunningHub, true); err == nil {
		t.Fatal("ordinary user changed plugin activation")
	}
	if _, err := svc.SetPluginPlatformAvailability(user, WorkflowPluginRunningHub, false); err == nil {
		t.Fatal("ordinary user changed platform plugin availability")
	}
	disabled, err := svc.SetPluginPlatformAvailability(admin, WorkflowPluginRunningHub, false)
	if err != nil {
		t.Fatal(err)
	}
	if disabled.PlatformAvailable || disabled.EffectiveEnabled {
		t.Fatalf("platform-disabled RunningHub state = %#v", disabled)
	}
	if err := svc.RequireWorkflowPluginForUser(user.ID, "runninghub-workflow-image"); err == nil {
		t.Fatal("platform-disabled workflow was accepted for a new user request")
	}
	if _, err := svc.SetPluginPlatformAvailability(admin, WorkflowPluginRunningHub, true); err != nil {
		t.Fatal(err)
	}
	for _, actor := range []*model.User{user, other, admin} {
		states, err := svc.PluginStatesForUser(actor)
		if err != nil {
			t.Fatal(err)
		}
		if !states[WorkflowPluginRunningHub].EffectiveEnabled || states[WorkflowPluginRunningHub].CanToggle {
			t.Fatalf("administrator-enabled workflow state = %#v", states[WorkflowPluginRunningHub])
		}
		if err := svc.RequireWorkflowPluginForUser(actor.ID, "runninghub-workflow-video"); err != nil {
			t.Fatalf("administrator-enabled workflow rejected: %v", err)
		}
	}
	if _, err := svc.SetPluginPlatformAvailability(admin, WorkflowPluginRunningHub, false); err != nil {
		t.Fatal(err)
	}
	for _, actor := range []*model.User{user, other} {
		if err := svc.RequireWorkflowPluginForUser(actor.ID, "runninghub-workflow-video"); err == nil {
			t.Fatal("administrator-disabled workflow was accepted")
		}
	}
	var count int64
	if err := db.Model(&model.UserPluginState{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatal("historical user choices must be preserved without new activation writes")
	}
}

func TestAdministratorControlsFrontendOnlyApplication(t *testing.T) {
	svc, _ := newPluginManagementTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, enabled := range []bool{true, false} {
		state, err := svc.SetPluginPlatformAvailability(admin, PluginAIArtCritique, enabled)
		if err != nil {
			t.Fatal(err)
		}
		if state.EffectiveEnabled != enabled || state.PlatformAvailable != enabled || state.CanToggle {
			t.Fatalf("frontend application state = %#v", state)
		}
	}
}

func TestUploadedManifestCannotClaimUserActivationScope(t *testing.T) {
	policy := pluginManagement(PluginPromptOptimizer, PluginOriginUploaded)
	if policy.Origin != PluginOriginUploaded || policy.ActivationScope != PluginScopeSystem || policy.ConfigurationScope != PluginConfigurationSystem {
		t.Fatalf("uploaded plugin policy = %#v", policy)
	}
}

func TestPaymentContributionInfersPaymentManagementKind(t *testing.T) {
	plugin := PluginView{
		Source: PluginOriginOfficial,
		Manifest: PluginManifestView{
			ID: "official-payment-xunhupay",
			Contributes: protocol.ManifestContributions{PaymentProviders: []protocol.ManifestPaymentProvider{{
				ID: "xunhupay-aggregate", Label: "虎皮椒聚合支付", Icon: "assets/icon.svg", CheckoutMode: "qr_code",
			}}},
		},
	}
	policy := pluginManagementFromView(plugin)
	if policy.Kind != PluginKindPayment || policy.Origin != PluginOriginOfficial || policy.ActivationScope != PluginScopeSystem {
		t.Fatalf("inferred payment policy = %#v", policy)
	}
}

func TestArtCritiqueIsAdministratorControlledApplication(t *testing.T) {
	policy := pluginManagement(PluginAIArtCritique, "bundled")
	if policy.Origin != PluginOriginOfficial || policy.Kind != PluginKindApplication || policy.ActivationScope != PluginScopeSystem || policy.ConfigurationScope != PluginConfigurationNone {
		t.Fatalf("AI art critique policy = %#v", policy)
	}
}
