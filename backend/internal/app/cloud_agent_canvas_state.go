package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/canvas/capability"
	"infinite-canvas/backend/internal/repository"
)

type cloudAgentStructuredProjector func(value any, offset int, precise bool) (any, error)

var cloudAgentStructuredProjectors = map[string]cloudAgentStructuredProjector{
	"storyboard": func(value any, offset int, precise bool) (any, error) {
		storyboard, ok := value.(map[string]any)
		if !ok {
			return nil, nil
		}
		return cloudAgentStoryboardState(storyboard, offset, precise), nil
	},
	"batch_table": func(value any, offset int, precise bool) (any, error) {
		table, ok := value.(map[string]any)
		if !ok {
			return nil, nil
		}
		return cloudAgentBatchTableState(table, offset, precise), nil
	},
}

// Viewport autosaves must not invalidate approved content; node edits still do.
func cloudAgentCanvasHash(doc map[string]any) string {
	content := make(map[string]any, len(doc))
	for key, value := range doc {
		if key != "viewport" && key != "updatedAt" {
			content[key] = value
		}
	}
	return creationHash(content)
}

// Generation uses the graph, not canvas presentation or autosave bookkeeping.
// Keep all node business fields (including unknown metadata) fail-closed, and
// keep the full canvas hash for mutations/undo and the database CAS.
func cloudAgentMediaContentHash(doc map[string]any) string {
	content := map[string]any{"connections": doc["connections"]}
	nodes := creationMaps(doc["nodes"])
	projected := make([]map[string]any, 0, len(nodes))
	for _, node := range nodes {
		item := make(map[string]any, len(node))
		for key, value := range node {
			switch key {
			case "position", "width", "height", "createdAt", "updatedAt":
			default:
				item[key] = value
			}
		}
		projected = append(projected, item)
	}
	content["nodes"] = projected
	return cloudAgentCanvasHash(content)
}

const cloudAgentReadPageBytes = 64 << 10

