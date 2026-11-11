package app

import (
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestTaskTypeProducesStoredFile(t *testing.T) {
	for _, taskType := range []string{"canvas_image", "canvas_video", "canvas_audio", "video_generate"} {
		if !taskTypeProducesStoredFile(taskType) {
			t.Fatalf("taskTypeProducesStoredFile(%q) = false", taskType)
		}
	}
	for _, taskType := range []string{"text", "canvas_text"} {
		if taskTypeProducesStoredFile(taskType) {
			t.Fatalf("taskTypeProducesStoredFile(%q) = true", taskType)
		}
	}
}

func TestValidateStoredFileCapacityRejectsFullAccount(t *testing.T) {
	limit := gigabytes(defaultRuntimePolicy().Resource.StoredFileGB)
	for _, test := range []struct {
		name    string
		stored  int64
		pending int64
	}{
		{name: "stored files fill capacity", stored: limit},
		{name: "pending upload fills capacity", stored: limit - 1, pending: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateStoredFileCapacity(test.stored, test.pending, limit)
			if err == nil || !strings.Contains(err.Error(), "账号文件容量已达到") {
				t.Fatalf("validateStoredFileCapacity() error = %v", err)
			}
		})
	}
}

func TestValidateStoredFileCapacityAllowsRemainingSpace(t *testing.T) {
	limit := gigabytes(defaultRuntimePolicy().Resource.StoredFileGB)
	if err := validateStoredFileCapacity(limit-2, 1, limit); err != nil {
		t.Fatalf("validateStoredFileCapacity() error = %v", err)
	}
}

func TestStoredFileAdmissionChecksAssetQuotas(t *testing.T) {
	for _, test := range []struct {
		name      string
		configure func(*RuntimePolicySetting)
		payload   string
		wantErr   string
	}{
		{name: "asset count full", configure: func(policy *RuntimePolicySetting) { policy.Resource.AssetCount = 1 }, wantErr: "账号素材数量已达到"},
		{name: "structured data full", configure: func(policy *RuntimePolicySetting) { policy.Resource.StructuredDataMB = 1 }, payload: strings.Repeat("x", int(megabytes(1))+1), wantErr: "账号画布和素材数据已达到"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := newMediaRecoveryTestService(t)
			policy := defaultRuntimePolicy()
			test.configure(&policy)
			if err := db.Create(&model.Asset{ID: "asset-admission", UserID: "asset-user", PayloadJSON: test.payload}).Error; err != nil {
				t.Fatal(err)
			}
			if err := svc.requireStoredFileCapacityForTask("asset-user", "canvas_image", policy); err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("media admission error = %v, want %q", err, test.wantErr)
			}
			if err := svc.requireStoredFileCapacityForTask("other-user", "canvas_image", policy); err != nil {
				t.Fatalf("another account inherited the quota: %v", err)
			}
			if err := svc.requireStoredFileCapacityForTask("asset-user", "text", policy); err != nil {
				t.Fatalf("file quotas blocked a text task: %v", err)
			}
		})
	}
}

func TestStoredFileAdmissionChecksDailyQuotaWithoutReservingWorstCase(t *testing.T) {
	for _, taskType := range []string{"canvas_image", "canvas_video", "canvas_audio", "video_generate"} {
		t.Run(taskType, func(t *testing.T) {
			svc, db := newMediaRecoveryTestService(t)
			policy := defaultRuntimePolicy()
			day := time.Now().UTC().Format("2006-01-02")
			limit := megabytes(policy.Resource.DailyUploadMB)
			usage := model.UserDailyUploadUsage{ID: "daily-user:" + day, UserID: "daily-user", Day: day, Bytes: limit}
			if err := db.Create(&usage).Error; err != nil {
				t.Fatal(err)
			}
			if err := svc.requireStoredFileCapacityForTask(usage.UserID, taskType, policy); err == nil || !strings.Contains(err.Error(), "自然日上传") {
				t.Fatalf("daily quota full was not rejected: %v", err)
			}
			if err := svc.requireStoredFileCapacityForTask(usage.UserID, "text", policy); err != nil {
				t.Fatalf("daily file quota blocked a text task: %v", err)
			}
			if err := db.Model(&usage).Update("bytes", limit-1).Error; err != nil {
				t.Fatal(err)
			}
			if err := svc.requireStoredFileCapacityForTask(usage.UserID, taskType, policy); err != nil {
				t.Fatalf("admission reserved a worst-case file instead of checking available quota: %v", err)
			}
			remaining, err := svc.repo.DailyUploadBytes(usage.UserID, day)
			if err != nil || remaining != limit-1 {
				t.Fatalf("read-only admission changed upload quota: %d %v", remaining, err)
			}
		})
	}
}
