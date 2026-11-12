package handler

import (
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func RegisterCommerceStudioRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/admin/ecommerce-agent/skills/install", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, (1<<30)+(1<<20))
		defer func() {
			if c.Request.MultipartForm != nil {
				_ = c.Request.MultipartForm.RemoveAll()
			}
		}()
		file, err := c.FormFile("file")
		if err != nil {
			failService(c, service.BadAuthRequest("请选择技能文件，文件太大时请缩小至 1GB 以内"))
			return
		}
		if err := svc.InstallCommerceStudioSkillUpload(user, file); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"installed": true})
	})
	r.POST("/admin/ecommerce-agent/skills/install/github", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req struct {
			URL    string `json:"url"`
			Subdir string `json:"subdir"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("GitHub 安装参数无效"))
			return
		}
		if err := svc.InstallCommerceStudioSkillGitHub(c.Request.Context(), user, req.URL, req.Subdir); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"installed": true})
	})
	r.PATCH("/admin/ecommerce-agent/skills/:id/name", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var req struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("名称无效"))
			return
		}
		if err := svc.RenameCommerceStudioSkill(user, c.Param("id"), req.Name); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"name": req.Name})
	})
	r.Match([]string{http.MethodGet, http.MethodPost}, "/ecommerce-agent/download", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ids := c.QueryArray("resourceId")
		if c.Request.Method == http.MethodPost {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
			ids = c.PostFormArray("resourceId")
		}
		files, err := svc.CommerceStudioDownloadResources(user.ID, ids)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Type", "application/zip")
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "电商图片.zip"}))
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)
		c.Writer.Flush()
		if err := svc.WriteCommerceStudioDownload(c.Request.Context(), user.ID, files, c.Writer); err != nil {
			slog.Warn("ecommerce download interrupted", "error", err)
		}
	})
	r.GET("/admin/ecommerce-agent/categories", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		data, err := svc.CommerceStudioIndustryCategories(user, c.Query("parentId"), c.Query("q"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, data)
	})
	r.GET("/admin/ecommerce-agent/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.CommerceStudioManagedSkills(user)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"skills": items})
	})
	r.PATCH("/admin/ecommerce-agent/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if req.Enabled == nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("请指定 enabled"))
			return
		}
		if err := svc.SetCommerceStudioManagedSkillEnabled(user, c.Param("id"), *req.Enabled); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"enabled": *req.Enabled})
	})
	r.POST("/ecommerce-agent/projects/:id/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.CreateTaskRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		req.TraceID, req.RequestID = TraceID(c), RequestID(c)
		task, err := svc.CreateCommerceStudioPlanningTask(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, task)
	})
	r.GET("/ecommerce-agent/agent-setting", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.CommerceStudioAgentSetting()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, setting)
	})
	r.GET("/ecommerce-agent/knowledge/orchestration", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.CommerceStudioOrchestrationSetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, setting)
	})
	r.PUT("/ecommerce-agent/knowledge/orchestration", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req service.CommerceStudioOrchestrationSetting
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateCommerceStudioOrchestrationSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, setting)
	})
	r.POST("/ecommerce-agent/creative-directions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.CommerceStudioCreativeDirectionsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		response, err := svc.RecommendCommerceStudioCreativeDirectionsContext(c.Request.Context(), user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, response)
	})
	r.POST("/ecommerce-agent/creative-directions/:id/select", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req service.CommerceStudioStyleChoice
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		selection, err := svc.SelectCommerceStudioCreativeStyle(c.Request.Context(), user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, selection)
	})
	r.GET("/ecommerce-agent/knowledge/stats", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		stats, err := svc.CommerceStudioKnowledgeStats()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, stats)
	})
	r.POST("/ecommerce-agent/knowledge/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.SyncCommerceStudioKnowledge(c.Request.Context(), user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.PATCH("/ecommerce-agent/knowledge/sources/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
			fail(c, http.StatusBadRequest, errors.New("缺少知识源启用状态"))
			return
		}
		if err := svc.SetCommerceStudioKnowledgeSourceEnabled(user, c.Param("id"), *req.Enabled); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"enabled": *req.Enabled})
	})
	r.GET("/ecommerce-agent/knowledge/entries", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, limitErr := strconv.Atoi(c.DefaultQuery("limit", "20"))
		if pageErr != nil || limitErr != nil {
			fail(c, http.StatusBadRequest, errors.New("分页参数无效"))
			return
		}
		result, err := svc.CommerceStudioKnowledgeEntryPage(user, c.Query("keyword"), c.Query("status"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.PATCH("/ecommerce-agent/knowledge/entries/:id/review", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			Status string `json:"status"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.ReviewCommerceStudioKnowledgeEntry(user, c.Param("id"), req.Status); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"status": req.Status})
	})
	r.POST("/ecommerce-agent/skills/prompt", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			SkillIDs []string `json:"skillIds"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		prompt, err := svc.CommerceStudioSkillPrompt(user.ID, req.SkillIDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"prompt": prompt})
	})
	r.GET("/ecommerce-agent/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, sizeErr := strconv.Atoi(c.DefaultQuery("pageSize", "100"))
		if pageErr != nil || sizeErr != nil || page < 1 || page > 100000 || (pageSize != 20 && pageSize != 50 && pageSize != 100) {
			fail(c, http.StatusBadRequest, errors.New("分页参数无效"))
			return
		}
		projects, total, err := svc.CommerceStudioProjectPage(user.ID, page, pageSize)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"projects": projects, "total": total, "page": page, "pageSize": pageSize})
	})
	r.DELETE("/ecommerce-agent/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 80<<10)
		var req service.DeleteCommerceStudioProjectsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		deleted, err := svc.DeleteCommerceStudioProjects(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": deleted})
	})
	r.POST("/ecommerce-agent/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		project, err := svc.CreateCommerceStudioProject(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, project)
	})
	r.GET("/ecommerce-agent/projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		project, err := svc.CommerceStudioProjectView(user.ID, c.Param("id"), c.Query("history") == "active")
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, project)
	})
	r.GET("/ecommerce-agent/projects/:id/rounds", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, limitErr := strconv.Atoi(c.DefaultQuery("limit", "10"))
		before, beforeErr := strconv.Atoi(c.DefaultQuery("before", "0"))
		if limitErr != nil || beforeErr != nil || before < 0 {
			fail(c, http.StatusBadRequest, errors.New("历史分页参数无效"))
			return
		}
		page, err := svc.CommerceStudioRoundPage(user.ID, c.Param("id"), limit, before)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, page)
	})
	r.POST("/ecommerce-agent/projects/:id/rounds-convert", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req struct {
			Revision int64 `json:"revision"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Revision < 1 {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("缺少有效的项目版本"))
			return
		}
		project, conversion, err := svc.ConvertCommerceStudioRounds(user.ID, c.Param("id"), req.Revision)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"project": project, "conversion": conversion})
	})
	r.PATCH("/ecommerce-agent/projects/:id/rounds/:roundId/images/:imageId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.CommerceStudioRoundImageUpdateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("图片更新参数无效"))
			return
		}
		round, err := svc.UpdateCommerceStudioRoundImage(user.ID, c.Param("id"), c.Param("roundId"), c.Param("imageId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, round)
	})
	r.PUT("/ecommerce-agent/projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
		var req service.SaveCommerceStudioProjectRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				fail(c, http.StatusRequestEntityTooLarge, service.BadAuthRequest("保存内容超过 4 MiB 上限，请减少当前轮图片或参数后重试"))
				return
			}
			fail(c, http.StatusBadRequest, err)
			return
		}
		project, err := svc.SaveCommerceStudioProject(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, project)
	})
}
