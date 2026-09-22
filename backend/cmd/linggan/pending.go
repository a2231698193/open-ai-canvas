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
	"strings"
	"time"
)

type pendingAction struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	CanvasID  string          `json:"canvasId"`
	Tool      string          `json:"tool,omitempty"`
	Body      json.RawMessage `json:"body"`
	Summary   map[string]any  `json:"summary"`
	CreatedAt string          `json:"createdAt"`
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
	id, err := savePending(action)
	if err != nil {
		return false, err
	}
	return false, printJSON(mustJSON(map[string]any{
		"status":         "needs_confirmation",
		"confirmationId": id,
		"summary":        summary,
		"nextCommand":    "linggan confirm " + id,
		"instruction":    "先把摘要告诉用户并询问是否提交。用户明确同意后，再执行 nextCommand。用户未同意前不要执行。",
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
	for _, key := range []string{"canvasId", "projectId", "type", "operation", "videoEditOperation", "mode", "logicalModelId", "model", "prompt"} {
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

func savePending(action pendingAction) (string, error) {
	id, err := randomID()
	if err != nil {
		return "", err
	}
	action.ID = id
	action.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	dir, err := pendingDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(action, "", "  ")
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, id+".json")
	if err := os.WriteFile(path, append(raw, '\n'), 0o600); err != nil {
		return "", err
	}
	return id, nil
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
	return action, nil
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
