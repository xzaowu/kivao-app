package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/app"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestInspirationShowcaseRoutesRangeAndAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:inspiration-showcase-range?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "resources"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "resources", "fixture.mp4"), []byte("video-data"), 0640); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "fixture-video", UserID: "admin", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "fixture.mp4", MimeType: "video/mp4", Size: 10}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	value := app.InspirationShowcase{InspirationID: "original:sample", Title: "测试灵感", Enabled: true, Examples: []app.InspirationExample{{ResourceID: resource.ID, Type: "video"}}}
	if _, err := svc.SaveInspirationShowcase(admin, value); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterInspirationFeedRoutes(router.Group("/api"), svc)
	request := httptest.NewRequest(http.MethodGet, "/api/public/inspirations/showcases/media/fixture-video", nil)
	request.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, request)
	if rec.Code != 206 || rec.Body.String() != "vide" || rec.Header().Get("Content-Range") != "bytes 0-3/10" {
		t.Fatalf("range response: %d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}
	for _, endpoint := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/settings/inspiration-showcases"},
		{http.MethodPut, "/api/admin/settings/inspiration-showcases"},
		{http.MethodGet, "/api/admin/settings/inspiration-showcases/media/fixture-video"},
		{http.MethodPost, "/api/admin/settings/inspiration-showcases/assets/image"},
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(endpoint.method, endpoint.path, nil))
		if rec.Code != 401 {
			t.Fatalf("anonymous admin endpoint %s: %d", endpoint.path, rec.Code)
		}
	}
	value.Enabled = false
	if _, err := svc.SaveInspirationShowcase(admin, value); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, request)
	if rec.Code != 404 {
		t.Fatalf("disabled media status: %d", rec.Code)
	}
}
