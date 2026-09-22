package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const sessionCookieName = "open_ai_canvas_session"

type apiClient struct {
	baseURL string
	cookie  string
	http    *http.Client
}

func newAPI(baseURL, cookie string) (apiClient, error) {
	normalized, err := normalizeAPI(baseURL)
	if err != nil {
		return apiClient{}, err
	}
	return apiClient{baseURL: normalized, cookie: cookie, http: &http.Client{Timeout: 2 * time.Minute}}, nil
}

func normalizeAPI(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("缺少站点地址，请使用 --server 或 LINGGAN_API")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return "", errors.New("站点地址必须是 http 或 https URL")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	path := strings.TrimRight(parsed.Path, "/")
	if path == "" {
		path = "/api"
	}
	parsed.Path = path
	return parsed.String(), nil
}

func (c apiClient) do(method, path string, body io.Reader, contentType string) (json.RawMessage, error) {
	request, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	if c.cookie != "" {
		request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: c.cookie})
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Code   int             `json:"code"`
		Data   json.RawMessage `json:"data"`
		Msg    string          `json:"msg"`
		Reason string          `json:"reason"`
	}
	if json.Unmarshal(payload, &envelope) != nil {
		return nil, fmt.Errorf("服务器返回了无法识别的响应（HTTP %d）", response.StatusCode)
	}
	if response.StatusCode >= 300 || envelope.Code != 0 {
		message := strings.TrimSpace(envelope.Msg)
		if message == "" {
			message = "请求失败"
		}
		return nil, errors.New(message)
	}
	return envelope.Data, nil
}

func (c apiClient) login(username, password string) (string, json.RawMessage, error) {
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	request, err := http.NewRequest(http.MethodPost, c.baseURL+"/auth/login", bytes.NewReader(body))
	if err != nil {
		return "", nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return "", nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", nil, err
	}
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if json.Unmarshal(payload, &envelope) != nil {
		return "", nil, fmt.Errorf("登录响应无法识别（HTTP %d）", response.StatusCode)
	}
	if response.StatusCode >= 300 || envelope.Code != 0 {
		message := strings.TrimSpace(envelope.Msg)
		if message == "" {
			message = "登录失败"
		}
		return "", nil, errors.New(message)
	}
	for _, cookie := range response.Cookies() {
		if cookie.Name == sessionCookieName && cookie.Value != "" {
			return cookie.Value, envelope.Data, nil
		}
	}
	return "", nil, errors.New("登录成功但服务器没有返回会话")
}

func (c apiClient) upload(path string, file io.Reader, filename, kind string) (json.RawMessage, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, err
	}
	if kind != "" {
		if err := writer.WriteField("kind", kind); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return c.do(http.MethodPost, path, &body, writer.FormDataContentType())
}
