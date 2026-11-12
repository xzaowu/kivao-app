package protocol

import (
	"encoding/base64"
	"fmt"
	"io"
	"maps"
	"net/url"
	"strings"
)

// Only BuildCreate's declared text wire selects this projection. It never
// fetches media or infers the protocol from a model name or upstream URL.
func normalizeClaudeManifestMessages(request GenerationRequest, values map[string]any) error {
	if len(request.Videos)+len(request.Audios) > 0 {
		return fmt.Errorf("Claude 图文请求不支持视频或音频素材")
	}
	for _, image := range request.Images {
		if strings.TrimSpace(defaultValue(image.URL, image.DataURL)) == "" {
			return fmt.Errorf("Claude 图片素材缺少可用内容")
		}
	}
	var system []any
	messages := make([]any, 0, len(manifestArray(values["messages"])))
	for index, value := range manifestArray(values["messages"]) {
		message := maps.Clone(manifestObject(value))
		content, err := claudeManifestContent(message["content"])
		if err != nil {
			return fmt.Errorf("Claude 消息 %d: %w", index+1, err)
		}
		if strings.EqualFold(strings.TrimSpace(manifestString(message["role"])), "system") {
			// Claude's plugin maps instructions to the top-level system field.
			// Explicit instructions keep precedence over historical system text.
			if strings.TrimSpace(request.Instructions) == "" {
				if text, ok := content.(string); ok {
					if strings.TrimSpace(text) != "" {
						system = append(system, map[string]any{"type": "text", "text": text})
					}
				} else {
					for _, block := range manifestArray(content) {
						if manifestString(manifestObject(block)["type"]) != "text" {
							return fmt.Errorf("Claude 系统消息只支持文本")
						}
						system = append(system, block)
					}
				}
			}
			continue
		}
		message["content"] = content
		messages = append(messages, message)
	}
	values["messages"] = messages
	if len(system) > 0 {
		values["instructions"] = system
	}
	return nil
}

func claudeManifestContent(content any) (any, error) {
	var blocks []any
	switch value := content.(type) {
	case []any:
		blocks = value
	case []map[string]any:
		for _, block := range value {
			blocks = append(blocks, block)
		}
	default:
		return content, nil
	}
	result := make([]any, 0, len(blocks))
	for _, value := range blocks {
		block := manifestObject(value)
		switch manifestString(block["type"]) {
		case "image_url":
			imageURL, _ := block["image_url"].(string)
			if object, ok := block["image_url"].(map[string]any); ok {
				imageURL, _ = object["url"].(string)
			}
			source, err := claudeManifestImageURL(imageURL)
			if err != nil {
				return nil, err
			}
			block = maps.Clone(block)
			delete(block, "image_url")
			block["type"], block["source"] = "image", source
			value = block
		case "image":
			if err := validateClaudeManifestImageSource(manifestObject(block["source"])); err != nil {
				return nil, err
			}
		case "video", "video_url", "input_video", "audio", "audio_url", "input_audio":
			return nil, fmt.Errorf("Claude 图文请求不支持视频或音频素材")
		}
		result = append(result, value)
	}
	return result, nil
}

func claudeManifestImageURL(value string) (map[string]any, error) {
	var source map[string]any
	if strings.HasPrefix(value, "data:") {
		header, data, ok := strings.Cut(strings.TrimPrefix(value, "data:"), ",")
		if !ok || !strings.HasSuffix(header, ";base64") {
			return nil, fmt.Errorf("Claude 图片必须是有效的 Base64 图片或 HTTP(S) URL")
		}
		source = map[string]any{"type": "base64", "media_type": strings.TrimSuffix(header, ";base64"), "data": data}
	} else {
		source = map[string]any{"type": "url", "url": value}
	}
	if err := validateClaudeManifestImageSource(source); err != nil {
		return nil, err
	}
	return source, nil
}

func validateClaudeManifestImageSource(source map[string]any) error {
	// Errors deliberately exclude URL, inline bytes and file IDs.
	switch source["type"] {
	case "url":
		value, _ := source["url"].(string)
		parsed, err := url.Parse(value)
		if err != nil || parsed.Hostname() == "" || parsed.User != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
			return fmt.Errorf("Claude 图片 URL 无效，素材必须先由宿主解析")
		}
	case "base64":
		switch source["media_type"] {
		case "image/jpeg", "image/png", "image/gif", "image/webp":
		default:
			return fmt.Errorf("Claude 图片仅支持 JPEG、PNG、GIF 或 WebP")
		}
		data, _ := source["data"].(string)
		count, err := io.Copy(io.Discard, base64.NewDecoder(base64.StdEncoding.Strict(), strings.NewReader(data)))
		if err != nil || count == 0 {
			return fmt.Errorf("Claude 图片 Base64 内容无效或为空")
		}
	case "file":
		id, _ := source["file_id"].(string)
		if strings.TrimSpace(id) == "" {
			return fmt.Errorf("Claude 图片文件引用为空")
		}
	default:
		return fmt.Errorf("Claude 图片来源格式无效")
	}
	return nil
}
