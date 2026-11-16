package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublicInspirationCoverCacheDelivery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: "inspiration_feed", ValueJSON: `{"enabled":false}`}).Error; err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close() })
	previousRuntime := runtimeService
	runtimeService = svc
	t.Cleanup(func() { runtimeService = previousRuntime })
	router := gin.New()
	RegisterInspirationFeedRoutes(router.Group("/api"), svc)

	// Seed an existing disk cache entry; the public route must serve it without
	// authentication or any network access, including conditional/range requests.
	registry, err := os.ReadFile("../inspirations/cover_sources.json")
	if err != nil {
		t.Fatal(err)
	}
	var sources map[string]string
	if err := json.Unmarshal(registry, &sources); err != nil {
		t.Fatal(err)
	}
	var id, source string
	for id, source = range sources {
		break
	}
	if id == "" {
		t.Fatal("empty source registry")
	}
	var raw bytes.Buffer
	if err := png.Encode(&raw, image.NewRGBA(image.Rect(0, 0, 24, 24))); err != nil {
		t.Fatal(err)
	}
	key := sha256.Sum256([]byte("w960-q85-v1\n" + source))
	cacheDir := filepath.Join(dir, "cache", "inspiration-covers")
	if err := os.MkdirAll(cacheDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, hex.EncodeToString(key[:])+".cover"), raw.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	request := func(id string, headers map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/public/inspirations/covers/"+url.PathEscape(id), nil)
		for name, value := range headers {
			req.Header.Set(name, value)
		}
		result := httptest.NewRecorder()
		router.ServeHTTP(result, req)
		return result
	}
	first := request(id, nil)
	if first.Code != http.StatusOK || !bytes.Equal(first.Body.Bytes(), raw.Bytes()) || first.Header().Get("Content-Type") != "image/png" || first.Header().Get("Cache-Control") != "public, max-age=3600" || first.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unexpected cached response: %d %v", first.Code, first.Header())
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	conditional := request(id, map[string]string{"If-None-Match": etag})
	if conditional.Code != http.StatusNotModified || conditional.Body.Len() != 0 {
		t.Fatalf("conditional request: %d", conditional.Code)
	}
	partial := request(id, map[string]string{"Range": "bytes=0-7"})
	if partial.Code != http.StatusPartialContent || !bytes.Equal(partial.Body.Bytes(), raw.Bytes()[:8]) {
		t.Fatalf("range request: %d", partial.Code)
	}
	missing := request("seedance:unregistered-cover", nil)
	if missing.Code != http.StatusNotFound || missing.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unregistered cover: %d", missing.Code)
	}
}
