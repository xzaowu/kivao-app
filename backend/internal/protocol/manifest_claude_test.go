package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestClaudeManifestImageMessages(t *testing.T) {
	adapter := officialPackageAdapter(t, "anthropic-messages.yingce-plugin", "claude-api")
	request := GenerationRequest{
		Capability: CapabilityText, Model: "vision-test", Prompt: "compare", Instructions: "be concise",
		Messages: []Message{
			{Role: "user", Content: []map[string]any{
				{"type": "text", "text": "previous image"},
				{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/old.png", "detail": "auto"}, "cache_control": map[string]any{"type": "ephemeral"}},
			}},
			{Role: "assistant", Content: "previous answer"},
		},
		Images: []MediaReference{{URL: "https://example.com/new.png?signature=test-only"}, {DataURL: "data:image/png;base64,aGVsbG8="}},
	}
	before, _ := json.Marshal(request)
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	messages := body["messages"].([]any)
	if len(messages) != 3 || body["system"] != "be concise" || body["max_tokens"] != float64(4096) {
		t.Fatal("history, instructions or token limit changed")
	}
	if _, ok := body["thinking"]; ok {
		t.Fatal("thinking default changed")
	}
	history := messages[0].(map[string]any)["content"].([]any)
	current := messages[2].(map[string]any)["content"].([]any)
	want := []map[string]any{
		{"type": "url", "url": "https://example.com/old.png"},
		{"type": "url", "url": "https://example.com/new.png?signature=test-only"},
		{"type": "base64", "media_type": "image/png", "data": "aGVsbG8="},
	}
	for i, value := range []any{history[1], current[1], current[2]} {
		block := value.(map[string]any)
		if block["type"] != "image" || !reflect.DeepEqual(block["source"], want[i]) || block["image_url"] != nil {
			t.Errorf("image %d is not a native Claude image block", i)
		}
	}
	if history[1].(map[string]any)["cache_control"] == nil || messages[1].(map[string]any)["content"] != "previous answer" {
		t.Fatal("history content or cache control lost")
	}
	after, _ := json.Marshal(request)
	if string(after) != string(before) {
		t.Fatal("building a request mutated its input")
	}
}

func TestClaudeManifestRejectsInvalidMedia(t *testing.T) {
	adapter := officialPackageAdapter(t, "anthropic-messages.yingce-plugin", "claude-api")
	for index, value := range []string{
		"", "resource:private-marker", "blob:private-marker", "/private-marker.png",
		"https://user:private-marker@example.com/image.png", "https://example.com/%zz?private-marker",
		"data:image/png;base64,", "data:image/png;base64,private-marker!", "data:image/png,private-marker",
		"data:image/svg+xml;base64,aGVsbG8=", "data:application/pdf;base64,aGVsbG8=",
	} {
		t.Run(fmt.Sprintf("input_%d", index), func(t *testing.T) {
			for _, history := range []bool{false, true} {
				request := GenerationRequest{Capability: CapabilityText, Prompt: "describe", Model: "test"}
				if history {
					request.Messages = []Message{{Role: "user", Content: []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": value}}}}}
				} else {
					request.Images = []MediaReference{{URL: value}}
				}
				_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
				if err == nil || strings.Contains(err.Error(), "private-marker") || strings.Contains(err.Error(), "aGVsbG8=") {
					t.Fatalf("history=%t: missing safe media rejection", history)
				}
			}
		})
	}
	for _, kind := range []string{"video", "audio", "video_url", "audio_url", "input_video", "input_audio"} {
		t.Run(kind, func(t *testing.T) {
			request := GenerationRequest{Capability: CapabilityText, Prompt: "describe", Model: "test"}
			request.Messages = []Message{{Role: "user", Content: []any{map[string]any{"type": kind, kind: "https://example.com/media"}}}}
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("unsupported history media accepted")
			}
			request.Messages = nil
			if strings.Contains(kind, "video") {
				request.Videos = []MediaReference{{URL: "https://example.com/movie.mp4"}}
			} else {
				request.Audios = []MediaReference{{URL: "https://example.com/audio.mp3"}}
			}
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("unsupported current media accepted")
			}
		})
	}
}

func TestClaudeManifestNativeHistoryAndInstructions(t *testing.T) {
	adapter := officialPackageAdapter(t, "anthropic-messages.yingce-plugin", "claude-api")
	cache := map[string]any{"type": "ephemeral"}
	content := []any{map[string]any{"type": "text", "text": "history rule", "cache_control": cache}}
	for _, instructions := range []string{"", "explicit rule"} {
		request := GenerationRequest{Capability: CapabilityText, Model: "test", Prompt: "next", Instructions: instructions,
			Messages:        []Message{{Role: "system", Content: "first rule"}, {Role: "SYSTEM", Content: content}},
			Extra:           map[string]any{"max_tokens": 1024},
			ProviderOptions: map[string]map[string]any{"claude-api": {"thinking": map[string]any{"type": "enabled", "budget_tokens": 512}}},
		}
		for _, mediaType := range []string{"image/png", "image/jpeg", "image/gif", "image/webp"} {
			request.Messages = append(request.Messages, Message{Role: "user", Content: []any{
				map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": mediaType, "data": "aGVsbG8="}, "cache_control": cache},
			}})
		}
		request.Messages = append(request.Messages, Message{Role: "user", Content: []any{
			map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": "https://example.com/image.png"}},
			map[string]any{"type": "image", "source": map[string]any{"type": "file", "file_id": "file-test-only"}},
		}})
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if body["max_tokens"] != float64(1024) || body["thinking"].(map[string]any)["budget_tokens"] != float64(512) {
			t.Fatal("explicit output or thinking parameters changed")
		}
		if instructions == "" {
			blocks := body["system"].([]any)
			if len(blocks) != 2 || blocks[1].(map[string]any)["cache_control"] == nil {
				t.Fatal("historical system text or caching lost")
			}
		} else if body["system"] != instructions {
			t.Fatal("explicit instructions lost precedence")
		}
		messages := body["messages"].([]any)
		if len(messages) != 6 {
			t.Fatal("system history duplicated into messages or media history lost")
		}
		for i, message := range messages[:5] {
			want, _ := json.Marshal(request.Messages[i+2].Content)
			got, _ := json.Marshal(message.(map[string]any)["content"])
			if string(want) != string(got) {
				t.Fatal("native image history changed")
			}
		}
	}
}

func TestClaudeManifestUsesDeclaredWireOnly(t *testing.T) {
	for _, tc := range []struct {
		name, provider, path, capability string
		template, legacy, wantClaude     bool
	}{
		{"renamed", "custom-vision", "/v1/messages", "text", false, false, true},
		{"omitted_capability", "custom-vision", "/v1/messages", "", false, false, true},
		{"legacy_fields", "custom-vision", "/v1/messages", "text", false, true, true},
		{"misleading_name", "claude-api", "/v1/chat/completions", "text", false, false, false},
		{"templated_path", "claude-api", "/v1/messages", "text", true, false, false},
		{"non_text", "claude-api", "/v1/messages", "image", false, false, false},
		{"ambiguous_capability", "claude-api", "/v1/messages", "", false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := officialPackageAdapter(t, "anthropic-messages.yingce-plugin", "claude-api").(manifestAdapter)
			a.manifest.Metadata.ID = "test-vision"
			provider := &a.manifest.Contributes.Providers[0]
			provider.ID, provider.Create.Path = tc.provider, tc.path
			if tc.name == "ambiguous_capability" {
				provider.Capabilities = []Capability{CapabilityText, CapabilityImage}
			}
			if tc.template {
				provider.Create.PathTemplate = map[string]any{"$ref": "request.extra.path"}
			}
			if tc.legacy {
				provider.Create.Body = nil
				provider.Create.Fields = map[string]string{"messages": "request.messages", "system": "request.instructions"}
			}
			raw, _ := json.Marshal(a.manifest)
			adapters, err := LoadInstalledProviders(raw, nil)
			if err != nil {
				t.Fatal(err)
			}
			spec, err := adapters[0].BuildCreate(context.Background(), RequestContext{BaseURL: "https://api.anthropic.com/claude", Request: GenerationRequest{
				Capability: Capability(tc.capability), Model: "claude-lookalike", Prompt: "describe",
				Images: []MediaReference{{URL: "https://example.com/image.png"}}, Extra: map[string]any{"path": "/v1/messages"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			block := body["messages"].([]any)[0].(map[string]any)["content"].([]any)[1].(map[string]any)
			if (block["type"] == "image") != tc.wantClaude {
				t.Fatal("image encoding did not follow the trusted static text operation")
			}
		})
	}
}
