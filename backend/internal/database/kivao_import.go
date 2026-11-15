package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// KivaoImportReport 只包含计数与状态，不包含账号、凭据、任务正文或连接串。
type KivaoImportReport struct {
	Mode                string             `json:"mode"`
	Scope               string             `json:"scope"`
	SourceSchema        int64              `json:"sourceSchema"`
	TargetSchema        int64              `json:"targetSchema"`
	Tables              []KivaoImportTable `json:"tables"`
	Blockers            []string           `json:"blockers"`
	DatabaseImported    bool               `json:"databaseImported"`
	AlreadyImported     bool               `json:"alreadyImported"`
	FilesVerified       bool               `json:"filesVerified"`
	ProductionReady     bool               `json:"productionReady"`
	CiphertextsVerified int                `json:"ciphertextsVerified"`
}

type KivaoImportTable struct {
	Table       string `json:"table"`
	Rows        int    `json:"rows"`
	Action      string `json:"action"`
	OmittedRows int    `json:"omittedRows,omitempty"`
}

type KivaoImportOptions struct {
	Apply bool
	// 文件与插件必须是已准备好的独立副本；本导入不会启动应用或复制文件。
	SourceData         string
	TargetData         string
	PluginIDs          []string
	OfficialPluginsDir string
}

type kivaoImportReceipt struct {
	ID           string `gorm:"primaryKey;size:32"`
	SourceDigest string
	TargetDigest string
	FilesDigest  string
	CreatedAt    time.Time
}

func (kivaoImportReceipt) TableName() string { return "kivao_import_receipts" }

type kivaoImportData map[string][]map[string]any

const kivaoImportScope = "accounts-models79-to104-v2"

// 清单不从当前 Models 自动扩大；新增表或旧定制必须被明确分类。
var kivaoImportKeep = strings.Fields(`
users user_identities user_groups user_group_channels user_group_model_overrides user_avatars
credit_accounts credit_ledger_entries model_pricings
user_storage_grants referral_profiles referral_bindings referral_commissions redeem_batches redeem_codes
model_channels channel_models channel_model_price_tiers logical_models logical_model_revisions logical_model_routes id_sequences
`)

// 用户明确放弃迁入这些历史记录和旧定制；只统计数量，不读取正文或配置密文。
// 原数据库与文件仍保留回滚，不执行源删除。
var kivaoImportSkip = strings.Fields(`
billing_orders topup_products payment_provider_configs payment_orders payment_notifications payment_reconciliation_runs payment_reconciliation_items
user_storage_states user_oss_settings storage_locations user_daily_upload_usages ark_private_asset_bindings
route_attempts api_call_logs
resources assets asset_folders asset_versions asset_representations project_asset_links project_asset_folders project_asset_candidates
voice_profiles character_voice_bindings projects style_profiles project_units canvas_unit_links
shots shot_revisions shot_artifacts shot_asset_references workflow_template_versions workflow_instances workflow_step_instances workflow_step_tasks production_task_links
canvas_projects canvas_snapshots canvas_snapshot_resources canvas_mutation_receipts canvas_shares
tasks task_text_delta task_logs results creation_runs creation_submissions
cloud_agent_executions cloud_agent_event_records cloud_agent_message_records cloud_agent_canvas_mutations cloud_agent_pi_sessions
agent_profiles agent_lessons agent_memory_settings agent_memory_proposals agent_memory_revisions agent_memory_documents agent_memory_document_revisions
drama_productions drama_casts drama_episodes drama_shots drama_takes drama_segments drama_jobs
user_prompt_customizations admin_audit_events user_daily_activities prompt_templates
auth_sessions o_auth_states email_verification_codes auth_verifications login_logs notification_quota sms_records
canvas_edit_leases cloud_agent_resource_leases cloud_agent_gemini_caches upload_reservations
announcements user_announcement_reads banner_announcements announcement_image_drafts
workbench_tools workbench_presets tools tool_favorites
skills skill_versions skill_files skill_library_categories user_skill_states builtin_skill_tombstones user_plugin_states
skill_curation_settings skill_curation_categories skill_curation_assignments skill_curation_roots skill_curation_root_assignments
`)

