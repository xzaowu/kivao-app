package handler

import (
	"bytes"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestResourceThumbnailHTTPResizesAndRevalidates(t *testing.T) {
	router, db := skillAuthorizationFixture(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	svc := service.New(repository.New(db), dataDir)
	t.Cleanup(func() { _ = svc.Close() })
	RegisterUserDataRoutes(router.Group("/api"), svc)

	original := image.NewNRGBA(image.Rect(0, 0, 1400, 1000))
	for i := range original.Pix {
		original.Pix[i] = byte((i / 4) * (i / 251))
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, original); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "large-local-image", UserID: "skill-member", Provider: "local", Kind: "image",
		Status: model.ResourceStatusReady, ObjectKey: "large.png", MimeType: "image/png",
		Size: int64(encoded.Len()), Width: 1400, Height: 1000,
	}
	resourceDir := filepath.Join(dataDir, "resources")
	if err := os.MkdirAll(resourceDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resourceDir, resource.ObjectKey), encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}

	path := "/api/resources/large-local-image/file?variant=thumbnail"
	describe := skillAuthorizationRequest(router, http.MethodGet, path+"&access=1", "skill-member", nil)
	for _, field := range []string{`"actualVariant":"thumbnail"`, `"originalWidth":1400`, `"originalHeight":1000`} {
		if describe.Code != http.StatusOK || !strings.Contains(describe.Body.String(), field) {
			t.Fatalf("thumbnail metadata: %d %s", describe.Code, describe.Body.String())
		}
	}
	thumb := skillAuthorizationRequest(router, http.MethodGet, path, "skill-member", nil)
	if thumb.Code != http.StatusOK || thumb.Header().Get("Cache-Control") != "private, no-cache" || thumb.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("thumbnail response: %d %v", thumb.Code, thumb.Header())
	}
	etag := thumb.Header().Get("ETag")
	config, _, err := image.DecodeConfig(bytes.NewReader(thumb.Body.Bytes()))
	if err != nil || config.Width > 960 || config.Height >= 1000 || thumb.Body.Len() >= encoded.Len() || etag == "" {
		t.Fatalf("thumbnail not reduced: %+v, bytes=%d, etag=%q, err=%v", config, thumb.Body.Len(), etag, err)
	}
	t.Logf("synthetic image: %d bytes → %d bytes", encoded.Len(), thumb.Body.Len())

	conditionalGet := func(actor, validator string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("If-None-Match", validator)
		if actor != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: actor + ".skill-access-token"})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	for _, check := range []struct {
		actor string
		code  int
	}{
		{"skill-member", http.StatusNotModified},
		{"skill-admin", http.StatusNotFound},
		{"", http.StatusUnauthorized},
	} {
		response := conditionalGet(check.actor, etag)
		if response.Code != check.code || (check.code == http.StatusNotModified && response.Body.Len() != 0) {
			t.Fatalf("conditional request for %q: %d, bytes=%d", check.actor, response.Code, response.Body.Len())
		}
	}
	download := skillAuthorizationRequest(router, http.MethodGet, path+"&purpose=download", "skill-member", nil)
	if download.Code != http.StatusOK || !bytes.Equal(download.Body.Bytes(), encoded.Bytes()) {
		t.Fatalf("download changed original: %d bytes=%d", download.Code, download.Body.Len())
	}

	// An image whose stored dimensions no longer match must use the original.
	if err := db.Model(&resource).Update("width", 1401).Error; err != nil {
		t.Fatal(err)
	}
	fallback := conditionalGet("skill-member", etag)
	fallbackETag := fallback.Header().Get("ETag")
	if fallback.Code != http.StatusOK || fallbackETag == "" || fallbackETag == etag || !bytes.Equal(fallback.Body.Bytes(), encoded.Bytes()) {
		t.Fatalf("fallback response: %d, etag=%q, bytes=%d", fallback.Code, fallbackETag, fallback.Body.Len())
	}
	if response := conditionalGet("skill-member", fallbackETag); response.Code != http.StatusNotModified || response.Body.Len() != 0 {
		t.Fatalf("conditional fallback: %d, bytes=%d", response.Code, response.Body.Len())
	}
}

func TestServeResourceDeliveryRedirectsCloudMediaWithoutWritingBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, &service.ResourceDelivery{Access: &assets.ResourceAccess{
			ResourceID: "resource-1",
			URL:        "https://cdn.example.com/users/user-1/image/test.png?signature=redacted",
			Delivery:   assets.DeliveryCDN,
		}}, "private, no-cache", "")
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/resource", nil))

	if recorder.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want 307", recorder.Code)
	}
	if got := recorder.Header().Get("Location"); got != "https://cdn.example.com/users/user-1/image/test.png?signature=redacted" {
		t.Fatalf("location = %q", got)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("redirect wrote %d body bytes; platform must not send cloud media", recorder.Body.Len())
	}
}

func TestServeResourceDeliveryReturnsAccessDescriptorWithoutRedirect(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, &service.ResourceDelivery{Access: &assets.ResourceAccess{
			ResourceID: "resource-1",
			URL:        "https://cdn.example.com/test.png",
			Delivery:   assets.DeliveryCDN,
		}}, "private, no-cache", "")
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/resource?access=1", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("cache-control = %q", got)
	}
	if !strings.Contains(recorder.Body.String(), `"url":"https://cdn.example.com/test.png"`) {
		t.Fatalf("access descriptor missing from body: %s", recorder.Body.String())
	}
}

func TestServeResourceDeliveryStreamsPlatformBytesAndRangeMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resource := &model.Resource{ID: "resource-1", MimeType: "video/mp4", UpdatedAt: time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)}
	router := gin.New()
	router.GET("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, &service.ResourceDelivery{
			Resource: resource,
			Access:   &assets.ResourceAccess{ResourceID: resource.ID, URL: "/api/resources/resource-1/file", Delivery: assets.DeliveryProxy},
			Stream:   &assets.ResourceStream{Resource: resource, Body: io.NopCloser(strings.NewReader("partial-media")), StatusCode: http.StatusPartialContent, ContentLength: 13, ContentRange: "bytes 10-22/100", AcceptRanges: "bytes"},
		}, "private, no-cache", `inline; filename="video.mp4"`)
	})

	recorder := httptest.NewRecorder()
	recorder.HeaderMap = make(http.Header)
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/resource", nil))

	if recorder.Code != http.StatusPartialContent || recorder.Body.String() != "partial-media" {
		t.Fatalf("response = status %d body %q", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Content-Range") != "bytes 10-22/100" || recorder.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("range headers missing: %#v", recorder.Header())
	}
	if recorder.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("content-type = %q", recorder.Header().Get("Content-Type"))
	}
	if recorder.Header().Get("Content-Disposition") != `inline; filename="video.mp4"` {
		t.Fatalf("content-disposition = %q", recorder.Header().Get("Content-Disposition"))
	}
}
