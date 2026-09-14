package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const cloudAgentMediaPolicy = "媒体生成先区分参数选择与收费授权。用户明确指定的模型、画幅、时长、音频必须遵守；用户说‘随便’‘你决定’‘按默认’时允许安全默认，不要求四项逐个确认：从当前目录选择支持所需参考方式、参数且预算可覆盖的模型，优先用户最近明确使用且仍可用的模型，否则选择价格清楚的低成本可用项；画幅优先匹配参考图原始宽高比且必须在模型支持范围内，否则用目录默认；时长用目录默认，不编造；模型不支持音频且用户未要求声音时直接用默片。用户对上一条明确推荐方案说‘可以’‘开始吧’，即接受该方案的参数，不再要求回复特定确认口令。只有引用对象不明确、用户硬性要求与能力冲突、无有效默认值或预算不足时，一次性询问真正缺少的事项。选择后简短说明实际参数和默认来源，并立即创建草稿交给审批卡，不再添加文字确认轮次。generate_media 创建草稿及连线不等于收费授权；所有模式都必须等待界面独立审批，‘随便’‘开始’和默认参数都不能跳过审批。已提交的收费任务失败不得自动重提、换模型或盲重试。"

// The Agent uses the same public catalog as the composer, never a second routing policy.
func (s *Service) cloudAgentModelList() (any, error) {
	catalog, err := s.ModelCatalog(nil)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	generationModes := cloudAgentGenerationModes()
	for _, m := range catalog.Models {
		if m.Available && generationModes[normalizeCapability(m.Capability)] {
			items = append(items, map[string]any{"name": m.Name, "capability": m.Capability, "selection": map[string]any{"logicalModelId": m.ID}, "priceLabel": m.PriceLabel, "priceTiers": m.PriceTiers, "options": m.CapabilitySpec, "profiles": m.CapabilityProfiles, "defaults": m.DefaultOptions})
		}
	}
	for _, channel := range catalog.Channels {
		for _, m := range channel.Models {
			if m.Available && generationModes[normalizeCapability(m.Capability)] {
				items = append(items, map[string]any{"name": m.DisplayName, "capability": m.Capability, "selection": map[string]any{"channelId": channel.ID, "channelModelKey": m.ModelKey}, "priceLabel": m.PriceLabel, "priceTiers": m.PriceTiers, "options": m.CapabilityConfig})
			}
		}
	}
	return map[string]any{"source": catalog.Source, "models": items}, nil
}

type cloudAgentMediaArgs struct {
	DraftRunID         string   `json:"-"`
	Mode               string   `json:"mode"`
	Prompt             string   `json:"prompt"`
	LogicalModelID     string   `json:"logicalModelId"`
	ChannelID          string   `json:"channelId"`
	ChannelModelKey    string   `json:"channelModelKey"`
	Duration           int      `json:"durationSeconds"`
	Size               string   `json:"size"`
	Quality            string   `json:"quality"`
	VideoGenerateAudio *bool    `json:"videoGenerateAudio"`
	SnapshotHash       string   `json:"snapshotHash"`
	NodeID             string   `json:"nodeId"`
	Title              string   `json:"title"`
	SourceNodeID       string   `json:"sourceNodeId"`
	ReferenceNodeIDs   []string `json:"referenceNodeIds"`
}

type cloudAgentMediaPlan struct {
	Args   cloudAgentMediaArgs
	CallID string
}

func (s *Service) cloudAgentMediaModelName(a cloudAgentMediaArgs) (string, error) {
	if !cloudAgentGenerationModeSupported(a.Mode) {
		return "", BadAuthRequest("生成模式当前不受 Agent 支持")
	}
	catalog, err := s.ModelCatalog(nil)
	if err != nil {
		return "", err
	}
	for _, m := range catalog.Models {
		if a.LogicalModelID != "" && m.ID == a.LogicalModelID && m.Available && normalizeCapability(m.Capability) == normalizeCapability(a.Mode) {
			return m.Name, nil
		}
	}
	for _, channel := range catalog.Channels {
		if channel.ID != a.ChannelID {
			continue
		}
		for _, m := range channel.Models {
			if m.ModelKey == a.ChannelModelKey && m.Available && normalizeCapability(m.Capability) == normalizeCapability(a.Mode) {
				return m.DisplayName, nil
			}
		}
	}
	return "", BadAuthRequest("模型目录已变化，请重新读取目录并询问用户选择模型")
}

