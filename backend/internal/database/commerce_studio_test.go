package database

import (
	"fmt"
	"gorm.io/gorm"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func commerceStudioUpgrade80(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	studio := []any{&model.CommerceStudioProject{}, &model.CommerceStudioRound{}, &model.CommerceStudioKnowledgeSource{}, &model.CommerceStudioKnowledgeEntry{}, &model.CommerceStudioCreativeRecommendation{}, &model.CommerceStudioAgentAnalysis{}, &model.CommerceStudioAgentRun{}, &model.CommerceStudioAgentPage{}, &model.CommerceStudioAgentCanvasVersion{}}
	// A fresh baseline uses today's Models(); remove only the new module to reproduce schema 80.
	for _, m := range studio {
		if err := db.Migrator().DropTable(m); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version = ?", 81).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	fixtures := []any{
		&model.EcommerceProject{ID: "old-project", UserID: "fixture", Name: "旧版商品", Status: "active", CreateHash: "unchanged", ActiveRoundID: "old-round", DraftJSON: `{"productName":"KIVAO"}`, PlanJSON: `{}`, Revision: 3},
		&model.SystemSetting{Key: "commerce-preserve", ValueJSON: `{"brand":"KIVAO"}`},
		&model.CreditAccount{UserID: "fixture", AvailableMicrocredits: 123456},
		&model.Resource{ID: "old-image", UserID: "fixture", Kind: "image", Status: model.ResourceStatusReady, ObjectKey: "unchanged.png"},
	}
	for _, f := range fixtures {
		if err := db.Create(f).Error; err != nil {
			t.Fatal(err)
		}
	}
	var ledger []schemaMigration
	if err := db.Order("version").Find(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	before, err := db.Migrator().GetTables()
	if err != nil {
		t.Fatal(err)
	}
	old := map[string]bool{}
	for _, name := range before {
		old[name] = true
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after []schemaMigration
	if err := db.Where("version <= ?", 80).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ledger, after) {
		t.Fatal("migration ledger <=80 changed")
	}
	tables, err := db.Migrator().GetTables()
	if err != nil {
		t.Fatal(err)
	}
	added := 0
	for _, name := range tables {
		if !old[name] {
			if !strings.HasPrefix(name, "commerce_studio_") {
				t.Fatal("unexpected table", name)
			}
			added++
		}
	}
	if added != 9 {
		t.Fatalf("added tables=%d, expected 9", added)
	}
	var project model.EcommerceProject
	var setting model.SystemSetting
	var account model.CreditAccount
	var resource model.Resource
	for _, item := range []struct {
		target any
		where  string
		id     string
	}{{&project, "id = ?", "old-project"}, {&setting, "key = ?", "commerce-preserve"}, {&account, "user_id = ?", "fixture"}, {&resource, "id = ?", "old-image"}} {
		if err := db.First(item.target, item.where, item.id).Error; err != nil {
			t.Fatal(err)
		}
	}
	if project.Revision != 3 || project.DraftJSON != `{"productName":"KIVAO"}` || project.CreateHash != "unchanged" || setting.ValueJSON != `{"brand":"KIVAO"}` || account.AvailableMicrocredits != 123456 || resource.ObjectKey != "unchanged.png" {
		t.Fatal("legacy data changed")
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

func TestCommerceStudioSchema81SQLitePreserves80(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	commerceStudioUpgrade80(t, db)
}

func TestCommerceStudioSchema81PostgresPreserves80(t *testing.T) {
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
	schema := fmt.Sprintf("kivao_studio_%d", time.Now().UnixNano())
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
	connection, _ := db.DB()
	defer connection.Close()
	commerceStudioUpgrade80(t, db)
}
