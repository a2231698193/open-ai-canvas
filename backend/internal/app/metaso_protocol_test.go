package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

// METASO 的 Base URL 只有域名，接口全部挂在 /api/minimax 这类非标准版本段下。
// 插件若不带 originPath，宿主会按 OpenAI 兼容规则补默认 /v1，拼出 .../v1/api/minimax/...。
func TestMetasoH3ProviderDeclaresOriginPaths(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var plugin *PluginView
	for _, item := range center.list() {
		if item.Manifest.ID == "metaso-h3" {
			copy := item
			plugin = &copy
		}
	}
	if plugin == nil || plugin.Status != "enabled" {
		t.Fatalf("official metaso-h3 plugin = %#v", plugin)
	}
	adapter, ok := center.registrySnapshot().Get("metaso-h3")
	if !ok {
		t.Fatal("metaso-h3 provider was not registered")
	}
	create, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocol.GenerationRequest{Model: "MiniMax-H3", Prompt: "a clip"}})
	if err != nil {
		t.Fatal(err)
	}
	if !create.OriginPath || create.Path != "/api/minimax/v2/video_generation" {
		t.Fatalf("metaso-h3 create spec = %#v", create)
	}
	poll, err := adapter.BuildPoll(context.Background(), protocol.PollContext{Model: "MiniMax-H3", TaskID: "task-1"})
	if err != nil {
		t.Fatal(err)
	}
	if !poll.OriginPath || poll.Path != "/api/minimax/v2/query/video_generation/task-1" {
		t.Fatalf("metaso-h3 poll spec = %#v", poll)
	}
}

// 端到端确认官方包走完 create -> poll -> 下载，且上游看到的路径不带 /v1。
func TestMetasoH3OfficialPackageKeepsChannelHost(t *testing.T) {
	allowLoopbackProviderTest(t)

	var paths []string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/minimax/v2/video_generation":
			_, _ = w.Write([]byte(`{"task_id":"task-1"}`))
		case "/api/minimax/v2/query/video_generation/task-1":
			_, _ = w.Write([]byte(`{"task":{"id":"task-1","status":"succeeded","content":{"url":"` + server.URL + `/media.mp4"}}}`))
		case "/media.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "mk-test", Model: "MiniMax-H3", APIFormat: "openai", InterfaceType: "metaso-h3"}
	ctx := protocolRegistryTestContext(t)
	adapter, ok := declarativeProtocolAdapterForContext(ctx, config.InterfaceType)
	if !ok {
		t.Fatal("metaso-h3 declarative adapter is unavailable")
	}
	result, err := runProtocolAdapterTaskWithPolicy(ctx, canvasGenerationInput{Mode: "video", Prompt: "a clip", Config: config}, adapter, fastVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"POST /api/minimax/v2/video_generation", "GET /api/minimax/v2/query/video_generation/task-1", "GET /media.mp4"}
	if len(paths) != len(want) {
		t.Fatalf("upstream paths = %v, want %v", paths, want)
	}
	for index := range want {
		if paths[index] != want[index] {
			t.Fatalf("upstream paths = %v, want %v", paths, want)
		}
	}
	if result["mode"] != "video" {
		t.Fatalf("result = %#v", result)
	}
}

// metaso 渠道只填域名：插件路径必须原样落到渠道主机上，不能被补成 /v1/api/minimax/...。
func TestMetasoH3RequestURLKeepsDomainBase(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	adapter, ok := center.registrySnapshot().Get("metaso-h3")
	if !ok {
		t.Fatal("metaso-h3 provider was not registered")
	}
	create, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocol.GenerationRequest{Model: "MiniMax-H3", Prompt: "a clip"}})
	if err != nil {
		t.Fatal(err)
	}
	requestURL, err := protocolRequestURL("https://metaso.cn", create)
	if err != nil {
		t.Fatal(err)
	}
	if requestURL != "https://metaso.cn/api/minimax/v2/video_generation" {
		t.Fatalf("request URL = %q", requestURL)
	}
}

func protocolRegistryTestContext(t *testing.T) context.Context {
	t.Helper()
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return withProtocolRegistry(context.Background(), center.registrySnapshot())
}
