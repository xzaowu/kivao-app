package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMissingOSSSettingsReturnNormalizedDefaults(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}

	platformSetting, err := svc.AdminOSSSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	assertDefaultOSSSetting(t, platformSetting, defaultOSSPathPrefix)

	userSetting, err := svc.UserOSSSetting(&model.User{ID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	assertDefaultOSSSetting(t, userSetting, defaultUserOSSPathPrefix)
}

func assertDefaultOSSSetting(t *testing.T, value *PublicOSSSetting, prefix string) {
	t.Helper()
	if value.Provider != aliyunOSSProvider || value.PathPrefix != prefix || value.S3Preset != "custom" {
		t.Fatalf("default OSS setting = %+v", value)
	}
}

func TestUserOSSDefaultPrefixPreservesSavedPaths(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	actor := &model.User{ID: "prefix-user"}
	for _, prefix := range []string{"", "open-ai-canvas", "my-assets", "/"} {
		value, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Provider: "aliyun", PathPrefix: prefix})
		if err != nil {
			t.Fatal(err)
		}
		want := prefix
		if prefix == "" || prefix == "/" {
			want = defaultUserOSSPathPrefix
		}
		if value.PathPrefix != want {
			t.Fatalf("saved prefix=%q want=%q", value.PathPrefix, want)
		}
		read, err := svc.UserOSSSetting(actor)
		if err != nil || read.PathPrefix != want {
			t.Fatalf("read prefix=%v err=%v", read.PathPrefix, err)
		}
	}
}
