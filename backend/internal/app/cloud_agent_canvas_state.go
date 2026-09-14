package app

import "infinite-canvas/backend/internal/repository"

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

func cloudAgentCanvasState(repo *repository.Repository, userID string, doc map[string]any, offset int, ids []string, storyboardOffset int) (any, error) {
	if offset < 0 || storyboardOffset < 0 || len(ids) > 8 {
		return nil, BadAuthRequest("画布读取分页参数无效")
	}
	all := creationMaps(doc["nodes"])
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	limit := 2000
	if len(ids) > 0 {
		limit = 16000
	}
	nodes := []any{}
	included := map[string]bool{}
	next := 0
	for index, node := range all {
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
		item := map[string]any{"id": id, "type": node["type"], "title": node["title"], "position": node["position"], "width": node["width"], "height": node["height"], "status": meta["status"]}
		for _, key := range []string{"content", "prompt", "composerContent"} {
			// Never put media URLs/data URLs in the model context; expose resource identity instead.
			if key == "content" && (node["type"] == "image" || node["type"] == "video" || node["type"] == "audio") {
				continue
			}
			text := stringValue(meta[key])
			item[key] = truncateRunes(text, limit)
			if len([]rune(text)) > limit {
				item[key+"Truncated"] = true
			}
		}
		for _, key := range []string{"assetId", "assetTags", "referenceNodeIds"} {
			if value, ok := meta[key]; ok {
				item[key] = value
			}
		}
		if storyboard, ok := meta["storyboard"].(map[string]any); ok {
			item["storyboard"] = cloudAgentStoryboardState(storyboard, storyboardOffset, len(ids) > 0)
		}
		if node["type"] == "image" || node["type"] == "video" || node["type"] == "audio" {
			ref, err := cloudAgentReference(repo, userID, node)
			item["referenceReady"] = err == nil
			if err != nil {
				item["referenceIssue"] = err.Error()
			} else {
				item["asset"] = ref
			}
		}
		nodes = append(nodes, item)
		included[id] = true
	}
	if len(ids) > 0 {
		for _, id := range ids {
			if !included[id] {
				return nil, BadAuthRequest("指定节点不在当前画布")
			}
		}
	}
	edges := []any{}
	for _, edge := range creationMaps(doc["connections"]) {
		if included[stringValue(edge["fromNodeId"])] || included[stringValue(edge["toNodeId"])] {
			edges = append(edges, map[string]any{"id": edge["id"], "fromNodeId": edge["fromNodeId"], "toNodeId": edge["toNodeId"]})
		}
	}
	return map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "nodes": nodes, "connections": edges, "totalNodes": len(all), "nextOffset": next, "hasMore": next > 0}, nil
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
