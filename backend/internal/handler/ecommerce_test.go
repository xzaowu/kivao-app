package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestEcommerceHTTPAuthenticationAdminAndStrictBodies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	sql.SetMaxOpenConns(1)
	defer sql.Close()
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{&model.User{ID: "user", Username: "test", Role: model.UserRoleUser, Status: model.UserStatusActive}, &model.AuthSession{ID: "session", UserID: "user", TokenHash: auth.HashToken("local-test-only"), ExpiresAt: time.Now().Add(time.Hour)}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	svc := service.New(repository.New(db), t.TempDir())
	RegisterEcommerceRoutes(router.Group("/api"), svc)
	for _, tc := range []struct {
		method, path, body string
		login              bool
		status             int
	}{
		{"GET", "/ecommerce/status", "", false, 401}, {"GET", "/ecommerce/projects", "", false, 401}, {"POST", "/ecommerce/projects", "{}", false, 401},
		{"GET", "/ecommerce/status", "", true, 200}, {"GET", "/ecommerce/projects/foreign", "", true, 404}, {"GET", "/admin/ecommerce/settings", "", true, 403}, {"PUT", "/admin/ecommerce/settings", "{}", true, 403},
		{"POST", "/ecommerce/projects", `{"id":"x","draft":{},"apiKey":"blocked"}`, true, 400}, {"POST", "/ecommerce/projects", `{} {}`, true, 400},
		{"GET", "/ecommerce/projects?page=0", "", true, 400}, {"GET", "/ecommerce/projects?page=501", "", true, 400},
	} {
		req := httptest.NewRequest(tc.method, "/api"+tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		if tc.login {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.local-test-only"})
		}
		result := httptest.NewRecorder()
		router.ServeHTTP(result, req)
		if result.Code != tc.status {
			t.Fatalf("%s %s status=%d want=%d", tc.method, tc.path, result.Code, tc.status)
		}
		if tc.path == "/ecommerce/status" && tc.login && result.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("personal response cacheable")
		}
	}
}
