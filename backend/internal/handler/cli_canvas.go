package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterCLICanvasRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/cli/canvases/:id/state", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		offset := 0
		if raw := c.Query("offset"); raw != "" {
			offset, err = strconv.Atoi(raw)
			if err != nil {
				fail(c, http.StatusBadRequest, errors.New("offset 必须是整数"))
				return
			}
		}
		connectionOffset := 0
		if raw := c.Query("connectionOffset"); raw != "" {
			connectionOffset, err = strconv.Atoi(raw)
			if err != nil {
				fail(c, http.StatusBadRequest, errors.New("connectionOffset 必须是整数"))
				return
			}
		}
		state, err := svc.CLICanvasState(user.ID, c.Param("id"), offset, connectionOffset)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, state)
	})
	r.POST("/cli/canvases/:id/ops", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "canvas-write:"+user.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CLIApplyCanvasOps(user.ID, c.Param("id"), json.RawMessage(body))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/cli/canvases/:id/quote", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CLIQuoteMedia(user.ID, c.Param("id"), json.RawMessage(body))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/cli/canvases/:id/tools/:tool", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "canvas-write:"+user.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CLICanvasTool(user.ID, c.Param("id"), c.Param("tool"), json.RawMessage(body))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
