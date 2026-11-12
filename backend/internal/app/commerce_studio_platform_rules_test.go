package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCommerceStudioPlatformRulesValidateBeforeNewImageTasks(t *testing.T) {
	svc := &Service{}
	page := commerceStudioWorkbenchTestPage("image-1", "secondary", "", "", "Soft everyday style")
	page.Platform, page.Language = "shein", "en"
	plan := model.CommerceStudioPlan{ProductSummary: "真实商品", VisualStrategy: "目录摄影", Images: []model.CommerceStudioPlanTask{page}}
	if err := svc.validateCommerceStudioPlan("user", &plan); err != nil {
		t.Fatal(err)
	}
	plan.Images[0].Copy = "Ｂｅｓｔ　Ｓｅｌｌｅｒ"
	if err := svc.validateCommerceStudioPlan("user", &plan); err == nil || !strings.Contains(err.Error(), "高风险") {
		t.Fatalf("unchecked marketing copy: %v", err)
	}
	plan.Images[0].Copy = "Everyday style"
	plan.Images[0].Platform = "ebay"
	if err := svc.validateCommerceStudioPlan("user", &plan); err == nil || !strings.Contains(err.Error(), "无新增文字") {
		t.Fatalf("eBay secondary text accepted: %v", err)
	}
	plan.Images[0].Copy = ""
	if err := svc.validateCommerceStudioPlan("user", &plan); err != nil {
		t.Fatal(err)
	}
}
