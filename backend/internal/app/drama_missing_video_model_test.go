package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaEpisodeWithMissingVideoModelKeepsReferenceArray(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDramaWithMedia(t, svc, DramaReviewEvery, DramaMediaManual).Project.ID
	runDramaTicks(t, svc, project, 20)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Episodes) == 0 {
		t.Fatal("fixture has no episodes")
	}
	var original model.ChannelModel
	if err := fake.db.First(&original, "id = ?", "drama-video").Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Delete(&original).Error; err != nil {
		t.Fatal(err)
	}
	before := len(fake.requests)
	for _, episode := range summary.Episodes {
		detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(detail.Segments) == 0 {
			t.Fatal("fixture has no segments")
		}
		for _, segment := range detail.Segments {
			if segment.Request.References == nil || segment.Request.Warning == "" {
				t.Fatalf("missing model must return a renderable request with warning: %+v", segment.Request)
			}
			raw, err := json.Marshal(segment.Request)
			if err != nil {
				t.Fatal(err)
			}
			var decoded map[string]json.RawMessage
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			if string(decoded["references"]) != "[]" {
				t.Fatalf("wire references = %s", decoded["references"])
			}
		}
	}
	if err := fake.db.Unscoped().Model(&original).Update("deleted_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, summary.Episodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Segments[0].Request.Seconds <= 0 || detail.Segments[0].Request.References == nil {
		t.Fatal("restored video model did not restore the request preview")
	}
	if len(fake.requests) != before {
		t.Fatal("reading request previews submitted new generation tasks")
	}
}
