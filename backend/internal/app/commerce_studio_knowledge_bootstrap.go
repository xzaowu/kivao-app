package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Built-in KB01-KB10 knowledge is shipped with the binary and copied into the
// database so administrators can disable a domain source or reject one entry.
// Each entry keeps a stable ID; DedupHash is the hash of the content as last
// written by the bootstrap, which lets an upgrade detect local edits.
const commerceStudioBuiltinKnowledgePrefix = "meiye-kb"

type commerceStudioBuiltinSourceSpec struct {
	Domain, Name, URL string
}

var commerceStudioBuiltinSourceSpecs = []commerceStudioBuiltinSourceSpec{
	{"KB01", "电商 KB01 商品行业知识库", "builtin://meiyeai/kb01-product-industry"},
	{"KB02", "电商 KB02 营销卖点知识库", "builtin://meiyeai/kb02-marketing-strategy"},
	{"KB03", "电商 KB03 高级视觉设计知识库", "builtin://meiyeai/kb03-visual-design"},
	{"KB04", "电商 KB04 主图与详情页排版知识库", "builtin://meiyeai/kb04-layout-composition"},
	{"KB05", "电商 KB05 商业文案知识库", "builtin://meiyeai/kb05-copywriting"},
	{"KB06", "电商 KB06 商业产品摄影知识库", "builtin://meiyeai/kb06-product-photography"},
	{"KB07", "电商 KB07 模特与场景知识库", "builtin://meiyeai/kb07-model-scene"},
	{"KB08", "电商 KB08 电商平台知识库", "builtin://meiyeai/kb08-platform-rules"},
	{"KB09", "电商 KB09 设计趋势知识库", "builtin://meiyeai/kb09-design-trends"},
	{"KB10", "电商 KB10 一致性与质量控制知识库", "builtin://meiyeai/kb10-quality-control"},
	{"KB11", "品类专属叙事", "builtin://meiyeai/kb11-product-design"},
	{"KB12", "字体与信息组件", "builtin://meiyeai/kb12-product-design"},
	{"KB13", "人物摄影真实性", "builtin://meiyeai/kb13-product-design"},
	{"KB14", "功能与规格表达", "builtin://meiyeai/kb14-product-design"},
	{"KB15", "可调用技能方法", "builtin://meiyeai/kb15-managed-skills"},
	{"KB16", "图像执行策略", "builtin://meiyeai/kb16-managed-skills"},
	{"KB17", "生成结果验收", "builtin://meiyeai/kb17-managed-skills"},
	{"KB19", "行业与子品类创作路由", "builtin://meiyeai/kb19-industry-methods"},
}

func commerceStudioBuiltinSourceID(domain string) string {
	return commerceStudioBuiltinKnowledgePrefix + strings.TrimPrefix(strings.ToLower(domain), "kb")
}

// ecommerceBuiltinKnowledgeEntries returns normalized KB01-KB10 entries.
// Timestamps are left zero; the bootstrap assigns them at write time.
func commerceStudioBuiltinKnowledgeEntries() []model.CommerceStudioKnowledgeEntry {
	groups := [][]model.CommerceStudioKnowledgeEntry{
		kb01ProductIndustryKnowledge(), kb02MarketingStrategyKnowledge(), kb03AdvancedVisualDesignKnowledge(),
		kb04LayoutCompositionKnowledge(), kb05CommercialCopywritingKnowledge(), kb06ProductPhotographyKnowledge(),
		kb07ModelSceneKnowledge(), kb08PlatformRulesKnowledge(), kb09DesignTrendsKnowledge(), kb10QualityControlKnowledge(),
		commerceStudioProductDesignKnowledge(),
		commerceStudioManagedSkillKnowledge(),
		industryBranchKnowledge(),
	}
	entries := make([]model.CommerceStudioKnowledgeEntry, 0, 112)
	for _, group := range groups {
		for _, entry := range group {
			for _, field := range []*string{&entry.PlatformsJSON, &entry.LanguagesJSON, &entry.RegionsJSON, &entry.TagsJSON} {
				if *field == "" {
					*field = "[]"
				}
			}
			entry.ReviewStatus, entry.TrustLevel = "approved", "first_party"
			entry.DedupHash = commerceStudioKnowledgeContentHash(entry)
			entries = append(entries, entry)
		}
	}
	return entries
}

// ecommerceKnowledgeContentHash covers every field the bootstrap owns. The ID
// is included so two domains can never collide on the unique hash index.
func commerceStudioKnowledgeContentHash(entry model.CommerceStudioKnowledgeEntry) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{entry.ID, entry.SourceID, entry.KnowledgeDomain, entry.KnowledgeType, entry.Category, entry.Title, entry.ContentJSON, entry.PlatformsJSON, entry.LanguagesJSON, entry.RegionsJSON, entry.TagsJSON}, "\x1f")))
	return hex.EncodeToString(sum[:])
}

var commerceStudioKnowledgeRevision = regexp.MustCompile(`-v(\d+)-(\d{8})$`)

// ecommerceKnowledgeVersionNewer reports whether shipped is a later revision
// than stored. Unknown formats only upgrade when the strings differ and the
// stored value is not parseable, so a newer database is never downgraded by
// an older binary.
func commerceStudioKnowledgeVersionNewer(shipped, stored string) bool {
	if shipped == stored {
		return false
	}
	a, b := commerceStudioKnowledgeRevision.FindStringSubmatch(shipped), commerceStudioKnowledgeRevision.FindStringSubmatch(stored)
	if a == nil {
		return false
	}
	if b == nil {
		return true
	}
	ar, _ := strconv.Atoi(a[1])
	br, _ := strconv.Atoi(b[1])
	if ar != br {
		return ar > br
	}
	return a[2] > b[2]
}

