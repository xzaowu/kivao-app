package app

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Mounted only into an isolated verifier, never included in the application image.
func TestKivaoRestoredSecrets(t *testing.T) {
	dsn, err := url.Parse(os.Getenv("KIVAO_REHEARSAL_DSN"))
	if err != nil || dsn == nil || dsn.Hostname() != "postgres" || dsn.Path != "/kivao_rehearsal" || os.Getenv("KIVAO_COPY_VERIFICATION") != "1" {
		t.Fatal("requires the dedicated isolated rehearsal database")
	}
	dataDir := "/rehearsal/data"
	key, err := os.Stat(filepath.Join(dataDir, ".settings-key"))
	if err != nil || key.Size() != 32 {
		t.Fatal("the copied settings key must already exist and contain 32 bytes")
	}
	query := dsn.Query()
	query.Set("default_transaction_read_only", "on")
	dsn.RawQuery = query.Encode()
	db, err := database.Open(database.Config{Driver: "postgres", DSN: dsn.String(), DataDir: dataDir})
	if err != nil {
		t.Fatal("cannot open the isolated database")
	}
	db.Logger = logger.Default.LogMode(logger.Silent)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal("cannot access the isolated database connection")
	}
	defer sqlDB.Close()
	decrypted := 0
	svc := &Service{dataDir: dataDir}
	check := func(value string) {
		if strings.HasPrefix(value, encryptedSettingPrefix) {
			if _, err := svc.decryptSettingSecret(value); err != nil {
				t.Fatal("encrypted configuration cannot be decrypted with the copied key")
			}
			decrypted++
		}
	}
	var walk func(any)
	walk = func(value any) {
		switch value := value.(type) {
		case string:
			check(value)
		case []any:
			for _, item := range value {
				walk(item)
			}
		case map[string]any:
			for _, item := range value {
				walk(item)
			}
		}
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		var channels []model.ModelChannel
		if err := tx.Unscoped().Select("api_key", "secret_key").Find(&channels).Error; err != nil {
			return err
		}
		for _, channel := range channels {
			check(channel.APIKey)
			check(channel.SecretKey)
		}
		for _, table := range []string{"system_settings", "user_oss_settings", "storage_locations"} {
			var values []string
			if err := tx.Table(table).Pluck("value_json", &values).Error; err != nil {
				return err
			}
			for _, value := range values {
				if strings.TrimSpace(value) == "" {
					continue
				}
				var document any
				if err := json.Unmarshal([]byte(value), &document); err != nil {
					t.Fatal("stored settings JSON is invalid")
				}
				walk(document)
			}
		}
		var payments []string
		if err := tx.Table("payment_provider_configs").Pluck("config_cipher", &payments).Error; err != nil {
			return err
		}
		for _, value := range payments {
			check(value)
		}
		return nil
	}); err != nil {
		t.Fatal("cannot inspect the isolated configuration tables")
	}
	if decrypted == 0 {
		t.Fatal("no encrypted values were verified; decryption acceptance remains incomplete")
	}
	t.Logf("decryption_ok=true encrypted_values=%d", decrypted)
}
