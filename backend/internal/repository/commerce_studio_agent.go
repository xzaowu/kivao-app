package repository

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

func (r *Repository) CommerceStudioAgentRunByKey(userID, key string) (*model.CommerceStudioAgentRun, error) {
	var run model.CommerceStudioAgentRun
	err := r.db.Where("user_id = ? AND idempotency_key = ?", userID, key).First(&run).Error
	return &run, err
}

func (r *Repository) CommerceStudioAgentAnalysis(userID, signature string) (*model.CommerceStudioAgentAnalysis, error) {
	var row model.CommerceStudioAgentAnalysis
	err := r.db.Where("user_id = ? AND signature = ?", userID, signature).First(&row).Error
	return &row, err
}

func (r *Repository) SaveCommerceStudioAgentAnalysis(row *model.CommerceStudioAgentAnalysis) error {
	return r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "signature"}}, DoUpdates: clause.AssignmentColumns([]string{"payload_json", "created_at"})}).Create(row).Error
}

func (r *Repository) CommerceStudioAgentRun(userID, id string) (*model.CommerceStudioAgentRun, error) {
	var run model.CommerceStudioAgentRun
	err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&run).Error
	return &run, err
}

func (r *Repository) LatestCommerceStudioAgentRunByProject(userID, projectID string) (*model.CommerceStudioAgentRun, error) {
	var run model.CommerceStudioAgentRun
	err := r.db.Where("user_id = ? AND project_id = ?", userID, projectID).
		Order("created_at desc").Order("id desc").First(&run).Error
	return &run, err
}

func (r *Repository) RequestCommerceStudioAgentCancel(userID, id string) error {
	res := r.db.Model(&model.CommerceStudioAgentRun{}).Where("user_id = ? AND id = ? AND status = ?", userID, id, "running").Update("cancel_requested", true)
	return res.Error
}

func (r *Repository) CreateCommerceStudioAgentRun(run *model.CommerceStudioAgentRun, project *model.CommerceStudioProject, order *model.BillingOrder) error {
	if strings.TrimSpace(run.CanvasJSON) == "" {
		run.CanvasJSON = "{}"
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if project != nil {
			if err := tx.Create(project).Error; err != nil {
				return err
			}
		} else {
			var count int64
			if err := tx.Model(&model.CommerceStudioProject{}).Where("id = ? AND user_id = ?", run.ProjectID, run.UserID).Count(&count).Error; err != nil {
				return err
			}
			if count != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		if err := tx.Create(run).Error; err != nil {
			return err
		}
		if order != nil {
			return reserveBillingOrder(tx, order)
		}
		return nil
	})
}

func (r *Repository) SaveCommerceStudioAgentPage(userID string, page *model.CommerceStudioAgentPage) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var run model.CommerceStudioAgentRun
		if err := tx.Where("user_id = ? AND id = ?", userID, page.RunID).First(&run).Error; err != nil {
			return err
		}
		if run.Status != "running" {
			return ErrTaskStateConflict
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "run_id"}, {Name: "index"}},
			DoUpdates: clause.AssignmentColumns([]string{"role", "title", "headline", "prompt", "url", "status", "error", "ratio", "need_text", "latency_ms", "updated_at"}),
		}).Create(page).Error
	})
}

func (r *Repository) CommerceStudioAgentPages(userID, runID string) ([]model.CommerceStudioAgentPage, error) {
	if _, err := r.CommerceStudioAgentRun(userID, runID); err != nil {
		return nil, err
	}
	var pages []model.CommerceStudioAgentPage
	err := r.db.Where("run_id = ?", runID).Order("\"index\" asc").Find(&pages).Error
	return pages, err
}

func (r *Repository) SaveCommerceStudioAgentResult(userID, runID, briefJSON, copyJSON, canvasJSON string) error {
	res := r.db.Model(&model.CommerceStudioAgentRun{}).Where("user_id = ? AND id = ? AND status = ?", userID, runID, "running").Updates(map[string]any{
		"brief_json": briefJSON, "copy_json": copyJSON, "canvas_json": canvasJSON, "updated_at": time.Now(),
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

// FinishEcommerceAgentRun closes the existing credit reservation exactly once.
// Only persisted successful pages count toward the charge.
func (r *Repository) FinishCommerceStudioAgentRun(userID, runID, status, errorCode string) (*model.CommerceStudioAgentRun, error) {
	var finished model.CommerceStudioAgentRun
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND id = ?", userID, runID).First(&finished).Error; err != nil {
			return err
		}
		if finished.Status == "completed" || finished.Status == "failed" || finished.Status == "cancelled" {
			return nil
		}
		var successes int64
		if err := tx.Model(&model.CommerceStudioAgentPage{}).Where("run_id = ? AND status = ?", runID, "completed").Count(&successes).Error; err != nil {
			return err
		}
		if successes > int64(finished.PageCount) {
			return errors.New("ecommerce page count exceeds reservation")
		}
		if finished.BillingOrderID != "" {
			if successes == 0 {
				if err := (&Repository{db: tx}).RefundBillingOrder(finished.BillingOrderID, status); err != nil {
					return err
				}
			} else {
				if err := settleCommerceStudioAgentOrder(tx, &finished, successes); err != nil {
					return err
				}
			}
		}
		now := time.Now()
		finished.Status, finished.ErrorCode, finished.SuccessPages, finished.FinishedAt = status, errorCode, int(successes), &now
		return tx.Model(&finished).Updates(map[string]any{"status": status, "error_code": errorCode, "success_pages": successes, "finished_at": now, "updated_at": now}).Error
	})
	return &finished, err
}

