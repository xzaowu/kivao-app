package model

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

type Task struct {
	// Only EnsureCloudAgent sets this after creating the execution in the same
	// transaction. Ordinary task saves must not reset it from a stale snapshot.
	AgentExecutionReady          bool                     `json:"-" gorm:"not null;default:false;<-:create"`
	AgentRunID                   string                   `json:"agentRunId,omitempty" gorm:"size:36;index"`
	GenerationID                 string                   `json:"generationId,omitempty" gorm:"size:36;index"`
	ApprovalID                   string                   `json:"approvalId,omitempty" gorm:"size:160"`
	AuthorizedChargeMicrocredits int64                    `json:"authorizedChargeMicrocredits,omitempty"`
	ExecutionDiagnosticJSON      string                   `json:"-" gorm:"type:text"`
	Diagnostic                   *TaskExecutionDiagnostic `json:"diagnostic,omitempty" gorm:"-"`
	CancellationSource           string                   `json:"cancellationSource,omitempty" gorm:"size:40"`
	CancellationActorID          string                   `json:"cancellationActorId,omitempty" gorm:"size:36"`
	CancellationRequestedAt      *time.Time               `json:"cancellationRequestedAt,omitempty"`
	CreationSubmissionID         *string                  `json:"creationSubmissionId,omitempty" gorm:"size:36;uniqueIndex"`
	SubmissionHash               string                   `json:"-" gorm:"size:64"`
	WorkbenchKind                string                   `json:"workbenchKind,omitempty" gorm:"size:16;index"`
	ID                           string                   `json:"id" gorm:"primaryKey;size:36"`
	UserID                       string                   `json:"userId" gorm:"index;size:36;index:idx_tasks_user_created,priority:1;index:idx_tasks_user_project_created,priority:1"`
	TraceID                      string                   `json:"-" gorm:"index;size:96"`
	RequestID                    string                   `json:"-" gorm:"index;size:96"`
	ProjectID                    string                   `json:"projectId" gorm:"index;size:80;index:idx_tasks_user_project_created,priority:2"`
	Type                         string                   `json:"type" gorm:"index;size:64"`
	Status                       TaskStatus               `json:"status" gorm:"index;size:24;index:idx_tasks_status_created,priority:1;index:idx_tasks_claim,priority:1;index:idx_tasks_provider_cancel,priority:1"`
	Stage                        string                   `json:"stage" gorm:"size:80"`
	Progress                     int                      `json:"progress"`
	Prompt                       string                   `json:"prompt"`
	Operation                    string                   `json:"operation" gorm:"size:64"`
	Provider                     string                   `json:"provider" gorm:"size:64"`
	Model                        string                   `json:"model" gorm:"size:120"`
	LogicalModelID               string                   `json:"logicalModelId,omitempty" gorm:"size:36;index"`
	LogicalModelRevisionID       string                   `json:"logicalModelRevisionId,omitempty" gorm:"size:36;index"`
	RouteID                      string                   `json:"routeId,omitempty" gorm:"size:36;index"`
	ChannelModelID               string                   `json:"channelModelId,omitempty" gorm:"size:36;index"`
	ProtocolBindingJSON          string                   `json:"-" gorm:"type:text"`
	// RouteRun 只在用户主动重试时递增；worker 租约恢复不应创建新的路由选择世代。
	RouteRun                  int                  `json:"-" gorm:"index"`
	BillingOrderID            string               `json:"billingOrderId,omitempty" gorm:"index;size:36"`
	ProviderRequestID         string               `json:"providerRequestId,omitempty" gorm:"index;size:160"`
	ProviderCancelStatus      ProviderCancelStatus `json:"providerCancelStatus,omitempty" gorm:"index;size:24;index:idx_tasks_provider_cancel,priority:2"`
	ProviderCancelError       string               `json:"providerCancelError,omitempty" gorm:"type:text"`
	ProviderCancelAttempts    int                  `json:"providerCancelAttempts,omitempty"`
	ProviderCancelRequestedAt *time.Time           `json:"providerCancelRequestedAt,omitempty"`
	ProviderCancelledAt       *time.Time           `json:"providerCancelledAt,omitempty"`
	ProviderCancelNextCheckAt *time.Time           `json:"providerCancelNextCheckAt,omitempty" gorm:"index:idx_tasks_provider_cancel,priority:3"`
	PollStage                 string               `json:"pollStage,omitempty" gorm:"size:32"`
	NextPollAt                *time.Time           `json:"nextPollAt,omitempty" gorm:"index"`
	LeaseOwner                string               `json:"-" gorm:"index;size:120"`
	LeaseExpiresAt            *time.Time           `json:"-" gorm:"index;index:idx_tasks_claim,priority:2"`
	InputJSON                 string               `json:"inputJson" gorm:"type:text"`
	ResultJSON                string               `json:"resultJson" gorm:"type:text"`
	// MediaRecoveryJSON is an encrypted server-only checkpoint, never a public result.
	MediaRecoveryJSON string             `json:"-" gorm:"type:text"`
	MediaStage        string             `json:"mediaStage,omitempty" gorm:"size:24"`
	CanRecoverMedia   bool               `json:"canRecoverMedia,omitempty" gorm:"-"`
	ClientContext     *TaskClientContext `json:"clientContext,omitempty" gorm:"-"`
	ClientOperationID string             `json:"clientOperationId,omitempty" gorm:"-"`
	TextDraft         string             `json:"textDraft,omitempty" gorm:"type:text"`
	Error             string             `json:"error"`
	Attempts          int                `json:"attempts"`
	StartedAt         *time.Time         `json:"startedAt"`
	CompletedAt       *time.Time         `json:"completedAt"`
	CreatedAt         time.Time          `json:"createdAt" gorm:"index:idx_tasks_user_created,priority:2;index:idx_tasks_status_created,priority:2;index:idx_tasks_claim,priority:3;index:idx_tasks_user_project_created,priority:3"`
	CreatedAtEpoch    int64              `json:"-" gorm:"index:idx_tasks_created_epoch"`
	UpdatedAt         time.Time          `json:"updatedAt"`
}

