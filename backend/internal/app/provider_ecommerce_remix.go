package app

import (
	"errors"

	"yingce/backend/internal/protocol"
)

func ecommerceVideoReferenceContract(provider protocol.Metadata) *protocol.VideoReferenceContract {
	if provider.VideoReferences != nil {
		return provider.VideoReferences
	}
	// Releases installed before reference metadata used the published layouts.
	// Bind still checks the actual create payload before any upstream submission.
	if official, ok := loadOfficialFallbackRegistry().Resolve(provider.ID); ok {
		return official.Metadata().VideoReferences
	}
	return nil
}

// Check the final create template as channel options or a replacement plugin can
// change its media fields after capability admission.
func validateEcommerceRemixRequest(input canvasGenerationInput, request protocol.GenerationRequest, spec protocol.RequestSpec, provider protocol.Metadata) error {
	modes := ecommerceVideoInputModes(input.Metadata)
	if !modes.remix {
		return nil
	}
	body, ok := spec.Body.(map[string]any)
	if !ok || len(spec.Files) != 0 || len(request.Images) != 1 || len(request.Videos) != 1 {
		return errors.New("视频复刻请求缺少可核对的商品图或参考视频")
	}
	if enabled, present := body["generate_audio"]; (present || modes.audio) && enabled != modes.audio {
		return errors.New("复刻请求中的同步音频与分镜不一致")
	}
	wireMatches := func(value string, media protocol.MediaReference) bool {
		return value != "" && (value == media.URL || value == media.DataURL || value == stringValue(media.Metadata[protocol.MediaUploadIDKey]))
	}
	rule := ecommerceVideoReferenceContract(provider)
	if rule == nil {
		return errors.New("视频协议缺少可核对的商品参考图布局")
	}
	bound, err := rule.Bind(request, &spec)
	if err != nil || len(bound.Tokens) != 1 || bound.Tokens[request.Images[0].ID] == "" {
		return errors.New("视频协议未发送已选择的商品参考图")
	}
	var videoURL string
	format := rule.Layout
	switch format {
	case "content", "input-media":
		content, _ := body["content"].([]any)
		if format == "input-media" {
			media, _ := body["input"].(map[string]any)
			content, _ = media["media"].([]any)
		}
		for _, raw := range content {
			item, _ := raw.(map[string]any)
			var value string
			switch {
			case format == "content" && item["type"] == "video_url" && item["role"] == "reference_video":
				video, _ := item["video_url"].(map[string]any)
				value = stringField(video, "url")
			case format == "input-media" && item["type"] == "reference_video":
				value = stringField(item, "url")
			default:
				continue
			}
			if videoURL != "" || value == "" {
				return errors.New("视频复刻请求中的参考视频数量或地址无效")
			}
			videoURL = value
		}
	case "image-urls", "images", "role-images", "reference-images":
		field := "videos"
		switch format {
		case "image-urls":
			field = "video_urls"
		case "reference-images":
			field = "reference_videos"
		}
		videos, _ := body[field].([]any)
		if len(videos) == 1 {
			videoURL, _ = videos[0].(string)
		}
	}
	if !wireMatches(videoURL, request.Videos[0]) {
		return errors.New("视频协议未发送已选择的参考视频")
	}
	return nil
}
