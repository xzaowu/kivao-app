package assets

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"golang.org/x/sync/singleflight"
	"yingce/backend/internal/model"
)

const (
	thumbnailMaxEdge       = 960
	thumbnailMinSourceSize = 64 << 10
	thumbnailMaxSourceSize = 24 << 20
	thumbnailMaxPixels     = 16 << 20
	thumbnailMaxSourceEdge = 8192
	thumbnailMaxBytes      = 256 << 10
	thumbnailMaxEntries    = 1024
	thumbnailKeepFor       = 7 * 24 * time.Hour
)

var (
	errThumbnailUnavailable = errors.New("image thumbnail unavailable")
	errThumbnailUnsupported = errors.New("image should be displayed as original")
)

// ThumbnailCache holds replaceable files only. The caller must authorize the
// original resource before opening a thumbnail, including on a cache hit.
type ThumbnailCache struct {
	dir       string
	workers   chan struct{}
	queue     chan struct{}
	inFlight  singleflight.Group
	diskMu    sync.Mutex
	nextSweep time.Time
}

func NewThumbnailCache(dataDir string) *ThumbnailCache {
	return &ThumbnailCache{dir: filepath.Join(dataDir, "cache", "resource-thumbnails"), workers: make(chan struct{}, 2), queue: make(chan struct{}, 40)}
}

func ThumbnailEligible(resource *model.Resource) bool {
	if resource.Provider != "local" || resource.Kind != "image" || resource.Size < thumbnailMinSourceSize || resource.Size > thumbnailMaxSourceSize {
		return false
	}
	switch resource.MimeType {
	case "image/jpeg", "image/png", "image/webp":
		return thumbnailDimensionsAllowed(resource.Width, resource.Height)
	}
	return false
}

func thumbnailDimensionsAllowed(width, height int) bool {
	return width > 0 && height > 0 && max(width, height) <= thumbnailMaxSourceEdge && width <= thumbnailMaxPixels/height
}

func thumbnailResourcePrefix(resourceID string) string {
	return fmt.Sprintf("%x-", sha256.Sum256([]byte(resourceID)))
}

func (c *ThumbnailCache) Open(resource *model.Resource, openSource func() (io.ReadCloser, error)) (*ResourceStream, error) {
	if c == nil || !ThumbnailEligible(resource) {
		return nil, errThumbnailUnavailable
	}
	key := thumbnailResourcePrefix(resource.ID) + fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("v1\n%s\n%s\n%d\n%d", resource.ObjectKey, resource.ETag, resource.Size, resource.UpdatedAt.UnixNano()))))
	if stream, err := c.openCached(resource, key); err == nil || errors.Is(err, errThumbnailUnsupported) {
		return stream, err
	}
	_, err, _ := c.inFlight.Do(key, func() (any, error) {
		if stream, err := c.openCached(resource, key); err == nil {
			stream.Body.Close()
			return nil, nil
		} else if errors.Is(err, errThumbnailUnsupported) {
			return nil, err
		}
		select {
		case c.queue <- struct{}{}:
			defer func() { <-c.queue }()
		default:
			return nil, errThumbnailUnavailable
		}
		wait := time.NewTimer(5 * time.Second)
		defer wait.Stop()
		select {
		case c.workers <- struct{}{}:
			defer func() { <-c.workers }()
		case <-wait.C:
			return nil, errThumbnailUnavailable
		}
		source, err := openSource()
		if err != nil {
			return nil, err
		}
		defer source.Close()
		b, err := io.ReadAll(io.LimitReader(source, thumbnailMaxSourceSize+1))
		if err != nil {
			return nil, err
		}
		thumb, err := encodeThumbnail(resource, b)
		if err != nil && !errors.Is(err, errThumbnailUnsupported) {
			return nil, err
		}
		// An empty cache file records a deterministic fallback for this source
		// revision. Later views can reuse the original without decoding again.
		return nil, c.store(key, thumb)
	})
	if err != nil {
		return nil, err
	}
	return c.openCached(resource, key)
}

