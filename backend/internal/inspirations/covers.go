package inspirations

import (
	"context"
	_ "embed"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"

	"yingce/backend/internal/kernel"
)

//go:embed cover_sources.json
var coverSourcesJSON []byte

var staticCoverSources = func() map[string]string {
	var sources map[string]string
	if err := json.Unmarshal(coverSourcesJSON, &sources); err != nil {
		panic("invalid embedded inspiration cover registry")
	}
	return sources
}()

// CoverFile is an expendable public thumbnail, never a user resource or original.
type CoverFile struct {
	Body *os.File
	Info os.FileInfo
	MIME string
	ETag string
}

func allowedCoverURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 4096 || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" {
		return false
	}
	switch u.Host {
	case "media.goodcase.ai", "goodcase.ai", "cms-assets.youmind.com", "www.haohaoxue.com":
		return true
	default:
		return false
	}
}

func (s *Service) coverSource(id string) (string, error) {
	if id == "" || len(id) > 200 || strings.ContainsAny(id, "/\\\x00") {
		return "", kernel.NotFound("灵感封面不存在")
	}
	if source, ok := staticCoverSources[id]; ok && allowedCoverURL(source) {
		return source, nil
	}
	feed, err := s.Feed()
	if err != nil {
		return "", err
	}
	if feed.Enabled {
		for _, entry := range feed.Entries {
			if entry.ID == id && allowedCoverURL(entry.Image) {
				return entry.Image, nil
			}
		}
	}
	return "", kernel.NotFound("灵感封面不存在")
}

func (s *Service) OpenCover(ctx context.Context, id string) (*CoverFile, error) {
	if s.covers == nil {
		return nil, kernel.NewAppError(http.StatusServiceUnavailable, "灵感封面暂不可用")
	}
	source, err := s.coverSource(id)
	if err != nil {
		return nil, err
	}
	return s.covers.open(ctx, source)
}
