package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func agentCanvasPatchForOperation(t *testing.T, state cloudAgentRuntime, operation string) map[string]any {
	t.Helper()
	var found map[string]any
	for _, event := range state.Events {
		if event.Type == "canvas_updated" && event.Payload["operation"] == operation {
			if found != nil {
				t.Fatalf("duplicate canvas event for %s", operation)
			}
			found = event.Payload
		}
	}
	if found == nil {
		t.Fatalf("missing persisted canvas event for %s", operation)
	}
	return found
}

func TestCloudAgentCanvasPatchesPersistDraftSubmissionAndAllTerminalStates(t *testing.T) {
	for _, status := range []model.TaskStatus{model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled} {
		t.Run(string(status), func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, args, "auto")
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			approveAgentMediaDraft(t, s, run.ID)
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ := cloudAgentDecode(run)
			taskID := state.MediaTaskID
			if taskID == "" {
				t.Fatal("approved task missing")
			}
			if status == model.TaskStatusCancelled {
				if err := s.CancelCloudAgent(context.Background(), "user", run.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				result := "{}"
				if status == model.TaskStatusSucceeded {
					if err := db.Create(&model.Resource{ID: "patch-output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4"}).Error; err != nil {
						t.Fatal(err)
					}
					result = `{"mode":"video","video":{"storageKey":"resource:patch-output"}}`
				}
				if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": status, "result_json": result, "error": "上游拒绝"}).Error; err != nil {
					t.Fatal(err)
				}
				if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
					t.Fatal(err)
				}
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ = cloudAgentDecode(run)
			draft := agentCanvasPatchForOperation(t, state, "generate_media_draft")
			patch := draft["canvasPatch"].(map[string]any)
			changes := creationMaps(patch["nodes"])
			if patch["canvasId"] != "agent-canvas" || len(changes) != 1 || changes[0]["before"] != nil || len(creationMaps(patch["connections"])) != 3 {
				t.Fatalf("draft is not a bounded node/edge delta: %+v", patch)
			}
			referenceTitles := map[string]bool{}
			for _, action := range creationMaps(draft["actions"]) {
				if action["action"] == "referenced" {
					referenceTitles[stringValue(action["title"])] = true
				}
			}
			if !referenceTitles["叮当猫在飞"] || !referenceTitles["古风奥特曼"] {
				t.Fatalf("persisted trace lost referenced node titles: %+v", draft["actions"])
			}
			submission := agentCanvasPatchForOperation(t, state, "generate_media_submit")["canvasPatch"].(map[string]any)
			submitted := creationMaps(submission["nodes"])[0]["after"].(map[string]any)["metadata"].(map[string]any)
			if submitted["status"] != "loading" || submitted["taskId"] != taskID || len(creationMaps(submission["connections"])) != 0 {
				t.Fatalf("submission failed to lock the existing draft: %+v", submission)
			}
			completion := agentCanvasPatchForOperation(t, state, "generate_media_complete")["canvasPatch"].(map[string]any)
			changes = creationMaps(completion["nodes"])
			if len(changes) != 1 || len(creationMaps(completion["connections"])) != 0 {
				t.Fatalf("completion includes unrelated canvas data: %+v", completion)
			}
			before := changes[0]["before"].(map[string]any)["metadata"].(map[string]any)
			after := changes[0]["after"].(map[string]any)["metadata"].(map[string]any)
			want := "error"
			if status == model.TaskStatusSucceeded {
				want = "success"
			}
			if before["status"] != "loading" || after["status"] != want || after["taskStatus"] != string(status) || after["taskId"] != taskID {
				t.Fatalf("terminal patch lost task identity/state: %+v", changes[0])
			}
			// Replaying a checkpoint must not create another charged task or delta.
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			var count int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			if count != 1 {
				t.Fatal("terminal handling resubmitted a charged task")
			}
		})
	}
}

func TestCloudAgentMediaImageSourceHasActionableCorrection(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, args, "auto")
	args.SourceNodeID = "cat"
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args)); err == nil || !strings.Contains(err.Error(), "referenceNodeIds") {
		t.Fatalf("image source must point to the correct field: %v", err)
	}
	args.ReferenceNodeIDs = []string{"hero"}
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args)); err == nil || !strings.Contains(err.Error(), "sourceNodeId 仅接受文本") {
		t.Fatalf("nonduplicate image source must also be rejected: %v", err)
	}
	args.SourceNodeID = ""
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args)); err != nil {
		t.Fatalf("reference-only image-to-video should be valid: %v", err)
	}
}

func TestCloudAgentCanvasOperationTraceSharesToolCallID(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, args, "auto")
	call := cloudAgentCall{ID: "canvas-call"}
	call.Function.Name = "canvas_apply_ops"
	raw, _ := json.Marshal(map[string]any{"snapshotHash": args.SnapshotHash, "ops": []map[string]any{
		{"type": "add_node", "id": "trace-video", "nodeType": "video", "title": "视频草稿"},
		{"type": "connect_nodes", "id": "trace-reference", "fromNodeId": "cat", "toNodeId": "trace-video"},
	}})
	call.Function.Arguments = string(raw)
	state.Calls = []cloudAgentCall{call}
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	trace := agentCanvasPatchForOperation(t, state, "canvas_apply_ops")
	last := state.Events[len(state.Events)-1]
	if trace["callId"] != call.ID || last.Type != "tool_completed" || last.Payload["callId"] != call.ID {
		t.Fatalf("canvas delta and tool result cannot be deduplicated: %+v / %+v", trace, last)
	}
	actions := creationMaps(trace["actions"])
	if len(actions) != 2 || actions[0]["title"] != "视频草稿" || actions[1]["title"] != "叮当猫在飞" {
		t.Fatalf("canvas operation trace lost titles: %+v", actions)
	}
}

func TestCloudAgentMissingCanvasStillCheckpointsMediaFailure(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, args, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(run)
	if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("id = ?", "agent-canvas").Delete(&model.CanvasProject{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if run.Status != "failed" || state.MediaTaskID != "" || state.Events[len(state.Events)-1].Type != "tool_failed" {
		t.Fatal("deleted canvas left the media checkpoint running")
	}
	for _, event := range state.Events {
		if event.Type == "canvas_updated" && event.Payload["operation"] == "generate_media_complete" {
			t.Fatal("deleted canvas produced a phantom node update")
		}
	}
}

func TestCloudAgentMediaPolicyAllowsDefaultsWithoutBypassingApproval(t *testing.T) {
	for _, text := range []string{"安全默认", "不要求四项逐个确认", "一次性询问", "界面独立审批", "失败不得自动重提"} {
		if !strings.Contains(cloudAgentMediaPolicy, text) {
			t.Fatalf("media policy lost %q", text)
		}
	}
	// Deltas remain JSON serializable when a newly created node has no before value.
	raw, err := json.Marshal(cloudAgentObjectChanges([]any{}, []map[string]any{{"id": "new"}}))
	if err != nil || !strings.Contains(string(raw), `"before":null`) {
		t.Fatalf("invalid creation delta: %s %v", raw, err)
	}
}
