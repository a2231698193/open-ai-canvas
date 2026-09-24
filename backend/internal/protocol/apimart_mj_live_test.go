package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// Opt-in only：会产生一次付费 imagine 请求，且不打印任何凭据。默认跳过，
// 只有显式提供 key 时才运行：
//
//	CANVAS_APIMART_MJ_LIVE_KEY=sk-... go test ./internal/protocol/ -run TestAPIMartMJLiveImagine -count=1 -v -timeout 400s
func TestAPIMartMJLiveImagine(t *testing.T) {
	key := strings.TrimSpace(os.Getenv("CANVAS_APIMART_MJ_LIVE_KEY"))
	if key == "" {
		t.Skip("set CANVAS_APIMART_MJ_LIVE_KEY to run the live imagine check")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_APIMART_MJ_LIVE_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "https://api.apimart.ai"
	}
	ctx := context.Background()
	adapter := officialPackageAdapter(t, "apimart-mj.yingce-plugin", "apimart-mj")
	request := GenerationRequest{
		Model: "midjourney", Prompt: "a red apple on a wooden table, studio product photo", AspectRatio: "1:1",
		ProviderOptions: map[string]map[string]any{"apimart-mj": {"version": "8.2", "speed": "fast"}},
	}
	create, err := adapter.BuildCreate(ctx, RequestContext{BaseURL: baseURL, Request: request})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(create.Body)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("create %s %s body=%s", create.Method, create.Path, payload)

	created, err := adapter.ParseCreate(ctx, postJSON(t, key, baseURL+create.Path, payload))
	if err != nil {
		t.Fatal(err)
	}
	if created.TaskID == "" || created.Status != StatusPending {
		t.Fatalf("create result = %#v", created)
	}
	t.Logf("task=%s status=%s", created.TaskID, created.Status)
	for attempt := 0; attempt < 20; attempt++ {
		time.Sleep(10 * time.Second)
		poll, err := adapter.BuildPoll(ctx, PollContext{BaseURL: baseURL, Request: request, TaskID: created.TaskID})
		if err != nil {
			t.Fatal(err)
		}
		raw := getJSON(t, key, baseURL+poll.Path)
		result, err := adapter.ParsePoll(ctx, PollContext{TaskID: created.TaskID}, raw)
		if err != nil {
			t.Fatal(err)
		}
		images := 0
		if result.Result != nil {
			images = len(result.Result.Images)
		}
		t.Logf("poll %d status=%s images=%d message=%q", attempt+1, result.Status, images, result.Message)
		switch result.Status {
		case StatusSucceeded:
			if images == 0 {
				t.Fatalf("succeeded without images: %s", raw)
			}
			return
		case StatusFailed, StatusCancelled:
			t.Fatalf("task %s ended as %s: %s", created.TaskID, result.Status, raw)
		}
	}
	t.Fatalf("task %s did not reach a terminal state in the time budget", created.TaskID)
}

func postJSON(t *testing.T, key, url string, body []byte) []byte {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	return doRequest(t, req)
}

func getJSON(t *testing.T, key, url string) []byte {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	return doRequest(t, req)
}

func doRequest(t *testing.T, req *http.Request) []byte {
	t.Helper()
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		t.Fatalf("%s %s -> HTTP %d: %s", req.Method, req.URL.Path, resp.StatusCode, data)
	}
	return data
}
