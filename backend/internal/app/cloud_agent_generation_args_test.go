package app

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentGenerationMetadataProjectsNodeFields(t *testing.T) {
	metadata, err := cloudAgentGenerationMetadata("video", map[string]any{
		"model":         "CHANNEL_000011::MiniMax-H3",
		"size":          "16:9",
		"seconds":       15,
		"vquality":      "768p",
		"generateAudio": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if metadata["model"] != "CHANNEL_000011::MiniMax-H3" || metadata["size"] != "16:9" || metadata["vquality"] != "768p" {
		t.Fatalf("metadata = %#v", metadata)
	}
	// 前端按扁平标签读取生成参数，数值字段统一按字符串存储。
	if metadata["seconds"] != "15" {
		t.Fatalf("seconds = %#v, want \"15\"", metadata["seconds"])
	}
	if metadata["generateAudio"] != "true" {
		t.Fatalf("generateAudio = %#v, want \"true\"", metadata["generateAudio"])
	}
}

func TestCloudAgentGenerationMetadataRejectsBadInput(t *testing.T) {
	// 拼错的字段必须报错并列出可用字段，不能静默丢弃后让节点停在编辑器默认值上。
	if _, err := cloudAgentGenerationMetadata("video", map[string]any{"second": 15}); err == nil || !strings.Contains(err.Error(), "seconds") {
		t.Fatalf("typo should list allowed fields, err = %v", err)
	}
	// 跨模式字段：seconds 属于视频，图片节点不接受。
	if _, err := cloudAgentGenerationMetadata("image", map[string]any{"seconds": 15}); err == nil {
		t.Fatal("image node must reject a video option")
	}
	// 非生成节点没有生成规格可言。
	if _, err := cloudAgentGenerationMetadata("text", map[string]any{"size": "16:9"}); err == nil || !strings.Contains(err.Error(), "不接受生成规格") {
		t.Fatalf("text node must reject generation, err = %v", err)
	}
	// 模型选择只能有一种写法。
	if _, err := cloudAgentGenerationMetadata("video", map[string]any{"model": "c::m", "logicalModelId": "l"}); err == nil {
		t.Fatal("model and logicalModelId must be mutually exclusive")
	}
	if _, err := cloudAgentGenerationMetadata("video", map[string]any{"model": "  "}); err == nil {
		t.Fatal("blank model must be rejected")
	}
}

func TestCloudAgentApplyAddNodeWritesGenerationSpec(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "gen-canvas", UserID: "user", Title: "生成画布", PayloadJSON: `{"nodes":[],"connections":[]}`}).Error; err != nil {
		t.Fatal(err)
	}

	state, err := s.CLICanvasState("user", "gen-canvas", 0)
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := state["snapshotHash"].(string)
	raw := []byte(`{"snapshotHash":"` + hash + `","ops":[{"type":"add_node","id":"video-1","nodeType":"video","title":"第 1 段","content":"镜头提示词","generation":{"model":"CHANNEL_000011::MiniMax-H3","size":"16:9","seconds":15,"vquality":"768p","generateAudio":true}}]}`)
	if _, err := s.CLIApplyCanvasOps("user", "gen-canvas", raw); err != nil {
		t.Fatal(err)
	}

	// 读回真实画布文档：状态投影只给摘要字段，生成规格要看节点 metadata。
	stored, err := s.repo.CanvasProjectForUser("user", "gen-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(stored.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	nodes := creationMaps(doc["nodes"])
	if len(nodes) != 1 {
		t.Fatalf("nodes = %#v", nodes)
	}
	metadata, _ := nodes[0]["metadata"].(map[string]any)
	for key, want := range map[string]any{"model": "CHANNEL_000011::MiniMax-H3", "size": "16:9", "seconds": "15", "vquality": "768p", "generateAudio": "true"} {
		if metadata[key] != want {
			t.Fatalf("metadata[%s] = %#v, want %#v（完整 metadata：%#v）", key, metadata[key], want, metadata)
		}
	}

	// 拼错的生成字段必须被拒绝，且不写入任何内容。
	stale, _ := state["snapshotHash"].(string)
	again, err := s.CLICanvasState("user", "gen-canvas", 0)
	if err != nil {
		t.Fatal(err)
	}
	stale, _ = again["snapshotHash"].(string)
	bad := []byte(`{"snapshotHash":"` + stale + `","ops":[{"type":"add_node","id":"video-2","nodeType":"video","generation":{"second":15}}]}`)
	if _, err := s.CLIApplyCanvasOps("user", "gen-canvas", bad); err == nil {
		t.Fatal("typo in generation should be refused")
	}
	after, err := s.repo.CanvasProjectForUser("user", "gen-canvas")
	if err != nil {
		t.Fatal(err)
	}
	afterDoc, err := creationDocument(after.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	if len(creationMaps(afterDoc["nodes"])) != 1 {
		t.Fatal("被拒绝的操作不应写入任何节点")
	}
}

// 只想改生成规格时不该被迫编一个无害 patch：patch 与 generation 至少给一个即可。
func TestCloudAgentUpdateNodeAcceptsGenerationWithoutPatch(t *testing.T) {
	doc, err := creationDocument(`{"nodes":[{"id":"video-1","type":"video","title":"第 1 段","metadata":{"status":"idle"}}],"connections":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	items, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{
		Type: "update_node", ID: "video-1",
		Generation: map[string]any{"model": "CHANNEL_000011::MiniMax-H3", "size": "16:9", "seconds": 15, "vquality": "768p", "generateAudio": true},
	}})
	if err != nil {
		t.Fatalf("只带 generation 的更新被拒绝：%v", err)
	}
	node := cloudAgentCanvasNode(doc, "video-1")
	meta, _ := node["metadata"].(map[string]any)
	for key, want := range map[string]any{"model": "CHANNEL_000011::MiniMax-H3", "size": "16:9", "seconds": "15", "vquality": "768p", "generateAudio": "true"} {
		if meta[key] != want {
			t.Fatalf("metadata[%s] = %#v, want %#v", key, meta[key], want)
		}
	}
	if len(items) != 1 || !strings.Contains(items[0].Summary, "seconds") || !strings.Contains(items[0].Summary, "vquality") {
		t.Fatalf("审批摘要没有回显改动的规格字段：%+v", items)
	}
	// 两个都不给仍然拒绝，且错误可恢复（模型能自己补上）。
	var argumentErr *cloudAgentArgumentError
	if _, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "update_node", ID: "video-1"}}); !errors.As(err, &argumentErr) {
		t.Fatalf("既没 patch 也没 generation 应当是可恢复的参数错误：%v", err)
	}
}

// 写入的生成规格必须读得回来：Agent 写完要能自证，不能只靠下游是否生效来间接判断。
func TestCloudAgentCanvasStateReadsBackGenerationSpec(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	doc := map[string]any{"nodes": []any{}, "connections": []any{}}
	title := "第 1 段"
	if _, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{
		Type: "add_node", ID: "video-1", NodeType: "video", Title: &title,
		Generation: map[string]any{"model": "CHANNEL_000011::MiniMax-H3", "size": "16:9", "seconds": 15, "vquality": "768p", "generateAudio": true},
	}}); err != nil {
		t.Fatal(err)
	}

	view, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	node := view.(map[string]any)["nodes"].([]any)[0].(map[string]any)
	for key, want := range map[string]any{"model": "CHANNEL_000011::MiniMax-H3", "size": "16:9", "seconds": "15", "vquality": "768p", "generateAudio": "true"} {
		if node[key] != want {
			t.Fatalf("摘要投影缺少生成规格 %s：%#v（完整节点：%#v）", key, node[key], node)
		}
	}
	precise, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, []string{"video-1"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	detail := precise.(map[string]any)["nodes"].([]any)[0].(map[string]any)
	if detail["seconds"] != "15" || detail["vquality"] != "768p" {
		t.Fatalf("精读投影缺少生成规格：%#v", detail)
	}
}
