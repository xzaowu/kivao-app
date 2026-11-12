package repository

import "yingce/backend/internal/model"

func (r *Repository) SystemSettingsWithPrefix(prefix string, limit int) ([]model.SystemSetting, error) {
	rows := []model.SystemSetting{}
	// Prefix comparison treats underscores literally; LIKE would widen the namespace.
	err := r.db.Where("substr(key, 1, ?) = ?", len(prefix), prefix).Order("key ASC").Limit(limit).Find(&rows).Error
	return rows, err
}
