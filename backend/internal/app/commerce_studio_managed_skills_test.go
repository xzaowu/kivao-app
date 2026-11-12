package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/model"
)

func TestCommerceStudioManagedSkillSwitchPersistsAndControlsPromptAndKnowledge(t *testing.T) {
	svc, _ := knowledgeTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if _, err := svc.CommerceStudioManagedSkills(user); err == nil {
		t.Fatal("non-admin listed management catalog")
	}
	if err := svc.SetCommerceStudioManagedSkillEnabled(user, "ecom-fruit-preparation", false); err == nil {
		t.Fatal("non-admin changed policy")
	}
	items, err := svc.CommerceStudioManagedSkills(admin)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 61 {
		t.Fatal(len(items))
	}
	for _, item := range items {
		if !item.Enabled {
			t.Fatal("new skill not enabled by default")
		}
	}
	if _, err := svc.EnsureBuiltinCommerceStudioKnowledge(); err != nil {
		t.Fatal(err)
	}
	draft := CommerceStudioDraft{ProductName: "榨汁机", Category: "家电", Platform: "taobao", ImageType: "detail", Count: 9, ReferenceMode: "detail"}
	block, calls, err := svc.commerceStudioManagedSkillBlock(draft, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(block, "榨汁鲜果制作叙事") || len(calls) == 0 {
		t.Fatal("app did not route product skill")
	}
	if !strings.Contains(commerceStudioManagedImageRules(map[string]any{"ecommerceManagedSkills": calls}), "鲜果") {
		t.Fatal("image execution rules lost")
	}
	if err := svc.SetCommerceStudioManagedSkillEnabled(admin, "ecom-fruit-preparation", false); err != nil {
		t.Fatal(err)
	}
	policy, err := svc.commerceStudioManagedSkillPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if policy["ecom-fruit-preparation"] {
		t.Fatal("switch not persisted")
	}
	block, calls, err = svc.commerceStudioManagedSkillBlock(draft, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range calls {
		if call.ID == "ecom-fruit-preparation" {
			t.Fatal("disabled skill called")
		}
	}
	for _, entry := range commerceStudioManagedSkillKnowledge() {
		if strings.Contains(entry.ID, "ecom-fruit-preparation") && commerceStudioKnowledgeSkillEnabled(entry, policy, commerceStudioDraftKnowledgeRequest(draft)) {
			t.Fatal("disabled skill leaked through knowledge")
		}
	}
	items, err = svc.CommerceStudioManagedSkills(admin)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == "ecom-fruit-preparation" && item.Enabled {
			t.Fatal("management refresh reset switch")
		}
	}
	if err := svc.SetCommerceStudioManagedSkillEnabled(admin, "ecom-missing", true); err == nil {
		t.Fatal("unknown skill accepted")
	}
	if len(commerceStudioManagedSkillKnowledge()) != len(ecommerceskills.ManagedCatalog())*3 {
		t.Fatal("knowledge bundle incomplete")
	}
}
