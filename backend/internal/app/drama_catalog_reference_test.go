package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaCatalogAcceptsRequiredReference(t *testing.T) {
	svc, fake := newDramaTestService(t)
	video := dramaVideoFixture()
	video.References.MinImages = 1
	video.Operations = []string{"reference_to_video", "image_to_video"}
	video.DefaultOperation = "reference_to_video"
	setDramaVideoCapability(t, svc, fake, video)
	if issue := svc.dramaChoiceIssue(nil, fakeDramaModels.Video, "video"); issue != "" {
		t.Fatalf("reference model excluded from catalog: %s", issue)
	}
	profile, err := svc.dramaVideoProfile(fakeDramaModels.Video)
	if err != nil {
		t.Fatalf("profile: %+v, error: %v", profile, err)
	}
	if operation, _ := dramaSegmentOperation(DramaSettings{}, profile); operation != "image_to_video" {
		t.Fatalf("continuity operation = %s", operation)
	}
	config := &ModelCapabilityConfig{Version: 1, Video: &video}
	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "video")
	if err != nil {
		t.Fatal(err)
	}
	if MatchCapability(spec, *dramaModelIntent("video")).Matched {
		t.Fatal("actual empty-input requests must still require a reference")
	}
	project := createTestDrama(t, svc, DramaReviewSample).Project.ID
	runDramaTicks(t, svc, project, 24)
	requests := dramaVideoRequests(fake)
	if len(requests) < 2 {
		t.Fatalf("expected opening and continuation requests, got %d", len(requests))
	}
	continuations := 0
	for _, request := range requests {
		raw, err := json.Marshal(request.Input)
		if err != nil {
			t.Fatal(err)
		}
		var input canvasGenerationInput
		if err := json.Unmarshal(raw, &input); err != nil {
			t.Fatal(err)
		}
		operation := metadataString(input.Metadata, "videoEditOperation")
		if operation == "image_to_video" {
			continuations++
			if len(input.ReferenceImages) == 0 || input.ReferenceImages[0].Role != "first_frame" || metadataString(input.Metadata, "videoStartFrameNodeId") != "first-frame" {
				t.Fatalf("continuation must send only the real first frame: %+v", input)
			}
			segmentID := metadataString(input.Metadata, "shotId")
			var segment, previous model.DramaSegment
			if err := fake.db.First(&segment, "id = ?", segmentID).Error; err != nil {
				t.Fatal(err)
			}
			if err := fake.db.First(&previous, "episode_id = ? AND segment_index = ?", segment.EpisodeID, segment.SegmentIndex-1).Error; err != nil {
				t.Fatal(err)
			}
			if input.ReferenceImages[0].StorageKey != "resource:"+previous.TailFrameResourceID {
				t.Fatal("continuation did not use preceding segment's actual tail resource")
			}
		} else if operation != "reference_to_video" {
			t.Fatalf("video operation lost in task input: %+v", input.Metadata)
		}
		if err := validateVideoTask(&video, input); err != nil {
			t.Fatalf("actual short-drama input rejected: %v", err)
		}
	}
	if continuations == 0 {
		t.Fatal("no first-frame continuation was submitted")
	}
	video.References.MinImages = 2
	setDramaVideoCapability(t, svc, fake, video)
	if issue := svc.dramaChoiceIssue(nil, fakeDramaModels.Video, "video"); issue == "" {
		t.Fatal("single-reference catalog fallback accepted a two-reference minimum")
	}
}

func TestDramaLogicalReferenceCatalogPreservesAccessAndAdmission(t *testing.T) {
	svc, db, _ := adminLogicalModelFixture(t)
	video := dramaVideoFixture()
	video.References.MinImages = 1
	video.Operations = []string{"reference_to_video", "image_to_video"}
	video.DefaultOperation = "reference_to_video"
	config := &ModelCapabilityConfig{Version: 1, Video: &video}
	profileJSON, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "video")
	if err != nil {
		t.Fatal(err)
	}
	specJSON, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, update := range []struct {
		entity any
		id     string
		fields map[string]any
	}{
		{&model.ChannelModel{}, "healthy-cm", map[string]any{"capability": "video", "protocol": model.ChannelInterfaceVolcengineArkVideo, "capability_config_json": string(profileJSON)}},
		{&model.LogicalModel{}, "healthy", map[string]any{"capability": "video", "price_policy": "unified"}},
		{&model.LogicalModelRevision{}, "healthy-revision", map[string]any{"capability_spec_json": string(specJSON)}},
	} {
		if err := db.Model(update.entity).Where("id = ?", update.id).Updates(update.fields).Error; err != nil {
			t.Fatal(err)
		}
	}
	choice := DramaModelChoice{LogicalModelID: "healthy"}
	allowed := &userGroupAccess{group: &resolvedUserGroup{channels: map[string]bool{"channel": true}}}
	if issue := svc.dramaChoiceIssue(allowed, choice, "video"); issue != "" {
		t.Fatalf("reference logical model excluded from catalog: %s", issue)
	}
	if _, err := svc.dramaVideoProfile(choice); err != nil {
		t.Fatalf("logical model reference profile unavailable: %v", err)
	}
	if _, err := svc.ResolveLogicalModel(allowed, choice.LogicalModelID, *dramaModelIntent("video")); err == nil {
		t.Fatal("actual empty-input request bypassed the reference requirement")
	}
	denied := &userGroupAccess{group: &resolvedUserGroup{channels: map[string]bool{}}}
	if issue := svc.dramaChoiceIssue(denied, choice, "video"); issue == "" {
		t.Fatal("reference fallback bypassed the account channel restriction")
	}
}
