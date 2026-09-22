package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCLICanvasStateAndApplyStayOnExistingRules(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "cli-canvas", UserID: "user", Title: "命令行画布", PayloadJSON: `{"nodes":[],"connections":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	state, err := s.CLICanvasState("user", "cli-canvas", 0)
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := state["snapshotHash"].(string)
	if hash == "" || state["canvasId"] != "cli-canvas" || state["title"] != "命令行画布" {
		t.Fatalf("state = %#v", state)
	}
	raw := []byte(`{"snapshotHash":"` + hash + `","ops":[{"type":"add_node","id":"note","nodeType":"text","title":"标题","content":"正文"}]}`)
	result, err := s.CLIApplyCanvasOps("user", "cli-canvas", raw)
	if err != nil {
		t.Fatal(err)
	}
	applied, _ := result.(map[string]any)
	nextHash, _ := applied["snapshotHash"].(string)
	if nextHash == "" || nextHash == hash {
		t.Fatalf("apply result = %#v", result)
	}
	if _, err := s.CLIApplyCanvasOps("user", "cli-canvas", []byte(`{"snapshotHash":"`+hash+`","ops":[{"type":"add_node","id":"other","nodeType":"text"}]}`)); err == nil || !strings.Contains(err.Error(), "请重新读取后再提交") {
		t.Fatalf("stale snapshot should be rejected, err=%v", err)
	}
	if _, err := s.CLIApplyCanvasOps("user", "cli-canvas", []byte(`{"snapshotHash":"`+nextHash+`","ops":[{"type":"delete_node","id":"note"}]}`)); err == nil || !strings.Contains(err.Error(), "只能删除空节点") {
		t.Fatalf("有正文的节点不该被删除, err=%v", err)
	}
	created, err := s.CLICanvasTool("user", "cli-canvas", "canvas_create_storyboard", []byte(`{"snapshotHash":"`+nextHash+`","nodeId":"storyboard-1","title":"追逐","rows":[{"durationSeconds":4,"plotDescription":"主角冲出巷口"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.(map[string]any)["nodeId"] != "storyboard-1" {
		t.Fatalf("storyboard = %#v", created)
	}
	// 同一份写入路径新建的空节点可以撤销；撤销后画布哈希继续前进，旧哈希作废。
	storyboardHash, _ := created.(map[string]any)["snapshotHash"].(string)
	blank, err := s.CLIApplyCanvasOps("user", "cli-canvas", []byte(`{"snapshotHash":"`+storyboardHash+`","ops":[{"type":"add_node","id":"blank","nodeType":"text","title":"待删"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	blankHash, _ := blank.(map[string]any)["snapshotHash"].(string)
	if _, err := s.CLIApplyCanvasOps("user", "cli-canvas", []byte(`{"snapshotHash":"`+blankHash+`","ops":[{"type":"delete_node","id":"blank"}]}`)); err != nil {
		t.Fatalf("Agent 建的空节点应当可以撤销, err=%v", err)
	}
	if _, err := s.CLICanvasTool("user", "cli-canvas", "generate_media", []byte(`{"mode":"image","prompt":"海报","nodeId":"image-1","title":"海报"}`)); err == nil {
		t.Fatal("generation without a selected model should fail before use")
	}
	if _, err := s.CLICanvasState("other", "cli-canvas", 0); err == nil {
		t.Fatal("foreign canvas state leaked")
	}
	encoded, err := json.Marshal(result)
	if err != nil || strings.Contains(string(encoded), "http://") {
		t.Fatalf("result leaked a URL or failed to encode: %s %v", encoded, err)
	}
}

func TestCLIQuoteMediaPricesWithoutSideEffectsAndMatchesSubmission(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	var tasksBefore, ordersBefore int64
	db.Model(&model.Task{}).Count(&tasksBefore)
	db.Model(&model.BillingOrder{}).Count(&ordersBefore)

	quoted, err := s.CLIQuoteMedia("user", "agent-canvas", raw)
	if err != nil {
		t.Fatalf("quote failed on args the submission accepts: %v", err)
	}
	quote, _ := quoted.(map[string]any)
	amount, _ := quote["amountMicrocredits"].(int64)
	credits, _ := quote["estimatedCredits"].(float64)
	if amount <= 0 || credits != float64(amount)/float64(CreditScale) {
		t.Fatalf("quote did not expose a usable price: %#v", quoted)
	}
	if quote["canvasId"] != "agent-canvas" || quote["mode"] != "video" || quote["nodeId"] != args.NodeID || quote["billingMode"] != "per_second" {
		t.Fatalf("quote lost submission identity: %#v", quoted)
	}
	var tasksAfter, ordersAfter int64
	db.Model(&model.Task{}).Count(&tasksAfter)
	db.Model(&model.BillingOrder{}).Count(&ordersAfter)
	if tasksAfter != tasksBefore || ordersAfter != ordersBefore {
		t.Fatalf("quote must not create tasks or orders: tasks %d->%d orders %d->%d", tasksBefore, tasksAfter, ordersBefore, ordersAfter)
	}
	var canvas model.CanvasProject
	if err := db.First(&canvas, "id = ?", "agent-canvas").Error; err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	if nodes, _ := creationObjects(doc["nodes"]); nodes[args.NodeID] != nil {
		t.Fatalf("quote wrote the generation node: %s", canvas.PayloadJSON)
	}

	submitted, err := s.CLICanvasTool("user", "agent-canvas", "generate_media", raw)
	if err != nil {
		t.Fatal(err)
	}
	taskID, _ := submitted.(map[string]any)["taskId"].(string)
	var order model.BillingOrder
	if err := db.First(&order, "task_id = ?", taskID).Error; err != nil {
		t.Fatal(err)
	}
	if order.AmountMicrocredits != amount || order.BillingMode != quote["billingMode"] {
		t.Fatalf("quote %#v disagrees with the real order %+v", quote, order)
	}

	if _, err := s.CLIQuoteMedia("user", "agent-canvas", []byte(`{"mode":"video","prompt":"海报","nodeId":"image-2","videoEditOperation":"not-an-operation"}`)); err == nil {
		t.Fatal("quote must reject args the submission rejects")
	}
	if _, err := s.CLIQuoteMedia("user", "other-canvas", raw); err == nil {
		t.Fatal("quote leaked a foreign canvas")
	}
}
