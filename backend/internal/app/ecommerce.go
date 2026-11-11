package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type EcommerceDraft = ecommerce.Draft
type EcommerceState = ecommerce.State

type EcommerceProjectRequest struct {
	ID        string          `json:"id"`
	Revision  int64           `json:"revision"`
	NewRound  bool            `json:"newRound"`
	ClientKey string          `json:"clientKey"`
	Draft     ecommerce.Draft `json:"draft"`
}

type EcommerceProjectView struct {
	model.EcommerceProject
	Draft ecommerce.Draft `json:"draft"`
	State ecommerce.State `json:"state"`
	Tasks []*model.Task   `json:"tasks"`
}

type EcommerceRoundView struct {
	model.EcommerceRound
	Draft ecommerce.Draft `json:"draft"`
	State ecommerce.State `json:"state"`
	Tasks []*model.Task   `json:"tasks"`
}

func ecommerceError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("商品项目不存在或无权访问")
	}
	if errors.Is(err, repository.ErrEcommerceConflict) {
		return creationConflict("商品项目已变化，请刷新后继续")
	}
	return creationError(err)
}

func ecommerceUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.String() == value
}

func (s *Service) ecommerceDraft(userID string, draft ecommerce.Draft) error {
	if strings.TrimSpace(userID) == "" {
		return Unauthorized("请先登录")
	}
	if err := s.ecommerceActor(userID); err != nil {
		return err
	}
	if err := ecommerce.ValidateDraft(draft); err != nil {
		return BadAuthRequest(err.Error())
	}
	for _, ref := range draft.References {
		resource, err := s.repo.ResourceForUser(userID, ref.ResourceID)
		if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return BadAuthRequest("参考图不存在、尚未就绪或不属于当前账号")
		}
	}
	return nil
}

func ecommerceDecode(item *model.EcommerceProject) (ecommerce.Draft, ecommerce.State, error) {
	var draft ecommerce.Draft
	var state ecommerce.State
	if json.Unmarshal([]byte(item.DraftJSON), &draft) != nil || json.Unmarshal([]byte(item.PlanJSON), &state) != nil {
		return draft, state, BadAuthRequest("商品项目数据损坏，请联系管理员")
	}
	return draft, state, nil
}

func (s *Service) ecommerceProject(userID, id string, write bool) (*model.EcommerceProject, error) {
	if userID == "" {
		return nil, Unauthorized("请先登录")
	}
	item, err := s.repo.EcommerceProject(userID, id)
	if err != nil {
		return nil, ecommerceError(err)
	}
	if write {
		if err := s.ecommerceActor(userID); err != nil {
			return nil, err
		}
		if err := s.RequireFeature(FeatureEcommerce); err != nil {
			return nil, err
		}
		if item.Status != "active" {
			return nil, BadAuthRequest("项目已归档，只能查看已有作品")
		}
	}
	return item, nil
}

func (s *Service) ecommerceActor(userID string) error {
	user, err := s.repo.User(userID)
	if err != nil || user.Status != model.UserStatusActive {
		return Unauthorized("账号不可用，请重新登录")
	}
	return nil
}

func (s *Service) ecommerceTasks(userID string, state ecommerce.State) []*model.Task {
	items := []*model.Task{}
	for _, id := range state.TaskIDs() {
		if task, err := s.Task(userID, id); err == nil {
			items = append(items, task)
		}
	}
	return items
}

func (s *Service) EcommerceProject(userID, id string) (*EcommerceProjectView, error) {
	item, err := s.ecommerceProject(userID, id, false)
	if err != nil {
		return nil, err
	}
	draft, state, err := ecommerceDecode(item)
	if err != nil {
		return nil, err
	}
	return &EcommerceProjectView{*item, draft, state, s.ecommerceTasks(userID, state)}, nil
}

func (s *Service) EcommerceProjects(userID string, page int) ([]model.EcommerceProject, error) {
	if userID == "" {
		return nil, Unauthorized("请先登录")
	}
	if page < 1 || page > 500 {
		return nil, BadAuthRequest("项目页码无效")
	}
	return s.repo.EcommerceProjects(userID, (page-1)*20, 20)
}

func (s *Service) CreateEcommerceProject(userID string, req EcommerceProjectRequest) (*EcommerceProjectView, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if !ecommerceUUID(req.ID) {
		return nil, BadAuthRequest("缺少有效的项目请求标识")
	}
	if err := s.ecommerceDraft(userID, req.Draft); err != nil {
		return nil, err
	}
	hash := creationHash(req.Draft)
	if old, err := s.repo.EcommerceProject(userID, req.ID); err == nil {
		if old.CreateHash != hash {
			return nil, creationConflict("同一项目请求的商品资料已改变")
		}
		return s.EcommerceProject(userID, old.ID)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	draft, _ := json.Marshal(req.Draft)
	item := &model.EcommerceProject{ID: req.ID, UserID: userID, Name: strings.TrimSpace(req.Draft.ProductName), Status: "active", CreateHash: hash, ActiveRoundID: newID(), DraftJSON: string(draft), PlanJSON: "{}", Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	s.storageMu.Lock()
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.LockEcommerceReferences(userID, ecommerceReferenceIDs(req.Draft)); err != nil {
			return err
		}
		if err := s.validateCreationStorage(tx, userID, true, int64(len(draft)+2)); err != nil {
			return err
		}
		return tx.CreateEcommerceProject(item)
	})
	s.storageMu.Unlock()
	if err != nil {
		if old, e := s.repo.EcommerceProject(userID, req.ID); e == nil && old.CreateHash == hash {
			return s.EcommerceProject(userID, req.ID)
		}
		return nil, ecommerceError(err)
	}
	return s.EcommerceProject(userID, item.ID)
}

