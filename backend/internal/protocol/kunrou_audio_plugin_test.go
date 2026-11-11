package protocol

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func kunrouAudioAdapter(t *testing.T) Adapter {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "kunrou-chat-audio.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := LoadInstalledPlugin(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if adapter.Metadata().ID != "kunrou-chat-audio" || !strings.Contains(string(pkg.ManifestRaw), "audio") {
		t.Fatal("unexpected plugin identity")
	}
	return adapter
}

func TestKunrouAudioDocumentedModelsBuildChatRequests(t *testing.T) {
	adapter := kunrouAudioAdapter(t)
	for _, model := range []string{"gemini-3.8-flash-tts", "grok-voice-latest", "lyria-3.5-m", "lyria-3-pro-m", "suno-v6-mini"} {
		t.Run(model, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: model, Prompt: "朗读测试或创作音乐", Extra: map[string]any{"audioFormat": "wav", "audioVoice": "alloy", "audioSpeed": "1", "audioInstructions": "温和的声音"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := spec.Body.(map[string]any)
			if spec.Method != http.MethodPost || spec.Path != "/v1/chat/completions" || spec.Auth.Type != "bearer" || body["model"] != model || body["audio_format"] != "wav" || body["stream"] != false {
				t.Fatalf("unexpected request: %#v", spec)
			}
			messages := body["messages"].([]any)
			if len(messages) != 1 || messages[0].(map[string]any)["role"] != "user" || messages[0].(map[string]any)["content"] != "朗读测试或创作音乐\n温和的声音" {
				t.Fatalf("messages = %#v", messages)
			}
			for _, field := range []string{"input", "voice", "speed", "response_format"} {
				if _, present := body[field]; present {
					t.Fatalf("unexpected OpenAI Speech field %s", field)
				}
			}
		})
	}
}

func TestKunrouAudioRejectsUnsupportedOptionsBeforeSending(t *testing.T) {
	adapter := kunrouAudioAdapter(t)
	for _, test := range []struct {
		name, model, prompt string
		extra               map[string]any
	}{
		{"missing-suffix", "lyria-3.5", "music", nil},
		{"unknown-model", "unknown", "music", nil},
		{"empty-prompt", "suno-v6-mini", "", nil},
		{"unsupported-format", "suno-v6-mini", "music", map[string]any{"audioFormat": "opus"}},
		{"unsupported-voice", "grok-voice-latest", "hello", map[string]any{"audioVoice": "nova"}},
		{"unsupported-speed", "grok-voice-latest", "hello", map[string]any{"audioSpeed": "1.5"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: test.model, Prompt: test.prompt, Extra: test.extra}})
			if err == nil {
				t.Fatal("unsupported request was accepted")
			}
		})
	}
}

func TestKunrouAudioPreservesMusicOptionsAndReferences(t *testing.T) {
	adapter := kunrouAudioAdapter(t)
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "lyria-3-pro-m", Prompt: "forest music", Images: []MediaReference{{URL: "https://example.com/forest.png"}},
		ProviderOptions: map[string]map[string]any{"kunrou-chat-audio": {"instrumental": true, "lyrics": "test lyrics", "duration": 60, "bpm": 80}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["audio_format"] != "mp3" || body["instrumental"] != true || body["lyrics"] != "test lyrics" || body["duration"] != float64(60) || body["bpm"] != float64(80) {
		t.Fatalf("music options = %#v", body)
	}
	refs := body["reference_images"].([]any)
	if len(refs) != 1 || refs[0] != "https://example.com/forest.png" {
		t.Fatalf("references = %#v", refs)
	}
}

func TestKunrouAudioStubReturnsDownloadableMedia(t *testing.T) {
	adapter := kunrouAudioAdapter(t)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/audio.wav" {
			w.Header().Set("Content-Type", "audio/wav")
			_, _ = w.Write([]byte("RIFFtestWAVE"))
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"url": server.URL + "/audio.wav", "mime_type": "audio/wav"}}, "usage": map[string]any{"total_tokens": 0}})
	}))
	defer server.Close()
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "lyria-3.5-m", Prompt: "local stub"}})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(spec.Body)
	response, err := server.Client().Post(server.URL+spec.Path, "application/json", strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	result, err := adapter.ParseCreate(context.Background(), raw)
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Audios) != 1 {
		t.Fatalf("parse: %#v, %v", result, err)
	}
	audio := result.Result.Audios[0]
	if audio.MIMEType != "audio/wav" || !audio.Ephemeral {
		t.Fatalf("audio = %#v", audio)
	}
	download, err := server.Client().Get(audio.URL)
	if err != nil {
		t.Fatal(err)
	}
	content, err := io.ReadAll(download.Body)
	_ = download.Body.Close()
	if err != nil || string(content) != "RIFFtestWAVE" {
		t.Fatalf("download: %q, %v", content, err)
	}
}

func TestKunrouAudioFailureCannotBecomeSuccessfulText(t *testing.T) {
	adapter := kunrouAudioAdapter(t)
	for _, raw := range []string{
		`{"error":{"code":"denied","message":"failed"}}`,
		`{"choices":[{"message":{"content":"[音频](https://example.com/a.mp3)"}}]}`,
		`{"data":[]}`,
		`{"data":[{"url":"https://example.com/a.mp3"}],"error":{"code":"failed"}}`,
	} {
		result, err := adapter.ParseCreate(context.Background(), []byte(raw))
		if err != nil || result.Status != StatusFailed {
			t.Fatalf("response %s: %#v, %v", raw, result, err)
		}
	}
	if _, err := adapter.ParseCreate(context.Background(), []byte("invalid JSON")); err == nil {
		t.Fatal("invalid JSON was accepted")
	}
}
