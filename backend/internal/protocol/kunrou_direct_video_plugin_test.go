package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func kunrouDirectAdapter(t *testing.T) Adapter {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "kivao-kunrou-video.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "kivao-kunrou-video", "manifest.json"))
	if err != nil || !bytes.Equal(pkg.ManifestRaw, manifest) {
		t.Fatal("package and source manifest differ", err)
	}
	adapter, err := LoadInstalledPlugin(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Manifest.Metadata.Version != "1.2.0" || adapter.Metadata().ID != "kivao-kunrou-video" || !adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("incorrect direct plugin identity or media policy")
	}
	return adapter
}

func TestKunrouDirectVideoFamilyRequests(t *testing.T) {
	adapter := kunrouDirectAdapter(t)
	for _, model := range []string{"gemini-veo-3.1-fast", "gemini-veo-3.1-lite", "gemini-omni-1.1-flash", "grok-imagine-video", "grok-imagine-video-1.5", "sd2.0-fast-480p", "sd2.0-fast-720p", "sd2.0-mini-480p", "sd2.0-mini-720p"} {
		t.Run(model, func(t *testing.T) {
			resolution := "720p"
			if strings.HasSuffix(model, "480p") {
				resolution = "480p"
			}
			r := GenerationRequest{Capability: CapabilityVideo, Model: model, Prompt: "  waves  ", Duration: 8, Resolution: resolution, AspectRatio: "9:16", GenerateAudio: true,
				Images: []MediaReference{{URL: "https://example.invalid/first.jpg", Role: "first_frame"}}}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if spec.Method != "POST" || spec.ContentType != "application/json" || spec.Auth.Type != "bearer" || spec.Auth.Field != "apiKey" || body["model"] != model || body["prompt"] != "waves" {
				t.Fatalf("incorrect authenticated request: %#v", spec)
			}
			wantPath := "/v1/videos"
			want := map[string]any{"model": model, "prompt": "waves", "resolution": resolution, "aspect_ratio": "9:16"}
			switch {
			case strings.HasPrefix(model, "sd2.0-"):
				wantPath = "/v1/tasks/sora"
				want["seconds"], want["ratio"] = "8", "9:16"
				want["images"] = []any{"https://example.invalid/first.jpg"}
			case strings.HasPrefix(model, "grok-"):
				want["duration"], want["generate_audio"] = float64(8), true
				want["image"] = map[string]any{"url": "https://example.invalid/first.jpg"}
			default:
				want["seconds"], want["input_reference"] = "8", "https://example.invalid/first.jpg"
			}
			if spec.Path != wantPath || !reflect.DeepEqual(body, want) {
				t.Fatalf("wire mismatch: path=%s body=%#v want=%#v", spec.Path, body, want)
			}
		})
	}
}