// 非空时尚需确认的独立运营数据，不因收窄历史范围而自动扩大省略清单。
var kivaoImportReview = strings.Fields(`
resource_deletion_jobs resource_offload_jobs sms_channels user_feedbacks
`)

var kivaoImportSettings = strings.Fields(`email registration linuxdo_oauth turnstile credit_policy referral runtime_policy`)
var kivaoImportOmitSettings = strings.Fields(`appearance feature_availability drawing_engine tldraw_license_key feishu_feedback ecommerce_agent_planning_model ecommerce_agent_orchestration_v1 oss libtv billing_auto_refund response_interception ark_private_assets`)

func kivaoContains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// ImportKivao79 仅供离线工具使用。源事务只读且隔离，目标只接受空库或本工具完整写入的副本。
// 不复制 schema_migrations，不启动应用，不复制队列；所有数据库变更在一个事务内完成。
func ImportKivao79(ctx context.Context, source, target *gorm.DB, options KivaoImportOptions) (*KivaoImportReport, error) {
	report := &KivaoImportReport{Mode: "plan", Scope: kivaoImportScope, TargetSchema: 104, Blockers: []string{}, Tables: []KivaoImportTable{}}
	if options.Apply {
		report.Mode = "apply"
	}
	if CurrentSchemaVersion != 104 {
		return report, errors.New("import_target_version_changed")
	}
	if source.Dialector.Name() != "postgres" || target.Dialector.Name() != "postgres" {
		return report, errors.New("import_requires_postgres")
	}
	source = source.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).WithContext(ctx)
	target = target.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).WithContext(ctx)
	if source == target || source.ConnPool == target.ConnPool {
		return report, errors.New("import_source_equals_target")
	}
	for _, db := range []*gorm.DB{source, target} {
		var version int
		if db.Raw("SHOW server_version_num").Scan(&version).Error != nil || version < 170000 || version >= 180000 {
			return report, errors.New("import_requires_postgres17")
		}
	}
	readOptions := &sql.TxOptions{ReadOnly: true}
	if source.Dialector.Name() == "postgres" {
		readOptions.Isolation = sql.LevelRepeatableRead
	}
	err := source.Transaction(func(src *gorm.DB) error {
		if err := validateKivao79(src); err != nil {
			return err
		}
		report.SourceSchema = 79
		if err := checkKivaoOmittedWork(src, report); err != nil {
			return err
		}
		data, err := readKivaoImportData(src, report, options.PluginIDs)
		if err != nil {
			return err
		}
		validateKivaoImportData(data, report)
		files, err := inspectKivaoImportFiles(options, data)
		if err != nil {
			report.Blockers = append(report.Blockers, err.Error())
		} else {
			report.FilesVerified = true
			report.CiphertextsVerified = files.ciphers
		}
		if len(report.Blockers) > 0 {
			return errors.New("import_preflight_blocked")
		}
		sourceHash := kivaoDigest(data)
		if !options.Apply {
			return checkKivaoTarget(target, sourceHash, files.digest, report)
		}
		return target.Transaction(func(tx *gorm.DB) error {
			// 并发运行也不能让两个导入器同时观察到空库。
			if tx.Dialector.Name() == "postgres" {
				if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(7864104)).Error; err != nil {
					return errors.New("import_target_lock_failed")
				}
			}
			if err := checkKivaoTarget(tx, sourceHash, files.digest, report); err != nil {
				return err
			}
			if report.AlreadyImported {
				return nil
			}
			if err := MigrateSchema(tx); err != nil {
				return errors.New("import_create_target_schema_failed")
			}
			// 新库初始化会建立空的业务编号序列；用旧序列替换后再向前校准，不能复用已删除对象的 ID。
			if err := tx.Exec("DELETE FROM id_sequences").Error; err != nil {
				return errors.New("import_sequence_prepare_failed")
			}
			for _, name := range sortedKivaoTables(data) {
				rows := data[name]
				if len(rows) == 0 {
					continue
				}
				if err := tx.Table(name).CreateInBatches(rows, 100).Error; err != nil {
					return fmt.Errorf("import_insert_failed:%s", name)
				}
				actual, err := readKivaoRows(tx, name)
				if err != nil {
					return err
				}
				// 只比较源列，新增列随后按官方数据转换补齐；保留 json:- 字段及逻辑删除记录。
				columns := sortedKivaoColumns(rows[0])
				for _, row := range actual {
					for key := range row {
						if !kivaoContains(columns, key) {
							delete(row, key)
						}
					}
				}
				if kivaoDigest(rows) != kivaoDigest(actual) {
					return fmt.Errorf("import_copy_mismatch:%s", name)
				}
			}
			// 新库账本已经是 104，但刚导入的旧业务行仍需进行数据转换。
			for _, step := range schemaMigrations {
				// 只重放经过审查、确实处理旧业务行的转换，不笼统重复整套 DDL。
				if !kivaoContains([]string{"88", "89", "97"}, fmt.Sprint(step.version)) {
					continue
				}
				if err := step.apply(tx); err != nil {
					return fmt.Errorf("import_transform_failed:%d", step.version)
				}
			}
			if err := ReconcilePrefixedIDSequences(tx); err != nil {
				return errors.New("import_id_sequence_failed")
			}
			if err := RequireSchemaVersion(tx); err != nil {
				return errors.New("import_target_schema_invalid")
			}
			if err := verifyKivaoProtectedRows(tx, data); err != nil {
				return err
			}
			// 隔离副本必须保持静止；提交前再次核对密钥与插件身份。
			afterFiles, err := inspectKivaoImportFiles(options, data)
			if err != nil || afterFiles.digest != files.digest {
				return errors.New("import_files_changed")
			}
			targetHash, err := kivaoTargetDigest(tx)
			if err != nil {
				return err
			}
			if err := tx.AutoMigrate(&kivaoImportReceipt{}); err != nil {
				return errors.New("import_receipt_schema_failed")
			}
			receipt := kivaoImportReceipt{ID: kivaoImportScope, SourceDigest: sourceHash, TargetDigest: targetHash, FilesDigest: files.digest, CreatedAt: time.Now().UTC()}
			if err := tx.Create(&receipt).Error; err != nil {
				return errors.New("import_receipt_write_failed")
			}
			return nil
		})
	}, readOptions)
	if err != nil && !strings.HasPrefix(err.Error(), "import_") {
		err = errors.New("import_database_operation_failed")
	}
	if err == nil && options.Apply {
		report.DatabaseImported = true
	}
	return report, err
}

