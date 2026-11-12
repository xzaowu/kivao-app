package app

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"strings"
	"yingce/backend/internal/model"
)

func (s *Service) requireCommerceStudioTaskFeatures(userID, projectID, taskType, operation, workbenchKind string, input map[string]any) error {
	metadata, _ := input["metadata"].(map[string]any)
	if stringValue(metadata["source"]) == "ecommerce" {
		return nil
	}
	ecommerceID := strings.TrimSpace(stringValue(metadata["ecommerceProjectId"]))
	ecommerce := false
	if ecommerceID != "" {
		if _, err := s.repo.CommerceStudioProject(userID, ecommerceID); err != nil {
			return NotFound("电商项目不存在")
		}
		ecommerce = true
	}
	if projectID = strings.TrimSpace(projectID); projectID != "" && projectID != ecommerceID {
		if exists, err := s.repo.CommerceStudioProjectExists(projectID); err != nil {
			return err
		} else if exists {
			if _, err := s.repo.CommerceStudioProject(userID, projectID); err != nil {
				return NotFound("电商项目不存在或无权访问")
			}
			ecommerce = true
		}
	}

	if stringValue(metadata["source"]) == "ecommerce-agent" && !ecommerce {
		return BadAuthRequest("电商任务必须关联当前用户的电商项目")
	}
	if ecommerce {
		if err := s.RequireFeature(FeatureCommerceStudio); err != nil {
			return err
		}
	}
	if workbenchKind == "" {
		workbenchKind = workbenchKindFromTaskInput(input, taskType)
	}
	if !ecommerce {
		return nil
	}
	// The provider dispatches by mode; type and persisted kind are additional
	// evidence so a mismatched public request cannot weaken media admission.
	if isVideoTaskType(taskType) || stringValue(input["mode"]) == "video" || workbenchKind == WorkbenchKindVideo {
		if ecommerce {
			if err := s.RequireFeature(FeatureCommerceStudioVideo); err != nil {
				return err
			}
		}
		return s.RequireFeature(FeatureVideoWorkbench)
	}
	if taskType == "canvas_image" || stringValue(input["mode"]) == "image" || workbenchKind == WorkbenchKindImage {
		return s.RequireFeature(FeatureImageWorkbench)
	}
	return nil
}

func (s *Service) requireCommerceStudioExecution(task model.Task) error {
	var input map[string]any
	// The ordinary task decoder owns malformed JSON; this guard only handles the new module.
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
		return nil
	}
	metadata, _ := input["metadata"].(map[string]any)
	source := stringValue(metadata["source"])
	if source == "ecommerce" {
		return nil
	}
	relevant := source == "ecommerce-agent" || stringValue(metadata["ecommerceProjectId"]) != ""
	if !relevant && task.ProjectID != "" && s.repo != nil {
		exists, err := s.repo.CommerceStudioProjectExists(task.ProjectID)
		if err != nil {
			return err
		}
		relevant = exists
	}
	if !relevant {
		return nil
	}
	if s.repo == nil {
		return errors.New("电商任务存储不可用")
	}
	// Accepted/unknown upstream work keeps the existing reconciliation path.
	if task.ProviderRequestID != "" {
		return nil
	}
	if attempt, err := s.repo.LatestRouteAttempt(task.ID); err == nil && (attempt.DispatchState == "accepted" || attempt.DispatchState == "submission_unknown" || attempt.DispatchState == "dispatching") {
		return nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return s.requireCommerceStudioTaskFeatures(task.UserID, task.ProjectID, task.Type, task.Operation, task.WorkbenchKind, input)
}
