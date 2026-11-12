package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTextWireOnlyStaticPostOperations(t *testing.T) {
	for _, tc := range []struct{ operation, wire string }{
		{"POST /chat/completions", "chat-completion"}, {"POST /v1/responses", "responses"}, {"POST /gateway/v1/messages", "claude-api"},
		{"GET /messages", ""}, {"POST https://example.invalid/messages", ""}, {"POST //example.invalid/messages", ""},
		{"POST /a/../messages", ""}, {"POST /a//messages", ""}, {"POST /%6dessages", ""}, {"POST /messages?key=x", ""},
		{"POST /messages#x", ""}, {"POST /{model}/messages", ""}, {"POST /messages/", ""}, {"POST /messages-extra", ""},
		{"POST /v1/chat/completions\n", ""}, {"POST /v1\\messages", ""}, {"POST /generate", ""},
	} {
		t.Run(tc.operation, func(t *testing.T) {
			if got := TextWireForOperation(tc.operation); got != tc.wire {
				t.Fatalf("wire=%q want=%q", got, tc.wire)
			}
		})
	}
}

func TestManifestTextWireAndProxyProjection(t *testing.T) {
	for _, tc := range []struct {
		name, create, capability, wantWire string
		paths                              int
	}{
		{"static", `"method":"POST","path":"/v1/chat/completions"`, "text", "chat-completion", 2},
		{"dynamic", `"method":"POST","path":"/v1/chat/completions","pathTemplate":{"$ref":"request.model"}`, "text", "", 1},
		{"origin", `"method":"POST","path":"/v1/chat/completions","originPath":true`, "text", "chat-completion", 1},
		{"other_capability", `"method":"POST","path":"/v1/chat/completions"`, "image", "", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := `{"apiVersion":"yingce.plugin/v1","id":"alias","version":"1.0.0","name":"Alias","contributes":{"providers":[{"id":"alias","label":"Alias","capabilities":["` + tc.capability + `"],"scopes":["admin.system-channel"],"auth":{"type":"header","header":"x-private-auth","field":"secretKey"},"create":{` + tc.create + `},"agent":{"method":"POST","path":"/v1/messages"},"agentResponse":{"textPaths":["text"]},"response":{}}]}}`
			adapter, err := LoadManifest([]byte(raw))
			if err != nil {
				t.Fatal(err)
			}
			metadata := adapter.Metadata()
			if metadata.TextWire != tc.wantWire || (tc.capability == "text" && metadata.AgentWire != "claude-api") || metadata.Auth.Field != "secretKey" {
				t.Fatalf("incorrect contract projection: %#v", metadata)
			}
			if got := len(StaticProxyPostPaths(adapter)); got != tc.paths {
				t.Fatalf("paths=%d want=%d", got, tc.paths)
			}
			public, err := json.Marshal(metadata)
			if err != nil || strings.Contains(string(public), "x-private-auth") || strings.Contains(string(public), "secretKey") {
				t.Fatal("internal auth declaration leaked in metadata JSON")
			}
		})
	}
}
