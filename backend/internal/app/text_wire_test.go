package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func aliasedTextRegistry(t *testing.T, interfaceID string) (*protocol.Registry, string) {
	t.Helper()
	name := map[string]string{"chat-completion": "openai-chat-completions", "openai-response": "openai-responses", "claude-api": "anthropic-messages"}[interfaceID]
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", name+".yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	id := "test-alias-" + interfaceID
	pkg.Manifest.Metadata.ID = id
	pkg.Manifest.Contributes.Providers[0].ID = id
	raw, err = json.Marshal(pkg.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	registry, _ := protocol.NewRegistry()
	if err := registry.RegisterManifest(raw); err != nil {
		t.Fatal(err)
	}
	return registry, id
}

func TestDeclaredTextAliasesStreamAndAgent(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, wire := range textCompletionFixtures() {
		registry, id := aliasedTextRegistry(t, wire.interfaceID)
		for _, agent := range []bool{false, true} {
			for _, scenario := range []string{"complete", "missing_terminal", "incomplete", "http_rejected", "tool"} {
				if scenario == "tool" && !agent {
					continue
				}
				t.Run(fmt.Sprintf("%s/agent_%t/%s", wire.wire, agent, scenario), func(t *testing.T) {
					var calls atomic.Int32
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						calls.Add(1)
						var body map[string]any
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
							return
						}
						if body["stream"] != true || body["model"] != "test-model" {
							t.Error("plugin request mapping or stream flag lost")
						}
						if wire.wire == "chat-completion" {
							options, _ := body["stream_options"].(map[string]any)
							if options["include_usage"] != true {
								t.Error("usage not requested")
							}
						}
						if scenario == "http_rejected" {
							w.WriteHeader(400)
							fmt.Fprint(w, `{"error":{"message":"stream_options include_usage unsupported"}}`)
							return
						}
						w.Header().Set("Content-Type", "text/event-stream")
						switch scenario {
						case "complete":
							fmt.Fprint(w, wire.delta+wire.end)
						case "missing_terminal":
							fmt.Fprint(w, wire.delta)
						case "incomplete":
							fmt.Fprint(w, wire.delta+wire.incomplete)
						case "tool":
							fmt.Fprint(w, wire.tool+wire.toolEnd)
						}
					}))
					defer server.Close()
					input := canvasGenerationInput{Mode: "text", Prompt: "hello", StreamText: true, Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", InterfaceType: id}}
					ctx := withProtocolRegistry(context.Background(), registry)
					var result map[string]interface{}
					var err error
					if agent {
						input.AgentRequests = &agentToolRequests{Canonical: &canonicalAgentRequest{Messages: []map[string]interface{}{{"role": "user", "content": "hello"}}, Tools: []map[string]interface{}{{"type": "function", "function": map[string]interface{}{"name": "canvas_get_state", "parameters": map[string]interface{}{"type": "object"}}}}, ToolChoice: "auto"}}
						result, err = runAgentToolTask(ctx, input)
					} else {
						result, err = runTextTask(ctx, input)
					}
					if calls.Load() != 1 {
						t.Fatalf("calls=%d; aliases must not auto retry", calls.Load())
					}
					if scenario == "complete" {
						if err != nil || result["text"] != "draft" {
							t.Fatalf("result=%#v err=%v", result, err)
						}
					} else if scenario == "tool" {
						if err != nil || len(result["toolCalls"].([]interface{})) != 1 {
							t.Fatalf("tool result=%#v err=%v", result, err)
						}
					} else if scenario == "http_rejected" {
						var upstream providerHTTPError
						if !errors.As(err, &upstream) || upstream.StatusCode != 400 {
							t.Fatalf("err=%v", err)
						}
					} else if !billingFailureUncertain(err) {
						t.Fatalf("unfinished stream must stay uncertain: %v", err)
					}
				})
			}
		}
	}
}

