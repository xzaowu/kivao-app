package app

import (
	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

type InspirationInput = workbench.InspirationInput
type InspirationView = workbench.InspirationView

func (s *Service) Inspirations(actor *model.User, admin bool) ([]InspirationView, error) {
	items, err := s.workbenchDomain().Inspirations(actor, admin)
	if err != nil || admin {
		return items, err
	}
	result := []InspirationView{}
	for _, item := range items {
		if item.Type == "tool" {
			feature := FeatureImageWorkbench
			if item.Mode == "video" {
				feature = FeatureVideoWorkbench
			}
			available, err := s.FeatureEnabled(feature)
			if err != nil {
				return nil, err
			}
			if !available {
				continue
			}
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) SaveInspiration(actor *model.User, id string, input InspirationInput, remove bool) (*InspirationView, error) {
	return s.workbenchDomain().SaveInspiration(actor, id, input, remove)
}
