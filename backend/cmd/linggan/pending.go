package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// 待确认内容只是本地草稿：画布、参数和价格都可能在这之后变化，过期就必须重新执行生成
// 命令重新报价，不能拿旧草稿提交。
const pendingTTL = 30 * time.Minute

type pendingAction struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	CanvasID  string          `json:"canvasId"`
	Tool      string          `json:"tool,omitempty"`
	Body      json.RawMessage `json:"body"`
	Summary   map[string]any  `json:"summary"`
	CreatedAt string          `json:"createdAt"`
	ExpiresAt string          `json:"expiresAt"`
}

func userTerminal() (*os.File, error) {
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	info, err := tty.Stat()
	if err != nil || info.Mode()&os.ModeCharDevice == 0 {
		tty.Close()
		return nil, errors.New("不是终端")
	}
	return tty, nil
}

func gateGeneration(summary map[string]any, action pendingAction) (bool, error) {
	if tty, err := userTerminal(); err == nil {
		defer tty.Close()
		return true, confirmOnTerminal(tty, summary)
	}
	saved, err := savePending(action)
	if err != nil {
		return false, err
	}
	return false, printJSON(mustJSON(map[string]any{
		"status":           "needs_confirmation",
		"confirmationId":   saved.ID,
		"createdAt":        saved.CreatedAt,
		"expiresAt":        saved.ExpiresAt,
		"expiresInSeconds": int(pendingTTL.Seconds()),
		"summary":          summary,
		"nextCommand":      "linggan confirm " + saved.ID,
		"cancelCommand":    "linggan confirm --cancel " + saved.ID,
		"listCommand":      "linggan confirm --list",
		"instruction":      "先把摘要告诉用户并询问是否提交。用户明确同意后，再执行 nextCommand。用户未同意前不要执行；超过 expiresAt 这条确认作废，需要重新执行生成命令。",
	}))
}

func bufioReadLine(tty io.Reader) (string, error) {
	line, err := bufio.NewReader(tty).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return strings.TrimSpace(strings.ToLower(line)), nil
}

func confirmOnTerminal(tty *os.File, summary map[string]any) error {
	fmt.Fprintln(tty, "即将提交生成，确认后会计入当前账号积分：")
	for _, key := range []string{"canvasId", "projectId", "type", "operation", "videoEditOperation", "mode", "logicalModelId", "model", "estimatedCredits", "estimateError", "prompt"} {
		value := stringify(summary[key])
		if value == "" {
			continue
		}
		fmt.Fprintf(tty, "  %s：%s\n", key, shorten(value, 500))
	}
	fmt.Fprint(tty, "确认提交？输入 y 后回车，其他输入都会取消：")
	line, err := bufioReadLine(tty)
	if err != nil {
		return err
	}
	if line != "y" {
		return errors.New("未确认，生成未提交")
	}
	return nil
}

func savePending(action pendingAction) (pendingAction, error) {
	id, err := randomID()
	if err != nil {
		return pendingAction{}, err
	}
	now := time.Now().UTC()
	action.ID = id
	action.CreatedAt = now.Format(time.RFC3339)
	action.ExpiresAt = now.Add(pendingTTL).Format(time.RFC3339)
	dir, err := pendingDir()
	if err != nil {
		return pendingAction{}, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return pendingAction{}, err
	}
	raw, err := json.MarshalIndent(action, "", "  ")
	if err != nil {
		return pendingAction{}, err
	}
	path := filepath.Join(dir, id+".json")
	if err := os.WriteFile(path, append(raw, '\n'), 0o600); err != nil {
		return pendingAction{}, err
	}
	return action, nil
}

// pendingDeadline 兼容早期没有 expiresAt 的记录：按创建时间加有效期推算。两者都读不出来
// 时视为已过期，宁可让用户重跑一次生成，也不提交一份来历不明的草稿。
func pendingDeadline(action pendingAction) time.Time {
	if action.ExpiresAt != "" {
		if deadline, err := time.Parse(time.RFC3339, action.ExpiresAt); err == nil {
			return deadline
		}
	}
	if action.CreatedAt != "" {
		if created, err := time.Parse(time.RFC3339, action.CreatedAt); err == nil {
			return created.Add(pendingTTL)
		}
	}
	return time.Time{}
}

func pendingExpired(action pendingAction) bool {
	deadline := pendingDeadline(action)
	return deadline.IsZero() || !time.Now().UTC().Before(deadline)
}

func loadPending(id string) (pendingAction, error) {
	if id == "" || id != filepath.Base(id) || len(id) > 80 {
		return pendingAction{}, errors.New("确认编号无效")
	}
	dir, err := pendingDir()
	if err != nil {
		return pendingAction{}, err
	}
	raw, err := os.ReadFile(filepath.Join(dir, id+".json"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return pendingAction{}, errors.New("没有这条待确认生成，可能已经提交或已取消")
		}
		return pendingAction{}, err
	}
	var action pendingAction
	if err := json.Unmarshal(raw, &action); err != nil {
		return pendingAction{}, errors.New("待确认记录已损坏")
	}
	if pendingExpired(action) {
		_ = deletePending(action.ID)
		return pendingAction{}, fmt.Errorf("这条确认已超过 %d 分钟有效期，草稿已作废；请重新执行生成命令", int(pendingTTL.Minutes()))
	}
	return action, nil
}

// listPendingConfirmations 列出仍然有效的待确认生成，顺便清掉过期记录。
func listPendingConfirmations() ([]pendingAction, error) {
	dir, err := pendingDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []pendingAction{}, nil
		}
		return nil, err
	}
	actions := []pendingAction{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		action, err := loadPending(strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil {
			continue
		}
		actions = append(actions, action)
	}
	sort.Slice(actions, func(i, j int) bool { return actions[i].CreatedAt < actions[j].CreatedAt })
	return actions, nil
}

func cancelPendingConfirmation(id string) error {
	action, err := loadPending(id)
	if err != nil {
		return err
	}
	if err := deletePending(action.ID); err != nil {
		return err
	}
	return printJSON(mustJSON(map[string]any{
		"status":         "cancelled",
		"confirmationId": action.ID,
		"instruction":    "这条待确认生成已取消，没有创建任务、没有扣费。需要重新生成时重新执行生成命令。",
	}))
}

func printPendingConfirmations(actions []pendingAction) error {
	views := make([]map[string]any, 0, len(actions))
	for _, action := range actions {
		views = append(views, map[string]any{
			"confirmationId": action.ID,
			"kind":           action.Kind,
			"canvasId":       action.CanvasID,
			"tool":           action.Tool,
			"createdAt":      action.CreatedAt,
			"expiresAt":      action.ExpiresAt,
			"summary":        action.Summary,
			"nextCommand":    "linggan confirm " + action.ID,
			"cancelCommand":  "linggan confirm --cancel " + action.ID,
		})
	}
	return printJSON(mustJSON(map[string]any{"pendingConfirmations": views, "total": len(views)}))
}

func deletePending(id string) error {
	dir, err := pendingDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func pendingDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".linggan", "pending"), nil
}

func randomID() (string, error) {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func mustJSON(value any) json.RawMessage {
	raw, err := json.Marshal(value)
	if err != nil {
		return []byte(`{}`)
	}
	return raw
}
