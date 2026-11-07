package skills

import (
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// 私有内容仍由作者使用；所有用户提交的公开新版本都重新审核，内置技能保留管理员上下架状态。
func resetSkillReview(skill *model.Skill) {
	if skill.SourceType == "builtin" || skill.Source == 3 {
		return
	}
	if skill.IsPrivate {
		skill.Status = model.SkillStatusPublished
	} else {
		skill.Status = model.SkillStatusPending
	}
}

func requireSkillReviewer(actor *model.User) error {
	if actor == nil || actor.Role != model.UserRoleAdmin || actor.Status != model.UserStatusActive {
		return kernel.Forbidden("需要管理员权限")
	}
	return nil
}

func (s *Service) AdminReviewSkills(actor *model.User, status int, search string, page, pageSize int) (*SkillList, error) {
	if err := requireSkillReviewer(actor); err != nil {
		return nil, err
	}
	if status < 0 || status > model.SkillStatusOffline {
		return nil, kernel.BadAuthRequest("无效审核状态")
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	search = strings.TrimSpace(search)
	if len([]rune(search)) > 100 {
		return nil, kernel.BadAuthRequest("搜索内容过长")
	}
	rows, total, err := s.repo.ReviewSkills(status, search, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	items, err := s.skillItems(actor.ID, rows, false)
	if err != nil {
		return nil, err
	}
	return &SkillList{Skills: items, TotalCount: total, HasMore: int64(page*pageSize) < total, Page: page, PageSize: pageSize, Categories: []SkillCategory{}}, nil
}

func (s *Service) ReviewSkill(actor *model.User, id, versionID string, updatedAt time.Time, action, requestID string) error {
	if err := requireSkillReviewer(actor); err != nil {
		return err
	}
	status := 0
	switch action {
	case "approve":
		status = model.SkillStatusPublished
	case "reject":
		status = model.SkillStatusRejected
	case "offline":
		status = model.SkillStatusOffline
	default:
		return kernel.BadAuthRequest("无效审核操作")
	}
	if strings.TrimSpace(id) == "" || versionID == "" || updatedAt.IsZero() {
		return kernel.BadAuthRequest("缺少技能审核版本，请刷新后重试")
	}
	return s.repo.ReviewSkill(actor.ID, id, versionID, updatedAt, status, requestID)
}
