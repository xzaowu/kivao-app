package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

func workbenchBatchIdentity(userID string, req WorkbenchTaskInput) (string, string, error) {
	if strings.TrimSpace(userID) == "" {
		return "", "", Unauthorized("请先登录")
	}
	if err := workbench.ValidateTaskBatch(req.Batch); err != nil || req.Batch == nil {
		return "", "", err
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return "", "", BadAuthRequest("批量任务输入无效")
	}
	digest := sha256.Sum256(encoded)
	key, _ := json.Marshal([]any{"kivao-workbench-batch-v1", userID, req.Kind, req.Batch.ID, req.Batch.Index})
	return uuid.NewSHA1(uuid.NameSpaceOID, key).String(), hex.EncodeToString(digest[:]), nil
}

func (s *Service) workbenchBatchTask(userID, taskID, fingerprint string) (*model.Task, error) {
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if fingerprint != "" {
		var input struct {
			Hash string `json:"workbenchRequestHash"`
		}
		if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Hash != fingerprint {
			return nil, kernel.NewAppError(409, "本批任务内容已变更，请勿使用原批次重复提交")
		}
	}
	return taskForOutput(*task), nil
}

// A missing receipt is not proof that an earlier HTTP request cannot still commit.
// Callers must retain UNKNOWN and query again rather than automatically resubmit.
func (s *Service) WorkbenchBatchTask(userID, kind, batchID string, index int) (*model.Task, error) {
	switch kind {
	case WorkbenchKindImage:
		if err := s.RequireFeature(FeatureImageWorkbench); err != nil {
			return nil, err
		}
	case WorkbenchKindVideo:
		if err := s.RequireFeature(FeatureVideoWorkbench); err != nil {
			return nil, err
		}
	default:
		return nil, BadAuthRequest("工作台类型无效")
	}
	// The lookup needs only the item identity, not the original prompt or secrets.
	taskID, _, err := workbenchBatchIdentity(userID, WorkbenchTaskInput{Kind: kind, Batch: &workbench.TaskBatch{ID: batchID, Index: index, Count: 20}})
	if err != nil {
		return nil, err
	}
	task, err := s.workbenchBatchTask(userID, taskID, "")
	if task != nil && (task.WorkbenchKind != kind || task.Type != "canvas_"+kind) {
		return nil, kernel.NewAppError(409, "批量任务身份不匹配")
	}
	return task, err
}

// Completed tasks discard execution secrets but retain the receipt fingerprint.
// It is not part of the public task input returned to clients.
func compactTaskInputJSON(raw string) string {
	public := publicTaskInputJSON(raw)
	var input struct {
		Hash string `json:"workbenchRequestHash"`
	}
	if json.Unmarshal([]byte(raw), &input) != nil || len(input.Hash) != 64 {
		return public
	}
	if _, err := hex.DecodeString(input.Hash); err != nil {
		return public
	}
	var compact map[string]any
	if json.Unmarshal([]byte(public), &compact) != nil || compact == nil {
		return public
	}
	compact["workbenchRequestHash"] = input.Hash
	encoded, _ := json.Marshal(compact)
	return string(encoded)
}
