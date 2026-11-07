package skills

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestPresetsExcludeOfflineSkills(t *testing.T) {
	presets, err := New(nil, "", nil).SkillPresets()
	if err != nil {
		t.Fatal(err)
	}
	target := presets[0]
	svc, db := newSkillEditTestService(t)
	for _, id := range target.SkillIDs {
		if err := db.Create(&model.Skill{ID: id, Status: 1, Source: 3, SourceType: "builtin"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	before, err := svc.SkillPresets()
	if err != nil || len(before) == 0 {
		t.Fatalf("published preset missing: %v", err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", target.SkillIDs[0]).Update("status", model.SkillStatusOffline).Error; err != nil {
		t.Fatal(err)
	}
	after, err := svc.SkillPresets()
	if err != nil {
		t.Fatal(err)
	}
	for _, preset := range after {
		if preset.PresetID == target.PresetID {
			t.Fatal("offline skill remained in public preset")
		}
	}
}
