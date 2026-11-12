package handler

import (
	"net/http"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestCommerceStudioDownloadHTTPRequiresOwnerBeforeSendingBytes(t *testing.T) {
	router, db, dir := newGitHubSkillHTTPTest(t)
	if err := db.AutoMigrate(&model.Resource{}); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close() })
	RegisterCommerceStudioRoutes(router.Group("/api"), svc)
	githubSkillHTTPRequest(t, router, http.MethodGet, "/api/ecommerce-agent/download?resourceId=foreign", "", false, http.StatusUnauthorized)
	githubSkillHTTPRequest(t, router, http.MethodPost, "/api/ecommerce-agent/download", "", false, http.StatusUnauthorized)
	foreign := model.Resource{ID: "foreign", UserID: "someone-else", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	githubSkillHTTPRequest(t, router, http.MethodGet, "/api/ecommerce-agent/download?resourceId=foreign", "", true, http.StatusNotFound)
	githubSkillHTTPRequest(t, router, http.MethodGet, "/api/ecommerce-agent/download", "", true, http.StatusBadRequest)
}