func cloudAgentReference(repo *repository.Repository, userID string, node map[string]any) (map[string]any, error) {
	kind := stringValue(node["type"])
	if kind != "image" && kind != "video" && kind != "audio" {
		return nil, BadAuthRequest("引用节点必须是图片、视频或音频")
	}
	meta, _ := node["metadata"].(map[string]any)
	key := stringValue(meta["storageKey"])
	if !strings.HasPrefix(key, "resource:") {
		return nil, BadAuthRequest("参考资产尚未保存到账号资源库，请先上传；不能用外部地址代替")
	}
	resource, err := repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
	if err != nil {
		return nil, BadAuthRequest("参考资产不存在或不属于当前用户")
	}
	if resource.Status != "ready" || !strings.HasPrefix(resource.MimeType, kind+"/") {
		return nil, BadAuthRequest("参考资产尚未就绪或媒体类型不匹配")
	}
	return map[string]any{"id": node["id"], "name": node["title"], "storageKey": key, "type": resource.MimeType, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs}, nil
}

func cloudAgentMediaDocument(repo *repository.Repository, userID, canvasID string, args cloudAgentMediaArgs) (*model.CanvasProject, map[string]any, map[string]any, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, nil, nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, nil, nil, err
	}
	if args.SnapshotHash == "" || cloudAgentCanvasHash(doc) != args.SnapshotHash {
		return nil, nil, nil, creationConflict("画布已变化，请重新读取画布并重新审批；未提交生成任务")
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, nil, nil, err
	}
	existing := nodes[args.NodeID]
	existingMeta, _ := existing["metadata"].(map[string]any)
	ownedDraft := existing != nil && args.DraftRunID != "" && stringValue(existingMeta["agentDraftRunId"]) == args.DraftRunID && stringValue(existingMeta["taskId"]) == "" && stringValue(existing["type"]) == args.Mode
	if err := validateCloudAgentID(args.NodeID, "生成节点 ID", 80); err != nil {
		return nil, nil, nil, err
	}
	if existing != nil && !ownedDraft {
		return nil, nil, nil, BadAuthRequest("生成节点必须使用新的唯一 nodeId")
	}
	if args.SourceNodeID != "" && nodes[args.SourceNodeID] == nil {
		return nil, nil, nil, BadAuthRequest("来源镜头节点不在当前画布")
	}
	if source := nodes[args.SourceNodeID]; source != nil && stringValue(source["type"]) != "text" {
		return nil, nil, nil, BadAuthRequest("sourceNodeId 仅接受文本/镜头提示词节点；图片、视频、音频请放入 referenceNodeIds，并将 sourceNodeId 留空，不要重复传入")
	}
	// Keep the media entry point subject to the same graph admission policy as
	// canvas_apply_ops. The old implementation only checked that references
	// existed, which allowed invalid edges (for example frame -> image) to be
	// smuggled in through generate_media.
	prospectiveConnections := creationMaps(doc["connections"])
	target := existing
	if target == nil {
		target = map[string]any{"id": args.NodeID, "type": args.Mode}
	}
	prospectiveNodes := make([]map[string]any, 0, len(nodes)+1)
	for _, node := range nodes {
		prospectiveNodes = append(prospectiveNodes, node)
	}
	if existing == nil {
		prospectiveNodes = append(prospectiveNodes, target)
	}
	prospectiveSources := append(append([]string{}, args.ReferenceNodeIDs...), args.SourceNodeID)
	prospectiveSeen := map[string]bool{}
	for _, sourceID := range prospectiveSources {
		if sourceID == "" || prospectiveSeen[sourceID] {
			continue
		}
		prospectiveSeen[sourceID] = true
		alreadyConnected := false
		for _, edge := range prospectiveConnections {
			if stringValue(edge["fromNodeId"]) == sourceID && stringValue(edge["toNodeId"]) == args.NodeID {
				alreadyConnected = true
				break
			}
		}
		if alreadyConnected {
			continue
		}
		if err := validateCloudAgentConnection(prospectiveNodes, sourceID, args.NodeID, prospectiveConnections); err != nil {
			return nil, nil, nil, err
		}
		prospectiveConnections = append(prospectiveConnections, map[string]any{"fromNodeId": sourceID, "toNodeId": args.NodeID})
	}
	refs := map[string]any{}
	seen := map[string]bool{}
	for _, id := range args.ReferenceNodeIDs {
		if id == "" || seen[id] || nodes[id] == nil {
			return nil, nil, nil, BadAuthRequest("参考节点不存在或重复")
		}
		seen[id] = true
		ref, e := cloudAgentReference(repo, userID, nodes[id])
		if e != nil {
			return nil, nil, nil, e
		}
		key := map[string]string{"image": "referenceImages", "video": "referenceVideos", "audio": "referenceAudios"}[stringValue(nodes[id]["type"])]
		list, _ := refs[key].([]any)
		refs[key] = append(list, ref)
	}
	return canvas, doc, refs, nil
}

