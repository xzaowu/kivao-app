package app

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const commerceStudioOrchestrationSettingKey = "commerce_studio_agent_orchestration_v1"

// The stage configuration is the administrator's only ecommerce Agent model
// choice. The /ecommerce page resolves its two analysis models from it (see
// EcommerceAgentSetting): Vision recognises the product and proposes the four
// directions; Director writes the copy, storyboard and image prompts. Marketing
// is the older name of the planning stage: Director may still reuse it, and a
// planning model saved there keeps working. The legacy Enabled flag stays false.
type CommerceStudioOrchestrationModel struct {
	ChannelModelID string `json:"channelModelId,omitempty"`
	LogicalModelID string `json:"logicalModelId,omitempty"`
}

type CommerceStudioOrchestrationRole struct {
	Model         CommerceStudioOrchestrationModel `json:"model"`
	Fallback      CommerceStudioOrchestrationModel `json:"fallback"`
	Reuse         string                           `json:"reuse,omitempty"`
	ThinkingLevel string                           `json:"thinkingLevel,omitempty"`
}

type CommerceStudioOrchestrationSetting struct {
	Version   int                             `json:"version"`
	Enabled   bool                            `json:"enabled"`
	Vision    CommerceStudioOrchestrationRole `json:"vision"`
	Marketing CommerceStudioOrchestrationRole `json:"marketing"`
	Director  CommerceStudioOrchestrationRole `json:"director"`
}

func (s *Service) CommerceStudioOrchestrationSetting(actor *model.User) (CommerceStudioOrchestrationSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CommerceStudioOrchestrationSetting{}, err
	}
	setting, _, err := s.storedCommerceStudioOrchestrationSetting()
	return setting, err
}

// storedEcommerceOrchestrationSetting reports whether an administrator has
// saved the stage configuration; until then the legacy choice still applies.
func (s *Service) storedCommerceStudioOrchestrationSetting() (CommerceStudioOrchestrationSetting, bool, error) {
	row, err := s.repo.SystemSetting(commerceStudioOrchestrationSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CommerceStudioOrchestrationSetting{Version: 1}, false, nil
	}
	if err != nil {
		return CommerceStudioOrchestrationSetting{}, false, err
	}
	var setting CommerceStudioOrchestrationSetting
	if err := json.Unmarshal([]byte(row.ValueJSON), &setting); err != nil {
		return CommerceStudioOrchestrationSetting{}, false, err
	}
	if setting.Version != 1 || setting.Enabled {
		return CommerceStudioOrchestrationSetting{}, false, BadAuthRequest("电商 Agent 阶段模型配置版本无效")
	}
	return setting, true, nil
}

