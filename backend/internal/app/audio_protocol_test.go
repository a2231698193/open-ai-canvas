package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 端到端：宿主 canvasGenerationInput → lk888-audio 插件的 manifest 表达式 → 上游 /v1/media/generate 请求体。
//
// 只测插件适配器会漏掉"宿主有没有把值喂进 request.Extra"这一层：provider_protocol.go 曾经只塞
// audioVoice/audioFormat，漏了 audioSpeed/audioInstructions，结果插件里的语速映射永远拿不到值、
// 静默落回默认。所以这条用例必须从 canvasGenerationInput 进，而不是构造 protocol.GenerationRequest。
func TestLK888AudioTaskMapsHostAudioOptionsToUpstreamBody(t *testing.T) {
	allowLoopbackProviderTest(t)
	var createBody map[string]any
	pollCalls := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/media/generate":
			if err := json.NewDecoder(r.Body).Decode(&createBody); err != nil {
				t.Errorf("decode create body: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"task_id":123456},"msg":"任务创建成功"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/media/status":
			pollCalls++
			w.Header().Set("Content-Type", "application/json")
			// 结果地址指回测试服务器：宿主要把临时地址下载转存成账号资源，不能依赖外网域名。
			_, _ = w.Write([]byte(`{"task_id":123456,"state":"success","is_final":true,"result_url":"` + server.URL + `/voice.mp3","result_type":"audio"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/voice.mp3":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("fake-mp3"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := runAudioTask(protocolRegistryTestContext(t), canvasGenerationInput{
		Mode:   "audio",
		Prompt: "大家好，欢迎来到今天的节目。",
		Config: providerConfig{
			BaseURL: server.URL, APIKey: "test-key",
			InterfaceType: "lk888-audio", Model: "doubao-tts-2.0",
			AudioVoice: "zh_female_vv_uranus_bigtts", AudioFormat: "wav", AudioSpeed: "25", AudioInstructions: "温柔一点",
		},
	})
	if err != nil {
		t.Fatalf("runAudioTask() error = %v", err)
	}
	if pollCalls == 0 {
		t.Fatal("没有轮询上游任务状态")
	}
	if createBody["model"] != "doubao-tts-2.0" || !strings.Contains(stringValue(createBody["prompt"]), "欢迎来到今天的节目") {
		t.Fatalf("create body = %#v", createBody)
	}
	params, _ := createBody["params"].(map[string]any)
	// speech_rate 能拿到 "25" 才说明宿主把 audioSpeed 喂进了 Extra；voice_id/format 同理。
	if params["voice_id"] != "zh_female_vv_uranus_bigtts" || params["format"] != "wav" || params["speech_rate"] != "25" || params["emotion"] != "auto" {
		t.Fatalf("create params = %#v", params)
	}
	if _, exists := params["speaker"]; exists {
		t.Fatalf("默认不该发送 speaker：%#v", params)
	}
}