func validateCloudAgentMediaArgs(a cloudAgentMediaArgs, state *cloudAgentRuntime) error {
	mode := strings.ToLower(strings.TrimSpace(a.Mode))
	if mode != "image" && mode != "video" && mode != "audio" {
		return BadAuthRequest("生成模式只能是 image、video 或 audio")
	}
	a.Mode = mode
	if a.SnapshotHash == "" {
		return BadAuthRequest("缺少画布快照，请先读取当前画布")
	}
	if len(a.SnapshotHash) != 64 {
		return BadAuthRequest("画布快照无效，请重新读取当前画布")
	}
	for _, r := range a.SnapshotHash {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return BadAuthRequest("画布快照无效，请重新读取当前画布")
		}
	}
	if err := validateCloudAgentID(a.NodeID, "生成节点 ID", 80); err != nil {
		return err
	}
	if a.SourceNodeID != "" {
		if err := validateCloudAgentID(a.SourceNodeID, "来源节点 ID", 80); err != nil {
			return err
		}
	}
	for _, id := range a.ReferenceNodeIDs {
		if err := validateCloudAgentID(id, "参考节点 ID", 80); err != nil {
			return err
		}
	}
	if strings.TrimSpace(a.Prompt) == "" {
		return BadAuthRequest("生成提示词不能为空")
	}
	if strings.TrimSpace(a.Title) == "" || utf8.RuneCountInString(a.Title) > 240 {
		return BadAuthRequest("生成节点标题不能为空且不能超过 240 个字符")
	}
	if utf8.RuneCountInString(a.Prompt) > 16000 {
		return BadAuthRequest(fmt.Sprintf("提示词共%d字符，超过16000字符上限；请先告知用户，不要擅自删改关键内容", utf8.RuneCountInString(a.Prompt)))
	}
	if (mode == "image" || mode == "video") && strings.TrimSpace(a.Size) == "" {
		return BadAuthRequest("请填写模型支持的具体画幅；用户授权默认时沿用参考图比例或目录默认画幅，无需重复询问")
	}
	if a.Duration < 0 || a.Duration > 120 {
		return BadAuthRequest("生成时长必须在 0 到 120 秒之间")
	}
	switch mode {
	case "video":
		if a.Duration == 0 {
			return BadAuthRequest("视频生成必须明确 durationSeconds")
		}
	case "image", "audio":
		if a.Duration != 0 {
			return BadAuthRequest("只有视频生成允许设置 durationSeconds")
		}
		if a.VideoGenerateAudio != nil {
			return BadAuthRequest("videoGenerateAudio 仅适用于视频生成")
		}
	}
	if len(a.ReferenceNodeIDs) > 16 {
		return BadAuthRequest("参考节点最多 16 个")
	}
	if a.SourceNodeID != "" {
		for _, id := range a.ReferenceNodeIDs {
			if id == a.SourceNodeID {
				return BadAuthRequest("sourceNodeId 与 referenceNodeIds 不能重复；参考图片、视频、音频请仅保留在 referenceNodeIds 并清空 sourceNodeId，文本镜头节点则仅放 sourceNodeId")
			}
		}
	}
	if state == nil {
		return BadAuthRequest("Agent 状态无效")
	}
	if state.Generations >= state.Request.Budget.MaxGenerationTasks {
		return BadAuthRequest("已达到本轮媒体生成次数上限")
	}
	if mode == "video" && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds-a.Duration {
		return BadAuthRequest("已超过本轮视频时长预算")
	}
	return nil
}

