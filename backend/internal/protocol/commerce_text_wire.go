package protocol

import "strings"

const (
	TextWireChatCompletion = "chat-completion"
	TextWireResponses      = "responses"
	TextWireClaude         = "claude-api"
)

func OperationPath(summary string) string {
	_, path, ok := strings.Cut(strings.TrimSpace(summary), " ")
	if !ok {
		return ""
	}
	return strings.TrimSpace(path)
}
