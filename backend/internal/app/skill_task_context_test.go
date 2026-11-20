package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestSkillTaskMemberLoadsContentOnlyForExecution(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	skillAdministratorFixture(t, db, "skill-curator")
	const body = "# Workflow\nPRIVATE_WORKFLOW_TEXT"
	skill, err := s.CreateSkill("skill-curator", SkillMutationRequest{SkillName: "商品方法", Description: "PRIVATE_DESCRIPTION", Instruction: body, Tag: "others"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetSkillAdded("user", skill.SkillID, true); err != nil {
		t.Fatal(err)
	}
	raw := map[string]any{"metadata": map[string]any{"skillIds": []string{skill.SkillID}, "skillContextDelivery": "server"}}
	if err := s.validateTaskSkills("user", raw); err != nil {
		t.Fatal(err)
	}
	metadata := raw["metadata"].(map[string]any)
	input := canvasGenerationInput{Mode: "text", Prompt: "写一份策划", Metadata: metadata}
	if err := s.applyTaskSkills("user", &input); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(input.Prompt, "PRIVATE_WORKFLOW_TEXT") {
		t.Fatal("worker did not receive native skill body")
	}
	canonical := &canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": "原始规划"}}}
	planner := canvasGenerationInput{Mode: "text", Prompt: "做规划", Metadata: metadata, AgentRequests: &agentToolRequests{Canonical: canonical}}
	if err := s.applyTaskSkills("user", &planner); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stringField(planner.AgentRequests.Canonical.Messages[0], "content"), "PRIVATE_WORKFLOW_TEXT") {
		t.Fatal("tool planning did not receive server context")
	}
	if len(canonical.Messages) != 1 {
		t.Fatal("server context mutated the stored canonical request")
	}
	if err := s.validateTaskSkills("user", map[string]any{"metadata": map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceDraft": EcommerceDraft{SkillIDs: []string{"missing"}}}}); err == nil {
		t.Fatal("typed ecommerce draft bypassed admission validation")
	}
	encoded, _ := json.Marshal(raw)
	if strings.Contains(string(encoded), "PRIVATE_WORKFLOW_TEXT") || strings.Contains(publicTaskInputJSON(string(encoded)), "PRIVATE_WORKFLOW_TEXT") {
		t.Fatal("execution modified public input")
	}
	if _, err := s.SetSkillAdded("user", skill.SkillID, false); err != nil {
		t.Fatal(err)
	}
	if err := s.applyTaskSkills("user", &input); err == nil {
		t.Fatal("worker ignored removal since admission")
	}
	if err := s.validateTaskSkills("user", map[string]any{"metadata": map[string]any{"skillIds": []string{"missing"}}}); err == nil {
		t.Fatal("unknown skill admitted")
	}
}

func TestSkillMemberAgentUsesNativeFilesButPublicRunShowsNames(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	skillAdministratorFixture(t, db, "skill-curator")
	skill, err := s.CreateSkill("skill-curator", SkillMutationRequest{SkillName: "商品方法", Description: "PRIVATE_DESCRIPTION", Instruction: "# Workflow\nPRIVATE_WORKFLOW_TEXT", Tag: "others"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetSkillAdded("user", skill.SkillID, true); err != nil {
		t.Fatal(err)
	}
	req := skillAuthorizationRequest()
	req.PinnedSkillIDs = []string{skill.SkillID}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	call := skillFeedbackCall(skill.SkillID, "SKILL.md")
	result, err := cloudAgentReadTool(s.repo, "user", &state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if !strings.Contains(string(encoded), "PRIVATE_WORKFLOW_TEXT") {
		t.Fatal("member Agent did not read native file")
	}
	state.event(run.ID, "tool_completed", map[string]any{"toolName": "skill_read_file", "result": result})
	if err := s.repo.MutateCloudAgent("user", run.ID, execution.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	view, err := s.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(view)
	for _, secret := range []string{"PRIVATE_WORKFLOW_TEXT", "PRIVATE_DESCRIPTION", "SKILL.md"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("public run leaked %s", secret)
		}
	}
	if !strings.Contains(string(encoded), skill.SkillName) {
		t.Fatal("skill name missing")
	}
}
