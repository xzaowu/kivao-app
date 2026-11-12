package app

import (
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestSystemProxyTextStreamCompletionScope(t *testing.T) {
	for _, wire := range textCompletionFixtures() {
		for _, scenario := range []struct {
			name, body string
			invalid    bool
		}{
			{"complete", wire.delta + wire.end, false},
			{"complete_without_text", wire.end, false},
			{"incomplete", wire.delta + wire.incomplete, true},
			{"no_terminal", wire.delta, true},
			{"complete_tool_without_terminal", wire.tool, true},
			{"empty", "", true},
			{"malformed_after_complete", wire.delta + wire.end + "data: {", true},
			{"error_with_private_detail", wire.delta + "event: error\ndata: {\"error\":{\"message\":\"private-sentinel\"}}\n\n", true},
		} {
			t.Run(wire.wire+"/"+scenario.name, func(t *testing.T) {
				err := ValidateSystemProxyTextStream(wire.wire, []byte(scenario.body))
				if (err != nil) != scenario.invalid {
					t.Fatalf("invalid=%v err=%v", scenario.invalid, err)
				}
				if err != nil {
					var completion providerTextCompletionError
					if !errors.As(err, &completion) || strings.Contains(err.Error(), "private-sentinel") {
						t.Fatalf("completion error contract lost: %v", err)
					}
				}
			})
		}
	}
	for _, protocol := range []model.ChannelInterfaceType{model.ChannelInterfaceOpenAIImage, model.ChannelInterfaceMiniMaxVideo, "unknown-text-plugin"} {
		if err := ValidateSystemProxyTextStream(string(protocol), []byte("data: vendor-specific\n\n")); err != nil {
			t.Fatalf("unrelated protocol %q was interpreted as text: %v", protocol, err)
		}
	}
	// A raw proxy response need not be executable by the local Agent runtime.
	if err := ValidateSystemProxyTextStream("responses", []byte("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"web_search_call\",\"status\":\"completed\"}]}}\n\n")); err != nil {
		t.Fatalf("completed native tool response rejected: %v", err)
	}
}