func cloudAgentCanvasState(repo *repository.Repository, userID, canvasID string, doc map[string]any, offset int, ids []string, storyboardOffset int, connectionOffsets ...int) (any, error) {
	if offset < 0 || storyboardOffset < 0 || len(ids) > 8 {
		return nil, BadAuthRequest("画布读取分页参数无效")
	}
	all := creationMaps(doc["nodes"])
	connectionOffset := 0
	if len(connectionOffsets) > 0 {
		connectionOffset = connectionOffsets[0]
	}
	if connectionOffset < 0 {
		return nil, BadAuthRequest("连线分页参数无效")
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	for id := range wanted {
		found := false
		for _, node := range all {
			if stringValue(node["id"]) == id {
				found = true
				break
			}
		}
		if !found {
			return nil, BadAuthRequest("指定节点不在当前画布")
		}
	}
	limit := 2000
	if len(ids) > 0 {
		limit = 16000
	}
	nodes := []any{}
	included := map[string]bool{}
	// 摘要页正文每字段只留 limit 个字符。被截断的节点要明确报出来，否则调用方会把
	// 摘要当全文照抄（改写旧提示词时最危险），也不知道还能精读到 16000 字符。
	truncated := []any{}
	next := 0
	pageBytes := 1024
	for index, node := range all {
		if index < offset {
			continue
		}
		id := stringValue(node["id"])
		if len(ids) > 0 {
			if !wanted[id] {
				continue
			}
		} else {
			if index < offset {
				continue
			}
			if len(nodes) == 40 {
				next = index
				break
			}
		}
		meta, _ := node["metadata"].(map[string]any)
		item := map[string]any{"id": id, "type": stringValue(node["type"])}
		if title, ok := node["title"].(string); ok {
			item["title"] = truncateRunes(title, 300)
		}
		if position, ok := node["position"].(map[string]any); ok {
			safePosition := map[string]any{}
			for _, axis := range []string{"x", "y"} {
				if value, ok := cloudAgentSafeNumber(position[axis]); ok {
					safePosition[axis] = value
				}
			}
			item["position"] = safePosition
		}
		for _, dimension := range []string{"width", "height"} {
			if value, ok := cloudAgentSafeNumber(node[dimension]); ok {
				item[dimension] = value
			}
		}
		if status, ok := meta["status"].(string); ok {
			item["status"] = truncateRunes(status, 40)
		}
		capability, known := cloudAgentNodeCapabilityForType(stringValue(node["type"]))
		if !known {
			// Read visibility is not permission to mutate or use a node as a media reference.
			item["agentSupported"] = false
			item["agentUnsupportedReason"] = "仅展示基础信息；当前 Agent 不支持操作此类型节点"
			body, _ := json.Marshal(item)
			if pageBytes+len(body) > cloudAgentReadPageBytes-(8<<10) {
				next = index
				break
			}
			pageBytes += len(body)
			nodes = append(nodes, item)
			included[id] = true
			continue
		}
		fields := capability.SummaryFields
		if len(ids) > 0 {
			fields = capability.DetailFields
		}
		projected, err := cloudAgentProjectNodeFields(node, meta, capability, fields, limit, len(ids) > 0, storyboardOffset)
		if err != nil {
			return nil, err
		}
		for key, value := range projected {
			item[key] = value
		}
		if cloudAgentProjectionTruncated(projected) {
			truncated = append(truncated, id)
		}
		// 作者标记要暴露：模型据此判断哪些节点是自己建的、可以用 delete_node 撤销。
		if stringValue(meta[cloudAgentNodeAuthorField]) != "" {
			item["agentCreated"] = true
		}
		if capability.GenerationMode != "" {
			generation := map[string]any{"taskStatus": "not_submitted"}
			if reason, issue := cloudAgentMediaTargetIssue(node, capability.Type); reason != "" {
				generation["submitBlockedReason"], generation["submitBlockedIssue"] = reason, issue
			}
			taskID := stringValue(meta["taskId"])
			if taskID == "" {
				taskID = stringValue(meta["generationTaskId"])
			}
			if taskID != "" {
				// Do not infer success/failure from stale canvas metadata.
				generation["taskStatus"] = "unavailable"
				task, err := repo.TaskForUser(userID, taskID)
				if err == nil && task.ProjectID == canvasID {
					for key, value := range cloudAgentTaskDiagnostic(repo, task) {
						generation[key] = value
					}
				}
			}
			item["generation"] = generation
		}
		if draftRunID := stringValue(meta["agentDraftRunId"]); draftRunID != "" && stringValue(meta["taskId"]) == "" && stringValue(meta["generationTaskId"]) == "" {
			draft := map[string]any{"submitted": false, "requiresApproval": true, "ownerStatus": "unknown"}
			owner, err := repo.CloudAgent(userID, draftRunID)
			if err == nil && owner.CanvasID == canvasID {
				draft["ownerStatus"] = owner.Status
				draft["cleanupPending"] = owner.CleanupPending
			}
			item["generationDraft"] = draft
		}
		if capability.Connection.CanReference {
			ref, _, err := cloudAgentReference(repo, userID, node)
			outputReference := map[string]any{"ready": err == nil}
			item["outputReference"] = outputReference
			if err != nil {
				outputReference["issue"] = cloudAgentSafeToolError(err)
			} else {
				// Provider references contain a storage key for task submission.
				// The model only needs the verified public characteristics; never
				// forward the provider payload or storage locator into the read tool.
				item["asset"] = map[string]any{
					"mimeType": ref["mimeType"], "bytes": ref["bytes"],
					"width": ref["width"], "height": ref["height"],
					"durationMs": ref["durationMs"], "inputKind": ref["inputKind"],
				}
			}
		}
		body, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		if pageBytes+len(body) > cloudAgentReadPageBytes-(8<<10) {
			if len(nodes) == 0 {
				return nil, BadAuthRequest("节点详情超过单页读取预算，请使用节点对应的结构化分页工具")
			}
			next = index
			break
		}
		pageBytes += len(body)
		nodes = append(nodes, item)
		included[id] = true
	}
	// 连线是全量事实，不按「两端节点是否落在本页」过滤。按页过滤会让调用方
	// 根本看不到这些边，只能判定成「连线缺失」而重复建同一条，撞上「连线重复」。
	allEdges := creationMaps(doc["connections"])
	edges := []any{}
	cursor := connectionOffset
	for ; cursor < len(allEdges); cursor++ {
		edge := allEdges[cursor]
		item := map[string]any{"id": edge["id"], "fromNodeId": edge["fromNodeId"], "toNodeId": edge["toNodeId"]}
		body, _ := json.Marshal(item)
		// 每页至少放一条边：节点详情可能已经吃掉整个预算，如果这里严格按预算退出，
		// nextConnectionOffset 会等于本次的 connectionOffset，调用方原地打转。
		if len(edges) > 0 && pageBytes+len(body) > cloudAgentReadPageBytes {
			break
		}
		pageBytes += len(body)
		edges = append(edges, item)
	}
	// 用游标本身判断还有没有剩余，而不是拿 0 当哨兵：否则首页恰好放不下第一条边时
	// 会被报成「没有更多」，调用方永远读不到它。
	hasMoreConnections := cursor < len(allEdges)
	nextConnection := 0
	if hasMoreConnections {
		nextConnection = cursor
	}
	view := map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "mediaSnapshotHash": cloudAgentMediaContentHash(doc), "nodes": nodes, "connections": edges, "totalNodes": len(all), "totalConnections": len(allEdges), "nextOffset": next, "hasMore": next > 0, "connectionOffset": connectionOffset, "nextConnectionOffset": nextConnection, "hasMoreConnections": hasMoreConnections, "pageByteBudget": cloudAgentReadPageBytes}
	if len(truncated) > 0 {
		view["truncatedNodeIds"] = truncated
		view["truncatedNote"] = fmt.Sprintf("这些节点的字段在摘要页被截断（每字段最多 %d 字符）；用 canvas_get_state 传 nodeIds 精读，最多可读到 16000 字符。", limit)
	}
	return view, nil
}

