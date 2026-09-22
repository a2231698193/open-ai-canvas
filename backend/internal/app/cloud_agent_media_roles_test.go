package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeCloudAgentMediaReferencesOrdersAndAssignsRoles(t *testing.T) {
	a := cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{
		{NodeID: "img-1", Role: "reference_image"},
		{NodeID: "seam-1", Role: "first_frame"},
	}}
	if err := normalizeCloudAgentMediaReferences(&a); err != nil {
		t.Fatal(err)
	}
	// 顺序来自 references，@图片N 的编号依赖它。
	if len(a.ReferenceNodeIDs) != 2 || a.ReferenceNodeIDs[0] != "img-1" || a.ReferenceNodeIDs[1] != "seam-1" {
		t.Fatalf("ReferenceNodeIDs = %#v", a.ReferenceNodeIDs)
	}
	if a.ReferenceRoles["seam-1"] != cloudAgentReferenceRoleFirstFrame || a.ReferenceRoles["img-1"] != cloudAgentReferenceRoleImage {
		t.Fatalf("roles = %#v", a.ReferenceRoles)
	}
	// 角色投影到服务端既有的视频元数据键，走浏览器同一条通道。
	metadata := cloudAgentVideoRoleMetadata(a)
	if metadata["videoMode"] != "image" || metadata["videoStartFrameNodeId"] != "seam-1" {
		t.Fatalf("metadata = %#v", metadata)
	}
	if _, exists := metadata["videoEndFrameNodeId"]; exists {
		t.Fatalf("未指定尾帧时不应写入 videoEndFrameNodeId：%#v", metadata)
	}
}

func TestNormalizeCloudAgentMediaReferencesKeyframesAndDefaultRole(t *testing.T) {
	keyframes := cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{
		{NodeID: "first", Role: "first_frame"},
		{NodeID: "last", Role: "last_frame"},
	}}
	if err := normalizeCloudAgentMediaReferences(&keyframes); err != nil {
		t.Fatal(err)
	}
	metadata := cloudAgentVideoRoleMetadata(keyframes)
	if metadata["videoMode"] != "keyframes" || metadata["videoStartFrameNodeId"] != "first" || metadata["videoEndFrameNodeId"] != "last" {
		t.Fatalf("metadata = %#v", metadata)
	}

	// 省略 role 等于 reference_image，别名与连字符写法也接受。
	plain := cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{
		{NodeID: "a"}, {NodeID: "b", Role: "reference"}, {NodeID: "c", Role: "first-frame"},
	}}
	if err := normalizeCloudAgentMediaReferences(&plain); err != nil {
		t.Fatal(err)
	}
	if plain.ReferenceRoles["a"] != cloudAgentReferenceRoleImage || plain.ReferenceRoles["b"] != cloudAgentReferenceRoleImage || plain.ReferenceRoles["c"] != cloudAgentReferenceRoleFirstFrame {
		t.Fatalf("roles = %#v", plain.ReferenceRoles)
	}
	if cloudAgentVideoRoleMetadata(plain)["videoMode"] != "image" {
		t.Fatalf("有首帧时 videoMode 应为 image：%#v", cloudAgentVideoRoleMetadata(plain))
	}

	// 只挂普通参考图时落到 reference 模式，operation 会把它判成 reference_to_video。
	only := cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{{NodeID: "x"}}}
	if err := normalizeCloudAgentMediaReferences(&only); err != nil {
		t.Fatal(err)
	}
	if cloudAgentVideoRoleMetadata(only)["videoMode"] != "reference" {
		t.Fatalf("videoMode = %#v", cloudAgentVideoRoleMetadata(only))
	}
}

func TestNormalizeCloudAgentMediaReferencesRejectsBadInput(t *testing.T) {
	cases := []struct {
		name    string
		args    cloudAgentMediaArgs
		contain string
	}{
		{"两种写法并存", cloudAgentMediaArgs{Mode: "video", ReferenceNodeIDs: []string{"a"}, References: []cloudAgentMediaReference{{NodeID: "b"}}}, "只能填一个"},
		{"节点重复", cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{{NodeID: "a"}, {NodeID: "a"}}}, "出现了多次"},
		{"两个首帧", cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{{NodeID: "a", Role: "first_frame"}, {NodeID: "b", Role: "first_frame"}}}, "first_frame 只能有一个"},
		{"尾帧没有首帧", cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{{NodeID: "a", Role: "last_frame"}}}, "必须同时指定 first_frame"},
		{"角色无效", cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{{NodeID: "a", Role: "lastframe"}}}, "reference_image"},
		{"节点ID为空", cloudAgentMediaArgs{Mode: "video", References: []cloudAgentMediaReference{{NodeID: "  "}}}, "nodeId"},
	}
	for _, item := range cases {
		err := normalizeCloudAgentMediaReferences(&item.args)
		if err == nil || !strings.Contains(err.Error(), item.contain) {
			t.Fatalf("%s: err = %v, want 包含 %q", item.name, err, item.contain)
		}
	}

	// 只传 referenceNodeIds 时保持原样，不产生角色。
	legacy := cloudAgentMediaArgs{Mode: "video", ReferenceNodeIDs: []string{"a", "b"}}
	if err := normalizeCloudAgentMediaReferences(&legacy); err != nil {
		t.Fatal(err)
	}
	if len(legacy.ReferenceRoles) != 0 || cloudAgentVideoRoleMetadata(legacy) != nil {
		t.Fatalf("旧写法不应产生角色：%#v %#v", legacy.ReferenceRoles, cloudAgentVideoRoleMetadata(legacy))
	}
}

