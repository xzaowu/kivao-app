package app

import (
	"slices"
	"strconv"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceRemixWireCapabilities(t *testing.T) {
	svc, _, _ := agentMediaFixture(t)
	channel, err := svc.repo.ChannelModelByKey("channel", "seedance-test")
	if err != nil {
		t.Fatal(err)
	}
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "seedance-test").Video
	workflow := map[string]any{
		"mode": "video", "config": map[string]any{"interfaceType": "runninghub-workflow-video"},
		"metadata": map[string]any{"source": "ecommerce-agent", "stage": "product-video", "ecommerceVideoVersion": map[string]any{"referenceVideo": map[string]any{"resourceId": "clip"}}},
	}
	if err := svc.ValidateTaskCapability(workflow); err == nil || err.Error() != "请选择支持商品图和参考视频的复刻模型" {
		t.Fatalf("alternate workflow route escaped remix capability check: %v", err)
	}
	for _, test := range []struct {
		id, model         string
		references, audio bool
	}{
		{"volcengine-ark-video", "seedance-2.0", true, true},
		{"volcengine-ark-agent-plan-video", "seedance-2.0", true, true},
		{"volcengine-ark-seedance-25", "doubao-seedance-2-5-260628", true, true},
		{"minimax-video", "MiniMax-H3", true, true},
		{"km-kemei-video", "seedance2.0", true, true},
		{"newapi-channel-2", "seedance", true, true},
		{"seedance-videos-compatible", "seedance-2.0", true, false},
		{"metaso-h3", "MiniMax-H3", true, false},
		{"newapi-channel-1", "seedance", true, false},
		{"lxmone-seedance-videos", "seedance", true, false},
		{"newapi", "sora-2", false, false},
		{"wenew-h3-video", "h3_video", false, false},
	} {
		t.Run(test.id, func(t *testing.T) {
			item := *channel
			item.Protocol = model.ChannelInterfaceType(test.id)
			catalog, err := svc.sanitizeChannelModel(&item)
			if err != nil {
				t.Fatal(err)
			}
			video := catalog.CapabilityConfig["video"].(map[string]any)
			if (video["remixReferences"] == true) != test.references || (video["remixGenerateAudio"] == true) != test.audio {
				t.Fatal("incorrect remix controls advertised in catalog")
			}
			input := canvasGenerationInput{
				Mode: "video", Prompt: "用商品图重拍", Config: providerConfig{InterfaceType: test.id, Model: test.model, VideoSeconds: "15", Size: "9:16", VQuality: "720p"},
				Metadata:        map[string]any{"source": "ecommerce-agent", "stage": "product-video", "videoEditOperation": "reference_to_video"},
				ReferenceImages: []providerMedia{{ID: "photo", URL: "https://media.example/product.jpg", Role: "reference"}},
				ReferenceVideos: []providerMedia{{ID: "clip", URL: "https://media.example/reference.mp4", Role: "reference", DurationMs: 5100}},
			}
			for _, audio := range []bool{false, true} {
				input.Config.VideoGenerateAudio = strconv.FormatBool(audio)
				input.Metadata["ecommerceVideoVersion"] = map[string]any{"referenceVideo": map[string]any{"resourceId": "clip"}, "settings": map[string]any{"generateAudio": audio}}
				allowed := test.references && (!audio || test.audio)
				if err := validateVideoTask(profile, input); (err == nil) != allowed {
					t.Fatalf("audio %v admission %v", audio, err)
				}
				if !allowed {
					continue
				}
				request := protocolRequestFromInput(input)
				spec := buildDramaReferenceSpec(t, input, request)
				adapter, _ := loadOfficialFallbackRegistry().Resolve(test.id)
				provider := adapter.Metadata()
				if err := validateEcommerceRemixRequest(input, request, spec, provider); err != nil {
					t.Fatal(err)
				}
				legacy := provider
				legacy.VideoReferences = nil
				if err := validateEcommerceRemixRequest(input, request, spec, legacy); err != nil {
					t.Fatalf("existing release without reference metadata: %v", err)
				}
				changed := request
				changed.Images = slices.Clone(request.Images)
				changed.Images[0].URL = "https://media.example/different.jpg"
				if validateEcommerceRemixRequest(input, changed, spec, provider) == nil {
					t.Fatal("substituted product image accepted")
				}
				changed = request
				changed.Videos = slices.Clone(changed.Videos)
				changed.Videos[0].URL = "https://media.example/different.mp4"
				if validateEcommerceRemixRequest(input, changed, spec, provider) == nil {
					t.Fatal("substituted clip accepted")
				}
				if audio {
					delete(spec.Body.(map[string]any), "generate_audio")
					if validateEcommerceRemixRequest(input, request, spec, provider) == nil {
						t.Fatal("missing audio switch accepted")
					}
				}
			}
		})
	}
}
