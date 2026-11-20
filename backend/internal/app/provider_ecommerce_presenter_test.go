package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommercePresenterWireContract(t *testing.T) {
	svc, _, _ := agentMediaFixture(t)
	channel, err := svc.repo.ChannelModelByKey("channel", "seedance-test")
	if err != nil {
		t.Fatal(err)
	}
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "seedance-test").Video
	profile.Ratios = append(profile.Ratios, "adaptive")
	for _, entry := range []struct {
		id, model string
		capable   bool
	}{
		{"volcengine-ark-video", "seedance-2.0", true}, {"volcengine-ark-agent-plan-video", "seedance-2.0", true},
		{"volcengine-ark-seedance-25", "doubao-seedance-2-5-260628", true}, {"minimax-video", "MiniMax-H3", true},
		{"newapi-channel-2", "seedance", true}, {"km-kemei-video", "seedance2.0", true},
		{"dashscope-wan-video", "wan2.6-i2v", true}, {"dashscope-wan3-video", "wan3.0-video-prime", true},
		{"lxmone-wan-channel-s", "wan3.0-video-prime", true}, {"lxmone-grok-videos", "grok-imagine-video", true},
		{"maxforai-videos", "seedance", true}, {"maxforai-video-generations", "seedance", true},
		{"seedance-videos-compatible", "seedance-2.0", false}, {"newapi-channel-1", "seedance", false},
	} {
		t.Run(entry.id, func(t *testing.T) {
			item := *channel
			item.Protocol = model.ChannelInterfaceType(entry.id)
			item.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, &ModelCapabilityConfig{Video: profile})
			catalog, err := svc.sanitizeChannelModel(&item)
			if err != nil {
				t.Fatal(err)
			}
			if advertised := catalog.CapabilityConfig["video"].(map[string]any)["presenterFirstFrameAudio"] == true; advertised != entry.capable {
				t.Fatalf("catalog advertised %v", advertised)
			}
			input := canvasGenerationInput{
				Mode: "video", Prompt: "intro\nspoken copy",
				Config:          providerConfig{InterfaceType: entry.id, Model: entry.model, VideoSeconds: "15", VideoGenerateAudio: "true", Size: "9:16", VQuality: "720p"},
				ReferenceImages: []providerMedia{{ID: "actor", URL: "https://media.example/frame.jpg", Role: "first_frame"}},
				Metadata:        map[string]any{"source": "ecommerce-agent", "stage": "product-video", "videoEditOperation": "image_to_video", "videoStartFrameNodeId": "actor", "ecommerceVideoVersion": map[string]any{"presenter": map[string]any{"frameResourceId": "actor"}, "voice": "spoken copy"}},
			}
			if presenterAdaptiveFrame(entry.id) {
				if validateVideoTask(profile, input) == nil {
					t.Fatal("accepted fixed ratio for adaptive first frame")
				}
				input.Config.Size = "adaptive"
			}
			if err := validateVideoTask(profile, input); (err == nil) != entry.capable {
				t.Fatalf("capability admission: %v", err)
			}
			request := protocolRequestFromInput(input)
			spec := buildDramaReferenceSpec(t, input, request)
			if err := validateEcommercePresenterRequest(input, request, spec); (err == nil) != entry.capable {
				t.Fatalf("official create contract: %v", err)
			}
			if !entry.capable {
				return
			}
			substitute := request
			substitute.Prompt = "different speech"
			if validateEcommercePresenterRequest(input, request, buildDramaReferenceSpec(t, input, substitute)) == nil {
				t.Fatal("substituted speech accepted")
			}
			substitute = request
			substitute.GenerateAudio = false
			if validateEcommercePresenterRequest(input, request, buildDramaReferenceSpec(t, input, substitute)) == nil {
				t.Fatal("silent presenter accepted")
			}
			substitute = request
			substitute.Duration = 5
			if validateEcommercePresenterRequest(input, request, buildDramaReferenceSpec(t, input, substitute)) == nil {
				t.Fatal("changed duration accepted")
			}
			request.Images[0].URL = "https://media.example/other-frame.jpg"
			if validateEcommercePresenterRequest(input, request, spec) == nil {
				t.Fatal("substituted first frame accepted")
			}
		})
	}
}
