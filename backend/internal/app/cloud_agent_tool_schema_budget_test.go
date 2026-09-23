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

	// 体积预算：上游 20 个工具实测 22,777 字节（预算 24000）。之后的实测与调整：
	//   - 新增 canvas_arrange_nodes 并补齐描述、patch 字段后，21 个工具 24,788 字节 → 预算 25000
	//   - generate_media 补 videoEditOperation 后 25,237 字节 → 预算 25500
	//   - canvas_apply_ops 补 generation、generate_media 补 references（参考素材角色）后 25,778 字节
	//     这次先做了一轮描述压缩（recall/remember_lesson、image_layer_split、
	//     canvas_apply_ops 的坐标说明，共腾出约 180 字节），剩下的描述都是协议语义，
	//     因此把预算定到 26200（约 1.6% 余量）而不是继续逐次微调。
	//   - 之后发现上面这些数字都不含看图工具：VisionEnabled 为假时 canvas_inspect_image
	//     整个不在表里，而平台支持的工具全集（CloudAgentSupportedToolNames）本来就按
	//     VisionEnabled=true 统计。这次把度量口径改成同一个并集（24 个工具），同时补上
	//     canvas_inspect_image 的 nodeIds、新增 canvas_inspect_media（素材事实）、
	//     canvas_apply_ops 的 delete_node 与 canvas_get_state 的截断提示，并压缩了
	//     canvas_inspect_image / canvas_apply_ops 的描述（约 95 字节）。
	//     实测 27,842 字节 → 预算 28300（约 1.6% 余量）。
	// 新增工具或字段时请重新测量并有意识地调整这个数字，而不是让 schema 悄悄膨胀
	// （它每一步都要发、还在前缀最前面）。余量已不足 2%，再要加字段就应当回到
	// 「按工具逐个复核描述」这一层，而不是继续抬高这个上限。
	if len(raw) > 28300 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 28300：请压缩描述或显式调整预算", len(raw))
	}
}
