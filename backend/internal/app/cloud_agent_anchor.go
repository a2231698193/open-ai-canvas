package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// The anchor records the current request and observable reference candidates.
// It does not infer creative permissions or carry an old goal into a new turn.
type cloudAgentCreativeAnchor struct {
	Version          int                         `json:"version"`
	UserPrompt       string                      `json:"userPrompt"`
	ReferenceNodeIDs []string                    `json:"referenceNodeIds,omitempty"`
	ReferenceAssets  []cloudAgentReferenceAnchor `json:"referenceAssets,omitempty"`
}

// cloudAgentAnchorPromptLimit 是素材锚点里提示词摘要的上限。锚点每一轮都会发出去，
// 所以这里只留够"认得这条素材"的长度；需要全文时按节点精读（上限 16000 字符）。
const cloudAgentAnchorPromptLimit = 1000

type cloudAgentReferenceAnchor struct {
	NodeID                   string   `json:"nodeId"`
	Type                     string   `json:"type"`
	Title                    string   `json:"title,omitempty"`
	Prompt                   string   `json:"prompt,omitempty"`
	AssetTags                []string `json:"assetTags,omitempty"`
	ReferenceReady           bool     `json:"referenceReady"`
	VisualIdentity           string   `json:"visualIdentity"`
	RequiresVisualInspection bool     `json:"requiresVisualInspection"`
	// PromptTruncated 明确告诉模型这里的提示词不是全文：它只是素材锚点的摘要，
	// 想照着旧提示词改写必须先按节点精读，不能把截断当全文照抄。
	PromptTruncated bool `json:"promptTruncated,omitempty"`
	// 旧检查点可能含有未经确认的正文摘录，不再自动写入或跨轮继承。
	VisualNote string `json:"visualNote,omitempty"`
	Width      any    `json:"width,omitempty"`
	Height     any    `json:"height,omitempty"`
}

// cloudAgentCreativeAnchorForCanvas 按当前画布重建候选素材锚点。
// 不继承旧视觉标记：工具成功和下一段正文都不是识别成功的可靠证据，节点也可能换图。
func cloudAgentCreativeAnchorForCanvas(repo *repository.Repository, userID string, canvas *model.CanvasProject, prompt string, _ *cloudAgentCreativeAnchor) (cloudAgentCreativeAnchor, error) {
	anchor := cloudAgentCreativeAnchor{Version: 2, UserPrompt: prompt}

	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return cloudAgentCreativeAnchor{}, BadAuthRequest("服务端画布内容无法解析，请先重新同步")
	}
	nodes := creationMaps(doc["nodes"])
	byID := make(map[string]map[string]any, len(nodes))
	for _, node := range nodes {
		if id := stringValue(node["id"]); id != "" {
			byID[id] = node
		}
	}

	ids := make([]string, 0, 16)
	for _, node := range nodes {
		descriptor, known := cloudAgentNodeCapabilityForType(stringValue(node["type"]))
		if known && descriptor.Connection.CanReference {
			ids = append(ids, stringValue(node["id"]))
		}
		if len(ids) == 16 {
			break
		}
	}
	for _, id := range ids {
		if id == "" || byID[id] == nil {
			continue
		}
		node := byID[id]
		descriptor, known := cloudAgentNodeCapabilityForType(stringValue(node["type"]))
		if !known || !descriptor.Connection.CanReference {
			continue
		}
		meta, _ := node["metadata"].(map[string]any)
		prompt := firstNonEmpty(stringValue(meta["prompt"]), stringValue(meta["composerContent"]))
		item := cloudAgentReferenceAnchor{
			NodeID: stringValue(node["id"]), Type: stringValue(node["type"]),
			Title:          truncateRunes(stringValue(node["title"]), 300),
			Prompt:         truncateRunes(prompt, cloudAgentAnchorPromptLimit),
			VisualIdentity: "unknown", RequiresVisualInspection: true,
		}
		item.PromptTruncated = len([]rune(prompt)) > cloudAgentAnchorPromptLimit
		if tags, ok := meta["assetTags"].([]any); ok {
			for _, tag := range tags {
				if text := strings.TrimSpace(stringValue(tag)); text != "" {
					item.AssetTags = append(item.AssetTags, truncateRunes(text, 120))
				}
			}
		}
		if repo != nil {
			ref, _, refErr := cloudAgentReference(repo, userID, node)
			if refErr == nil {
				item.ReferenceReady = true
				item.Width, item.Height = ref["width"], ref["height"]
			}
		}
		anchor.ReferenceNodeIDs = append(anchor.ReferenceNodeIDs, item.NodeID)
		anchor.ReferenceAssets = append(anchor.ReferenceAssets, item)
		if len(anchor.ReferenceAssets) == 16 {
			break
		}
	}
	return anchor, nil
}
