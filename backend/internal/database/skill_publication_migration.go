package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 历史用户公开技能没有审核记录，不能默认认定为已审核；内置目录保持原状态。
func migrateSkillPublicationReview(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Skill{}) {
		return nil
	}
	if err := tx.Model(&model.Skill{}).Where("status = 0 AND (source_type = ? OR source = ?)", "builtin", 3).Update("status", model.SkillStatusOffline).Error; err != nil {
		return err
	}
	return tx.Model(&model.Skill{}).
		Where("status = ? AND is_private = false AND COALESCE(source_type, '') <> ? AND COALESCE(source, 0) <> ?", model.SkillStatusPublished, "builtin", 3).
		Update("status", model.SkillStatusPending).Error
}
