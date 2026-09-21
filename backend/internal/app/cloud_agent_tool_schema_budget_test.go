package app

import (
	"encoding/json"
	"strings"
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

	// 顶层 type 枚举 + 服务端按 action 强校验已经表达了"每种操作要哪些字段"，
	// 再挂一份 oneOf 只是重复：同一个约束会被下发两遍。
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if function["name"] != "canvas_apply_ops" {
			continue
		}
		parameters, _ := function["parameters"].(map[string]any)
		ops, _ := parameters["properties"].(map[string]any)
		items, _ := ops["ops"].(map[string]any)
		opItem, _ := items["items"].(map[string]any)
		if _, exists := opItem["oneOf"]; exists {
			t.Fatal("canvas_apply_ops 的 ops.items 不该再带重复的 oneOf")
		}
		if props, ok := opItem["properties"].(map[string]any); !ok || len(props) == 0 {
			t.Fatal("canvas_apply_ops 的 ops.items 必须保留 properties")
		}
	}

	// 体积预算：当前 20 个工具约 22.4 KB，这里留 ~7% 余量；新增工具或字段时请重新测量并
	// 有意识地调整这个数字，而不是让 schema 悄悄膨胀（它每一步都要发、还在前缀最前面）。
	if len(raw) > 24000 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 24000：请压缩描述或显式调整预算", len(raw))
	}
	if strings.Count(string(raw), "oneOf") > 2 {
		t.Fatalf("工具 schema 里出现了过多 oneOf：%s", string(raw[:200]))
	}
}
