package database

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func kivaoTestFiles(t *testing.T) (KivaoImportOptions, string) {
	t.Helper()
	options := KivaoImportOptions{SourceData: t.TempDir(), TargetData: t.TempDir(), PluginIDs: []string{"fixture-audio", "fixture-video"}, OfficialPluginsDir: t.TempDir()}
	key := bytes.Repeat([]byte{42}, 32)
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, gcm.NonceSize())
	encrypted := "enc:v1:" + base64.RawStdEncoding.EncodeToString(append(nonce, gcm.Seal(nil, nonce, []byte("synthetic-secret-never-print"), nil)...))
	for _, dir := range []string{options.SourceData, options.TargetData} {
		if err := os.Chmod(dir, 0700); err != nil {
			t.Fatal(err)
		}
		for _, sub := range []string{"plugin-packages"} {
			if err := os.Mkdir(filepath.Join(dir, sub), 0700); err != nil {
				t.Fatal(err)
			}
		}
		write := func(path string, b []byte) {
			t.Helper()
			if err := os.WriteFile(filepath.Join(dir, path), b, 0600); err != nil {
				t.Fatal(err)
			}
		}
		write(".settings-key", key)
		if dir == options.SourceData {
			if err := os.Mkdir(filepath.Join(dir, "resources"), 0700); err != nil {
				t.Fatal(err)
			}
			write("resources/sample.bin", []byte("synthetic media"))
		}
		var records []kivaoPluginRecord
		for _, id := range options.PluginIDs {
			capability := strings.TrimPrefix(id, "fixture-")
			manifest := []byte(fmt.Sprintf(`{"apiVersion":"yingce.plugin/v2","id":%q,"name":"Fixture only","version":"1.0.0","contributes":{"providers":[{"id":%q,"label":"Fixture","capabilities":[%q],"scopes":["admin.system-channel"],"create":{"method":"POST","path":"/fixture","contentType":"application/json","body":{"model":{"$ref":"request.model"}}},"response":{"status":"succeeded"}}]}}`, id, id, capability))
			var buf bytes.Buffer
			archive := zip.NewWriter(&buf)
			f, _ := archive.Create("manifest.json")
			_, _ = f.Write(manifest)
			if err := archive.Close(); err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(buf.Bytes())
			name := id + ".zip"
			write("plugin-packages/"+name, buf.Bytes())
			records = append(records, kivaoPluginRecord{ID: id, Raw: manifest, Source: "uploaded", PackagePath: name, PackageSHA256: hex.EncodeToString(sum[:])})
		}
		b, _ := json.Marshal(records)
		write("plugin_registry.json", b)
	}
	return options, encrypted
}

func kivaoTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("KIVAO_IMPORT_TEST_DSN")
	if dsn == "" {
		t.Skip("requires a dedicated localhost PostgreSQL 17 rehearsal database")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") || !strings.HasPrefix(u.Path, "/kivao_rehearsal_") {
		t.Fatal("test DSN is not a local rehearsal database")
	}
	open := func(dsn string) *gorm.DB {
		t.Helper()
		db, e := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if e != nil {
			t.Fatal("test database connection failed")
		}
		return db
	}
	admin := open(dsn)
	name := fmt.Sprintf("kivao_rehearsal_test_%d", time.Now().UnixNano())
	if err := admin.Exec(`CREATE DATABASE "` + name + `"`).Error; err != nil {
		t.Fatal("create test database failed")
	}
	u.Path = "/" + name
	db := open(u.String())
	t.Cleanup(func() {
		conn, _ := db.DB()
		conn.Close()
		if err := admin.Exec(`DROP DATABASE "` + name + `"`).Error; err != nil {
			t.Error("drop test database failed")
		}
		conn, _ = admin.DB()
		conn.Close()
	})
	return db
}

