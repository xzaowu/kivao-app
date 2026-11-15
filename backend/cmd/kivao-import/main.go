// kivao-import operates on offline rehearsal copies only. It never starts the server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
)

func main() {
	if run() != nil {
		os.Exit(1)
	}
}

func run() error {
	var options database.KivaoImportOptions
	var plugins string
	flag.BoolVar(&options.Apply, "apply", false, "import into an empty local rehearsal database; default is read-only plan")
	flag.StringVar(&options.SourceData, "source-data", "", "private offline source directory")
	flag.StringVar(&options.TargetData, "target-data", "", "separately prepared private file copy")
	flag.StringVar(&plugins, "plugin-ids", "", "exact audio and video plugin IDs, comma-separated")
	flag.StringVar(&options.OfficialPluginsDir, "official-plugins", "", "candidate checkout plugin-packages directory (read only)")
	flag.Parse()
	options.PluginIDs = strings.Split(plugins, ",")
	for i := range options.PluginIDs {
		options.PluginIDs[i] = strings.TrimSpace(options.PluginIDs[i])
	}
	fail := func(code string) error {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"error": code, "productionReady": false})
		return errors.New(code)
	}
	if flag.NArg() != 0 {
		return fail("import_unexpected_arguments")
	}
	srcDSN, dstDSN := os.Getenv("KIVAO_IMPORT_SOURCE_DSN"), os.Getenv("KIVAO_IMPORT_TARGET_DSN")
	srcID, err := localDatabaseID(srcDSN)
	if err != nil {
		return fail("import_source_not_local_rehearsal")
	}
	dstID, err := localDatabaseID(dstDSN)
	if err != nil || srcID == dstID {
		return fail("import_target_not_independent_local_rehearsal")
	}
	// 独立命令不能被误指向日常开发、旧备份或生产数据目录。
	root := os.Getenv("KIVAO_IMPORT_REHEARSAL_ROOT")
	if root == "" {
		return fail("import_rehearsal_root_required")
	}
	root, err = filepath.Abs(root)
	if err != nil || filepath.Base(root) != "kivao-import-rehearsal" {
		return fail("import_rehearsal_root_invalid")
	}
	for _, dir := range []string{options.SourceData, options.TargetData} {
		absolute, e := filepath.Abs(dir)
		if e != nil || dir == "" || !strings.HasPrefix(absolute, root+string(os.PathSeparator)) {
			return fail("import_data_outside_rehearsal_root")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	open := func(dsn string) (*gorm.DB, error) {
		db, e := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableAutomaticPing: true})
		if e != nil {
			return nil, e
		}
		sqlDB, e := db.DB()
		if e != nil {
			return nil, e
		}
		sqlDB.SetMaxOpenConns(1)
		if e = sqlDB.PingContext(ctx); e != nil {
			sqlDB.Close()
			return nil, e
		}
		return db, nil
	}
	src, err := open(srcDSN)
	if err != nil {
		return fail("import_source_connection_failed")
	}
	srcSQL, _ := src.DB()
	defer srcSQL.Close()
	dst, err := open(dstDSN)
	if err != nil {
		return fail("import_target_connection_failed")
	}
	dstSQL, _ := dst.DB()
	defer dstSQL.Close()
	report, err := database.ImportKivao79(ctx, src, dst, options)
	output := struct {
		Report *database.KivaoImportReport `json:"report"`
		Error  string                      `json:"error,omitempty"`
	}{Report: report}
	if err != nil {
		output.Error = err.Error()
	}
	if encodeErr := json.NewEncoder(os.Stdout).Encode(output); encodeErr != nil {
		return errors.New("import_report_failed")
	}
	return err
}

func localDatabaseID(dsn string) (string, error) {
	if dsn == "" {
		return "", errors.New("missing_dsn")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return "", errors.New("invalid_dsn")
	}
	c := cfg.ConnConfig
	if (c.Host != "127.0.0.1" && c.Host != "::1") || !strings.HasPrefix(c.Database, "kivao_rehearsal_") || len(c.Fallbacks) > 1 {
		return "", errors.New("not_local_rehearsal")
	}
	for _, fallback := range c.Fallbacks {
		if fallback.Host != c.Host || fallback.Port != c.Port {
			return "", errors.New("nonlocal_fallback")
		}
	}
	// 不允许连接参数改写 schema/search_path 或通过 service 配置覆盖目标。
	for key := range c.RuntimeParams {
		if key != "application_name" {
			return "", errors.New("unreviewed_connection_parameter")
		}
	}
	// 两种 loopback 地址可能指向同一实例；保守地按端口和库名判重。
	return fmt.Sprintf("loopback:%d/%s", c.Port, c.Database), nil
}