func encodeThumbnail(resource *model.Resource, data []byte) ([]byte, error) {
	if len(data) > thumbnailMaxSourceSize || http.DetectContentType(data) != resource.MimeType {
		return nil, errThumbnailUnsupported
	}
	// Keep the original when re-encoding would discard orientation, color
	// profiles or animation. GIF and SVG are excluded before opening the file.
	for _, marker := range []string{"Exif\x00\x00", "ICC_PROFILE\x00", "eXIf", "iCCP", "acTL", "ANIM", "ANMF", "ICCP", "EXIF"} {
		if bytes.Contains(data, []byte(marker)) {
			return nil, errThumbnailUnsupported
		}
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || !thumbnailDimensionsAllowed(config.Width, config.Height) || config.Width != resource.Width || config.Height != resource.Height {
		return nil, errThumbnailUnsupported
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	longest := max(config.Width, config.Height)
	previousEdge := 0
	for _, limit := range []int{thumbnailMaxEdge, 640, 480, 320, 224} {
		edge := min(limit, longest)
		if edge == previousEdge {
			continue
		}
		previousEdge = edge
		width := max(1, (config.Width*edge+longest/2)/longest)
		height := max(1, (config.Height*edge+longest/2)/longest)
		frame := image.NewNRGBA(image.Rect(0, 0, width, height))
		draw.CatmullRom.Scale(frame, frame.Bounds(), source, source.Bounds(), draw.Src, nil)
		var output bytes.Buffer
		if frame.Opaque() {
			err = jpeg.Encode(&output, frame, &jpeg.Options{Quality: 85})
		} else {
			err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&output, frame)
		}
		if err == nil && output.Len() < len(data) && output.Len() <= thumbnailMaxBytes {
			return output.Bytes(), nil
		}
	}
	return nil, errThumbnailUnsupported
}

func (c *ThumbnailCache) openCached(resource *model.Resource, key string) (*ResourceStream, error) {
	file, err := os.Open(filepath.Join(c.dir, key+".thumb"))
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > thumbnailMaxBytes || time.Since(info.ModTime()) > thumbnailKeepFor {
		file.Close()
		return nil, errThumbnailUnavailable
	}
	if info.Size() == 0 {
		file.Close()
		return nil, errThumbnailUnsupported
	}
	var header [512]byte
	n, _ := file.ReadAt(header[:], 0)
	mimeType := http.DetectContentType(header[:n])
	if mimeType != "image/jpeg" && mimeType != "image/png" {
		file.Close()
		return nil, errThumbnailUnavailable
	}
	thumb := *resource
	thumb.MimeType, thumb.Size = mimeType, info.Size()
	return &ResourceStream{Resource: &thumb, Body: file, StatusCode: http.StatusOK, ETag: `"` + key + `"`, ContentLength: info.Size(), AcceptRanges: "bytes"}, nil
}

func (c *ThumbnailCache) store(key string, data []byte) error {
	c.diskMu.Lock()
	defer c.diskMu.Unlock()
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return err
	}
	if err := c.evict(); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(c.dir, ".thumbnail-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, writeErr := tmp.Write(data)
	if err := errors.Join(writeErr, tmp.Close()); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(c.dir, key+".thumb"))
}

func (c *ThumbnailCache) evict() error {
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return err
	}
	now := time.Now()
	if now.Before(c.nextSweep) && len(entries) < thumbnailMaxEntries {
		return nil
	}
	var retained []os.FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if strings.HasPrefix(info.Name(), ".thumbnail-") {
			if now.Sub(info.ModTime()) > time.Hour {
				_ = os.Remove(filepath.Join(c.dir, info.Name()))
			}
			continue
		}
		if !strings.HasSuffix(info.Name(), ".thumb") {
			continue
		}
		if now.Sub(info.ModTime()) > thumbnailKeepFor && os.Remove(filepath.Join(c.dir, info.Name())) == nil {
			continue
		}
		retained = append(retained, info)
	}
	slices.SortFunc(retained, func(a, b os.FileInfo) int { return a.ModTime().Compare(b.ModTime()) })
	for _, info := range retained[:max(0, len(retained)-thumbnailMaxEntries+1)] {
		if err := os.Remove(filepath.Join(c.dir, info.Name())); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	c.nextSweep = now.Add(time.Hour)
	return nil
}

// Remove only cached copies of a resource whose original was already deleted.
func (c *ThumbnailCache) Remove(resourceID string) {
	if c == nil || resourceID == "" {
		return
	}
	c.diskMu.Lock()
	defer c.diskMu.Unlock()
	entries, _ := os.ReadDir(c.dir)
	prefix := thumbnailResourcePrefix(resourceID)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), prefix) && strings.HasSuffix(entry.Name(), ".thumb") {
			_ = os.Remove(filepath.Join(c.dir, entry.Name()))
		}
	}
}
