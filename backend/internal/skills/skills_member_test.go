package skills

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestSkillMemberNamesAndServerRuntimeAreSeparate(t *testing.T) {
	svc, db, admin, member, created := newSkillAuthorizationTest(t)
	check := func(value any) {
		t.Helper()
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{created.Instruction, created.Description, "Secret legacy content"} {
			if secret != "" && strings.Contains(string(raw), secret) {
				t.Fatalf("member response leaked skill content: %s", raw)
			}
		}
	}
	listed, err := svc.Skills(member.ID, SkillListRequest{})
	if err != nil || len(listed.Skills) == 0 {
		t.Fatalf("catalog: %v", err)
	}
	check(listed)
	hidden, err := svc.Skills(member.ID, SkillListRequest{Search: created.Instruction})
	if err != nil || hidden.TotalCount != 0 {
		t.Fatalf("hidden instruction used as search oracle: %v", err)
	}
	detail, err := svc.SkillDetail(member.ID, created.SkillID)
	if err != nil || detail.SkillName != created.SkillName || detail.Instruction != "" || detail.SourceURL != "" {
		t.Fatalf("name-only detail: %#v %v", detail, err)
	}
	check(detail)
	legacy, err := svc.SkillDetail(member.ID, "legacy-skill")
	if err != nil {
		t.Fatal(err)
	}
	check(legacy)
	added, err := svc.AddedSkills(member.ID)
	if err != nil || len(added) == 0 {
		t.Fatalf("added: %v", err)
	}
	check(added)
	for _, mutation := range []func() (*SkillItem, error){
		func() (*SkillItem, error) { return svc.SetSkillLiked(member.ID, created.SkillID, true) },
		func() (*SkillItem, error) { return svc.SetSkillAdded(member.ID, created.SkillID, true) },
		func() (*SkillItem, error) { return svc.SetSkillAgentMode(member.ID, created.SkillID, "manual") },
	} {
		item, err := mutation()
		if err != nil {
			t.Fatal(err)
		}
		check(item)
	}
	runtime, err := svc.RuntimeSkillDetail(member.ID, created.SkillID)
	if err != nil || runtime.Instruction != created.Instruction {
		t.Fatalf("server execution lost content: %v", err)
	}
	file, err := svc.RuntimeSkillPackageFile(member.ID, created.SkillID, "SKILL.md")
	if err != nil || !strings.Contains(file.Content, created.Instruction) {
		t.Fatalf("native runtime file: %v", err)
	}
	_, err = svc.SkillPackageFile(member.ID, created.SkillID, "SKILL.md")
	requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
	private := createEditableSkill(t, svc, admin.ID, true)
	_, err = svc.SetSkillAdded(member.ID, private.SkillID, true)
	requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
	if _, err := svc.SetSkillAdded(member.ID, created.SkillID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RuntimeSkillDetail(member.ID, created.SkillID); err == nil {
		t.Fatal("uninstalled skill executed")
	}
	if err := db.Model(&model.User{}).Where("id = ?", member.ID).Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	_, err = svc.Skills(member.ID, SkillListRequest{})
	requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
}

func TestSkillMemberPublicMetadataUsesSharedCountsAndPreservesPrivacy(t *testing.T) {
	svc, db, admin, member, created := newSkillAuthorizationTest(t)
	if err := db.Model(&model.Skill{}).Where("id = ?", created.SkillID).Updates(map[string]any{"initial_like_count": 5, "initial_added_count": 8}).Error; err != nil {
		t.Fatal(err)
	}
	other := createSkillTestUser(t, db, "other-member", model.UserRoleUser, model.UserStatusActive)
	if err := db.Create(&model.UserSkillState{ID: "other-member-state", UserID: other.ID, SkillID: created.SkillID, Liked: true, Added: true}).Error; err != nil {
		t.Fatal(err)
	}
	check := func(wantLikes, wantAdded int64) {
		t.Helper()
		memberItem, err := svc.SkillDetail(member.ID, created.SkillID)
		if err != nil {
			t.Fatal(err)
		}
		if memberItem.Tag != created.Tag || memberItem.LikeCount != wantLikes || memberItem.AddedCount != wantAdded {
			t.Fatalf("member stats = %#v", memberItem)
		}
		if memberItem.Description != "" || memberItem.Instruction != "" || memberItem.SourceURL != "" || memberItem.OwnerUID != "" {
			t.Fatal("public metadata exposed protected content")
		}
		adminItem, err := svc.SkillDetail(admin.ID, created.SkillID)
		if err != nil || adminItem.LikeCount != memberItem.LikeCount || adminItem.AddedCount != memberItem.AddedCount {
			t.Fatal("member and admin count definitions differ")
		}
		listed, err := svc.Skills(member.ID, SkillListRequest{})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range listed.Skills {
			if item.SkillID == created.SkillID {
				found = true
				if item.LikeCount != wantLikes || item.AddedCount != wantAdded || item.Tag != created.Tag {
					t.Fatal("list dropped public metadata")
				}
			}
		}
		if !found {
			t.Fatal("public skill missing from member catalog")
		}
	}
	// Initial counts include the creator's existing installation and both members.
	check(6, 11)
	if _, err := svc.SetSkillLiked(member.ID, created.SkillID, true); err != nil {
		t.Fatal(err)
	}
	check(7, 11)
	if _, err := svc.SetSkillAdded(member.ID, created.SkillID, false); err != nil {
		t.Fatal(err)
	}
	check(7, 10)
}
