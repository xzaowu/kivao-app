package protocol

import (
	"context"
	"testing"
)

func TestVolcengineMediaKitVideoDepthRequest(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-mediakit-video-depth.yingce-plugin", "volcengine-mediakit-video-depth")
	if metadata := adapter.Metadata(); !metadata.Kind.IsProcessing() || !metadata.RequiresPublicMediaURLs {
		t.Fatalf("depth metadata = %#v", metadata)
	}
	request := RequestContext{Request: GenerationRequest{
		Model: "standard", Prompt: "do not forward", Resolution: "4k",
		Videos:          []MediaReference{{URL: "https://cdn.example/source.mp4"}},
		ProviderOptions: map[string]map[string]any{"volcengine-mediakit-video-depth": {"fps": 120, "bitrate": 9000}},
		Extra:           map[string]any{"idempotencyKey": "depth-attempt-1"},
	}}
	spec, err := adapter.BuildCreate(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.Path != "/api/v1/tools/video-depth" {
		t.Fatalf("create spec = %#v", spec)
	}
	body := manifestTestBody(t, spec)
	if len(body) != 3 || body["video_url"] != "https://cdn.example/source.mp4" || body["model"] != "standard" || body["client_token"] != "depth-attempt-1" {
		t.Fatalf("depth payload contains wrong or unsupported fields: %#v", body)
	}
	for _, videos := range [][]MediaReference{nil, {{URL: "https://cdn.example/a.mp4"}, {URL: "https://cdn.example/b.mp4"}}} {
		request.Request.Videos = videos
		if _, err := adapter.BuildCreate(context.Background(), request); err == nil {
			t.Fatal("expected exactly one source video")
		}
	}
}

func TestVolcengineMediaKitVideoDepthLifecycle(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-mediakit-video-depth.yingce-plugin", "volcengine-mediakit-video-depth")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"success":true,"task_id":"depth-1"}`))
	if err != nil || created.TaskID != "depth-1" || created.Status == StatusFailed {
		t.Fatalf("create response = %#v, err=%v", created, err)
	}
	rejected, err := adapter.ParseCreate(context.Background(), []byte(`{"success":false,"error":{"code":"InvalidParameter","message":"bad video"}}`))
	if err != nil || rejected.Status != StatusFailed {
		t.Fatalf("rejection = %#v, err=%v", rejected, err)
	}
	poll := PollContext{TaskID: created.TaskID}
	spec, err := adapter.BuildPoll(context.Background(), poll)
	if err != nil || spec.Method != "GET" || spec.Path != "/api/v1/tasks/depth-1" {
		t.Fatalf("poll = %#v, err=%v", spec, err)
	}
	processing, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"status":"running","task_id":"depth-1"}`))
	if err != nil || processing.Status != StatusProcessing {
		t.Fatalf("processing = %#v, err=%v", processing, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"status":"completed","task_id":"depth-1","result":{"video_url":"https://cdn.example/depth.mp4","duration":18.625}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Videos) != 1 || completed.Result.Videos[0].URL != "https://cdn.example/depth.mp4" || completed.Result.Usage["outputDurationSeconds"] != 18.625 {
		t.Fatalf("result = %#v, err=%v", completed, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"status":"failed","error":{"code":"DownloadFailed","message":"cannot download"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "cannot download" {
		t.Fatalf("failure = %#v, err=%v", failed, err)
	}
}
