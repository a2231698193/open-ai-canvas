package app

import (
	"strings"
	"testing"
)

// 撤销空节点是删除操作，默认拒绝；只有同一份计划函数新建出来的空节点能删。
// 每条拒绝理由都要能让模型自己改对，所以逐个断言错误文案。
func TestCloudAgentDeleteNodeOnlyRemovesAgentCreatedEmptyNodes(t *testing.T) {
	content := "已经写好的提示词"
	doc := map[string]any{"nodes": []any{}, "connections": []any{}}
	if _, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{
		{Type: "add_node", ID: "mine", NodeType: "video"},
		{Type: "add_node", ID: "linked", NodeType: "video"},
		{Type: "add_node", ID: "tasked", NodeType: "video"},
		{Type: "add_node", ID: "filled", NodeType: "video", Content: &content},
		{Type: "add_node", ID: "referenced", NodeType: "video"},
		{Type: "add_node", ID: "user-made", NodeType: "video"},
	}); err != nil {
		t.Fatal(err)
	}
	if len(creationMaps(doc["nodes"])) != 6 {
		t.Fatalf("新建节点数量不对：%d", len(creationMaps(doc["nodes"])))
	}

	// 逐条制造"不该被删"的情形：换作者、绑任务、写正文、连边、被分镜引用。
	metaOf := func(id string) map[string]any {
		node := cloudAgentCanvasNode(doc, id)
		meta, _ := node["metadata"].(map[string]any)
		return meta
	}
	delete(metaOf("user-made"), cloudAgentNodeAuthorField)
	metaOf("tasked")["taskId"] = "task-1"
	doc["connections"] = []any{map[string]any{"id": "edge-1", "fromNodeId": "linked", "toNodeId": "tasked"}}
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{
		"id": "storyboard-1", "type": "storyboard", "title": "追逐戏",
		"metadata": map[string]any{"rows": []any{map[string]any{"id": "shot-1", "imageNodeId": "referenced"}}},
	})

	for _, tc := range []struct{ id, want string }{
		{"missing", "只能删除存在的节点"},
		{"user-made", "不是 Agent 建的"},
		{"tasked", "已经提交过生成"},
		{"filled", "只能删除空节点"},
		{"linked", "没有连线的节点"},
		{"referenced", "正在引用它"},
	} {
		if _, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "delete_node", ID: tc.id}}); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("删除 %s 应当被拒绝并说明「%s」，实际 err=%v", tc.id, tc.want, err)
		}
	}
	if cloudAgentNodeIndex(creationMaps(doc["nodes"]), "mine") < 0 {
		t.Fatal("被拒绝的删除不应改动画布")
	}

	items, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "delete_node", ID: "mine"}})
	if err != nil {
		t.Fatalf("删除自己建的空节点被拒绝：%v", err)
	}
	if cloudAgentNodeIndex(creationMaps(doc["nodes"]), "mine") >= 0 {
		t.Fatal("节点没有被删除")
	}
	if len(items) != 1 || items[0].Operation != "delete_node" || items[0].NodeID != "mine" {
		t.Fatalf("删除预览不对：%+v", items)
	}
	if preview := cloudAgentCanvasApprovalPreview(items); !strings.Contains(preview.Description, "删除 1 个空节点") {
		t.Fatalf("审批摘要没有说明删除数量：%s", preview.Description)
	}
}

// 作者标记必须能读出来：模型据此知道哪些节点是自己建的、可以撤销。
func TestCloudAgentCanvasStateExposesAgentCreatedNodes(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	doc := map[string]any{"nodes": []any{}, "connections": []any{}}
	if _, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "add_node", ID: "mine", NodeType: "video"}}); err != nil {
		t.Fatal(err)
	}
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{
		"id": "user-made", "type": "video", "title": "用户建的",
		"metadata": map[string]any{"status": "idle"},
	})

	view, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	state, _ := view.(map[string]any)
	seen := map[string]any{}
	for _, item := range state["nodes"].([]any) {
		node := item.(map[string]any)
		seen[stringValue(node["id"])] = node["agentCreated"]
	}
	if seen["mine"] != true {
		t.Fatalf("Agent 建的节点没有 agentCreated 标记：%#v", seen)
	}
	if _, leaked := seen["user-made"]; !leaked || seen["user-made"] != nil {
		t.Fatalf("普通节点不应带 agentCreated：%#v", seen)
	}
}
