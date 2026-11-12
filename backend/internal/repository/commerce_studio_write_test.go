package repository

import (
	"errors"
	"github.com/mattn/go-sqlite3"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"
)

func TestCommerceStudioWriteReservesBeforeReadSnapshot(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "concurrent.db") + "?_journal_mode=WAL&_busy_timeout=10"
	open := func() *gorm.DB {
		db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		sql, _ := db.DB()
		sql.SetMaxOpenConns(1)
		t.Cleanup(func() { sql.Close() })
		return db
	}
	db, other := open(), open()
	if err := db.AutoMigrate(&model.CommerceStudioProject{}, &model.CommerceStudioRound{}); err != nil {
		t.Fatal(err)
	}
	p := &model.CommerceStudioProject{ID: "project", UserID: "user", Name: "before", Status: "draft", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
	if err := db.Create(p).Error; err != nil {
		t.Fatal(err)
	}
	err := New(db).Transaction(func(tx *Repository) error {
		if err := tx.LockCommerceStudioWrite("user", p.ID); err != nil {
			return err
		}
		current, err := tx.CommerceStudioProject("user", p.ID)
		if err != nil {
			return err
		}
		// A second SQLite connection cannot commit between our read and revision write.
		writeErr := other.Model(&model.CommerceStudioProject{}).Where("id = ?", p.ID).UpdateColumn("name", "other-worker").Error
		var busy sqlite3.Error
		if !errors.As(writeErr, &busy) || busy.Code != sqlite3.ErrBusy {
			t.Fatalf("expected writer contention, got %v", writeErr)
		}
		current.Name = "saved"
		return tx.SaveCommerceStudioProject(current, 1)
	})
	if err != nil {
		t.Fatal(err)
	}
	current, err := New(db).CommerceStudioProject("user", p.ID)
	if err != nil || current.Name != "saved" || current.Revision != 2 {
		t.Fatalf("save lost: %+v %v", current, err)
	}
}
