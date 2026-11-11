package app

import (
	"net/url"
	"os"
	"sync"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestWorkbenchBatchPostgresConcurrentReservation(t *testing.T) {
	dsn := os.Getenv("KIVAO_WORKBENCH_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("requires an isolated, disposable local PostgreSQL database")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || parsed.Hostname() != "127.0.0.1" || parsed.Path != "/kivao_batch_test" || parsed.User == nil || parsed.User.Username() != "batch_test" {
		t.Fatal("only the dedicated loopback test database is allowed")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("isolated PostgreSQL connection failed")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	var version int
	if err := db.Raw("SHOW server_version_num").Scan(&version).Error; err != nil || version < 170000 || version >= 180000 {
		t.Fatal("PostgreSQL 17 required")
	}
	if db.Migrator().HasTable(&model.Task{}) {
		t.Fatal("test database must be empty")
	}
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.User{ID: "user", Username: "fixture", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Local test"},
		&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := seedWorkbenchBatchModel(t, db)
	services := []*Service{
		{repo: repository.New(db), dataDir: t.TempDir(), disablePiRuntime: true},
		{repo: repository.New(db), dataDir: t.TempDir(), disablePiRuntime: true},
	}
	start := make(chan struct{})
	ids := make(chan string, 8)
	errs := make(chan error, 8)
	var wg sync.WaitGroup
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func(svc *Service) {
			defer wg.Done()
			<-start
			task, err := svc.CreateWorkbenchTask("user", req, "", "")
			if err != nil {
				errs <- err
				return
			}
			ids <- task.ID
		}(services[index%2])
	}
	close(start)
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		t.Errorf("concurrent receipt: %v", err)
	}
	expectedID, _, _ := workbenchBatchIdentity("user", req)
	for id := range ids {
		if id != expectedID {
			t.Fatal("duplicate task created")
		}
	}
	assertWorkbenchBatchAccounting(t, db, 1)
	receipt, err := services[0].WorkbenchBatchTask("user", "image", req.Batch.ID, 0)
	if err != nil || receipt == nil || receipt.ID != expectedID {
		t.Fatal("receipt lookup failed")
	}
}
