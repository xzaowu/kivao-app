package inspirations

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "golang.org/x/image/webp"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"
)

const (
	coverMaxBytes      = 8 << 20
	coverCacheMaxBytes = 256 << 20
	coverFreshFor      = 24 * time.Hour
	coverKeepFor       = 7 * 24 * time.Hour
	coverCacheVersion  = "w960-q85-v1"
)

type coverJob struct {
	done chan struct{}
	err  error
}

type coverCache struct {
	dir      string
	client   *http.Client
	now      func() time.Time
	encode   func(context.Context, []byte) []byte
	maxBytes int64
	slots    chan struct{}
	mu       sync.Mutex
	jobs     map[string]*coverJob
	failed   map[string]time.Time
	writeMu  sync.Mutex
}

func newCoverCache(dataDir string) *coverCache {
	client := outbound.OutboundHTTPClient(12 * time.Second)
	// No arbitrary redirects, cookies or credentials cross into this public cache.
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || !allowedCoverURL(req.URL.String()) {
			return errors.New("unsupported cover redirect")
		}
		_, err := outbound.ValidateOutboundURL(req.URL.String())
		return err
	}
	return &coverCache{dir: filepath.Join(dataDir, "cache", "inspiration-covers"), client: client,
		now: time.Now, encode: encodeCover, maxBytes: coverCacheMaxBytes, slots: make(chan struct{}, 2),
		jobs: make(map[string]*coverJob), failed: make(map[string]time.Time)}
}

func coverKey(source string) string {
	sum := sha256.Sum256([]byte(coverCacheVersion + "\n" + source))
	return hex.EncodeToString(sum[:]) + ".cover"
}

func (c *coverCache) cached(key string) (*CoverFile, error) {
	file, err := os.Open(filepath.Join(c.dir, key))
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > coverMaxBytes || c.now().Sub(info.ModTime()) > coverKeepFor {
		file.Close()
		return nil, errors.New("cover cache entry expired or invalid")
	}
	var header [512]byte
	n, err := file.Read(header[:])
	if err != nil && err != io.EOF {
		file.Close()
		return nil, err
	}
	mime := http.DetectContentType(header[:n])
	if mime != "image/jpeg" && mime != "image/png" && mime != "image/webp" {
		file.Close()
		return nil, errors.New("invalid cached image")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		file.Close()
		return nil, err
	}
	return &CoverFile{Body: file, Info: info, MIME: mime, ETag: fmt.Sprintf(`"%s-%x-%x"`, key[:16], info.ModTime().UnixNano(), info.Size())}, nil
}

func (c *coverCache) open(ctx context.Context, source string) (*CoverFile, error) {
	if !allowedCoverURL(source) {
		return nil, kernel.NotFound("灵感封面不存在")
	}
	key := coverKey(source)
	if file, err := c.cached(key); err == nil {
		if c.now().Sub(file.Info.ModTime()) >= coverFreshFor {
			c.start(key, source)
		}
		return file, nil
	}
	job := c.start(key, source)
	if job == nil {
		return nil, kernel.NewAppError(http.StatusServiceUnavailable, "封面准备中，请稍后重试")
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-job.done:
		if job.err != nil {
			return nil, kernel.NewAppError(http.StatusBadGateway, "封面暂时无法加载")
		}
		file, err := c.cached(key)
		if err != nil {
			return nil, kernel.NewAppError(http.StatusServiceUnavailable, "封面暂时无法加载")
		}
		return file, nil
	}
}

// A bounded queue coalesces misses; refresh never blocks a usable cached cover.
// Its independent deadline allows one closed tab to leave other readers intact.
func (c *coverCache) start(key, source string) *coverJob {
	c.mu.Lock()
	defer c.mu.Unlock()
	if job := c.jobs[key]; job != nil {
		return job
	}
	// Another miss may have finished between open's disk check and this lock.
	if file, err := c.cached(key); err == nil {
		fresh := c.now().Sub(file.Info.ModTime()) < coverFreshFor
		file.Body.Close()
		if fresh {
			job := &coverJob{done: make(chan struct{})}
			close(job.done)
			return job
		}
	}
	now := c.now()
	for name, until := range c.failed {
		if !now.Before(until) {
			delete(c.failed, name)
		}
	}
	if now.Before(c.failed[key]) || len(c.jobs) >= 16 {
		return nil
	}
	job := &coverJob{done: make(chan struct{})}
	c.jobs[key] = job
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		select {
		case c.slots <- struct{}{}:
			job.err = c.fetchAndStore(ctx, key, source)
			<-c.slots
		case <-ctx.Done():
			job.err = ctx.Err()
		}
		c.mu.Lock()
		delete(c.jobs, key)
		if job.err != nil && len(c.failed) < 256 {
			c.failed[key] = c.now().Add(time.Minute)
		}
		close(job.done)
		c.mu.Unlock()
	}()
	return job
}

