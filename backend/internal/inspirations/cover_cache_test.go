package inspirations

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type coverTransport func(*http.Request) (*http.Response, error)

func (f coverTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func coverPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	value := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			value.SetNRGBA(x, y, color.NRGBA{R: uint8(x % 256), G: uint8(y % 256), B: uint8((x + y) % 256), A: 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, value); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestCoverSourceRegistryMatchesCatalogs(t *testing.T) {
	want := make(map[string]string)
	for _, name := range []string{"seedance", "youmind", "haohaoxue"} {
		path := filepath.Join("..", "..", "..", "web", "public", "inspirations", name+".json")
		raw, err := os.ReadFile(path)
		if os.IsNotExist(err) {
			t.Skip("web catalogs not included in backend-only checkout")
		}
		if err != nil {
			t.Fatal(err)
		}
		var catalog struct {
			Entries []struct {
				ID    string `json:"id"`
				Image string `json:"image"`
			} `json:"entries"`
		}
		if err := json.Unmarshal(raw, &catalog); err != nil {
			t.Fatal(err)
		}
		for _, item := range catalog.Entries {
			if strings.HasPrefix(item.Image, "https://") {
				if !allowedCoverURL(item.Image) {
					t.Fatalf("unsupported source for %s", item.ID)
				}
				want[item.ID] = item.Image
			}
		}
	}
	if !reflect.DeepEqual(want, staticCoverSources) {
		t.Fatal("run bun scripts/sync-inspiration-cover-sources.mjs after changing static catalogs")
	}
}

func TestCoverSourceRefusesArbitraryURLsAndDisabledFeed(t *testing.T) {
	for _, url := range []string{
		"http://media.goodcase.ai/image.jpg", "https://media.goodcase.ai.evil.test/image.jpg",
		"https://user:password@media.goodcase.ai/image.jpg", "https://127.0.0.1/image.jpg",
		"https://media.goodcase.ai:8080/image.jpg", "https://media.goodcase.ai/image.jpg#fragment",
	} {
		if allowedCoverURL(url) {
			t.Fatalf("unexpected allowed source: %s", url)
		}
	}
	s := &Service{now: time.Now, cachedAt: time.Now(), cached: &Feed{Enabled: false, Entries: []FeedEntry{{ID: "seedance:dynamic-cover", Image: "https://media.goodcase.ai/p.png"}}}}
	if _, err := s.coverSource("seedance:dynamic-cover"); err == nil {
		t.Fatal("disabled feed exposed cover")
	}
	s.cached.Enabled = true
	if _, err := s.coverSource("seedance:dynamic-cover"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.coverSource("https://media.goodcase.ai/p.png"); err == nil {
		t.Fatal("URL accepted instead of registered ID")
	}
	if _, err := s.coverSource("../secret"); err == nil {
		t.Fatal("path accepted")
	}
}

func TestCoverCacheCoalescesAndSurvivesRestart(t *testing.T) {
	raw := coverPNG(t, 128, 96)
	dir := t.TempDir()
	cache := newCoverCache(dir)
	cache.encode = func(_ context.Context, raw []byte) []byte { return raw }
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	cache.client.Transport = coverTransport(func(r *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(entered)
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("forwarded credential")
		}
		<-release
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}, nil
	})
	url := "https://media.goodcase.ai/cover.png"
	errors := make(chan error, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			file, err := cache.open(context.Background(), url)
			if err == nil {
				file.Body.Close()
			}
			errors <- err
		}()
	}
	<-entered
	close(release)
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("got %d upstream requests", calls.Load())
	}
	restarted := newCoverCache(dir)
	restarted.client.Transport = coverTransport(func(*http.Request) (*http.Response, error) {
		t.Error("cache hit requested network")
		return nil, context.Canceled
	})
	file, err := restarted.open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Body.Close()
	content, _ := io.ReadAll(file.Body)
	if !bytes.Equal(content, raw) || file.MIME != "image/png" || file.Info.Mode().Perm() != 0600 || file.ETag == "" {
		t.Fatal("cached image identity/permissions mismatch")
	}
}