func validateCloudAgentMediaReferences(mode string, refs map[string]any) error {
	imageCount := lenAnySlice(refs["referenceImages"])
	videoCount := lenAnySlice(refs["referenceVideos"])
	audioCount := lenAnySlice(refs["referenceAudios"])
	switch mode {
	case "image":
		if videoCount > 0 || audioCount > 0 {
			return BadAuthRequest("图片生成仅支持图片参考资产")
		}
	case "audio":
		if imageCount > 0 || videoCount > 0 || audioCount > 0 {
			return BadAuthRequest("当前音频生成只支持文本输入，暂不支持媒体参考资产")
		}
	case "video":
		// Video reference admission is completed against the selected model's
		// capability contract by CreateTask. Do not guess a provider operation here.
	}
	return nil
}

func lenAnySlice(value any) int {
	switch items := value.(type) {
	case []any:
		return len(items)
	case []map[string]any:
		return len(items)
	default:
		return 0
	}
}

func cloudAgentMediaOperation(mode string, refs map[string]any) string {
	switch mode {
	case "video":
		if lenAnySlice(refs["referenceVideos"]) > 0 {
			return "reference_to_video"
		}
		if lenAnySlice(refs["referenceAudios"]) > 0 {
			return "audio_to_video"
		}
		if lenAnySlice(refs["referenceImages"]) > 0 {
			return "image_to_video"
		}
	case "image":
		if lenAnySlice(refs["referenceImages"]) > 0 {
			return "image_to_image"
		}
	}
	// Audio is currently text-to-audio only. Keep this explicit so a future
	// provider-specific reference operation cannot be introduced accidentally.
	return "text_to_" + mode
}

func (s *Service) prepareCloudAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) (CreateTaskRequest, *cloudAgentMediaPlan, error) {
	var a cloudAgentMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &a); err != nil {
		return CreateTaskRequest{}, nil, BadAuthRequest("生成参数必须是只含支持字段的单个JSON对象")
	}
	a.Mode = strings.ToLower(strings.TrimSpace(a.Mode))
	a.DraftRunID = run.ID
	if err := validateCloudAgentMediaArgs(a, state); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	if (a.LogicalModelID == "" && (a.ChannelID == "" || a.ChannelModelKey == "")) || (a.LogicalModelID != "" && (a.ChannelID != "" || a.ChannelModelKey != "")) {
		return CreateTaskRequest{}, nil, BadAuthRequest("请复制 model_list 的 selection：逻辑模型或系统渠道二选一，不得混用")
	}
	_, _, refs, err := cloudAgentMediaDocument(s.repo, run.UserID, state.Request.CanvasID, a)
	if err != nil {
		return CreateTaskRequest{}, nil, err
	}
	config := map[string]any{"count": "1"}
	if a.ChannelID != "" {
		config["channelId"], config["channelModelKey"], config["model"] = a.ChannelID, a.ChannelModelKey, a.ChannelModelKey
	}
	if a.Mode == "video" {
		config["videoSeconds"] = fmt.Sprint(a.Duration)
	}
	if a.Size != "" {
		config["size"] = a.Size
	}
	if a.Quality != "" {
		if a.Mode == "video" {
			config["vquality"] = a.Quality
		} else {
			config["quality"] = a.Quality
		}
	}
	if a.VideoGenerateAudio != nil {
		config["videoGenerateAudio"] = fmt.Sprint(*a.VideoGenerateAudio)
	}
	input := refs
	input["mode"], input["prompt"], input["config"] = a.Mode, a.Prompt, config
	if err := validateCloudAgentMediaReferences(a.Mode, refs); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	operation := cloudAgentMediaOperation(a.Mode, refs)
	metadata := map[string]any{"nodeId": a.NodeID, "source": "cloud_agent"}
	if a.Mode == "video" {
		metadata["videoEditOperation"] = operation
	}
	input["metadata"] = metadata
	return CreateTaskRequest{ProjectID: state.Request.CanvasID, Type: "canvas_" + a.Mode, Operation: operation, Prompt: a.Prompt, LogicalModelID: a.LogicalModelID, Model: a.ChannelModelKey, Input: input}, &cloudAgentMediaPlan{Args: a, CallID: call.ID}, nil
}

