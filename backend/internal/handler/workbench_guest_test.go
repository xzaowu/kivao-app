package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/app"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWorkbenchGuestCatalogRespectsFeatureAndAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.WorkbenchTool{}, &model.WorkbenchPreset{}); err != nil {
		t.Fatal(err)
	}
	setting := model.SystemSetting{Key: "feature_availability", ValueJSON: `{"imageWorkbenchEnabled":true,"videoWorkbenchEnabled":true}`, UpdatedBy: "private-admin"}
	if err := db.Create(&setting).Error; err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"image", "video"} {
		for _, enabled := range []bool{false, true} {
			id := kind + "-hidden"
			if enabled {
				id = kind + "-public"
			}
			if err := db.Create(&model.WorkbenchTool{ID: id, Name: id, Kind: kind, Enabled: enabled}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.WorkbenchPreset{ID: id, ToolID: kind + "-public", Name: id, PromptTemplate: id, Enabled: enabled}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	router := gin.New()
	svc := app.New(repository.New(db), t.TempDir())
	api := router.Group("/api")
	RegisterFeatureAvailabilityRoutes(api, svc)
	RegisterWorkbenchRoutes(api, svc)
	request := func(method, path string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRecorder()
		router.ServeHTTP(r, httptest.NewRequest(method, path, strings.NewReader(`{}`)))
		return r
	}
	r := request(http.MethodGet, "/api/features")
	var flags struct {
		Data struct {
			Features map[string]any `json:"features"`
		} `json:"data"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &flags); err != nil {
		t.Fatal(err)
	}
	if r.Code != http.StatusOK || flags.Data.Features["imageWorkbenchEnabled"] != true || flags.Data.Features["videoWorkbenchEnabled"] != true {
		t.Fatalf("guest feature flags status=%d", r.Code)
	}
	for _, field := range []string{"updatedBy", "updatedAt"} {
		if _, present := flags.Data.Features[field]; present {
			t.Fatalf("public feature flags expose administration metadata: %s", field)
		}
	}
	for _, kind := range []string{"image", "video"} {
		r := request(http.MethodGet, "/api/workbench/tools?kind="+kind)
		var result struct {
			Code int `json:"code"`
			Data struct {
				DefaultExamples *app.WorkbenchExampleView `json:"defaultExamples"`
				Tools           []struct {
					ID      string                  `json:"id"`
					Presets []model.WorkbenchPreset `json:"presets"`
				} `json:"tools"`
			} `json:"data"`
		}
		if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if r.Code != http.StatusOK || result.Code != 0 || len(result.Data.Tools) != 1 || result.Data.Tools[0].ID != kind+"-public" || len(result.Data.Tools[0].Presets) != 1 || result.Data.Tools[0].Presets[0].ID != kind+"-public" {
			t.Fatalf("guest %s catalog did not filter disabled tools and presets: status=%d", kind, r.Code)
		}
		if result.Data.DefaultExamples == nil || len(result.Data.DefaultExamples.Items) != 0 {
			t.Fatal("guest default example projection missing")
		}
	}
	for _, path := range []string{"/api/workbench/tasks?kind=image", "/api/admin/workbench/tools", "/api/admin/settings/features"} {
		if r := request(http.MethodGet, path); r.Code != http.StatusUnauthorized {
			t.Fatalf("guest GET %s status=%d, want 401", path, r.Code)
		}
	}
	if r := request(http.MethodPost, "/api/workbench/tasks"); r.Code != http.StatusUnauthorized {
		t.Fatalf("guest task creation status=%d, want 401", r.Code)
	}
	if r := request(http.MethodPut, "/api/admin/workbench/examples/image"); r.Code != http.StatusUnauthorized {
		t.Fatal("guest default example write accepted")
	}
	if err := db.Model(&setting).Update("value_json", `{"imageWorkbenchEnabled":false,"videoWorkbenchEnabled":false}`).Error; err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"image", "video"} {
		if r := request(http.MethodGet, "/api/workbench/tools?kind="+kind); r.Code != http.StatusForbidden {
			t.Fatalf("disabled %s catalog status=%d, want 403", kind, r.Code)
		}
	}
}