func TestKunrouDirectVideoTextFramesAndAudioSwitch(t *testing.T) {
	adapter := kunrouDirectAdapter(t)
	for _, model := range []string{"grok-imagine-video", "sd2.0-mini-480p", "gemini-veo-3.1-fast"} {
		t.Run(model, func(t *testing.T) {
			r := GenerationRequest{Capability: CapabilityVideo, Model: model, Prompt: "waves", Duration: 8}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			for _, key := range []string{"images", "image", "input_reference", "reference_images", "reference_videos"} {
				if _, ok := body[key]; ok {
					t.Fatalf("text request contains %s", key)
				}
			}
			if strings.HasPrefix(model, "grok-") && body["generate_audio"] != false {
				t.Fatal("explicit false audio option was lost")
			}
		})
	}
	r := GenerationRequest{Model: "gemini-veo-3.1-fast", Prompt: "waves", Duration: 8, Resolution: "720p", AspectRatio: "16:9",
		Images: []MediaReference{{URL: "https://example.invalid/frame.png", Role: "first_frame"}}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["size"] != "1280x720" || body["input_reference"] != r.Images[0].URL || body["resolution"] != nil || body["aspect_ratio"] != nil {
		t.Fatalf("verified single-frame shape changed: %#v", body)
	}
}

func TestKunrouDirectVideoRejectsUnsupportedInput(t *testing.T) {
	adapter := kunrouDirectAdapter(t)
	for _, tc := range []struct {
		name, model string
		change      func(*GenerationRequest)
	}{
		{"old gateway name", "kivao/gemini-veo-3.1-fast", func(r *GenerationRequest) {}},
		{"unknown model", "unknown", func(r *GenerationRequest) {}},
		{"excluded 10s alias", "gemini-omni-1.1-flash-10s", func(r *GenerationRequest) {}},
		{"blank prompt", "grok-imagine-video", func(r *GenerationRequest) { r.Prompt = "  " }},
		{"short SD", "sd2.0-fast-480p", func(r *GenerationRequest) { r.Duration = 3 }},
		{"long Grok", "grok-imagine-video", func(r *GenerationRequest) { r.Duration = 16 }},
		{"negative duration", "grok-imagine-video", func(r *GenerationRequest) { r.Duration = -1 }},
		{"wrong SD resolution", "sd2.0-fast-480p", func(r *GenerationRequest) { r.Resolution = "720p" }},
		{"SD data URL", "sd2.0-fast-480p", func(r *GenerationRequest) { r.Images = []MediaReference{{DataURL: "data:image/png;base64,dGVzdA=="}} }},
		{"SD tail", "sd2.0-fast-480p", func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://example.invalid/a.jpg", Role: "last_frame"}}
		}},
		{"Grok 1080", "grok-imagine-video", func(r *GenerationRequest) { r.Resolution = "1080p" }},
		{"Grok two images", "grok-imagine-video", func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://example.invalid/1.jpg"}, {URL: "https://example.invalid/2.jpg"}}
		}},
		{"Grok empty image", "grok-imagine-video", func(r *GenerationRequest) { r.Images = []MediaReference{{}} }},
		{"Grok tail", "grok-imagine-video", func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://example.invalid/a.jpg", Role: "last_frame"}}
		}},
		{"Grok video reference", "grok-imagine-video", func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "https://example.invalid/a.mp4"}} }},
		{"Veo wrong duration", "gemini-veo-3.1-fast", func(r *GenerationRequest) { r.Duration = 10 }},
		{"Veo high res duration", "gemini-veo-3.1-fast", func(r *GenerationRequest) { r.Duration = 4; r.Resolution = "1080p" }},
		{"Lite 4k", "gemini-veo-3.1-lite", func(r *GenerationRequest) { r.Resolution = "4k" }},
		{"Omni short", "gemini-omni-1.1-flash", func(r *GenerationRequest) { r.Duration = 2 }},
		{"Omni long", "gemini-omni-1.1-flash", func(r *GenerationRequest) { r.Duration = 11 }},
		{"Veo square", "gemini-veo-3.1-fast", func(r *GenerationRequest) { r.AspectRatio = "1:1" }},
		{"Lite reference", "gemini-veo-3.1-lite", func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://example.invalid/a.jpg", Role: "reference_image"}}
		}},
		{"Veo orphan tail", "gemini-veo-3.1-fast", func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://example.invalid/a.jpg", Role: "last_frame"}}
		}},
		{"audio reference", "gemini-veo-3.1-fast", func(r *GenerationRequest) { r.Audios = []MediaReference{{URL: "https://example.invalid/a.mp3"}} }},
		{"watermark", "grok-imagine-video", func(r *GenerationRequest) { r.Watermark = true }},
		{"unmapped options", "sd2.0-mini-480p", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"kivao-kunrou-video": {"foo": true}}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := GenerationRequest{Capability: CapabilityVideo, Model: tc.model, Prompt: "waves", Duration: 8}
			tc.change(&r)
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
}

