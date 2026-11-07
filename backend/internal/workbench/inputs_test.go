package workbench

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestEffectInputsPersistAndEnforceTaskContract(t *testing.T) {
	s, db, _ := newWorkbenchTest(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, resource := range []model.Resource{
		{ID: "notice", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "photo", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "clip", UserID: "user", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "sound", UserID: "user", Kind: "audio", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	presets := []ToolPresetInput{
		{PresetInput: PresetInput{Name: "A", PromptTemplate: "A", Enabled: true, DefaultParameters: json.RawMessage(`{"workbenchInputs":{"slotKeys":["motion"],"noticeSlotKeys":["subject"]}}`)}},
		{PresetInput: PresetInput{Name: "B", PromptTemplate: "B", Enabled: true, DefaultParameters: json.RawMessage(`{"workbenchInputs":{"slotKeys":["motion","audio"]}}`)}},
	}
	tool, err := s.CreateTool(admin, ToolInput{Kind: KindVideo, CategoryID: "product", Name: "Effects", Enabled: true, Capability: json.RawMessage(`{"inputContract":{"promptRequired":false,"slots":[{"key":"subject","name":"商品图","mediaTypes":["image"],"required":true,"minCount":1,"maxCount":4,"sampleResourceId":"notice","description":"上传清晰图片"},{"key":"motion","name":"视频","common":false,"mediaTypes":["video"],"maxCount":1},{"key":"audio","name":"音频","common":false,"mediaTypes":["audio"],"required":true,"minCount":1,"maxCount":1}]}}`), Presets: &presets})
	if err != nil {
		t.Fatal(err)
	}
	public, err := s.PublicTools(KindVideo)
	if err != nil || len(public) != 1 || public[0].InputContract.Slots[0].Description != "上传清晰图片" || public[0].InputContract.Slots[0].SampleURL == "" {
		t.Fatalf("catalog: %v, %v", public, err)
	}
	request := TaskInput{Kind: KindVideo, ToolID: tool.ID, PresetID: tool.Presets[0].ID, Prompt: "A", Model: "stub", ChannelID: "stub", References: []TaskReference{{ResourceID: "photo", Kind: "image", SlotKey: "subject"}}}
	resolved, err := s.ResolveTask("user", request)
	if err != nil {
		t.Fatal(err)
	}
	if _, leaked := resolved.Parameters["workbenchInputs"]; leaked {
		t.Fatal("input metadata leaked to generation parameters")
	}
	request.References = append(request.References, TaskReference{ResourceID: "sound", Kind: "audio", SlotKey: "audio"})
	if _, err := s.ResolveTask("user", request); err == nil {
		t.Fatal("hidden slot accepted")
	}
	request.PresetID = tool.Presets[1].ID
	if _, err := s.ResolveTask("user", request); err != nil {
		t.Fatal(err)
	}
	request.References = request.References[:1]
	if _, err := s.ResolveTask("user", request); err == nil {
		t.Fatal("active required audio was not enforced")
	}
	for _, settings := range []string{`{"workbenchInputs":{"slotKeys":["missing"]}}`, `{"workbenchInputs":{"slotKeys":[],"noticeSlotKeys":["motion"]}}`, `{"workbenchInputs":{"slotKeys":"bad"}}`, `{"workbenchInputs":{"noticeSlotKeys":["subject","subject"]}}`} {
		if _, err := s.CreatePreset(admin, PresetInput{ToolID: tool.ID, Name: "invalid", PromptTemplate: "invalid", DefaultParameters: json.RawMessage(settings)}); err == nil {
			t.Fatalf("invalid settings accepted: %s", settings)
		}
	}
}

func TestEmptyEffectRejectsReferencesAndLegacyRetainsAllSlots(t *testing.T) {
	capability := map[string]any{}
	_ = json.Unmarshal([]byte(`{"inputContract":{"slots":[{"key":"special","name":"专用图","common":false,"mediaTypes":["image"],"maxCount":1,"minCount":1,"required":true}]}}`), &capability)
	preset := &model.WorkbenchPreset{DefaultParamsJSON: `{"workbenchInputs":{"slotKeys":[]}}`}
	if err := validateTaskCapabilities(KindImage, capability, nil, preset); err != nil {
		t.Fatal(err)
	}
	if err := validateTaskCapabilities(KindImage, capability, []TaskReference{{Kind: "image", SlotKey: "special"}}, preset); err == nil {
		t.Fatal("empty selection accepted a reference")
	}
	if err := validateTaskCapabilities(KindImage, capability, nil, nil); err == nil {
		t.Fatal("legacy required slot disappeared")
	}
}