// cloudAgentProjectionTruncated 判断投影里有没有字段被截断：投影会为每个被截断的字段
// 加上同名的 xxxTruncated 标记，所以这里只认值为 true 的标记。
func cloudAgentProjectionTruncated(projected map[string]any) bool {
	for key, value := range projected {
		if truncated, ok := value.(bool); ok && truncated && strings.HasSuffix(key, "Truncated") {
			return true
		}
	}
	return false
}

func cloudAgentSafeNumber(value any) (any, bool) {
	switch number := value.(type) {
	case float64, float32, int, int64:
		return number, true
	default:
		return nil, false
	}
}

// cloudAgentProjectNodeFields is the single projection path for both the
// initial run summary and canvas_get_state. Capability descriptors decide which
// fields exist; this function decides how those fields are safely represented.
// It deliberately never returns arbitrary metadata, URLs, storage keys or
// media payloads.
func cloudAgentProjectNodeFields(node, meta map[string]any, descriptor capability.Descriptor, fields []string, textLimit int, precise bool, structuredOffset int) (map[string]any, error) {
	projected := map[string]any{}
	for _, key := range fields {
		if descriptor.ProjectionKind != "" && key == descriptor.ProjectionField {
			projector, registered := cloudAgentStructuredProjectors[descriptor.ProjectionKind]
			if !registered {
				return nil, BadAuthRequest(fmt.Sprintf("节点 %s 的结构化读取能力未注册", descriptor.Label))
			}
			value, ok := cloudAgentProjectionValue(node, meta, descriptor.ProjectionField)
			if !ok {
				continue
			}
			structured, err := projector(value, structuredOffset, precise)
			if err != nil {
				return nil, BadAuthRequest(fmt.Sprintf("节点 %s 的结构化数据无法读取", descriptor.Label))
			}
			if structured != nil {
				projected[key] = structured
			}
			continue
		}
		value, ok := node[key]
		if !ok {
			value, ok = meta[key]
		}
		if !ok || (key == "content" && descriptor.GenerationMode != "") {
			continue
		}
		if safe, truncated := cloudAgentSafeProjection(value, textLimit); safe != nil {
			projected[key] = safe
			if truncated {
				projected[key+"Truncated"] = true
			}
		}
	}
	return projected, nil
}

