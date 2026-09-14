package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/service"
)

// Agent orchestration is durable; the browser stream never drives execution.
func RegisterAgentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/agent/capabilities", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"version": 2, "permissionModes": []string{"read_only", "request_approval", "auto"}, "contextScopes": []string{"canvas"}, "skills": true, "writeTools": true, "billing": "fixed_request", "maxHistoryPairs": 8, "maxSteps": 8, "tools": []string{"canvas_list_node_types", "canvas_get_state", "skill_read_file", "task_get", "model_list", "canvas_apply_ops", "generate_media"}})
	})
	create := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
		var req service.CloudAgentRequest
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			fail(c, http.StatusBadRequest, errors.New("请求必须只包含一个 JSON 对象"))
			return
		}
		run, err := svc.CreateCloudAgentRun(user.ID, req, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": run})
	}
	r.POST("/agent/runs", create)
	// Each additional message starts a new immutable turn and returns its ID.
	r.POST("/agent/runs/:id/messages", create)
	r.GET("/agent/runs/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		run, err := svc.CloudAgentRun(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": run})
	})
	r.POST("/agent/runs/:id/cancel", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err = svc.CancelCloudAgent(c.Request.Context(), user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"accepted": true})
	})
	r.POST("/agent/runs/:id/undo", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var req struct {
			StepID               string `json:"stepId"`
			ExpectedSnapshotHash string `json:"expectedSnapshotHash"`
			Reason               string `json:"reason"`
		}
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if req.StepID != "" && (!utf8.ValidString(req.StepID) || strings.TrimSpace(req.StepID) != req.StepID || utf8.RuneCountInString(req.StepID) > 160) {
			fail(c, http.StatusBadRequest, errors.New("stepId 无效"))
			return
		}
		if req.Reason != "" && (!utf8.ValidString(req.Reason) || utf8.RuneCountInString(req.Reason) > 2000 || strings.ContainsAny(req.Reason, "\x00\r\n")) {
			fail(c, http.StatusBadRequest, errors.New("reason 无效"))
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			fail(c, http.StatusBadRequest, errors.New("请求必须只包含一个 JSON 对象"))
			return
		}
		result, err := svc.UndoCloudAgentCanvas(user.ID, c.Param("id"), req.StepID, req.ExpectedSnapshotHash, req.Reason)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/agent/runs/:id/approvals/:approvalId/decision", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if _, err = svc.CloudAgentRun(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var req struct {
			Decision string `json:"decision"`
			Reason   string `json:"reason"`
		}
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if req.Decision != "approve" && req.Decision != "reject" {
			fail(c, http.StatusBadRequest, errors.New("decision 无效"))
			return
		}
		if req.Reason != "" && (!utf8.ValidString(req.Reason) || utf8.RuneCountInString(req.Reason) > 2000 || strings.ContainsAny(req.Reason, "\x00\r\n")) {
			fail(c, http.StatusBadRequest, errors.New("reason 无效"))
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			fail(c, http.StatusBadRequest, errors.New("请求必须只包含一个 JSON 对象"))
			return
		}
		if err := svc.DecideCloudAgentApproval(user.ID, c.Param("id"), c.Param("approvalId"), req.Decision, req.Reason); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"accepted": true})
	})
	r.GET("/agent/runs/:id/events", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		run, err := svc.CloudAgentRun(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		after, err := taskTextEventCursor(c)
		if err != nil {
			fail(c, 400, err)
			return
		}
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("X-Accel-Buffering", "no")
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		revision := run.Revision
		lastWrite := time.Now()
		for {
			if err != nil {
				c.SSEvent("error", gin.H{"message": "Agent 状态读取失败"})
				c.Writer.Flush()
				return
			}
			if run != nil {
				for _, event := range run.Events {
					if int64(event.Seq) > after {
						writeAgentSSE(c, "agent_event", int64(event.Seq), event)
						after = int64(event.Seq)
					}
				}
				// Snapshots are state observations, not replayable Agent events; they
				// intentionally have no SSE id and therefore never advance the cursor.
				snapshot := *run
				snapshot.Events = nil // Events were sent once above, never in every snapshot too.
				writeAgentSSE(c, "run_snapshot", 0, &snapshot)
				revision, lastWrite = run.Revision, time.Now()
				if !run.CleanupPending && (run.Status == "completed" || run.Status == "failed" || run.Status == "cancelled") {
					return
				}
			} else if time.Since(lastWrite) >= 15*time.Second {
				_, _ = fmt.Fprint(c.Writer, ": heartbeat\n\n")
				c.Writer.Flush()
				lastWrite = time.Now()
			}
			select {
			case <-c.Request.Context().Done():
				return
			case <-ticker.C:
				run, err = svc.CloudAgentRunIfChanged(user.ID, c.Param("id"), revision)
			}
		}
	})
}

func writeAgentSSE(c *gin.Context, event string, id int64, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	if id > 0 {
		_, _ = fmt.Fprintf(c.Writer, "id: %d\n", id)
	}
	_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data)
	c.Writer.Flush()
}
