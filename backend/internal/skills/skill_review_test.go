package skills

import (
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestSkillPublicationReviewLifecycle(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "reviewer", Username: "reviewer", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	reader := &model.User{ID: "reader", Username: "reader", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(reader).Error; err != nil {
		t.Fatal(err)
	}
	item := createEditableSkill(t, svc, "owner", false)
	if item.Status != model.SkillStatusPending {
		t.Fatalf("new public status = %d", item.Status)
	}
	if _, err := svc.AdminReviewSkills(reader, 0, "", 1, 20); err == nil {
		t.Fatal("ordinary user entered review list")
	}
	if err := svc.ReviewSkill(reader, item.SkillID, item.VersionID, item.UpdatedAt, "approve", ""); err == nil {
		t.Fatal("ordinary user approved skill")
	}
	queue, err := svc.AdminReviewSkills(admin, model.SkillStatusPending, "分镜", 1, 20)
	if err != nil || queue.TotalCount != 1 {
		t.Fatalf("queue = %#v, %v", queue, err)
	}
	if _, err := svc.SkillPackageFile(admin.ID, item.SkillID, "SKILL.md"); err != nil {
		t.Fatalf("reviewer cannot inspect pending content: %v", err)
	}
	assertHidden := func() {
		t.Helper()
		for _, scope := range []string{"public", "mine", "favorites"} {
			list, err := svc.Skills(reader.ID, SkillListRequest{Scope: scope, Page: 1, PageSize: 20})
			if err != nil || list.TotalCount != 0 {
				t.Fatalf("hidden skill in %s: %#v, %v", scope, list, err)
			}
		}
		if _, err := svc.SkillDetail(reader.ID, item.SkillID); err == nil {
			t.Fatal("hidden detail readable")
		}
		if _, err := svc.SkillPackageBundle(reader.ID, item.SkillID); err == nil {
			t.Fatal("hidden bundle readable")
		}
		if _, _, _, err := svc.SkillPackageRawFile(reader.ID, item.SkillID, "SKILL.md"); err == nil {
			t.Fatal("hidden raw file readable")
		}
		if _, err := svc.SetSkillAdded(reader.ID, item.SkillID, true); err == nil {
			t.Fatal("hidden skill addable")
		}
		rows, err := repository.New(db).AgentSkillCatalogRowsByIDs(reader.ID, []string{item.SkillID})
		if err != nil || len(rows) != 0 {
			t.Fatalf("hidden Agent catalog: %v, %v", rows, err)
		}
		market, err := repository.New(db).MarketSkillCatalogRows(reader.ID, 20)
		if err != nil || len(market) != 0 {
			t.Fatalf("hidden market catalog: %v, %v", market, err)
		}
		if _, err := svc.SkillPackageFile("owner", item.SkillID, "SKILL.md"); err != nil {
			t.Fatalf("owner lost access: %v", err)
		}
	}
	assertHidden()
	review := func(action string) {
		t.Helper()
		current, err := svc.SkillDetail("owner", item.SkillID)
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.ReviewSkill(admin, current.SkillID, current.VersionID, current.UpdatedAt, action, "review-test"); err != nil {
			t.Fatal(err)
		}
	}
	review("reject")
	assertHidden()
	review("approve")
	approved, err := svc.SkillDetail(reader.ID, item.SkillID)
	if err != nil || approved.Status != model.SkillStatusPublished {
		t.Fatalf("approval not visible: %v", err)
	}
	if _, err := svc.SetSkillAdded(reader.ID, item.SkillID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetSkillLiked(reader.ID, item.SkillID, true); err != nil {
		t.Fatal(err)
	}
	review("offline")
	assertHidden()
	state, err := repository.New(db).UserSkillState(reader.ID, item.SkillID)
	if err != nil || !state.Added || !state.Liked {
		t.Fatalf("offline deleted relationships: %#v, %v", state, err)
	}
	if err := svc.ReviewSkill(admin, approved.SkillID, approved.VersionID, approved.UpdatedAt, "approve", ""); err == nil {
		t.Fatal("stale review republished offline skill")
	}
	review("approve")
	before, err := svc.SkillDetail("owner", item.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := svc.UpdateSkill("owner", item.SkillID, SkillMutationRequest{SkillName: before.SkillName, Description: "更新后的简介", Instruction: before.Instruction, Tag: before.Tag})
	if err != nil || updated.Status != model.SkillStatusPending {
		t.Fatalf("edited public skill did not return to pending: %#v, %v", updated, err)
	}
	assertHidden()
	if err := svc.ReviewSkill(admin, before.SkillID, before.VersionID, before.UpdatedAt, "approve", ""); err == nil {
		t.Fatal("stale version approved changed content")
	}
	review("approve")
	if _, err := svc.EditSkillPackageFiles("owner", item.SkillID, SkillPackageEditRequest{BaseVersionID: updated.VersionID, Operations: []SkillPackageFileOperation{{Op: "write", Path: "SKILL.md", Content: stringPointer("# 新正文\n\n必须重新审核。")}}}); err != nil {
		t.Fatal(err)
	}
	assertHidden()
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "skill.review").Count(&audits).Error; err != nil || audits != 5 {
		t.Fatalf("audit count = %d, %v", audits, err)
	}
}

func TestPrivateSkillAndStaleWritesStaySafe(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	private := createEditableSkill(t, svc, "owner", true)
	if private.Status != model.SkillStatusPublished {
		t.Fatal("private skill unusable")
	}
	if _, err := svc.SkillDetail(admin.ID, private.SkillID); err == nil {
		t.Fatal("review bypass exposed private skill")
	}
	if err := svc.ReviewSkill(admin, private.SkillID, private.VersionID, private.UpdatedAt, "approve", ""); err == nil {
		t.Fatal("admin published private skill without owner request")
	}
	item := createEditableSkill(t, svc, "owner", false)
	stale, err := repository.New(db).Skill(item.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ReviewSkill(admin, item.SkillID, item.VersionID, item.UpdatedAt, "offline", ""); err != nil {
		t.Fatal(err)
	}
	stale.Status = model.SkillStatusPublished
	if err := repository.New(db).SaveSkill(stale); err == nil {
		t.Fatal("stale sync/metadata write undid moderation")
	}
	current, err := repository.New(db).Skill(item.SkillID)
	if err != nil || current.Status != model.SkillStatusOffline {
		t.Fatalf("offline lost: %#v %v", current, err)
	}
	if err := db.Exec("DROP TABLE admin_audit_events").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.ReviewSkill(admin, current.ID, current.CurrentVersionID, current.UpdatedAt, "approve", ""); err == nil {
		t.Fatal("review succeeded without audit")
	}
	current, err = repository.New(db).Skill(item.SkillID)
	if err != nil || current.Status != model.SkillStatusOffline {
		t.Fatal("failed audit did not roll back review")
	}
}

func TestBuiltinOfflineSurvivesCatalogRefresh(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	item := model.Skill{ID: "builtin-review", SourceType: "builtin", Source: 3, Status: model.SkillStatusOffline, Name: "旧名称"}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	item.Status = model.SkillStatusPublished
	item.Name = "新名称"
	if err := svc.repo.UpsertBuiltinSkills([]model.Skill{item}); err != nil {
		t.Fatal(err)
	}
	current, err := svc.repo.Skill(item.ID)
	if err != nil || current.Status != model.SkillStatusOffline || current.Name != "新名称" {
		t.Fatalf("refresh lost moderation: %#v %v", current, err)
	}
}