func cloudAgentProjectionValue(node, meta map[string]any, path string) (any, bool) {
	parts := strings.Split(path, ".")
	for _, root := range []map[string]any{node, meta} {
		var current any = root
		found := true
		for _, part := range parts {
			object, ok := current.(map[string]any)
			if !ok {
				found = false
				break
			}
			current, ok = object[part]
			if !ok {
				found = false
				break
			}
		}
		if found {
			return current, true
		}
	}
	return nil, false
}

func cloudAgentSafeProjection(value any, textLimit int) (any, bool) {
	switch typed := value.(type) {
	case string:
		text := truncateRunes(typed, textLimit)
		return text, len([]rune(typed)) > textLimit
	case float64, float32, int, int64, bool:
		return typed, false
	case []string:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			items = append(items, truncateRunes(item, min(textLimit, 200)))
		}
		return items, false
	case []any:
		items := make([]any, 0, min(len(typed), 32))
		for _, item := range typed[:min(len(typed), 32)] {
			safe, _ := cloudAgentSafeProjection(item, min(textLimit, 200))
			if safe != nil {
				items = append(items, safe)
			}
		}
		return items, len(typed) > len(items)
	default:
		return nil, false
	}
}

// Summaries locate a shot; a precise node read returns one full row at a time.
// Only narrative fields and canvas IDs are exposed, never arbitrary metadata.
func cloudAgentStoryboardState(storyboard map[string]any, offset int, precise bool) map[string]any {
	all := creationMaps(storyboard["rows"])
	count, textLimit := 20, 200
	if precise {
		count, textLimit = 1, 16000
	}
	rows := []any{}
	next := 0
	for i, row := range all {
		if i < offset {
			continue
		}
		if len(rows) == count {
			next = i
			break
		}
		item := map[string]any{}
		fields := []string{"id", "shotNumber", "durationSeconds", "plotDescription", "imageNodeId", "videoNodeId"}
		if precise {
			fields = append(fields, "videoMotionPrompt", "imageGenerationPrompt", "dialogue", "narrativeIntent", "viewerPOV", "performanceBlocking", "shotSize", "emotion", "lightingAndAtmosphere", "audioEffects", "camera", "motion", "timeBeats", "mustHave", "optionalDetails", "continuityOut", "negativePrompt")
		}
		budget := 24000
		for _, key := range fields {
			switch value := row[key].(type) {
			case string:
				text := truncateRunes(value, min(textLimit, budget))
				budget -= len([]rune(text))
				item[key] = text
				if text != value {
					item[key+"Truncated"] = true
				}
			case float64:
				item[key] = value
			}
		}
		for collection, keys := range map[string][]string{
			"assetBindings": {"nodeId", "role", "priority"},
			"characters":    {"characterName", "characterAssetId", "characterVersionId", "characterImageNodeId"},
		} {
			values := []any{}
			entries := creationMaps(row[collection])
			for _, entry := range entries[:min(len(entries), 16)] {
				value := map[string]any{}
				for _, key := range keys {
					if text, ok := entry[key].(string); ok {
						value[key] = truncateRunes(text, 200)
					} else if number, ok := entry[key].(float64); ok {
						value[key] = number
					}
				}
				values = append(values, value)
			}
			item[collection] = values
			item[collection+"Truncated"] = len(entries) > 16
		}
		rows = append(rows, item)
	}
	return map[string]any{"rows": rows, "totalRows": len(all), "nextOffset": next, "hasMore": next > 0}
}