type TaskClientContext struct {
	NodeID                string                 `json:"nodeId,omitempty"`
	AssetTitle            string                 `json:"assetTitle,omitempty"`
	ConversationID        string                 `json:"conversationId,omitempty"`
	MessageID             string                 `json:"messageId,omitempty"`
	BatchID               string                 `json:"batchId,omitempty"`
	BatchIndex            int                    `json:"batchIndex,omitempty"`
	BatchSlotKey          string                 `json:"batchSlotKey,omitempty"`
	BatchCount            int                    `json:"batchCount,omitempty"`
	DomainProjectID       string                 `json:"domainProjectId,omitempty"`
	ChapterID             string                 `json:"chapterId,omitempty"`
	ChapterOperation      string                 `json:"chapterOperation,omitempty"`
	ShotID                string                 `json:"shotId,omitempty"`
	WorkflowStepID        string                 `json:"workflowStepId,omitempty"`
	ArtifactType          string                 `json:"artifactType,omitempty"`
	EcommerceVideoVersion *EcommerceVideoVersion `json:"ecommerceVideoVersion,omitempty"`
}

type EcommerceVideoReference struct {
	ResourceID  string   `json:"resourceId"`
	Name        string   `json:"name"`
	DurationMs  int64    `json:"durationMs"`
	Aspects     []string `json:"aspects,omitempty"`
	Instruction string   `json:"instruction,omitempty"`
}

type EcommerceVideoPresenter struct {
	FrameResourceID string `json:"frameResourceId"`
	Delivery        string `json:"delivery"`
}

type EcommerceVideoBoardShot struct {
	Frame *struct {
		ResourceID string `json:"resourceId"`
		Name       string `json:"name"`
	} `json:"frame,omitempty"`
	Framing string `json:"framing,omitempty"`
	Camera  string `json:"camera,omitempty"`
}

type EcommerceVideoShootBrief struct {
	Scene   string `json:"scene,omitempty"`
	Closing string `json:"closing,omitempty"`
}

