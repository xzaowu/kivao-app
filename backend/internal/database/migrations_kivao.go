package database

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// Keep fork-specific migration identities separate from both upstream ledgers.
type kivaoSchemaMigration schemaMigration

func (kivaoSchemaMigration) TableName() string { return "kivao_schema_migrations" }

var kivaoMigrations = []migration{
	{version: 1, name: "tryon_libraries_and_task_receipts", checksum: "sha256:kivao-tryon-libraries-task-receipts-v1", apply: func(tx *gorm.DB) error {
		if err := migratePoseLibraryKind(tx); err != nil {
			return err
		}
		return tx.AutoMigrate(&model.TryOnBatch{}, &model.TryOnTaskReceipt{})
	}},
}

func migratePoseLibraryKind(tx *gorm.DB) error {
	for _, entity := range []any{&model.PoseLibrarySource{}, &model.PoseLibraryItem{}} {
		if !tx.Migrator().HasTable(entity) {
			if err := tx.AutoMigrate(entity); err != nil {
				return err
			}
		} else if !tx.Migrator().HasColumn(entity, "Library") {
			if err := tx.Migrator().AddColumn(entity, "Library"); err != nil {
				return err
			}
		}
	}
	if !tx.Migrator().HasIndex(&model.PoseLibraryItem{}, "Library") {
		return tx.Migrator().CreateIndex(&model.PoseLibraryItem{}, "Library")
	}
	return nil
}

func migrateKivaoSchema(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&kivaoSchemaMigration{}); err != nil {
		return err
	}
	for _, step := range kivaoMigrations {
		var applied kivaoSchemaMigration
		err := tx.Take(&applied, "version = ?", step.version).Error
		if err == nil {
			if err := validateMigrationRecord(schemaMigration(applied), step); err != nil {
				return err
			}
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := step.apply(tx); err != nil {
			return fmt.Errorf("执行 KIVAO 迁移 %d：%w", step.version, err)
		}
		if err := tx.Create(&kivaoSchemaMigration{Version: step.version, Name: step.name, Checksum: step.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			return err
		}
	}
	return nil
}

func readKivaoSchema(db *gorm.DB) (int64, bool, error) {
	if !db.Migrator().HasTable(&kivaoSchemaMigration{}) {
		return 0, false, nil
	}
	var rows []kivaoSchemaMigration
	if err := db.Order("version").Find(&rows).Error; err != nil {
		return 0, false, err
	}
	for index, record := range rows {
		if index >= len(kivaoMigrations) || record.Version != kivaoMigrations[index].version {
			return record.Version, false, fmt.Errorf("KIVAO 数据库迁移版本 %d 不受支持", record.Version)
		}
		if err := validateMigrationRecord(schemaMigration(record), kivaoMigrations[index]); err != nil {
			return record.Version, false, err
		}
	}
	return int64(len(rows)), len(rows) == len(kivaoMigrations), nil
}
