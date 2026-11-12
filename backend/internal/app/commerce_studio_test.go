package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCommerceStudioSkillPromptUsesInstalledUserSkill(t *testing.T) {
	svc, _, _, _ := commerceStudioCreationTestService(t)
	skill, err := svc.CreateSkill("user", SkillMutationRequest{SkillName: "电商构图", Description: "主图方法", Instruction: "# 电商构图\n每张图使用不同视角。", Tag: "others", IsPrivate: true})
	if err != nil {
		t.Fatal(err)
	}
	prompt, err := svc.CommerceStudioSkillPrompt("user", []string{skill.SkillID})
	if err != nil || !strings.Contains(prompt, "每张图使用不同视角") {
		t.Fatalf("selected skill was not loaded: %q %v", prompt, err)
	}
	if _, err := svc.CommerceStudioSkillPrompt("other", []string{skill.SkillID}); err == nil {
		t.Fatal("another user read a private skill")
	}
	if _, err := svc.CommerceStudioSkillPrompt("user", []string{skill.SkillID, skill.SkillID}); err == nil {
		t.Fatal("duplicate skill accepted")
	}
	if prompt, err := svc.CommerceStudioSkillPrompt("user", nil); err != nil || prompt != "" {
		t.Fatalf("empty selection changed planner: %q %v", prompt, err)
	}
}

func TestCommerceStudioSkillPromptReadsNewlyInstalledPublicSkill(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	skill, err := svc.CreateSkill("creator", SkillMutationRequest{
		SkillName: "电商详情图", Description: "商品细节呈现", Instruction: "# 电商详情图\n先展示商品整体，再用特写解释已确认的卖点。", Tag: "others", IsPrivate: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CommerceStudioSkillPrompt("buyer", []string{skill.SkillID}); err == nil {
		t.Fatal("public skill was usable before installation")
	}
	admin := &model.User{ID: "reviewer", Username: "reviewer", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetSkillAdded("buyer", skill.SkillID, true); err == nil {
		t.Fatal("unreviewed public skill installed")
	}
	if err := svc.ReviewSkill(admin, skill.SkillID, skill.VersionID, skill.UpdatedAt, "approve", "commerce-review"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetSkillAdded("buyer", skill.SkillID, true); err != nil {
		t.Fatal(err)
	}
	prompt, err := svc.CommerceStudioSkillPrompt("buyer", []string{skill.SkillID})
	if err != nil || !strings.Contains(prompt, "先展示商品整体，再用特写解释已确认的卖点") {
		t.Fatalf("newly installed skill was not read for planning: %q %v", prompt, err)
	}
	if _, err := svc.SetSkillAdded("buyer", skill.SkillID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CommerceStudioSkillPrompt("buyer", []string{skill.SkillID}); err == nil {
		t.Fatal("removed skill remained usable for planning")
	}
}

func TestCommerceStudioProjectsEnforceOwnerRevisionAndResourceOwnership(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	project, err := svc.CreateCommerceStudioProject("user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.CommerceStudioProject("other", project.ID); err == nil {
		t.Fatal("other user read the project")
	}
	others, err := svc.CommerceStudioProjects("other")
	if err != nil || len(others) != 0 {
		t.Fatalf("other user listed projects: %v, %v", others, err)
	}

	draft := CommerceStudioDraft{ProductName: "测试商品", Platform: "taobao", ImageType: "main", Count: 2, TypeOptions: map[string]string{"background": "简洁棚拍"}, CloneOptions: map[string]string{"copyMode": "none", "ratioMode": "selected"}}
	updated, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft})
	if err != nil || updated.Revision != project.Revision+1 {
		t.Fatalf("save failed: %v, %#v", err, updated)
	}
	var persisted CommerceStudioDraft
	if err := json.Unmarshal([]byte(updated.DraftJSON), &persisted); err != nil || persisted.TypeOptions["background"] != "简洁棚拍" || persisted.CloneOptions["copyMode"] != "none" {
		t.Fatalf("creation parameters were not persisted: %v, %#v", err, persisted)
	}
	if _, err = svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft}); err == nil {
		t.Fatal("stale revision accepted")
	}
	if _, err = svc.SaveCommerceStudioProject("other", project.ID, SaveCommerceStudioProjectRequest{Revision: updated.Revision, Draft: draft}); err == nil {
		t.Fatal("other user updated the project")
	}

	resource := model.Resource{ID: "foreign-image", UserID: "other", Kind: "image", Status: model.ResourceStatusReady}
	if err = db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	draft.References = []CommerceStudioReference{{ResourceID: resource.ID, Role: "primary"}}
	if _, err = svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: updated.Revision, Draft: draft}); err == nil {
		t.Fatal("foreign image accepted")
	}
}

