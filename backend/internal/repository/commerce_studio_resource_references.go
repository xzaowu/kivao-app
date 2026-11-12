package repository

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (r *Repository) CommerceStudioProjectExists(id string) (bool, error) {
	if id == "" || !r.db.Migrator().HasTable(&model.CommerceStudioProject{}) {
		return false, nil
	}
	var count int64
	err := r.db.Model(&model.CommerceStudioProject{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

func (r *Repository) CommerceStudioDocuments(userID string) ([]ResourceReferenceDocument, error) {
	documents := []ResourceReferenceDocument{}
	if !r.db.Migrator().HasTable(&model.CommerceStudioProject{}) {
		return documents, nil
	}
	for _, table := range []string{"commerce_studio_projects", "commerce_studio_rounds"} {
		if !r.db.Migrator().HasTable(table) {
			continue
		}
		var rows []struct{ ID, DraftJSON, PlanJSON string }
		if err := r.db.Table(table).Where("user_id = ?", userID).Select("id, draft_json, plan_json").Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			documents = append(documents, ResourceReferenceDocument{Kind: "电商 Agent", ID: row.ID, Title: "商品资料与历史轮次", PrimaryJSON: row.DraftJSON, SecondaryJSON: row.PlanJSON})
		}
	}
	for _, item := range []struct{ table, fields string }{
		{"commerce_studio_creative_recommendations", "directions_json AS primary_json, evidence_json AS secondary_json"},
		{"commerce_studio_agent_analyses", "payload_json AS primary_json"},
		{"commerce_studio_agent_runs", "canvas_json AS primary_json, brief_json AS secondary_json"},
		{"commerce_studio_agent_canvas_versions", "canvas_json AS primary_json"},
	} {
		if !r.db.Migrator().HasTable(item.table) {
			continue
		}
		var rows []struct{ ID, PrimaryJSON, SecondaryJSON string }
		if err := r.db.Table(item.table).Where("user_id = ?", userID).Select("id, " + item.fields).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			documents = append(documents, ResourceReferenceDocument{Kind: "电商 Agent", ID: row.ID, Title: "商品创作记录", PrimaryJSON: row.PrimaryJSON, SecondaryJSON: row.SecondaryJSON})
		}
	}
	return documents, nil
}

// Product drafts and archived rounds share the existing structured-data quota.
func (r *Repository) addCommerceStudioStorageUsage(userID string, usage *UserStorageUsage) error {
	if !r.db.Migrator().HasTable(&model.CommerceStudioProject{}) {
		return nil
	}
	var count int64
	if err := r.db.Model(&model.CommerceStudioProject{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return err
	}
	usage.CanvasCount += count
	expression := "length(CAST(draft_json AS BLOB)) + length(CAST(plan_json AS BLOB))"
	if r.Dialect() == "postgres" {
		expression = "octet_length(draft_json) + octet_length(plan_json)"
	}
	for _, table := range []string{"commerce_studio_projects", "commerce_studio_rounds"} {
		if !r.db.Migrator().HasTable(table) {
			continue
		}
		var bytes int64
		if err := r.db.Table(table).Where("user_id = ?", userID).Select("COALESCE(SUM(" + expression + "),0)").Scan(&bytes).Error; err != nil {
			return err
		}
		usage.CanvasBytes += bytes
	}
	return nil
}

// Reserve SQLite's writer before quota/reference reads. Upgrading a deferred
// read snapshot after a worker commits otherwise fails with SQLITE_BUSY_SNAPSHOT.
// UpdateColumn leaves revision/updated_at unchanged; PostgreSQL uses row locks below.
func (r *Repository) LockCommerceStudioWrite(userID, projectID string) error {
	if r.Dialect() != "sqlite" {
		return nil
	}
	return r.db.Model(&model.CommerceStudioProject{}).Where("user_id = ? AND id = ?", userID, projectID).UpdateColumn("revision", gorm.Expr("revision")).Error
}
