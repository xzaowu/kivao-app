package app

import (
	"encoding/json"
	"math"
	"testing"

	"yingce/backend/internal/model"
)

func commerceStudioReferencePlan() *model.CommerceStudioPlan {
	images := make([]model.CommerceStudioPlanTask, 2)
	for index := range images {
		images[index] = model.CommerceStudioPlanTask{
			ID: []string{"screen-1", "screen-2"}[index], ImageType: "detail", Platform: "taobao", Language: "zh-CN",
			Goal: "逐屏重做", Theme: "真实商品", Composition: "参考信息层次", MainVisual: "用户商品", Fidelity: "真实外观",
			Prompt: "使用用户商品重新设计", ImageModel: "image-test", Ratio: "3:4", Resolution: "1k",
			ReferenceScreen: &model.CommerceStudioReferenceScreen{SourceResourceID: "long-reference", ScreenIndex: index + 1, Top: float64(index) / 2, Bottom: float64(index+1) / 2, Content: "场景主题", Layout: "标题位于上方，商品为主体", Visual: "浅色背景，侧向光", SourceCopy: "参考原文", ResourceID: []string{"crop-1", "crop-2"}[index]},
		}
	}
	return &model.CommerceStudioPlan{InputSignature: "reference-signature", ProductSummary: "真实商品", ReferenceSummary: "原详情长图共两屏，先主视觉后场景解释", VisualStrategy: "保留信息顺序，独立设计图像", Images: images}
}

func TestCommerceStudioDetailReferencePersistsSourceScreensAndOwnedCrops(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	for _, id := range []string{"long-reference", "crop-1", "crop-2"} {
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	project, err := svc.CreateCommerceStudioProject("user")
	if err != nil {
		t.Fatal(err)
	}
	draft := CommerceStudioDraft{ProductName: "耳机", Platform: "taobao", ImageType: "detail", Count: 2, ReferenceMode: "detail", LayoutReferenceID: "long-reference", References: []CommerceStudioReference{{ResourceID: "long-reference", Role: "primary", Name: "商品详情长图", Width: 750, Height: 2000}}}
	plan := commerceStudioReferencePlan()
	plan.Images[0].ManualPrompt = true
	saved, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft, Plan: plan})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.CommerceStudioProject("user", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	var restoredDraft CommerceStudioDraft
	var restoredPlan model.CommerceStudioPlan
	if err := json.Unmarshal([]byte(loaded.DraftJSON), &restoredDraft); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(loaded.PlanJSON), &restoredPlan); err != nil {
		t.Fatal(err)
	}
	if restoredDraft.ReferenceMode != "detail" || restoredDraft.LayoutReferenceID != "long-reference" || restoredDraft.References[0].Width != 750 || restoredDraft.References[0].Height != 2000 || restoredDraft.References[0].Name != "商品详情长图" {
		t.Fatalf("source metadata lost: %#v", restoredDraft)
	}
	if restoredPlan.ReferenceSummary != plan.ReferenceSummary || *restoredPlan.Images[1].ReferenceScreen != *plan.Images[1].ReferenceScreen || !restoredPlan.Images[0].ManualPrompt {
		t.Fatalf("screen contract or manual edit lost: %#v", restoredPlan)
	}
	// Reference-only uploads and crops are protected before image tasks exist.
	for _, id := range []string{"long-reference", "crop-1", "crop-2"} {
		resource, err := svc.repo.ResourceForUser("user", id)
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.ensureResourceHasNoBusinessReferences(resource); err == nil {
			t.Fatalf("saved commerce reference %s was not protected: %v", id, err)
		}
		snapshot, err := svc.repo.ResourceReferenceSnapshot("user", "", []string{id})
		if err != nil {
			t.Fatal(err)
		}
		usages := adminResourceReferences(snapshot, []model.Resource{*resource})
		if len(usages[id]) != 1 || usages[id][0].Kind != "电商 Agent" || usages[id][0].ID != project.ID {
			t.Fatalf("missing exact commerce usage for %s: %#v", id, usages)
		}
	}
	// Actual inferred screen count can change after planning, while persisted draft and plan agree.
	draft.Count = 1
	plan.Images = plan.Images[:1]
	plan.Images[0].ReferenceScreen.Bottom = 1
	if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: saved.Revision, Draft: draft, Plan: plan}); err != nil {
		t.Fatalf("actual one-screen plan rejected: %v", err)
	}
}