func TestCommerceStudioDirectionsReceiptUsesMetadataWithNormalizedProviderConfig(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	project, err := svc.CreateCommerceStudioProject("user")
	if err != nil {
		t.Fatal(err)
	}
	draft := CommerceStudioDraft{ProductName: "耳机", Platform: "taobao", ImageType: "detail", Count: 9}
	raw, _ := json.Marshal(draft)
	if err := db.Model(project).Update("draft_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	// Catalogue resolution persists numeric and boolean values in provider config.
	input, _ := json.Marshal(map[string]any{
		"config":   map[string]any{"count": 1, "videoSeconds": 5, "videoWatermark": false, "videoGenerateAudio": true},
		"metadata": map[string]any{"source": "ecommerce-agent", "stage": "creative-directions", "ecommerceProjectId": project.ID, "ecommerceDraft": draft},
	})
	task := model.Task{ID: "normalized-directions", UserID: "user", Type: "canvas_text", Status: model.TaskStatusSucceeded, InputJSON: string(input)}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	restored, err := svc.CommerceStudioProject("user", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var recovered CommerceStudioDraft
	if err := json.Unmarshal([]byte(restored.DraftJSON), &recovered); err != nil || recovered.DirectionsTaskID != task.ID {
		t.Fatalf("normalized config prevented receipt recovery: %v, %+v", err, recovered)
	}
	draft.DirectionsTaskID = task.ID
	saved, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft})
	if err != nil {
		t.Fatalf("owned directions rejected after provider normalization: %v", err)
	}
	for _, tc := range []struct{ name, owner, taskType, input string }{
		{"foreign owner", "other", "canvas_text", string(input)},
		{"wrong task type", "user", "canvas_image", string(input)},
		{"wrong project", "user", "canvas_text", `{"metadata":{"stage":"creative-directions","ecommerceProjectId":"another-project"}}`},
		{"wrong stage", "user", "canvas_text", `{"metadata":{"stage":"planning","ecommerceProjectId":"` + project.ID + `"}}`},
		{"invalid JSON", "user", "canvas_text", `{`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"user_id": tc.owner, "type": tc.taskType, "input_json": tc.input}).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: saved.Revision, Draft: draft}); err == nil {
				t.Fatal("invalid receipt accepted")
			}
		})
	}
}

func TestCommerceStudioProjectPageCountsAndScopesProjects(t *testing.T) {
	svc, _, _, _ := commerceStudioCreationTestService(t)
	for index := 0; index < 23; index++ {
		if _, err := svc.CreateCommerceStudioProject("user"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.CreateCommerceStudioProject("other"); err != nil {
		t.Fatal(err)
	}
	first, total, err := svc.CommerceStudioProjectPage("user", 1, 20)
	if err != nil || total != 23 || len(first) != 20 {
		t.Fatalf("first page: total=%d items=%d err=%v", total, len(first), err)
	}
	second, total, err := svc.CommerceStudioProjectPage("user", 2, 20)
	if err != nil || total != 23 || len(second) != 3 {
		t.Fatalf("second page: total=%d items=%d err=%v", total, len(second), err)
	}
	seen := make(map[string]bool)
	for _, project := range append(first, second...) {
		if project.UserID != "user" || seen[project.ID] {
			t.Fatalf("page leaked or repeated project %s", project.ID)
		}
		seen[project.ID] = true
	}
	all, total, err := svc.CommerceStudioProjectPage("user", 1, 50)
	if err != nil || total != 23 || len(all) != 23 {
		t.Fatalf("50 item page: total=%d items=%d err=%v", total, len(all), err)
	}
}

func TestCommerceStudioProjectDeletionIsScopedAtomicAndCoversAllPages(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	ids := make([]string, 0, 105)
	for range 105 {
		project, err := svc.CreateCommerceStudioProject("user")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, project.ID)
	}
	foreign, err := svc.CreateCommerceStudioProject("other")
	if err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "shared-independent-image", UserID: "user", Kind: "image", Status: model.ResourceStatusReady}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	one := int64(1)
	if _, err := svc.DeleteCommerceStudioProjects("user", DeleteCommerceStudioProjectsRequest{IDs: []string{foreign.ID}, ExpectedTotal: &one}); err == nil {
		t.Fatal("foreign project deletion succeeded")
	}
	if _, err := svc.DeleteCommerceStudioProjects("user", DeleteCommerceStudioProjectsRequest{IDs: []string{ids[0], foreign.ID}, ExpectedTotal: ptrInt64(2)}); err == nil {
		t.Fatal("mixed-owner deletion was not atomic")
	}
	if _, err := svc.CommerceStudioProject("user", ids[0]); err != nil {
		t.Fatalf("owned project disappeared after failed batch: %v", err)
	}
	if _, err := svc.DeleteCommerceStudioProjects("user", DeleteCommerceStudioProjectsRequest{IDs: []string{ids[0], ids[0]}, ExpectedTotal: ptrInt64(2)}); err == nil {
		t.Fatal("duplicate project IDs accepted")
	}
	if deleted, err := svc.DeleteCommerceStudioProjects("user", DeleteCommerceStudioProjectsRequest{IDs: ids[:2], ExpectedTotal: ptrInt64(2)}); err != nil || deleted != 2 {
		t.Fatalf("selected deletion: deleted=%d err=%v", deleted, err)
	}
	if _, err := svc.DeleteCommerceStudioProjects("user", DeleteCommerceStudioProjectsRequest{All: true, ExpectedTotal: ptrInt64(105)}); err == nil {
		t.Fatal("stale all-project count accepted")
	}
	if _, err := svc.CommerceStudioProject("user", ids[2]); err != nil {
		t.Fatalf("stale delete removed a project: %v", err)
	}
	if deleted, err := svc.DeleteCommerceStudioProjects("user", DeleteCommerceStudioProjectsRequest{All: true, ExpectedTotal: ptrInt64(103)}); err != nil || deleted != 103 {
		t.Fatalf("all-pages deletion: deleted=%d err=%v", deleted, err)
	}
	if _, total, err := svc.CommerceStudioProjectPage("user", 1, 20); err != nil || total != 0 {
		t.Fatalf("owned projects remain: total=%d err=%v", total, err)
	}
	if _, err := svc.CommerceStudioProject("other", foreign.ID); err != nil {
		t.Fatalf("foreign project was deleted: %v", err)
	}
	var remaining model.Resource
	if err := db.First(&remaining, "id = ?", resource.ID).Error; err != nil {
		t.Fatalf("independent image was deleted: %v", err)
	}
}