func validateKivao79(db *gorm.DB) error {
	if !db.Migrator().HasTable(&schemaMigration{}) {
		return errors.New("import_source_missing_ledger")
	}
	plan, err := migrationsForDatabase(db)
	if err != nil {
		return errors.New("import_source_lineage_invalid")
	}
	expected := map[int64]migration{}
	for _, step := range plan {
		if step.version <= 77 {
			expected[step.version] = step
		}
	}
	expected[78] = migration{version: 78, name: "skill_publication_review", checksum: "sha256:skill-publication-review-v78-r1"}
	expected[79] = migration{version: 79, name: "payment_order_method", checksum: "sha256:payment-order-method-v79-r1"}
	var rows []schemaMigration
	if err := db.Find(&rows).Error; err != nil {
		return errors.New("import_source_ledger_read_failed")
	}
	if len(rows) != len(expected) {
		return errors.New("import_source_lineage_invalid")
	}
	for _, row := range rows {
		step, ok := expected[row.Version]
		if !ok || validateMigrationRecord(row, step) != nil {
			return errors.New("import_source_lineage_invalid")
		}
	}
	return nil
}

func readKivaoImportData(db *gorm.DB, report *KivaoImportReport, pluginIDs []string) (kivaoImportData, error) {
	data := kivaoImportData{}
	tables, err := db.Migrator().GetTables()
	if err != nil {
		return nil, errors.New("import_source_tables_failed")
	}
	models := map[string]*gorm.Statement{}
	for _, entity := range Models() {
		st := &gorm.Statement{DB: db}
		if err := st.Parse(entity); err != nil {
			return nil, errors.New("import_model_schema_failed")
		}
		models[st.Table] = st
	}
	sort.Strings(tables)
	for _, name := range tables {
		if name == "schema_migrations" || strings.HasPrefix(name, "sqlite_") {
			continue
		}
		if kivaoContains(kivaoImportSkip, name) {
			var count int64
			if db.Table(name).Count(&count).Error != nil {
				return nil, errors.New("import_omitted_table_count_failed")
			}
			report.Tables = append(report.Tables, KivaoImportTable{Table: name, Action: "omit", OmittedRows: int(count)})
			continue
		}
		st, known := models[name]
		if !known {
			report.Blockers = append(report.Blockers, "unclassified_source_table")
			continue
		}
		rows, err := readKivaoRows(db, name)
		if err != nil {
			return nil, err
		}
		action := "review"
		originalCount := len(rows)
		switch {
		case kivaoContains(kivaoImportKeep, name):
			action = "copy"
		case name == "system_settings":
			action = "filter"
			selected := []map[string]any{}
			for _, r := range rows {
				key := kivaoString(r["key"])
				if kivaoContains(kivaoImportSettings, key) {
					selected = append(selected, r)
				} else if !kivaoContains(kivaoImportOmitSettings, key) && !strings.HasPrefix(key, "inspiration.entry.") && !strings.HasPrefix(key, "workbench.examples.") {
					report.Blockers = append(report.Blockers, "unmapped_system_setting")
				}
			}
			rows = selected
		case name == "plugin_platform_states":
			action = "filter"
			selected := []map[string]any{}
			for _, r := range rows {
				if kivaoContains(pluginIDs, kivaoString(r["plugin_id"])) {
					selected = append(selected, r)
				}
			}
			rows = selected
		case kivaoContains(kivaoImportReview, name):
			action = "review"
		}
		report.Tables = append(report.Tables, KivaoImportTable{Table: name, Rows: len(rows), Action: action, OmittedRows: originalCount - len(rows)})
		if action == "review" && len(rows) > 0 {
			report.Blockers = append(report.Blockers, "unmapped_dependency:"+name)
		}
		if action != "copy" && action != "filter" {
			continue
		}
		for _, row := range rows {
			for col := range row {
				if st.Schema.FieldsByDBName[col] == nil {
					report.Blockers = append(report.Blockers, "unmapped_source_column:"+name)
					break
				}
			}
		}
		data[name] = rows
	}
	for _, name := range []string{"users", "credit_accounts", "credit_ledger_entries", "model_channels", "channel_models"} {
		if _, ok := data[name]; !ok {
			report.Blockers = append(report.Blockers, "required_source_table_missing:"+name)
		}
	}
	return data, nil
}

