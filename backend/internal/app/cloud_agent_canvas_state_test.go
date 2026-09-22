package app

import (
	"fmt"
	"strings"
	"testing"
)

// 连线是全量事实：即使某条边的端点不在这页节点里，也必须返回并计数。
// 旧实现按「两端节点是否在本页」过滤，导致调用方看不到这些边、判定成缺失，
// 于是重复建同一条边并撞上「连线重复」。
func TestCloudAgentCanvasStateKeepsEveryConnection(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	nodes := make([]any, 0, 45)
	for index := 0; index < 45; index++ {
		nodes = append(nodes, map[string]any{
			"id": fmt.Sprintf("n-%02d", index), "type": "text", "title": fmt.Sprintf("节点 %d", index),
			"position": map[string]any{"x": float64(index * 10), "y": float64(0)}, "width": float64(120), "height": float64(80),
			"metadata": map[string]any{"content": "正文", "status": "idle"},
		})
	}
	doc := map[string]any{
		"nodes": nodes,
		"connections": []any{
			// 两端都在第一页（节点页上限 40）。
			map[string]any{"id": "e-near", "fromNodeId": "n-01", "toNodeId": "n-02"},
			// 一端在第二页：这一条正是旧实现会丢掉的。
			map[string]any{"id": "e-far", "fromNodeId": "n-44", "toNodeId": "n-00"},
		},
	}

	view, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	state, _ := view.(map[string]any)
	if state["hasMore"] != true {
		t.Fatalf("40 个节点应当分页，state = %#v", state["hasMore"])
	}
	if state["totalConnections"] != 2 {
		t.Fatalf("totalConnections = %#v, want 2", state["totalConnections"])
	}
	edges, _ := state["connections"].([]any)
	if len(edges) != 2 {
		t.Fatalf("connections = %#v, want 两条都在", edges)
	}
	ids := map[string]bool{}
	for _, edge := range edges {
		ids[stringValue(edge.(map[string]any)["id"])] = true
	}
	if !ids["e-near"] || !ids["e-far"] {
		t.Fatalf("连线缺失：%#v", ids)
	}
	if state["hasMoreConnections"] != false {
		t.Fatalf("全部返回后不应报告还有更多：%#v", state["hasMoreConnections"])
	}

	// 从连线游标继续读时不应重复返回已给过的边。
	view2, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, nil, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	state2, _ := view2.(map[string]any)
	if len(state2["connections"].([]any)) != 0 || state2["hasMoreConnections"] != false {
		t.Fatalf("游标越过末尾后应为空：%#v", state2["connections"])
	}
}

// 摘要页正文被截断时必须点出节点 ID：否则调用方会把 2000 字符的摘要当全文，
// 也不会知道还能精读到 16000 字符。
func TestCloudAgentCanvasStateReportsTruncatedNodes(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	long := strings.Repeat("镜头指令", 700)
	doc := map[string]any{
		"nodes": []any{
			map[string]any{"id": "long-1", "type": "text", "title": "长提示词", "position": map[string]any{"x": float64(0), "y": float64(0)}, "width": float64(120), "height": float64(80), "metadata": map[string]any{"content": long}},
			map[string]any{"id": "short-1", "type": "text", "title": "短提示词", "position": map[string]any{"x": float64(200), "y": float64(0)}, "width": float64(120), "height": float64(80), "metadata": map[string]any{"content": "一句话"}},
		},
		"connections": []any{},
	}

	view, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	state, _ := view.(map[string]any)
	ids, _ := state["truncatedNodeIds"].([]any)
	if len(ids) != 1 || ids[0] != "long-1" {
		t.Fatalf("truncatedNodeIds = %#v", state["truncatedNodeIds"])
	}
	if note, _ := state["truncatedNote"].(string); !strings.Contains(note, "16000") {
		t.Fatalf("truncatedNote 没有告诉调用方怎么读全文：%#v", state["truncatedNote"])
	}

	precise, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, []string{"long-1"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	full, _ := precise.(map[string]any)
	if full["truncatedNodeIds"] != nil {
		t.Fatalf("精读不应报告截断：%#v", full["truncatedNodeIds"])
	}
	node := full["nodes"].([]any)[0].(map[string]any)
	if node["content"] != long {
		t.Fatalf("精读没有返回全文：%d 字符", len([]rune(stringValue(node["content"]))))
	}
}
func TestCloudAgentCanvasStatePagesConnectionsForward(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	const total = 2500
	edges := make([]any, 0, total)
	for index := 0; index < total; index++ {
		edges = append(edges, map[string]any{
			"id": fmt.Sprintf("e-%04d", index), "fromNodeId": "n-0000", "toNodeId": "n-0001",
		})
	}
	doc := map[string]any{
		"nodes": []any{
			map[string]any{"id": "n-0000", "type": "text", "title": "起点", "position": map[string]any{"x": float64(0), "y": float64(0)}, "width": float64(120), "height": float64(80), "metadata": map[string]any{"content": "正文"}},
			map[string]any{"id": "n-0001", "type": "text", "title": "终点", "position": map[string]any{"x": float64(200), "y": float64(0)}, "width": float64(120), "height": float64(80), "metadata": map[string]any{"content": "正文"}},
		},
		"connections": edges,
	}

	seen := map[string]bool{}
	offset, pages := 0, 0
	for {
		pages++
		if pages > 20 {
			t.Fatalf("连线分页没有读完就停在 offset=%d（游标没有前进）", offset)
		}
		view, err := cloudAgentCanvasState(s.repo, "user", "canvas", doc, 0, nil, 0, offset)
		if err != nil {
			t.Fatal(err)
		}
		state, _ := view.(map[string]any)
		if state["totalConnections"] != total {
			t.Fatalf("totalConnections = %#v, want %d", state["totalConnections"], total)
		}
		if state["connectionOffset"] != offset {
			t.Fatalf("connectionOffset = %#v, want %d", state["connectionOffset"], offset)
		}
		page, _ := state["connections"].([]any)
		if len(page) == 0 {
			t.Fatalf("第 %d 页为空但 hasMoreConnections = %#v", pages, state["hasMoreConnections"])
		}
		for _, edge := range page {
			id := stringValue(edge.(map[string]any)["id"])
			if seen[id] {
				t.Fatalf("连线 %s 被重复返回", id)
			}
			seen[id] = true
		}
		if state["hasMoreConnections"] != true {
			break
		}
		next, ok := state["nextConnectionOffset"].(int)
		if !ok || next <= offset {
			t.Fatalf("nextConnectionOffset = %#v，游标必须前进（当前 %d）", state["nextConnectionOffset"], offset)
		}
		offset = next
	}
	if pages < 2 {
		t.Fatalf("%d 条连线应当分成多页，实际只有 %d 页", total, pages)
	}
	if len(seen) != total {
		t.Fatalf("只读到 %d 条连线，want %d", len(seen), total)
	}
}
