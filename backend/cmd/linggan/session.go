package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type sessionFile struct {
	BaseURL  string `json:"baseUrl"`
	Cookie   string `json:"cookie"`
	CanvasID string `json:"canvasId,omitempty"`
	Username string `json:"username,omitempty"`
}

func sessionPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".linggan", "session.json"), nil
}

func loadSession() (sessionFile, error) {
	path, err := sessionPath()
	if err != nil {
		return sessionFile{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return sessionFile{}, errors.New("尚未登录，请先执行 linggan login --server <站点>")
		}
		return sessionFile{}, err
	}
	var session sessionFile
	if err := json.Unmarshal(raw, &session); err != nil {
		return sessionFile{}, errors.New("本机会话已损坏，请重新登录")
	}
	session.BaseURL = strings.TrimRight(strings.TrimSpace(session.BaseURL), "/")
	session.Cookie = strings.TrimSpace(session.Cookie)
	if session.BaseURL == "" || session.Cookie == "" {
		return sessionFile{}, errors.New("本机会话不完整，请重新登录")
	}
	return session, nil
}

func saveSession(session sessionFile) error {
	path, err := sessionPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o600)
}

func clearSession() error {
	path, err := sessionPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
