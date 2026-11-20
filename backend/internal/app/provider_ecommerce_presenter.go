package app

import (
	"errors"
	"strings"

	"yingce/backend/internal/protocol"
)

// These create templates can carry the confirmed first frame, dialogue prompt and
// an explicit native audio switch together. The model's own limits still apply.
var ecommercePresenterLayouts = map[string]string{
	"volcengine-ark-video": "content", "volcengine-ark-agent-plan-video": "content",
	"volcengine-ark-seedance-25": "content", "minimax-video": "content",
	"km-kemei-video": "role-images", "newapi-channel-2": "image-urls",
	"dashscope-wan-video": "input-image", "dashscope-wan3-video": "input-media", "lxmone-wan-channel-s": "input-media",
	"lxmone-grok-videos": "image", "maxforai-videos": "images", "maxforai-video-generations": "images",
}

func presenterAdaptiveFrame(interfaceType string) bool {
	return interfaceType == "minimax-video" || interfaceType == "volcengine-ark-seedance-25"
}

func ecommercePresenterCapable(interfaceType string, profile *VideoCapabilityConfig) bool {
	return ecommercePresenterLayouts[interfaceType] != "" && profile != nil && profile.GenerateAudio.Supported &&
		videoDurationSupported(profile) && videoDurationAllowed(profile.Duration, 15) && containsCapabilityString(profile.Operations, "image_to_video") &&
		profile.References.MinImages <= 1 && profile.References.MaxImages >= 1 &&
		(!presenterAdaptiveFrame(interfaceType) || len(profile.Ratios) == 0 || containsCapabilityString(profile.Ratios, "adaptive"))
}

func validateEcommercePresenterRequest(input canvasGenerationInput, request protocol.GenerationRequest, spec protocol.RequestSpec) error {
	if !ecommerceVideoInputModes(input.Metadata).presenter {
		return nil
	}
	body, ok := spec.Body.(map[string]any)
	if !ok || len(spec.Files) != 0 || len(request.Images) != 1 || request.Images[0].Role != "first_frame" {
		return errors.New("口播请求缺少已确认的人货同框首帧")
	}
	frame := request.Images[0]
	prompt := stringField(body, "prompt")
	frameValue := ""
	parameters := body
	audioField, durationField := "generate_audio", "duration"
	switch ecommercePresenterLayouts[input.Config.InterfaceType] {
	case "content":
		items, _ := body["content"].([]any)
		if len(items) == 2 {
			for _, raw := range items {
				item, _ := raw.(map[string]any)
				switch item["type"] {
				case "text":
					prompt = stringField(item, "text")
				case "image_url":
					if item["role"] == "first_frame" {
						image, _ := item["image_url"].(map[string]any)
						frameValue = stringField(image, "url")
					}
				}
			}
		}
	case "input-media", "input-image":
		content, _ := body["input"].(map[string]any)
		parameters, _ = body["parameters"].(map[string]any)
		audioField = "audio"
		prompt = stringField(content, "prompt")
		if ecommercePresenterLayouts[input.Config.InterfaceType] == "input-image" {
			frameValue = stringField(content, "img_url")
		} else if media, _ := content["media"].([]any); len(media) == 1 {
			item, _ := media[0].(map[string]any)
			if item["type"] == "first_frame" {
				frameValue = stringField(item, "url")
			}
		}
	case "image":
		image, _ := body["image"].(map[string]any)
		frameValue = stringField(image, "url")
	case "role-images", "images", "image-urls":
		field := "images"
		if ecommercePresenterLayouts[input.Config.InterfaceType] == "image-urls" {
			field, durationField = "image_urls", "seconds"
		}
		if images, _ := body[field].([]any); len(images) == 1 {
			if ecommercePresenterLayouts[input.Config.InterfaceType] == "role-images" {
				image, _ := images[0].(map[string]any)
				if image["role"] == "first_frame" {
					frameValue = stringField(image, "url")
				}
			} else {
				frameValue, _ = images[0].(string)
			}
		}
	}
	if frameValue == "" || (frameValue != frame.URL && frameValue != frame.DataURL && frameValue != stringValue(frame.Metadata[protocol.MediaUploadIDKey])) {
		return errors.New("视频协议未发送已确认的人货同框首帧")
	}
	if seconds, _ := workbenchInteger(parameters[durationField], 3600); seconds != 15 || parameters[audioField] != true {
		return errors.New("视频协议未发送 15 秒时长和同步音频")
	}
	if strings.TrimSpace(input.Prompt) == "" || prompt != strings.TrimSpace(input.Prompt) {
		return errors.New("视频协议改变了已确认的口播脚本")
	}
	return nil
}
