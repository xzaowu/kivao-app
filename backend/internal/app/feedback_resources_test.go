package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestFeedbackAttachmentsSurviveCleanupAndAdminDeletion(t *testing.T) {
	for _, kind := range []string{"image", "video"} {
		t.Run(kind, func(t *testing.T) {
			svc, db, dataDir, admin := newAdminStorageDeleteTestService(t)
			old := time.Now().Add(-48 * time.Hour)
			resource := model.Resource{ID: "feedback-file", UserID: "user-1", Kind: kind, Status: model.ResourceStatusReady,
				Provider: "local", ObjectKey: "users/user-1/feedback/file", CreatedAt: old, UpdatedAt: old}
			orphan := model.Resource{ID: "unrelated-orphan", UserID: resource.UserID, Status: model.ResourceStatusReady, CreatedAt: old, UpdatedAt: old}
			if err := db.Create(&[]model.Resource{resource, orphan}).Error; err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
			if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, []byte("local feedback fixture"), 0o600); err != nil {
				t.Fatal(err)
			}
			attachments, err := json.Marshal([]model.FeedbackAttachment{{ID: resource.ID, Name: "attachment", Type: kind, URL: "/api/resources/" + resource.ID + "/file"}})
			if err != nil {
				t.Fatal(err)
			}
			feedback, err := svc.SubmitFeedback(&model.User{ID: resource.UserID, Username: "fixture"}, SubmitFeedbackRequest{
				Title: "附件保留", Content: "本地测试", Attachments: string(attachments),
			})
			if err != nil {
				t.Fatal(err)
			}
			if kind == "video" {
				if err := db.Model(feedback).Update("archived", true).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := svc.cleanupDetachedUserResources(resource.UserID, []model.Resource{resource, orphan}); err != nil {
				t.Fatal(err)
			}
			assertModelCount(t, db, &model.Resource{}, "id = ?", 1, resource.ID)
			assertModelCount(t, db, &model.Resource{}, "id = ?", 0, orphan.ID)
			result, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{resource.ID}})
			if err != nil || len(result.Deleted) != 0 || len(result.Blocked) != 1 || len(result.Blocked[0].References) != 1 || result.Blocked[0].References[0].Kind != repository.FeedbackResourceReferenceKind {
				t.Fatalf("feedback must block admin deletion: result=%+v err=%v", result, err)
			}
			// 直接检查删除事务，模拟引用快照读取后才提交反馈的竞态。
			if err := svc.repo.DeleteDetachedResources([]model.Resource{resource}, nil); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
				t.Fatalf("transaction must retain attachment: %v", err)
			}
			assertModelCount(t, db, &model.ResourceDeletionJob{}, "resource_id = ?", 0, resource.ID)
			if _, err := os.Stat(file); err != nil {
				t.Fatalf("attachment file removed: %v", err)
			}
			if err := svc.repo.DeleteFeedback(feedback.ID); err != nil {
				t.Fatal(err)
			}
			if err := svc.cleanupDetachedUserResources(resource.UserID, []model.Resource{resource}); err != nil {
				t.Fatal(err)
			}
			assertModelCount(t, db, &model.Resource{}, "id = ?", 0, resource.ID)
		})
	}
}
