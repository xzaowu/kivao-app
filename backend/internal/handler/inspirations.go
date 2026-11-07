package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func RegisterInspirationRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/inspirations", func(c *gin.Context) {
		items, err := svc.Inspirations(nil, false)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"items": items})
	})
	admin := r.Group("/admin/inspirations")
	admin.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.Inspirations(user, true)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items})
	})
	write := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var input service.InspirationInput
		if c.Request.Method == http.MethodDelete {
			version, err := parsePositiveQueryInt(c.Query("version"), 0)
			if err != nil || version < 1 {
				fail(c, http.StatusBadRequest, service.BadAuthRequest("缺少有效的灵感版本"))
				return
			}
			input.Version = version
		} else if err := decodeWorkbenchJSON(c, &input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.SaveInspiration(user, c.Param("id"), input, c.Request.Method == http.MethodDelete)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"item": item})
	}
	admin.POST("", write)
	admin.PATCH("/:id", write)
	admin.DELETE("/:id", write)
}
