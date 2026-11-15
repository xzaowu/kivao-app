package handler

import (
	"net/http"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerInspirationShowcaseRoutes(r *gin.RouterGroup, svc *service.Service) {
	for _, admin := range []bool{false, true} {
		prefix := "/public/inspirations/showcases"
		if admin {
			prefix = "/admin/settings/inspiration-showcases"
		}
		actorFor := func(c *gin.Context) (*model.User, error) {
			if admin {
				return currentUser(c, svc)
			}
			return nil, nil
		}
		r.GET(prefix, func(c *gin.Context) {
			actor, err := actorFor(c)
			if err != nil {
				failService(c, err)
				return
			}
			values, err := svc.InspirationShowcases(actor)
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Cache-Control", "no-store")
			ok(c, gin.H{"showcases": values})
		})
		r.GET(prefix+"/media/:id", func(c *gin.Context) {
			actor, err := actorFor(c)
			if err != nil {
				failService(c, err)
				return
			}
			delivery, err := svc.PrepareInspirationExampleDelivery(actor, c.Param("id"), resourceAccessOptions(c), c.GetHeader("Range"))
			if err != nil {
				failService(c, err)
				return
			}
			serveResourceDelivery(c, delivery, "private, no-store", "")
		})
	}
	r.PUT("/admin/settings/inspiration-showcases", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var input service.InspirationShowcase
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.SaveInspirationShowcase(actor, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"showcase": value})
	})
	r.POST("/admin/settings/inspiration-showcases/assets/:kind", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err == nil {
			err = svc.RequireAdmin(actor)
		}
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "inspiration-example-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		maxBytes := int64(10 << 20)
		if c.Param("kind") == "video" {
			maxBytes = 256 << 20
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes+(1<<20))
		defer func() {
			if c.Request.MultipartForm != nil {
				_ = c.Request.MultipartForm.RemoveAll()
			}
		}()
		file, err := c.FormFile("file")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		resource, err := svc.UploadInspirationExample(actor, c.Param("kind"), file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": gin.H{"id": resource.ID, "kind": resource.Kind}})
	})
}
