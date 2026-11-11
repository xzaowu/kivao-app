package app

import "testing"

func TestAgentToolMentionsRemainReadableAndDelimited(t *testing.T) {
	input := "请用 @[tool:image:12:%E5%95%86%E5%93%81%3A%5D%25%22%5C:Image] 和 @[tool:image:3:%ZZ:Image]"
	want := "请用 @[tool:image:12:商品%3A%5D%25%22%5C:Image] 和 @[tool:image:3:%ZZ:Image]"
	if got := readableAgentToolMentions(input); got != want {
		t.Fatalf("got %q", got)
	}
	part := map[string]interface{}{"type": "text", "text": input}
	image := map[string]interface{}{"type": "image_url", "image_url": "https://example.invalid/image"}
	message := map[string]interface{}{"role": "user", "content": []interface{}{part, image}}
	got := readableAgentMessages([]map[string]interface{}{message})
	parts := got[0]["content"].([]interface{})
	if parts[0].(map[string]interface{})["text"] != want || part["text"] != input || parts[1].(map[string]interface{})["image_url"] != image["image_url"] {
		t.Fatal("text copy or media preservation failed")
	}
}

func TestAgentCanonicalOmitsOnlyEmptyAssistantHistory(t *testing.T) {
	got := cloudAgentCanonical("system", []providerTextMessage{{Role: "assistant", Content: " \n"}, {Role: "user", Content: "before"}, {Role: "assistant", Content: "answer"}}, "next", CloudAgentRequest{})
	if len(got.Messages) != 3 || got.Messages[0]["content"] != "before" || got.Messages[1]["content"] != "answer" || got.Messages[2]["content"] != "next" {
		t.Fatalf("unexpected history: %#v", got.Messages)
	}
}