func ptrInt64(value int64) *int64 { return &value }
func TestCommerceStudioProjectModelReferenceMustBelongToUserAndPrimarySelection(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	project, err := svc.CreateCommerceStudioProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, resource := range []model.Resource{
		{ID: "owned-model", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "other-model", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	draft := CommerceStudioDraft{ProductName: "女装", Platform: "taobao", ImageType: "main", Count: 1, ModelEnabled: true, PrimaryModelResourceID: "owned-model", References: []CommerceStudioReference{{ResourceID: "owned-model", Role: "model", CatalogID: "cn-woman"}}}
	if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft}); err != nil {
		t.Fatalf("valid model reference rejected: %v", err)
	}
	draft.PrimaryModelResourceID = "other-model"
	if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision + 1, Draft: draft}); err == nil {
		t.Fatal("unselected primary model accepted")
	}
	draft.References = []CommerceStudioReference{{ResourceID: "other-model", Role: "model"}}
	if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision + 1, Draft: draft}); err == nil {
		t.Fatal("foreign model reference accepted")
	}
}

func TestCommerceStudioProjectReportsPartialGenerationWithoutForgingResults(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	project, err := svc.CreateCommerceStudioProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range []model.Task{
		{ID: "ecommerce-success", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded},
		{ID: "ecommerce-failed", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	image := func(id, taskID string) model.CommerceStudioPlanTask {
		return model.CommerceStudioPlanTask{ID: id, TaskID: taskID, ImageType: "main", Platform: "taobao", Language: "zh-CN", Goal: "展示商品", Theme: "主图", Composition: "居中", MainVisual: "真实商品", Fidelity: "保真", Prompt: "商品摄影", ImageModel: "image-test", Ratio: "1:1", Resolution: "1k"}
	}
	manual := image("one", "ecommerce-success")
	manual.ManualPrompt = true
	plan := &model.CommerceStudioPlan{InputSignature: "submitted-parameter-snapshot", ProductSummary: "真实商品", VisualStrategy: "统一视觉", Images: []model.CommerceStudioPlanTask{manual, image("two", "ecommerce-failed")}}
	draft := CommerceStudioDraft{ProductName: "测试商品", Platform: "taobao", ImageType: "main", Count: 2}
	saved, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft, Plan: plan})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Status != "partial_success" {
		t.Fatalf("want partial_success, got %q", saved.Status)
	}
	var persisted model.CommerceStudioPlan
	if err := json.Unmarshal([]byte(saved.PlanJSON), &persisted); err != nil || persisted.InputSignature != plan.InputSignature {
		t.Fatalf("plan lost its parameter binding: %v, %#v", err, persisted)
	}
	if !persisted.Images[0].ManualPrompt {
		t.Fatal("manual prompt priority was lost while saving the project")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "ecommerce-failed").Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.CommerceStudioProject("user", project.ID)
	if err != nil || loaded.Status != "completed" {
		t.Fatalf("want completed after task recovery, got %#v, %v", loaded, err)
	}
}
