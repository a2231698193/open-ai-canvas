package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func batchTestAction(id string, credits float64, ageMinutes int) pendingAction {
	return pendingAction{
		ID:       id,
		Kind:     "tool",
		CanvasID: "canvas-1",
		Tool:     "generate_media",
		Body:     json.RawMessage(`{"mode":"video"}`),
		Summary: map[string]any{
			"mode":             "video",
			"estimatedCredits": credits,
		},
		CreatedAt: time.Now().UTC().Add(-time.Duration(ageMinutes) * time.Minute).Format(time.RFC3339),
	}
}

// 预算选择按 createdAt 顺序累计：放得进的进本批，放不进的保留，没报价的单独剔出。
func TestSelectWithinBudget(t *testing.T) {
	cheap := batchTestAction("cheap", 2, 30)
	mid := batchTestAction("mid", 3, 20)
	pricey := batchTestAction("pricey", 10, 10)
	unpriced := batchTestAction("unpriced", 0, 5)
	unpriced.Summary = map[string]any{"mode": "video"}

	selected, remaining, unpricedOut := selectWithinBudget([]pendingAction{pricey, cheap, mid, unpriced}, 5)
	if len(selected) != 2 || selected[0].ID != "cheap" || selected[1].ID != "mid" {
		t.Fatalf("selected = %s+%s", selectedIDs(selected), selectedIDs(remaining))
	}
	if len(remaining) != 1 || remaining[0].ID != "pricey" {
		t.Fatalf("remaining = %s", selectedIDs(remaining))
	}
	if len(unpricedOut) != 1 || unpricedOut[0].ID != "unpriced" {
		t.Fatalf("unpriced = %s", selectedIDs(unpricedOut))
	}

	// 不设预算就是全量（未报价的仍单独剔出）。
	selected, remaining, unpricedOut = selectWithinBudget([]pendingAction{pricey, cheap, unpriced}, 0)
	if len(selected) != 2 || len(remaining) != 0 || len(unpricedOut) != 1 {
		t.Fatalf("无预算应全量提交：%s | %s | %s", selectedIDs(selected), selectedIDs(remaining), selectedIDs(unpricedOut))
	}
}

func selectedIDs(actions []pendingAction) string {
	ids := make([]string, 0, len(actions))
	for _, action := range actions {
		ids = append(ids, action.ID)
	}
	return strings.Join(ids, ",")
}

func TestSummaryCreditsPrefersMicrocredits(t *testing.T) {
	if credits, ok := summaryCredits(map[string]any{"amountMicrocredits": float64(2_500_000), "estimatedCredits": float64(9)}); !ok || credits != 2.5 {
		t.Fatalf("credits = %v, %v", credits, ok)
	}
	if credits, ok := summaryCredits(map[string]any{"estimatedCredits": float64(3.5)}); !ok || credits != 3.5 {
		t.Fatalf("credits = %v, %v", credits, ok)
	}
	if _, ok := summaryCredits(map[string]any{"estimateError": "模型不合法"}); ok {
		t.Fatal("报价失败的摘要不该算出金额")
	}
}

func TestSplitModelSpec(t *testing.T) {
	channelID, channelKey, logicalID := splitModelSpec("CHAN-1::MiniMax-H3")
	if channelID != "CHAN-1" || channelKey != "MiniMax-H3" || logicalID != "" {
		t.Fatalf("channel spec 解析错误：%q %q %q", channelID, channelKey, logicalID)
	}
	channelID, channelKey, logicalID = splitModelSpec("logical-123")
	if channelID != "" || channelKey != "" || logicalID != "logical-123" {
		t.Fatalf("logical spec 解析错误：%q %q %q", channelID, channelKey, logicalID)
	}
}

// 批量表行 → generate_media 请求的映射要与网页端同口径：
// globalPrompt 覆盖行提示词、try_on 需要两张参考图、复用 outputNodeId、跳过停用行。
func TestMapBatchTableRows(t *testing.T) {
	read := map[string]any{
		"batchTable": map[string]any{
			"operation":    "try_on",
			"globalPrompt": "全局提示词",
			"rows": []any{
				map[string]any{"id": "row-1", "enabled": true, "prompt": "行提示词会被覆盖", "inputNodeIds": []any{"img-1", "img-2"}},
				map[string]any{"id": "row-2", "enabled": false, "prompt": "停用行", "inputNodeIds": []any{"img-1", "img-2"}},
				map[string]any{"id": "row-3", "enabled": true, "prompt": "参考图不够", "inputNodeIds": []any{"img-1"}},
				map[string]any{"id": "row-4", "enabled": true, "prompt": "复用输出节点", "inputNodeIds": []any{"img-1", "img-2"}, "outputNodeId": "out-4"},
			},
		},
	}
	raw, err := json.Marshal(read)
	if err != nil {
		t.Fatal(err)
	}
	requests, err := mapBatchTableRows(raw, "CHAN-1::gpt-image", "1:1", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 {
		t.Fatalf("应只提交 row-1 和 row-4，实际 %d 笔", len(requests))
	}
	var first, second map[string]any
	if json.Unmarshal(requests[0], &first) != nil || json.Unmarshal(requests[1], &second) != nil {
		t.Fatal("请求不是 JSON 对象")
	}
	if first["prompt"] != "全局提示词" || first["channelId"] != "CHAN-1" || first["channelModelKey"] != "gpt-image" || first["size"] != "1:1" {
		t.Fatalf("row-1 请求字段错误：%#v", first)
	}
	if ids, ok := first["referenceNodeIds"].([]any); !ok || len(ids) != 2 {
		t.Fatalf("row-1 参考图错误：%#v", first["referenceNodeIds"])
	}
	if _, exists := first["nodeId"]; exists {
		t.Fatalf("row-1 没有输出节点，不应带 nodeId：%#v", first)
	}
	if second["nodeId"] != "out-4" || second["title"] != "换装 · 2" {
		t.Fatalf("row-4 应复用输出节点并按提交顺序编号：%#v", second)
	}

	// row-ids 过滤与逻辑模型写法。
	requests, err = mapBatchTableRows(raw, "logical-9", "1:1", "row-4")
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 {
		t.Fatalf("row-ids 过滤后应剩 1 笔，实际 %d", len(requests))
	}
	var only map[string]any
	if json.Unmarshal(requests[0], &only) != nil || only["logicalModelId"] != "logical-9" {
		t.Fatalf("逻辑模型 ID 没有落进请求：%#v", only)
	}
}

// creative 行只要一张参考图；没有全局提示词时用行提示词。
func TestMapBatchTableRowsCreative(t *testing.T) {
	read := map[string]any{
		"batchTable": map[string]any{
			"operation": "creative",
			"rows": []any{
				map[string]any{"id": "row-1", "enabled": true, "prompt": "行提示词生效", "inputNodeIds": []any{"img-1"}},
			},
		},
	}
	raw, _ := json.Marshal(read)
	requests, err := mapBatchTableRows(raw, "logical-9", "3:4", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 {
		t.Fatalf("应提交 1 笔，实际 %d", len(requests))
	}
	var request map[string]any
	if json.Unmarshal(requests[0], &request) != nil || request["prompt"] != "行提示词生效" || request["title"] != "创意 · 1" {
		t.Fatalf("creative 行映射错误：%#v", request)
	}
}
