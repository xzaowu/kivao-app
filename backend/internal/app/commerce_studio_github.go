package app

import (
	"context"
	"yingce/backend/internal/skills"
)

type SkillGitHubDiscoverRequest = skills.SkillGitHubDiscoverRequest

func (s *Service) DiscoverGitHubSkills(ctx context.Context, userID string, req SkillGitHubDiscoverRequest) (*skills.SkillGitHubDiscovery, error) {
	return s.skillDomain().DiscoverGitHubSkills(ctx, userID, req)
}
