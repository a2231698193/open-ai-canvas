package app

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// CLICanvasState 给外部命令行返回与画布 Agent 相同的只读摘要。
// 不调用系统语言模型。snapshotHash 与受控写入使用同一份内容哈希。
func (s *Service) CLICanvasState(userID, canvasID string, offset int, connectionOffsets ...int) (map[string]any, error) {
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
	state, err := cloudAgentCanvasState(s.repo, userID, canvasID, doc, offset, nil, 0, connectionOffsets...)
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

// CLIQuoteMedia 只算钱：走与 generate_media 完全相同的解析、准入与报价链路，
// 但不创建任务、不扣费、不写画布。报价与真正提交共用同一份准备逻辑，
// 所以两边不会算出两个数；参数有错时也会在这里提前报出来。
func (s *Service) CLIQuoteMedia(userID, canvasID string, raw json.RawMessage) (any, error) {
	if err := validateCloudAgentID(strings.TrimSpace(canvasID), "画布 ID", 80); err != nil {
		return nil, err
	}
	if len(raw) == 0 || !json.Valid(raw) {
		return nil, BadAuthRequest("生成参数必须是 JSON 对象")
	}
	call := cloudAgentCall{ID: newID()}
	call.Function.Name = "generate_media"
	call.Function.Arguments = string(raw)
	run := &model.CloudAgentExecution{ID: "cli-quote-" + newID(), UserID: userID, CanvasID: canvasID}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: canvasID}, TransientReferences: map[string]cloudAgentTransientReference{}}
	request, plan, err := s.prepareCloudAgentMedia(run, state, call)
	if err != nil {
		return nil, err
	}
	admission := &creationTaskPreparation{}
	request.creationPrepare = admission
	if _, err := s.CreateTask(userID, request); err != nil {
		return nil, err
	}
	result := map[string]any{"canvasId": canvasID, "mode": plan.Args.Mode}
	if plan.Args.NodeID != "" {
		result["nodeId"] = plan.Args.NodeID
	}
	if order := admission.Order; order != nil {
		result["model"] = order.Model
		result["billingMode"] = order.BillingMode
		result["quantity"] = order.Quantity
		result["unitPriceMicrocredits"] = order.UnitPriceMicrocredits
		result["multiplierBasisPoints"] = order.MultiplierBasisPoints
		result["amountMicrocredits"] = order.AmountMicrocredits
		result["estimatedCredits"] = float64(order.AmountMicrocredits) / float64(CreditScale)
	}
	return result, nil
}

// CLICanvasImageInspection 是命令行的看图：校验口径与画布 Agent 完全一致，但交付方式不同。
//
// 画布 Agent 的图片由服务端在任务执行前读成字节（检查点只存 resource:ID）；命令行面向的是
// 外部 Agent，它得自己取图，所以这里把 resource:ID 换回短时签名链接再返回。外部 Agent 用
// 自己的模型看图，服务端不知道它的图片数量/体积上限，因此不套用渠道模型的限制。
func (s *Service) CLICanvasImageInspection(userID, canvasID string, state *cloudAgentRuntime, call cloudAgentCall) (any, error) {
	targets, refresh, err := cloudAgentInspectTargets(call.Function.Arguments, true)
	if err != nil {
		return nil, err
	}
	doc, err := cloudAgentInspectionDocument(s.repo, userID, canvasID)
	if err != nil {
		return nil, err
	}
	inspections := make(cloudAgentImageInspections, 0, len(targets))
	for _, nodeID := range targets {
		node := cloudAgentCanvasNode(doc, nodeID)
		if node == nil {
			return nil, BadAuthRequest("指定节点不在当前画布：" + nodeID)
		}
		inspection, err := s.cloudAgentInspectImageNode(userID, state, node, TextReferenceConfig{}, refresh)
		if err != nil {
			return nil, err
		}
		if inspection.ImageURL != "" {
			url, err := s.signedInspectionResourceURL(userID, inspection.ImageURL)
			if err != nil {
				return nil, err
			}
			inspection.ImageURL = url
		}
		inspections = append(inspections, inspection)
	}
	return cloudAgentImageInspectionWithURLs(inspections), nil
}

// signedInspectionResourceURL 把 resource:ID 换成短时签名链接；链接要跨越外部 Agent 的一次
// 往返，用比浏览器直连更长的有效期。
func (s *Service) signedInspectionResourceURL(userID, storageKey string) (string, error) {
	resourceID := strings.TrimPrefix(storageKey, "resource:")
	if resourceID == "" || resourceID == storageKey {
		return "", BadAuthRequest("看图记录不是账号资源引用，请重新读取节点")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return "", BadAuthRequest("该节点的图片资源不存在或不属于当前用户")
	}
	return s.providerResourceURL(resource, time.Now().Add(providerResourceURLTTL))
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
		return s.CLICanvasImageInspection(userID, canvasID, state, call)
	case "canvas_inspect_media":
		// 外部 Agent 需要能自己取到媒体：带短时签名链接（图片、视频、音频都可）。
		return cloudAgentMediaInspection(s.repo, userID, canvasID, call, true, s)
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
