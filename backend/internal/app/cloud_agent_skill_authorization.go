package app

import (
	"encoding/json"
	"maps"
	"slices"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/skills"
)

// RequireSkillAdministrator shares the skill domain's current database-backed authorization.
func (s *Service) RequireSkillAdministrator(userID string) error {
	return s.skillDomain().RequireAdministrator(userID)
}

func (s *Service) RequireSkillUser(userID string) error { return s.skillDomain().RequireUser(userID) }

// CloudAgentSkillCapabilities never derives skill access from client flags or cached roles.
func (s *Service) CloudAgentSkillCapabilities(userID string) (bool, []string, error) {
	if err := s.RequireSkillUser(userID); err != nil {
		return false, nil, err
	}
	return true, CloudAgentSupportedToolNames(), nil
}

func cloudAgentIsSkillTool(name string) bool {
	name = strings.TrimSpace(strings.TrimPrefix(name, "functions."))
	return strings.HasPrefix(name, "skill_") || name == "skills_load"
}

func cloudAgentRequireSkillToolAdministrator(repo *repository.Repository, userID, name string, services ...*Service) error {
	if !cloudAgentIsSkillTool(name) {
		return nil
	}
	if repo == nil {
		if service := cloudAgentToolService(services); service != nil {
			repo = service.repo
		}
	}
	if repo == nil {
		return kernel.Forbidden("无法确认管理员技能权限")
	}
	return skills.New(repo, "", nil).RequireUser(userID)
}

