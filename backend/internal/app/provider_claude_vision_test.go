package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDeclaredClaudeVisionDelivery(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
	service, _, pixels := cloudAgentVisionFixture(t)
	wantData := base64.StdEncoding.EncodeToString(pixels)
	var events textCompletionFixture
	for _, fixture := range textCompletionFixtures() {
		if fixture.wire == "claude-api" {
			events = fixture
		}
	}
	for _, alias := range []bool{false, true} {
		registry, id := loadOfficialFallbackRegistry(), "claude-api"
		if alias {
			registry, id = aliasedTextRegistry(t, "claude-api")
		}
		for _, scenario := range []string{"stream", "json_fallback", "stream_disabled", "missing_terminal"} {
			t.Run(fmt.Sprintf("alias_%t/%s", alias, scenario), func(t *testing.T) {
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "test-key" || r.Header.Get("anthropic-version") != "2023-06-01" {
						t.Error("Claude path/authentication/version changed")
					}
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					messages, _ := body["messages"].([]any)
					if len(messages) != 3 || body["system"] != "test instructions" || body["max_tokens"] != float64(2048) {
						t.Error("history or configured text limits lost")
						w.WriteHeader(400)
						return
					}
					if body["thinking"] != nil {
						t.Error("thinking default changed")
					}
					blocks, _ := messages[2].(map[string]any)["content"].([]any)
					if len(blocks) != 3 {
						t.Error("current images or prompt missing")
						w.WriteHeader(400)
						return
					}
					for index, value := range blocks[1:] {
						block, _ := value.(map[string]any)
						source, _ := block["source"].(map[string]any)
						if block["type"] != "image" || block["image_url"] != nil {
							t.Error("image was not converted to native Claude format")
						}
						if index == 0 && (source["type"] != "base64" || source["media_type"] != "image/png" || source["data"] != wantData) {
							t.Error("authorized resource pixels lost")
						}
						if index == 1 && (source["type"] != "url" || source["url"] != "https://example.com/reference.png") {
							t.Error("URL reference changed")
						}
					}
					stream, _ := body["stream"].(bool)
					if stream != (scenario != "stream_disabled") {
						t.Error("stream selection changed")
					}
					if scenario == "json_fallback" || scenario == "stream_disabled" {
						w.Header().Set("Content-Type", "application/json")
						fmt.Fprint(w, `{"content":[{"type":"text","text":"draft"}],"stop_reason":"end_turn"}`)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, events.delta)
					w.(http.Flusher).Flush()
					if scenario == "stream" {
						fmt.Fprint(w, events.end)
					}
				}))
				defer server.Close()
				var deltas strings.Builder
				input := canvasGenerationInput{
					Mode: "text", Prompt: "compare", MaxOutputTokens: 2048, StreamText: scenario != "stream_disabled",
					Config:          providerConfig{InterfaceType: id, Model: "vision-test", BaseURL: server.URL, APIKey: "test-key", SystemPrompt: "test instructions"},
					TextHistory:     []providerTextMessage{{Role: "user", Content: "old question"}, {Role: "assistant", Content: "old answer"}},
					ReferenceImages: []providerMedia{{StorageKey: "resource:ref-one"}, {URL: "https://example.com/reference.png"}},
					OnTextDelta:     func(delta string) { deltas.WriteString(delta) },
				}
				ctx := withProtocolRegistry(context.Background(), registry)
				if err := service.hydrateGenerationMedia("user", &input, providerMediaHydrationPolicyFor(ctx, input)); err != nil {
					t.Fatal(err)
				}
				result, err := runTextTask(ctx, input)
				if calls.Load() != 1 {
					t.Fatal("text request was lost or retried")
				}
				if scenario == "missing_terminal" {
					if !billingFailureUncertain(err) || deltas.String() != "draft" {
						t.Fatal("unfinished image-text response lost its draft or billing uncertainty")
					}
				} else if err != nil || result["text"] != "draft" {
					t.Fatalf("text response failed: %v", err)
				}
				if scenario == "stream" && deltas.String() != "draft" {
					t.Fatal("streamed image-text response was buffered or lost")
				}
			})
		}
	}
}

func TestDeclaredClaudeVisionRejectsBeforeSend(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	service, _, _ := cloudAgentVisionFixture(t)
	registry, id := aliasedTextRegistry(t, "claude-api")
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(400) }))
	defer server.Close()
	for _, scenario := range []string{"foreign_resource", "bad_base64", "video", "audio"} {
		t.Run(scenario, func(t *testing.T) {
			input := canvasGenerationInput{Mode: "text", Prompt: "describe", Config: providerConfig{InterfaceType: id, Model: "vision-test", BaseURL: server.URL, APIKey: "test-key"}}
			user := "user"
			switch scenario {
			case "foreign_resource":
				user = "other-user"
				input.ReferenceImages = []providerMedia{{StorageKey: "resource:ref-one"}}
			case "bad_base64":
				input.ReferenceImages = []providerMedia{{DataURL: "data:image/png;base64,private-marker!"}}
			case "video":
				input.ReferenceVideos = []providerMedia{{URL: "https://example.com/private-marker.mp4"}}
			case "audio":
				input.ReferenceAudios = []providerMedia{{URL: "https://example.com/private-marker.mp3"}}
			}
			ctx := withProtocolRegistry(context.Background(), registry)
			err := service.hydrateGenerationMedia(user, &input, providerMediaHydrationPolicyFor(ctx, input))
			if err == nil {
				_, err = runTextTask(ctx, input)
			}
			if err == nil || strings.Contains(err.Error(), "private-marker") || calls.Load() != 0 {
				t.Fatal("unsafe media was sent or exposed in an error")
			}
		})
	}
}
