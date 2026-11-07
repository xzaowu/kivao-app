package workbench

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

const depthToolCapability = `{"supportedModes":["video"],"processingOperation":"depth_capture","inputContract":{"promptRequired":false,"minTextReferences":0,"slots":[{"key":"source_video","name":"源视频","resourceKind":"asset","mediaTypes":["video"],"required":true,"minCount":1,"maxCount":1}]}}`

func TestDepthToolContractAndTask(t *testing.T) {
	s, db, _ := newWorkbenchTest(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	input := ToolInput{Kind: KindVideo, CategoryID: "enhancement", Name: "深度动作捕捉", Enabled: true, Capability: json.RawMessage(depthToolCapability)}
	tool, err := s.CreateTool(admin, input)
	if err != nil || tool.ProcessingOperation != "depth_capture" {
		t.Fatalf("create depth tool: %v", err)
	}
	for _, resource := range []model.Resource{{ID: "source", UserID: "user", Kind: "video", Status: model.ResourceStatusReady}, {ID: "foreign", UserID: "other", Kind: "video", Status: model.ResourceStatusReady}, {ID: "image", UserID: "user", Kind: "image", Status: model.ResourceStatusReady}} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := TaskInput{Kind: KindVideo, ToolID: tool.ID, ChannelID: "channel", Model: "depth", References: []TaskReference{{ResourceID: "source", Kind: "video", SlotKey: "source_video"}}}
	resolved, err := s.ResolveTask("user", req)
	if err != nil || resolved.Operation != "depth_capture" || resolved.Prompt != "" || len(resolved.Parameters) != 0 {
		t.Fatalf("resolve depth: %+v, %v", resolved, err)
	}
	for _, mutate := range []func(*TaskInput){
		func(r *TaskInput) { r.Prompt = "must not generate from text" },
		func(r *TaskInput) { r.Parameters = map[string]any{"resolution": "4k"} },
		func(r *TaskInput) { r.References = nil },
		func(r *TaskInput) { r.References = append(append([]TaskReference{}, r.References...), r.References[0]) },
		func(r *TaskInput) {
			r.References = []TaskReference{{ResourceID: "foreign", Kind: "video", SlotKey: "source_video"}}
		},
		func(r *TaskInput) {
			r.References = []TaskReference{{ResourceID: "image", Kind: "image", SlotKey: "source_video"}}
		},
	} {
		bad := req
		mutate(&bad)
		if _, err := s.ResolveTask("user", bad); err == nil {
			t.Fatal("invalid depth task accepted")
		}
	}
	if _, err := s.CreatePreset(admin, PresetInput{ToolID: tool.ID, Name: "unsupported", PromptTemplate: "do not use", Enabled: true}); err == nil {
		t.Fatal("depth preset accepted")
	}
	for _, capability := range []string{strings.Replace(depthToolCapability, "depth_capture", "unknown", 1), strings.Replace(depthToolCapability, `"maxCount":1`, `"maxCount":2`, 1), strings.Replace(depthToolCapability, `"promptRequired":false`, `"promptRequired":true`, 1)} {
		bad := input
		bad.Capability = json.RawMessage(capability)
		if _, err := s.CreateTool(admin, bad); err == nil {
			t.Fatal("invalid depth contract accepted")
		}
	}
	input.Capability = json.RawMessage(strings.Replace(depthToolCapability, `"processingOperation":"depth_capture",`, "", 1))
	if _, err := s.UpdateTool(admin, tool.ID, input); err == nil {
		t.Fatal("execution type changed after creation")
	}
}