func TestValidateCloudAgentReferenceRolesRequiresImageFrames(t *testing.T) {
	a := cloudAgentMediaArgs{Mode: "video", ReferenceRoles: map[string]string{"clip": cloudAgentReferenceRoleFirstFrame}}
	refs := map[string]any{
		"referenceImages": []any{map[string]any{"id": "img-1"}},
		"referenceVideos": []any{map[string]any{"id": "clip"}},
	}
	if err := validateCloudAgentReferenceRoles(a, refs); err == nil || !strings.Contains(err.Error(), "只能指向图片节点") {
		t.Fatalf("首帧落在视频节点上应被拒绝，err = %v", err)
	}
	a.ReferenceRoles = map[string]string{"img-1": cloudAgentReferenceRoleFirstFrame}
	if err := validateCloudAgentReferenceRoles(a, refs); err != nil {
		t.Fatalf("首帧指向图片节点应通过，err = %v", err)
	}
}

// 视频的模式与首尾帧必须同时写进节点 metadata：网页端的模式下拉和「参考帧」读的是
// videoMode / videoStartFrameNodeId / videoEndFrameNodeId。只写任务不写节点，用户打开
// 画布会看到参考帧是空的，甚至按连接数猜成别的模式。
func TestCLIGenerateMediaWritesKeyframesIntoNodeMetadata(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	args.ReferenceNodeIDs = nil
	args.References = []cloudAgentMediaReference{
		{NodeID: "hero", Role: "first_frame"},
		{NodeID: "cat", Role: "last_frame"},
	}
	args.VideoEditOperation = ""
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.CLICanvasTool("user", "agent-canvas", "generate_media", raw)
	if err != nil {
		t.Fatal(err)
	}
	if taskID, _ := result.(map[string]any)["taskId"].(string); taskID == "" {
		t.Fatalf("没有创建任务：%#v", result)
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	node := cloudAgentCanvasNode(doc, args.NodeID)
	if node == nil {
		t.Fatalf("没有创建节点：%s", canvas.PayloadJSON)
	}
	meta, _ := node["metadata"].(map[string]any)
	if meta["videoMode"] != "keyframes" || meta["videoStartFrameNodeId"] != "hero" || meta["videoEndFrameNodeId"] != "cat" {
		t.Fatalf("节点缺少首尾帧元数据：%#v", meta)
	}
}

// 没有显式角色时按最终 operation 回填模式，避免两图全能参考在界面上显示成首尾帧参考。
func TestCloudAgentVideoNodeMetadataFallsBackToOperation(t *testing.T) {
	plain := cloudAgentMediaArgs{Mode: "video", ReferenceNodeIDs: []string{"a", "b"}}
	if metadata := cloudAgentVideoNodeMetadata(plain, "reference_to_video"); metadata["videoMode"] != "reference" {
		t.Fatalf("reference_to_video 应回填 reference：%#v", metadata)
	}
	if metadata := cloudAgentVideoNodeMetadata(plain, "image_to_video"); metadata["videoMode"] != "image" {
		t.Fatalf("image_to_video 应回填 image：%#v", metadata)
	}
	if metadata := cloudAgentVideoNodeMetadata(plain, "text_to_video"); metadata["videoMode"] != "text" {
		t.Fatalf("text_to_video 应回填 text：%#v", metadata)
	}
	// 显式角色优先，且非视频模式不产生这些键。
	keyframes := cloudAgentMediaArgs{Mode: "video", ReferenceRoles: map[string]string{"a": cloudAgentReferenceRoleFirstFrame, "b": cloudAgentReferenceRoleLastFrame}}
	if metadata := cloudAgentVideoNodeMetadata(keyframes, "image_to_video"); metadata["videoMode"] != "keyframes" || metadata["videoEndFrameNodeId"] != "b" {
		t.Fatalf("显式角色被 operation 覆盖：%#v", metadata)
	}
	if metadata := cloudAgentVideoNodeMetadata(cloudAgentMediaArgs{Mode: "image"}, "image_to_image"); metadata != nil {
		t.Fatalf("图片节点不该写视频模式：%#v", metadata)
	}
}
