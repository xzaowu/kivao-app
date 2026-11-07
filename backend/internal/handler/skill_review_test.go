package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestSkillReviewHTTPPermissionsAndVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserIdentity{}, &model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	for id, role := range map[string]model.UserRole{"owner": model.UserRoleUser, "reader": model.UserRoleUser, "admin": model.UserRoleAdmin} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("review-test"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	skill, err := svc.CreateSkill("owner", service.SkillMutationRequest{SkillName: "待审核技能", Description: "仅用于测试", Instruction: "# 技能正文", Tag: "creative"})
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterSkillRoutes(router.Group("/api"), svc)
	send := func(user, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if user != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".review-test"})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	body, _ := json.Marshal(map[string]any{"action": "approve", "versionId": skill.VersionID, "updatedAt": skill.UpdatedAt})
	path := "/api/admin/skills/" + skill.SkillID + "/review"
	for user, want := range map[string]int{"": 401, "owner": 403, "reader": 403} {
		if out := send(user, "PUT", path, string(body)); out.Code != want {
			t.Fatalf("%q approval status=%d want=%d", user, out.Code, want)
		}
		if out := send(user, "GET", "/api/admin/skills", ""); out.Code != want {
			t.Fatalf("%q list status=%d want=%d", user, out.Code, want)
		}
	}
	for _, path := range []string{"/api/skills/" + skill.SkillID, "/api/skills/" + skill.SkillID + "/file/raw?path=SKILL.md"} {
		if out := send("reader", "GET", path, ""); out.Code != 403 {
			t.Fatalf("unreviewed read status=%d", out.Code)
		}
		if out := send("admin", "GET", path, ""); out.Code != 200 {
			t.Fatalf("review read status=%d", out.Code)
		}
	}
	if out := send("admin", "PUT", path, string(body)); out.Code != 200 {
		t.Fatalf("approval status=%d %s", out.Code, out.Body.String())
	}
	if out := send("reader", "GET", "/api/skills/"+skill.SkillID, ""); out.Code != 200 {
		t.Fatalf("published read status=%d", out.Code)
	}
	if out := send("admin", "PUT", path, string(body)); out.Code != 409 {
		t.Fatalf("stale review status=%d", out.Code)
	}
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("file", "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("# 上传技能\n\n新上传内容。")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/api/skills/install", &upload)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "owner.review-test"})
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	var response struct {
		Data struct {
			Skill service.SkillItem `json:"skill"`
		} `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if out.Code != 200 || response.Data.Skill.Status != model.SkillStatusPending {
		t.Fatalf("upload skipped review: status=%d state=%d", out.Code, response.Data.Skill.Status)
	}
	created := send("owner", "POST", "/api/skills", `{"skillName":"伪造审核状态","description":"测试","instruction":"# 正文","tag":"creative","isPrivate":false,"status":1,"source":3,"sourceType":"builtin"}`)
	if err := json.Unmarshal(created.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if created.Code != 200 || response.Data.Skill.Status != model.SkillStatusPending || response.Data.Skill.SourceType == "builtin" {
		t.Fatalf("creation trusted client moderation fields: status=%d state=%d", created.Code, response.Data.Skill.Status)
	}
}
