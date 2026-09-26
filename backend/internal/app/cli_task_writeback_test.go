package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// cliWritebackNode 读取画布上的目标节点，断言节点的媒体状态。
func cliWritebackNode(t *testing.T, s *Service, canvasID, nodeID string) (map[string]any, map[string]any) {
	t.Helper()
	canvas, err := s.repo.CanvasProjectForUser("user", canvasID)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		t.Fatal(err)
	}
	node := nodes[nodeID]
	if node == nil {
		t.Fatalf("画布上没有节点 %s", nodeID)
	}
	meta, _ := node["metadata"].(map[string]any)
	return node, meta
}

// submitCLIGeneration 走真实的命令行生成入口，拿到任务与它绑定的节点。
func submitCLIGeneration(t *testing.T, s *Service, args cloudAgentMediaArgs) string {
	t.Helper()
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	submitted, err := s.CLICanvasTool("user", "agent-canvas", "generate_media", raw)
	if err != nil {
		t.Fatal(err)
	}
	taskID, _ := submitted.(map[string]any)["taskId"].(string)
	if taskID == "" {
		t.Fatalf("命令行生成没有返回任务：%#v", submitted)
	}
	return taskID
}

func TestCLIGenerationWritebackLandsResultOnBoundNode(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	taskID := submitCLIGeneration(t, s, args)

	_, meta := cliWritebackNode(t, s, "agent-canvas", args.NodeID)
	if meta["status"] != "loading" || meta["taskId"] != taskID {
		t.Fatalf("命令行生成没有把节点绑到任务上：%#v", meta)
	}

	// 标记必须随任务持久化：任务成功后 InputJSON 会被换成公开投影，标记丢了回写就静默失效。
	var stored model.Task
	if err := db.First(&stored, "id = ?", taskID).Error; err != nil {
		t.Fatal(err)
	}
	decrypted, err := s.decryptTaskInputJSON(stored.InputJSON)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(decrypted, cliGenerationWritebackKey) {
		t.Fatalf("命令行任务没有持久化回写标记：%s", decrypted)
	}

	if err := db.Create(&model.Resource{ID: "gen-video", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 1280, Height: 720}).Error; err != nil {
		t.Fatal(err)
	}
	result := `{"video":{"storageKey":"resource:gen-video","mimeType":"video/mp4","width":1280,"height":720}}`
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{
		"status":      model.TaskStatusSucceeded,
		"result_json": result,
		"input_json":  publicTaskInputJSON(stored.InputJSON),
	}).Error; err != nil {
		t.Fatal(err)
	}

	latest, err := s.repo.Task(taskID)
	if err != nil {
		t.Fatal(err)
	}
	s.taskWorker().writebackCLIGeneratedMedia(latest)

	node, meta := cliWritebackNode(t, s, "agent-canvas", args.NodeID)
	if meta["status"] != "success" || meta["storageKey"] != "resource:gen-video" {
		t.Fatalf("结果没有落到节点上：%#v", meta)
	}
	if meta["taskId"] != taskID || meta["taskStatus"] != string(model.TaskStatusSucceeded) {
		t.Fatalf("回写弄丢了任务绑定：%#v", meta)
	}
	if !strings.Contains(stringValue(meta["content"]), "/api/resources/gen-video/file") {
		t.Fatalf("节点没有拿到可读取的媒体地址：%#v", meta["content"])
	}
	width, _ := node["width"].(float64)
	height, _ := node["height"].(float64)
	if width <= 0 || height <= 0 || height != width*720/1280 {
		t.Fatalf("回写没有按真实分辨率修正节点尺寸：%v x %v", node["width"], node["height"])
	}

	// 写回失败不能在任务日志里留下含糊记录；这条路径成功时不应有错误日志。
	var logs []model.TaskLog
	if err := db.Where("task_id = ?", taskID).Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	for _, entry := range logs {
		if entry.Level == "error" {
			t.Fatalf("回写成功后仍有错误日志：%+v", entry)
		}
	}
}

func TestCLIGenerationWritebackOnlyServesTerminalCLITasks(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	taskID := submitCLIGeneration(t, s, args)
	if err := db.Create(&model.Resource{ID: "gen-video", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 640, Height: 360}).Error; err != nil {
		t.Fatal(err)
	}
	result := `{"video":{"storageKey":"resource:gen-video","mimeType":"video/mp4"}}`

	// 仍在跑：不改画布。
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusRunning, "result_json": result}).Error; err != nil {
		t.Fatal(err)
	}
	latest, err := s.repo.Task(taskID)
	if err != nil {
		t.Fatal(err)
	}
	s.taskWorker().writebackCLIGeneratedMedia(latest)
	if _, meta := cliWritebackNode(t, s, "agent-canvas", args.NodeID); meta["status"] != "loading" {
		t.Fatalf("运行中的任务不该回写画布：%#v", meta)
	}

	// 浏览器生成的任务（没有标记）由前端自己收尾，服务端不碰用户正在编辑的节点。
	browserTask := model.Task{
		ID: "browser-task", UserID: "user", ProjectID: "agent-canvas", Type: "canvas_video",
		Status: model.TaskStatusSucceeded, ResultJSON: result,
		InputJSON: `{"mode":"video","metadata":{"nodeId":"` + args.NodeID + `"}}`,
	}
	if err := db.Create(&browserTask).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.repo.CanvasProjectForUser("user", "agent-canvas"); err != nil {
		t.Fatal(err)
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) == args.NodeID {
			meta, _ := node["metadata"].(map[string]any)
			meta["taskId"] = browserTask.ID
		}
	}
	rebound, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(rebound)).Error; err != nil {
		t.Fatal(err)
	}
	s.taskWorker().writebackCLIGeneratedMedia(&browserTask)
	if _, meta := cliWritebackNode(t, s, "agent-canvas", args.NodeID); meta["status"] != "loading" {
		t.Fatalf("浏览器生成的任务不该由服务端回写：%#v", meta)
	}
}

func TestCLIGenerationWritebackReportsFailureOnNode(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	taskID := submitCLIGeneration(t, s, args)
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{
		"status": model.TaskStatusFailed,
		"error":  "上游拒绝该生成规格",
	}).Error; err != nil {
		t.Fatal(err)
	}
	latest, err := s.repo.Task(taskID)
	if err != nil {
		t.Fatal(err)
	}
	s.taskWorker().writebackCLIGeneratedMedia(latest)

	_, meta := cliWritebackNode(t, s, "agent-canvas", args.NodeID)
	if meta["status"] != "error" || !strings.Contains(stringValue(meta["errorDetails"]), "上游拒绝该生成规格") {
		t.Fatalf("失败的生成没有写到节点上：%#v", meta)
	}
	if meta["taskStatus"] != string(model.TaskStatusFailed) {
		t.Fatalf("节点没有反映真实任务状态：%#v", meta)
	}
}
