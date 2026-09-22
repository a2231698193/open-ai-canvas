package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

// 工具 schema 是每一步都要发出去（并且是前缀缓存的第一段）的固定开销，因此值得钉住体积：
// 平台工具全集按 auto + canvas + 技能构造（覆盖条件暴露的工具）。
func platformToolSchema(t *testing.T) ([]map[string]any, []byte) {
	t.Helper()
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}, SkillIDs: []string{"capability-list"}}
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
			{"properties": map[string]any{"type": map[string]any{"const": "update_node"}}, "required": []string{"patch"}},
			{"properties": map[string]any{"type": map[string]any{"const": "connect_nodes"}}, "required": []string{"fromNodeId", "toNodeId"}},
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

	// 体积预算：上游 20 个工具实测 22,777 字节（预算 24000）。之后的实测与调整：
	//   - 新增 canvas_arrange_nodes 并补齐描述、patch 字段后，21 个工具 24,788 字节 → 预算 25000
	//   - generate_media 补 videoEditOperation（纯图参考无法推导出多图全能参考）后 25,237 字节
	//   - canvas_apply_ops 补 generation（Agent 准备节点生成规格）后，22 个工具 25,512 字节 → 预算 25800
	// 新增工具或字段时请重新测量并有意识地调整这个数字，而不是让 schema 悄悄膨胀
	// （它每一步都要发、还在前缀最前面）。余量已不足 1%，需要继续加字段时应当先做一轮
	// 专门的描述压缩，而不是继续抬高这个上限。
	if len(raw) > 25800 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 25800：请压缩描述或显式调整预算", len(raw))
	}
}
