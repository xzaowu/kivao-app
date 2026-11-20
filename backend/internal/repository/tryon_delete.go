package repository

import (
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

// Lock all tasks in the batch, including results beyond the paginated history.
func (r *Repository) TryOnBatchTasks(userID, batchID string, lock bool) ([]model.Task, error) {
	var tasks []model.Task
	query := r.db.Where("user_id = ?", userID)
	if r.Dialect() == "postgres" {
		query = query.Where("(workbench_kind = 'image' AND NULLIF(input_json,'')::jsonb #>> '{metadata,workbench,batch,id}' = ?) OR (NULLIF(input_json,'')::jsonb #>> '{metadata,source}' = 'ecommerce-tryon' AND NULLIF(input_json,'')::jsonb #>> '{metadata,tryonBatchId}' = ?)", batchID, batchID)
		if lock {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
	} else {
		query = query.Where("CASE WHEN json_valid(input_json) THEN ((workbench_kind = 'image' AND json_extract(input_json, '$.metadata.workbench.batch.id') = ?) OR (json_extract(input_json, '$.metadata.source') = 'ecommerce-tryon' AND json_extract(input_json, '$.metadata.tryonBatchId') = ?)) ELSE false END", batchID, batchID)
	}
	err := query.Order("id").Find(&tasks).Error
	return tasks, err
}

func (r *Repository) DeleteTerminalTasks(userID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	for _, record := range []any{&model.TaskLog{}, &model.Result{}, &model.TaskTextDelta{}} {
		if err := r.db.Where("user_id = ? AND task_id IN ?", userID, ids).Delete(record).Error; err != nil {
			return err
		}
	}
	// Financial records keep their task identifiers for billing reconciliation.
	return r.db.Where("user_id = ? AND id IN ?", userID, ids).Delete(&model.Task{}).Error
}
