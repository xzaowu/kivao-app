package repository

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrTryOnBatchDeleted = errors.New("换装批次已删除")
var ErrTryOnTaskRemoved = errors.New("换装任务已移除")

// LockTryOnBatch is called inside the same transaction as creating a task or
// deleting the batch. The write also serializes the first submission on SQLite.
func (r *Repository) LockTryOnBatch(userID, batchID string) (*model.TryOnBatch, error) {
	batch := model.TryOnBatch{UserID: userID, BatchID: batchID}
	if err := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&batch).Error; err != nil {
		return nil, err
	}
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&batch, "user_id = ? AND batch_id = ?", userID, batchID).Error
	return &batch, err
}

func (r *Repository) TryOnBatchDeleted(userID, batchID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.TryOnBatch{}).Where("user_id = ? AND batch_id = ? AND deleted = ?", userID, batchID, true).Count(&count).Error
	return count != 0, err
}

func (r *Repository) MarkTryOnBatchDeleted(userID, batchID string) error {
	return r.db.Model(&model.TryOnBatch{}).Where("user_id = ? AND batch_id = ?", userID, batchID).Update("deleted", true).Error
}

func (r *Repository) TryOnSubmittedTask(slot model.TryOnTaskReceipt) (*model.Task, error) {
	deleted, err := r.TryOnBatchDeleted(slot.UserID, slot.BatchID)
	if err != nil {
		return nil, err
	}
	if deleted {
		return nil, ErrTryOnBatchDeleted
	}
	var receipt model.TryOnTaskReceipt
	err = r.db.Take(&receipt, "user_id = ? AND batch_id = ? AND slot_key = ?", slot.UserID, slot.BatchID, slot.SlotKey).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	task, err := r.TaskForUser(slot.UserID, receipt.TaskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTryOnTaskRemoved
	}
	return task, err
}

func (r *Repository) SaveTryOnReceipt(receipt model.TryOnTaskReceipt) error {
	return r.db.Create(&receipt).Error
}