func settleCommerceStudioAgentOrder(tx *gorm.DB, run *model.CommerceStudioAgentRun, successes int64) error {
	var order model.BillingOrder
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ? AND user_id = ?", run.BillingOrderID, run.UserID).Error; err != nil {
		return err
	}
	if order.Scene != "commerce_studio_agent" || (order.Status != model.BillingStatusRunning && order.Status != model.BillingStatusReserved) {
		return ErrBillingStateConflict
	}
	reserved, actual, refund, chargeErr := ecommerceagent.Charge(run.UnitMicrocredits, run.PageCount, int(successes))
	if chargeErr != nil || order.AmountMicrocredits != reserved {
		return errors.New("ecommerce billing snapshot mismatch")
	}
	res := tx.Model(&model.CreditAccount{}).Where("user_id = ? AND reserved_microcredits >= ?", run.UserID, order.AmountMicrocredits).Updates(map[string]any{
		"available_microcredits": gorm.Expr("available_microcredits + ?", refund),
		"reserved_microcredits":  gorm.Expr("reserved_microcredits - ?", order.AmountMicrocredits),
		"version":                gorm.Expr("version + 1"), "updated_at": time.Now(),
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return errors.New("reserved credit balance is inconsistent")
	}
	var account model.CreditAccount
	if err := tx.First(&account, "user_id = ?", run.UserID).Error; err != nil {
		return err
	}
	now := time.Now()
	if err := tx.Model(&order).Updates(map[string]any{"status": model.BillingStatusSettled, "quantity": successes, "actual_amount_microcredits": actual, "refunded_amount_microcredits": refund, "settled_at": now, "updated_at": now}).Error; err != nil {
		return err
	}
	entry := model.CreditLedgerEntry{ID: newRepositoryID(), UserID: run.UserID, Type: model.CreditLedgerConsume, AmountMicrocredits: -actual, ReservedDeltaMicrocredits: -order.AmountMicrocredits, AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits, BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: fmt.Sprintf("电商出图成功 %d/%d 页", successes, run.PageCount)}
	if err := tx.Create(&entry).Error; err != nil {
		return err
	}
	if refund > 0 {
		entry = model.CreditLedgerEntry{ID: newRepositoryID(), UserID: run.UserID, Type: model.CreditLedgerRefund, AmountMicrocredits: refund, AvailableDeltaMicrocredits: refund, AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits, BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: "电商出图未成功页面退回"}
		if err := tx.Create(&entry).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) SaveCommerceStudioAgentCanvas(userID, projectID, canvasJSON string) (*model.CommerceStudioAgentCanvasVersion, error) {
	var saved model.CommerceStudioAgentCanvasVersion
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var project model.CommerceStudioProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
			return err
		}
		var latest int64
		if err := tx.Model(&model.CommerceStudioAgentCanvasVersion{}).Where("project_id = ? AND user_id = ?", projectID, userID).Select("coalesce(max(version), 0)").Scan(&latest).Error; err != nil {
			return err
		}
		saved = model.CommerceStudioAgentCanvasVersion{ID: newRepositoryID(), UserID: userID, ProjectID: projectID, Version: latest + 1, CanvasJSON: canvasJSON}
		if err := tx.Create(&saved).Error; err != nil {
			return err
		}
		return nil
	})
	return &saved, err
}

func (r *Repository) CommerceStudioAgentCanvas(userID, projectID string) ([]model.CommerceStudioAgentCanvasVersion, error) {
	var count int64
	if err := r.db.Model(&model.CommerceStudioProject{}).Where("id = ? AND user_id = ?", projectID, userID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	var versions []model.CommerceStudioAgentCanvasVersion
	err := r.db.Where("project_id = ? AND user_id = ?", projectID, userID).Order("version desc").Limit(20).Find(&versions).Error
	return versions, err
}
