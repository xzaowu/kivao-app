package app

import "strings"

func commerceStudioAnthropicWireForBaseURL(baseURL string) bool {
	u := strings.ToLower(strings.TrimSpace(baseURL))
	if u == "" {
		return false
	}
	if strings.Contains(u, "api.anthropic.com") {
		return true
	}
	if strings.Contains(u, "/anthropic") || strings.Contains(u, "/claude") {
		return true
	}
	return false
}
