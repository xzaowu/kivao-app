package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/protocol"
)

// 使用显式提供的历史包副本，经过真实插件启动流程；不构造 Service 或 Worker，
// 不连接数据库、不加载业务密钥、不发送 HTTP。所有响应是内存 Stub。
func TestKivaoImportedPluginsSurviveStartup(t *testing.T) {
	root := os.Getenv("KIVAO_IMPORT_PLUGIN_FIXTURE_DIR")
	if root == "" {
		t.Skip("requires explicitly prepared offline plugin fixture")
	}
	raw, err := os.ReadFile(filepath.Join(root, "target", "plugin_registry.json"))
	if err != nil {
		t.Fatal("plugin fixture missing")
	}
	var records []pluginRegistryRecord
	if json.Unmarshal(raw, &records) != nil || len(records) != 2 {
		t.Fatal("plugin fixture invalid")
	}
	for _, origin := range []string{PluginOriginOfficial, PluginOriginUploaded} {
		t.Run(origin, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.Mkdir(filepath.Join(dir, "plugin-packages"), 0700); err != nil {
				t.Fatal(err)
			}
			copied := append([]pluginRegistryRecord(nil), records...)
			for i := range copied {
				r := &copied[i]
				if (r.ID != "kunrou-chat-audio" && r.ID != "kivao-kunrou-video") || r.PackagePath != filepath.Base(r.PackagePath) {
					t.Fatal("unexpected fixture identity")
				}
				r.Source = origin
				data, e := os.ReadFile(filepath.Join(root, "target", "plugin-packages", r.PackagePath))
				if e != nil {
					t.Fatal("fixture package missing")
				}
				sum := sha256.Sum256(data)
				if hex.EncodeToString(sum[:]) != r.PackageSHA256 {
					t.Fatal("fixture package hash mismatch")
				}
				if e := os.WriteFile(filepath.Join(dir, "plugin-packages", r.PackagePath), data, 0600); e != nil {
					t.Fatal(e)
				}
			}
			encoded, _ := json.Marshal(copied)
			if err := os.WriteFile(filepath.Join(dir, "plugin_registry.json"), encoded, 0600); err != nil {
				t.Fatal(err)
			}
			for restart := 0; restart < 2; restart++ {
				center, err := newPluginRuntime(dir)
				if err != nil {
					t.Fatalf("offline plugin fixture startup failed: %v", err)
				}
				for _, expected := range copied {
					installed, exists := center.plugins[expected.ID]
					if origin == PluginOriginOfficial {
						if exists {
							t.Fatal("old official fixture unexpectedly retained; recheck reconciliation assumptions")
						}
						continue
					}
					var manifest protocol.Manifest
					if json.Unmarshal(expected.Raw, &manifest) != nil {
						t.Fatal("fixture manifest invalid")
					}
					if !exists || installed.Source != PluginOriginUploaded || installed.PackageSHA256 != expected.PackageSHA256 || installed.Metadata.Version != manifest.Metadata.Version || installed.Metadata.Enabled != manifest.Metadata.Enabled {
						t.Fatal("independent plugin identity changed during startup")
					}
					adapter, ok := center.registrySnapshot().Get(expected.ID)
					if !ok {
						t.Fatal("imported protocol unavailable")
					}
					if expected.ID == "kunrou-chat-audio" {
						kivaoImportedAudioStub(t, adapter)
					} else {
						kivaoImportedVideoStub(t, adapter)
					}
				}
			}
		})
	}
}

