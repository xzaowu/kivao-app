package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type CommerceStudioRoundView struct {
	ID         string                    `json:"id"`
	ProjectID  string                    `json:"projectId"`
	Ordinal    int                       `json:"ordinal"`
	ImageCount int                       `json:"imageCount"`
	Version    int64                     `json:"version"`
	CreatedAt  time.Time                 `json:"createdAt"`
	UpdatedAt  time.Time                 `json:"updatedAt"`
	Plan       *model.CommerceStudioPlan `json:"plan"`
}

type CommerceStudioRoundPageResult struct {
	Rounds  []CommerceStudioRoundView `json:"rounds"`
	Total   int64                     `json:"total"`
	HasMore bool                      `json:"hasMore"`
}

type CommerceStudioRoundConversion struct {
	CreatedRounds int   `json:"createdRounds"`
	TotalRounds   int64 `json:"totalRounds"`
	TotalImages   int64 `json:"totalImages"`
}

type CommerceStudioRoundImageUpdateRequest struct {
	Version int64                         `json:"version"`
	Image   *model.CommerceStudioPlanTask `json:"image,omitempty"`
	Remove  bool                          `json:"remove"`
}

const commerceStudioRoundPageMax = 20
const commerceStudioRoundPageDefault = 10

func commerceStudioRoundView(round *model.CommerceStudioRound) CommerceStudioRoundView {
	view := CommerceStudioRoundView{
		ID:         round.ID,
		ProjectID:  round.ProjectID,
		Ordinal:    round.Ordinal,
		ImageCount: round.ImageCount,
		Version:    round.Version,
		CreatedAt:  round.CreatedAt,
		UpdatedAt:  round.UpdatedAt,
	}
	var plan model.CommerceStudioPlan
	if json.Unmarshal([]byte(round.PlanJSON), &plan) == nil {
		plan.PreviousImages = nil
		for i := range plan.Images {
			plan.Images[i].RoundID = round.ID
		}
		view.Plan = &plan
	}
	return view
}

func (s *Service) CommerceStudioRoundPage(userID, projectID string, limit, before int) (*CommerceStudioRoundPageResult, error) {
	if err := s.RequireFeature(FeatureCommerceStudio); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = commerceStudioRoundPageDefault
	}
	if limit > commerceStudioRoundPageMax {
		limit = commerceStudioRoundPageMax
	}
	if before < 0 {
		return nil, BadAuthRequest("历史分页游标无效")
	}
	if _, err := s.repo.CommerceStudioProject(userID, projectID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("电商项目不存在")
		}
		return nil, err
	}
	rounds, total, err := s.repo.CommerceStudioRoundPage(userID, projectID, limit, before)
	if err != nil {
		return nil, err
	}
	result := &CommerceStudioRoundPageResult{Rounds: make([]CommerceStudioRoundView, 0, len(rounds)), Total: total}
	for i := range rounds {
		result.Rounds = append(result.Rounds, commerceStudioRoundView(&rounds[i]))
	}
	if len(rounds) > 0 {
		result.HasMore = int64(rounds[len(rounds)-1].Ordinal) > 1
	}
	return result, nil
}

func (s *Service) ConvertCommerceStudioRounds(userID, projectID string, expectedRevision int64) (*model.CommerceStudioProject, CommerceStudioRoundConversion, error) {
	var conversion CommerceStudioRoundConversion
	if err := s.RequireFeature(FeatureCommerceStudio); err != nil {
		return nil, conversion, err
	}
	project, created, err := s.repo.ConvertCommerceStudioProjectRounds(userID, projectID, expectedRevision)
	if errors.Is(err, repository.ErrCommerceStudioRoundConflict) {
		return nil, conversion, creationConflict("项目已在其他窗口更新，请刷新后重试")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, conversion, NotFound("电商项目不存在")
	}
	if err != nil {
		return nil, conversion, err
	}
	conversion.CreatedRounds = created
	if total, images, err := s.repo.CommerceStudioRoundStats(userID, projectID); err == nil {
		conversion.TotalRounds = total
		conversion.TotalImages = images
	}
	project.RoundCount = conversion.TotalRounds
	s.fillCommerceStudioCoverTasks(userID, project)
	return project, conversion, nil
}

func (s *Service) UpdateCommerceStudioRoundImage(userID, projectID, roundID, imageID string, req CommerceStudioRoundImageUpdateRequest) (*CommerceStudioRoundView, error) {
	if err := s.RequireFeature(FeatureCommerceStudio); err != nil {
		return nil, err
	}
	if (req.Image == nil) == !req.Remove {
		return nil, BadAuthRequest("请指定要更新的图片或移除操作")
	}
	if strings.TrimSpace(imageID) == "" {
		return nil, BadAuthRequest("图片ID不能为空")
	}
	round, err := s.repo.CommerceStudioRound(userID, projectID, roundID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("历史轮次不存在")
	}
	if err != nil {
		return nil, err
	}
	if req.Image != nil {
		image := *req.Image
		if image.ID != imageID {
			return nil, BadAuthRequest("图片ID与路径不一致")
		}
		if len(image.Prompt) > 32000 {
			return nil, BadAuthRequest("图片提示词过长")
		}
		if len(image.SourceDraft) > 128<<10 {
			return nil, BadAuthRequest("历史图片参数快照过长")
		}
		if image.TaskID != "" {
			task, err := s.repo.TaskForUser(userID, image.TaskID)
			if err != nil || task.Type != "canvas_image" {
				return nil, BadAuthRequest("生成任务不存在或不属于当前用户")
			}
			var plan model.CommerceStudioPlan
			if json.Unmarshal([]byte(round.PlanJSON), &plan) == nil {
				for _, existing := range plan.Images {
					if existing.ID != imageID && existing.TaskID == image.TaskID {
						return nil, BadAuthRequest("同一生成任务不能绑定多张策划图")
					}
				}
			}
		}
		req.Image = &image
	}
	updated, _, err := s.repo.UpdateCommerceStudioRoundImage(userID, projectID, roundID, imageID, repository.CommerceStudioRoundImageUpdate{ExpectedVersion: req.Version, Image: req.Image, Remove: req.Remove})
	if errors.Is(err, repository.ErrCommerceStudioRoundConflict) {
		return nil, creationConflict("这轮历史已在其他窗口更新，请刷新后重试")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("图片不在该历史轮次中")
	}
	if err != nil {
		return nil, err
	}
	view := commerceStudioRoundView(updated)
	return &view, nil
}