func saveCloudAgentDocument(repo *repository.Repository, canvas *model.CanvasProject, doc map[string]any, policy RuntimePolicySetting) error {
	doc["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	raw, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	if len(raw) > 8<<20 {
		return BadAuthRequest("画布大小超限")
	}
	usage, err := repo.UserStorageUsage(canvas.UserID)
	if err != nil {
		return err
	}
	if err = validateStructuredStorageQuotaWithPolicy(usage, "canvas", false, int64(len(raw)-len(canvas.PayloadJSON)), policy.Resource); err != nil {
		return err
	}
	before := canvas.PayloadJSON
	canvas.PayloadJSON = string(raw)
	return repo.CompareSaveCreationCanvas(canvas, before)
}

// Called inside the same transaction as the task, charge reservation and Agent checkpoint.
func createCloudAgentMediaNode(repo *repository.Repository, userID, canvasID string, plan *cloudAgentMediaPlan, task *model.Task, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) error {
	a := plan.Args
	canvas, doc, _, err := cloudAgentMediaDocument(repo, userID, canvasID, a)
	if err != nil {
		return err
	}
	beforeJSON := canvas.PayloadJSON
	beforeHash := cloudAgentCanvasHash(doc)
	nodes := creationMaps(doc["nodes"])
	x, y := 80.0, 80.0
	for _, node := range nodes {
		position, _ := node["position"].(map[string]any)
		nx, _ := position["x"].(float64)
		width, _ := node["width"].(float64)
		if nx+width+80 > x {
			x = nx + width + 80
		}
		if stringValue(node["id"]) == a.SourceNodeID {
			y, _ = position["y"].(float64)
		}
	}
	meta := map[string]any{"status": "idle", "agentDraftRunId": a.DraftRunID, "prompt": a.Prompt, "composerContent": a.Prompt, "referenceNodeIds": a.ReferenceNodeIDs}
	if a.Size != "" && (a.Mode == "image" || a.Mode == "video") {
		meta["size"] = a.Size
	}
	if a.Mode == "video" {
		meta["videoSeconds"] = fmt.Sprint(a.Duration)
	}
	if a.Quality != "" {
		key := "quality"
		if a.Mode == "video" {
			key = "vquality"
		}
		meta[key] = a.Quality
	}
	if a.VideoGenerateAudio != nil {
		meta["videoGenerateAudio"] = fmt.Sprint(*a.VideoGenerateAudio)
	}
	var input struct {
		Config map[string]any `json:"config"`
	}
	if task != nil {
		meta["status"], meta["taskId"], meta["taskStatus"] = "loading", task.ID, "queued"
		delete(meta, "agentDraftRunId")
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return err
		}
	}
	// Persist public selectors and requested options only, never provider credentials.
	for _, key := range []string{"size", "quality", "vquality", "videoSeconds", "videoGenerateAudio"} {
		if value, ok := input.Config[key]; ok {
			meta[key] = value
		}
	}
	if a.Mode != "video" {
		delete(meta, "videoSeconds")
		delete(meta, "videoGenerateAudio")
	}
	if a.LogicalModelID != "" {
		meta["logicalModelId"] = a.LogicalModelID
	} else {
		meta["channelId"], meta["channelModelKey"], meta["model"] = a.ChannelID, a.ChannelModelKey, a.ChannelModelKey
	}
	node := creationAddedNode(CreationCanvasOp{Type: "add_node", ID: a.NodeID, NodeType: a.Mode, Title: a.Title, X: &x, Y: &y, Metadata: meta})
	if a.Size == "9:16" {
		node["width"], node["height"] = float64(360), float64(640)
	}
	replaced := false
	for _, existing := range nodes {
		if stringValue(existing["id"]) == a.NodeID {
			existing["metadata"], existing["title"] = meta, a.Title
			replaced = true
			break
		}
	}
	if !replaced {
		nodes = append(nodes, node)
	}
	doc["nodes"] = nodes
	edges := creationMaps(doc["connections"])
	seen := map[string]bool{}
	for _, edge := range edges {
		if stringValue(edge["toNodeId"]) == a.NodeID {
			seen[stringValue(edge["fromNodeId"])] = true
		}
	}
	for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		edges = append(edges, map[string]any{"id": "agent-" + newID(), "fromNodeId": id, "toNodeId": a.NodeID})
	}
	doc["connections"] = edges
	if err := saveCloudAgentDocument(repo, canvas, doc, policy); err != nil {
		return err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		stepID := plan.CallID
		if stepID == "" {
			stepID = a.NodeID
		}
		operation := "generate_media_draft"
		if task != nil {
			operation = "generate_media_submit"
		}
		return recorder[0](repo, cloudAgentMutationInput{
			RunID:              a.DraftRunID,
			UserID:             userID,
			CanvasID:           canvasID,
			StepID:             stepID,
			Operation:          operation,
			BeforeSnapshotHash: beforeHash,
			AfterSnapshotHash:  cloudAgentCanvasHash(doc),
			BeforeJSON:         beforeJSON,
			HasSubmittedTask:   task != nil,
		})
	}
	return nil
}

