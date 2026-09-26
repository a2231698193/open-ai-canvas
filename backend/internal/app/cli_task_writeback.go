package app

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// cliGenerationWritebackKey 标记"没有 Agent 运行负责收尾"的生成任务。
//
// 浏览器生成的收尾在前端：任务成功后由页面把媒体落到节点再保存画布；画布 Agent 的收尾在
// Agent 运行的状态机里（advanceCloudAgentMedia）。命令行提交的任务两边都不沾——worker 把
// 任务跑完就结束，节点会一直停在 loading，外部 Agent 读 canvas state 或
// canvas_inspect_media 只能等到有人在浏览器里打开这张画布。这个标记让 worker 在任务终态时
// 补上那条缺失的收尾路径。
//
// 判据放在任务输入里：它随任务一起持久化，任务成功后 InputJSON 会被换成公开投影，而
// metadata 仍在保留字段里，标记不会丢。
const cliGenerationWritebackKey = "cliGenerationWriteback"

// markCLIGenerationWriteback 只由命令行生成路径调用。浏览器生成不带它，服务端因此不会去改
// 浏览器正在编辑的节点。
func markCLIGenerationWriteback(input map[string]any) {
	if input == nil {
		return
	}
	metadata, ok := input["metadata"].(map[string]any)
	if !ok {
		metadata = map[string]any{}
		input["metadata"] = metadata
	}
	metadata[cliGenerationWritebackKey] = true
}

// cliGenerationWritebackTarget 解析命令行任务绑定的目标节点；不是命令行任务时返回 false。
//
// 不回退到解密：标记和目标节点 ID 都不是敏感字段，即使输入里的渠道密钥被加密，这两个值
// 仍然是明文。解密依赖设置密钥，缺密钥时不该让回写静默失效。
func cliGenerationWritebackTarget(task *model.Task) (string, bool) {
	if task == nil || strings.TrimSpace(task.InputJSON) == "" || strings.TrimSpace(task.ProjectID) == "" {
		return "", false
	}
	var input struct {
		Metadata map[string]any `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
		return "", false
	}
	if marked, _ := input.Metadata[cliGenerationWritebackKey].(bool); !marked {
		return "", false
	}
	nodeID := strings.TrimSpace(stringValue(input.Metadata["nodeId"]))
	return nodeID, nodeID != ""
}

// completeCLIGenerationWriteback 把命令行生成任务的终态写回它绑定的画布节点，
// 让外部 Agent 不必等浏览器打开画布就能读到结果。写回口径与画布 Agent 完全复用同一条实现：
// 成功写媒体地址与尺寸，失败/取消写节点错误，绑定已变化时绝不覆盖别人的内容。
func (s *Service) completeCLIGenerationWriteback(task *model.Task) error {
	nodeID, ok := cliGenerationWritebackTarget(task)
	if !ok {
		return nil
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	_, err = completeCloudAgentMediaNode(s.repo, task.UserID, task.ProjectID, nodeID, task, policy)
	return err
}
