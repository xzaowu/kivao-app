package ecommerce

import (
	"encoding/json"
	"strings"
	"testing"
)

func directionsJSON() string {
	value := Directions{ProductSummary: "红色包装商品", ConfirmedFacts: []string{"可见红色包装"}, UncertainFacts: []string{"材质未确认"}}
	for i, id := range []string{"direction-1", "direction-2", "direction-3", "direction-4"} {
		value.Directions = append(value.Directions, Direction{ID: id, Name: []string{"自然窗光", "干净棚拍", "日常桌面", "局部特写"}[i], Description: "完整保留商品外观和 Logo"})
	}
	raw, _ := json.Marshal(value)
	return string(raw)
}

func TestDraftRejectsMissingPrimaryDuplicatesAndLimits(t *testing.T) {
	d := Draft{ProductName: "口红", Platform: "小红书", Language: "中文", ImageType: "main", Count: 2, References: []Reference{{"original", "primary"}}}
	if err := ValidateDraft(d); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Draft){func(d *Draft) { d.Count = 9 }, func(d *Draft) { d.References = []Reference{{"original", "style"}} }, func(d *Draft) { d.References = append(d.References, d.References[0]) }, func(d *Draft) { d.Description = strings.Repeat("字", 4001) }} {
		copy := d
		change(&copy)
		if ValidateDraft(copy) == nil {
			t.Fatal("invalid draft admitted")
		}
	}
}

func TestDirectionsRequireFourBoundedCompleteEntries(t *testing.T) {
	raw := directionsJSON()
	if _, err := ParseDirections(raw); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"```json\n" + raw + "\n```", raw + "{}", strings.Replace(raw, "direction-4", "direction-1", 1), strings.Replace(raw, `"productSummary":`, `"unknown":true,"productSummary":`, 1), strings.Repeat("x", 97<<10)} {
		if _, err := ParseDirections(invalid); err == nil {
			t.Fatal("invalid directions accepted")
		}
	}
}

func TestPlanRejectsWrongCountAndInjectedTaskIdentity(t *testing.T) {
	p := Plan{Summary: "同一商品的两张协调图片", Images: []Image{{ID: "image-1", Title: "商品全貌", Prompt: "自然窗光下完整展示真实商品"}, {ID: "image-2", Title: "细节", Prompt: "微距展示可见包装纹理"}}}
	raw, _ := json.Marshal(p)
	if _, err := ParsePlan(string(raw), 2); err != nil {
		t.Fatal(err)
	}
	if _, err := ParsePlan(string(raw), 3); err == nil {
		t.Fatal("wrong output count accepted")
	}
	p.Images[0].TaskID = "unowned-task"
	raw, _ = json.Marshal(p)
	if _, err := ParsePlan(string(raw), 2); err == nil {
		t.Fatal("model supplied task identity accepted")
	}
}

func TestPromptPreservesEvidenceRolesAndDoesNotRequestExtraQualityCall(t *testing.T) {
	d := Draft{ProductName: "商品", Platform: "淘宝", Language: "中文", ImageType: "detail", Count: 2, References: []Reference{{"one", "primary"}, {"two", "style"}}}
	for _, stage := range []string{"vision", "planning"} {
		p := Prompt(stage, d, nil, nil)
		for _, required := range []string{"不得编造", "风格图不提供商品事实", "Logo", `"role":"primary"`, `"role":"style"`} {
			if !strings.Contains(p, required) {
				t.Fatal("missing evidence boundary", required)
			}
		}
	}
}