func TestKunrouDirectVideoPreservesGoogleFramesAndReferences(t *testing.T) {
	adapter := kunrouDirectAdapter(t)
	for _, tc := range []struct {
		name, model, resolution, field string
		seconds                        int
		images, videos                 []MediaReference
	}{
		{"Lite frames", "gemini-veo-3.1-lite", "1080p", "reference_images", 8,
			[]MediaReference{{URL: "https://example.invalid/first.jpg", Role: "first_frame"}, {URL: "https://example.invalid/last.jpg", Role: "last_frame"}}, nil},
		{"Fast references", "gemini-veo-3.1-fast", "720p", "reference_images", 8,
			[]MediaReference{{URL: "https://example.invalid/ref.jpg", Role: "reference_image"}}, nil},
		{"Fast extension", "gemini-veo-3.1-fast", "720p", "reference_videos", 8,
			nil, []MediaReference{{URL: "https://example.invalid/veo.mp4"}}},
		{"Omni minimum", "gemini-omni-1.1-flash", "360p", "", 3, nil, nil},
		{"Omni maximum", "gemini-omni-1.1-flash", "4k", "", 10, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := GenerationRequest{Model: tc.model, Prompt: "waves", Images: tc.images, Videos: tc.videos,
				Output: OutputOptions{Duration: tc.seconds, Resolution: tc.resolution, AspectRatio: "9:16"}}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if body["resolution"] != tc.resolution || (tc.field != "" && body[tc.field] == nil) {
				t.Fatalf("Google mapping changed: %#v", body)
			}
		})
	}
	r := GenerationRequest{Model: "gemini-veo-3.1-fast", Prompt: "waves", Duration: 6,
		Images: []MediaReference{{URL: "https://example.invalid/ref.jpg", Role: "reference_image"}}}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
		t.Fatal("Veo reference images must still require 8 seconds")
	}
}

func TestKunrouDirectVideoLocalCreatePollContent(t *testing.T) {
	adapter := kunrouDirectAdapter(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer local-test" {
			t.Error("missing channel authentication")
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"id":"direct-task","status":"queued"}`)
		case "GET /v1/videos/direct-task":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"id":"direct-task","status":"completed"}`)
		case "GET /v1/videos/direct-task/content":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = io.WriteString(w, "stub-video-only")
		default:
			t.Errorf("unexpected method/path %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	send := func(spec RequestSpec) []byte {
		t.Helper()
		body, err := json.Marshal(spec.Body)
		if err != nil {
			t.Fatal(err)
		}
		r, err := http.NewRequest(spec.Method, server.URL+spec.Path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Authorization", "Bearer local-test")
		response, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != 200 {
			t.Fatal("stub HTTP request failed", err)
		}
		return raw
	}
	r := GenerationRequest{Capability: CapabilityVideo, Model: "grok-imagine-video", Prompt: "waves", Duration: 6}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	created, err := adapter.ParseCreate(context.Background(), send(spec))
	if err != nil || created.TaskID != "direct-task" || created.Status != StatusPending {
		t.Fatalf("create: %#v %v", created, err)
	}
	c := PollContext{TaskID: created.TaskID, Model: r.Model, Request: r}
	spec, err = adapter.BuildPoll(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	state, err := adapter.ParsePoll(context.Background(), c, send(spec))
	if err != nil || state.Status != StatusSucceeded {
		t.Fatalf("completion without URL must reach content download: %#v %v", state, err)
	}
	spec, err = adapter.(ResultAdapter).BuildResult(context.Background(), c)
	if err != nil || spec.Auth.Type != "bearer" || spec.Headers["Accept"] != "video/mp4" || string(send(spec)) != "stub-video-only" {
		t.Fatal("authenticated content download failed", err)
	}
	for _, raw := range []string{`{"status":"failed","error":{"message":"denied"}}`, `{"status":"unknown","video_url":"https://example.invalid/video.mp4"}`, `{"status":"queued","video_url":"https://example.invalid/video.mp4"}`} {
		state, err := adapter.ParsePoll(context.Background(), c, []byte(raw))
		if err == nil && state.Status == StatusSucceeded {
			t.Fatalf("invalid success: %s", raw)
		}
	}
	c.Model, c.Request.Model = "sd2.0-mini-480p", "sd2.0-mini-480p"
	state, err = adapter.ParsePoll(context.Background(), c, []byte(`{"status":"completed"}`))
	if err != nil || state.Status == StatusSucceeded {
		t.Fatal("SD completion without required link accepted")
	}
	state, err = adapter.ParsePoll(context.Background(), c, []byte(`{"status":"completed","result":{"video_url":"https://example.invalid/output.mp4"}}`))
	if err != nil || state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || !state.Result.Videos[0].Ephemeral {
		t.Fatal("SD URL not handed to host for persistence", err)
	}
}
