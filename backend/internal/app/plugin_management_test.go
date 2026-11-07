package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestApplicationPluginsUseGlobalStateForEveryUser(t *testing.T) {
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
	svc := &Service{repo: repository.New(db), pluginRuntime: center}
	user := &model.User{ID: "user-1", Role: model.UserRoleUser}
	other := &model.User{ID: "user-2", Role: model.UserRoleUser}
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	for pluginID := range officialApplicationPolicies {
		t.Run(pluginID, func(t *testing.T) {
			for index, actor := range []*model.User{user, other} {
				if err := svc.repo.SaveUserPluginState(&model.UserPluginState{ID: newID(), UserID: actor.ID, PluginID: pluginID, Enabled: index == 0}); err != nil {
					t.Fatal(err)
				}
			}
			for _, available := range []bool{true, false} {
				if _, err := svc.SetPluginPlatformAvailability(admin, pluginID, available); err != nil {
					t.Fatal(err)
				}
				for _, actor := range []*model.User{user, other, admin} {
					states, err := svc.PluginStatesForUser(actor)
					if err != nil {
						t.Fatal(err)
					}
					state := states[pluginID]
					if state.EffectiveEnabled != available || state.PlatformAvailable != available || state.CanToggle || state.UserEnabled || state.UserConfigured {
						t.Fatalf("global state for %s = %#v", actor.ID, state)
					}
					if _, err := svc.SetUserPluginEnabled(actor, pluginID, !available); err == nil {
						t.Fatal("user activation endpoint bypassed global management")
					}
					if actor != admin {
						if _, err := svc.SetPluginPlatformAvailability(actor, pluginID, !available); err == nil {
							t.Fatal("ordinary user changed global availability")
						}
					}
				}
			}
		})
	}
	if err := svc.RequireWorkflowPluginForUser(user.ID, "runninghub-workflow-image"); err == nil {
		t.Fatal("platform-disabled workflow was accepted for a new user request")
	}
	if _, err := svc.SetPluginPlatformAvailability(admin, WorkflowPluginRunningHub, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.RequireWorkflowPluginForUser(user.ID, "runninghub-workflow-video"); err != nil {
		t.Fatalf("restored user workflow rejected: %v", err)
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

func TestArtCritiqueIsGloballyManagedApplication(t *testing.T) {
	policy := pluginManagement(PluginAIArtCritique, "bundled")
	if policy.Origin != PluginOriginOfficial || policy.Kind != PluginKindApplication || policy.ActivationScope != PluginScopeSystem || policy.ConfigurationScope != PluginConfigurationNone {
		t.Fatalf("AI art critique policy = %#v", policy)
	}
}

// Regression: editor-shell was missing from officialApplicationPolicies, so the
// backend classified it as a system protocol and reported it to the admin page
// as "管理员已停用该插件" even though nothing disabled it.
func TestEditorShellIsGloballyManagedApplication(t *testing.T) {
	policy := pluginManagement(PluginEditorShell, "bundled")
	if policy.Origin != PluginOriginOfficial || policy.Kind != PluginKindApplication || policy.ActivationScope != PluginScopeSystem || policy.ConfigurationScope != PluginConfigurationNone {
		t.Fatalf("editor shell policy = %#v", policy)
	}
}

func TestEditorShellWaitsForAdministratorWithoutPlatformState(t *testing.T) {
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
	svc := &Service{repo: repository.New(db), pluginRuntime: center}
	user := &model.User{ID: "user-1", Role: model.UserRoleUser}

	states, err := svc.PluginStatesForUser(user)
	if err != nil {
		t.Fatal(err)
	}
	state, ok := states[PluginEditorShell]
	if !ok {
		t.Fatalf("editor shell missing from plugin states: %#v", states)
	}
	if state.PlatformAvailable || state.CanToggle || state.EffectiveEnabled {
		t.Fatalf("editor shell should wait for global activation, got %#v", state)
	}
}
