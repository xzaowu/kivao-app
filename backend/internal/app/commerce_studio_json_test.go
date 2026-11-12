package app

import (
	"testing"

	"yingce/backend/internal/ecommerceagent"
)

// Shapes seen from fast vision models: string numbers, list fields as one
// sentence, renamed lists, wrapper objects, trailing commas and fences.
func TestCommerceStudioParseJSONToleratesModelDrift(t *testing.T) {
	raw := "```json\n" + `{"brief":{"category":"婴儿奶瓶","confidence":"0.9","structure":"瓶身、奶嘴、旋盖","colorway":["透明","米色"],"visualRisks":"无",},
"directions":[{"label":"晨光","style":"窗边晨光","why":"温和","pages":"9","needText":"true","previewPrompt":"x","visualSystem":{"palette":"米白 #F3EEE6、原木 #C9A27E","typography":["细黑体"],"layout":"留白"}}],}` + "\n```"
	var analysis ecommerceagent.Analysis
	if err := commerceStudioParseJSON(raw, &analysis); err != nil {
		t.Fatal(err)
	}
	brief := analysis.Brief
	if brief.Category != "婴儿奶瓶" || brief.Confidence != 0.9 || len(brief.Structure) != 3 || len(brief.VisualRisks) != 1 {
		t.Fatalf("brief = %#v", brief)
	}
	if len(analysis.Recommendations) != 1 {
		t.Fatalf("renamed directions list was not adopted: %#v", analysis.Recommendations)
	}
	rec := analysis.Recommendations[0]
	if rec.Pages != 9 || !rec.NeedText || rec.VisualSystem == nil || len(rec.VisualSystem.Palette) != 2 || rec.VisualSystem.Typography != "细黑体" {
		t.Fatalf("recommendation = %#v %#v", rec, rec.VisualSystem)
	}
}

func TestCommerceStudioParseJSONUnwrapsArray(t *testing.T) {
	var recs []ecommerceagent.Recommendation
	if err := commerceStudioParseJSON(`{"recommendations":[{"label":"a"},{"label":"b"}]}`, &recs); err != nil || len(recs) != 2 {
		t.Fatalf("wrapped array = %#v, %v", recs, err)
	}
	if err := commerceStudioParseJSON(`这不是 JSON`, &recs); err == nil {
		t.Fatal("non-JSON text was accepted")
	}
}

func TestCommerceStudioParseJSONRepairsSyntaxWithoutChangingText(t *testing.T) {
	raw := "{\"text\":\"preserve ,} and ,] with \\\"quotes\\\"\nsecond line\",\"items\":[1,],}"
	var value struct {
		Text  string `json:"text"`
		Items []int  `json:"items"`
	}
	if err := commerceStudioParseJSON(raw, &value); err != nil {
		t.Fatal(err)
	}
	if value.Text != "preserve ,} and ,] with \"quotes\"\nsecond line" || len(value.Items) != 1 || value.Items[0] != 1 {
		t.Fatalf("unexpected repaired value: %#v", value)
	}
	if err := commerceStudioParseJSON(`{"text":"unfinished`, &value); err == nil {
		t.Fatal("truncated JSON must remain an error")
	}
}

func TestCommerceStudioRepairDirectionsTerminalObject(t *testing.T) {
	raw := `{"brief":{"category":"鞋"},"recommendations":[{"label":"a"},{"label":"b"},{"label":"c"},{"label":"d","visualSystem":{"scene":"棚拍"}}]}`
	// Remove the final recommendation's closing brace, preserving its nested visualSystem.
	broken := raw[:len(raw)-3] + raw[len(raw)-2:]
	repaired, ok := commerceStudioRepairDirectionsTerminalObject(broken)
	if !ok || repaired != raw {
		t.Fatalf("terminal repair failed: %q", repaired)
	}
	var analysis ecommerceagent.Analysis
	if err := commerceStudioParseJSON(repaired, &analysis); err != nil || len(analysis.Recommendations) != 4 || analysis.Recommendations[3].VisualSystem.Scene != "棚拍" {
		t.Fatalf("directions changed after repair: %#v, %v", analysis, err)
	}
	for _, bad := range []string{raw, `{"brief":{"category":"鞋"},"recommendations":[{"label":"unfinished]}`, `{"brief":{},"recommendations":[{"visualSystem":{"scene":"x"]}`} {
		if _, ok := commerceStudioRepairDirectionsTerminalObject(bad); ok {
			t.Fatalf("unexpected repair of %q", bad)
		}
	}
}
