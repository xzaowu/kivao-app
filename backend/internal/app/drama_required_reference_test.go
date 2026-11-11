package app

import (
	"strings"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// 强制参考图的模型遇到发不出参考图的剧情段：预演写明原因，不提交注定被准入拒收的视频任务。
func TestDramaReferenceOnlyModelRefusesSegmentWithoutImages(t *testing.T) {
	svc, fake := newDramaTestService(t)
	video := dramaVideoFixture()
	video.References.MinImages = 1
	video.Operations = []string{"reference_to_video", "image_to_video"}
	video.DefaultOperation = "reference_to_video"
	setDramaVideoCapability(t, svc, fake, video)
	// 参考图全部生成失败：开场段没有可发送的参考图。
	fake.fail = func(req CreateTaskRequest) bool { return req.Type == "canvas_image" }
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	if got := len(dramaVideoRequests(fake)); got != 0 {
		t.Fatalf("segments without reference images must not be submitted: %d requests", got)
	}
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	segments, _ := svc.repo.DramaSegments(summary.Episodes[0].ID)
	if len(segments) == 0 || segments[0].VideoStatus != model.DramaMediaFailed || !strings.Contains(segments[0].VideoError, "至少需要 1 张参考图") {
		t.Fatalf("the segment must fail with the reference requirement: %+v", segments)
	}
}

// 默认视频模型优先选不强制参考图的；只有强制参考图的模型时才选它。
func TestPreferredDramaOptionAvoidsReferenceOnlyModels(t *testing.T) {
	settings := DramaSettings{Settings: production.Settings{AspectRatio: "9:16"}, VideoContinuity: DramaContinuityTailFrame}
	referenceOnly := DramaModelOption{Capability: "video", Choice: DramaModelChoice{ChannelID: "reference-only"}, MinReferenceImages: 1, TailFrameChain: true, VideoRatios: []string{"9:16"}}
	textCapable := DramaModelOption{Capability: "video", Choice: DramaModelChoice{ChannelID: "text-capable"}, TailFrameChain: true, VideoRatios: []string{"9:16"}}
	if option, ok := preferredDramaOption([]DramaModelOption{referenceOnly, textCapable}, settings); !ok || option.Choice.ChannelID != "text-capable" {
		t.Fatalf("default must skip reference-only models when another fits: %+v", option)
	}
	if option, ok := preferredDramaOption([]DramaModelOption{referenceOnly}, settings); !ok || option.Choice.ChannelID != "reference-only" {
		t.Fatalf("reference-only model must still be the default when nothing else fits: %+v", option)
	}
}
