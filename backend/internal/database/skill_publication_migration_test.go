package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
	"yingce/backend/internal/model"
)

func TestSkillReviewMigrationPreservesBuiltinPrivateAndOffline(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.Skill{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range []model.Skill{{ID: "user", Status: 1, Source: 1}, {ID: "private", Status: 1, Source: 1, IsPrivate: true}, {ID: "builtin", Status: 1, Source: 3, SourceType: "builtin"}, {ID: "offline", Status: 4, Source: 1}, {ID: "builtin-disabled", Status: 0, Source: 3, SourceType: "builtin"}} {
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateSkillPublicationReview(db); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]int{"user": 2, "private": 1, "builtin": 1, "offline": 4, "builtin-disabled": 4} {
		var item model.Skill
		if err := db.First(&item, "id = ?", id).Error; err != nil || item.Status != want {
			t.Fatalf("%s status=%d want=%d err=%v", id, item.Status, want, err)
		}
	}
}
