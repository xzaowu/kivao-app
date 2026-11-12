package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

type textCompletionFixture struct {
	wire, interfaceID, delta, end, incomplete, tool, toolEnd, incompleteJSON string
}

func textCompletionFixtures() []textCompletionFixture {
	return []textCompletionFixture{
		{
			wire: "chat-completion", interfaceID: "chat-completion",
			delta:          "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"draft\"}}]}\n\n",
			end:            "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
			incomplete:     "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n",
			tool:           "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"canvas_get_state\",\"arguments\":\"{}\"}}]}}]}\n\n",
			toolEnd:        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
			incompleteJSON: `{"choices":[{"message":{"content":"draft"},"finish_reason":"length"}]}`,
		},
		{
			wire: "responses", interfaceID: "openai-response",
			delta:          "event: response.output_text.delta\ndata: {\"delta\":\"draft\"}\n\n",
			end:            "event: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"output_text\":\"draft\"}}\n\n",
			incomplete:     "event: response.incomplete\ndata: {\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n",
			tool:           "event: response.output_item.added\ndata: {\"output_index\":0,\"item\":{\"type\":\"function_call\",\"call_id\":\"call-1\",\"name\":\"canvas_get_state\",\"arguments\":\"{}\"}}\n\n",
			toolEnd:        "event: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"function_call\",\"call_id\":\"call-1\",\"name\":\"canvas_get_state\",\"arguments\":\"{}\"}]}}\n\n",
			incompleteJSON: `{"status":"incomplete","output_text":"draft"}`,
		},
		{
			wire: "claude-api", interfaceID: "claude-api",
			delta:          "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"draft\"}}\n\n",
			end:            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
			incomplete:     "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n",
			tool:           "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call-1\",\"name\":\"canvas_get_state\",\"input\":{}}}\n\n",
			toolEnd:        "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
			incompleteJSON: `{"content":[{"type":"text","text":"draft"}],"stop_reason":"max_tokens"}`,
		},
	}
}

func TestStreamingTextCompletionBoundaries(t *testing.T) {
	for _, wire := range textCompletionFixtures() {
		for _, tc := range []struct {
			name, events        string
			wantError, wantTool bool
		}{
			{"missing_terminal", wire.delta, true, false},
			{"normal", wire.delta + wire.end, false, false},
			{"incomplete_then_end", wire.delta + wire.incomplete + wire.end + "data: [DONE]\n\n", true, false},
			{"tool_json_without_terminal", wire.delta + wire.tool, true, false},
			{"tool_incomplete", wire.delta + wire.tool + wire.incomplete + wire.toolEnd, true, false},
			{"tool_complete", wire.delta + wire.tool + wire.toolEnd, false, true},
			{"error_after_delta", wire.delta + "event: error\ndata: {\"error\":{\"message\":\"tool_choice secret-sentinel https://private.invalid\"}}\n\n" + wire.end, true, false},
			{"error_without_error_object", wire.delta + "event: error\ndata: {\"message\":\"secret-sentinel\"}\n\n" + wire.end, true, false},
			{"malformed_event", wire.delta + "data: {\"secret-sentinel\":\n\n" + wire.end, true, false},
		} {
			t.Run(wire.wire+"/"+tc.name, func(t *testing.T) {
				var deltas strings.Builder
				parser := newStreamingAgentParser(wire.wire, func(s string) { deltas.WriteString(s) })
				// Exercise event boundaries split at arbitrary byte positions.
				for start := 0; start < len(tc.events); start += 7 {
					parser.consume("text/event-stream", []byte(tc.events[start:min(start+7, len(tc.events))]))
				}
				parser.flush()
				result, err := parser.result()
				if deltas.String() != "draft" {
					t.Fatalf("partial draft lost: %q", deltas.String())
				}
				if tc.wantError {
					var completionErr providerTextCompletionError
					if result != nil || !errors.As(err, &completionErr) || !billingFailureUncertain(err) {
						t.Fatalf("partial output became executable/successful: result=%v err=%v", result, err)
					}
					if isAgentToolChoiceCompatibilityError(err) || shouldFallbackTextToChat(err) || strings.Contains(err.Error(), "secret-sentinel") || strings.Contains(err.Error(), "private.invalid") {
						t.Fatalf("unsafe error or automatic resend: %v", err)
					}
					return
				}
				if err != nil || result["text"] != "draft" || (len(interfaceSlice(result["toolCalls"])) > 0) != tc.wantTool {
					t.Fatalf("valid response rejected: result=%v err=%v", result, err)
				}
			})
		}
	}
}

