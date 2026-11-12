package skills

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"
)

type SkillGitHubDiscoverRequest struct {
	URL    string `json:"url"`
	Ref    string `json:"ref"`
	Subdir string `json:"subdir"`
}

type SkillGitHubCandidate struct {
	Subdir string `json:"subdir"`
	Name   string `json:"name"`
}

type SkillGitHubDiscovery struct {
	SourceURL    string                 `json:"sourceUrl"`
	SourceRef    string                 `json:"sourceRef"`
	SourceCommit string                 `json:"sourceCommit"`
	Skills       []SkillGitHubCandidate `json:"skills"`
}

type githubSkillTree struct {
	Truncated bool                   `json:"truncated"`
	Tree      []githubSkillTreeEntry `json:"tree"`
}

type githubSkillTreeEntry struct {
	Path string `json:"path"`
	Mode string `json:"mode"`
	Type string `json:"type"`
	Size int64  `json:"size"`
}

const maxGitHubRepositoryEntries = 10000
const maxGitHubTreeBytes = 8 << 20

func (s *Service) DiscoverGitHubSkills(ctx context.Context, userID string, req SkillGitHubDiscoverRequest) (*SkillGitHubDiscovery, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	spec, err := parseGitHubSkillURL(req.URL, req.Ref, req.Subdir)
	if err != nil {
		return nil, err
	}
	result, err := discoverGitHubSkillsWithClient(ctx, &http.Client{Timeout: 2 * time.Minute}, spec)
	if err != nil {
		var appErr *kernel.AppError
		if errors.As(err, &appErr) {
			return nil, err
		}
		return nil, kernel.WrapAppError(http.StatusBadGateway, "GitHub 技能目录读取失败，请检查仓库地址和网络", err)
	}
	return result, nil
}

func discoverGitHubSkillsWithClient(ctx context.Context, client *http.Client, spec githubSkillSpec) (*SkillGitHubDiscovery, error) {
	if spec.Subdir != "" {
		normalized, err := normalizeSkillPath(spec.Subdir)
		if err != nil {
			return nil, err
		}
		spec.Subdir = normalized
	}
	commit, ref, err := resolveGitHubSkillRef(ctx, client, spec)
	if err != nil {
		return nil, err
	}
	tree, err := fetchGitHubRepositoryTree(ctx, client, spec, commit)
	if err != nil {
		return nil, err
	}
	items := make([]SkillGitHubCandidate, 0)
	seen := make(map[string]bool)
	exactManifest := "SKILL.md"
	if spec.Subdir != "" {
		exactManifest = spec.Subdir + "/SKILL.md"
	}
	hasExactManifest := false
	for _, entry := range tree.Tree {
		if entry.Path == exactManifest {
			hasExactManifest = true
			break
		}
	}
	for _, entry := range tree.Tree {
		if hasExactManifest && entry.Path != exactManifest {
			continue
		}
		if path.Base(entry.Path) != "SKILL.md" || (spec.Subdir != "" && !strings.HasPrefix(entry.Path, spec.Subdir+"/")) {
			continue
		}
		normalized, err := normalizeSkillPath(entry.Path)
		if err != nil {
			return nil, err
		}
		if normalized != entry.Path {
			return nil, kernel.BadAuthRequest("GitHub 技能目录路径无效")
		}
		if entry.Type != "blob" || (entry.Mode != "100644" && entry.Mode != "100755") {
			return nil, kernel.BadAuthRequest("技能包不能包含软链接或特殊文件")
		}
		if entry.Size < 0 || entry.Size > maxSkillFileBytes {
			return nil, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		subdir := path.Dir(entry.Path)
		if subdir == "." {
			subdir = ""
		}
		if seen[subdir] {
			return nil, kernel.BadAuthRequest("技能包包含重复文件路径")
		}
		seen[subdir] = true
		name := subdir
		if name == "" {
			name = spec.Repo
		}
		items = append(items, SkillGitHubCandidate{Subdir: subdir, Name: name})
	}
	if len(items) == 0 {
		return nil, kernel.BadAuthRequest("GitHub 仓库或子目录中未找到 SKILL.md")
	}
	for _, item := range items {
		if item.Subdir == spec.Subdir {
			items = []SkillGitHubCandidate{item}
			break
		}
	}
	if len(items) > maxSkillPackageFiles {
		return nil, kernel.BadAuthRequest("GitHub 仓库包含的技能过多，请指定更具体的技能子目录")
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Subdir < items[j].Subdir })
	return &SkillGitHubDiscovery{SourceURL: fmt.Sprintf("https://github.com/%s/%s", spec.Owner, spec.Repo), SourceRef: ref, SourceCommit: commit, Skills: items}, nil
}

func resolveGitHubSkillRef(ctx context.Context, client *http.Client, spec githubSkillSpec) (string, string, error) {
	resolvedRef := spec.Ref
	if resolvedRef == "" {
		var repoInfo struct {
			DefaultBranch string `json:"default_branch"`
		}
		if err := githubJSON(ctx, client, fmt.Sprintf("https://api.github.com/repos/%s/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo)), &repoInfo); err != nil {
			return "", "", err
		}
		resolvedRef = repoInfo.DefaultBranch
	}
	var commitInfo struct {
		SHA string `json:"sha"`
	}
	if err := githubJSON(ctx, client, fmt.Sprintf("https://api.github.com/repos/%s/%s/commits/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(resolvedRef)), &commitInfo); err != nil {
		return "", "", err
	}
	if commitInfo.SHA == "" {
		return "", "", errors.New("GitHub 未返回提交版本")
	}
	return commitInfo.SHA, resolvedRef, nil
}

func fetchGitHubRepositoryTree(ctx context.Context, client *http.Client, spec githubSkillSpec, commit string) (*githubSkillTree, error) {
	var tree githubSkillTree
	treeURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(commit))
	if err := githubJSONWithLimit(ctx, client, treeURL, &tree, maxGitHubTreeBytes); err != nil {
		return nil, err
	}
	if tree.Truncated {
		return nil, kernel.BadAuthRequest("GitHub 仓库目录过大，无法完整读取技能")
	}
	if len(tree.Tree) > maxGitHubRepositoryEntries {
		return nil, kernel.BadAuthRequest("GitHub 仓库文件数量过多")
	}
	return &tree, nil
}

func githubJSONWithLimit(ctx context.Context, client *http.Client, target string, output any, maxBytes int64) error {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", outbound.DefaultOutboundUserAgent)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("读取 GitHub 信息失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("读取 GitHub 信息失败: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > maxBytes {
		return kernel.BadAuthRequest("GitHub 返回的数据过大，请指定更具体的技能子目录")
	}
	return json.Unmarshal(data, output)
}
