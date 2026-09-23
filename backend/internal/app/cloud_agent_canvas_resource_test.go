package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// 命令行只能"先 asset upload、再用 canvas_apply_ops 建节点"，resourceId 是资源进入画布的唯一
// 入口。这组用例走完整的命令行链路：上传得到的资源 → add_node 挂载 → 该节点直接当参考图生成。
func TestCLICanvasOpsAttachUploadedResourceAndUseItAsReference(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	// 额外造一个"还没就绪"的资源：上传后立刻建节点是常见竞态，必须如实拒绝。
	if err := db.Create(&model.Resource{ID: "pending-video", UserID: "user", Kind: "video", Status: "pending", MimeType: "video/mp4"}).Error; err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(readCanvasPayload(t, db, "agent-canvas"))
	if err != nil {
		t.Fatal(err)
	}
	hash := cloudAgentCanvasHash(doc)

	applied, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash, map[string]any{
		"type": "add_node", "id": "uploaded-ref", "nodeType": "image", "title": "上传的参考图", "resourceId": "ref-one",
	}))
	if err != nil {
		t.Fatalf("挂载上传的资源应当成功：%v", err)
	}
	node := cloudAgentCanvasNode(mustCanvasDocument(t, db, "agent-canvas"), "uploaded-ref")
	if node == nil {
		t.Fatal("挂载后找不到节点")
	}
	meta, _ := node["metadata"].(map[string]any)
	if stringValue(meta["storageKey"]) != "resource:ref-one" || stringValue(meta["status"]) != "success" || stringValue(meta["content"]) == "" {
		t.Fatalf("挂载后的节点 metadata 不完整：%#v", meta)
	}

	// 挂载后的节点必须能直接当参考素材：以前上传完拿不回画布，这一步是断的。
	reference, _, err := cloudAgentReference(s.repo, "user", node)
	if err != nil {
		t.Fatalf("挂载后的节点应当能作为参考素材：%v", err)
	}
	if stringValue(reference["storageKey"]) != "resource:ref-one" {
		t.Fatalf("参考素材解析结果不对：%#v", reference)
	}

	// 命令行这一路：挂载后直接用首帧参考报价，确认能走到准入与报价。
	args.NodeID = "video-uploaded"
	// references 自带顺序与角色，与 referenceNodeIds 只能填一个。
	args.ReferenceNodeIDs = nil
	args.References = []cloudAgentMediaReference{{NodeID: "uploaded-ref", Role: cloudAgentReferenceRoleFirstFrame}}
	args.VideoEditOperation = "image_to_video"
	args.SnapshotHash = applied.(map[string]any)["snapshotHash"].(string)
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CLIQuoteMedia("user", "agent-canvas", raw); err != nil {
		t.Fatalf("挂载后的资源应当能作为首帧参考提交：%v", err)
	}
}

