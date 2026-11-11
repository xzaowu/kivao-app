package app

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/workbench"
)

type EcommerceModelChoice struct {
	LogicalModelID string `json:"logicalModelId,omitempty"`
	ChannelID      string `json:"channelId,omitempty"`
	Model          string `json:"model,omitempty"`
}

type EcommerceSettings struct {
	Vision   EcommerceModelChoice `json:"vision"`
	Planning EcommerceModelChoice `json:"planning"`
}

const ecommerceSettingsKey = "kivao_ecommerce_stages_v1"

func (s *Service) EcommerceSettings(actor *model.User) (*EcommerceSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.ecommerceSettings()
}

func (s *Service) ecommerceSettings() (*EcommerceSettings, error) {
	row, err := s.repo.SystemSetting(ecommerceSettingsKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &EcommerceSettings{}, nil
	}
	if err != nil {
		return nil, err
	}
	var settings EcommerceSettings
	if json.Unmarshal([]byte(row.ValueJSON), &settings) != nil {
		return nil, BadAuthRequest("商品套图阶段设置损坏")
	}
	return &settings, nil
}

func validEcommerceChoice(c EcommerceModelChoice) bool {
	if strings.TrimSpace(c.LogicalModelID) != c.LogicalModelID || strings.TrimSpace(c.ChannelID) != c.ChannelID || strings.TrimSpace(c.Model) != c.Model {
		return false
	}
	if c.LogicalModelID != "" {
		return c.ChannelID == "" && c.Model == "" && len(c.LogicalModelID) <= 80
	}
	return c.ChannelID != "" && c.Model != "" && len(c.ChannelID) <= 80 && len(c.Model) <= 160
}

func (s *Service) SaveEcommerceSettings(actor *model.User, settings EcommerceSettings) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	for _, choice := range []EcommerceModelChoice{settings.Vision, settings.Planning} {
		if !validEcommerceChoice(choice) {
			return BadAuthRequest("请选择两个阶段各自的文本模型")
		}
		if choice.LogicalModelID == "" {
			if _, err := s.repo.SystemChannel(choice.ChannelID); err != nil {
				return BadAuthRequest("请选择平台模型")
			}
		}
		intent := ModelRequestIntent{Capability: "text", Inputs: map[string]int{"image": 1}}
		var err error
		if choice.LogicalModelID != "" {
			_, err = s.QuoteLogicalModel(actor.ID, choice.LogicalModelID, intent)
		} else {
			_, err = s.QuoteChannelModel(actor.ID, ChannelModelQuoteRequest{ChannelID: choice.ChannelID, ModelKey: choice.Model, Intent: intent})
		}
		if err != nil {
			return err
		}
	}
	encoded, _ := json.Marshal(settings)
	return s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.SaveSystemSetting(&model.SystemSetting{Key: ecommerceSettingsKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}); err != nil {
			return err
		}
		event, err := newAdminAuditEvent(actor, "ecommerce.stages", "system_setting", ecommerceSettingsKey, "保存商品套图阶段模型", map[string]any{"stages": 2})
		if err != nil {
			return err
		}
		return tx.AppendAdminAudit(event)
	})
}

func (s *Service) EcommerceConfigured() (bool, error) {
	settings, err := s.ecommerceSettings()
	if err != nil {
		return false, err
	}
	return validEcommerceChoice(settings.Vision) && validEcommerceChoice(settings.Planning), nil
}

type EcommerceTaskRequest struct {
	Revision        int64                `json:"revision"`
	RequestID       string               `json:"requestId"`
	Stage           string               `json:"stage"`
	ImageID         string               `json:"imageId,omitempty"`
	Model           EcommerceModelChoice `json:"model,omitempty"`
	Size            string               `json:"size,omitempty"`
	Quality         string               `json:"quality,omitempty"`
	ImageResolution string               `json:"imageResolution,omitempty"`
	QuoteHash       string               `json:"quoteHash,omitempty"`
	MaxCharge       int64                `json:"maxCharge"`
	QuoteExpiresAt  time.Time            `json:"quoteExpiresAt,omitempty"`
}

func ecommerceTaskID(userID, projectID, requestID string) (string, error) {
	if userID == "" || !ecommerceUUID(projectID) || !ecommerceUUID(requestID) {
		return "", BadAuthRequest("缺少有效的商品任务标识")
	}
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("kivao-ecommerce-v1:"+userID+":"+projectID+":"+requestID)).String(), nil
}

