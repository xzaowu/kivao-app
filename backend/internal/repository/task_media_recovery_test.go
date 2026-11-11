package repository

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func TestPendingMediaCheckpointPagination(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
			var dialector gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "media.db"))
			if driver == "postgres" {
				dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
				}
				admin, err := gorm.Open(postgres.Open(dsn), config)
				if err != nil {
					t.Fatal(err)
				}
				closeTestDatabase(t, admin)
				schema := fmt.Sprintf("media_checkpoint_%d", time.Now().UnixNano())
				if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
						t.Error(err)
					}
				})
				parsed, err := url.Parse(dsn)
				if err != nil {
					t.Fatal(err)
				}
				query := parsed.Query()
				query.Set("search_path", schema)
				parsed.RawQuery = query.Encode()
				dialector = postgres.Open(parsed.String())
			}
			db, err := gorm.Open(dialector, config)
			if err != nil {
				t.Fatal(err)
			}
			closeTestDatabase(t, db)
			if err := db.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			now := time.Now()
			rows := []model.Task{
				{ID: "c-failed", Status: model.TaskStatusFailed},
				{ID: "a-running", Status: model.TaskStatusRunning},
				{ID: "e-cancelled", Status: model.TaskStatusCancelled},
				{ID: "b-queued", Status: model.TaskStatusQueued},
				{ID: "d-completed", Status: model.TaskStatusSucceeded},
				{ID: "f-empty", Status: model.TaskStatusFailed},
				{ID: "g-old", Status: model.TaskStatusFailed},
			}
			for i := range rows {
				rows[i].UserID, rows[i].MediaRecoveryJSON, rows[i].UpdatedAt = "media-user", "checkpoint", now
			}
			rows[5].MediaRecoveryJSON = ""
			rows[6].UpdatedAt = now.Add(-2 * time.Hour)
			if err := db.Create(&rows).Error; err != nil {
				t.Fatal(err)
			}
			repo := New(db)
			since := now.Add(-time.Hour)
			first, err := repo.TasksWithPendingMediaCheckpoint(since, "", 2)
			if err != nil || len(first) != 2 || first[0].ID != "a-running" || first[1].ID != "b-queued" {
				t.Fatalf("first page: %+v %v", first, err)
			}
			second, err := repo.TasksWithPendingMediaCheckpoint(since, first[1].ID, 2)
			if err != nil || len(second) != 1 || second[0].ID != "c-failed" {
				t.Fatalf("second page: %+v %v", second, err)
			}
			last, err := repo.TasksWithPendingMediaCheckpoint(since, second[0].ID, 2)
			if err != nil || len(last) != 0 {
				t.Fatalf("pagination did not end: %+v %v", last, err)
			}
			for _, limit := range []int{0, -1, 1001} {
				all, err := repo.TasksWithPendingMediaCheckpoint(since, "", limit)
				if err != nil || len(all) != 3 {
					t.Fatalf("default limit %d: count=%d err=%v", limit, len(all), err)
				}
			}
			if err := db.Migrator().DropTable(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.TasksWithPendingMediaCheckpoint(since, "", 2); err == nil {
				t.Fatal("query failure became an empty reference set")
			}
		})
	}
}
