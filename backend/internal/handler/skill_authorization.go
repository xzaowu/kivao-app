package handler

import (
	"strings"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// Reject skill requests before parsing uploads or fetching remote packages.
func requireSkillAdministration(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err == nil {
			if skillUseRoute(c.Request.Method, c.FullPath()) {
				err = svc.RequireSkillUser(actor.ID)
			} else {
				err = svc.RequireSkillAdministrator(actor.ID)
			}
		}
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	}
}

// Default-deny new routes: only catalogue reads and personal selection state are public to members.
func skillUseRoute(method, route string) bool {
	if strings.Contains(route, "/admin/") {
		return false
	}
	switch method {
	case "GET":
		for _, suffix := range []string{"/skills", "/skills/added", "/skills/:id", "/skills/curation", "/skills/library-categories"} {
			if strings.HasSuffix(route, suffix) {
				return true
			}
		}
	case "POST", "DELETE":
		return strings.HasSuffix(route, "/skills/:id/add") || strings.HasSuffix(route, "/skills/:id/like")
	case "PATCH":
		return strings.HasSuffix(route, "/skills/:id/agent-mode")
	}
	return false
}
