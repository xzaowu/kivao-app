package database

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestTryOnKivaoMigrationKeepsUpstreamHistory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err = MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := db.Exec("DROP TABLE kivao_schema_migrations").Error; err != nil {
			t.Fatal(err)
		}
		if err := RequireSchemaVersion(db); err == nil || !strings.Contains(err.Error(), "KIVAO") {
			t.Fatalf("missing independent ledger accepted: %v", err)
		}
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		var official schemaMigration
		if err := db.Take(&official, "version = ?", 106).Error; err != nil || official.Name == "pose_library_kind" {
			t.Fatalf("official v106 replaced %#v %v", official, err)
		}
		status, err := ReadSchemaStatus(db)
		if err != nil || !status.Ready || status.Current != CurrentSchemaVersion || status.KivaoCurrent != 1 || status.YingceCurrent != status.YingceExpected {
			t.Fatalf("status=%#v err=%v", status, err)
		}
	}
	if err := db.Exec("UPDATE kivao_schema_migrations SET checksum='invalid' WHERE version=1").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil {
		t.Fatal("fork migration checksum mismatch accepted")
	}
}

func TestMigratePoseLibraryKindPreservesLegacyRowsAndIsIdempotent(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		`CREATE TABLE pose_library_sources (key TEXT PRIMARY KEY, name TEXT)`,
		`CREATE TABLE pose_library_items (id TEXT PRIMARY KEY, name TEXT)`,
		`INSERT INTO pose_library_sources (key, name) VALUES ('legacy', 'Legacy source')`,
		`INSERT INTO pose_library_items (id, name) VALUES ('legacy-item', 'Legacy pose')`,
	} {
		if err := db.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migratePoseLibraryKind(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"pose_library_sources", "pose_library_items"} {
		var row struct{ Library, Name string }
		if err := db.Table(table).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.Library != model.PoseLibraryKindPose || row.Name == "" {
			t.Fatalf("%s legacy row = %#v", table, row)
		}
	}
	if !db.Migrator().HasIndex(&model.PoseLibraryItem{}, "Library") {
		t.Fatal("library index missing")
	}
}
