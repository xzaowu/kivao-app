package workbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"testing"
	"yingce/backend/internal/model"
)

func TestInspirationExamplesLimitOrderOwnershipAndClear(t *testing.T) {
	s, db, admin := inspirationTest(t)
	examples := []InspirationExample{}
	for index := 0; index < 10; index++ {
		id, kind := fmt.Sprintf("example-%d", index), "image"
		if index == 1 {
			kind = "video"
		}
		if err := db.Create(&model.Resource{ID: id, UserID: admin.ID, Kind: kind, Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
		examples = append(examples, InspirationExample{ResourceID: id, MediaKind: kind})
	}
	input := promptInput()
	input.ResourceID, input.MediaKind, input.AdditionalExamples = examples[0].ResourceID, examples[0].MediaKind, examples[1:]
	saved, err := s.SaveInspiration(admin, "", input, false)
	if err != nil || len(saved.Examples) != 10 {
		t.Fatalf("10 examples: %v", err)
	}
	for index, example := range saved.Examples {
		if example.ResourceID != examples[index].ResourceID || example.MediaURL == "" {
			t.Fatal("example order or access URL lost")
		}
	}
	invalid := saved.InspirationInput
	invalid.AdditionalExamples = append(append([]InspirationExample{}, examples[1:]...), examples[0])
	if _, err := s.SaveInspiration(admin, saved.ID, invalid, false); err == nil {
		t.Fatal("11 examples accepted")
	}
	invalid.AdditionalExamples = []InspirationExample{examples[0]}
	if _, err := s.SaveInspiration(admin, saved.ID, invalid, false); err == nil {
		t.Fatal("duplicate example accepted")
	}
	if err := db.Create(&model.Resource{ID: "foreign-extra", UserID: "another", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	invalid.AdditionalExamples = []InspirationExample{{ResourceID: "foreign-extra", MediaKind: "image"}}
	if _, err := s.SaveInspiration(admin, saved.ID, invalid, false); err == nil {
		t.Fatal("foreign additional example accepted")
	}
	invalid.AdditionalExamples = []InspirationExample{{ResourceID: examples[1].ResourceID, MediaKind: "image"}}
	if _, err := s.SaveInspiration(admin, saved.ID, invalid, false); err == nil {
		t.Fatal("additional example kind mismatch accepted")
	}
	reordered := saved.InspirationInput
	reordered.ResourceID, reordered.MediaKind = examples[1].ResourceID, examples[1].MediaKind
	reordered.AdditionalExamples = []InspirationExample{examples[0]}
	moved, err := s.SaveInspiration(&model.User{ID: "other-admin", Role: model.UserRoleAdmin}, saved.ID, reordered, false)
	if err != nil || moved.MediaKind != "video" || moved.Examples[1].ResourceID != examples[0].ResourceID {
		t.Fatalf("reorder shared examples: %v", err)
	}
	cleared := moved.InspirationInput
	cleared.ResourceID, cleared.MediaKind, cleared.AdditionalExamples = "", "", nil
	empty, err := s.SaveInspiration(admin, saved.ID, cleared, false)
	if err != nil || len(empty.Examples) != 0 || empty.MediaURL != "" {
		t.Fatal("clearing examples restored old cover")
	}
}

func TestInspirationToolIncludesAtMostTenLiveExamples(t *testing.T) {
	s, db, admin := inspirationTest(t)
	items := []ResultExampleItem{}
	for index := 0; index < 12; index++ {
		items = append(items, ResultExampleItem{ResourceID: fmt.Sprintf("tool-example-%d", index), Kind: "image"})
	}
	guide, err := json.Marshal(map[string]any{"resultExample": ResultExample{Items: items}})
	if err != nil {
		t.Fatal(err)
	}
	tool := model.WorkbenchTool{ID: "many-examples", Kind: "image", Enabled: true, CapabilityJSON: "{}", GuideJSON: string(guide)}
	if err := db.Create(&tool).Error; err != nil {
		t.Fatal(err)
	}
	entry, err := s.SaveInspiration(admin, "", InspirationInput{Type: "tool", ToolID: tool.ID, Enabled: true}, false)
	if err != nil || len(entry.Examples) != 10 || entry.ResourceID != items[0].ResourceID {
		t.Fatalf("tool example view: %v", err)
	}
	if len(entry.AdditionalExamples) != 0 {
		t.Fatal("tool examples were copied into entry configuration")
	}
}

func inspirationTest(t *testing.T) (*Service, *gorm.DB, *model.User) {
	s, db, _ := newWorkbenchTest(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	return s, db, &model.User{ID: "admin", Role: model.UserRoleAdmin}
}
func promptInput() InspirationInput {
	return InspirationInput{Type: "prompt", Title: "测试灵感", Mode: "image", Category: "商品", Prompt: "生成一张商品图片", Enabled: true}
}

func TestInspirationCRUDAndStaleEdits(t *testing.T) {
	s, db, admin := inspirationTest(t)
	items, err := s.Inspirations(nil, false)
	if err != nil || len(items) != 0 {
		t.Fatalf("new hall must be empty: %v", err)
	}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	for _, actor := range []*model.User{nil, user} {
		if _, err := s.Inspirations(actor, true); err == nil {
			t.Fatal("admin list accepted a non-admin")
		}
		if _, err := s.SaveInspiration(actor, "", promptInput(), false); err == nil {
			t.Fatal("non-admin write accepted")
		}
	}
	input := promptInput()
	input.Enabled = false
	created, err := s.SaveInspiration(admin, "", input, false)
	if err != nil {
		t.Fatal(err)
	}
	if items, err := s.Inspirations(nil, false); err != nil || len(items) != 0 {
		t.Fatal("draft leaked")
	}
	edited := created.InspirationInput
	edited.Title = "改后标题"
	edited.Enabled = true
	saved, err := s.SaveInspiration(admin, created.ID, edited, false)
	if err != nil || saved.Version != 2 {
		t.Fatalf("update: %v", err)
	}
	if _, err := s.SaveInspiration(admin, created.ID, edited, false); err == nil {
		t.Fatal("stale edit accepted")
	}
	if _, err := s.SaveInspiration(admin, created.ID, edited, true); err == nil {
		t.Fatal("stale delete accepted")
	}
	items, err = s.Inspirations(nil, false)
	if err != nil || len(items) != 1 || items[0].Title != "改后标题" {
		t.Fatalf("public list: %#v %v", items, err)
	}
	if _, err := s.SaveInspiration(admin, created.ID, saved.InspirationInput, true); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.AdminAuditEvent{}).Count(&count).Error; err != nil || count != 3 {
		t.Fatalf("audit: %d %v", count, err)
	}
}

func TestInspirationToolUsesLiveMetadataAndDoesNotExposePrompt(t *testing.T) {
	s, db, admin := inspirationTest(t)
	tool := model.WorkbenchTool{ID: "tool", Name: "原工具名", Kind: "video", Enabled: true, CapabilityJSON: "{}", GuideJSON: "{}"}
	if err := db.Create(&tool).Error; err != nil {
		t.Fatal(err)
	}
	linked, err := s.SaveInspiration(admin, "", InspirationInput{Type: "tool", ToolID: tool.ID, Enabled: true, Prompt: "不得泄漏"}, false)
	if err != nil || linked.Title != tool.Name || linked.Prompt != "" || linked.Mode != "video" {
		t.Fatalf("link: %#v %v", linked, err)
	}
	db.Model(&tool).Update("name", "更新后的工具名")
	db.Model(&tool).Update("category_id", "scene")
	items, err := s.Inspirations(nil, false)
	if err != nil || len(items) != 1 || items[0].Title != "更新后的工具名" {
		t.Fatal("tool metadata was duplicated")
	}
	if items[0].Category != "scene" {
		t.Fatal("category did not follow tool")
	}
	adminItems, err := s.Inspirations(admin, true)
	if err != nil || adminItems[0].Category != "" {
		t.Fatal("derived tool category would be saved as an override")
	}
	db.Model(&tool).Update("enabled", false)
	items, err = s.Inspirations(nil, false)
	if err != nil || len(items) != 0 {
		t.Fatal("disabled tool leaked")
	}
	if _, err := s.SaveInspiration(admin, linked.ID, linked.InspirationInput, true); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&model.WorkbenchTool{}, "id = ?", tool.ID).Error; err != nil {
		t.Fatal("unlink removed original tool")
	}
}

func TestInspirationMediaOwnershipAndValidation(t *testing.T) {
	s, db, admin := inspirationTest(t)
	for _, resource := range []model.Resource{
		{ID: "own", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "clip", UserID: "admin", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "foreign", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "pending", UserID: "admin", Kind: "image", Status: "pending"},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"foreign", "pending", "missing"} {
		input := promptInput()
		input.ResourceID = id
		input.MediaKind = "image"
		if _, err := s.SaveInspiration(admin, "", input, false); err == nil {
			t.Fatalf("invalid media accepted: %s", id)
		}
	}
	input := promptInput()
	input.ResourceID = "own"
	input.MediaKind = "video"
	if _, err := s.SaveInspiration(admin, "", input, false); err == nil {
		t.Fatal("wrong media kind accepted")
	}
	input.MediaKind = "image"
	created, err := s.SaveInspiration(admin, "", input, false)
	if err != nil {
		t.Fatal(err)
	}
	other := &model.User{ID: "other-admin", Role: model.UserRoleAdmin}
	if _, err := s.SaveInspiration(other, created.ID, created.InspirationInput, false); err != nil {
		t.Fatalf("existing shared media cannot be retained: %v", err)
	}
	invalid := promptInput()
	clip := promptInput()
	clip.ResourceID, clip.MediaKind, clip.Mode = "clip", "video", "video"
	if view, err := s.SaveInspiration(admin, "", clip, false); err != nil || view.MediaKind != "video" {
		t.Fatalf("valid video rejected: %v", err)
	}
	invalid.Type = "unknown"
	if _, err := s.SaveInspiration(admin, "", invalid, false); err == nil {
		t.Fatal("invalid type accepted")
	}
}

func TestInspirationAuditFailureRollsBackEntry(t *testing.T) {
	s, db, admin := inspirationTest(t)
	if err := db.Callback().Create().Before("gorm:create").Register("reject_inspiration_audit", func(tx *gorm.DB) {
		if tx.Statement.Table == "admin_audit_events" {
			tx.AddError(errors.New("audit unavailable"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveInspiration(admin, "", promptInput(), false); err == nil {
		t.Fatal("audit failure ignored")
	}
	items, err := s.Inspirations(admin, true)
	if err != nil || len(items) != 0 {
		t.Fatal("partial entry persisted")
	}
}
