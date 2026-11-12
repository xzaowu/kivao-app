package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCommerceStudioDetailReviewDistinguishesPlanSignalsFromImageReview(t *testing.T) {
	plan := model.CommerceStudioPlan{QualityChecks: []string{"原检查"}, Images: []model.CommerceStudioPlanTask{
		{Theme: "外观", Composition: "平视 大图"},
		{Theme: "外观", Composition: "平视   大图"},
		{Theme: "细节", Composition: "微距"},
	}}
	addCommerceStudioDetailReview(&plan)
	if len(plan.QualityChecks) != 5 || !strings.Contains(plan.QualityChecks[1], "第 1、2 张") || !strings.Contains(plan.QualityChecks[2], "人工核对") {
		t.Fatalf("unexpected checks: %v", plan.QualityChecks)
	}
	if plan.QualityChecks[0] != "原检查" || plan.Images[1].Composition != "平视   大图" {
		t.Fatal("review changed the plan")
	}
}

func TestCommerceStudioDetailReviewDoesNotTreatEmptyFieldsAsDuplicates(t *testing.T) {
	plan := model.CommerceStudioPlan{Images: []model.CommerceStudioPlanTask{{}, {}}}
	addCommerceStudioDetailReview(&plan)
	if len(plan.QualityChecks) != 3 {
		t.Fatalf("unexpected duplicate warning: %v", plan.QualityChecks)
	}
}
