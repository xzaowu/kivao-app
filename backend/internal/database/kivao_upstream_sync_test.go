package database

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func TestKivao104LedgerUpgradePreservesExistingRows(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "upgrade.db")})
	if err != nil {
		t.Fatal(err)
	}
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	// Reconstruct the pre-update ledger and affected columns in a disposable fixture.
	for _, change := range []struct {
		entity  any
		columns []string
	}{
		{&model.ChannelModelPriceTier{}, []string{"image_pricing", "cost_image_pricing"}},
		{&model.BillingOrder{}, []string{"image_pricing", "cost_image_pricing", "image_usage", "image_input_images", "image_max_output_images"}},
		{&model.LogicalModel{}, []string{"image_pricing"}},
	} {
		for _, column := range change.columns {
			if err := db.Migrator().DropColumn(change.entity, column); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := db.Exec("DELETE FROM schema_migrations WHERE version > ?", 104).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&yingceSchemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "sync-user", Username: "sync-fixture", PasswordHash: "synthetic-hash", Role: "admin", Status: "active"},
		&model.CreditAccount{UserID: "sync-user", AvailableMicrocredits: 123456, ReservedMicrocredits: 0},
		&model.ChannelModel{ID: "sync-model", ModelKey: "fixture", Capability: "video", CapabilityConfigJSON: `{"version":1}`},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	fingerprint := func(table string) string {
		t.Helper()
		var rows []map[string]any
		if err := db.Table(table).Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(rows)
		if err != nil {
			t.Fatal(err)
		}
		return string(encoded)
	}
	tables := []string{"users", "credit_accounts", "channel_models"}
	before := make(map[string]string)
	for _, table := range tables {
		before[table] = fingerprint(table)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion || status.YingceCurrent != 4 {
		t.Fatalf("upgrade status=%#v err=%v", status, err)
	}
	for _, table := range tables {
		if fingerprint(table) != before[table] {
			t.Fatalf("existing rows changed in %s", table)
		}
	}
}

func TestKivaoHistoricalImportRejectsChangedTargetVersion(t *testing.T) {
	if CurrentSchemaVersion == 104 {
		t.Fatal("update this guard when the historical import is explicitly revalidated")
	}
	_, err := ImportKivao79(context.Background(), nil, nil, KivaoImportOptions{})
	if err == nil || err.Error() != "import_target_version_changed" {
		t.Fatalf("historical import should fail before accessing any database: %v", err)
	}
}
