package repository

import (
	"encoding/json"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func (r *Repository) ReviewSkills(status int, search string, limit, offset int) ([]model.Skill, int64, error) {
	query := r.db.Model(&model.Skill{}).Where("is_private = false AND status IN (1,2,3,4)")
	if status != 0 {
		query = query.Where("status = ?", status)
	}
	if search != "" {
		query = query.Where("lower(name) LIKE ?", "%"+strings.ToLower(search)+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.Skill
	err := query.Order("updated_at DESC, id ASC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, total, err
}

func (r *Repository) PublicSkillIDs(ids []string) ([]string, error) {
	var published []string
	err := r.db.Model(&model.Skill{}).Where(SkillPublicSQL).Where("id IN ?", ids).Pluck("id", &published).Error
	return published, err
}

func (r *Repository) ReviewSkill(actorID, id, versionID string, updatedAt time.Time, status int, requestID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var actor model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&actor, "id = ?", actorID).Error; err != nil {
			return err
		}
		if actor.Role != model.UserRoleAdmin || actor.Status != model.UserStatusActive {
			return kernel.Forbidden("需要管理员权限")
		}
		result := tx.Model(&model.Skill{}).
			Where("id = ? AND is_private = false AND status IN (1,2,3,4) AND current_version_id = ? AND updated_at = ?", id, versionID, updatedAt).
			Updates(map[string]any{"status": status, "updated_at": time.Now().UTC()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return kernel.NewAppError(409, "技能已更新或转为私有，请刷新并重新审核")
		}
		metadata, err := json.Marshal(map[string]any{"status": status, "versionId": versionID, "requestId": requestID})
		if err != nil {
			return err
		}
		return tx.Create(&model.AdminAuditEvent{ID: kernel.NewID(), ActorUserID: actorID, Action: "skill.review", TargetType: "skill", TargetID: id, MetadataJSON: string(metadata)}).Error
	})
}
