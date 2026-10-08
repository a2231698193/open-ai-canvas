package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

// 工具 schema 是每一步都要发出去（并且是前缀缓存的第一段）的固定开销，因此值得钉住体积：
// 平台工具全集按 auto + canvas + 技能 + 看图构造（VisionEnabled 为真时还会多出看图与
// 读素材两个工具，取的是条件暴露的并集，而不是最小集）。
func platformToolSchema(t *testing.T) ([]map[string]any, []byte) {
	t.Helper()
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}, SkillIDs: []string{"capability-list"}, VisionEnabled: true}
	req.Budget.MaxGenerationTasks = 1
	tools := cloudAgentTools(req)
	raw, err := json.Marshal(tools)
	if err != nil {
		t.Fatal(err)
	}
	return tools, raw
}

func TestCloudAgentToolSchemaStaysCompact(t *testing.T) {
	tools, raw := platformToolSchema(t)
	t.Logf("platform tool schema: %d tools, %d bytes", len(tools), len(raw))

	// 条件必填不是 type 枚举能表达的约束，压缩描述不能删掉协议语义。
	found := false
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if function["name"] != "canvas_apply_ops" {
			continue
		}
		found = true
		parameters, _ := function["parameters"].(map[string]any)
		ops, _ := parameters["properties"].(map[string]any)
		items, _ := ops["ops"].(map[string]any)
		opItem, _ := items["items"].(map[string]any)
		want := []map[string]any{
			{"properties": map[string]any{"type": map[string]any{"const": "add_node"}}, "required": []string{"nodeType"}},
			{"properties": map[string]any{"type": map[string]any{"const": "update_node"}}, "anyOf": []map[string]any{{"required": []string{"patch"}}, {"required": []string{"generation"}}, {"required": []string{"resourceId"}}}},
			{"properties": map[string]any{"type": map[string]any{"const": "connect_nodes"}}, "required": []string{"fromNodeId", "toNodeId"}},
			{"properties": map[string]any{"type": map[string]any{"const": "delete_node"}}},
		}
		if !reflect.DeepEqual(opItem["oneOf"], want) {
			t.Fatalf("操作类型条件必填约束丢失: %#v", opItem["oneOf"])
		}
		if props, ok := opItem["properties"].(map[string]any); !ok || len(props) == 0 {
			t.Fatal("canvas_apply_ops 的 ops.items 必须保留 properties")
		}
	}
	if !found {
		t.Fatal("canvas_apply_ops 未暴露")
	}

	// 官方 v1.6.1 的预演台工具与本仓库的批量识图、素材事实、空节点删除和带角色参考叠在一起。
	// 实测 29 个工具、38,531 字节，预算 40,000（约 3.8% 余量）。新增工具或字段时须重新度量。
	if len(raw) > 40000 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 40000：请压缩描述或显式调整预算", len(raw))
	}
}
