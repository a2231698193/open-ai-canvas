package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func pendingTestHome(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

func writePendingFile(t *testing.T, action pendingAction) {
	t.Helper()
	dir, err := pendingDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	raw, err := json.MarshalIndent(action, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, action.ID+".json"), append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}

func pendingTestAction() pendingAction {
	return pendingAction{
		Kind: "tool", CanvasID: "canvas-1", Tool: "generate_media",
		Body:    json.RawMessage(`{"mode":"video"}`),
		Summary: map[string]any{"mode": "video", "estimatedCredits": float64(3)},
	}
}

func TestPendingConfirmationLifecycle(t *testing.T) {
	pendingTestHome(t)
	saved, err := savePending(pendingTestAction())
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || saved.ExpiresAt == "" {
		t.Fatalf("saved = %+v", saved)
	}
	deadline, err := time.Parse(time.RFC3339, saved.ExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if remaining := time.Until(deadline); remaining < pendingTTL-time.Minute || remaining > pendingTTL {
		t.Fatalf("有效期不是 %s：%s", pendingTTL, remaining)
	}
	loaded, err := loadPending(saved.ID)
	if err != nil || loaded.Tool != "generate_media" {
		t.Fatalf("loaded = %+v, err = %v", loaded, err)
	}
	var body map[string]any
	if err := json.Unmarshal(loaded.Body, &body); err != nil || body["mode"] != "video" {
		t.Fatalf("请求体丢失：%s, %v", loaded.Body, err)
	}
	if loaded.Summary["estimatedCredits"] != float64(3) {
		t.Fatalf("摘要丢失：%#v", loaded.Summary)
	}
	actions, err := listPendingConfirmations()
	if err != nil || len(actions) != 1 || actions[0].ID != saved.ID {
		t.Fatalf("list = %#v, err = %v", actions, err)
	}
	if err := cancelPendingConfirmation(saved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := loadPending(saved.ID); err == nil || !strings.Contains(err.Error(), "已经提交或已取消") {
		t.Fatalf("取消后仍可读取：%v", err)
	}
	actions, err = listPendingConfirmations()
	if err != nil || len(actions) != 0 {
		t.Fatalf("取消后仍有待确认：%#v, %v", actions, err)
	}
	if err := cancelPendingConfirmation(saved.ID); err == nil {
		t.Fatal("重复取消没有报错")
	}
}

// 过期草稿必须作废并清理：画布和价格都可能已经变了。
func TestPendingConfirmationExpiresAndIsPruned(t *testing.T) {
	pendingTestHome(t)
	expired := pendingTestAction()
	expired.ID = "expired-one"
	expired.CreatedAt = time.Now().UTC().Add(-2 * pendingTTL).Format(time.RFC3339)
	expired.ExpiresAt = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
	writePendingFile(t, expired)
	// 早期版本留下的记录没有 expiresAt，按创建时间推算。
	legacy := pendingTestAction()
	legacy.ID = "legacy-one"
	legacy.CreatedAt = time.Now().UTC().Add(-2 * pendingTTL).Format(time.RFC3339)
	writePendingFile(t, legacy)

	fresh, err := savePending(pendingTestAction())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := loadPending(expired.ID); err == nil || !strings.Contains(err.Error(), "有效期") {
		t.Fatalf("过期记录没有作废：%v", err)
	}
	if _, err := loadPending(legacy.ID); err == nil || !strings.Contains(err.Error(), "有效期") {
		t.Fatalf("早期记录没有按创建时间作废：%v", err)
	}
	for _, id := range []string{expired.ID, legacy.ID} {
		if _, err := os.Stat(filepath.Join(mustPendingDir(t), id+".json")); !os.IsNotExist(err) {
			t.Fatalf("%s 没有被清理：%v", id, err)
		}
	}
	actions, err := listPendingConfirmations()
	if err != nil || len(actions) != 1 || actions[0].ID != fresh.ID {
		t.Fatalf("list = %#v, err = %v", actions, err)
	}
}

func mustPendingDir(t *testing.T) string {
	t.Helper()
	dir, err := pendingDir()
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestConfirmAcceptsListAndCancelFlags(t *testing.T) {
	pendingTestHome(t)
	if err := cmdConfirm([]string{"--list"}); err != nil {
		t.Fatalf("--list 失败：%v", err)
	}
	saved, err := savePending(pendingTestAction())
	if err != nil {
		t.Fatal(err)
	}
	if err := cmdConfirm([]string{"--cancel", saved.ID}); err != nil {
		t.Fatalf("--cancel 失败：%v", err)
	}
	if _, err := loadPending(saved.ID); err == nil {
		t.Fatal("--cancel 没有删除草稿")
	}
	for _, args := range [][]string{{}, {"--list", "extra"}, {"--cancel"}, {"-x"}, {"a", "b"}} {
		if err := cmdConfirm(args); err == nil || !strings.Contains(err.Error(), "用法") {
			t.Fatalf("args %v 应当回用法：%v", args, err)
		}
	}
}