func (s *Service) ecommerceIdle(userID string, state ecommerce.State) error {
	for _, id := range state.TaskIDs() {
		task, err := s.repo.TaskForUser(userID, id)
		if err != nil {
			return BadAuthRequest("已有任务状态无法确认，请先核实任务回执")
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			return BadAuthRequest("仍有执行中的任务，请先完成或取消")
		}
	}
	return nil
}

func (s *Service) SaveEcommerceDraft(userID, id string, req EcommerceProjectRequest) (*EcommerceProjectView, error) {
	item, err := s.ecommerceProject(userID, id, true)
	if err != nil {
		return nil, err
	}
	if err := s.ecommerceDraft(userID, req.Draft); err != nil {
		return nil, err
	}
	_, state, err := ecommerceDecode(item)
	if err != nil {
		return nil, err
	}
	if !ecommerceUUID(req.ClientKey) {
		return nil, BadAuthRequest("缺少有效的保存标识")
	}
	roundID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(id+":"+req.ClientKey)).String()
	encoded, _ := json.Marshal(req.Draft)
	if req.NewRound && item.ActiveRoundID == roundID {
		if item.DraftJSON != string(encoded) {
			return nil, creationConflict("同一轮次请求的资料不同")
		}
		return s.EcommerceProject(userID, id)
	}
	if item.Revision != req.Revision {
		return nil, ecommerceError(repository.ErrEcommerceConflict)
	}
	if !req.NewRound && len(state.TaskIDs()) > 0 {
		return nil, BadAuthRequest("本轮已有受理任务，请新建一轮修改商品资料")
	}
	if err := s.ecommerceIdle(userID, state); err != nil {
		return nil, err
	}
	previous := *item
	item.Name, item.DraftJSON = strings.TrimSpace(req.Draft.ProductName), string(encoded)
	item.PlanJSON = "{}"
	if req.NewRound {
		item.ActiveRoundID = roundID
	}
	s.storageMu.Lock()
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.LockEcommerceReferences(userID, ecommerceReferenceIDs(req.Draft)); err != nil {
			return err
		}
		delta := len(item.DraftJSON) + len(item.PlanJSON) - len(previous.DraftJSON) - len(previous.PlanJSON)
		if req.NewRound && len(state.TaskIDs()) > 0 {
			delta += len(previous.DraftJSON) + len(previous.PlanJSON)
		}
		if err := s.validateCreationStorage(tx, userID, false, int64(delta)); err != nil {
			return err
		}
		if err := tx.SaveEcommerceProject(item, req.Revision); err != nil {
			return err
		}
		if req.NewRound && len(state.TaskIDs()) > 0 {
			return tx.ArchiveEcommerceRound(&previous)
		}
		return nil
	})
	s.storageMu.Unlock()
	if err != nil {
		return nil, ecommerceError(err)
	}
	return s.EcommerceProject(userID, id)
}

func (s *Service) ArchiveEcommerceProject(userID, id string, revision int64) error {
	if err := s.ecommerceActor(userID); err != nil {
		return err
	}
	item, err := s.ecommerceProject(userID, id, false)
	if err != nil {
		return err
	}
	if item.Status == "archived" {
		return nil
	}
	item.Status = "archived"
	return ecommerceError(s.repo.SaveEcommerceProject(item, revision))
}

func ecommerceReferenceIDs(draft ecommerce.Draft) []string {
	ids := make([]string, 0, len(draft.References))
	for _, ref := range draft.References {
		ids = append(ids, ref.ResourceID)
	}
	return ids
}

func (s *Service) EcommerceRounds(userID, id string, page int) ([]EcommerceRoundView, error) {
	if _, err := s.ecommerceProject(userID, id, false); err != nil {
		return nil, err
	}
	if page < 1 || page > 500 {
		return nil, BadAuthRequest("轮次页码无效")
	}
	rows, err := s.repo.EcommerceRounds(userID, id, (page-1)*20, 20)
	if err != nil {
		return nil, err
	}
	result := []EcommerceRoundView{}
	for _, row := range rows {
		var draft ecommerce.Draft
		var state ecommerce.State
		if json.Unmarshal([]byte(row.DraftJSON), &draft) != nil || json.Unmarshal([]byte(row.PlanJSON), &state) != nil {
			return nil, BadAuthRequest("历史轮次数据损坏")
		}
		result = append(result, EcommerceRoundView{row, draft, state, s.ecommerceTasks(userID, state)})
	}
	return result, nil
}

