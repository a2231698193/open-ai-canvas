package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/storage"
)

// nodeId 与 nodeIds 二选一：两个都填、都不填、超过上限都要在动手之前报错。
func TestCloudAgentInspectTargetsValidatesSelection(t *testing.T) {
	if _, _, err := cloudAgentInspectTargets(`{"nodeId":"a"}`, false); err != nil {
		t.Fatalf("nodeId 单选被拒：%v", err)
	}
	targets, refresh, err := cloudAgentInspectTargets(`{"nodeIds":["a","b","a"]}`, true)
	if err != nil || len(targets) != 2 || targets[0] != "a" || targets[1] != "b" || refresh {
		t.Fatalf("targets=%v refresh=%v err=%v", targets, refresh, err)
	}
	if _, _, err := cloudAgentInspectTargets(`{"nodeId":"a","nodeIds":["b"]}`, false); err == nil || !strings.Contains(err.Error(), "只能填一个") {
		t.Fatalf("同时传 nodeId 与 nodeIds 应被拒：%v", err)
	}
	if _, _, err := cloudAgentInspectTargets(`{}`, false); err == nil || !strings.Contains(err.Error(), "请提供 nodeId") {
		t.Fatalf("空选择应被拒：%v", err)
	}
	if _, _, err := cloudAgentInspectTargets(`{"nodeIds":["a"],"refresh":true}`, false); err == nil || !strings.Contains(err.Error(), "refresh") {
		t.Fatalf("不支持 refresh 的工具应拒绝该参数：%v", err)
	}
	ids := make([]string, 0, cloudAgentMaxInspectTargets+1)
	for index := 0; index <= cloudAgentMaxInspectTargets; index++ {
		ids = append(ids, string(rune('a'+index)))
	}
	if _, _, err := cloudAgentInspectTargets(`{"nodeIds":["`+strings.Join(ids, `","`)+`"]}`, false); err == nil || !strings.Contains(err.Error(), "一次最多") {
		t.Fatalf("超过上限应被拒：%v", err)
	}
	if _, _, err := cloudAgentInspectTargets(`{"nodeId":"   "}`, false); err == nil {
		t.Fatal("全是空白的节点ID应被拒")
	}
	if _, _, err := cloudAgentInspectTargets(`{"nodeId":"`+strings.Repeat("长", 81)+`"}`, false); err == nil {
		t.Fatal("超长节点ID应被拒")
	}
}

