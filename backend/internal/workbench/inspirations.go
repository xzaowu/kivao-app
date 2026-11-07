package workbench

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type InspirationInput struct {
	Version            int                  `json:"version"`
	Type               string               `json:"type"`
	ToolID             string               `json:"toolId,omitempty"`
	Title              string               `json:"title"`
	Description        string               `json:"description"`
	Mode               string               `json:"mode"`
	Category           string               `json:"category"`
	Prompt             string               `json:"prompt"`
	ResourceID         string               `json:"resourceId,omitempty"`
	MediaKind          string               `json:"mediaKind,omitempty"`
	AdditionalExamples []InspirationExample `json:"additionalExamples,omitempty"`
	SortOrder          int                  `json:"sortOrder"`
	Enabled            bool                 `json:"enabled"`
}

type InspirationExample struct {
	ResourceID string `json:"resourceId"`
	MediaKind  string `json:"mediaKind"`
}

type InspirationExampleView struct {
	InspirationExample
	MediaURL string `json:"mediaUrl,omitempty"`
}

type InspirationView struct {
	InspirationInput
	ID              string                   `json:"id"`
	MediaURL        string                   `json:"mediaUrl,omitempty"`
	ToolUnavailable bool                     `json:"toolUnavailable,omitempty"`
	Examples        []InspirationExampleView `json:"examples"`
}

func (s *Service) Inspirations(actor *model.User, admin bool) ([]InspirationView, error) {
	if admin {
		if err := s.requireAdmin(actor); err != nil {
			return nil, err
		}
	}
	settings, err := s.repo.InspirationSettings()
	if err != nil {
		return nil, err
	}
	items := []InspirationView{}
	for _, setting := range settings {
		var input InspirationInput
		if err := json.Unmarshal([]byte(setting.ValueJSON), &input); err != nil {
			return nil, err
		}
		if !admin && !input.Enabled {
			continue
		}
		view, err := s.inspirationView(strings.TrimPrefix(setting.Key, model.InspirationSettingPrefix), input)
		if err != nil {
			return nil, err
		}
		if !admin && view.ToolUnavailable {
			continue
		}
		if admin && input.Type == "tool" {
			view.Category = input.Category
		}
		items = append(items, *view)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].SortOrder != items[j].SortOrder {
			return items[i].SortOrder < items[j].SortOrder
		}
		return items[i].ID < items[j].ID
	})
	return items, nil
}

func (s *Service) inspirationView(id string, input InspirationInput) (*InspirationView, error) {
	view := &InspirationView{InspirationInput: input, ID: id, Examples: []InspirationExampleView{}}
	examples := inspirationExamples(input)
	if input.Type == "tool" {
		tool, err := s.repo.WorkbenchTool(input.ToolID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			view.ToolUnavailable = true
			return view, nil
		}
		if err != nil {
			return nil, err
		}
		view.ToolUnavailable = !tool.Enabled
		view.Title, view.Description, view.Mode = tool.Name, tool.Subtitle, tool.Kind
		if view.Category == "" {
			view.Category = tool.CategoryID
		}
		view.ResourceID, view.MediaKind = tool.CoverResourceID, "image"
		config, err := parseCatalogConfig(tool.CapabilityJSON, tool.GuideJSON)
		if err != nil {
			return nil, err
		}
		examples = []InspirationExample{}
		for _, item := range resultExampleItems(config.ResultExample) {
			if len(examples) == 10 {
				break
			}
			examples = append(examples, InspirationExample{ResourceID: item.ResourceID, MediaKind: item.Kind})
		}
		if len(examples) == 0 {
			resourceID := tool.CoverResourceID
			if resourceID == "" {
				resourceID = tool.IconResourceID
			}
			if resourceID != "" {
				examples = append(examples, InspirationExample{ResourceID: resourceID, MediaKind: "image"})
			}
		}
		view.Prompt = ""
	}
	for _, item := range examples {
		example := InspirationExampleView{InspirationExample: item}
		if s.access != nil {
			url, err := s.access.WorkbenchResourceAccess(item.ResourceID)
			if err != nil {
				return nil, err
			}
			example.MediaURL = url
		}
		view.Examples = append(view.Examples, example)
	}
	if len(view.Examples) > 0 {
		first := view.Examples[0]
		view.ResourceID, view.MediaKind, view.MediaURL = first.ResourceID, first.MediaKind, first.MediaURL
	}
	return view, nil
}

func inspirationExamples(input InspirationInput) []InspirationExample {
	items := []InspirationExample{}
	if input.ResourceID != "" {
		items = append(items, InspirationExample{ResourceID: input.ResourceID, MediaKind: input.MediaKind})
	}
	return append(items, input.AdditionalExamples...)
}