func TestCommerceStudioDetailReferenceRejectsInvalidOrForeignScreens(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	for _, resource := range []model.Resource{
		{ID: "long-reference", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "crop-1", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "crop-2", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "foreign-crop", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "wrong-kind", UserID: "user", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "not-ready", UserID: "user", Kind: "image", Status: model.ResourceStatusPending},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	base := CommerceStudioDraft{Platform: "taobao", ImageType: "detail", Count: 2, ReferenceMode: "detail", LayoutReferenceID: "long-reference", References: []CommerceStudioReference{{ResourceID: "long-reference", Role: "primary"}}}
	tests := []struct {
		name   string
		mutate func(*CommerceStudioDraft, *model.CommerceStudioPlan)
	}{
		{"invalid mode", func(d *CommerceStudioDraft, _ *model.CommerceStudioPlan) { d.ReferenceMode = "copy-anything" }},
		{"missing source", func(d *CommerceStudioDraft, _ *model.CommerceStudioPlan) { d.LayoutReferenceID = "missing" }},
		{"unselected source", func(d *CommerceStudioDraft, _ *model.CommerceStudioPlan) { d.LayoutReferenceID = "" }},
		{"missing screen", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[0].ReferenceScreen = nil }},
		{"foreign source", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) {
			p.Images[0].ReferenceScreen.SourceResourceID = "foreign-crop"
		}},
		{"wrong order", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[0].ReferenceScreen.ScreenIndex = 2 }},
		{"empty analysis", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[1].ReferenceScreen.Layout = " " }},
		{"negative top", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[0].ReferenceScreen.Top = -.1 }},
		{"bottom overflow", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[1].ReferenceScreen.Bottom = 1.1 }},
		{"empty range", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[1].ReferenceScreen.Top = 1 }},
		{"missing head", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[0].ReferenceScreen.Top = .1 }},
		{"missing tail", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[1].ReferenceScreen.Bottom = .9 }},
		{"gap", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[1].ReferenceScreen.Top = .7 }},
		{"overlap", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) { p.Images[1].ReferenceScreen.Top = .3 }},
		{"nan", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) {
			p.Images[0].ReferenceScreen.Top = math.NaN()
		}},
		{"infinity", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) {
			p.Images[0].ReferenceScreen.Bottom = math.Inf(1)
		}},
		{"foreign crop", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) {
			p.Images[1].ReferenceScreen.ResourceID = "foreign-crop"
		}},
		{"missing crop", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) {
			p.Images[1].ReferenceScreen.ResourceID = "missing"
		}},
		{"video crop", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) {
			p.Images[1].ReferenceScreen.ResourceID = "wrong-kind"
		}},
		{"unready crop", func(_ *CommerceStudioDraft, p *model.CommerceStudioPlan) {
			p.Images[1].ReferenceScreen.ResourceID = "not-ready"
		}},
		{"count mismatch", func(d *CommerceStudioDraft, _ *model.CommerceStudioPlan) { d.Count = 3 }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project, err := svc.CreateCommerceStudioProject("user")
			if err != nil {
				t.Fatal(err)
			}
			draft, plan := base, commerceStudioReferencePlan()
			tt.mutate(&draft, plan)
			if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft, Plan: plan}); err == nil {
				t.Fatal("invalid detail reference accepted")
			}
		})
	}
	plan := commerceStudioReferencePlan()
	plan.Images[0].ReferenceScreen.ResourceID = ""
	plan.Images[1].ReferenceScreen.ResourceID = ""
	plan.Images[0].ReferenceScreen.Top = .005
	plan.Images[1].ReferenceScreen.Top = .505
	plan.Images[1].ReferenceScreen.Bottom = .995
	if err := svc.validateCommerceStudioReferencePlan("user", base, plan); err != nil {
		t.Fatalf("small inference rounding or pre-crop plan rejected: %v", err)
	}
}