func (s *Service) saveEcommerceState(item *model.EcommerceProject, state ecommerce.State) error {
	encoded, err := json.Marshal(state)
	if err != nil {
		return err
	}
	previous := len(item.PlanJSON)
	item.PlanJSON = string(encoded)
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.Transaction(func(tx *repository.Repository) error {
		if err := s.validateCreationStorage(tx, item.UserID, false, int64(len(encoded)-previous)); err != nil {
			return err
		}
		return tx.SaveEcommerceProject(item, item.Revision)
	})
}

type EcommerceAcceptRequest struct {
	Revision    int64  `json:"revision"`
	TaskID      string `json:"taskId"`
	DirectionID string `json:"directionId,omitempty"`
}

func (s *Service) AcceptEcommerceStage(userID, id string, req EcommerceAcceptRequest) (*EcommerceProjectView, error) {
	item, err := s.ecommerceProject(userID, id, true)
	if err != nil {
		return nil, err
	}
	draft, state, err := ecommerceDecode(item)
	if err != nil {
		return nil, err
	}
	if item.Revision != req.Revision {
		return nil, ecommerceError(repository.ErrEcommerceConflict)
	}
	task, err := s.repo.TaskForUser(userID, req.TaskID)
	if err != nil || task.ProjectID != id || task.Status != model.TaskStatusSucceeded {
		return nil, BadAuthRequest("任务尚未完成或不属于本项目")
	}
	var result struct {
		Text string `json:"text"`
	}
	if json.Unmarshal([]byte(task.ResultJSON), &result) != nil {
		return nil, BadAuthRequest("任务结果不可读取")
	}
	switch req.TaskID {
	case state.VisionTaskID:
		if state.PlanningTaskID != "" {
			return nil, BadAuthRequest("本轮已开始策划，修改方向请新建一轮")
		}
		parsed, e := ecommerce.ParseDirections(result.Text)
		if e != nil {
			return nil, BadAuthRequest(e.Error())
		}
		found := false
		for _, direction := range parsed.Directions {
			found = found || direction.ID == req.DirectionID
		}
		if !found {
			return nil, BadAuthRequest("请选择有效的视觉方向")
		}
		state.Directions, state.SelectedDirectionID, state.VisionApplied = parsed, req.DirectionID, req.TaskID
	case state.PlanningTaskID:
		if state.PlanningApplied == req.TaskID {
			return s.EcommerceProject(userID, id)
		}
		parsed, e := ecommerce.ParsePlan(result.Text, draft.Count)
		if e != nil {
			return nil, BadAuthRequest(e.Error())
		}
		state.Plan, state.PlanningApplied = parsed, req.TaskID
	default:
		return nil, BadAuthRequest("任务不属于当前轮次")
	}
	if err := s.saveEcommerceState(item, state); err != nil {
		return nil, ecommerceError(err)
	}
	return s.EcommerceProject(userID, id)
}

type EcommerceImageEdit struct {
	Revision int64  `json:"revision"`
	Title    string `json:"title"`
	Copy     string `json:"copy"`
	Prompt   string `json:"prompt"`
}

func (s *Service) EditEcommerceImage(userID, id, imageID string, req EcommerceImageEdit) (*EcommerceProjectView, error) {
	item, err := s.ecommerceProject(userID, id, true)
	if err != nil {
		return nil, err
	}
	_, state, err := ecommerceDecode(item)
	if err != nil {
		return nil, err
	}
	if item.Revision != req.Revision {
		return nil, ecommerceError(repository.ErrEcommerceConflict)
	}
	if len([]rune(req.Title)) < 1 || len([]rune(req.Title)) > 100 || len([]rune(req.Copy)) > 1000 || len([]rune(req.Prompt)) < 1 || len([]rune(req.Prompt)) > 6000 {
		return nil, BadAuthRequest("图片标题、文案或要求长度无效")
	}
	found := false
	if state.Plan != nil {
		for i := range state.Plan.Images {
			image := &state.Plan.Images[i]
			if image.ID == imageID {
				if image.TaskID != "" {
					task, e := s.repo.TaskForUser(userID, image.TaskID)
					if e != nil || task.Status == model.TaskStatusRunning || task.Status == model.TaskStatusQueued {
						return nil, BadAuthRequest("图片仍在执行或状态无法确认")
					}
				}
				image.Title, image.Copy, image.Prompt = req.Title, req.Copy, req.Prompt
				found = true
			}
		}
	}
	if !found {
		return nil, NotFound("图片方案不存在")
	}
	if err := s.saveEcommerceState(item, state); err != nil {
		return nil, ecommerceError(err)
	}
	return s.EcommerceProject(userID, id)
}
