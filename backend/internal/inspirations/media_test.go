package inspirations

import (
	"context"
	"errors"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestSeedanceMediaPersistsInExistingSyncStateAndRefreshes(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.InspirationFeedEntry{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), nil, nil, nil, "")
	video := "https://media.example.com/original.mp4"
	failed := false
	svc.sources = []source{{id: "seedance", load: func(context.Context, fetchFunc) (batch, error) {
		if failed {
			return batch{}, errors.New("controlled source failure")
		}
		return buildSeedanceBatch([]seedanceCase{{Slug: "sample", Title: "镜头示例", PosterURL: "https://media.example.com/poster.webp", PromptFull: strings.Repeat("镜头缓慢推进，展示自然光线与完整主体。", 10), MediaType: "video", MediaURL: video}}, nil)
	}}}
	check := func(want string) {
		t.Helper()
		if _, acquired, err := svc.sync(context.Background(), TriggerManual, ""); err != nil || !acquired {
			t.Fatalf("sync: %v acquired=%v", err, acquired)
		}
		// Recreate the service to verify persistence, rather than an in-memory cache.
		fresh := New(repository.New(db), nil, nil, nil, "")
		feed, err := fresh.Feed()
		if err != nil || len(feed.Entries) != 1 {
			t.Fatalf("feed: %v %#v", err, feed)
		}
		if feed.Entries[0].VideoURL != want {
			t.Fatalf("video URL %q, expected %q", feed.Entries[0].VideoURL, want)
		}
	}
	check(video)
	video = "https://media.example.com/refreshed.mp4"
	check(video)
	failed = true
	check(video)
	failed = false
	video = "javascript:invalid"
	check("")
}

func TestSeedanceMediaRejectsUnsupportedAndFilteredCases(t *testing.T) {
	valid := seedanceCase{Slug: "sample", Title: "镜头示例", PosterURL: "https://media.example.com/poster.webp", PromptFull: strings.Repeat("镜头缓慢推进，展示自然光线与完整主体。", 10), MediaType: "video", MediaURL: "https://media.example.com/video.mp4"}
	for _, modify := range []func(*seedanceCase){
		func(item *seedanceCase) { item.MediaURL = "http://media.example.com/video.mp4" },
		func(item *seedanceCase) { item.MediaType = "image" },
		func(item *seedanceCase) { item.PromptFull = "An untranslated upstream prompt." },
	} {
		item := valid
		modify(&item)
		parsed, err := buildSeedanceBatch([]seedanceCase{item}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(parsed.videos) != 0 {
			t.Fatal("unsupported or filtered media was published")
		}
	}
}
