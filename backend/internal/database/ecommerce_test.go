package database

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func ecommerceUpgrade79(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 79 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Fresh-schema migration uses current Models(); remove exactly the two v80 tables.
	if err := db.Migrator().DropTable(&model.EcommerceRound{}, &model.EcommerceProject{}); err != nil {
		t.Fatal(err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	rows := []any{&model.SystemSetting{Key: "keep_ecommerce_test", ValueJSON: `{"brand":"KIVAO"}`}, &model.CreditAccount{UserID: "keep-user", AvailableMicrocredits: 123456}, &model.Resource{ID: "keep-media", UserID: "keep-user", Kind: "image", Status: model.ResourceStatusReady, ObjectKey: "keep.png"}}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	oldTables, err := db.Migrator().GetTables()
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after []schemaMigration
	if err := db.Where("version <= ?", 79).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("existing migration ledger including KIVAO 78/79 changed")
	}
	newTables, err := db.Migrator().GetTables()
	if err != nil {
		t.Fatal(err)
	}
	known := map[string]bool{}
	for _, name := range oldTables {
		known[name] = true
	}
	added := 0
	for _, name := range newTables {
		if !known[name] {
			if name != "ecommerce_projects" && name != "ecommerce_rounds" {
				t.Fatalf("unexpected table %s", name)
			}
			added++
		}
	}
	if added != 2 {
		t.Fatalf("expected only two new tables, got %d", added)
	}
	var setting model.SystemSetting
	var account model.CreditAccount
	var resource model.Resource
	if err := db.First(&setting, "key = ?", "keep_ecommerce_test").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&account, "user_id = ?", "keep-user").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&resource, "id = ?", "keep-media").Error; err != nil {
		t.Fatal(err)
	}
	if setting.ValueJSON != `{"brand":"KIVAO"}` || account.AvailableMicrocredits != 123456 || resource.ObjectKey != "keep.png" {
		t.Fatal("existing configuration, balance or media changed")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatal("invalid schema", err)
	}
}

func TestEcommerceSchema80SQLitePreserves79(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	ecommerceUpgrade79(t, db)
}

func TestEcommerceSchema80PostgresPreserves79(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("isolated Postgres not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := base.DB()
	defer sql.Close()
	schema := fmt.Sprintf("kivao_ecommerce_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	defer base.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`)
	scoped, err := postgresDSNWithSearchPath(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: scoped})
	if err != nil {
		t.Fatal(err)
	}
	sqlScoped, _ := db.DB()
	defer sqlScoped.Close()
	ecommerceUpgrade79(t, db)
}
