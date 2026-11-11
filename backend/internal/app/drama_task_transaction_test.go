package app

import (
	"errors"
	"sync"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 与权限用例共用隔离库工厂：默认 SQLite，指定测试 DSN 时使用独立 PostgreSQL schema。
func TestDramaTaskTransactionPreservesCreditsOnBindingFailure(t *testing.T) {
	for _, mode := range []string{"cancelled", "deleted", "rebound", "database_error", "missing_job_id", "wrong_project"} {
		t.Run(mode, func(t *testing.T) {
			db := agentPermissionsDB(t)
			if err := db.AutoMigrate(database.Models()...); err != nil {
				t.Fatal(err)
			}
			s := &Service{repo: repository.New(db), dataDir: t.TempDir()}
			job := model.DramaJob{ID: "job", ProjectID: "project", Status: model.DramaJobQueued, Kind: model.DramaJobBible}
			for _, row := range []any{&job, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 1000}} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			var err error
			switch mode {
			case "missing_job_id":
				job.ID = ""
			case "wrong_project":
				job.ProjectID = "another-project"
			case "cancelled":
				err = db.Model(&model.DramaJob{}).Where("id = ?", job.ID).Update("status", model.DramaJobCanceled).Error
			case "deleted":
				err = db.Delete(&model.DramaJob{}, "id = ?", job.ID).Error
			case "rebound":
				err = db.Model(&model.DramaJob{}).Where("id = ?", job.ID).Updates(map[string]any{"status": model.DramaJobRunning, "task_id": "other-task"}).Error
			case "database_error":
				err = db.Callback().Update().Before("gorm:update").Register("fail_drama_binding", func(tx *gorm.DB) {
					if tx.Statement.Table == "drama_jobs" {
						tx.AddError(errors.New("injected binding failure"))
					}
				})
				t.Cleanup(func() { _ = db.Callback().Update().Remove("fail_drama_binding") })
			}
			if err != nil {
				t.Fatal(err)
			}
			task := &model.Task{ID: "task", UserID: "user", ProjectID: "project", Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: "{}"}
			order := &model.BillingOrder{ID: "order", UserID: "user", TaskID: task.ID, IdempotencyKey: "order", BillingMode: "fixed_request", Status: model.BillingStatusReserved, AmountMicrocredits: 100}
			if _, err := s.persistDramaTask(&job, task, order); err == nil {
				t.Fatal("binding failure was accepted")
			} else if mode != "database_error" && !errors.Is(err, repository.ErrDramaJobChanged) {
				t.Fatal(err)
			}
			for _, row := range []any{&model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
				var count int64
				if err := db.Model(row).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("orphan %T: count=%d err=%v", row, count, err)
				}
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", "user").Error; err != nil || account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 0 {
				t.Fatalf("reservation escaped rollback: %+v %v", account, err)
			}
			if job.Status != model.DramaJobQueued || job.TaskID != "" {
				t.Fatal("failed persistence changed the in-memory job")
			}
		})
	}
}

func TestDramaTaskTransactionConcurrentDispatchBindsAndChargesOnce(t *testing.T) {
	db := agentPermissionsDB(t)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	job := model.DramaJob{ID: "job", ProjectID: "project", Status: model.DramaJobQueued, Kind: model.DramaJobBible}
	for _, row := range []any{&job, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 1000}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, id := range []string{"one", "two"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stale := job
			task := &model.Task{ID: id, UserID: "user", ProjectID: "project", Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: "{}"}
			order := &model.BillingOrder{ID: id, UserID: "user", TaskID: id, IdempotencyKey: id, BillingMode: "fixed_request", Status: model.BillingStatusReserved, AmountMicrocredits: 100}
			_, err := s.persistDramaTask(&stale, task, order)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	success, conflicts := 0, 0
	for err := range errs {
		if err == nil {
			success++
		} else if errors.Is(err, repository.ErrDramaJobChanged) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("dispatch outcomes: success=%d conflicts=%d", success, conflicts)
	}
	for _, row := range []any{&model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
		var count int64
		if err := db.Model(row).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("dispatch must persist once: %T count=%d err=%v", row, count, err)
		}
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil || account.AvailableMicrocredits != 900 || account.ReservedMicrocredits != 100 {
		t.Fatalf("wrong reservation: %+v %v", account, err)
	}
	var stored model.DramaJob
	if err := db.First(&stored, "id = ?", job.ID).Error; err != nil || stored.Status != model.DramaJobRunning || stored.TaskID == "" {
		t.Fatalf("missing binding: %+v %v", stored, err)
	}
}