func kivaoImportedAudioStub(t *testing.T, adapter protocol.Adapter) {
	t.Helper()
	ctx := context.Background()
	request := protocol.GenerationRequest{Capability: protocol.CapabilityAudio, Model: "gemini-3.8-flash-tts", Prompt: "synthetic speech", Extra: map[string]any{"audioFormat": "mp3"}}
	spec, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: "https://provider.invalid", Request: request})
	if err != nil || spec.Method != "POST" || spec.Path != "/v1/chat/completions" {
		t.Fatal("audio create contract changed")
	}
	body, ok := spec.Body.(map[string]any)
	if !ok || body["stream"] != false || body["model"] != request.Model {
		t.Fatal("audio request body changed")
	}
	request.Model = "unsupported-fixture"
	if _, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: "https://provider.invalid", Request: request}); err == nil {
		t.Fatal("audio model validation lost")
	}
	result, err := adapter.ParseCreate(ctx, []byte(`{"data":[{"url":"https://media.invalid/fixture.mp3","mime_type":"audio/mpeg"}],"usage":{"output_seconds":3}}`))
	if err != nil || result.Status != protocol.StatusSucceeded || result.Result == nil || len(result.Result.Audios) != 1 || result.Result.Audios[0].URL != "https://media.invalid/fixture.mp3" {
		t.Fatal("audio response parsing changed")
	}
	failed, err := adapter.ParseCreate(ctx, []byte(`{"message":"no output"}`))
	if err == nil && failed.Status != protocol.StatusFailed {
		t.Fatal("empty audio output accepted")
	}
}

func kivaoImportedVideoStub(t *testing.T, adapter protocol.Adapter) {
	t.Helper()
	ctx := context.Background()
	request := protocol.GenerationRequest{Capability: protocol.CapabilityVideo, Model: "sd2.0-fast-720p", Prompt: "synthetic product video", Output: protocol.OutputOptions{Duration: 15, Resolution: "720p", AspectRatio: "9:16"}}
	spec, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: "https://provider.invalid", Request: request})
	if err != nil {
		t.Fatalf("synthetic video request rejected: %v", err)
	}
	if spec.Method != "POST" || spec.Path != "/v1/tasks/sora" {
		t.Fatal("direct video create contract changed")
	}
	body, ok := spec.Body.(map[string]any)
	if !ok || body["model"] != request.Model || body["seconds"] != "15" || body["resolution"] != "720p" || body["ratio"] != "9:16" {
		t.Fatal("video output options changed")
	}
	googleRequest := protocol.GenerationRequest{Capability: protocol.CapabilityVideo, Model: "gemini-veo-3.1-fast", Prompt: "synthetic product video", Output: protocol.OutputOptions{Duration: 8, Resolution: "720p", AspectRatio: "9:16"}}
	googleSpec, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: "https://provider.invalid", Request: googleRequest})
	if err != nil || googleSpec.Method != "POST" || googleSpec.Path != "/v1/videos" {
		t.Fatal("video model-specific create route changed")
	}
	created, err := adapter.ParseCreate(ctx, []byte(`{"id":"fixture-task","status":"queued"}`))
	if err != nil || created.TaskID != "fixture-task" {
		t.Fatal("video task identity missing")
	}
	pollContext := protocol.PollContext{BaseURL: "https://provider.invalid", TaskID: "fixture-task", Model: request.Model, Request: request}
	poll, err := adapter.BuildPoll(ctx, pollContext)
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/videos/fixture-task" {
		t.Fatal("video poll contract changed")
	}
	result, err := adapter.ParsePoll(ctx, pollContext, []byte(`{"id":"fixture-task","status":"completed","video_url":"https://media.invalid/fixture.mp4"}`))
	if err != nil || result.Status != protocol.StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://media.invalid/fixture.mp4" {
		t.Fatal("video result parsing changed")
	}
	pending, err := adapter.ParsePoll(ctx, pollContext, []byte(`{"id":"fixture-task","status":"completed"}`))
	if err != nil || pending.Status != protocol.StatusProcessing {
		t.Fatal("video completed without media must keep polling")
	}
	failed, err := adapter.ParsePoll(ctx, pollContext, []byte(`{"id":"fixture-task","status":"failed","error":{"message":"stub failure"}}`))
	if err == nil && failed.Status != protocol.StatusFailed {
		t.Fatal("video failure accepted as success")
	}
}
