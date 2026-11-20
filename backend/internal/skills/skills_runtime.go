package skills

import (
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// Runtime methods are for server-side execution only. HTTP readers use the redacted SkillDetail.
func (s *Service) RuntimeSkillDetail(userID, id string) (*SkillItem, error) {
	skill, err := s.visibleSkill(userID, id)
	if err != nil {
		return nil, err
	}
	state, err := s.skillState(userID, skill.ID)
	if err != nil {
		return nil, err
	}
	if skill.Status != skillStatusEnabled || (skill.OwnerID != userID && !state.Added) {
		return nil, kernel.Forbidden("只能使用已加入且启用的技能")
	}
	items, err := s.skillItems(userID, []model.Skill{*skill}, true, true)
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

func (s *Service) runtimeSkillSnapshot(userID, id string) (*skillPackageSnapshot, error) {
	if _, err := s.RuntimeSkillDetail(userID, id); err != nil {
		return nil, err
	}
	skill, err := s.visibleSkill(userID, id)
	if err != nil {
		return nil, err
	}
	return s.skillPackageSnapshot(skill)
}

func (s *Service) RuntimeSkillPackageFile(userID, id, filePath string) (*SkillPackageFileContent, error) {
	snapshot, err := s.runtimeSkillSnapshot(userID, id)
	if err != nil {
		return nil, err
	}
	return s.skillPackageFileContent(snapshot, filePath)
}

func (s *Service) RuntimeSkillPackageFiles(userID, id string) ([]SkillPackageFileItem, error) {
	snapshot, err := s.runtimeSkillSnapshot(userID, id)
	if err != nil {
		return nil, err
	}
	items := make([]SkillPackageFileItem, 0, len(snapshot.files))
	for _, file := range snapshot.files {
		items = append(items, skillFileItem(file))
	}
	return items, nil
}