func (s *Service) UpdateCommerceStudioOrchestrationSetting(actor *model.User, setting CommerceStudioOrchestrationSetting) (CommerceStudioOrchestrationSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CommerceStudioOrchestrationSetting{}, err
	}
	if setting.Version != 1 || setting.Enabled {
		return CommerceStudioOrchestrationSetting{}, BadAuthRequest("电商 Agent 阶段模型配置版本无效")
	}
	catalog, err := s.ModelCatalogForUser(actor, nil)
	if err != nil {
		return CommerceStudioOrchestrationSetting{}, err
	}
	// The workbench sends the product images to the recognition task and to the
	// planning task (Director, or the Marketing model it reuses), so every
	// stage that can run must read images.
	roles := []struct {
		name   string
		role   *CommerceStudioOrchestrationRole
		reuse  string
		vision bool
	}{
		{"商品识别与视觉方向", &setting.Vision, "", true}, {"整套策划", &setting.Marketing, "", true},
		{"整套策划", &setting.Director, "marketing", true},
	}
	for _, item := range roles {
		role := item.role
		if err := ValidateThinkingLevelRequest(role.ThinkingLevel); err != nil {
			return CommerceStudioOrchestrationSetting{}, BadAuthRequest(item.name + "的思考等级无效")
		}
		if role.Reuse != "" {
			if role.Reuse != item.reuse || !emptyOrchestrationModel(role.Model) || !emptyOrchestrationModel(role.Fallback) {
				return CommerceStudioOrchestrationSetting{}, BadAuthRequest(item.name + "的复用配置无效")
			}
			continue
		}
		for _, choice := range []CommerceStudioOrchestrationModel{role.Model, role.Fallback} {
			if emptyOrchestrationModel(choice) {
				continue
			}
			if err := validateOrchestrationCatalogModel(catalog, choice, item.vision); err != nil {
				return CommerceStudioOrchestrationSetting{}, BadAuthRequest(item.name + "：" + err.Error())
			}
			if choice.ChannelModelID != "" {
				channelModel, err := s.repo.ChannelModel(choice.ChannelModelID)
				if err != nil {
					return CommerceStudioOrchestrationSetting{}, BadAuthRequest(item.name + "：模型已失效")
				}
				intent := ModelRequestIntent{Capability: "text"}
				if item.vision {
					intent.Inputs = map[string]int{"image": 1}
				}
				matched, err := s.channelModelMatchesIntent(channelModel, &intent)
				if err != nil || !matched {
					return CommerceStudioOrchestrationSetting{}, BadAuthRequest(item.name + "：模型不满足所需能力")
				}
			}
		}
		if !emptyOrchestrationModel(role.Fallback) && (emptyOrchestrationModel(role.Model) || role.Model == role.Fallback) {
			return CommerceStudioOrchestrationSetting{}, BadAuthRequest(item.name + "的备用模型必须与主模型不同")
		}
	}
	if emptyOrchestrationModel(setting.Vision.Model) {
		return CommerceStudioOrchestrationSetting{}, BadAuthRequest("请选择商品识别与视觉方向主模型")
	}
	if emptyOrchestrationModel(setting.Marketing.Model) && (setting.Director.Reuse == "marketing" || emptyOrchestrationModel(setting.Director.Model)) {
		return CommerceStudioOrchestrationSetting{}, BadAuthRequest("请选择整套策划主模型")
	}
	if setting.Director.Reuse == "marketing" && emptyOrchestrationModel(setting.Marketing.Model) {
		return CommerceStudioOrchestrationSetting{}, BadAuthRequest("整套策划复用的模型已清空，请重新选择整套策划主模型")
	}
	encoded, err := json.Marshal(setting)
	if err != nil {
		return CommerceStudioOrchestrationSetting{}, err
	}
	row := model.SystemSetting{Key: commerceStudioOrchestrationSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	old, err := s.repo.SystemSetting(commerceStudioOrchestrationSettingKey)
	if err == nil {
		row.CreatedAt = old.CreatedAt
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return CommerceStudioOrchestrationSetting{}, err
	}
	if err := s.repo.SaveSystemSetting(&row); err != nil {
		return CommerceStudioOrchestrationSetting{}, err
	}
	if err := s.appendAdminAudit(actor, "commerce_studio_agent.orchestration.update", "system_setting", commerceStudioOrchestrationSettingKey, "保存电商 Agent 阶段模型", map[string]any{"version": 1, "vision": setting.Vision.Model, "marketing": setting.Marketing.Model, "director": setting.Director.Model, "directorReuse": setting.Director.Reuse}); err != nil {
		return CommerceStudioOrchestrationSetting{}, err
	}
	return setting, nil
}

func emptyOrchestrationModel(value CommerceStudioOrchestrationModel) bool {
	return value.ChannelModelID == "" && value.LogicalModelID == ""
}

func validateOrchestrationCatalogModel(catalog *ModelCatalogResponse, choice CommerceStudioOrchestrationModel, vision bool) error {
	if strings.TrimSpace(choice.ChannelModelID) != choice.ChannelModelID || strings.TrimSpace(choice.LogicalModelID) != choice.LogicalModelID || (choice.ChannelModelID == "") == (choice.LogicalModelID == "") {
		return BadAuthRequest("请选择唯一的目录模型")
	}
	if choice.ChannelModelID != "" {
		for _, channel := range catalog.Channels {
			for _, item := range channel.Models {
				if item.ID != choice.ChannelModelID {
					continue
				}
				if !item.Available || item.Capability != "text" {
					return BadAuthRequest("模型不可用或不是文本模型")
				}
				if vision {
					text, _ := item.CapabilityConfig["text"].(map[string]any)
					refs, _ := text["references"].(map[string]any)
					if intValue(refs["maxImages"]) < 1 {
						return BadAuthRequest("图片输入能力未知或不可用")
					}
				}
				return nil
			}
		}
	} else {
		for _, item := range catalog.Models {
			if item.ID == choice.LogicalModelID && item.Available && item.Capability == "text" {
				if vision && item.CapabilitySpec.Inputs["image"].Max < 1 {
					return BadAuthRequest("图片输入能力未知或不可用")
				}
				return nil
			}
		}
	}
	return BadAuthRequest("模型不在当前账号可用目录中")
}
