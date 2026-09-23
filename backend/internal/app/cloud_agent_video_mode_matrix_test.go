package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// 视频参考模式（videoMode）与图片数量的对应关系：显式角色会把这次生成钉成某个模式，
// 模式自己的能力合同再决定"能带几张图"。三处口径必须一致才能提交成功：
//   - 只给 first_frame            → videoMode=image     → 恰好 1 张图，不能带视频/音频
//   - 给 first_frame + last_frame → videoMode=keyframes → 恰好 2 张图
//   - 只给 reference_image/不给角色 → videoMode=reference 或留空 → 至少一项素材（帧语义不参与）
//
// 这条用例把矩阵钉住，避免"首尾帧能不能再带参考图"这类问题靠印象回答。
func TestCloudAgentVideoReferenceModeMatrix(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	cases := []struct {
		name       string
		roles      []cloudAgentMediaReference
		nodeIDs    []string
		operation  string
		wantErrHas string
	}{
		{"只有首帧", []cloudAgentMediaReference{{NodeID: "hero", Role: "first_frame"}}, nil, "", ""},
		{"首帧+参考图", []cloudAgentMediaReference{{NodeID: "hero", Role: "first_frame"}, {NodeID: "cat", Role: "reference_image"}}, nil, "", "图生视频只收一张首帧图片"},
		{"首尾帧两张", []cloudAgentMediaReference{{NodeID: "hero", Role: "first_frame"}, {NodeID: "cat", Role: "last_frame"}}, nil, "", ""},
		{"无角色双图+全能参考", nil, []string{"hero", "cat"}, "reference_to_video", ""},
		{"无角色双图不指定operation", nil, []string{"hero", "cat"}, "", ""},
	}
	for _, tc := range cases {
		a := args
		a.NodeID = "vid-" + strings.ReplaceAll(tc.name, "+", "-")
		a.References, a.ReferenceNodeIDs, a.VideoEditOperation = tc.roles, tc.nodeIDs, tc.operation
		raw, err := json.Marshal(a)
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.CLIQuoteMedia("user", "agent-canvas", raw)
		switch {
		case tc.wantErrHas == "" && err != nil:
			t.Errorf("%s：期望通过，实际 %v", tc.name, err)
		case tc.wantErrHas != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErrHas)):
			t.Errorf("%s：期望 %q，实际 %v", tc.name, tc.wantErrHas, err)
		default:
			t.Logf("%s → %v", tc.name, err)
		}
	}
}
