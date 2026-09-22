package app

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// CLICanvasState 给外部命令行返回与画布 Agent 相同的只读摘要。
// 不调用系统语言模型。snapshotHash 与受控写入使用同一份内容哈希。
func (s *Service) CLICanvasState(userID, canvasID string, offset int) (map[string]any, error) {
	if err := validateCloudAgentID(strings.TrimSpace(canvasID), "画布 ID", 80); err != nil {
		return nil, err
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	state, err := cloudAgentCanvasState(s.repo, userID, canvasID, doc, offset, nil, 0)
	if err != nil {
		return nil, err
	}
	view, _ := state.(map[string]any)
	if view == nil {
		view = map[string]any{"state": state}
	}
	view["canvasId"] = canvas.ID
	view["title"] = canvas.Title
	view["revision"] = canvas.Revision
	return view, nil
}

// CLIApplyCanvasOps 复用画布 Agent 的节点与连线执行器，但不创建 Agent 运行，也不调用语言模型。
// 仍然只允许新增、修改和连线，并要求 snapshotHash 与当前画布一致。
func (s *Service) CLIApplyCanvasOps(userID, canvasID string, raw json.RawMessage) (any, error) {
	if err := validateCloudAgentID(strings.TrimSpace(canvasID), "画布 ID", 80); err != nil {
		return nil, err
	}
	if len(raw) == 0 || !json.Valid(raw) {
		return nil, BadAuthRequest("画布操作必须是 JSON 对象")
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	call := cloudAgentCall{ID: newID()}
	call.Function.Name = "canvas_apply_ops"
	call.Function.Arguments = string(raw)
	result, err := applyCloudAgentCanvas(s.repo, userID, canvasID, call, policy)
	if err != nil && strings.Contains(err.Error(), "画布已变化") {
		return nil, BadAuthRequest("画布已变化，本次未写入；请重新读取后再提交")
	}
	return result, err
}

// CLICanvasTool 执行画布 Agent 的画布工具。它不创建 Agent 运行，也不调用语言模型。
// 生成工具会创建计费任务；调用方必须先完成用户确认。
func (s *Service) CLICanvasTool(userID, canvasID, tool string, raw json.RawMessage) (any, error) {
	if err := validateCloudAgentID(strings.TrimSpace(canvasID), "画布 ID", 80); err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	if !json.Valid(raw) {
		return nil, BadAuthRequest("工具参数必须是 JSON 对象")
	}
	call := cloudAgentCall{ID: newID()}
	call.Function.Name = tool
	call.Function.Arguments = string(raw)
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: canvasID}, TransientReferences: map[string]cloudAgentTransientReference{}}
	switch tool {
	case "canvas_list_node_types", "canvas_get_state", "canvas_read_storyboard", "canvas_read_batch_table", "image_text_detect", "task_get":
		return cloudAgentReadTool(s.repo, userID, state, call, s)
	case "image_annotation_render":
		return cloudAgentReadTool(s.repo, userID, state, call, s)
	case "canvas_apply_ops":
		return s.CLIApplyCanvasOps(userID, canvasID, raw)
	case "canvas_create_storyboard", "canvas_edit_storyboard":
		policy, err := s.RuntimePolicy()
		if err != nil {
			return nil, err
		}
		return applyCloudAgentStoryboardMutation(s.repo, userID, canvasID, call, policy)
	case "canvas_edit_batch_table":
		policy, err := s.RuntimePolicy()
		if err != nil {
			return nil, err
		}
		return applyCloudAgentBatchTableMutation(s.repo, userID, canvasID, call, policy)
	case "canvas_arrange_nodes":
		policy, err := s.RuntimePolicy()
		if err != nil {
			return nil, err
		}
		return applyCloudAgentArrangeNodes(s.repo, userID, canvasID, call, policy)
	case "canvas_inspect_image":
		return s.prepareCloudAgentImageInspection(userID, canvasID, state, call)
	case "model_list":
		intent, err := s.cloudAgentModelIntent(userID, canvasID, string(raw))
		if err != nil {
			return nil, err
		}
		return s.cloudAgentModelList(intent)
	case "generate_media", "image_layer_split":
		return s.cliGenerateMedia(userID, canvasID, call)
	default:
		return nil, BadAuthRequest("命令行不提供该画布工具")
	}
}

func (s *Service) cliGenerateMedia(userID, canvasID string, call cloudAgentCall) (any, error) {
	call = cloudAgentMediaCall(call)
	run := &model.CloudAgentExecution{ID: "cli-" + newID(), UserID: userID, CanvasID: canvasID}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: canvasID}, TransientReferences: map[string]cloudAgentTransientReference{}}
	request, plan, err := s.prepareCloudAgentMedia(run, state, call)
	if err != nil {
		return nil, err
	}
	preview := &creationTaskPreparation{}
	request.creationPrepare = preview
	if _, err := s.CreateTask(userID, request); err != nil {
		return nil, err
	}
	request.creationPrepare = nil
	task, err := s.CreateTask(userID, request)
	if err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := createCloudAgentMediaNode(s.repo, userID, canvasID, plan, task, policy); err != nil {
		return nil, err
	}
	return map[string]any{"canvasId": canvasID, "nodeId": plan.Args.NodeID, "taskId": task.ID, "mode": plan.Args.Mode}, nil
}
