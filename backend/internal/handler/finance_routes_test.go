package handler

import (
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestFinanceRoutesExposeChannelModelMutations(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), &service.Service{})

	wanted := map[string]bool{
		"POST /api/admin/channels/:id/models/batch-delete": false,
		"PATCH /api/admin/channels/:id/models/:modelId":    false,
		"POST /api/admin/channels/:id/models/:modelId":     false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, registered := range wanted {
		if !registered {
			t.Fatalf("route %s is not registered", route)
		}
	}
}
