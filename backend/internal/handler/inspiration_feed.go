package handler

import (
	"net/http"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterInspirationFeedRoutes 注册灵感上新：公开读取上新条目（匿名访客也能看到灵感大厅），管理员查看状态、开关与立即同步。
func RegisterInspirationFeedRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerInspirationShowcaseRoutes(r, svc)
	r.GET("/public/inspirations/covers/:id", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !enforceRateLimit(c, "public-inspiration-covers:"+c.ClientIP(), 240, time.Minute) {
			return
		}
		cover, err := svc.OpenInspirationCover(c.Request.Context(), c.Param("id"))
		if err != nil {
			c.Header("Retry-After", "60")
			failService(c, err)
			return
		}
		defer cover.Body.Close()
		c.Header("Content-Type", cover.MIME)
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Cache-Control", "public, max-age=3600")
		c.Header("ETag", cover.ETag)
		http.ServeContent(c.Writer, c.Request, "cover", cover.Info.ModTime(), cover.Body)
	})
	r.GET("/public/inspirations/feed", func(c *gin.Context) {
		if !enforceRateLimit(c, "public-inspirations:"+c.ClientIP(), 120, time.Minute) {
			return
		}
		feed, err := svc.InspirationFeed()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, feed)
	})
	r.GET("/admin/settings/inspiration-feed", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.AdminInspirationFeed(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"status": status})
	})
	r.PATCH("/admin/settings/inspiration-feed", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var input service.InspirationFeedSettingsUpdate
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		status, err := svc.UpdateInspirationFeedSettings(user, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"status": status})
	})
	r.POST("/admin/settings/inspiration-feed/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.SyncInspirationFeed(c.Request.Context(), user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"status": status})
	})
}
