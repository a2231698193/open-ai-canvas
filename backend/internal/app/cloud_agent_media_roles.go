package app

import (
	"fmt"
	"strings"
)

// 参考素材角色。取值与模型目录里的 references.imageRoles 一致，
// 这样调用方从 model_list 看到的角色名可以直接回填到 generate_media。
const (
	cloudAgentReferenceRoleImage      = "reference_image"
	cloudAgentReferenceRoleFirstFrame = "first_frame"
	cloudAgentReferenceRoleLastFrame  = "last_frame"
)

var cloudAgentReferenceRoleNames = []string{cloudAgentReferenceRoleFirstFrame, cloudAgentReferenceRoleImage, cloudAgentReferenceRoleLastFrame}

// cloudAgentReferenceBindingRoles 把对外角色名映射成契约里的 binding role。
// 契约用的是连字符写法；两套词汇各自服务于模型目录与生成合同，这里只做一次转换。
var cloudAgentReferenceBindingRoles = map[string]string{
	cloudAgentReferenceRoleImage:      "reference",
	cloudAgentReferenceRoleFirstFrame: "first-frame",
	cloudAgentReferenceRoleLastFrame:  "last-frame",
}

type cloudAgentMediaReference struct {
	NodeID string `json:"nodeId"`
	Role   string `json:"role"`
}

// normalizeCloudAgentMediaReferences 把带角色的 references 归一到既有的有序节点列表，
// 并记下每个节点的角色。只传 referenceNodeIds 时保持原样：那条路径靠 videoEditOperation 推导角色。
func normalizeCloudAgentMediaReferences(a *cloudAgentMediaArgs) error {
	if len(a.References) == 0 {
		return nil
	}
	if len(a.ReferenceNodeIDs) > 0 {
		return BadAuthRequest("references 与 referenceNodeIds 只能填一个：references 自带顺序和角色")
	}
	roles := map[string]string{}
	ids := make([]string, 0, len(a.References))
	for index, item := range a.References {
		if err := validateCloudAgentID(strings.TrimSpace(item.NodeID), fmt.Sprintf("references[%d].nodeId", index), 80); err != nil {
			return BadAuthRequest(err.Error())
		}
		nodeID := strings.TrimSpace(item.NodeID)
		role, err := cloudAgentReferenceRoleName(item.Role)
		if err != nil {
			return BadAuthRequest(fmt.Sprintf("references[%d].role %s", index, err.Error()))
		}
		if _, exists := roles[nodeID]; exists {
			return BadAuthRequest(fmt.Sprintf("references 里节点 %s 出现了多次", nodeID))
		}
		roles[nodeID] = role
		ids = append(ids, nodeID)
	}
	// 首尾帧各只能有一个：同一段视频不可能有两个首帧。
	for _, role := range []string{cloudAgentReferenceRoleFirstFrame, cloudAgentReferenceRoleLastFrame} {
		count := 0
		for _, assigned := range roles {
			if assigned == role {
				count++
			}
		}
		if count > 1 {
			return BadAuthRequest(fmt.Sprintf("references 里 %s 只能有一个", role))
		}
	}
	if cloudAgentRoleNodeID(roles, cloudAgentReferenceRoleLastFrame) != "" && cloudAgentRoleNodeID(roles, cloudAgentReferenceRoleFirstFrame) == "" {
		return BadAuthRequest("填了 last_frame 就必须同时指定 first_frame")
	}
	a.ReferenceNodeIDs = ids
	a.ReferenceRoles = roles
	return nil
}

func cloudAgentReferenceRoleName(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case cloudAgentReferenceRoleImage, "reference":
		return cloudAgentReferenceRoleImage, nil
	case cloudAgentReferenceRoleFirstFrame, "first-frame":
		return cloudAgentReferenceRoleFirstFrame, nil
	case cloudAgentReferenceRoleLastFrame, "last-frame":
		return cloudAgentReferenceRoleLastFrame, nil
	case "":
		return cloudAgentReferenceRoleImage, nil
	default:
		return "", fmt.Errorf("无效；可用取值：%s（reference 等同于 reference_image）", strings.Join(cloudAgentReferenceRoleNames, "、"))
	}
}

func cloudAgentRoleNodeID(roles map[string]string, target string) string {
	for nodeID, role := range roles {
		if role == target {
			return nodeID
		}
	}
	return ""
}

// validateCloudAgentReferenceRoles 确认首尾帧指向的是图片素材：角色只对图片有意义，
// 落在视频或音频节点上会让上游收到一个它读不懂的帧。
func validateCloudAgentReferenceRoles(a cloudAgentMediaArgs, refs map[string]any) error {
	if len(a.ReferenceRoles) == 0 {
		return nil
	}
	imageIDs := map[string]bool{}
	for _, ref := range creationMaps(refs["referenceImages"]) {
		imageIDs[stringValue(ref["id"])] = true
	}
	for _, role := range []string{cloudAgentReferenceRoleFirstFrame, cloudAgentReferenceRoleLastFrame} {
		if nodeID := cloudAgentRoleNodeID(a.ReferenceRoles, role); nodeID != "" && !imageIDs[nodeID] {
			return BadAuthRequest(fmt.Sprintf("%s 只能指向图片节点：%s 不是本次请求里的图片参考", role, nodeID))
		}
	}
	return nil
}

// cloudAgentVideoRoleMetadata 把显式角色投影成服务端既有的视频元数据键。
// 浏览器侧就是用这几个键表达首尾帧的，这里不另造通道，路由与供应商适配都不用改。
func cloudAgentVideoRoleMetadata(a cloudAgentMediaArgs) map[string]any {
	if a.Mode != "video" || len(a.ReferenceRoles) == 0 {
		return nil
	}
	metadata := map[string]any{}
	start, end := cloudAgentRoleNodeID(a.ReferenceRoles, cloudAgentReferenceRoleFirstFrame), cloudAgentRoleNodeID(a.ReferenceRoles, cloudAgentReferenceRoleLastFrame)
	switch {
	case end != "":
		metadata["videoMode"] = "keyframes"
	case start != "":
		metadata["videoMode"] = "image"
	default:
		metadata["videoMode"] = "reference"
	}
	if start != "" {
		metadata["videoStartFrameNodeId"] = start
	}
	if end != "" {
		metadata["videoEndFrameNodeId"] = end
	}
	return metadata
}
