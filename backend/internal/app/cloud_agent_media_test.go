package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func agentMediaFixture(t *testing.T) (*Service, *gorm.DB, cloudAgentMediaArgs) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "seedance-test")
	capability.Video.References.PromptMaxChars = 16000
	for _, row := range []any{
		&model.ChannelModel{ID: "video-cm", ChannelID: "channel", ModelKey: "seedance-test", DisplayName: "视频测试", Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "per_second", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "video-tier", ChannelModelID: "video-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "per_second", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
		&model.Resource{ID: "ref-one", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Width: 640, Height: 480, Size: 50},
		&model.Resource{ID: "ref-two", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Width: 640, Height: 480, Size: 50},
		&model.Resource{ID: "private", UserID: "other", Kind: "image", Status: "ready", MimeType: "image/png"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	doc := map[string]any{"nodes": []map[string]any{
		{"id": "shot-1", "type": "text", "title": "镜头1", "position": map[string]any{"x": 10, "y": 10}, "width": 300, "metadata": map[string]any{"content": strings.Repeat("镜头完整指令", 500)}},
		{"id": "cat", "type": "image", "title": "叮当猫在飞", "position": map[string]any{"x": 10, "y": 300}, "width": 300, "metadata": map[string]any{"status": "success", "storageKey": "resource:ref-one", "content": "https://must-not-expose.invalid/one.png"}},
		{"id": "hero", "type": "image", "title": "古风奥特曼", "position": map[string]any{"x": 400, "y": 300}, "width": 300, "metadata": map[string]any{"status": "success", "storageKey": "resource:ref-two"}},
	}, "connections": []any{}}
	raw, _ := json.Marshal(doc)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	audio := true
	a := cloudAgentMediaArgs{Mode: "video", Prompt: "镜头1，参考图1是英雄，参考图2是叮当猫", ChannelID: "channel", ChannelModelKey: "seedance-test", Duration: 12, Size: "9:16", VideoGenerateAudio: &audio, SnapshotHash: creationHash(doc), NodeID: "video-shot-1", Title: "镜头1视频", SourceNodeID: "shot-1", ReferenceNodeIDs: []string{"hero", "cat"}}
	return s, db, a
}

func agentMediaCall(a cloudAgentMediaArgs) cloudAgentCall {
	raw, _ := json.Marshal(a)
	call := cloudAgentCall{ID: "media-call"}
	call.Function.Name, call.Function.Arguments = "generate_media", string(raw)
	return call
}

func agentMediaRun(t *testing.T, s *Service, a cloudAgentMediaArgs, permission string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	req := agentTestRequest()
	req.PermissionMode = permission
	req.Budget.MaxGenerationTasks = 2
	req.Budget.MaxVideoSeconds = 24
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{agentMediaCall(a)}
	if err = s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	return run, state
}

func approveAgentMediaDraft(t *testing.T, s *Service, runID string) {
	t.Helper()
	run, err := s.CloudAgentRun("user", runID)
	if err != nil || run.Approval == nil || run.Status != "waiting_approval" {
		t.Fatalf("media must wait for approval even in auto mode: %v", err)
	}
	if err := s.DecideCloudAgentApproval("user", runID, run.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", runID); err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentMediaApprovalCreatesNodeReferencesAndResult(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	catalog, err := s.cloudAgentModelList()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(catalog)
	if !strings.Contains(string(encoded), `"channelModelKey":"seedance-test"`) || strings.Contains(string(encoded), "logicalModelId") {
		t.Fatalf("wrong catalog: %s", encoded)
	}
	run, state := agentMediaRun(t, s, a, "request_approval")
	if err = s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("charged/submitted before approval")
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("missing approval: %v", err)
	}
	if err = s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err = s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if state.MediaTaskID == "" {
		t.Fatalf("no media task: %s", run.StateJSON)
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input.Config.Size != "9:16" || input.Config.VideoSeconds != "12" || input.Config.VideoGenerateAudio != "true" || len(input.ReferenceImages) != 2 || input.ReferenceImages[0].ID != "hero" || input.ReferenceImages[1].StorageKey != "resource:ref-one" || input.ReferenceImages[0].URL != "" {
		t.Fatalf("lost generation contract: %+v", input)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	node := nodes[a.NodeID]
	if node == nil || node["type"] != "video" || node["metadata"].(map[string]any)["taskId"] != task.ID || len(creationMaps(doc["connections"])) != 3 {
		t.Fatalf("no node/edges: %s", canvas.PayloadJSON)
	}
	if err = s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatal("replay duplicated task")
	}
	if err = db.Create(&model.Resource{ID: "output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 720, Height: 1280}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:output"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err = s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	canvas, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ = creationDocument(canvas.PayloadJSON)
	nodes, _ = creationObjects(doc["nodes"])
	meta := nodes[a.NodeID]["metadata"].(map[string]any)
	if meta["status"] != "success" || meta["storageKey"] != "resource:output" {
		t.Fatalf("result not persisted: %+v", meta)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	found := false
	for _, event := range state.Events {
		if event.Type == "canvas_updated" {
			found = true
		}
	}
	if !found || state.MediaTaskID != "" {
		t.Fatal("completion event/checkpoint missing")
	}
}

func TestCloudAgentMediaReferenceAndSnapshotGuards(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "auto")
	for _, test := range []struct {
		name   string
		change func(*cloudAgentMediaArgs)
	}{
		{"stale snapshot", func(v *cloudAgentMediaArgs) { v.SnapshotHash = "old" }},
		{"missing reference", func(v *cloudAgentMediaArgs) { v.ReferenceNodeIDs = []string{"missing"} }},
		{"text as media", func(v *cloudAgentMediaArgs) { v.ReferenceNodeIDs = []string{"shot-1"} }},
		{"duplicate reference", func(v *cloudAgentMediaArgs) { v.ReferenceNodeIDs = []string{"cat", "cat"} }},
		{"existing node", func(v *cloudAgentMediaArgs) { v.NodeID = "cat" }},
		{"mixed selection", func(v *cloudAgentMediaArgs) { v.LogicalModelID = "made-up" }},
		{"duration budget", func(v *cloudAgentMediaArgs) { v.Duration = 25 }},
		{"missing aspect ratio", func(v *cloudAgentMediaArgs) { v.Size = "" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			bad := a
			test.change(&bad)
			if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(bad)); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("status", "uploading").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err == nil {
		t.Fatal("unready asset accepted")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err == nil {
		t.Fatal("cross-user asset accepted")
	}
}

func TestCloudAgentImageCreatesReferencedNode(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	for _, row := range []any{
		&model.ChannelModel{ID: "image-cm", ChannelID: "channel", ModelKey: "grok-image", Capability: "image", Protocol: model.ChannelInterfaceGrokImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	a.Mode, a.ChannelModelKey, a.Duration, a.VideoGenerateAudio = "image", "grok-image", 0, nil
	a.Size, a.Quality, a.NodeID = "1:1", "2k", "image-shot-1"
	a.ReferenceNodeIDs = []string{"cat"}
	run, _ := agentMediaRun(t, s, a, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(run)
	if state.MediaTaskID == "" {
		t.Fatalf("image admission failed: %+v", state.Events[len(state.Events)-1])
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if task.Operation != "image_to_image" || len(input.ReferenceImages) != 1 || input.Config.Count != "1" || input.Config.Quality != "2k" {
		t.Fatal("image generation contract was lost")
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes[a.NodeID]["type"] != "image" || len(creationMaps(doc["connections"])) != 2 {
		t.Fatal("image node/references missing")
	}
}

func TestCloudAgentCanvasReadsFullPromptAssetsAndConnections(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	result, err := cloudAgentCanvasState(s.repo, "user", doc, 0, []string{"shot-1", "cat"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "must-not-expose") || !strings.Contains(string(raw), `"referenceReady":true`) || !strings.Contains(string(raw), strings.Repeat("镜头完整指令", 500)) {
		t.Fatalf("incomplete/unsafe context: %.200s", raw)
	}
}

func TestCloudAgentMediaRejectAndInvalidModelDoNotCreateTasks(t *testing.T) {
	for _, scenario := range []string{"reject", "invalid-model", "stale-after-approval"} {
		t.Run(scenario, func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			if scenario == "invalid-model" {
				a.ChannelModelKey = "removed-model"
			}
			run, _ := agentMediaRun(t, s, a, "request_approval")
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ := cloudAgentDecode(run)
			if scenario == "invalid-model" {
				var count int64
				db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
				if state.Approval != nil || count != 0 || state.CallIndex != 1 {
					t.Fatal("invalid model created approval or task")
				}
				return
			}
			decision := "approve"
			if scenario == "reject" {
				decision = "reject"
			}
			if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, decision, ""); err != nil {
				t.Fatal(err)
			}
			if scenario == "stale-after-approval" {
				if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", `{"nodes":[],"connections":[]}`).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ = cloudAgentDecode(run)
			var count int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			if count != 0 || state.CallIndex != 1 || state.Generations != 0 || run.Status == "failed" {
				t.Fatalf("unsafe submission or nonrecoverable tool failure: count=%d index=%d status=%s", count, state.CallIndex, run.Status)
			}
		})
	}
}

func TestCloudAgentMediaChangedCanvasRollsBackAdmission(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "auto")
	req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	ordersBefore, err := s.repo.BillingOrdersByTaskIDs("user", state.TaskIDs)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", `{"nodes":[],"connections":[]}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.enqueueCloudAgentTask(run, &state, req, plan); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	ordersAfter, _ := s.repo.BillingOrdersByTaskIDs("user", state.TaskIDs)
	var tasks, orders int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	db.Model(&model.BillingOrder{}).Count(&orders)
	if tasks != 0 || orders != int64(len(ordersBefore)) || len(ordersAfter) != len(ordersBefore) || state.Generations != 0 || state.MediaTaskID != "" || state.CallIndex != 1 {
		t.Fatal("failed canvas CAS left a media task, charge or consumed budget")
	}
}

func TestCloudAgentMediaFailedTaskUpdatesNode(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(run)
	if state.MediaTaskID == "" {
		t.Fatal("media task missing")
	}
	taskID := state.MediaTaskID
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "上游拒绝该生成规格"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes[a.NodeID]["metadata"].(map[string]any)["status"] != "error" {
		t.Fatal("failed generation remained loading")
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	last := state.Events[len(state.Events)-1]
	result, _ := last.Payload["result"].(map[string]any)
	if last.Type != "tool_failed" || result["taskId"] != taskID || result["nodeId"] != a.NodeID || !strings.Contains(stringValue(result["error"]), "上游拒绝该生成规格") {
		t.Fatalf("failure lost diagnostic details: %+v", last)
	}
}

func TestCloudAgentAutoMediaDraftRequiresExplicitApproval(t *testing.T) {
	for _, decision := range []string{"approve", "reject", "cancel"} {
		t.Run(decision, func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, a, "auto")
			var ordersBefore int64
			db.Model(&model.BillingOrder{}).Count(&ordersBefore)
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ := cloudAgentDecode(run)
			if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ModelName != "视频测试" || state.MediaTaskID != "" {
				t.Fatal("auto mode bypassed approval or omitted selected model")
			}
			canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
			doc, _ := creationDocument(canvas.PayloadJSON)
			nodes, _ := creationObjects(doc["nodes"])
			meta, _ := nodes[a.NodeID]["metadata"].(map[string]any)
			if meta["status"] != "idle" || meta["taskId"] != nil || meta["size"] != "9:16" || meta["agentDraftRunId"] != run.ID || len(creationMaps(doc["connections"])) != 3 {
				t.Fatalf("missing uncharged draft with references: %+v", meta)
			}
			// Re-entering the tool while awaiting a decision must remain a no-op.
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			var count, orders int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			db.Model(&model.BillingOrder{}).Count(&orders)
			if count != 0 || orders != ordersBefore {
				t.Fatal("draft created a task or charge")
			}
			// Another run may not take over this draft, even with the latest snapshot.
			foreign := a
			foreign.DraftRunID, foreign.SnapshotHash = "another-run", cloudAgentCanvasHash(doc)
			if _, _, _, err := cloudAgentMediaDocument(s.repo, "user", "agent-canvas", foreign); err == nil {
				t.Fatal("foreign draft overwrite accepted")
			}
			if decision == "cancel" {
				if err := s.CancelCloudAgent(context.Background(), "user", run.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				// A local focus/zoom autosave cannot change the approved content.
				doc["viewport"], doc["updatedAt"] = map[string]any{"x": -900, "y": -500, "k": 0.8}, "later"
				raw, _ := json.Marshal(doc)
				if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
					t.Fatal(err)
				}
				for range 2 {
					if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, decision, ""); err != nil {
						t.Fatal(err)
					}
				}
				if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
					t.Fatal(err)
				}
			}
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			db.Model(&model.BillingOrder{}).Count(&orders)
			if decision == "approve" {
				if count != 1 {
					t.Fatal("explicit approval did not create exactly one task")
				}
			} else if count != 0 || orders != ordersBefore {
				t.Fatal("reject/cancel submitted generation")
			}
		})
	}
}

func TestCloudAgentMediaPromptCountsUnicodeCharacters(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "auto")
	a.Prompt = strings.Repeat("镜", 16000)
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err != nil {
		t.Fatal(err)
	}
	a.Prompt += "头"
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err == nil || !strings.Contains(err.Error(), "16001") {
		t.Fatal("missing exact character count")
	}
}

func TestCloudAgentMediaCancellationUpdatesNode(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	if err := s.CancelCloudAgent(context.Background(), "user", run.ID); err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes[a.NodeID]["metadata"].(map[string]any)["status"] != "error" {
		t.Fatal("cancelled generation remained loading")
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(run)
	if run.Status != "cancelled" || state.MediaTaskID != "" {
		t.Fatal("cancellation did not checkpoint media completion")
	}
}

func TestCloudAgentStoryboardPrecisionAndPermission(t *testing.T) {
	storyboard := map[string]any{"rows": []any{
		map[string]any{"id": "shot-1", "shotNumber": float64(1), "videoMotionPrompt": strings.Repeat("切镜指令", 500), "assetBindings": []any{map[string]any{"nodeId": "hero", "role": "character", "url": "do-not-expose"}}, "private": "do-not-expose"},
		map[string]any{"id": "shot-2", "videoMotionPrompt": "下一镜头"},
	}}
	result := cloudAgentStoryboardState(storyboard, 0, true)
	raw, _ := json.Marshal(result)
	if !strings.Contains(string(raw), strings.Repeat("切镜指令", 500)) || strings.Contains(string(raw), "do-not-expose") || result["nextOffset"] != 1 {
		t.Fatal("storyboard context missing full prompt, pagination or privacy boundary")
	}
	next := cloudAgentStoryboardState(storyboard, 1, true)
	if next["hasMore"] != false || next["rows"].([]any)[0].(map[string]any)["id"] != "shot-2" {
		t.Fatal("storyboard pagination failed")
	}
	req := agentTestRequest()
	req.PermissionMode, req.ContextScope, req.Budget.MaxGenerationTasks = "auto", nil, 1
	if cloudAgentToolAllowed(req, "generate_media") || cloudAgentToolAllowed(req, "canvas_apply_ops") {
		t.Fatal("canvas writes exposed without context permission")
	}
}

func TestCloudAgentCanvasCreatesTypedNodesAndEdges(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{}
	args := map[string]any{"snapshotHash": a.SnapshotHash, "ops": []map[string]any{
		{"type": "add_node", "id": "blank-video", "nodeType": "video", "title": "镜头占位", "content": "生成提示词"},
		{"type": "add_node", "id": "group", "nodeType": "frame", "title": "镜头组"},
		{"type": "connect_nodes", "id": "ref-edge", "fromNodeId": "cat", "toNodeId": "blank-video"},
	}}
	raw, _ := json.Marshal(args)
	call.Function.Arguments = string(raw)
	if _, err = applyCloudAgentCanvas(s.repo, "user", "agent-canvas", call, policy); err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	meta := nodes["blank-video"]["metadata"].(map[string]any)
	if meta["content"] != "" || meta["prompt"] != "生成提示词" || len(creationMaps(doc["connections"])) != 1 {
		t.Fatal("typed nodes/edges missing")
	}
}