func readKivaoRows(db *gorm.DB, table string) ([]map[string]any, error) {
	var rows []map[string]any
	if err := db.Table(table).Limit(100001).Find(&rows).Error; err != nil {
		return nil, errors.New("import_table_read_failed")
	}
	if len(rows) > 100000 {
		return nil, fmt.Errorf("import_table_limit_exceeded:%s", table)
	}
	for _, row := range rows {
		for key, value := range row {
			if stamp, ok := value.(time.Time); ok {
				row[key] = stamp.UTC().Truncate(time.Microsecond)
			}
		}
		if _, err := json.Marshal(row); err != nil {
			return nil, errors.New("import_unsupported_cell_type")
		}
	}
	return rows, nil
}

func kivaoString(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func kivaoDigest(value any) string {
	// 数据库行无默认顺序；每张表按完整规范行排序，不依赖创建顺序。
	switch v := value.(type) {
	case []map[string]any:
		encoded := make([]string, 0, len(v))
		for _, r := range v {
			b, _ := json.Marshal(r)
			encoded = append(encoded, string(b))
		}
		sort.Strings(encoded)
		value = encoded
	case kivaoImportData:
		out := map[string]string{}
		for k, rows := range v {
			out[k] = kivaoDigest(rows)
		}
		value = out
	}
	b, _ := json.Marshal(value)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func sortedKivaoTables(data kivaoImportData) []string {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	priority := map[string]int{"users": 1}
	sort.SliceStable(keys, func(i, j int) bool {
		a, b := priority[keys[i]], priority[keys[j]]
		if a == 0 {
			a = 4
		}
		if b == 0 {
			b = 4
		}
		return a < b
	})
	return keys
}
func sortedKivaoColumns(row map[string]any) []string {
	keys := make([]string, 0, len(row))
	for k := range row {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func checkKivaoTarget(db *gorm.DB, sourceHash, filesHash string, report *KivaoImportReport) error {
	tables, err := db.Migrator().GetTables()
	if err != nil {
		return errors.New("import_target_tables_failed")
	}
	if len(tables) == 0 {
		return nil
	}
	if !db.Migrator().HasTable(&kivaoImportReceipt{}) {
		return errors.New("import_target_not_empty")
	}
	var receipt kivaoImportReceipt
	if err := db.First(&receipt, "id = ?", kivaoImportScope).Error; err != nil {
		return errors.New("import_target_receipt_invalid")
	}
	if receipt.SourceDigest != sourceHash || receipt.FilesDigest != filesHash {
		return errors.New("import_source_changed")
	}
	actual, err := kivaoTargetDigest(db)
	if err != nil {
		return err
	}
	if receipt.TargetDigest != actual {
		return errors.New("import_target_changed")
	}
	if err := RequireSchemaVersion(db); err != nil {
		return errors.New("import_target_schema_invalid")
	}
	report.AlreadyImported = true
	return nil
}

func kivaoTargetDigest(db *gorm.DB) (string, error) {
	data := kivaoImportData{}
	tables, err := db.Migrator().GetTables()
	if err != nil {
		return "", errors.New("import_target_tables_failed")
	}
	for _, table := range tables {
		if table == "kivao_import_receipts" || strings.HasPrefix(table, "sqlite_") {
			continue
		}
		rows, err := readKivaoRows(db, table)
		if err != nil {
			return "", err
		}
		data[table] = rows
	}
	return kivaoDigest(data), nil
}

func verifyKivaoProtectedRows(db *gorm.DB, source kivaoImportData) error {
	for _, table := range []string{"users", "user_identities", "credit_accounts", "credit_ledger_entries", "user_storage_grants", "model_channels", "channel_models", "channel_model_price_tiers", "system_settings"} {
		before, ok := source[table]
		if !ok || len(before) == 0 {
			continue
		}
		after, err := readKivaoRows(db, table)
		if err != nil {
			return err
		}
		columns := sortedKivaoColumns(before[0])
		for _, row := range after {
			for key := range row {
				if !kivaoContains(columns, key) {
					delete(row, key)
				}
			}
		}
		// 官方回填可能更新 updated_at，业务字段必须保持不变。
		for _, row := range after {
			delete(row, "updated_at")
		}
		projected := make([]map[string]any, 0, len(before))
		for _, row := range before {
			copyRow := map[string]any{}
			for k, v := range row {
				if k != "updated_at" {
					copyRow[k] = v
				}
			}
			projected = append(projected, copyRow)
		}
		if kivaoDigest(projected) != kivaoDigest(after) {
			return fmt.Errorf("import_protected_data_changed:%s", table)
		}
	}
	return nil
}

// 不搬历史不等于忽略正在执行或未结清的义务。只在同一源快照内做聚合检查，
// 不读取任务正文、支付载荷或旧配置，不向上游查单，不改变任何订单状态。
func checkKivaoOmittedWork(db *gorm.DB, report *KivaoImportReport) error {
	checks := []struct{ table, unsafe string }{
		{"tasks", `COALESCE(status,'') NOT IN ('succeeded','failed','cancelled','text_replay') OR lease_expires_at > CURRENT_TIMESTAMP OR COALESCE(provider_cancel_status,'') NOT IN ('','confirmed') OR (status='text_replay' AND (COALESCE(billing_order_id,'')<>'' OR COALESCE(provider_request_id,'')<>''))`},
		{"billing_orders", `COALESCE(status,'') NOT IN ('settled','refunded')`},
		{"cloud_agent_executions", `COALESCE(status,'') NOT IN ('completed','failed','cancelled') OR COALESCE(cleanup_pending,false)`},
		{"drama_jobs", `COALESCE(status,'') NOT IN ('succeeded','failed','canceled','cancelled')`},
		{"upload_reservations", `expires_at > CURRENT_TIMESTAMP`},
		{"payment_orders", `NOT (COALESCE(status,'') IN ('credited','closed','create_failed') OR (status='pending' AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)) OR (COALESCE(status,'')<>'credited' AND (provider_paid_at IS NOT NULL OR COALESCE(provider_trade_no,'')<>'' OR EXISTS (SELECT 1 FROM credit_ledger_entries l WHERE l.payment_order_id=payment_orders.id)))`},
		{"payment_orders", `COALESCE(status,'')<>'credited' AND COALESCE(provider_status,'') NOT IN ('','pending','created','closed','failed')`},
		{"payment_notifications", `COALESCE(status,'')<>'processed' OR NOT EXISTS (SELECT 1 FROM payment_orders p WHERE p.id=payment_notifications.payment_order_id AND p.status='credited')`},
		{"payment_reconciliation_runs", `COALESCE(status,'') NOT IN ('completed','failed')`},
		{"payment_reconciliation_items", `COALESCE(result,'') NOT IN ('matched','recovered')`},
	}
	for _, check := range checks {
		if !db.Migrator().HasTable(check.table) {
			// 这些是旧 Schema 79 的安全检查面；缺表不能当作没有活动。
			report.Blockers = append(report.Blockers, "missing_activity_table:"+check.table)
			continue
		}
		var count int64
		if db.Table(check.table).Where(check.unsafe).Count(&count).Error != nil {
			return errors.New("import_activity_check_failed:" + check.table)
		}
		if count > 0 {
			report.Blockers = append(report.Blockers, "unresolved_activity_or_payment:"+check.table)
		}
	}
	return nil
}

func validateKivaoImportData(data kivaoImportData, report *KivaoImportReport) {
	for _, row := range data["credit_accounts"] {
		amount, ok := new(big.Int).SetString(kivaoString(row["available_microcredits"]), 10)
		if !ok || amount.Sign() < 0 {
			report.Blockers = append(report.Blockers, "invalid_credit_balance")
			break
		}
		if kivaoString(row["reserved_microcredits"]) != "0" {
			report.Blockers = append(report.Blockers, "unresolved_credit_reservation")
			break
		}
	}
	users := map[string]bool{}
	for _, row := range data["users"] {
		users[kivaoString(row["id"])] = true
	}
	for table, rows := range data {
		for _, row := range rows {
			if id := kivaoString(row["user_id"]); id != "" && !users[id] {
				report.Blockers = append(report.Blockers, "missing_owner:"+table)
				break
			}
		}
	}
	for _, rel := range [][3]string{{"channel_models", "channel_id", "model_channels"}, {"channel_model_price_tiers", "channel_model_id", "channel_models"}, {"logical_model_revisions", "logical_model_id", "logical_models"}, {"logical_model_routes", "channel_model_id", "channel_models"}, {"logical_model_routes", "logical_model_revision_id", "logical_model_revisions"}} {
		ids := map[string]bool{}
		for _, row := range data[rel[2]] {
			ids[kivaoString(row["id"])] = true
		}
		for _, row := range data[rel[0]] {
			if !ids[kivaoString(row[rel[1]])] {
				report.Blockers = append(report.Blockers, "missing_relation:"+rel[0])
				break
			}
		}
	}
	accounts := map[string]bool{}
	for _, row := range data["credit_accounts"] {
		accounts[kivaoString(row["user_id"])] = true
	}
	for _, row := range data["credit_ledger_entries"] {
		if !accounts[kivaoString(row["user_id"])] {
			report.Blockers = append(report.Blockers, "ledger_without_account")
			break
		}
	}
	// 余额必须可由保留流水解释。无流水且余额非零时不伪造初始账。
	for _, account := range data["credit_accounts"] {
		available, reserved := new(big.Int), new(big.Int)
		for _, entry := range data["credit_ledger_entries"] {
			if entry["user_id"] == account["user_id"] {
				a, okA := new(big.Int).SetString(kivaoString(entry["available_delta_microcredits"]), 10)
				r, okR := new(big.Int).SetString(kivaoString(entry["reserved_delta_microcredits"]), 10)
				if !okA || !okR {
					report.Blockers = append(report.Blockers, "invalid_credit_amount")
					return
				}
				available.Add(available, a)
				reserved.Add(reserved, r)
			}
		}
		if available.String() != kivaoString(account["available_microcredits"]) || reserved.String() != kivaoString(account["reserved_microcredits"]) {
			report.Blockers = append(report.Blockers, "credit_ledger_mismatch")
			break
		}
	}
}
