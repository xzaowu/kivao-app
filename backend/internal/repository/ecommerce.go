package repository

import (
	"errors"
	"gorm.io/gorm/clause"
	"time"
	"yingce/backend/internal/model"
)

var ErrEcommerceConflict = errors.New("商品项目已变化，请刷新后继续")

func (r *Repository) EcommerceProject(userID, id string) (*model.EcommerceProject, error) {
	var item model.EcommerceProject
	err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&item).Error
	return &item, err
}

// Legacy isolated fixtures do not contain new optional-domain tables.
func (r *Repository) EcommerceProjectExists(id string) (bool, error) {
	if id == "" || !r.db.Migrator().HasTable(&model.EcommerceProject{}) {
		return false, nil
	}
	var count int64
	err := r.db.Model(&model.EcommerceProject{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

func (r *Repository) EcommerceProjects(userID string, offset, limit int) ([]model.EcommerceProject, error) {
	items := []model.EcommerceProject{}
	err := r.db.Where("user_id = ? AND status = ?", userID, "active").Order("updated_at desc, id").Offset(offset).Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) CreateEcommerceProject(item *model.EcommerceProject) error {
	return r.db.Create(item).Error
}

func (r *Repository) SaveEcommerceProject(item *model.EcommerceProject, expected int64) error {
	result := r.db.Model(&model.EcommerceProject{}).Where("id = ? AND user_id = ? AND revision = ?", item.ID, item.UserID, expected).Updates(map[string]any{"name": item.Name, "status": item.Status, "draft_json": item.DraftJSON, "plan_json": item.PlanJSON, "active_round_id": item.ActiveRoundID, "revision": expected + 1, "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrEcommerceConflict
	}
	item.Revision = expected + 1
	return nil
}

func (r *Repository) ArchiveEcommerceRound(project *model.EcommerceProject) error {
	var ordinal int64
	if err := r.db.Model(&model.EcommerceRound{}).Where("project_id = ? AND user_id = ?", project.ID, project.UserID).Select("COALESCE(MAX(ordinal), 0)").Scan(&ordinal).Error; err != nil {
		return err
	}
	return r.db.Create(&model.EcommerceRound{ID: project.ActiveRoundID, UserID: project.UserID, ProjectID: project.ID, Ordinal: ordinal + 1, DraftJSON: project.DraftJSON, PlanJSON: project.PlanJSON, CreatedAt: time.Now()}).Error
}

func (r *Repository) EcommerceRounds(userID, projectID string, offset, limit int) ([]model.EcommerceRound, error) {
	items := []model.EcommerceRound{}
	err := r.db.Where("user_id = ? AND project_id = ?", userID, projectID).Order("ordinal desc").Offset(offset).Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) EcommerceDocuments(userID string) ([]ResourceReferenceDocument, error) {
	documents := []ResourceReferenceDocument{}
	if !r.db.Migrator().HasTable(&model.EcommerceProject{}) {
		return documents, nil
	}
	for _, table := range []string{"ecommerce_projects", "ecommerce_rounds"} {
		var rows []struct{ ID, DraftJSON, PlanJSON string }
		if err := r.db.Table(table).Where("user_id = ?", userID).Select("id, draft_json, plan_json").Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			documents = append(documents, ResourceReferenceDocument{Kind: "商品套图", ID: row.ID, Title: "商品资料与历史轮次", PrimaryJSON: row.DraftJSON, SecondaryJSON: row.PlanJSON})
		}
	}
	return documents, nil
}

// Lock reference identities before saving a draft, alongside deletion's row lock.
func (r *Repository) LockEcommerceReferences(userID string, ids []string) error {
	var resources []model.Resource
	query := r.db.Where("user_id = ? AND id IN ? AND kind = ? AND status = ?", userID, ids, "image", model.ResourceStatusReady).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Find(&resources).Error; err != nil {
		return err
	}
	if len(resources) != len(ids) {
		return ErrEcommerceConflict
	}
	return nil
}

func (r *Repository) addEcommerceStorageUsage(userID string, usage *UserStorageUsage) error {
	if !r.db.Migrator().HasTable(&model.EcommerceProject{}) {
		return nil
	}
	var count int64
	if err := r.db.Model(&model.EcommerceProject{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return err
	}
	usage.CanvasCount += count
	expression := "length(CAST(draft_json AS BLOB)) + length(CAST(plan_json AS BLOB))"
	if r.Dialect() == "postgres" {
		expression = "octet_length(draft_json) + octet_length(plan_json)"
	}
	for _, table := range []string{"ecommerce_projects", "ecommerce_rounds"} {
		var bytes int64
		if err := r.db.Table(table).Where("user_id = ?", userID).Select("COALESCE(SUM(" + expression + "),0)").Scan(&bytes).Error; err != nil {
			return err
		}
		usage.CanvasBytes += bytes
	}
	return nil
}
