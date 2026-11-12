package app

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
)

// ecommerceAgentSettingKey stores the older two-model choice. It is only read
// as a fallback while the stage configuration has not been saved yet.
const commerceStudioAgentSettingKey = "commerce_studio_agent_planning_model"

// EcommerceAgentModelRef identifies one catalog text model: a logical model or
// one channel model row (the channel and key are copied for routing checks).
type CommerceStudioAgentModelRef struct {
	LogicalModelID string `json:"logicalModelId,omitempty"`
	ChannelModelID string `json:"channelModelId,omitempty"`
	ChannelID      string `json:"channelId,omitempty"`
	ModelKey       string `json:"modelKey,omitempty"`
}

// EcommerceAgentSetting is the model each /ecommerce analysis task must use.
// The top-level fields are the planning model (copy, storyboard and image
// prompts), kept flat for existing clients. Vision runs product recognition
// and the four style directions; nil reuses planning.
type CommerceStudioAgentSetting struct {
	LogicalModelID      string                       `json:"logicalModelId"`
	ChannelModelID      string                       `json:"channelModelId,omitempty"`
	ChannelID           string                       `json:"channelId,omitempty"`
	ModelKey            string                       `json:"modelKey,omitempty"`
	Vision              *CommerceStudioAgentModelRef `json:"vision,omitempty"`
	ThinkingLevel       string                       `json:"thinkingLevel,omitempty"`
	VisionThinkingLevel string                       `json:"visionThinkingLevel,omitempty"`
}

func (setting CommerceStudioAgentSetting) planningRef() CommerceStudioAgentModelRef {
	return CommerceStudioAgentModelRef{LogicalModelID: setting.LogicalModelID, ChannelModelID: setting.ChannelModelID, ChannelID: setting.ChannelID, ModelKey: setting.ModelKey}
}

// visionRef is the model the recognition stage must use.
func (setting CommerceStudioAgentSetting) visionRef() CommerceStudioAgentModelRef {
	if setting.Vision != nil && (setting.Vision.LogicalModelID != "" || setting.Vision.ChannelModelID != "") {
		return *setting.Vision
	}
	return setting.planningRef()
}

// ecommerceTaskUsesModel reports whether a submitted text task routes to ref,
// so a page holding a stale stage model is refused instead of being billed.
func commerceStudioTaskUsesModel(ref CommerceStudioAgentModelRef, logicalModelID string, input map[string]any) bool {
	if ref.LogicalModelID != "" {
		return strings.TrimSpace(logicalModelID) == ref.LogicalModelID
	}
	if ref.ChannelModelID == "" {
		return false
	}
	config, _ := input["config"].(map[string]any)
	channelID := strings.TrimSpace(stringValue(config["channelId"]))
	modelKey := strings.TrimPrefix(strings.TrimSpace(stringValue(config["channelModelKey"])), "models/")
	if modelKey == "" {
		modelKey = strings.TrimPrefix(strings.TrimSpace(stringValue(config["model"])), "models/")
	}
	return strings.TrimSpace(logicalModelID) == "" && channelID == ref.ChannelID && modelKey == ref.ModelKey
}

// EcommerceAgentSetting resolves the stage configuration into the two models
// the workbench submits: "商品视觉理解" reads the product images and proposes
// the four directions; "视觉设计总监" (or the marketing model it reuses) writes
// the copy, storyboard and image prompts. A primary model that is disabled or
// removed falls back to the configured backup.
func (s *Service) CommerceStudioAgentSetting() (CommerceStudioAgentSetting, error) {
	stages, saved, err := s.storedCommerceStudioOrchestrationSetting()
	if err != nil {
		return CommerceStudioAgentSetting{}, err
	}
	legacy, err := s.legacyCommerceStudioAgentSetting()
	if err != nil {
		return CommerceStudioAgentSetting{}, err
	}
	if !saved {
		return legacy, nil
	}
	planningRole := stages.Director
	if planningRole.Reuse == "marketing" || emptyOrchestrationModel(planningRole.Model) {
		planningRole = stages.Marketing
	}
	planning, ok := s.commerceStudioStageModelRef(planningRole)
	if !ok {
		planning = legacy.planningRef()
		planningRole.ThinkingLevel = ""
	}
	vision, ok := s.commerceStudioStageModelRef(stages.Vision)
	if !ok {
		vision = legacy.visionRef()
		stages.Vision.ThinkingLevel = ""
	}
	setting := CommerceStudioAgentSetting{
		LogicalModelID: planning.LogicalModelID, ChannelModelID: planning.ChannelModelID, ChannelID: planning.ChannelID, ModelKey: planning.ModelKey,
		ThinkingLevel: planningRole.ThinkingLevel, VisionThinkingLevel: stages.Vision.ThinkingLevel,
	}
	if vision != planning {
		setting.Vision = &vision
	}
	return setting, nil
}

// ecommerceStageModelRef returns the first usable model of a stage: the primary
// model, or the backup when the primary is no longer enabled.
func (s *Service) commerceStudioStageModelRef(role CommerceStudioOrchestrationRole) (CommerceStudioAgentModelRef, bool) {
	for _, choice := range []CommerceStudioOrchestrationModel{role.Model, role.Fallback} {
		if emptyOrchestrationModel(choice) {
			continue
		}
		if choice.LogicalModelID != "" {
			item, err := s.repo.LogicalModel(choice.LogicalModelID)
			if err == nil && item.Enabled && item.ArchivedAt == nil {
				return CommerceStudioAgentModelRef{LogicalModelID: item.ID}, true
			}
			continue
		}
		item, err := s.repo.ChannelModel(choice.ChannelModelID)
		if err != nil || !item.Enabled || item.DeletedAt.Valid || item.Capability != "text" || !item.PriceConfigured {
			continue
		}
		channels, err := s.repo.SystemChannelsByIDs([]string{item.ChannelID}, false)
		if err != nil || len(channels) != 1 || !channels[0].Enabled {
			continue
		}
		return CommerceStudioAgentModelRef{ChannelModelID: item.ID, ChannelID: item.ChannelID, ModelKey: item.ModelKey}, true
	}
	return CommerceStudioAgentModelRef{}, false
}

func (s *Service) legacyCommerceStudioAgentSetting() (CommerceStudioAgentSetting, error) {
	row, err := s.repo.SystemSetting(commerceStudioAgentSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		access, catalogErr := s.systemGroupAccess()
		if catalogErr != nil {
			return CommerceStudioAgentSetting{}, catalogErr
		}
		models, catalogErr := s.PublicLogicalModels(access, nil)
		if catalogErr != nil {
			return CommerceStudioAgentSetting{}, catalogErr
		}
		for _, item := range models {
			if item.Capability == "text" && item.Available && item.CapabilitySpec.Inputs["image"].Max > 0 {
				return CommerceStudioAgentSetting{LogicalModelID: item.ID}, nil
			}
		}
		return CommerceStudioAgentSetting{}, nil
	}
	if err != nil {
		return CommerceStudioAgentSetting{}, err
	}
	var setting CommerceStudioAgentSetting
	if err := json.Unmarshal([]byte(row.ValueJSON), &setting); err != nil {
		return CommerceStudioAgentSetting{}, err
	}
	return setting, nil
}
