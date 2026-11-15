package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

const inspirationShowcasePrefix = "inspiration_showcase:"
const maxInspirationShowcases = 1000

type InspirationExample struct {
	ResourceID  string `json:"resourceId"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	MediaURL    string `json:"mediaUrl,omitempty"`
}

type InspirationShowcase struct {
	InspirationID string               `json:"inspirationId"`
	Title         string               `json:"title"`
	Enabled       bool                 `json:"enabled"`
	Examples      []InspirationExample `json:"examples"`
}

func inspirationShowcaseKey(id string) string {
	digest := sha256.Sum256([]byte(id))
	return inspirationShowcasePrefix + hex.EncodeToString(digest[:])
}

func normalizeInspirationShowcase(value InspirationShowcase) (InspirationShowcase, error) {
	value.InspirationID = strings.TrimSpace(value.InspirationID)
	value.Title = normalizeAppearanceSingleLine(value.Title)
	if err := validateAppearanceCopy(value.InspirationID, "灵感标识", 500, true); err != nil {
		return value, err
	}
	if strings.HasPrefix(value.InspirationID, "custom:") {
		return value, BadAuthRequest("个人灵感不能配置全站作品示例")
	}
	if err := validateAppearanceCopy(value.Title, "灵感标题", 200, true); err != nil {
		return value, err
	}
	if len(value.Examples) > 10 {
		return value, BadAuthRequest("每条灵感最多配置 10 个作品示例")
	}
	if value.Enabled && len(value.Examples) == 0 {
		return value, BadAuthRequest("请先上传作品示例再公开显示")
	}
	if value.Examples == nil {
		value.Examples = []InspirationExample{}
	}
	seen := map[string]bool{}
	for i := range value.Examples {
		example := &value.Examples[i]
		example.ResourceID = strings.TrimSpace(example.ResourceID)
		example.MediaURL = ""
		example.Title = normalizeAppearanceSingleLine(example.Title)
		example.Description = normalizeAppearanceCopy(example.Description)
		if example.Type != "image" && example.Type != "video" {
			return value, BadAuthRequest("作品示例仅支持图片和视频")
		}
		if example.ResourceID == "" || len(example.ResourceID) > 80 || seen[example.ResourceID] {
			return value, BadAuthRequest("作品示例资源为空、重复或无效")
		}
		seen[example.ResourceID] = true
		if err := validateAppearanceCopy(example.Title, "示例标题", 80, false); err != nil {
			return value, err
		}
		if err := validateAppearanceCopy(example.Description, "示例说明", 1000, false); err != nil {
			return value, err
		}
	}
	return value, nil
}

func (s *Service) readInspirationShowcases() ([]InspirationShowcase, error) {
	settings, err := s.repo.SystemSettingsWithPrefix(inspirationShowcasePrefix, maxInspirationShowcases+1)
	if err != nil {
		return nil, err
	}
	if len(settings) > maxInspirationShowcases {
		return nil, BadAuthRequest("灵感作品示例配置超过上限")
	}
	result := make([]InspirationShowcase, 0, len(settings))
	for _, setting := range settings {
		var value InspirationShowcase
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, BadAuthRequest("灵感作品示例配置无法读取")
		}
		value, err = normalizeInspirationShowcase(value)
		if err != nil || setting.Key != inspirationShowcaseKey(value.InspirationID) {
			return nil, BadAuthRequest("灵感作品示例配置无效")
		}
		result = append(result, value)
	}
	return result, nil
}

// Public URLs are derived from published references, never from client-supplied URLs.
func (s *Service) InspirationShowcases(actor *model.User) ([]InspirationShowcase, error) {
	if actor != nil {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
	}
	values, err := s.readInspirationShowcases()
	if err != nil {
		return nil, err
	}
	result := make([]InspirationShowcase, 0, len(values))
	for _, value := range values {
		if actor == nil && !value.Enabled {
			continue
		}
		for i := range value.Examples {
			prefix := "/api/public/inspirations/showcases/media/"
			if actor != nil {
				prefix = "/api/admin/settings/inspiration-showcases/media/"
			}
			value.Examples[i].MediaURL = prefix + url.PathEscape(value.Examples[i].ResourceID)
		}
		result = append(result, value)
	}
	return result, nil
}

func showcaseReferences(values []InspirationShowcase, id string, publishedOnly bool) bool {
	for _, value := range values {
		if publishedOnly && !value.Enabled {
			continue
		}
		for _, example := range value.Examples {
			if example.ResourceID == id {
				return true
			}
		}
	}
	return false
}

func (s *Service) SaveInspirationShowcase(actor *model.User, input InspirationShowcase) (*InspirationShowcase, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	value, err := normalizeInspirationShowcase(input)
	if err != nil {
		return nil, err
	}
	// Share the resource deletion lock so validation and publication cannot race cleanup.
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	before, err := s.readInspirationShowcases()
	if err != nil {
		return nil, err
	}
	key := inspirationShowcaseKey(value.InspirationID)
	setting, err := s.repo.SystemSettingOptional(key)
	if err != nil {
		return nil, err
	}
	if setting == nil {
		if len(before) >= maxInspirationShowcases {
			return nil, BadAuthRequest("灵感作品示例配置已达上限")
		}
		setting = &model.SystemSetting{Key: key, CreatedAt: time.Now()}
	}
	for _, example := range value.Examples {
		resource, err := s.repo.Resource(example.ResourceID)
		if err != nil {
			return nil, BadAuthRequest("作品示例资源不存在")
		}
		if resource.UserID != actor.ID && !showcaseReferences(before, resource.ID, true) {
			return nil, Forbidden("只能公开自己上传或已公开的作品示例")
		}
		slot := updateResourceSlot(example.Type)
		if err := validateAppearanceResourceType(slot, resource); err != nil {
			return nil, err
		}
		maxBytes, _ := AppearanceAssetMaxBytes(slot)
		if resource.Provider != "local" || resource.Size <= 0 || resource.Size > maxBytes {
			return nil, BadAuthRequest("作品示例必须使用符合大小限制的本地上传资源")
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	setting.ValueJSON = string(encoded)
	setting.UpdatedAt = time.Now()
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "inspiration.showcase.save", "system_setting", key, "保存灵感作品示例", map[string]any{"enabled": value.Enabled, "examples": len(value.Examples)}); err != nil {
		return nil, err
	}
	return &value, nil
}

func (s *Service) UploadInspirationExample(actor *model.User, kind string, header *multipart.FileHeader) (*model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if kind != "image" && kind != "video" {
		return nil, BadAuthRequest("作品示例仅支持图片和视频")
	}
	mimeType, err := validateAppearanceUpload(updateResourceSlot(kind), header)
	if err != nil {
		return nil, err
	}
	header.Header.Set("Content-Type", mimeType)
	return s.uploadLocalResource(actor.ID, header, kind, 0, 0, 0)
}

func (s *Service) PrepareInspirationExampleDelivery(actor *model.User, id string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	if actor != nil {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
	}
	values, err := s.readInspirationShowcases()
	if err != nil {
		return nil, err
	}
	published := showcaseReferences(values, id, true)
	if actor == nil && !published {
		return nil, NotFound("作品示例未公开")
	}
	resource, err := s.repo.Resource(id)
	if err != nil {
		return nil, NotFound("作品示例不存在")
	}
	if actor != nil && resource.UserID != actor.ID && !published {
		return nil, Forbidden("不能预览其他管理员的未公开作品")
	}
	if resource.Provider != "local" || (resource.Kind != "image" && resource.Kind != "video") {
		return nil, BadAuthRequest("作品示例资源类型无效")
	}
	if err := validateAppearanceResourceType(updateResourceSlot(resource.Kind), resource); err != nil {
		return nil, err
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}

// Both published and disabled examples remain references until removed from settings.
func (s *Service) siteResourceReferences(resourceIDs []string) map[string][]AdminResourceReferenceView {
	result := s.appearanceResourceReferences(resourceIDs)
	values, err := s.readInspirationShowcases()
	for _, id := range resourceIDs {
		if err != nil {
			result[id] = append(result[id], AdminResourceReferenceView{Kind: "灵感示例", ID: inspirationShowcasePrefix, Title: "作品示例配置无法读取"})
			continue
		}
		for _, value := range values {
			if showcaseReferences([]InspirationShowcase{value}, id, false) {
				result[id] = appendUniqueAdminResourceReference(result[id], AdminResourceReferenceView{Kind: "灵感示例", ID: value.InspirationID, Title: value.Title})
			}
		}
	}
	return result
}