type EcommerceVideoFrameSource string

const (
	EcommerceVideoFrameLibrary   EcommerceVideoFrameSource = "library"
	EcommerceVideoFrameComposite EcommerceVideoFrameSource = "composite"
)

func (s *EcommerceVideoFrameSource) UnmarshalJSON(raw []byte) error {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if EcommerceVideoFrameSource(value) != EcommerceVideoFrameLibrary && EcommerceVideoFrameSource(value) != EcommerceVideoFrameComposite {
		return errors.New("未知的商品视频素材来源")
	}
	*s = EcommerceVideoFrameSource(value)
	return nil
}

type EcommerceVideoFrame struct {
	ResourceID string                    `json:"resourceId"`
	Name       string                    `json:"name"`
	Source     EcommerceVideoFrameSource `json:"source,omitempty"`
}

// EcommerceVideoVersion contains editable creation inputs, never the provider configuration.
type EcommerceVideoVersion struct {
	Schema         int                        `json:"schema"`
	Frame          EcommerceVideoFrame        `json:"frame"`
	ProductImages  []EcommerceVideoFrame      `json:"productImages,omitempty"`
	ReferenceVideo *EcommerceVideoReference   `json:"referenceVideo,omitempty"`
	Presenter      *EcommerceVideoPresenter   `json:"presenter,omitempty"`
	Model          string                     `json:"model"`
	Facts          string                     `json:"facts"`
	Purpose        string                     `json:"purpose"`
	ApproachID     string                     `json:"approachId,omitempty"`
	Shots          []string                   `json:"shots"`
	Boards         []*EcommerceVideoBoardShot `json:"boards,omitempty"`
	BoardInputs    bool                       `json:"boardInputs,omitempty"`
	ShootBrief     *EcommerceVideoShootBrief  `json:"shootBrief,omitempty"`
	Voice          string                     `json:"voice"`
	ProductName    string                     `json:"productName"`
	Audience       string                     `json:"audience"`
	Language       string                     `json:"language"`
	Region         string                     `json:"region,omitempty"`
	Settings       struct {
		Seconds       int    `json:"seconds"`
		Ratio         string `json:"ratio"`
		Resolution    string `json:"resolution"`
		GenerateAudio bool   `json:"generateAudio"`
	} `json:"settings"`
	ParentTaskID string `json:"parentTaskId,omitempty"`
}

func (t *Task) BeforeCreate(tx *gorm.DB) error {
	if t.CreatedAtEpoch == 0 {
		if t.CreatedAt.IsZero() {
			t.CreatedAtEpoch = time.Now().Unix()
		} else {
			t.CreatedAtEpoch = t.CreatedAt.Unix()
		}
	}
	return nil
}

// TaskTextDelta 只保存可回放窗口内的文本增量；最终正文和失败草稿分别归并到 Task.ResultJSON 与 Task.TextDraft。
type TaskTextDelta struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36;index:idx_task_text_deltas_user_created,priority:1"`
	TaskID    string    `json:"taskId" gorm:"index;size:36;uniqueIndex:idx_task_text_deltas_sequence,priority:1"`
	Sequence  int64     `json:"sequence" gorm:"uniqueIndex:idx_task_text_deltas_sequence,priority:2"`
	Content   string    `json:"content" gorm:"type:text"`
	ByteCount int64     `json:"byteCount"`
	CreatedAt time.Time `json:"createdAt" gorm:"index:idx_task_text_deltas_user_created,priority:2"`
	ExpiresAt time.Time `json:"expiresAt" gorm:"index"`
}

type TaskLog struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TaskID    string    `json:"taskId" gorm:"index;size:36"`
	TraceID   string    `json:"-" gorm:"index;size:96"`
	RequestID string    `json:"-" gorm:"index;size:96"`
	Level     string    `json:"level" gorm:"size:24"`
	Message   string    `json:"message"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}

type Result struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TaskID    string    `json:"taskId" gorm:"index;size:36"`
	Kind      string    `json:"kind" gorm:"size:64"`
	URL       string    `json:"url"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}