func TestDeclaredProxyAuthenticationAndAvailability(t *testing.T) {
	for _, tc := range []struct {
		name   string
		auth   protocol.ManifestAuth
		secret bool
	}{
		{"header", protocol.ManifestAuth{Type: "header", Header: "x-provider-key", Field: "apiKey"}, false},
		{"header_secret", protocol.ManifestAuth{Type: "header", Header: "x-provider-key", Field: "secretKey"}, true},
		{"basic", protocol.ManifestAuth{Type: "basic", Field: "apiKey", SecretField: "secretKey"}, true},
		{"query", protocol.ManifestAuth{Type: "query", Query: "auth", Field: "apiKey"}, false},
		{"anthropic", protocol.ManifestAuth{Type: "anthropic", Field: "apiKey"}, false},
		{"none", protocol.ManifestAuth{Type: "none", SecretField: "secretKey"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			registry, id := aliasedTextRegistry(t, "chat-completion")
			// Install a synthetic contract into an isolated runtime; no provider calls.
			rawAuth, _ := json.Marshal(tc.auth)
			raw := fmt.Sprintf(`{"apiVersion":"yingce.plugin/v1","id":"%s","version":"1.0.0","name":"Alias","contributes":{"providers":[{"id":"%s","label":"Alias","capabilities":["text"],"scopes":["admin.system-channel"],"auth":%s,"create":{"method":"POST","path":"/v1/chat/completions"},"agent":{"method":"POST","path":"/v1/messages"},"agentResponse":{"textPaths":["text"]},"response":{}}]}}`, id, id, rawAuth)
			registry.Unregister(id)
			if err := registry.RegisterManifest([]byte(raw)); err != nil {
				t.Fatal(err)
			}
			svc := &Service{pluginRuntime: &pluginRuntime{registry: registry}}
			channel := &model.ModelChannel{APIKey: "fixture-api", SecretKey: "fixture-secret"}
			req := httptest.NewRequest(http.MethodPost, "https://example.invalid/v1/chat/completions", nil)
			if err := svc.ApplySystemProxyAuth(req, channel, model.ChannelInterfaceType(id)); err != nil {
				t.Fatal(err)
			}
			switch tc.name {
			case "header":
				if req.Header.Get("x-provider-key") != channel.APIKey {
					t.Fatal("header auth lost")
				}
			case "header_secret":
				if req.Header.Get("x-provider-key") != channel.SecretKey {
					t.Fatal("secret field lost")
				}
			case "basic":
				u, p, ok := req.BasicAuth()
				if !ok || u != channel.APIKey || p != channel.SecretKey {
					t.Fatal("basic auth lost")
				}
			case "query":
				if req.URL.Query().Get("auth") != channel.APIKey {
					t.Fatal("query auth lost")
				}
			case "anthropic":
				if req.Header.Get("x-api-key") != channel.APIKey || req.Header.Get("anthropic-version") == "" {
					t.Fatal("anthropic auth lost")
				}
			case "none":
				if len(req.Header) != 0 {
					t.Fatal("none auth gained headers")
				}
			}
			if protocolAuthUsesSecretKey(tc.auth) != tc.secret {
				t.Fatal("incorrect Secret Key requirement")
			}
			channel.SecretKey = ""
			if err := svc.ApplySystemProxyAuth(req, channel, model.ChannelInterfaceType(id)); (err != nil) != tc.secret {
				t.Fatal("missing secret preflight mismatch")
			}
			if got := svc.SystemProxyTextWire(model.ChannelInterfaceType(id), "/messages"); got != "claude-api" {
				t.Fatalf("agent operation wire=%q", got)
			}
			if got := svc.SystemProxyTextWire(model.ChannelInterfaceType(id), "/responses"); got != "" {
				t.Fatal("undeclared endpoint gained a wire")
			}
			if err := ValidateSystemProxyTextStream(svc.SystemProxyTextWire(model.ChannelInterfaceType(id), "/chat/completions"), []byte("data: {}\n\n")); err == nil {
				t.Fatal("aliased unfinished stream accepted")
			}
			for _, unavailable := range []string{strings.Replace(raw, `"version":"1.0.0"`, `"version":"1.0.0","enabled":false`, 1), strings.Replace(raw, `"admin.system-channel"`, `"user.custom-channel"`, 1)} {
				registry.Unregister(id)
				if err := registry.RegisterManifest([]byte(unavailable)); err != nil {
					t.Fatal(err)
				}
				if len(svc.SystemProxyDeclaredPostPaths(model.ChannelInterfaceType(id))) != 0 {
					t.Fatal("inactive or wrong-scope plugin gained proxy paths")
				}
				if err := svc.ApplySystemProxyAuth(req, channel, model.ChannelInterfaceType(id)); err == nil {
					t.Fatal("inactive plugin authenticated")
				}
			}
		})
	}
}

func TestTextWireCatalogProjection(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: center}
	raw := []byte(`{"apiVersion":"yingce.plugin/v1","id":"catalog-alias","version":"1.0.0","name":"Catalog Alias","contributes":{"providers":[{"id":"catalog-alias","label":"Catalog Alias","capabilities":["text"],"scopes":["admin.system-channel","user.custom-channel"],"auth":{"type":"basic","field":"apiKey","secretField":"secretKey"},"create":{"method":"POST","path":"/v1/responses"},"response":{}}]}}`)
	if _, err := center.install(testPluginPackage(t, raw), "catalog-alias.yingce-plugin"); err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, item := range svc.PluginProviderCatalog("user.custom-channel", "text", false) {
		if item.ID != "catalog-alias" {
			continue
		}
		found = true
		if item.TextWire != "responses" || !item.RequiresSecretKey {
			t.Fatal("catalog lost declared format or required credential slot")
		}
		data, _ := json.Marshal(item)
		if strings.Contains(string(data), `"auth"`) || strings.Contains(string(data), `"secretField"`) {
			t.Fatal("internal auth projection leaked")
		}
	}
	if !found {
		t.Fatal("plugin catalog item missing")
	}
	item, err := svc.sanitizeChannelModel(&model.ChannelModel{ID: "fixture", ModelKey: "test-model", Capability: "text", Protocol: "catalog-alias", CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("chat-completion", "test-model"))})
	if err != nil || item.TextWire != "responses" {
		t.Fatalf("public model wire=%q err=%v", item.TextWire, err)
	}
	if _, err := center.setEnabled("catalog-alias", false); err != nil {
		t.Fatal(err)
	}
	if svc.textModelWire("catalog-alias") != "" {
		t.Fatal("disabled model retained active wire")
	}
	if _, err := runTextTask(withProtocolRegistry(context.Background(), center.registrySnapshot()), canvasGenerationInput{Mode: "text", Config: providerConfig{InterfaceType: "catalog-alias", BaseURL: "https://example.invalid", APIKey: "fixture", Model: "fixture"}}); err == nil || !strings.Contains(err.Error(), "未启用") {
		t.Fatalf("disabled text task did not stop before transport: %v", err)
	}
}