type CommerceStudioKnowledgeBootstrapReport struct {
	Shipped        int                         `json:"shipped"`
	Inserted       []string                    `json:"inserted"`
	Updated        []string                    `json:"updated"`
	Unchanged      int                         `json:"unchanged"`
	PreservedLocal []string                    `json:"preservedLocal"`
	SourcesCreated []string                    `json:"sourcesCreated"`
	ByDomain       map[string]map[string]int64 `json:"byDomain"`
}

// EnsureBuiltinEcommerceKnowledge copies shipped KB01-KB10 entries into the
// database in one transaction:
//   - a missing ID is inserted;
//   - a stored row whose hash still equals its content and whose version is
//     older is upgraded in place (review status kept);
//   - a stored row edited outside the bootstrap (hash mismatch) is preserved
//     and reported, never overwritten;
//   - any error rolls back the whole run.
func (s *Service) EnsureBuiltinCommerceStudioKnowledge() (*CommerceStudioKnowledgeBootstrapReport, error) {
	return s.ensureBuiltinCommerceStudioKnowledge(commerceStudioBuiltinKnowledgeEntries())
}

func (s *Service) ensureBuiltinCommerceStudioKnowledge(entries []model.CommerceStudioKnowledgeEntry) (*CommerceStudioKnowledgeBootstrapReport, error) {
	report := &CommerceStudioKnowledgeBootstrapReport{Shipped: len(entries), Inserted: []string{}, Updated: []string{}, PreservedLocal: []string{}, SourcesCreated: []string{}}
	seen := map[string]bool{}
	for _, entry := range entries {
		if seen[entry.ID] {
			return nil, fmt.Errorf("内置知识 ID 重复：%s", entry.ID)
		}
		seen[entry.ID] = true
	}
	now := time.Now().UTC()
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		versions := map[string]string{}
		for _, entry := range entries {
			if entry.Version > versions[entry.SourceID] {
				versions[entry.SourceID] = entry.Version
			}
		}
		for _, spec := range commerceStudioBuiltinSourceSpecs {
			id := commerceStudioBuiltinSourceID(spec.Domain)
			source := &model.CommerceStudioKnowledgeSource{ID: id, Name: spec.Name, URL: spec.URL, License: "MeiYeAI " + spec.Domain + " Original", Version: versions[id], Status: "ready", LastSyncedAt: &now}
			if spec.Domain == "KB15" || spec.Domain == "KB16" || spec.Domain == "KB17" {
				source.License = "MIT / MeiYeAI Original"
			}
			if _, err := tx.CommerceStudioKnowledgeSource(id); errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.CreateCommerceStudioKnowledgeSource(source); err != nil {
					return fmt.Errorf("创建知识源 %s：%w", id, err)
				}
				report.SourcesCreated = append(report.SourcesCreated, id)
			} else if err != nil {
				return err
			} else if err := tx.UpdateBuiltinCommerceStudioKnowledgeSource(source); err != nil {
				return fmt.Errorf("更新知识源 %s：%w", id, err)
			}
		}
		for _, shipped := range entries {
			entry := shipped
			stored, err := tx.CommerceStudioKnowledgeEntryByID(entry.ID)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				entry.CreatedAt, entry.UpdatedAt = now, now
				if err := tx.CreateCommerceStudioKnowledgeEntry(&entry); err != nil {
					return fmt.Errorf("写入知识 %s：%w", entry.ID, err)
				}
				report.Inserted = append(report.Inserted, entry.ID)
				continue
			}
			if err != nil {
				return err
			}
			if stored.DedupHash == entry.DedupHash || !commerceStudioKnowledgeVersionNewer(entry.Version, stored.Version) {
				report.Unchanged++
				continue
			}
			if commerceStudioKnowledgeContentHash(*stored) != stored.DedupHash {
				report.PreservedLocal = append(report.PreservedLocal, entry.ID)
				continue
			}
			ok, err := tx.UpdateBuiltinCommerceStudioKnowledgeEntry(entry.ID, stored.DedupHash, &entry)
			if err != nil {
				return fmt.Errorf("升级知识 %s：%w", entry.ID, err)
			}
			if !ok {
				return fmt.Errorf("升级知识 %s 时记录已被并发修改", entry.ID)
			}
			report.Updated = append(report.Updated, entry.ID)
		}
		counts, err := tx.CommerceStudioKnowledgeDomainStatusCounts(commerceStudioBuiltinKnowledgePrefix)
		report.ByDomain = counts
		return err
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(report.PreservedLocal)
	return report, nil
}

// ecommerceBuiltinKnowledgeFallback supplies shipped entries only for domains
// whose source row has never been bootstrapped. Once a source exists the
// database is authoritative, so disabling or rejecting knowledge takes effect.
func commerceStudioBuiltinKnowledgeFallback(sources []model.CommerceStudioKnowledgeSource) []model.CommerceStudioKnowledgeEntry {
	present := map[string]bool{}
	for _, source := range sources {
		present[source.ID] = true
	}
	fallback := []model.CommerceStudioKnowledgeEntry{}
	for _, entry := range commerceStudioBuiltinKnowledgeEntries() {
		if !present[entry.SourceID] {
			fallback = append(fallback, entry)
		}
	}
	if len(fallback) > 0 {
		slog.Debug("ecommerce builtin knowledge fallback in use", "entries", len(fallback))
	}
	return fallback
}