func TestCoverCacheRechecksCompletedMissBeforeStartingDownload(t *testing.T) {
	cache := newCoverCache(t.TempDir())
	source := "https://media.goodcase.ai/race.png"
	key := coverKey(source)
	if _, err := cache.cached(key); err == nil {
		t.Fatal("expected initial cache miss")
	}
	// Model the first request completing after another request observed a miss.
	if err := cache.store(key, coverPNG(t, 16, 16)); err != nil {
		t.Fatal(err)
	}
	cache.client.Transport = coverTransport(func(*http.Request) (*http.Response, error) {
		t.Error("completed miss triggered another download")
		return nil, context.Canceled
	})
	job := cache.start(key, source)
	if job == nil {
		t.Fatal("fresh cache was treated as unavailable")
	}
	select {
	case <-job.done:
		if job.err != nil {
			t.Fatal(job.err)
		}
	default:
		t.Fatal("fresh cache started asynchronous work")
	}
}

func TestCoverCacheRejectsHTMLLargeAndBrokenImages(t *testing.T) {
	// A complete PNG signature and IHDR passes DecodeConfig without any pixels.
	truncated := coverPNG(t, 16, 16)[:33]
	if _, _, err := image.DecodeConfig(bytes.NewReader(truncated)); err != nil {
		t.Fatal("fixture must have a valid image header", err)
	}
	for _, raw := range [][]byte{[]byte("<html>not an image</html>"), bytes.Repeat([]byte("x"), coverMaxBytes+1), []byte("\x89PNG\r\n\x1a\ntruncated"), truncated} {
		cache := newCoverCache(t.TempDir())
		cache.encode = func(_ context.Context, raw []byte) []byte { return raw }
		cache.client.Transport = coverTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}, nil
		})
		if _, err := cache.open(context.Background(), "https://media.goodcase.ai/cover.png"); err == nil {
			t.Fatal("unsafe payload stored")
		}
		files, _ := os.ReadDir(cache.dir)
		if len(files) != 0 {
			t.Fatal("failed payload left cache files")
		}
	}
	cache := newCoverCache(t.TempDir())
	req, _ := http.NewRequest(http.MethodGet, "https://127.0.0.1/secret", nil)
	if err := cache.client.CheckRedirect(req, nil); err == nil {
		t.Fatal("private redirect accepted")
	}
}

func TestCoverCacheFallsBackToValidatedSourceOnTruncatedEncoderOutput(t *testing.T) {
	raw := coverPNG(t, 64, 64)
	cache := newCoverCache(t.TempDir())
	cache.encode = func(_ context.Context, raw []byte) []byte { return raw[:33] }
	cache.client.Transport = coverTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}, nil
	})
	file, err := cache.open(context.Background(), "https://media.goodcase.ai/cover.png")
	if err != nil {
		t.Fatal("invalid encoder output discarded the validated source", err)
	}
	defer file.Body.Close()
	stored, err := io.ReadAll(file.Body)
	if err != nil || !bytes.Equal(stored, raw) || file.MIME != "image/png" {
		t.Fatal("encoder fallback did not preserve the validated original", err)
	}
}

func TestCoverEncodingUsesCompleteImagePacketsWithoutSeek(t *testing.T) {
	// A complete static WebP packet, as emitted by libwebp without a muxer rewrite.
	encoded, err := base64.StdEncoding.DecodeString("UklGRkwAAABXRUJQVlA4IEAAAABwAwCdASogACAAPpFCnEolo6KhqAgAsBIJZQCsLoB+AABBlBAA/uyXj/6yv5lfzK/3yP/xu3GG++nGjFhjGAAA")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	fixture := filepath.Join(dir, "pipe.webp")
	arguments := filepath.Join(dir, "arguments")
	if err := os.WriteFile(fixture, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ffmpeg"), []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$COVER_TEST_ARGUMENTS\"\nexec /bin/cat \"$COVER_TEST_WEBP\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	t.Setenv("COVER_TEST_WEBP", fixture)
	t.Setenv("COVER_TEST_ARGUMENTS", arguments)
	raw := coverPNG(t, 128, 96)
	cache := newCoverCache(t.TempDir())
	cache.client.Transport = coverTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}, nil
	})
	file, err := cache.open(context.Background(), "https://media.goodcase.ai/cover.png")
	if err != nil {
		t.Fatal("streamed WebP failed to cache", err)
	}
	defer file.Body.Close()
	stored, err := io.ReadAll(file.Body)
	if err != nil || file.MIME != "image/webp" || len(stored) >= len(raw) {
		t.Fatal("compressed WebP was not used", err)
	}
	config, err := inspectCover(stored)
	if err != nil || config.Width != 32 || config.Height != 32 || binary.LittleEndian.Uint32(stored[4:8]) != uint32(len(stored)-8) {
		t.Fatal("completed encoder output is not a fully decodable WebP", err)
	}
	args, err := os.ReadFile(arguments)
	if err != nil || !strings.HasSuffix(string(args), "-f\nimage2pipe\npipe:1\n") {
		t.Fatal("encoder output requires a seekable muxer", err)
	}
}