func (s *Service) EcommerceReceipt(userID, projectID, requestID string) (*model.Task, error) {
	if _, err := s.ecommerceProject(userID, projectID, false); err != nil {
		return nil, err
	}
	id, err := ecommerceTaskID(userID, projectID, requestID)
	if err != nil {
		return nil, err
	}
	task, err := s.repo.TaskForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.Task(userID, task.ID)
}

type ecommercePrepared struct {
	project     *model.EcommerceProject
	state       ecommerce.State
	task        *model.Task
	order       *model.BillingOrder
	quote       CreationQuote
	requestHash string
}

func (s *Service) prepareEcommerceTask(userID, projectID string, req EcommerceTaskRequest) (*ecommercePrepared, error) {
	id, err := ecommerceTaskID(userID, projectID, req.RequestID)
	if err != nil {
		return nil, err
	}
	project, err := s.ecommerceProject(userID, projectID, true)
	if err != nil {
		return nil, err
	}
	if project.Revision != req.Revision {
		return nil, ecommerceError(repository.ErrEcommerceConflict)
	}
	draft, state, err := ecommerceDecode(project)
	if err != nil {
		return nil, err
	}
	if err := s.ecommerceDraft(userID, draft); err != nil {
		return nil, err
	}
	choice := req.Model
	operation, kind := "text", "text"
	prompt := ""
	var input map[string]any
	var prior string
	if req.Stage == "vision" || req.Stage == "planning" {
		settings, e := s.ecommerceSettings()
		if e != nil {
			return nil, e
		}
		choice = settings.Vision
		prior = state.VisionTaskID
		if req.Stage == "planning" {
			choice = settings.Planning
			prior = state.PlanningTaskID
			if state.Direction() == nil || state.VisionApplied == "" {
				return nil, BadAuthRequest("请先完成商品识别并选择视觉方向")
			}
		}
		if !validEcommerceChoice(choice) {
			return nil, BadAuthRequest("请管理员配置商品套图阶段模型")
		}
		prompt = ecommerce.Prompt(req.Stage, draft, state.Directions, state.Direction())
		refs := []map[string]any{}
		for _, ref := range draft.References {
			refs = append(refs, map[string]any{"id": ref.ResourceID, "resourceId": ref.ResourceID, "storageKey": "resource:" + ref.ResourceID})
		}
		input = map[string]any{"mode": "text", "prompt": prompt, "config": map[string]any{"mode": "text", "channelId": choice.ChannelID, "model": choice.Model}, "referenceImages": refs}
	} else if req.Stage == "image" {
		if err := s.RequireFeature(FeatureImageWorkbench); err != nil {
			return nil, err
		}
		kind, operation = "image", "image"
		var image *ecommerce.Image
		if state.Plan != nil {
			for i := range state.Plan.Images {
				if state.Plan.Images[i].ID == req.ImageID {
					image = &state.Plan.Images[i]
				}
			}
		}
		if image == nil {
			return nil, BadAuthRequest("请先确认整套策划")
		}
		if len(image.PreviousTaskIDs) >= 8 {
			return nil, BadAuthRequest("本张修改次数已达上限，请新建一轮")
		}
		prior = image.TaskID
		prompt = ecommerce.ImagePrompt(draft, *image)
		refs := []workbench.TaskReference{}
		for _, ref := range draft.References {
			refs = append(refs, workbench.TaskReference{ResourceID: ref.ResourceID, Kind: "image"})
		}
		resolved, e := s.workbenchDomain().ResolveTask(userID, WorkbenchTaskInput{Kind: "image", Prompt: prompt, ChannelID: choice.ChannelID, Model: choice.Model, LogicalModelID: choice.LogicalModelID, References: refs, Parameters: map[string]any{"size": req.Size, "quality": req.Quality, "imageResolution": req.ImageResolution, "count": 1}})
		if e != nil {
			return nil, e
		}
		input = resolved.Input
	} else {
		return nil, BadAuthRequest("商品任务阶段无效")
	}
	if prior != "" {
		old, e := s.repo.TaskForUser(userID, prior)
		if e != nil {
			return nil, BadAuthRequest("已有任务状态无法确认，请先查询回执")
		}
		if old.Status == model.TaskStatusQueued || old.Status == model.TaskStatusRunning {
			return nil, BadAuthRequest("已有任务执行中，请勿重复提交")
		}
		if old.MediaRecoveryJSON != "" {
			return nil, BadAuthRequest("作品已生成，请重试保存，不要重复生成")
		}
		if old.ProviderCancelStatus == model.ProviderCancelStatusRequested || old.ProviderCancelStatus == model.ProviderCancelStatusUncertain {
			return nil, BadAuthRequest("上一次调用的取消与费用仍在确认，请勿重复提交")
		}
		if e := s.taskBilling().CheckRetryEligibility(old.BillingOrderID); e != nil {
			return nil, e
		}
		if kind == "text" && old.Status == model.TaskStatusSucceeded {
			return nil, BadAuthRequest("请先使用已完成的结果；修改需求请新建一轮")
		}
	}
	config := input["config"].(map[string]any)
	if !validEcommerceChoice(choice) {
		return nil, BadAuthRequest("请选择有效的平台模型")
	}
	if choice.LogicalModelID == "" {
		if _, e := s.repo.SystemChannel(choice.ChannelID); e != nil {
			return nil, BadAuthRequest("请选择平台模型")
		}
	}
	config["channelId"], config["model"] = choice.ChannelID, choice.Model
	input["metadata"] = map[string]any{"source": "ecommerce", "ecommerceStage": req.Stage, "ecommerceProjectId": projectID, "ecommerceRoundId": project.ActiveRoundID, "ecommerceDraft": draft, "ecommerceImageId": req.ImageID}
	input["ecommerceRequestHash"] = creationHash(req)
	prep := &creationTaskPreparation{}
	task, err := s.CreateTask(userID, CreateTaskRequest{ProjectID: projectID, Type: "canvas_" + kind, Operation: operation, Prompt: prompt, Model: choice.Model, LogicalModelID: choice.LogicalModelID, Input: input, creationPrepare: prep, admission: &taskAdmission{ID: id, MaxCharge: math.MaxInt64}, ecommerceInternal: true})
	if err != nil {
		return nil, err
	}
	financial := any(nil)
	quote := CreationQuote{Model: task.Model, ExpiresAt: time.Now().Add(5 * time.Minute)}
	if order := prep.Order; order != nil {
		quote.AmountMicrocredits, quote.BillingMode, quote.Quantity, quote.Estimated = order.AmountMicrocredits, order.BillingMode, order.Quantity, order.BillingMode == "token"
		financial = cloudAgentQuoteHash(order)
	}
	quote.QuoteHash = creationHash([]any{projectID, project.ActiveRoundID, draft, req.Stage, req.ImageID, prompt, choice, req.Size, req.Quality, req.ImageResolution, financial})
	return &ecommercePrepared{project, state, task, prep.Order, quote, creationHash(req)}, nil
}