// canvas_inspect_media 只回事实：就绪的媒体给出时长与分辨率，没就绪的如实说明原因，
// 图片、视频、音频都认，非媒体节点直接拒绝。
func TestCloudAgentMediaInspectionReportsFactsWithoutMedia(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	for _, row := range []any{
		&model.Resource{ID: "video-res", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 720, Height: 1280, Size: 2048, DurationMs: 5000},
		&model.Resource{ID: "audio-res", UserID: "user", Kind: "audio", Status: "ready", MimeType: "audio/mpeg", Size: 512, DurationMs: 8000},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	doc := map[string]any{"nodes": []any{
		map[string]any{"id": "video-1", "type": "video", "title": "第一段", "metadata": map[string]any{"status": "success", "storageKey": "resource:video-res"}},
		map[string]any{"id": "audio-1", "type": "audio", "title": "配音", "metadata": map[string]any{"status": "success", "storageKey": "resource:audio-res"}},
		map[string]any{"id": "video-2", "type": "video", "title": "还没生成", "metadata": map[string]any{"status": "idle"}},
		map[string]any{"id": "note-1", "type": "text", "title": "剧本", "metadata": map[string]any{"content": "正文"}},
	}, "connections": []any{}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "facts-canvas", UserID: "user", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	call := func(arguments string) cloudAgentCall {
		var c cloudAgentCall
		c.ID, c.Function.Name, c.Function.Arguments = "call-1", "canvas_inspect_media", arguments
		return c
	}

	single, err := cloudAgentMediaInspection(s.repo, "user", "facts-canvas", call(`{"nodeId":"video-1"}`), false)
	if err != nil {
		t.Fatal(err)
	}
	facts, _ := single.(map[string]any)
	if facts["ready"] != true || facts["durationMs"] != int64(5000) || facts["width"] != 720 || facts["height"] != 1280 || facts["inputKind"] != "video" || facts["mimeType"] != "video/mp4" {
		t.Fatalf("视频事实不完整：%#v", facts)
	}
	if _, leaked := facts["storageKey"]; leaked {
		t.Fatalf("事实里不应带存储定位：%#v", facts)
	}
	if _, leaked := facts["imageUrl"]; leaked {
		t.Fatalf("读素材事实不应签发链接：%#v", facts)
	}

	batch, err := cloudAgentMediaInspection(s.repo, "user", "facts-canvas", call(`{"nodeIds":["video-1","audio-1","video-2"]}`), false)
	if err != nil {
		t.Fatal(err)
	}
	items, _ := batch.(map[string]any)["media"].([]any)
	if len(items) != 3 {
		t.Fatalf("批量读取条数不对：%#v", batch)
	}
	pending := items[2].(map[string]any)
	if pending["nodeId"] != "video-2" || pending["ready"] != false || stringValue(pending["issue"]) == "" {
		t.Fatalf("未就绪节点没有说明原因：%#v", pending)
	}
	if audio := items[1].(map[string]any); audio["durationMs"] != int64(8000) || audio["ready"] != true {
		t.Fatalf("音频事实不完整：%#v", audio)
	}

	if _, err := cloudAgentMediaInspection(s.repo, "user", "facts-canvas", call(`{"nodeId":"note-1"}`), false); err == nil || !strings.Contains(err.Error(), "不是媒体节点") {
		t.Fatalf("文本节点应被拒：%v", err)
	}
	if _, err := cloudAgentMediaInspection(s.repo, "user", "facts-canvas", call(`{"nodeId":"missing"}`), false); err == nil || !strings.Contains(err.Error(), "不在当前画布") {
		t.Fatalf("不存在的节点应被拒：%v", err)
	}
}

// 资源行里没有时长/分辨率时，本地原件要能现解析出来；远端存储不下载，
// 拿不到就如实留 0，绝不编造数字。
func TestCloudAgentMediaInspectionProbesLocalVideoFacts(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	dataDir := t.TempDir()
	s.dataDir = dataDir
	clip := metadataMP4(1000, 15000, 1280, 720, true)
	rel := filepath.Join("clips", "seg-1.mp4")
	local := filepath.Join(dataDir, "resources", filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(local, clip, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.Resource{ID: "video-local", UserID: "user", Kind: "video", Status: "ready", Provider: "local", MimeType: "video/mp4", Size: int64(len(clip)), ObjectKey: rel},
		&model.Resource{ID: "video-remote", UserID: "user", Kind: "video", Status: "ready", Provider: "s3", MimeType: "video/mp4", ObjectKey: rel},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	doc := map[string]any{"nodes": []any{
		map[string]any{"id": "video-local", "type": "video", "title": "本地原件", "metadata": map[string]any{"status": "success", "storageKey": "resource:video-local"}},
		map[string]any{"id": "video-remote", "type": "video", "title": "远端原件", "metadata": map[string]any{"status": "success", "storageKey": "resource:video-remote"}},
	}, "connections": []any{}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "probe-canvas", UserID: "user", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	call := func(arguments string) cloudAgentCall {
		var c cloudAgentCall
		c.ID, c.Function.Name, c.Function.Arguments = "call-1", "canvas_inspect_media", arguments
		return c
	}

	facts, err := cloudAgentMediaInspection(s.repo, "user", "probe-canvas", call(`{"nodeId":"video-local"}`), false, s)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := facts.(map[string]any)
	if got["durationMs"] != int64(15000) || got["width"] != int64(1280) || got["height"] != int64(720) || got["factsSource"] != "container" {
		t.Fatalf("本地视频事实没有现解析出来：%#v", got)
	}
	if _, leaked := got["factsIncomplete"]; leaked {
		t.Fatalf("解析成功后不该报事实不全：%#v", got)
	}

	// 远端存储不下载：如实标出这两个事实拿不到，而不是给一个假的 0。
	remote, err := cloudAgentMediaInspection(s.repo, "user", "probe-canvas", call(`{"nodeId":"video-remote"}`), false, s)
	if err != nil {
		t.Fatal(err)
	}
	remoteFacts, _ := remote.(map[string]any)
	if remoteFacts["durationMs"] != int64(0) || stringValue(remoteFacts["factsIncomplete"]) == "" {
		t.Fatalf("远端视频应当如实报告事实不全：%#v", remoteFacts)
	}
}

// 外部 Agent 拿不到服务端内联的字节，必须能自己取到媒体：命令行这条路要给图片、视频、
// 音频都签发短时链接；画布 Agent 那条路（withURL=false）只给事实，不把 URL 带进上下文。
func TestCLIMediaInspectionSignsResourceURLForVideo(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	// 用公开 CDN 方式签发：不需要 DNS，也不依赖服务器公网地址配置。
	settingJSON, err := json.Marshal(ossSettingValue{Enabled: true, Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", CDNBaseURL: "https://media.example.com", Bucket: "b", AccessKeyID: "id", AccessKeySecret: "secret", Delivery: storage.DeliverySettings{CDNAuthMode: "public"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Save(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}).Error; err != nil {
		t.Fatal(err)
	}
	clip := metadataMP4(1000, 12000, 1344, 768, true)
	// 资源行带上落盘时解析出的时长与分辨率（远端存储读取侧不再下载，事实来自资源行）。
	if err := db.Create(&model.Resource{ID: "clip-res", UserID: "user", Kind: "video", Status: "ready", Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "b", ObjectKey: "users/user/video/clip.mp4", MimeType: "video/mp4", Size: int64(len(clip)), Width: 1344, Height: 768, DurationMs: 12000}).Error; err != nil {
		t.Fatal(err)
	}
	doc := map[string]any{"nodes": []any{
		map[string]any{"id": "video-1", "type": "video", "title": "第 1 段", "metadata": map[string]any{"status": "success", "storageKey": "resource:clip-res"}},
	}, "connections": []any{}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "url-canvas", UserID: "user", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	var call cloudAgentCall
	call.ID, call.Function.Name, call.Function.Arguments = "call-1", "canvas_inspect_media", `{"nodeId":"video-1"}`

	// 命令行：带 resourceUrl
	withURL, err := cloudAgentMediaInspection(s.repo, "user", "url-canvas", call, true, s)
	if err != nil {
		t.Fatal(err)
	}
	cliFacts, _ := withURL.(map[string]any)
	url, _ := cliFacts["resourceUrl"].(string)
	if !strings.HasPrefix(url, "https://media.example.com/") || cliFacts["durationMs"] != int64(12000) || cliFacts["width"] != 1344 || cliFacts["ready"] != true {
		t.Fatalf("命令行读视频应当同时拿到链接与事实：%#v", cliFacts)
	}

	// 画布 Agent：只给事实
	agentFacts, err := cloudAgentMediaInspection(s.repo, "user", "url-canvas", call, false, s)
	if err != nil {
		t.Fatal(err)
	}
	if _, leaked := agentFacts.(map[string]any)["resourceUrl"]; leaked {
		t.Fatalf("画布 Agent 那条路不应带链接：%#v", agentFacts)
	}
}
