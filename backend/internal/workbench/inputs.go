package workbench

import (
	"encoding/json"
	"fmt"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// Preset input settings use the existing JSON column, outside generation parameters.
type presetInputs struct {
	SlotKeys       *[]string `json:"slotKeys,omitempty"`
	NoticeSlotKeys []string  `json:"noticeSlotKeys,omitempty"`
}

func readPresetInputs(preset *model.WorkbenchPreset) (*presetInputs, error) {
	if preset == nil || preset.DefaultParamsJSON == "" {
		return nil, nil
	}
	var parameters map[string]json.RawMessage
	if err := json.Unmarshal([]byte(preset.DefaultParamsJSON), &parameters); err != nil {
		return nil, kernel.BadAuthRequest("效果素材配置无效")
	}
	raw, ok := parameters["workbenchInputs"]
	if !ok {
		return nil, nil
	}
	var settings *presetInputs
	if err := json.Unmarshal(raw, &settings); err != nil || settings == nil {
		return nil, kernel.BadAuthRequest("效果素材配置无效")
	}
	return settings, nil
}

func presetInputContract(contract InputContract, preset *model.WorkbenchPreset) (InputContract, error) {
	settings, err := readPresetInputs(preset)
	if err != nil || settings == nil {
		return contract, err
	}
	slots := map[string]ReferenceSlot{}
	for _, slot := range contract.Slots {
		slots[slot.Key] = slot
	}
	validateKeys := func(keys []string) error {
		if len(keys) > 20 {
			return kernel.BadAuthRequest("效果素材数量超出限制")
		}
		seen := map[string]bool{}
		for _, key := range keys {
			if _, ok := slots[key]; !ok || seen[key] {
				return kernel.BadAuthRequest("效果引用了不存在或重复的素材输入区")
			}
			seen[key] = true
		}
		return nil
	}
	selected := map[string]bool{}
	if settings.SlotKeys != nil {
		if err := validateKeys(*settings.SlotKeys); err != nil {
			return contract, err
		}
		for _, key := range *settings.SlotKeys {
			selected[key] = true
		}
	}
	active := make([]ReferenceSlot, 0, len(contract.Slots))
	for _, slot := range contract.Slots {
		if slot.Common == nil || *slot.Common || settings.SlotKeys == nil || selected[slot.Key] {
			active = append(active, slot)
		}
	}
	if err := validateKeys(settings.NoticeSlotKeys); err != nil {
		return contract, err
	}
	for _, key := range settings.NoticeSlotKeys {
		slot := slots[key]
		if slot.SampleResourceID == "" || (settings.SlotKeys != nil && slot.Common != nil && !*slot.Common && !selected[key]) {
			return contract, kernel.BadAuthRequest(fmt.Sprintf("请先启用素材输入并上传注意事项图片：%s", slot.Name))
		}
	}
	contract.Slots = active
	return contract, nil
}

func (s *Service) validateToolPresetInputs(tool *model.WorkbenchTool, presets *[]model.WorkbenchPreset) error {
	if presets == nil {
		items, err := s.repo.WorkbenchPresets(tool.ID, false)
		if err != nil {
			return err
		}
		presets = &items
	}
	config, err := parseCatalogConfig(tool.CapabilityJSON, tool.GuideJSON)
	if err != nil {
		return kernel.BadAuthRequest("工具素材配置无效")
	}
	if config.ProcessingOperation == "depth_capture" && len(*presets) > 0 {
		return kernel.BadAuthRequest("深度动作捕捉不使用提示词或效果预设")
	}
	for _, preset := range *presets {
		if _, err := presetInputContract(config.InputContract, &preset); err != nil {
			return err
		}
	}
	return nil
}
