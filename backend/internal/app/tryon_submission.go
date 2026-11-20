package app

import (
	"errors"
	"strconv"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/workbench"
)

const tryOnPlanningSlot = "$planning"

func tryOnTaskIdentity(userID string, req CreateTaskRequest, input map[string]any) (*model.TryOnTaskReceipt, error) {
	meta, _ := input["metadata"].(map[string]any)
	if meta["source"] == "ecommerce-tryon" {
		id := stringValue(meta["tryonBatchId"])
		fn := tryOnFunctionFromBatchID(id)
		if fn == "" || fn != meta["tryonFunction"] || meta["stage"] != "tryon-planning" || req.Type != "canvas_text" || input["mode"] != "text" || isTextReplayTaskRequest(input) {
			return nil, BadAuthRequest("换装策划任务与批次不匹配")
		}
		return &model.TryOnTaskReceipt{UserID: userID, BatchID: id, SlotKey: tryOnPlanningSlot}, nil
	}
	wb, _ := meta["workbench"].(map[string]any)
	batch, _ := wb["batch"].(map[string]any)
	id := stringValue(batch["id"])
	if tryOnFunctionFromBatchID(id) == "" {
		return nil, nil
	}
	index, count := intValue(batch["index"]), intValue(batch["count"])
	if req.workbenchKind != WorkbenchKindImage || !workbench.ValidTaskBatch(id, index, count) {
		return nil, BadAuthRequest("换装图片必须由图片工作台提交")
	}
	slot := stringValue(batch["slotKey"])
	if slot == "" {
		slot = "$index-" + strconv.Itoa(index)
	}
	return &model.TryOnTaskReceipt{UserID: userID, BatchID: id, SlotKey: slot}, nil
}

func tryOnSubmissionError(err error) error {
	if errors.Is(err, repository.ErrTryOnBatchDeleted) {
		return &AppError{Status: 409, Code: 409, Reason: "tryon_batch_deleted", Message: err.Error()}
	}
	if errors.Is(err, repository.ErrTryOnTaskRemoved) {
		return &AppError{Status: 409, Code: 409, Reason: "tryon_task_removed", Message: err.Error()}
	}
	return err
}

func (s *Service) createTryOnTask(receipt model.TryOnTaskReceipt, task *model.Task, order *model.BillingOrder, policy RuntimePolicySetting) (*model.Task, error) {
	var replay *model.Task
	s.storageMu.Lock()
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		if _, err := repo.LockTryOnBatch(receipt.UserID, receipt.BatchID); err != nil {
			return err
		}
		var err error
		replay, err = repo.TryOnSubmittedTask(receipt)
		if replay != nil || err != nil {
			return err
		}
		if err := createTaskWithStorageQuotaRepository(repo, task, order, policy); err != nil {
			return err
		}
		receipt.TaskID = task.ID
		return repo.SaveTryOnReceipt(receipt)
	})
	s.storageMu.Unlock()
	if err != nil {
		return nil, tryOnSubmissionError(err)
	}
	if replay == nil {
		s.wakeTaskDispatcher()
	}
	return replay, nil
}