func TestCoverCacheRejectsWebPTrailerIgnoredByPixelDecoder(t *testing.T) {
	encoded, err := base64.StdEncoding.DecodeString("UklGRkwAAABXRUJQVlA4IEAAAABwAwCdASogACAAPpFCnEolo6KhqAgAsBIJZQCsLoB+AABBlBAA/uyXj/6yv5lfzK/3yP/xu3GG++nGjFhjGAAA")
	if err != nil {
		t.Fatal(err)
	}
	for _, extra := range [][]byte{{0, 0, 0, 0}, []byte("VP8X\xff\xff\xff\xff")} {
		broken := append(append([]byte(nil), encoded...), extra...)
		binary.LittleEndian.PutUint32(broken[4:8], uint32(len(broken)-8))
		if _, _, err := image.Decode(bytes.NewReader(broken)); err != nil {
			t.Fatal("fixture must expose the pixel decoder's incomplete validation", err)
		}
		if _, err := inspectCover(broken); err == nil {
			t.Fatal("malformed WebP container accepted")
		}
		raw := coverPNG(t, 128, 96)
		cache := newCoverCache(t.TempDir())
		cache.encode = func(context.Context, []byte) []byte { return broken }
		cache.client.Transport = coverTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}, nil
		})
		file, err := cache.open(context.Background(), "https://media.goodcase.ai/cover.png")
		if err != nil {
			t.Fatal("malformed encoder output discarded a validated source", err)
		}
		stored, err := io.ReadAll(file.Body)
		file.Body.Close()
		if err != nil || !bytes.Equal(stored, raw) {
			t.Fatal("malformed WebP reached the public cache", err)
		}
	}
}

func TestCoverCacheRemovesOrphansWithoutTouchingOtherFiles(t *testing.T) {
	cache := newCoverCache(t.TempDir())
	raw := coverPNG(t, 20, 20)
	cache.maxBytes = int64(len(raw) * 2)
	if err := cache.store(coverKey("existing"), raw); err != nil {
		t.Fatal(err)
	}
	orphan, err := os.CreateTemp(cache.dir, ".cover-*")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := orphan.Write(bytes.Repeat(raw, 3)); err != nil {
		t.Fatal(err)
	}
	if err := orphan.Close(); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(cache.dir, ".cover-owner-notes")
	if err := os.WriteFile(other, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	folder := filepath.Join(cache.dir, ".cover-123")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(cache.dir, ".cover-456")
	if err := os.Symlink(other, link); err != nil {
		t.Fatal(err)
	}
	if err := cache.store(coverKey("next"), raw); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan.Name()); !os.IsNotExist(err) {
		t.Fatal("orphaned temporary cache file remains")
	}
	if content, err := os.ReadFile(other); err != nil || string(content) != "keep" {
		t.Fatal("unrelated file changed", err)
	}
	if info, err := os.Stat(folder); err != nil || !info.IsDir() {
		t.Fatal("unrelated directory changed", err)
	}
	if _, err := os.Readlink(link); err != nil {
		t.Fatal("symlink was removed", err)
	}
	entries, err := os.ReadDir(cache.dir)
	if err != nil {
		t.Fatal(err)
	}
	var total int64
	for _, entry := range entries {
		if cacheEntryName(entry.Name()) {
			info, err := entry.Info()
			if err != nil {
				t.Fatal(err)
			}
			total += info.Size()
		}
	}
	if total > cache.maxBytes {
		t.Fatalf("cache budget exceeded after orphan cleanup: %d", total)
	}
}

func TestCoverEncodingLimitsFilterThreadsAndFallsBack(t *testing.T) {
	dir := t.TempDir()
	args := filepath.Join(dir, "arguments")
	if err := os.WriteFile(filepath.Join(dir, "ffmpeg"), []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$COVER_TEST_ARGUMENTS\"\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	t.Setenv("COVER_TEST_ARGUMENTS", args)
	raw := coverPNG(t, 16, 16)
	if !bytes.Equal(encodeCover(context.Background(), raw), raw) {
		t.Fatal("failed encoder did not preserve the validated original")
	}
	command, err := os.ReadFile(args)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(command), "-filter_threads\n1\n") {
		t.Fatal("filter thread pool is not limited")
	}
}