func (c *coverCache) fetchAndStore(ctx context.Context, key, source string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return err
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	req.Header.Set("Accept", "image/webp,image/png,image/jpeg")
	response, err := c.client.Do(req)
	if err != nil {
		return errors.New("cover source unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength > coverMaxBytes {
		return errors.New("invalid cover response")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, coverMaxBytes+1))
	if err != nil || len(raw) > coverMaxBytes {
		return errors.New("cover too large or incomplete")
	}
	if _, err := inspectCover(raw); err != nil {
		return err
	}
	encoded := c.encode(ctx, raw)
	if len(encoded) == 0 || len(encoded) >= len(raw) {
		encoded = raw
	}
	if _, err := inspectCover(encoded); err != nil {
		return err
	}
	return c.store(key, encoded)
}

func inspectCover(raw []byte) (image.Config, error) {
	mime := http.DetectContentType(raw)
	if mime != "image/jpeg" && mime != "image/png" && mime != "image/webp" {
		return image.Config{}, errors.New("unsupported cover format")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 8192 || config.Height > 8192 || int64(config.Width)*int64(config.Height) > 12_000_000 {
		return image.Config{}, errors.New("invalid cover dimensions")
	}
	// Header checks bound decoder allocation, but do not detect a truncated body.
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil || decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return image.Config{}, errors.New("invalid cover image")
	}
	return config, nil
}

// Keep color-managed/oriented/animated originals intact. FFmpeg is already part
// of the Backend image; missing libwebp degrades to caching the validated source.
func encodeCover(ctx context.Context, raw []byte) []byte {
	for _, marker := range []string{"ICC_PROFILE", "Exif\x00\x00", "iCCP", "eXIf", "cHRM", "gAMA", "acTL"} {
		if bytes.Contains(raw, []byte(marker)) {
			return raw
		}
	}
	codec := "mjpeg"
	switch http.DetectContentType(raw) {
	case "image/png":
		codec = "png"
	case "image/webp":
		return raw
	case "image/jpeg":
	default:
		return raw
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-filter_threads", "1",
		"-threads", "1", "-protocol_whitelist", "pipe", "-f", "image2pipe", "-c:v", codec, "-i", "pipe:0",
		"-vf", "scale=w='min(960,iw)':h=-1:flags=lanczos", "-frames:v", "1", "-an", "-sn",
		"-c:v", "libwebp", "-quality", "85", "-compression_level", "4", "-threads", "1", "-f", "webp", "pipe:1")
	command.Stdin = bytes.NewReader(raw)
	var output limitedCoverBuffer
	command.Stdout = &output
	if err := command.Run(); err != nil || output.Len() == 0 || output.Len() >= len(raw) {
		return raw
	}
	return output.Bytes()
}

type limitedCoverBuffer struct{ bytes.Buffer }

func (b *limitedCoverBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > coverMaxBytes {
		return 0, errors.New("encoded cover too large")
	}
	return b.Buffer.Write(p)
}

func cacheEntryName(name string) bool {
	if len(name) != 70 || !strings.HasSuffix(name, ".cover") {
		return false
	}
	_, err := hex.DecodeString(name[:64])
	return err == nil
}

func cacheTempEntryName(name string) bool {
	suffix, ok := strings.CutPrefix(name, ".cover-")
	if !ok {
		return false
	}
	// os.CreateTemp uses a decimal uint32 suffix; leave unrelated files intact.
	number, err := strconv.ParseUint(suffix, 10, 32)
	return err == nil && strconv.FormatUint(number, 10) == suffix
}

func (c *coverCache) store(key string, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if int64(len(data)) > c.maxBytes {
		return errors.New("cover exceeds cache budget")
	}
	if err := os.MkdirAll(c.dir, 0700); err != nil {
		return err
	}
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return err
	}
	var files []os.FileInfo
	var total int64
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		if cacheTempEntryName(entry.Name()) {
			// This single-process cache holds writeMu for every temporary write.
			// Any matching file present before this write survived an earlier exit.
			if err := os.Remove(filepath.Join(c.dir, entry.Name())); err != nil {
				return err
			}
			continue
		}
		if !cacheEntryName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if c.now().Sub(info.ModTime()) > coverKeepFor {
			if err := os.Remove(filepath.Join(c.dir, info.Name())); err != nil {
				return err
			}
			continue
		}
		files = append(files, info)
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModTime().Before(files[j].ModTime()) })
	// Reserve room for the temporary file as well as all current entries.
	for _, file := range files {
		if total+int64(len(data)) <= c.maxBytes {
			break
		}
		if file.Name() == key {
			continue
		}
		if err := os.Remove(filepath.Join(c.dir, file.Name())); err != nil {
			return err
		}
		total -= file.Size()
	}
	if total+int64(len(data)) > c.maxBytes {
		return errors.New("cover refresh exceeds cache budget")
	}
	file, err := os.CreateTemp(c.dir, ".cover-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(c.dir, key))
}