// 精简旧字段夹具；账本来自已确认的旧分支，未冒充真实生产备份。
func kivaoSeed79(t *testing.T, db *gorm.DB, encrypted string) {
	t.Helper()
	ddl := []string{
		`CREATE TABLE users (id text PRIMARY KEY, username text, password_hash text, role text, status text)`,
		`CREATE TABLE user_avatars (user_id text PRIMARY KEY, data bytea NOT NULL)`,
		`CREATE TABLE credit_accounts (user_id text PRIMARY KEY, available_microcredits bigint, reserved_microcredits bigint)`,
		`CREATE TABLE credit_ledger_entries (id text PRIMARY KEY,user_id text,available_delta_microcredits bigint,reserved_delta_microcredits bigint,payment_order_id text,billing_order_id text)`,
		`CREATE TABLE model_channels (id text PRIMARY KEY, name text, scope text, base_url text, api_key text)`,
		`CREATE TABLE channel_models (id text PRIMARY KEY,channel_id text,model_key text,capability text,protocol text,enabled boolean)`,
		`CREATE TABLE resources (id text PRIMARY KEY,user_id text,status text,provider text,object_key text,size bigint)`,
		`CREATE TABLE tasks (id text PRIMARY KEY,user_id text,status text,prompt text,lease_expires_at timestamptz,provider_cancel_status text,billing_order_id text,provider_request_id text,media_stage text)`,
		`CREATE TABLE canvas_projects (id text PRIMARY KEY,user_id text,payload_json text,revision bigint)`,
		`CREATE TABLE auth_sessions (id text PRIMARY KEY,user_id text,token_hash text)`,
		`CREATE TABLE o_auth_states (id text PRIMARY KEY,state_hash text)`,
		`CREATE TABLE notification_quota (key text PRIMARY KEY,count bigint)`,
		`CREATE TABLE task_text_delta (id text PRIMARY KEY,user_id text,task_id text,sequence bigint,content text)`,
		`CREATE TABLE payment_orders (id text PRIMARY KEY,user_id text,status text,amount_fen bigint,currency text,payment_method text,expires_at timestamptz,provider_paid_at timestamptz,provider_trade_no text,provider_status text)`,
		`CREATE TABLE payment_notifications (id text PRIMARY KEY,status text,payment_order_id text)`,
		`CREATE TABLE payment_reconciliation_runs (id text PRIMARY KEY,status text)`,
		`CREATE TABLE payment_reconciliation_items (id text PRIMARY KEY,result text)`,
		`CREATE TABLE billing_orders (id text PRIMARY KEY,status text)`,
		`CREATE TABLE drama_jobs (id text PRIMARY KEY,status text)`,
		`CREATE TABLE upload_reservations (id text PRIMARY KEY,expires_at timestamptz)`,
		`CREATE TABLE payment_provider_configs (id text PRIMARY KEY,old_custom_cipher text)`,
		`CREATE TABLE skills (id text PRIMARY KEY,old_custom_review text)`,
		`CREATE TABLE skill_curation_roots (id text PRIMARY KEY,old_custom_name text)`,
		`CREATE TABLE skill_curation_settings (id integer PRIMARY KEY,old_custom_enabled boolean)`,
		`CREATE TABLE plugin_platform_states (plugin_id text PRIMARY KEY,available boolean)`,
		`CREATE TABLE system_settings (key text PRIMARY KEY,value_json text)`,
		`CREATE TABLE id_sequences (name text PRIMARY KEY,value bigint)`,
		`CREATE TABLE cloud_agent_executions (id text PRIMARY KEY,user_id text,status text,cleanup_pending boolean)`,
		`CREATE TABLE cloud_agent_event_records (run_id text,sequence bigint,user_id text,event_json text,PRIMARY KEY(run_id,sequence))`,
		`CREATE TABLE canvas_snapshot_resources (snapshot_id text,resource_id text,PRIMARY KEY(snapshot_id,resource_id))`,
		`CREATE TABLE canvas_snapshots (id text PRIMARY KEY,canvas_id text,user_id text,revision bigint,payload_json text,created_at timestamptz)`,
	}
	for _, statement := range ddl {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal("seed schema failed")
		}
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, step := range schemaMigrations {
		if step.version <= 77 {
			if err := db.Create(&schemaMigration{Version: step.version, Name: step.name, Checksum: step.checksum, AppliedAt: time.Unix(1, 0)}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, step := range []schemaMigration{{Version: 78, Name: "skill_publication_review", Checksum: "sha256:skill-publication-review-v78-r1"}, {Version: 79, Name: "payment_order_method", Checksum: "sha256:payment-order-method-v79-r1"}} {
		if err := db.Create(&step).Error; err != nil {
			t.Fatal(err)
		}
	}
	data := kivaoImportData{
		"users":                     {{"id": "u1", "username": "synthetic-user", "password_hash": "synthetic-hash", "role": "admin", "status": "active"}},
		"user_avatars":              {{"user_id": "u1", "data": []byte{0, 255, 128, 10}}},
		"credit_accounts":           {{"user_id": "u1", "available_microcredits": int64(950), "reserved_microcredits": int64(0)}},
		"credit_ledger_entries":     {{"id": "l1", "user_id": "u1", "available_delta_microcredits": int64(1000), "reserved_delta_microcredits": int64(0), "payment_order_id": "p1", "billing_order_id": ""}, {"id": "l2", "user_id": "u1", "available_delta_microcredits": int64(-50), "reserved_delta_microcredits": int64(0), "payment_order_id": "", "billing_order_id": "bill1"}},
		"model_channels":            {{"id": "c1", "name": "Synthetic", "scope": "system", "base_url": "https://example.invalid", "api_key": encrypted}},
		"channel_models":            {{"id": "m1", "channel_id": "c1", "model_key": "fixture", "capability": "video", "protocol": "fixture-video", "enabled": true}},
		"resources":                 {{"id": "r1", "user_id": "u1", "status": "ready", "provider": "local", "object_key": "sample.bin", "size": int64(15)}},
		"tasks":                     {{"id": "t1", "user_id": "u1", "status": "succeeded", "prompt": "synthetic prompt"}},
		"canvas_projects":           {{"id": "canvas", "user_id": "u1", "payload_json": `{"id":"canvas","revision":7,"nodes":[{"id":"n1","type":"markdown","metadata":{"content":"kept"}}],"connections":[]}`, "revision": int64(7)}},
		"auth_sessions":             {{"id": "s1", "user_id": "u1", "token_hash": "synthetic-token"}},
		"o_auth_states":             {{"id": "oauth1", "state_hash": "synthetic-oauth-state"}},
		"notification_quota":        {{"key": "synthetic-quota", "count": int64(1)}},
		"task_text_delta":           {{"id": "delta1", "user_id": "u1", "task_id": "t1", "sequence": int64(1), "content": "synthetic text delta"}},
		"payment_orders":            {{"id": "p1", "user_id": "u1", "status": "credited", "amount_fen": int64(100), "currency": "CNY", "payment_method": "alipay"}},
		"system_settings":           {{"key": "email", "value_json": `{"password":"` + encrypted + `"}`}, {"key": "appearance", "value_json": `{"title":"old brand not imported"}`}},
		"id_sequences":              {{"name": "MODEL", "value": int64(5000)}},
		"cloud_agent_executions":    {{"id": "agent1", "user_id": "u1", "status": "completed"}},
		"cloud_agent_event_records": {{"run_id": "agent1", "sequence": int64(1), "user_id": "u1", "event_json": "{}"}},
		"canvas_snapshot_resources": {{"snapshot_id": "snapshot1", "resource_id": "r1"}},
		"canvas_snapshots":          {{"id": "snapshot1", "canvas_id": "canvas", "user_id": "u1", "revision": int64(7), "payload_json": `{"id":"canvas","nodes":[],"connections":[]}`, "created_at": time.Unix(1, 0)}},
	}
	for table, rows := range data {
		if err := db.Table(table).Create(&rows).Error; err != nil {
			t.Fatalf("seed rows failed: %s", table)
		}
	}
	for _, sql := range []string{
		`INSERT INTO payment_orders(id,user_id,status,expires_at) VALUES('expired','u1','pending','2020-01-01')`,
		`INSERT INTO payment_notifications VALUES('notification1','processed','p1')`,
		`INSERT INTO payment_reconciliation_runs VALUES('failed-run','failed')`,
		`INSERT INTO billing_orders VALUES('bill1','settled')`,
		`INSERT INTO payment_provider_configs VALUES('old-epay','enc:v1:obsolete-not-decrypted')`,
		`INSERT INTO skills VALUES('old-skill','old-custom-publication-state')`,
		`INSERT INTO skill_curation_roots VALUES('old-custom-root','not copied')`,
		`INSERT INTO skill_curation_settings VALUES(1,true)`,
		`INSERT INTO plugin_platform_states VALUES('fixture-audio',true),('fixture-video',true),('old-payment-plugin',false)`,
		`INSERT INTO channel_models VALUES('placeholder','c1','unconfigured','','',false)`,
		`INSERT INTO tasks(id,user_id,status) VALUES('replay','u1','text_replay')`,
		`INSERT INTO tasks(id,user_id,status,media_stage) VALUES('old-recovery','u1','failed','download')`,
		// 被放弃的历史正文和引用无需修复，也不能因此改写源库。
		`UPDATE canvas_projects SET payload_json='old incompatible JSON'`,
		`UPDATE canvas_snapshot_resources SET resource_id='missing-old-resource'`,
	} {
		if db.Exec(sql).Error != nil {
			t.Fatal("seed omitted history failed")
		}
	}
}

func TestKivaoImportFiles(t *testing.T) {
	for _, scenario := range []string{"valid", "disabled-placeholder", "wrong-key", "cipher-tamper", "old-media", "old-skills", "extra-package", "symlink", "hardlink", "bad-package", "wrong-plugin", "official-collision", "unknown-protocol", "enabled-placeholder", "partial-placeholder"} {
		t.Run(scenario, func(t *testing.T) {
			o, secret := kivaoTestFiles(t)
			data := kivaoImportData{"system_settings": {{"value_json": `{"secret":"` + secret + `"}`}}}
			switch scenario {
			case "wrong-key":
				os.WriteFile(filepath.Join(o.TargetData, ".settings-key"), bytes.Repeat([]byte{1}, 32), 0600)
			case "cipher-tamper":
				data["system_settings"][0]["value_json"] = `{"secret":"enc:v1:broken"}`
			case "old-media":
				os.Mkdir(filepath.Join(o.TargetData, "resources"), 0700)
			case "old-skills":
				os.Mkdir(filepath.Join(o.TargetData, "skills"), 0700)
			case "extra-package":
				os.WriteFile(filepath.Join(o.TargetData, "plugin-packages/old-payment.zip"), []byte("old"), 0600)
			case "symlink":
				os.Remove(filepath.Join(o.TargetData, ".settings-key"))
				os.Symlink(filepath.Join(o.SourceData, ".settings-key"), filepath.Join(o.TargetData, ".settings-key"))
			case "bad-package":
				os.WriteFile(filepath.Join(o.TargetData, "plugin-packages/fixture-audio.zip"), []byte("invalid"), 0600)
			case "wrong-plugin":
				o.PluginIDs[1] = "missing"
			case "hardlink":
				os.Remove(filepath.Join(o.TargetData, ".settings-key"))
				if err := os.Link(filepath.Join(o.SourceData, ".settings-key"), filepath.Join(o.TargetData, ".settings-key")); err != nil {
					t.Fatal(err)
				}
			case "official-collision":
				raw, err := os.ReadFile(filepath.Join(o.SourceData, "plugin-packages/fixture-audio.zip"))
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(o.OfficialPluginsDir, "conflict.yingce-plugin"), raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "unknown-protocol":
				data["channel_models"] = []map[string]any{{"protocol": "not-installed"}}
			case "disabled-placeholder", "enabled-placeholder", "partial-placeholder":
				data["channel_models"] = []map[string]any{{"protocol": "", "capability": "", "enabled": scenario == "enabled-placeholder"}}
				if scenario == "partial-placeholder" {
					data["channel_models"][0]["capability"] = "video"
				}
			}
			result, err := inspectKivaoImportFiles(o, data)
			if scenario == "valid" || scenario == "disabled-placeholder" {
				if err != nil || result.ciphers != 1 {
					t.Fatalf("valid fixture failed: %v", err)
				}
			} else if err == nil {
				t.Fatal("unsafe fixture accepted")
			}
		})
	}
}

func TestKivaoImportPluginRegistration(t *testing.T) {
	for _, scenario := range []string{"uploaded", "official-to-uploaded", "stale-official", "changed-enabled", "changed-manifest", "normalized-registry"} {
		t.Run(scenario, func(t *testing.T) {
			o, _ := kivaoTestFiles(t)
			read := func(dir string) []kivaoPluginRecord {
				raw, err := os.ReadFile(filepath.Join(dir, "plugin_registry.json"))
				if err != nil {
					t.Fatal(err)
				}
				var rows []kivaoPluginRecord
				if json.Unmarshal(raw, &rows) != nil {
					t.Fatal("fixture registry invalid")
				}
				return rows
			}
			src, dst := read(o.SourceData), read(o.TargetData)
			switch scenario {
			case "official-to-uploaded":
				src[0].Source = "official"
			case "stale-official":
				src[0].Source = "official"
				dst[0].Source = "official"
			case "changed-enabled":
				var m protocol.Manifest
				_ = json.Unmarshal(dst[0].Raw, &m)
				m.Metadata.Enabled = false
				dst[0].Raw, _ = json.Marshal(m)
			case "changed-manifest":
				var m protocol.Manifest
				_ = json.Unmarshal(src[0].Raw, &m)
				m.Contributes.Providers[0].Create.Path = "/wrong-path"
				src[0].Raw, _ = json.Marshal(m)
				dst[0].Raw = src[0].Raw
			case "normalized-registry":
				var m protocol.Manifest
				_ = json.Unmarshal(src[0].Raw, &m)
				src[0].Raw, _ = json.Marshal(m)
				dst[0].Raw = src[0].Raw
			}
			for dir, rows := range map[string][]kivaoPluginRecord{o.SourceData: src, o.TargetData: dst} {
				raw, _ := json.Marshal(rows)
				if err := os.WriteFile(filepath.Join(dir, "plugin_registry.json"), raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			a, err := os.OpenRoot(o.SourceData)
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			b, err := os.OpenRoot(o.TargetData)
			if err != nil {
				t.Fatal(err)
			}
			defer b.Close()
			_, err = kivaoVerifyPlugins(a, b, o.PluginIDs)
			wantPass := scenario == "uploaded" || scenario == "official-to-uploaded" || scenario == "normalized-registry"
			if (err == nil) != wantPass {
				t.Fatalf("registration check mismatch: %v", err)
			}
		})
	}
}

// 可选私有夹具仅含两个插件包与注册元信息；不读取数据库、密钥或业务资源。
func TestKivaoImportHistoricalPluginCopy(t *testing.T) {
	root := os.Getenv("KIVAO_IMPORT_PLUGIN_FIXTURE_DIR")
	if root == "" {
		t.Skip("requires explicitly prepared offline plugin fixture")
	}
	source, err := os.OpenRoot(filepath.Join(root, "source"))
	if err != nil {
		t.Fatal("source fixture unavailable")
	}
	defer source.Close()
	target, err := os.OpenRoot(filepath.Join(root, "target"))
	if err != nil {
		t.Fatal("target fixture unavailable")
	}
	defer target.Close()
	ids := []string{"kunrou-chat-audio", "kivao-kunrou-video"}
	if _, err := kivaoVerifyPlugins(source, target, ids); err != nil {
		t.Fatal(err)
	}
	o := KivaoImportOptions{PluginIDs: ids, OfficialPluginsDir: os.Getenv("CANVAS_OFFICIAL_PLUGIN_DIR")}
	protocolIDs := append([]string(nil), ids...)
	if raw, err := os.ReadFile(filepath.Join(root, "protocol-ids.json")); err == nil {
		var extra []string
		if json.Unmarshal(raw, &extra) != nil {
			t.Fatal("protocol identity fixture invalid")
		}
		protocolIDs = append(protocolIDs, extra...)
	} else if !os.IsNotExist(err) {
		t.Fatal("protocol identity fixture unreadable")
	}
	models := []map[string]any{}
	for _, id := range protocolIDs {
		models = append(models, map[string]any{"protocol": id})
	}
	if _, err := kivaoVerifyProtocolBindings(target, o, kivaoImportData{"channel_models": models}); err != nil {
		t.Fatal(err)
	}
}

func TestKivaoImportPostgres(t *testing.T) {
	src, dst := kivaoTestDB(t), kivaoTestDB(t)
	o, secret := kivaoTestFiles(t)
	kivaoSeed79(t, src, secret)
	before, _ := kivaoTargetDigest(src)
	readOnlyObserved := false
	if err := src.Callback().Query().Before("gorm:query").Register("test:kivao_read_only", func(db *gorm.DB) {
		var readOnly, isolation string
		if err := db.Statement.ConnPool.QueryRowContext(context.Background(), "SELECT current_setting('transaction_read_only'),current_setting('transaction_isolation')").Scan(&readOnly, &isolation); err != nil || readOnly != "on" || isolation != "repeatable read" {
			t.Error("source transaction is not a read-only repeatable snapshot")
		}
		readOnlyObserved = true
	}); err != nil {
		t.Fatal(err)
	}
	report, err := ImportKivao79(context.Background(), src, dst, o)
	src.Callback().Query().Remove("test:kivao_read_only")
	if !readOnlyObserved {
		t.Fatal("source snapshot was not observed")
	}
	if err != nil {
		t.Fatalf("plan: %v, blockers: %v", err, report.Blockers)
	}
	tables, _ := dst.Migrator().GetTables()
	if len(tables) != 0 {
		t.Fatal("plan wrote target")
	}
	o.Apply = true
	report, err = ImportKivao79(context.Background(), src, dst, o)
	if err != nil {
		t.Fatalf("apply: %v, blockers: %v", err, report.Blockers)
	}
	if !report.DatabaseImported || report.ProductionReady || report.CiphertextsVerified != 2 || report.Scope != kivaoImportScope {
		t.Fatal("incorrect acceptance report")
	}
	var user model.User
	if err := dst.First(&user, "id = ?", "u1").Error; err != nil || user.PasswordHash != "synthetic-hash" {
		t.Fatal("account changed")
	}
	var avatar model.UserAvatar
	if err := dst.First(&avatar).Error; err != nil || !bytes.Equal(avatar.Data, []byte{0, 255, 128, 10}) {
		t.Fatal("binary avatar changed")
	}
	var channel model.ModelChannel
	if err := dst.First(&channel).Error; err != nil || channel.WebsiteID == "" || channel.APIKey != secret {
		t.Fatal("channel identity or credentials changed")
	}
	var account model.CreditAccount
	if dst.First(&account).Error != nil || account.AvailableMicrocredits != 950 || account.ReservedMicrocredits != 0 {
		t.Fatal("balance changed")
	}
	var ledger []model.CreditLedgerEntry
	if dst.Order("id").Find(&ledger).Error != nil || len(ledger) != 2 || ledger[0].PaymentOrderID != "p1" || ledger[1].BillingOrderID != "bill1" {
		t.Fatal("original ledger or historical references changed")
	}
	for _, table := range kivaoImportSkip {
		if !dst.Migrator().HasTable(table) {
			continue
		}
		if strings.HasPrefix(table, "skill_curation_") {
			continue
		}
		var count int64
		if dst.Table(table).Count(&count).Error != nil || count != 0 {
			t.Fatalf("omitted history copied: %s", table)
		}
	}
	var oldSkillRoots int64
	if dst.Table("skill_curation_roots").Where("id = ?", "old-custom-root").Count(&oldSkillRoots).Error != nil || oldSkillRoots != 0 {
		t.Fatal("old skill curation copied")
	}
	for _, table := range []string{"payment_orders", "skills", "payment_provider_configs", "canvas_projects", "tasks", "resources"} {
		found := false
		for _, entry := range report.Tables {
			if entry.Table == table && entry.Action == "omit" && entry.Rows == 0 && entry.OmittedRows > 0 {
				found = true
			}
		}
		if !found {
			t.Fatalf("omission not accounted for: %s", table)
		}
	}
	var states []model.PluginPlatformState
	if dst.Find(&states).Error != nil || len(states) != 2 {
		t.Fatal("unexpected platform plugin states imported")
	}
	var count int64
	var sequence model.IDSequence
	if err := dst.Where("name = ?", "MODEL").First(&sequence).Error; err != nil || sequence.Value != 5000 {
		t.Fatal("retired ID sequence was reset")
	}
	dst.Table("auth_sessions").Count(&count)
	if count != 0 {
		t.Fatal("sessions copied")
	}
	dst.Model(&model.OAuthState{}).Count(&count)
	if count != 0 {
		t.Fatal("one-time OAuth states copied")
	}
	dst.Model(&model.NotificationQuota{}).Count(&count)
	if count != 0 {
		t.Fatal("old notification quotas copied")
	}
	dst.Table("system_settings").Where("key = ?", "appearance").Count(&count)
	if count != 0 {
		t.Fatal("old operations config copied")
	}
	encoded, _ := json.Marshal(report)
	for _, private := range []string{"synthetic-user", "synthetic-hash", secret, "synthetic prompt"} {
		if bytes.Contains(encoded, []byte(private)) {
			t.Fatal("report leaked row data")
		}
	}
	report, err = ImportKivao79(context.Background(), src, dst, o)
	if err != nil || !report.AlreadyImported {
		t.Fatalf("idempotence: %v", err)
	}
	after, _ := kivaoTargetDigest(src)
	if before != after {
		t.Fatal("source changed")
	}
	dst.Exec("UPDATE credit_accounts SET available_microcredits = available_microcredits + 1")
	if _, err := ImportKivao79(context.Background(), src, dst, o); err == nil || err.Error() != "import_target_changed" {
		t.Fatal("modified target accepted")
	}
}

func TestKivaoImportPostgresRejectsUnsafeCopies(t *testing.T) {
	mutations := map[string]string{
		"wrong-lineage":          `UPDATE schema_migrations SET checksum='unknown' WHERE version=79`,
		"nonempty-target":        "",
		"pending-task":           `UPDATE tasks SET status='running' WHERE id='t1'`,
		"pending-payment":        `UPDATE payment_orders SET status='pending',expires_at=CURRENT_TIMESTAMP+interval '1 day' WHERE id='expired'`,
		"paid-uncredited":        `UPDATE payment_orders SET provider_paid_at=CURRENT_TIMESTAMP WHERE id='expired'`,
		"provider-paid-status":   `UPDATE payment_orders SET provider_status='paid' WHERE id='expired'`,
		"negative-balance":       `UPDATE credit_accounts SET available_microcredits=-1`,
		"old-scope-receipt":      "",
		"pending-notification":   `UPDATE payment_notifications SET status='pending'`,
		"orphan-notification":    `UPDATE payment_notifications SET payment_order_id='missing'`,
		"payment-obligation":     `INSERT INTO payment_reconciliation_items VALUES('unresolved','credit_failed')`,
		"frozen-credit":          `UPDATE credit_accounts SET reserved_microcredits=1`,
		"ledger-mismatch":        `UPDATE credit_accounts SET available_microcredits=951`,
		"unknown-column":         `ALTER TABLE users ADD COLUMN unreviewed text`,
		"missing-model-channel":  `UPDATE channel_models SET channel_id='missing'`,
		"live-lease":             `UPDATE tasks SET lease_expires_at=CURRENT_TIMESTAMP+interval '1 day' WHERE id='t1'`,
		"cleanup-pending":        `UPDATE cloud_agent_executions SET cleanup_pending=true`,
		"replay-with-upstream":   `UPDATE tasks SET provider_request_id='uncertain' WHERE status='text_replay'`,
		"reserved-billing":       `UPDATE billing_orders SET status='reserved'`,
		"missing-activity-table": `DROP TABLE payment_orders`,
		"unknown-setting":        `INSERT INTO system_settings VALUES('unknown','{}')`,
		// 前置合法但超过目标 varchar 长度，必须连已创建的结构一起回滚。
		"insert-failure": `UPDATE model_channels SET name=repeat('x',1000)`,
	}
	for scenario, query := range mutations {
		t.Run(scenario, func(t *testing.T) {
			src, dst := kivaoTestDB(t), kivaoTestDB(t)
			o, secret := kivaoTestFiles(t)
			o.Apply = true
			kivaoSeed79(t, src, secret)
			if query != "" {
				if err := src.Exec(query).Error; err != nil {
					t.Fatal("fixture mutation failed")
				}
			}
			if scenario == "nonempty-target" {
				dst.Exec("CREATE TABLE preexisting (id int)")
			}
			if scenario == "old-scope-receipt" {
				if dst.AutoMigrate(&kivaoImportReceipt{}) != nil || dst.Create(&kivaoImportReceipt{ID: "schema79-to104-v1"}).Error != nil {
					t.Fatal("old receipt fixture failed")
				}
			}
			before, _ := kivaoTargetDigest(src)
			report, err := ImportKivao79(context.Background(), src, dst, o)
			if err == nil || report.DatabaseImported {
				t.Fatal("unsafe fixture accepted")
			}
			tables, _ := dst.Migrator().GetTables()
			want := 0
			if scenario == "nonempty-target" || scenario == "old-scope-receipt" {
				want = 1
			}
			if len(tables) != want {
				t.Fatal("failed import left target writes")
			}
			after, _ := kivaoTargetDigest(src)
			if before != after {
				t.Fatal("failed import changed source")
			}
		})
	}
}