func (s *Service) SaveInspiration(actor *model.User, id string, input InspirationInput, remove bool) (*InspirationView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	var before *model.SystemSetting
	var prior InspirationInput
	var err error
	if id != "" {
		before, err = s.repo.SystemSettingOptional(model.InspirationSettingPrefix + id)
		if err != nil {
			return nil, err
		}
		if before == nil {
			return nil, kernel.NewAppError(404, "灵感不存在")
		}
		if err := json.Unmarshal([]byte(before.ValueJSON), &prior); err != nil {
			return nil, err
		}
		if input.Version != prior.Version {
			return nil, kernel.NewAppError(409, repository.ErrInspirationConflict.Error())
		}
	} else {
		if remove {
			return nil, kernel.BadAuthRequest("缺少灵感 ID")
		}
		if input.Version != 0 {
			return nil, kernel.BadAuthRequest("新建灵感版本无效")
		}
		id = kernel.NewID()
	}
	var next *model.SystemSetting
	if !remove {
		input.Title, input.Description, input.Category = strings.TrimSpace(input.Title), strings.TrimSpace(input.Description), strings.TrimSpace(input.Category)
		input.Prompt, input.ToolID, input.ResourceID = strings.TrimSpace(input.Prompt), strings.TrimSpace(input.ToolID), strings.TrimSpace(input.ResourceID)
		if utf8.RuneCountInString(input.Title) > 120 || utf8.RuneCountInString(input.Description) > 2000 || utf8.RuneCountInString(input.Category) > 64 || utf8.RuneCountInString(input.Prompt) > 32000 || input.SortOrder < 0 || input.SortOrder > 1000000 {
			return nil, kernel.BadAuthRequest("标题、说明、分类、提示词或排序超出限制")
		}
		switch input.Type {
		case "prompt":
			if input.Title == "" || input.Prompt == "" || (input.Mode != "image" && input.Mode != "video" && input.Mode != "text") {
				return nil, kernel.BadAuthRequest("请填写标题、提示词和有效的创作类型")
			}
			input.ToolID = ""
			if len(input.AdditionalExamples) > 9 || (input.ResourceID == "" && len(input.AdditionalExamples) > 0) {
				return nil, kernel.BadAuthRequest("每条灵感最多 10 个示例，且需指定首个示例")
			}
			known := map[InspirationExample]bool{}
			for _, item := range inspirationExamples(prior) {
				known[item] = true
			}
			seen := map[string]bool{}
			newMedia := []ResultExampleItem{}
			items := inspirationExamples(input)
			for index := range items {
				items[index].ResourceID = strings.TrimSpace(items[index].ResourceID)
				item := items[index]
				if item.ResourceID == "" || (item.MediaKind != "image" && item.MediaKind != "video") {
					return nil, kernel.BadAuthRequest("示例必须为有效的图片或视频资源")
				}
				if seen[item.ResourceID] {
					return nil, kernel.BadAuthRequest("示例资源不能重复")
				}
				seen[item.ResourceID] = true
				if !known[item] {
					newMedia = append(newMedia, ResultExampleItem{ResourceID: item.ResourceID, Kind: item.MediaKind})
				}
			}
			if len(newMedia) > 0 {
				guide, _ := json.Marshal(map[string]any{"resultExample": ResultExample{Items: newMedia}})
				if err := s.validateToolResources(actor.ID, "", "", "{}", string(guide)); err != nil {
					return nil, err
				}
			}
			input.AdditionalExamples = nil
			if len(items) > 0 {
				input.ResourceID, input.MediaKind = items[0].ResourceID, items[0].MediaKind
				input.AdditionalExamples = items[1:]
			} else {
				input.MediaKind = ""
			}
		case "tool":
			if input.ToolID == "" {
				return nil, kernel.BadAuthRequest("请选择创作工具")
			}
			if _, err := s.repo.WorkbenchTool(input.ToolID); err != nil {
				return nil, kernel.BadAuthRequest("关联的创作工具不存在")
			}
			input.Title, input.Description, input.Prompt, input.ResourceID, input.MediaKind, input.Mode = "", "", "", "", "", ""
			input.AdditionalExamples = nil
		default:
			return nil, kernel.BadAuthRequest("灵感条目类型无效")
		}
		input.Version++
		encoded, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		next = &model.SystemSetting{Key: model.InspirationSettingPrefix + id, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	}
	action := "inspiration.save"
	if remove {
		action = "inspiration.delete"
	}
	audit := &model.AdminAuditEvent{ID: kernel.NewID(), ActorUserID: actor.ID, Action: action, TargetType: "inspiration", TargetID: id, Summary: "更新灵感大厅条目", MetadataJSON: "{}", CreatedAt: time.Now()}
	if err := s.repo.SaveInspiration(before, next, audit); err != nil {
		if errors.Is(err, repository.ErrInspirationConflict) {
			return nil, kernel.NewAppError(409, err.Error())
		}
		return nil, err
	}
	if remove {
		return nil, nil
	}
	return s.inspirationView(id, input)
}