func completeCloudAgentMediaNode(repo *repository.Repository, userID, canvasID string, task *model.Task, policy RuntimePolicySetting) (string, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return "", err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return "", err
	}
	for _, node := range creationMaps(doc["nodes"]) {
		meta, _ := node["metadata"].(map[string]any)
		if stringValue(meta["taskId"]) != task.ID {
			continue
		}
		meta["taskStatus"] = string(task.Status)
		meta["status"] = "error"
		meta["errorDetails"] = "媒体任务" + string(task.Status) + "：" + cloudAgentSafeMediaTaskError(task)
		if task.Status == model.TaskStatusSucceeded {
			id, _ := taskOutputResource(task.ResultJSON, task.Type)
			resource, e := repo.ResourceForUser(userID, id)
			if e != nil || resource.Status != "ready" || !strings.HasPrefix(resource.MimeType, stringValue(node["type"])+"/") {
				meta["status"] = "error"
				meta["errorDetails"] = "生成结果没有可用的账号资源，未写入媒体地址"
				if saveErr := saveCloudAgentDocument(repo, canvas, doc, policy); saveErr != nil {
					return stringValue(node["id"]), saveErr
				}
				return stringValue(node["id"]), BadAuthRequest("生成结果没有可用的账号资源，未写入媒体地址")
			}
			meta["content"], meta["storageKey"], meta["status"] = resourceFileURL(id), "resource:"+id, "success"
			meta["naturalWidth"], meta["naturalHeight"] = resource.Width, resource.Height
			if resource.Width > 0 && resource.Height > 0 {
				if width, ok := node["width"].(float64); ok && width > 0 {
					node["height"] = width * float64(resource.Height) / float64(resource.Width)
				}
			}
			delete(meta, "errorDetails")
		}
		return stringValue(node["id"]), saveCloudAgentDocument(repo, canvas, doc, policy)
	}
	return "", creationConflict("生成节点已删除或已绑定其他任务；结果仍保留在任务中心，未重建节点")
}
