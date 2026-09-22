package app

import "fmt"

// cloudAgentNodeAuthorField 是 Agent 写入路径在新建节点上留下的作者标记。
// 它只在 canvas_apply_ops 的 add_node 分支里写，节点 patch 白名单里没有这个键，
// 所以调用方无法把别人的节点"认领"成自己建的。
const cloudAgentNodeAuthorField = "agentCreatedAt"

// validateCloudAgentNodeDeletion 判定一个节点能不能被 Agent 删除。
//
// 删除不可逆，所以这里的规则写成"每条都必须满足"的白名单：只有 Agent 自己刚新建、
// 还没有正文、没有提交过生成、没有连线、也没有被分镜或批量表引用的空节点可以删。
// 任何一条不满足都直接拒绝并说明原因，不做"部分删除"或"连边一起删"的推断。
func validateCloudAgentNodeDeletion(doc map[string]any, node map[string]any, edges []map[string]any) error {
	nodeID := stringValue(node["id"])
	meta, _ := node["metadata"].(map[string]any)
	if stringValue(meta[cloudAgentNodeAuthorField]) == "" {
		return BadAuthRequest("只能删除 Agent 用 canvas_apply_ops 新建的空节点：这个节点不是 Agent 建的，请在画布上手动删除")
	}
	if meta["locked"] == true {
		return BadAuthRequest("不能删除锁定节点")
	}
	if taskID := firstNonEmpty(stringValue(meta["taskId"]), stringValue(meta["generationTaskId"])); taskID != "" {
		return BadAuthRequest("不能删除已经提交过生成的节点")
	}
	if cloudAgentNodeHasContent(meta) {
		return BadAuthRequest("只能删除空节点：这个节点已经有正文、提示词或生成结果")
	}
	for _, edge := range edges {
		if stringValue(edge["fromNodeId"]) == nodeID || stringValue(edge["toNodeId"]) == nodeID {
			return BadAuthRequest("只能删除没有连线的节点：请先用 update_node 或重建节点的方式解除它的连线")
		}
	}
	if owner := cloudAgentNodeStructuredReference(doc, nodeID); owner != "" {
		return BadAuthRequest(fmt.Sprintf("节点「%s」正在引用它，不能删除", owner))
	}
	return nil
}

// cloudAgentNodeHasContent 判断节点是否已经有实际内容。标题不算内容：误建一个带标题的
// 空节点是最常见的场景，要求标题也为空会让这个工具失去意义。
func cloudAgentNodeHasContent(meta map[string]any) bool {
	for _, key := range []string{"content", "composerContent", "prompt", "storageKey"} {
		if text := stringValue(meta[key]); text != "" {
			return true
		}
	}
	return meta["status"] == "success" || meta["status"] == "generating"
}

// cloudAgentNodeStructuredReference 返回正在引用该节点的结构化节点名（没有则空）。
// 分镜行和批量创作表把媒体节点 ID 存在行里，删掉被引用的节点会留下悬空引用。
func cloudAgentNodeStructuredReference(doc map[string]any, nodeID string) string {
	for _, node := range creationMaps(doc["nodes"]) {
		meta, _ := node["metadata"].(map[string]any)
		rows := creationMaps(meta["rows"])
		if len(rows) == 0 {
			continue
		}
		for _, row := range rows {
			for _, key := range []string{"imageNodeId", "videoNodeId", "outputNodeId"} {
				if stringValue(row[key]) == nodeID {
					return cloudAgentReferencingNodeName(node)
				}
			}
			for _, id := range cloudAgentBatchInputIDs(row["inputNodeIds"], 6) {
				if stringValue(id) == nodeID {
					return cloudAgentReferencingNodeName(node)
				}
			}
			for _, binding := range creationMaps(row["assetBindings"]) {
				if stringValue(binding["nodeId"]) == nodeID {
					return cloudAgentReferencingNodeName(node)
				}
			}
		}
	}
	return ""
}

func cloudAgentReferencingNodeName(node map[string]any) string {
	if title := stringValue(node["title"]); title != "" {
		return title
	}
	return stringValue(node["id"])
}
