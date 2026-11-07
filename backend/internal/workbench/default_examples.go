package workbench

import (
	"encoding/json"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func (s *Service) DefaultExamples(kind string) (*ResultExampleView, error) {
	if !validKind(kind) {
		return nil, kernel.BadAuthRequest("工作台类型无效")
	}
	setting, err := s.repo.SystemSettingOptional(model.WorkbenchExamplesSettingPrefix + kind)
	if err != nil {
		return nil, err
	}
	var example ResultExample
	if setting != nil {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &example); err != nil {
			return nil, kernel.BadAuthRequest("默认作品示例配置无效")
		}
	}
	view := ToolView{ResultExample: resultExampleView(example)}
	if err := s.attachToolMedia(&view); err != nil {
		return nil, err
	}
	return &view.ResultExample, nil
}

func (s *Service) AdminDefaultExamples(actor *model.User, kind string) (*ResultExampleView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	return s.DefaultExamples(kind)
}

func (s *Service) SaveDefaultExamples(actor *model.User, kind string, example ResultExample) (*ResultExampleView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	if !validKind(kind) {
		return nil, kernel.BadAuthRequest("工作台类型无效")
	}
	config, err := normalizeCatalogConfig(catalogConfig{ResultExample: example})
	if err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	guide, err := json.Marshal(map[string]any{"resultExample": config.ResultExample})
	if err != nil {
		return nil, err
	}
	if err := s.validateToolResources(actor.ID, "", "", "{}", string(guide)); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(config.ResultExample)
	if err != nil {
		return nil, err
	}
	key := model.WorkbenchExamplesSettingPrefix + kind
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: key, ValueJSON: string(encoded), UpdatedBy: actor.ID}); err != nil {
		return nil, err
	}
	if err := s.audit(actor, "workbench_examples.update", key, "更新工作台默认作品示例", map[string]any{"kind": kind, "count": len(resultExampleItems(config.ResultExample))}); err != nil {
		return nil, err
	}
	return s.DefaultExamples(kind)
}