// 资源挂载的拒绝理由要能让调用方自己改对：归属、就绪、媒体类型、节点能力逐项断言。
func TestCLICanvasOpsRejectUnattachableResources(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, row := range []any{
		&model.Resource{ID: "pending-video", UserID: "user", Kind: "video", Status: "pending", MimeType: "video/mp4"},
		&model.Resource{ID: "ready-video", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	hash := func() string {
		return cloudAgentCanvasHash(mustCanvasDocument(t, db, "agent-canvas"))
	}
	for _, tc := range []struct {
		name string
		op   map[string]any
		want string
	}{
		{"资源不存在", map[string]any{"type": "add_node", "id": "a1", "nodeType": "image", "resourceId": "ghost"}, "资源不存在或不属于当前用户"},
		{"别人的资源", map[string]any{"type": "add_node", "id": "a2", "nodeType": "image", "resourceId": "private"}, "资源不存在或不属于当前用户"},
		{"资源未就绪", map[string]any{"type": "add_node", "id": "a3", "nodeType": "video", "resourceId": "pending-video"}, "资源尚未就绪"},
		{"媒体类型不匹配", map[string]any{"type": "add_node", "id": "a4", "nodeType": "video", "resourceId": "ref-one"}, "媒体类型与节点类型不匹配"},
		{"文本节点不能挂素材", map[string]any{"type": "add_node", "id": "a5", "nodeType": "text", "resourceId": "ref-one"}, "只有图片、视频、音频节点可以挂载素材"},
	} {
		_, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash(), tc.op))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s：期望包含 %q，实际 %v", tc.name, tc.want, err)
		}
	}

	// update_node 的三条边界：必须给出至少一项、可以给空节点换素材、已绑任务的节点不许被覆盖。
	// 三者一个都没给时由字段级校验报错（ops[0].patch），模型据此就能补上。
	if _, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash(), map[string]any{"type": "update_node", "id": "cat"})); err == nil || !strings.Contains(err.Error(), "ops[0].patch") {
		t.Fatalf("空更新应当被拒绝：%v", err)
	}
	// 只带 resourceId 的更新必须能过字段校验（这条路径以前只认 patch）。
	if _, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash(), map[string]any{"type": "update_node", "id": "cat", "resourceId": "ref-two"})); err != nil {
		t.Fatalf("只带 resourceId 的更新应当被接受：%v", err)
	}
	// 只带 generation 的更新同样不该被字段校验拦下（schema 声明的是三者任一）。
	if _, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash(), map[string]any{"type": "update_node", "id": "cat", "generation": map[string]any{"model": "channel::seedance-test"}})); err != nil && strings.Contains(err.Error(), "ops[0].patch") {
		t.Fatalf("只带 generation 的更新不该被 patch 字段校验拦下：%v", err)
	}
	attached, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash(), map[string]any{"type": "add_node", "id": "empty-video", "nodeType": "video", "title": "待填素材"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, attached.(map[string]any)["snapshotHash"].(string), map[string]any{"type": "update_node", "id": "empty-video", "resourceId": "ready-video"})); err != nil {
		t.Fatalf("空媒体节点应当可以挂素材：%v", err)
	}
	if _, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash(), map[string]any{"type": "update_node", "id": "cat", "resourceId": "ref-two"})); err != nil {
		t.Fatalf("已有素材但没有任务的节点应当可以换素材：%v", err)
	}

	// 已关联生成任务的节点是生成结果，不接受素材覆盖。
	if err := bindCanvasTask(t, db, "agent-canvas", "hero", "task-hero"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CLIApplyCanvasOps("user", "agent-canvas", canvasOpsJSON(t, hash(), map[string]any{"type": "update_node", "id": "hero", "resourceId": "ref-one"})); err == nil || !strings.Contains(err.Error(), "已关联生成任务") {
		t.Fatalf("绑任务的节点不该被素材覆盖：%v", err)
	}
}

func canvasOpsJSON(t *testing.T, hash string, ops ...map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"snapshotHash": hash, "ops": ops})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func readCanvasPayload(t *testing.T, db *gorm.DB, canvasID string) string {
	t.Helper()
	var canvas model.CanvasProject
	if err := db.First(&canvas, "id = ?", canvasID).Error; err != nil {
		t.Fatal(err)
	}
	return canvas.PayloadJSON
}

func mustCanvasDocument(t *testing.T, db *gorm.DB, canvasID string) map[string]any {
	t.Helper()
	doc, err := creationDocument(readCanvasPayload(t, db, canvasID))
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// bindCanvasTask 模拟"节点已经提交过生成"：命令行写路径写不出 taskId，只能直接落库造这个状态。
func bindCanvasTask(t *testing.T, db *gorm.DB, canvasID, nodeID, taskID string) error {
	t.Helper()
	doc := mustCanvasDocument(t, db, canvasID)
	node := cloudAgentCanvasNode(doc, nodeID)
	if node == nil {
		t.Fatalf("找不到节点 %s", nodeID)
	}
	meta, _ := node["metadata"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
		node["metadata"] = meta
	}
	meta["taskId"] = taskID
	raw, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	return db.Model(&model.CanvasProject{}).Where("id = ?", canvasID).Update("payload_json", string(raw)).Error
}