func TestCoverCacheBudgetExpiryAndRefreshFailure(t *testing.T) {
	cache := newCoverCache(t.TempDir())
	raw := coverPNG(t, 20, 20)
	cache.maxBytes = int64(len(raw) * 2)
	for _, name := range []string{"a", "b", "c"} {
		if err := cache.store(coverKey("https://media.goodcase.ai/"+name), raw); err != nil {
			t.Fatal(err)
		}
	}
	entries, _ := os.ReadDir(cache.dir)
	var total int64
	for _, entry := range entries {
		info, _ := entry.Info()
		total += info.Size()
	}
	if total > cache.maxBytes {
		t.Fatalf("budget exceeded: %d", total)
	}
	url := "https://media.goodcase.ai/old"
	key := coverKey(url)
	if err := cache.store(key, raw); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(cache.dir, key), old, old); err != nil {
		t.Fatal(err)
	}
	failed := make(chan struct{})
	cache.client.Transport = coverTransport(func(*http.Request) (*http.Response, error) { defer close(failed); return nil, context.DeadlineExceeded })
	file, err := cache.open(context.Background(), url)
	if err != nil {
		t.Fatal("stale cover not served", err)
	}
	file.Body.Close()
	<-failed
	file, err = cache.cached(key)
	if err != nil {
		t.Fatal("failed refresh removed old cover", err)
	}
	file.Body.Close()
	old = time.Now().Add(-8 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(cache.dir, key), old, old); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.cached(key); err == nil {
		t.Fatal("retention-expired cover served")
	}
}

func TestCoverCacheRefreshBudgetFailurePreservesOldCover(t *testing.T) {
	cache := newCoverCache(t.TempDir())
	previous := coverPNG(t, 20, 20)
	next := coverPNG(t, 21, 20)
	cache.maxBytes = int64(max(len(previous), len(next)))
	key := coverKey("https://media.goodcase.ai/refresh.png")
	if err := cache.store(key, previous); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(cache.dir, key), old, old); err != nil {
		t.Fatal(err)
	}
	if err := cache.store(key, next); err == nil {
		t.Fatal("refresh did not reserve room for both old and temporary images")
	}
	file, err := cache.cached(key)
	if err != nil {
		t.Fatal("budget failure removed the usable stale cover", err)
	}
	defer file.Body.Close()
	content, err := io.ReadAll(file.Body)
	if err != nil || !bytes.Equal(content, previous) || !file.Info.ModTime().Equal(old) {
		t.Fatal("budget failure changed the previous cover", err)
	}
}

func TestCoverEncodingKeepsManagedImagesAndProducesWebP(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	// The smooth gradient fixture compresses to ~6 KiB PNG, smaller than its WebP.
	// Use deterministic texture to exercise the beneficial conversion path.
	texture := image.NewNRGBA(image.Rect(0, 0, 1400, 1000))
	seed := uint32(1234567)
	for offset := 0; offset < len(texture.Pix); offset += 4 {
		seed = seed*1664525 + 1013904223
		texture.Pix[offset], texture.Pix[offset+1], texture.Pix[offset+2], texture.Pix[offset+3] = byte(seed>>24), byte(seed>>16), byte(seed>>8), 255
	}
	var source bytes.Buffer
	if err := png.Encode(&source, texture); err != nil {
		t.Fatal(err)
	}
	raw := source.Bytes()
	for _, marker := range []string{"ICC_PROFILE", "Exif\x00\x00", "iCCP", "eXIf", "acTL"} {
		managed := append(append([]byte(nil), raw...), marker...)
		if !bytes.Equal(encodeCover(context.Background(), managed), managed) {
			t.Fatal("managed/oriented image changed")
		}
	}
	var jpegSource bytes.Buffer
	if err := jpeg.Encode(&jpegSource, texture, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	for name, input := range map[string][]byte{"png": raw, "jpeg": jpegSource.Bytes()} {
		t.Run(name, func(t *testing.T) {
			encoded := encodeCover(context.Background(), input)
			if http.DetectContentType(encoded) != "image/webp" || len(encoded) >= len(input) {
				t.Fatalf("real ffmpeg/libwebp path did not compress: input=%d output=%d type=%s", len(input), len(encoded), http.DetectContentType(encoded))
			}
			config, err := inspectCover(encoded)
			if err != nil || config.Width != 960 || config.Height != 686 {
				t.Fatalf("unexpected dimensions/container: %+v %v", config, err)
			}
		})
	}
}