func TestStreamingTextCompletionStatusAndToolValidation(t *testing.T) {
	for _, tc := range []struct{ wire, events string }{
		{"responses", "event: response.failed\ndata: {\"response\":{\"status\":\"failed\"}}\n\n"},
		{"responses", "event: response.cancelled\ndata: {}\n\n"},
		{"responses", "event: response.completed\ndata: {\"response\":{\"status\":\"in_progress\",\"output_text\":\"draft\"}}\n\n"},
		{"responses", "event: response.completed\ndata: {\"response\":{\"output\":[{\"type\":\"function_call\",\"call_id\":\"call\",\"name\":\"test\",\"arguments\":\"{\"}]}}\n\n"},
		{"responses", "event: response.output_text.delta\ndata: {\"delta\":\"draft\"}\n\ndata: [DONE]\n\n"},
		{"claude-api", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"draft\"}}\n\ndata: [DONE]\n\n"},
		{"chat-completion", "data: {\"choices\":[{\"delta\":{\"content\":\"draft\"}},{\"index\":1,\"delta\":{\"content\":\"other\"},\"finish_reason\":\"stop\"}]}\n\n"},
		{"chat-completion", "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"id\":\"call\",\"function\":{\"arguments\":\"{}\"}}]}}]}\n\ndata: [DONE]\n\n"},
		{"chat-completion", "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"id\":\"call\",\"function\":{\"name\":\"test\",\"arguments\":\"null\"}}]}}]}\n\ndata: [DONE]\n\n"},
	} {
		t.Run(tc.wire+fmt.Sprint(len(tc.events)), func(t *testing.T) {
			parser := newStreamingAgentParser(tc.wire, nil)
			parser.consume("text/event-stream", []byte(tc.events))
			parser.flush()
			if result, err := parser.result(); result != nil || !billingFailureUncertain(err) {
				t.Fatalf("invalid completion accepted: %v %v", result, err)
			}
		})
	}
	for _, tc := range []struct{ wire, reason string }{
		{"chat-completion", "length"}, {"chat-completion", "content_filter"}, {"chat-completion", "unknown"},
		{"responses", "incomplete"}, {"responses", "failed"}, {"responses", "queued"},
		{"claude-api", "max_tokens"}, {"claude-api", "pause_turn"}, {"claude-api", "refusal"}, {"claude-api", "model_context_window_exceeded"},
	} {
		t.Run(tc.wire+"/"+tc.reason, func(t *testing.T) {
			if err := validateTextCompletionReason(tc.wire, tc.reason); !billingFailureUncertain(err) {
				t.Fatalf("unsuccessful reason accepted: %v", err)
			}
		})
	}
}

