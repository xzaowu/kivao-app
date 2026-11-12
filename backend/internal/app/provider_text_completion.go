package app

// A received response is not proof of a completed generation or of zero cost.
// Keep this typed so billing and compatibility retries do not depend on translated
// error strings or on untrusted provider messages.
type providerTextCompletionError struct {
	reason string
	cause  error
}

func (e providerTextCompletionError) Error() string {
	message := "文本响应未完整结束"
	switch e.reason {
	case "incomplete":
		message = "文本生成未完成"
	case "failed":
		message = "文本生成未正常完成"
	case "invalid":
		message = "文本响应或工具参数不完整"
	}
	return message + "；请先核对任务状态和费用，勿立即重试。"
}

func (e providerTextCompletionError) Unwrap() error { return e.cause }

func validateTextCompletionPayload(payload map[string]interface{}, protocol string) error {
	switch protocol {
	case "responses":
		return validateTextCompletionReason(protocol, stringField(payload, "status"))
	case "claude-api":
		return validateTextCompletionReason(protocol, stringField(payload, "stop_reason"))
	default:
		if choices := interfaceSlice(payload["choices"]); len(choices) > 0 {
			choice, _ := choices[0].(map[string]interface{})
			return validateTextCompletionReason(protocol, stringField(choice, "finish_reason"))
		}
		return nil
	}
}

// JSON fallbacks may omit termination metadata. When supplied, however, an
// unsuccessful or unknown status must not turn partial output into a success.
func validateTextCompletionReason(protocol, reason string) error {
	if reason == "" {
		return nil
	}
	switch protocol {
	case "responses":
		if reason == "completed" {
			return nil
		}
	case "claude-api":
		if reason == "end_turn" || reason == "stop_sequence" || reason == "tool_use" {
			return nil
		}
	default:
		if reason == "stop" || reason == "tool_calls" || reason == "function_call" {
			return nil
		}
	}
	return providerTextCompletionError{reason: "incomplete"}
}
