package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"time"
	"yingce/backend/internal/service"
)

func RegisterEcommerceRoutes(r *gin.RouterGroup, svc *service.Service) {
	group := r.Group("/ecommerce")
	group.Use(func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Set("ecommerce-user", user.ID)
		c.Header("Cache-Control", "private, no-store")
	})
	group.GET("/status", func(c *gin.Context) {
		configured, err := svc.EcommerceConfigured()
		if err != nil {
			failService(c, err)
			return
		}
		enabled, err := svc.FeatureEnabled(service.FeatureEcommerce)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"configured": configured, "enabled": enabled})
	})
	group.GET("/projects", func(c *gin.Context) {
		page, err := parsePositiveQueryInt(c.Query("page"), 1)
		if err != nil {
			fail(c, 400, err)
			return
		}
		items, err := svc.EcommerceProjects(c.GetString("ecommerce-user"), page)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"projects": items})
	})
	group.POST("/projects", func(c *gin.Context) {
		var req service.EcommerceProjectRequest
		if !decodeEcommerce(c, &req) {
			return
		}
		item, err := svc.CreateEcommerceProject(c.GetString("ecommerce-user"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
	group.GET("/projects/:id", func(c *gin.Context) {
		item, err := svc.EcommerceProject(c.GetString("ecommerce-user"), c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
	group.PUT("/projects/:id/draft", func(c *gin.Context) {
		var req service.EcommerceProjectRequest
		if !decodeEcommerce(c, &req) {
			return
		}
		item, err := svc.SaveEcommerceDraft(c.GetString("ecommerce-user"), c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
	group.POST("/projects/:id/archive", func(c *gin.Context) {
		var req struct {
			Revision int64 `json:"revision"`
		}
		if !decodeEcommerce(c, &req) {
			return
		}
		if err := svc.ArchiveEcommerceProject(c.GetString("ecommerce-user"), c.Param("id"), req.Revision); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"archived": true})
	})
	group.GET("/projects/:id/rounds", func(c *gin.Context) {
		page, err := parsePositiveQueryInt(c.Query("page"), 1)
		if err != nil {
			fail(c, 400, err)
			return
		}
		items, err := svc.EcommerceRounds(c.GetString("ecommerce-user"), c.Param("id"), page)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"rounds": items})
	})
	group.GET("/projects/:id/receipts/:requestId", func(c *gin.Context) {
		task, err := svc.EcommerceReceipt(c.GetString("ecommerce-user"), c.Param("id"), c.Param("requestId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"task": task})
	})
	group.POST("/projects/:id/quote", func(c *gin.Context) {
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "ecommerce-quotes:"+c.GetString("ecommerce-user"), policy.Request.TaskCreatePerMinute*4, time.Minute) {
			return
		}
		var req service.EcommerceTaskRequest
		if !decodeEcommerce(c, &req) {
			return
		}
		quote, err := svc.QuoteEcommerceTask(c.GetString("ecommerce-user"), c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, quote)
	})
	group.POST("/projects/:id/tasks", func(c *gin.Context) {
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+c.GetString("ecommerce-user"), policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		var req service.EcommerceTaskRequest
		if !decodeEcommerce(c, &req) {
			return
		}
		task, err := svc.SubmitEcommerceTask(c.GetString("ecommerce-user"), c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, task)
	})
	group.POST("/projects/:id/accept", func(c *gin.Context) {
		var req service.EcommerceAcceptRequest
		if !decodeEcommerce(c, &req) {
			return
		}
		item, err := svc.AcceptEcommerceStage(c.GetString("ecommerce-user"), c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
	group.PATCH("/projects/:id/images/:imageId", func(c *gin.Context) {
		var req service.EcommerceImageEdit
		if !decodeEcommerce(c, &req) {
			return
		}
		item, err := svc.EditEcommerceImage(c.GetString("ecommerce-user"), c.Param("id"), c.Param("imageId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
	r.GET("/admin/ecommerce/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		settings, err := svc.EcommerceSettings(user)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, settings)
	})
	r.PUT("/admin/ecommerce/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		var req service.EcommerceSettings
		if !decodeEcommerce(c, &req) {
			return
		}
		if err := svc.SaveEcommerceSettings(user, req); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})
}

func decodeEcommerce(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	if err := decodeWorkbenchJSON(c, target); err != nil {
		fail(c, http.StatusBadRequest, err)
		return false
	}
	return true
}
