package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// Recover the durable receipt even if the browser left before saving the task ID.
// Direction tasks are always created after their project, so the created_at lower
// bound lets the database skip the owner's older tasks before matching input_json.
func (r *Repository) CommerceStudioDirectionsTask(userID, projectID string, since time.Time) (*model.Task, error) {
	var tasks []model.Task
	query := r.db.Where("user_id = ? AND type = ?", userID, "canvas_text")
	if !since.IsZero() {
		query = query.Where("created_at >= ?", since.Add(-time.Minute))
	}
	if err := query.Where("input_json LIKE ? AND input_json LIKE ?", `%"stage":"creative-directions"%`, `%"ecommerceProjectId":"`+projectID+`"%`).Order("created_at desc, id desc").Limit(10).Find(&tasks).Error; err != nil {
		return nil, err
	}
	for _, task := range tasks {
		var input struct {
			Metadata struct {
				ProjectID string `json:"ecommerceProjectId"`
				Stage     string `json:"stage"`
				Source    string `json:"source"`
			} `json:"metadata"`
		}
		if json.Unmarshal([]byte(task.InputJSON), &input) == nil && input.Metadata.ProjectID == projectID && input.Metadata.Stage == "creative-directions" && input.Metadata.Source == "ecommerce-agent" {
			return &task, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

var ErrCommerceStudioProjectSelectionChanged = errors.New("ecommerce project selection changed")

func (r *Repository) CreateCommerceStudioProject(project *model.CommerceStudioProject) error {
	return r.db.Create(project).Error
}

func (r *Repository) CommerceStudioProject(userID, id string) (*model.CommerceStudioProject, error) {
	var project model.CommerceStudioProject
	if err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&project).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *Repository) CommerceStudioProjects(userID string) ([]model.CommerceStudioProject, error) {
	projects, _, err := r.CommerceStudioProjectPage(userID, 1, 100)
	return projects, err
}

func (r *Repository) CommerceStudioProjectPage(userID string, page, pageSize int) ([]model.CommerceStudioProject, int64, error) {
	projects := make([]model.CommerceStudioProject, 0)
	var total int64
	if err := r.db.Model(&model.CommerceStudioProject{}).Where("user_id = ?", userID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := r.db.Where("user_id = ?", userID).Order("updated_at desc, id desc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&projects).Error
	return projects, total, err
}

// DeleteEcommerceProjects removes only the owner's project records. Referenced
// resources and generation tasks have their own lifecycles and remain intact.
func (r *Repository) DeleteCommerceStudioProjects(userID string, ids []string, all bool, expectedTotal int64) (int64, error) {
	var deleted int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&model.CommerceStudioProject{}).Where("user_id = ?", userID)
		if !all {
			query = query.Where("id IN ?", ids)
		}
		var matchedIDs []string
		if err := query.Pluck("id", &matchedIDs).Error; err != nil {
			return err
		}
		if int64(len(matchedIDs)) != expectedTotal {
			return ErrCommerceStudioProjectSelectionChanged
		}
		result := tx.Where("user_id = ? AND id IN ?", userID, matchedIDs).Delete(&model.CommerceStudioProject{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != expectedTotal {
			return ErrCommerceStudioProjectSelectionChanged
		}
		// Rounds belong to the deleted projects only; tasks and resources keep
		// their own lifecycle and are never touched here.
		if err := tx.Where("user_id = ? AND project_id IN ?", userID, matchedIDs).Delete(&model.CommerceStudioRound{}).Error; err != nil {
			return err
		}
		deleted = result.RowsAffected
		return nil
	})
	return deleted, err
}
func (r *Repository) SaveCommerceStudioProject(project *model.CommerceStudioProject, expectedRevision int64) error {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		stored, err := lockCommerceStudioProject(tx, project.UserID, project.ID)
		if err != nil {
			return err
		}
		if stored.Revision != expectedRevision {
			return gorm.ErrRecordNotFound
		}
		if stored.ActiveRoundID != "" {
			// An older client can still send inline history. Split it into round
			// rows (deduplicated) instead of writing it back onto the project row.
			var plan model.CommerceStudioPlan
			if json.Unmarshal([]byte(project.PlanJSON), &plan) == nil && len(plan.PreviousImages) > 0 {
				legacy := *project
				if _, err := convertCommerceStudioLegacyRounds(tx, &legacy); err != nil {
					return err
				}
				project.PlanJSON = legacy.PlanJSON
			}
			project.ActiveRoundID = stored.ActiveRoundID
		}
		result := tx.Model(&model.CommerceStudioProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expectedRevision).
			Updates(map[string]any{"name": project.Name, "status": project.Status, "draft_json": project.DraftJSON, "plan_json": project.PlanJSON, "revision": expectedRevision + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	if err != nil {
		return err
	}
	project.Revision = expectedRevision + 1
	return nil
}

// ErrEcommerceRoundConflict reports a stale revision, a stale active round, or
// an edited history image whose version changed. Callers must reload and retry
// explicitly; nothing is overwritten silently.
var ErrCommerceStudioRoundConflict = errors.New("ecommerce round conflict")

type CommerceStudioRoundsSaveOptions struct {
	RoundMode     bool
	AdvanceRound  bool
	ActiveRoundID string
}

// SaveEcommerceProjectRounds stores the bounded active draft/plan. In round
// mode it first converts legacy inline history, then optionally archives the
// current active round and allocates the next active round. All of this happens
// in one transaction guarded by the project revision.
func (r *Repository) SaveCommerceStudioProjectRounds(project *model.CommerceStudioProject, expectedRevision int64, opts CommerceStudioRoundsSaveOptions) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		stored, err := lockCommerceStudioProject(tx, project.UserID, project.ID)
		if err != nil {
			return err
		}
		if stored.Revision != expectedRevision {
			return ErrCommerceStudioRoundConflict
		}
		activeID := stored.ActiveRoundID
		if opts.RoundMode {
			if _, err := convertCommerceStudioLegacyRounds(tx, stored); err != nil {
				return err
			}
			activeID = stored.ActiveRoundID
			if opts.ActiveRoundID != "" && activeID != "" && opts.ActiveRoundID != activeID {
				return ErrCommerceStudioRoundConflict
			}
			if opts.AdvanceRound {
				if hasCommerceStudioPlanImages(stored.PlanJSON) {
					archived, err := archiveCommerceStudioRound(tx, stored.UserID, stored.ID, stored.DraftJSON, stored.PlanJSON)
					if err != nil {
						return err
					}
					if archived {
						activeID = kernel.NewID()
					}
				}
			}
			if activeID == "" {
				activeID = kernel.NewID()
			}
			project.ActiveRoundID = activeID
		}
		updates := map[string]any{"name": project.Name, "status": project.Status, "draft_json": project.DraftJSON, "plan_json": project.PlanJSON, "revision": expectedRevision + 1}
		if opts.RoundMode {
			updates["active_round_id"] = project.ActiveRoundID
		}
		result := tx.Model(&model.CommerceStudioProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expectedRevision).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCommerceStudioRoundConflict
		}
		project.Revision = expectedRevision + 1
		return nil
	})
}

// ConvertEcommerceProjectRounds is the explicit, idempotent legacy conversion.
// It bumps the revision so an old client holding the pre-conversion plan cannot
// write the whole history back afterwards.
func (r *Repository) ConvertCommerceStudioProjectRounds(userID, projectID string, expectedRevision int64) (*model.CommerceStudioProject, int, error) {
	created := 0
	err := r.db.Transaction(func(tx *gorm.DB) error {
		stored, err := lockCommerceStudioProject(tx, userID, projectID)
		if err != nil {
			return err
		}
		if stored.Revision != expectedRevision {
			return ErrCommerceStudioRoundConflict
		}
		var before model.CommerceStudioPlan
		hadPrevious := json.Unmarshal([]byte(stored.PlanJSON), &before) == nil && len(before.PreviousImages) > 0
		alreadyConverted := stored.ActiveRoundID != ""
		created, err = convertCommerceStudioLegacyRounds(tx, stored)
		if err != nil {
			return err
		}
		if !hadPrevious && alreadyConverted {
			return nil
		}
		if stored.ActiveRoundID == "" {
			stored.ActiveRoundID = kernel.NewID()
		}
		if err := tx.Model(&model.CommerceStudioProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", stored.ID, stored.UserID, stored.Revision).
			Updates(map[string]any{"plan_json": stored.PlanJSON, "active_round_id": stored.ActiveRoundID, "revision": stored.Revision + 1}).Error; err != nil {
			return err
		}
		stored.Revision++
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	project, err := r.CommerceStudioProject(userID, projectID)
	if err != nil {
		return nil, 0, err
	}
	return project, created, nil
}

func lockCommerceStudioProject(tx *gorm.DB, userID, projectID string) (*model.CommerceStudioProject, error) {
	var stored model.CommerceStudioProject
	query := tx
	if tx.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Where("user_id = ? AND id = ?", userID, projectID).First(&stored).Error; err != nil {
		return nil, err
	}
	return &stored, nil
}

func hasCommerceStudioPlanImages(planJSON string) bool {
	var plan model.CommerceStudioPlan
	if json.Unmarshal([]byte(planJSON), &plan) != nil {
		return false
	}
	return len(plan.Images) > 0
}

// convertEcommerceLegacyRounds moves inline previousImages into round rows,
// grouped by their original draft snapshot. Repeated calls are no-ops because
// the stored plan no longer carries previousImages afterwards.
func convertCommerceStudioLegacyRounds(tx *gorm.DB, project *model.CommerceStudioProject) (int, error) {
	var plan model.CommerceStudioPlan
	if json.Unmarshal([]byte(project.PlanJSON), &plan) != nil {
		plan = model.CommerceStudioPlan{}
	}
	if len(plan.PreviousImages) == 0 {
		if project.ActiveRoundID == "" {
			project.ActiveRoundID = kernel.NewID()
		}
		return 0, nil
	}
	type group struct {
		draft  string
		images []model.CommerceStudioPlanTask
	}
	// Only adjacent images sharing a draft form one round. Grouping by draft
	// globally would merge a later round back into an earlier one whenever the
	// same product draft reappears, losing the chronological round boundaries.
	groups := make([]group, 0, 4)
	for _, image := range plan.PreviousImages {
		draftJSON := "{}"
		if len(image.SourceDraft) > 0 && json.Valid(image.SourceDraft) {
			draftJSON = string(image.SourceDraft)
		}
		image.RoundID = ""
		if len(groups) == 0 || groups[len(groups)-1].draft != draftJSON {
			groups = append(groups, group{draft: draftJSON})
		}
		groups[len(groups)-1].images = append(groups[len(groups)-1].images, image)
	}
	var existingRounds []model.CommerceStudioRound
	if err := tx.Model(&model.CommerceStudioRound{}).Where("project_id = ?", project.ID).Select("plan_json").Find(&existingRounds).Error; err != nil {
		return 0, err
	}
	archivedTasks := make(map[string]struct{})
	for _, round := range existingRounds {
		var archived model.CommerceStudioPlan
		if json.Unmarshal([]byte(round.PlanJSON), &archived) != nil {
			continue
		}
		for _, image := range archived.Images {
			if image.TaskID != "" {
				archivedTasks[image.TaskID] = struct{}{}
			}
		}
	}
	var maxOrdinal int
	if err := tx.Model(&model.CommerceStudioRound{}).Where("project_id = ?", project.ID).Select("COALESCE(MAX(ordinal), 0)").Scan(&maxOrdinal).Error; err != nil {
		return 0, err
	}
	created := 0
	ordinal := maxOrdinal
	for _, item := range groups {
		// A legacy client can replay the same artwork with a new draft snapshot
		// stamped on it (and with locally edited/removed images). Tasks are unique
		// per generated artwork, so any overlap means this group was already
		// archived; re-inserting it would duplicate or resurrect edited history.
		replayed := false
		for _, image := range item.images {
			if _, ok := archivedTasks[image.TaskID]; ok && image.TaskID != "" {
				replayed = true
				break
			}
		}
		if replayed {
			continue
		}
		dedup := commerceStudioRoundKey(item.draft, item.images)
		var existing int64
		if err := tx.Model(&model.CommerceStudioRound{}).Where("project_id = ? AND dedup_key = ?", project.ID, dedup).Count(&existing).Error; err != nil {
			return 0, err
		}
		if existing > 0 {
			continue
		}
		ordinal++
		roundPlan, err := json.Marshal(model.CommerceStudioPlan{Images: item.images})
		if err != nil {
			return 0, err
		}
		round := model.CommerceStudioRound{
			ID:         kernel.NewID(),
			UserID:     project.UserID,
			ProjectID:  project.ID,
			Ordinal:    ordinal,
			DedupKey:   dedup,
			DraftJSON:  item.draft,
			PlanJSON:   string(roundPlan),
			ImageCount: len(item.images),
			Version:    1,
		}
		if err := tx.Create(&round).Error; err != nil {
			return 0, err
		}
		for _, image := range item.images {
			if image.TaskID != "" {
				archivedTasks[image.TaskID] = struct{}{}
			}
		}
		created++
	}
	plan.PreviousImages = nil
	raw, err := json.Marshal(plan)
	if err != nil {
		return 0, err
	}
	project.PlanJSON = string(raw)
	if project.ActiveRoundID == "" {
		project.ActiveRoundID = kernel.NewID()
	}
	return created, nil
}

// archiveEcommerceRound snapshots the stored active plan as one round. The
// dedup key makes retries idempotent even if the caller's revision handling
// failed and the same round is archived twice.
func archiveCommerceStudioRound(tx *gorm.DB, userID, projectID, draftJSON, planJSON string) (bool, error) {
	var plan model.CommerceStudioPlan
	if json.Unmarshal([]byte(planJSON), &plan) != nil {
		return false, nil
	}
	// Only admitted tasks become history, matching the client archive rule;
	// pending sketches are discarded when the round advances.
	admitted := make([]model.CommerceStudioPlanTask, 0, len(plan.Images))
	for _, image := range plan.Images {
		if image.TaskID == "" {
			continue
		}
		image.RoundID = ""
		admitted = append(admitted, image)
	}
	if len(admitted) == 0 {
		return false, nil
	}
	plan.Images = admitted
	draft := "{}"
	if json.Valid([]byte(draftJSON)) {
		draft = draftJSON
	}
	dedup := commerceStudioRoundKey(draft, plan.Images)
	var existing int64
	if err := tx.Model(&model.CommerceStudioRound{}).Where("project_id = ? AND dedup_key = ?", projectID, dedup).Count(&existing).Error; err != nil {
		return false, err
	}
	if existing > 0 {
		return true, nil
	}
	var maxOrdinal int
	if err := tx.Model(&model.CommerceStudioRound{}).Where("project_id = ?", projectID).Select("COALESCE(MAX(ordinal), 0)").Scan(&maxOrdinal).Error; err != nil {
		return false, err
	}
	plan.PreviousImages = nil
	roundPlan, err := json.Marshal(plan)
	if err != nil {
		return false, err
	}
	round := model.CommerceStudioRound{
		ID:         kernel.NewID(),
		UserID:     userID,
		ProjectID:  projectID,
		Ordinal:    maxOrdinal + 1,
		DedupKey:   dedup,
		DraftJSON:  draft,
		PlanJSON:   string(roundPlan),
		ImageCount: len(plan.Images),
		Version:    1,
	}
	return true, tx.Create(&round).Error
}

func commerceStudioRoundKey(draftJSON string, images []model.CommerceStudioPlanTask) string {
	if !json.Valid([]byte(draftJSON)) {
		draftJSON = "{}"
	}
	payload, err := json.Marshal(struct {
		Draft  json.RawMessage                `json:"draft"`
		Images []model.CommerceStudioPlanTask `json:"images"`
	}{Draft: json.RawMessage(draftJSON), Images: images})
	if err != nil {
		payload = []byte(draftJSON)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func (r *Repository) CommerceStudioRoundPage(userID, projectID string, limit, before int) ([]model.CommerceStudioRound, int64, error) {
	rounds := make([]model.CommerceStudioRound, 0)
	var total int64
	if err := r.db.Model(&model.CommerceStudioRound{}).Where("user_id = ? AND project_id = ?", userID, projectID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	query := r.db.Where("user_id = ? AND project_id = ?", userID, projectID)
	if before > 0 {
		query = query.Where("ordinal < ?", before)
	}
	err := query.Order("ordinal desc").Limit(limit).Find(&rounds).Error
	return rounds, total, err
}

func (r *Repository) CommerceStudioRound(userID, projectID, roundID string) (*model.CommerceStudioRound, error) {
	var round model.CommerceStudioRound
	if err := r.db.Where("user_id = ? AND project_id = ? AND id = ?", userID, projectID, roundID).First(&round).Error; err != nil {
		return nil, err
	}
	return &round, nil
}

func (r *Repository) CommerceStudioRoundCount(userID, projectID string) (int64, error) {
	total, _, err := r.CommerceStudioRoundStats(userID, projectID)
	return total, err
}

func (r *Repository) CommerceStudioRoundStats(userID, projectID string) (int64, int64, error) {
	var count, images int64
	err := r.db.Model(&model.CommerceStudioRound{}).
		Where("user_id = ? AND project_id = ?", userID, projectID).
		Select("COUNT(*), COALESCE(SUM(image_count), 0)").
		Row().Scan(&count, &images)
	return count, images, err
}

// EcommerceRoundCoverTaskIDs returns task IDs from the newest rounds only, so
// project cards can show historical covers without reading the whole history.
func (r *Repository) CommerceStudioRoundCoverTaskIDs(userID, projectID string, limit int) ([]string, error) {
	rounds := make([]model.CommerceStudioRound, 0, 4)
	if err := r.db.Where("user_id = ? AND project_id = ?", userID, projectID).Order("ordinal desc").Limit(4).Find(&rounds).Error; err != nil {
		return nil, err
	}
	ids := make([]string, 0, limit)
	for _, round := range rounds {
		var plan model.CommerceStudioPlan
		if json.Unmarshal([]byte(round.PlanJSON), &plan) != nil {
			continue
		}
		for i := len(plan.Images) - 1; i >= 0 && len(ids) < limit; i-- {
			if plan.Images[i].TaskID != "" {
				ids = append(ids, plan.Images[i].TaskID)
			}
		}
		if len(ids) >= limit {
			break
		}
	}
	return ids, nil
}

type CommerceStudioRoundImageUpdate struct {
	ExpectedVersion int64
	Image           *model.CommerceStudioPlanTask
	Remove          bool
}

// UpdateEcommerceRoundImage edits exactly one image of one archived round.
// Identical content is an idempotent success; otherwise the round version must
// match. Removing a missing image is also an idempotent success.
func (r *Repository) UpdateCommerceStudioRoundImage(userID, projectID, roundID, imageID string, update CommerceStudioRoundImageUpdate) (*model.CommerceStudioRound, bool, error) {
	var result model.CommerceStudioRound
	changed := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Where("user_id = ? AND project_id = ? AND id = ?", userID, projectID, roundID).First(&result).Error; err != nil {
			return err
		}
		var plan model.CommerceStudioPlan
		if err := json.Unmarshal([]byte(result.PlanJSON), &plan); err != nil {
			return err
		}
		next := plan
		next.Images = append([]model.CommerceStudioPlanTask{}, plan.Images...)
		found := false
		for i := range next.Images {
			if next.Images[i].ID != imageID {
				continue
			}
			found = true
			if update.Remove {
				next.Images = append(next.Images[:i], next.Images[i+1:]...)
			} else {
				image := *update.Image
				image.ID = imageID
				image.RoundID = ""
				next.Images[i] = image
			}
			break
		}
		if update.Remove && !found {
			return nil
		}
		if !update.Remove && !found {
			return gorm.ErrRecordNotFound
		}
		currentJSON, _ := json.Marshal(plan.Images)
		nextJSON, _ := json.Marshal(next.Images)
		if string(currentJSON) == string(nextJSON) {
			// The retried edit already landed (or the image was already gone);
			// report success without another write or version bump.
			return nil
		}
		if result.Version != update.ExpectedVersion {
			return ErrCommerceStudioRoundConflict
		}
		nextJSONFull, err := json.Marshal(next)
		if err != nil {
			return err
		}
		updated := tx.Model(&model.CommerceStudioRound{}).
			Where("user_id = ? AND project_id = ? AND id = ? AND version = ?", userID, projectID, roundID, update.ExpectedVersion).
			Updates(map[string]any{"plan_json": string(nextJSONFull), "image_count": len(next.Images), "version": update.ExpectedVersion + 1})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrCommerceStudioRoundConflict
		}
		result.PlanJSON = string(nextJSONFull)
		result.ImageCount = len(next.Images)
		result.Version = update.ExpectedVersion + 1
		changed = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &result, changed, nil
}