func TestTextCompletionRequestsNeverResendPartialOutput(t *testing.T) {
	allowLoopbackProviderTest(t)
	for _, wire := range textCompletionFixtures() {
		for _, route := range []string{"text_builtin", "text_plugin", "agent_builtin", "agent_plugin"} {
			for _, failure := range []string{"missing_terminal", "incomplete", "json_incomplete", "tool_choice_error", "transport_eof"} {
				t.Run(wire.wire+"/"+route+"/"+failure, func(t *testing.T) {
					var calls atomic.Int32
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						calls.Add(1)
						if failure == "json_incomplete" {
							w.Header().Set("Content-Type", "application/json")
							fmt.Fprint(w, wire.incompleteJSON)
							return
						}
						w.Header().Set("Content-Type", "text/event-stream")
						if failure == "transport_eof" {
							w.Header().Set("Content-Length", fmt.Sprint(len(wire.delta+wire.tool)+100))
						}
						fmt.Fprint(w, wire.delta+wire.tool)
						if failure == "incomplete" {
							fmt.Fprint(w, wire.incomplete)
						} else if failure == "tool_choice_error" {
							fmt.Fprint(w, "event: error\ndata: {\"error\":{\"message\":\"tool_choice is unsupported secret-sentinel\"}}\n\n")
						}
					}))
					defer server.Close()
					registry, registryErr := protocol.NewRegistry()
					if registryErr != nil {
						t.Fatal(registryErr)
					}
					ctx := withProtocolRegistry(t.Context(), registry)
					if strings.HasSuffix(route, "plugin") {
						ctx = withProtocolRegistry(t.Context(), loadOfficialFallbackRegistry())
					}
					_, isPlugin := declarativeProtocolAdapterForContext(ctx, wire.interfaceID)
					if strings.HasPrefix(route, "agent") {
						_, isPlugin = agentProtocolAdapterForContext(ctx, wire.interfaceID)
					}
					if isPlugin != strings.HasSuffix(route, "plugin") {
						t.Fatal("request did not select the intended builtin/plugin path")
					}
					var deltas strings.Builder
					input := canvasGenerationInput{Mode: "text", Prompt: "test", StreamText: true,
						Config:      providerConfig{BaseURL: server.URL, Model: "test-model", InterfaceType: wire.interfaceID},
						OnTextDelta: func(s string) { deltas.WriteString(s) },
					}
					var result map[string]interface{}
					var err error
					if strings.HasPrefix(route, "agent") {
						// Use the real protocol expansion and Agent request path, but
						// never hand a partial call to an executor.
						body := map[string]interface{}{"messages": []interface{}{map[string]interface{}{"role": "user", "content": "test"}}, "tool_choice": "required"}
						input.AgentRequests = &agentToolRequests{ChatCompletion: body, Responses: body, Claude: body}
						result, err = runAgentToolTask(ctx, input)
					} else {
						result, err = runTextTask(ctx, input)
					}
					var completionErr providerTextCompletionError
					if !errors.As(err, &completionErr) || result != nil || calls.Load() != 1 {
						t.Fatalf("partial request was accepted/retried: result=%v err=%v calls=%d", result, err, calls.Load())
					}
					if failure == "transport_eof" && !errors.Is(err, io.ErrUnexpectedEOF) {
						t.Fatalf("transport cause lost: %v", err)
					}
					if failure != "json_incomplete" && deltas.String() != "draft" {
						t.Fatalf("stream delta lost: %q", deltas.String())
					}
				})
			}
		}
	}
}

func TestTextCompletionFailureUsesTypedBillingAndKeepsCancellation(t *testing.T) {
	for _, cause := range []error{context.Canceled, context.DeadlineExceeded, providerHTTPError{StatusCode: 404}, providerPayloadError{raw: "tool_choice secret-sentinel"}} {
		err := providerTextCompletionError{reason: "missing_terminal", cause: cause}
		wrapped := fmt.Errorf("generation: %w", err)
		if !errors.Is(wrapped, cause) || !billingFailureUncertain(wrapped) || isAgentToolChoiceCompatibilityError(wrapped) || shouldFallbackTextToChat(wrapped) {
			t.Fatalf("completion failure lost its safety semantics: %v", wrapped)
		}
		repo := &taskBillingRepositoryStub{order: &model.BillingOrder{Status: model.BillingStatusRunning}}
		if !newTaskBillingCoordinator(repo).BillingFailureRequiresReview("order", "task", wrapped) {
			t.Fatal("uncertain completion refunded without a successful call log")
		}
	}
}

func TestTextCompletionJSONExplicitFailure(t *testing.T) {
	for _, wire := range textCompletionFixtures() {
		t.Run(wire.wire, func(t *testing.T) {
			var payload map[string]interface{}
			if err := json.Unmarshal([]byte(wire.incompleteJSON), &payload); err != nil {
				t.Fatal(err)
			}
			if result, err := parseAgentToolPayload(payload, wire.wire); result != nil || !billingFailureUncertain(err) {
				t.Fatalf("explicit incomplete JSON succeeded: %v %v", result, err)
			}
		})
	}
}