func TestCommerceStudioReferenceDraftAndStylePlanRemainEditable(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	if err := db.Create(&model.Resource{ID: "style-source", UserID: "user", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"", "product", "style", "detail"} {
		project, err := svc.CreateCommerceStudioProject("user")
		if err != nil {
			t.Fatal(err)
		}
		draft := CommerceStudioDraft{Platform: "taobao", ImageType: "detail", Count: 2, ReferenceMode: mode}
		if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft}); err != nil {
			t.Fatalf("unfinished %q draft rejected: %v", mode, err)
		}
		if mode == "detail" {
			continue
		}
		if mode == "style" {
			draft.LayoutReferenceID = "style-source"
			draft.References = []CommerceStudioReference{{ResourceID: "style-source", Role: "style"}}
		}
		plan := commerceStudioReferencePlan()
		for index := range plan.Images {
			plan.Images[index].ReferenceScreen = nil
		}
		if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision + 1, Draft: draft, Plan: plan}); err != nil {
			t.Fatalf("%q plan without detail screens rejected: %v", mode, err)
		}
	}
	if !documentReferencesResources(`{"layoutReferenceId":"source","images":[{"referenceScreen":{"sourceResourceId":"source","resourceId":"crop"}}]}`, map[string]struct{}{"source": {}, "crop": {}}) {
		t.Fatal("reference fields missing from deletion protection schema")
	}
}

func TestCommerceStudioInactiveReferencePreferenceCanBeRemovedWithoutTrustingForeignIDs(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	for _, resource := range []model.Resource{
		{ID: "removed-style", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "foreign-style", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, mode := range []string{"", "product"} {
		project, err := svc.CreateCommerceStudioProject("user")
		if err != nil {
			t.Fatal(err)
		}
		draft := CommerceStudioDraft{Platform: "taobao", ImageType: "main", Count: 1, ReferenceMode: mode, LayoutReferenceID: "removed-style"}
		saved, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: project.Revision, Draft: draft})
		if err != nil {
			t.Fatalf("inactive removed source blocked draft: %v", err)
		}
		var restored CommerceStudioDraft
		if err := json.Unmarshal([]byte(saved.DraftJSON), &restored); err != nil {
			t.Fatal(err)
		}
		if restored.LayoutReferenceID != "" {
			t.Fatal("inactive dangling reference retained")
		}
		draft.LayoutReferenceID = "foreign-style"
		if _, err := svc.SaveCommerceStudioProject("user", project.ID, SaveCommerceStudioProjectRequest{Revision: saved.Revision, Draft: draft}); err == nil {
			t.Fatal("inactive foreign source accepted")
		}
	}
	for _, mode := range []string{"style", "detail"} {
		for _, role := range []string{"model", "logo"} {
			draft := CommerceStudioDraft{ReferenceMode: mode, LayoutReferenceID: "removed-style", References: []CommerceStudioReference{{ResourceID: "removed-style", Role: role}}}
			if err := svc.validateCommerceStudioReferenceDraft("user", &draft, true); err == nil {
				t.Fatalf("%s source %s accepted", mode, role)
			}
		}
		draft := CommerceStudioDraft{ReferenceMode: mode}
		if err := svc.validateCommerceStudioReferenceDraft("user", &draft, false); err != nil {
			t.Fatalf("unfinished active draft rejected: %v", err)
		}
		if err := svc.validateCommerceStudioReferenceDraft("user", &draft, true); err == nil {
			t.Fatalf("%s plan missing source accepted", mode)
		}
	}
}