func (s *Service) QuoteEcommerceTask(userID, id string, req EcommerceTaskRequest) (*CreationQuote, error) {
	prepared, err := s.prepareEcommerceTask(userID, id, req)
	if err != nil {
		return nil, err
	}
	return &prepared.quote, nil
}

func (s *Service) SubmitEcommerceTask(userID, id string, req EcommerceTaskRequest) (*model.Task, error) {
	taskID, err := ecommerceTaskID(userID, id, req.RequestID)
	if err != nil {
		return nil, err
	}
	if _, err := s.ecommerceProject(userID, id, false); err != nil {
		return nil, err
	}
	if existing, err := s.repo.TaskForUser(userID, taskID); err == nil {
		var input struct {
			Hash string `json:"ecommerceRequestHash"`
		}
		if json.Unmarshal([]byte(existing.InputJSON), &input) != nil || input.Hash != creationHash(req) {
			return nil, creationConflict("同一商品任务请求的内容不同")
		}
		return s.Task(userID, existing.ID)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	prepared, err := s.prepareEcommerceTask(userID, id, req)
	if err != nil {
		return nil, err
	}
	if req.QuoteHash != prepared.quote.QuoteHash || req.MaxCharge != prepared.quote.AmountMicrocredits || !req.QuoteExpiresAt.After(time.Now()) || req.QuoteExpiresAt.After(time.Now().Add(6*time.Minute)) {
		return nil, creationConflict("报价已变化或过期，请重新确认")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(prepared.task.InputJSON), &input); err != nil {
		return nil, err
	}
	if err := s.protectTaskSecrets(input); err != nil {
		return nil, err
	}
	encoded, _ := json.Marshal(input)
	prepared.task.InputJSON = string(encoded)
	if prepared.order != nil {
		prepared.order.ChargeLimitSet = true
		prepared.order.ChargeLimitMicrocredits = req.MaxCharge
		prepared.task.AuthorizedChargeMicrocredits = req.MaxCharge
		prepared.task.BillingOrderID = prepared.order.ID
	}
	switch req.Stage {
	case "vision":
		prepared.state.VisionTaskID = taskID
	case "planning":
		prepared.state.PlanningTaskID = taskID
	case "image":
		for i := range prepared.state.Plan.Images {
			image := &prepared.state.Plan.Images[i]
			if image.ID == req.ImageID {
				if image.TaskID != "" {
					image.PreviousTaskIDs = append(image.PreviousTaskIDs, image.TaskID)
				}
				image.TaskID = taskID
			}
		}
	}
	stateJSON, _ := json.Marshal(prepared.state)
	previous := len(prepared.project.PlanJSON)
	prepared.project.PlanJSON = string(stateJSON)
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		draft, _, err := ecommerceDecode(prepared.project)
		if err != nil {
			return err
		}
		if err := tx.LockEcommerceReferences(userID, ecommerceReferenceIDs(draft)); err != nil {
			return err
		}
		if err := s.validateCreationStorage(tx, userID, false, int64(len(stateJSON)-previous)); err != nil {
			return err
		}
		if err := tx.SaveEcommerceProject(prepared.project, req.Revision); err != nil {
			return err
		}
		return createTaskWithStorageQuotaRepository(tx, prepared.task, prepared.order, policy)
	})
	s.storageMu.Unlock()
	if err != nil {
		if existing, e := s.repo.TaskForUser(userID, taskID); e == nil {
			var in struct {
				Hash string `json:"ecommerceRequestHash"`
			}
			if json.Unmarshal([]byte(existing.InputJSON), &in) == nil && in.Hash == prepared.requestHash {
				return s.Task(userID, taskID)
			}
		}
		return nil, ecommerceError(err)
	}
	s.wakeTaskDispatcher()
	return s.Task(userID, taskID)
}