// Batch-table projection exposes only the fields rendered by the component.
// Result URLs, task IDs, storage keys and arbitrary metadata remain private.
func cloudAgentBatchTableState(table map[string]any, offset int, precise bool) map[string]any {
	operation := stringValue(table["operation"])
	if operation != "creative" {
		operation = "try_on"
	}
	concurrency := 10
	if value, ok := cloudAgentInteger(table["concurrency"]); ok && (value == 1 || value == 5 || value == 10) {
		concurrency = value
	}
	columns := []any{}
	for index, column := range creationMaps(table["referenceColumns"])[:min(len(creationMaps(table["referenceColumns"])), 6)] {
		id, label := truncateRunes(stringValue(column["id"]), 120), truncateRunes(stringValue(column["label"]), 120)
		if id != "" && label != "" {
			columns = append(columns, map[string]any{"id": id, "label": label, "mentionToken": fmt.Sprintf("@参考图%d", index+1)})
		}
	}
	if len(columns) == 0 {
		columns = defaultCloudAgentBatchReferenceColumns()
	}

	globalPrompt := strings.TrimSpace(stringValue(table["globalPrompt"]))
	all := creationMaps(table["rows"])
	count, textLimit := 20, 240
	if precise {
		count, textLimit = 20, 16000
	}
	rows := []any{}
	next := 0
	ready, enabled, missingPrompt, missingReferences, outputLinked := 0, 0, 0, 0, 0
	for _, row := range all {
		rowEnabled, _ := row["enabled"].(bool)
		prompt := strings.TrimSpace(stringValue(row["prompt"]))
		effectivePrompt := globalPrompt
		if effectivePrompt == "" {
			effectivePrompt = prompt
		}
		inputs := cloudAgentBatchInputIDs(row["inputNodeIds"], len(columns))
		if rowEnabled {
			enabled++
			if effectivePrompt == "" {
				missingPrompt++
			}
			minimumInputs := 1
			if operation == "try_on" {
				minimumInputs = 2
			}
			if len(inputs) < minimumInputs {
				missingReferences++
			}
			if effectivePrompt != "" && len(inputs) >= minimumInputs {
				ready++
			}
		}
		if stringValue(row["outputNodeId"]) != "" {
			outputLinked++
		}
	}
	for index, row := range all {
		if index < offset {
			continue
		}
		if len(rows) == count {
			next = index
			break
		}
		item := map[string]any{
			"id":           truncateRunes(stringValue(row["id"]), 120),
			"enabled":      row["enabled"] == true,
			"inputNodeIds": cloudAgentBatchInputIDs(row["inputNodeIds"], len(columns)),
		}
		prompt := stringValue(row["prompt"])
		item["prompt"] = truncateRunes(prompt, textLimit)
		if len([]rune(prompt)) > textLimit {
			item["promptTruncated"] = true
		}
		if outputNodeID := truncateRunes(stringValue(row["outputNodeId"]), 120); outputNodeID != "" {
			item["outputNodeId"] = outputNodeID
		}
		rows = append(rows, item)
	}
	projected := map[string]any{
		"operation": operation, "concurrency": concurrency, "referenceColumns": columns,
		"rows": rows, "totalRows": len(all), "nextOffset": next, "hasMore": next > 0,
		"generationPreview": map[string]any{
			"enabledRows": enabled, "readyRows": ready, "missingPromptRows": missingPrompt,
			"missingReferenceRows": missingReferences, "outputLinkedRows": outputLinked,
		},
	}
	if globalPrompt != "" {
		projected["globalPrompt"] = truncateRunes(globalPrompt, textLimit)
		if len([]rune(globalPrompt)) > textLimit {
			projected["globalPromptTruncated"] = true
		}
	}
	return projected
}

func cloudAgentBatchInputIDs(value any, limit int) []any {
	if limit <= 0 || limit > 6 {
		limit = 6
	}
	items, _ := value.([]any)
	out := make([]any, 0, min(len(items), limit))
	seen := map[string]bool{}
	for _, item := range items {
		id := truncateRunes(stringValue(item), 120)
		if id == "" || seen[id] || len(out) == limit {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func cloudAgentInteger(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case int64:
		return int(number), int64(int(number)) == number
	case float64:
		integer := int(number)
		return integer, float64(integer) == number
	default:
		return 0, false
	}
}
