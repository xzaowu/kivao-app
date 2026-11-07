package repository

import (
	"errors"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

var ErrInspirationConflict = errors.New("灵感已被其他管理员修改，请刷新后重试")

func (r *Repository) InspirationSettings() ([]model.SystemSetting, error) {
	items := []model.SystemSetting{}
	err := r.db.Where("key LIKE ?", model.InspirationSettingPrefix+"%").Order("key asc").Find(&items).Error
	return items, err
}

// Persist the entry and its audit together; compare the prior JSON to reject stale edits.
func (r *Repository) SaveInspiration(before, next *model.SystemSetting, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if before == nil {
			if err := tx.Create(next).Error; err != nil {
				return err
			}
		} else {
			query := tx.Where("key = ? AND value_json = ?", before.Key, before.ValueJSON)
			var result *gorm.DB
			if next == nil {
				result = query.Delete(&model.SystemSetting{})
			} else {
				result = query.Model(&model.SystemSetting{}).Updates(map[string]any{"value_json": next.ValueJSON, "updated_by": next.UpdatedBy})
			}
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrInspirationConflict
			}
		}
		return tx.Create(audit).Error
	})
}