func (s *Service) requireEcommerceTaskAdmission(userID string, req CreateTaskRequest, input map[string]any) error {
	meta, _ := input["metadata"].(map[string]any)
	if stringValue(meta["source"]) == "ecommerce" {
		if !req.ecommerceInternal {
			return BadAuthRequest("商品套图任务必须通过商品项目提交")
		}
		return s.RequireFeature(FeatureEcommerce)
	}
	if exists, err := s.repo.EcommerceProjectExists(req.ProjectID); err != nil {
		return err
	} else if exists {
		return BadAuthRequest("商品套图任务必须通过商品项目提交")
	}
	return nil
}

func (s *Service) requireEcommerceExecution(task model.Task) error {
	var input struct {
		Metadata struct{ Source, EcommerceStage string } `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.Source != "ecommerce" {
		return nil
	}
	// Accepted/unknown provider work must retain its existing reconciliation path.
	if task.ProviderRequestID != "" {
		return nil
	}
	if attempt, err := s.repo.LatestRouteAttempt(task.ID); err == nil && (attempt.DispatchState == "accepted" || attempt.DispatchState == "submission_unknown" || attempt.DispatchState == "dispatching") {
		return nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return err
	}
	if task.Type == "canvas_image" {
		return s.RequireFeature(FeatureImageWorkbench)
	}
	return nil
}

func (s *Service) validateEcommerceResult(task model.Task, result map[string]interface{}) error {
	var input struct {
		Metadata struct {
			Source string          `json:"source"`
			Stage  string          `json:"ecommerceStage"`
			Draft  ecommerce.Draft `json:"ecommerceDraft"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.Source != "ecommerce" || task.Type != "canvas_text" {
		return nil
	}
	var value any
	var err error
	if input.Metadata.Stage == "vision" {
		value, err = ecommerce.ParseDirections(stringValue(result["text"]))
	} else if input.Metadata.Stage == "planning" {
		value, err = ecommerce.ParsePlan(stringValue(result["text"]), input.Metadata.Draft.Count)
	} else {
		return BadAuthRequest("商品任务阶段无效")
	}
	if err != nil {
		return &AppError{Status: 502, Code: 502, Message: err.Error(), Retryable: false}
	}
	encoded, _ := json.Marshal(value)
	result["text"] = string(encoded)
	return nil
}