func cloudAgentToolsWithoutSkills(tools []map[string]any) []map[string]any {
	filtered := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		name := firstNonEmpty(stringField(function, "name"), stringField(tool, "name"))
		if !cloudAgentIsSkillTool(name) {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

func cloudAgentSkillHistoryError() error {
	return kernel.Forbidden("当前账号没有技能权限，此对话包含技能上下文，不能继续执行；请另开无技能对话，已有记录和生成结果仍保留")
}

// Only skill-bearing history is blocked after role revocation. Old tool declarations
// alone are filtered, so ordinary conversations with no skill use remain resumable.
func (s *Service) cloudAgentCheckSkillExecution(userID string, state *cloudAgentRuntime, canonical *canonicalAgentRequest, sessionJSONL string) error {
	admin, err := s.skillDomain().IsAdministrator(userID)
	if err != nil {
		return err
	}
	if admin {
		return nil
	}
	var versions map[string]string
	if state != nil {
		versions = state.SkillVersions
	}
	if len(versions) == 0 {
		// An explicitly frozen empty scope can search the public market or obtain
		// zero installed results. Older runs without a snapshot remain fail-closed.
		discoveryOnly := versions != nil
		if cloudAgentRuntimeHasSkillContext(state, discoveryOnly) || cloudAgentCanonicalHasSkillContext(canonical, discoveryOnly) || cloudAgentPiSessionHasSkillContext(sessionJSONL, discoveryOnly) {
			return cloudAgentSkillHistoryError()
		}
		return nil
	}
	// Recheck the frozen scope in one metadata-only query. File contents are loaded
	// by skill_read_file only for the skill the model actually requests.
	entries, err := s.skillDomain().AgentSkillCatalogByIDs(userID, slices.Collect(maps.Keys(versions)))
	if err != nil {
		return err
	}
	if len(entries) != len(versions) {
		return cloudAgentSkillHistoryError()
	}
	for _, entry := range entries {
		if !entry.Installed || entry.VersionID == "" || entry.VersionID != versions[entry.SkillID] {
			return cloudAgentSkillHistoryError()
		}
	}
	return nil
}

func cloudAgentRequiresFrozenSkill(name string, discoveryOnly bool) bool {
	name = strings.TrimSpace(strings.TrimPrefix(name, "functions."))
	if discoveryOnly && (name == "skill_search" || name == "skill_market_search" || name == "skill_recommend") {
		return false
	}
	return cloudAgentIsSkillTool(name)
}

func cloudAgentRuntimeHasSkillContext(state *cloudAgentRuntime, discoveryOnly bool) bool {
	if state == nil {
		return false
	}
	if state.Request.SkillsEnabled || len(state.Request.PinnedSkillIDs) > 0 || len(cloudAgentPromptSkillMentions(state.Request.Prompt)) > 0 || len(state.Skills) > 0 || len(state.SkillVersions) > 0 || strings.TrimSpace(state.SkillHints) != "" || !discoveryOnly && (len(state.MarketSuggestions) > 0 || state.SkillRecommendations > 0) {
		return true
	}
	for key := range state.ToolReadResults {
		name, _, _ := strings.Cut(key, ":")
		if cloudAgentRequiresFrozenSkill(name, discoveryOnly) {
			return true
		}
	}
	for _, call := range state.Calls {
		if cloudAgentRequiresFrozenSkill(call.Function.Name, discoveryOnly) {
			return true
		}
	}
	for _, message := range state.TextHistory {
		if cloudAgentIsSkillContextSource(message.AgentContextSource) || (message.Role == "system" && cloudAgentSystemHasSkillCatalog(message.Content)) {
			return true
		}
	}
	return cloudAgentCanonicalHasSkillContext(&state.Canonical, discoveryOnly)
}

func cloudAgentIsSkillContextSource(source string) bool {
	return source == "skills" || source == "skills_load" || strings.HasPrefix(source, "skill_")
}

func cloudAgentSystemHasSkillCatalog(text string) bool {
	// Earlier runs embedded the installed skill catalog in their system prompt.
	_, catalog, found := strings.Cut(text, "## 已安装技能目录\n")
	return found && !strings.HasPrefix(strings.TrimSpace(catalog), "用户还没有安装可自动使用的技能。")
}

func cloudAgentCanonicalHasSkillContext(canonical *canonicalAgentRequest, discoveryOnly bool) bool {
	if canonical == nil {
		return false
	}
	if cloudAgentSystemHasSkillCatalog(canonical.SystemPrompt) {
		return true
	}
	for _, message := range canonical.Messages {
		if cloudAgentValueHasSkillContext(message, discoveryOnly) {
			return true
		}
	}
	return false
}

// Runtime snapshots are structured JSONL; inspect provenance and tool identities,
// not ordinary prose containing the word "skill".
func cloudAgentPiSessionHasSkillContext(session string, discoveryOnly bool) bool {
	for _, line := range strings.Split(session, "\n") {
		var entry any
		if json.Unmarshal([]byte(line), &entry) == nil && cloudAgentValueHasSkillContext(entry, discoveryOnly) {
			return true
		}
	}
	return false
}

func cloudAgentValueHasSkillContext(value any, discoveryOnly bool) bool {
	switch item := value.(type) {
	case map[string]any:
		if cloudAgentIsSkillContextSource(stringField(item, cloudAgentContextSourceKey)) || cloudAgentRequiresFrozenSkill(stringField(item, "toolName"), discoveryOnly) {
			return true
		}
		if function, ok := item["function"].(map[string]any); ok && cloudAgentRequiresFrozenSkill(stringField(function, "name"), discoveryOnly) {
			return true
		}
		kind, role := stringField(item, "type"), stringField(item, "role")
		if (kind == "toolCall" || role == "toolResult" || role == "tool") && cloudAgentRequiresFrozenSkill(stringField(item, "name"), discoveryOnly) {
			return true
		}
		if role == "system" && cloudAgentSystemHasSkillCatalog(stringField(item, "content")) {
			return true
		}
		if cloudAgentSystemHasSkillCatalog(stringField(item, "systemPrompt")) {
			return true
		}
		for _, key := range []string{"skills", "enabledSkills", "skillVersions", "skillHints"} {
			if raw, ok := item[key]; ok && raw != nil {
				encoded, _ := json.Marshal(raw)
				if string(encoded) != "[]" && string(encoded) != "{}" && string(encoded) != `""` && string(encoded) != "null" && string(encoded) != "false" {
					return true
				}
			}
		}
		for _, nested := range item {
			if cloudAgentValueHasSkillContext(nested, discoveryOnly) {
				return true
			}
		}
	case []any:
		for _, nested := range item {
			if cloudAgentValueHasSkillContext(nested, discoveryOnly) {
				return true
			}
		}
	}
	return false
}

func (s *Service) cloudAgentDecodeForExecution(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		return state, err
	}
	if err := s.cloudAgentCheckSkillExecution(run.UserID, &state, nil, ""); err != nil {
		return state, err
	}
	return state, nil
}

func cloudAgentMemberSkillNames(skills []cloudAgentSkill) []string {
	names := make([]string, 0, len(skills))
	for _, skill := range skills {
		names = append(names, skill.Name)
	}
	return names
}
