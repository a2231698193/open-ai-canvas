package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "login":
		err = cmdLogin(os.Args[2:])
	case "logout":
		err = cmdLogout()
	case "whoami":
		err = cmdWhoami()
	case "canvas":
		err = cmdCanvas(os.Args[2:])
	case "asset":
		err = cmdAsset(os.Args[2:])
	case "task":
		err = cmdTask(os.Args[2:])
	case "confirm":
		err = cmdConfirm(os.Args[2:])
	case "help", "-h", "--help":
		usage()
		return
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `linggan 是给外部 Agent 使用的灵感命令行。它不调用系统语言模型。

  linggan login --server <站点>
  linggan logout
  linggan whoami
  linggan canvas list
  linggan canvas create --title <名称>
  linggan canvas use <画布ID>
  linggan canvas state [--offset N] [--connection-offset N]
  linggan canvas apply --file <操作.json>
  linggan canvas tool <工具名> --file <参数.json>
  linggan asset upload --file <文件> [--kind image|video|audio]
  linggan task create --file <任务.json>
  linggan task get <任务ID>
  linggan confirm <确认编号>

在终端里直接运行生成命令时，输入 y 后立即提交。由 Agent 运行时不提交，先返回 needs_confirmation；用户在对话里同意后，Agent 再执行 linggan confirm。
`)
}

func cmdLogin(args []string) error {
	flags := flag.NewFlagSet("login", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	server := flags.String("server", os.Getenv("LINGGAN_API"), "站点地址")
	username := flags.String("username", "", "用户名")
	password := flags.String("password", "", "密码")
	if err := flags.Parse(args); err != nil {
		return err
	}
	client, err := newAPI(*server, "")
	if err != nil {
		return err
	}
	user := strings.TrimSpace(*username)
	pass := *password
	if user == "" {
		user, err = promptLine("用户名：")
		if err != nil {
			return err
		}
	}
	if pass == "" {
		fmt.Fprint(os.Stderr, "密码：")
		line, readErr := bufio.NewReader(os.Stdin).ReadString('\n')
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return readErr
		}
		pass = strings.TrimRight(line, "\r\n")
	}
	cookie, data, err := client.login(user, pass)
	if err != nil {
		return err
	}
	if err := saveSession(sessionFile{BaseURL: client.baseURL, Cookie: cookie, Username: user}); err != nil {
		return err
	}
	return printJSON(data)
}

func cmdLogout() error {
	session, err := loadSession()
	if err != nil {
		return clearSession()
	}
	client, err := newAPI(session.BaseURL, session.Cookie)
	if err == nil {
		_, _ = client.do("POST", "/auth/logout", strings.NewReader(`{}`), "application/json")
	}
	return clearSession()
}

func cmdWhoami() error {
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	data, err := client.do("GET", "/auth/session", nil, "")
	if err != nil {
		return err
	}
	return printJSON(data)
}

func cmdCanvas(args []string) error {
	if len(args) == 0 {
		return errors.New("用法：linggan canvas list|create|use|state|apply")
	}
	switch args[0] {
	case "list":
		client, _, err := authorizedClient()
		if err != nil {
			return err
		}
		data, err := client.do("GET", "/canvas-projects", nil, "")
		return finish(data, err)
	case "create":
		return canvasCreate(args[1:])
	case "use":
		return canvasUse(args[1:])
	case "state":
		return canvasState(args[1:])
	case "apply":
		return canvasApply(args[1:])
	case "tool":
		return canvasTool(args[1:])
	default:
		return errors.New("未知画布命令")
	}
}

func canvasCreate(args []string) error {
	flags := flag.NewFlagSet("canvas create", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	title := flags.String("title", "未命名画布", "画布名称")
	if err := flags.Parse(args); err != nil {
		return err
	}
	name := strings.TrimSpace(*title)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return errors.New("画布名称不能为空，且不能超过 120 个字符")
	}
	id, err := newCanvasID()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	project := map[string]any{
		"id": id, "revision": 0, "title": name, "createdAt": now, "updatedAt": now,
		"nodes": []any{}, "connections": []any{}, "chatSessions": []any{}, "activeChatId": nil,
		"showImageInfo": false, "viewport": map[string]any{"x": 0, "y": 0, "k": 1}, "directorScenes": []any{},
	}
	body, _ := json.Marshal(map[string]any{"project": project})
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	data, err := client.do("PUT", "/canvas-projects/"+urlPath(id), bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	session.CanvasID = id
	if err := saveSession(session); err != nil {
		return err
	}
	return printJSON(data)
}

func canvasUse(args []string) error {
	if len(args) != 1 || strings.HasPrefix(args[0], "-") {
		return errors.New("用法：linggan canvas use <画布ID>")
	}
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	data, err := client.do("GET", "/canvas-projects/"+urlPath(args[0]), nil, "")
	if err != nil {
		return err
	}
	session.CanvasID = args[0]
	if err := saveSession(session); err != nil {
		return err
	}
	return printJSON(data)
}

func canvasState(args []string) error {
	flags := flag.NewFlagSet("canvas state", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	offset := flags.Int("offset", 0, "分页起点")
	connectionOffset := flags.Int("connection-offset", 0, "连线分页起点")
	canvasID := flags.String("canvas", "", "画布 ID")
	if err := flags.Parse(args); err != nil {
		return err
	}
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	id := currentCanvas(*canvasID, session)
	if id == "" {
		return errors.New("还没有当前画布，请先 create 或 use")
	}
	data, err := client.do("GET", fmt.Sprintf("/cli/canvases/%s/state?offset=%d&connectionOffset=%d", urlPath(id), *offset, *connectionOffset), nil, "")
	return finish(data, err)
}

func canvasApply(args []string) error {
	flags := flag.NewFlagSet("canvas apply", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "操作 JSON 文件，- 表示标准输入")
	canvasID := flags.String("canvas", "", "画布 ID")
	if err := flags.Parse(args); err != nil {
		return err
	}
	raw, err := readInput(*file)
	if err != nil {
		return err
	}
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	id := currentCanvas(*canvasID, session)
	if id == "" {
		return errors.New("还没有当前画布，请先 create 或 use")
	}
	data, err := client.do("POST", "/cli/canvases/"+urlPath(id)+"/ops", bytes.NewReader(raw), "application/json")
	return finish(data, err)
}

func canvasTool(args []string) error {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") {
		return errors.New("用法：linggan canvas tool <工具名> --file <参数.json>")
	}
	tool := args[0]
	flags := flag.NewFlagSet("canvas tool", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "工具参数 JSON")
	canvasID := flags.String("canvas", "", "画布 ID")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	raw := []byte("{}")
	if strings.TrimSpace(*file) != "" {
		var err error
		raw, err = readInput(*file)
		if err != nil {
			return err
		}
	}
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	id := currentCanvas(*canvasID, session)
	if id == "" {
		return errors.New("还没有当前画布，请先 create 或 use")
	}
	if tool == "generate_media" || tool == "image_layer_split" {
		var request map[string]any
		if err := json.Unmarshal(raw, &request); err != nil {
			return errors.New("生成参数必须是一个 JSON 对象")
		}
		request["type"] = "canvas_" + stringify(request["mode"])
		request["operation"] = tool
		request["prompt"] = stringify(request["prompt"])
		request["canvasId"] = id
		request["model"] = stringify(request["logicalModelId"]) + stringify(request["channelModelKey"])
		// 报价复用服务端的准入链路：既给出金额，也在用户确认之前就把参数错误报出来，
		// 避免「确认完才发现提交不了」。算不出来不阻断确认，但要如实带进摘要。
		if quoteData, quoteErr := client.do("POST", "/cli/canvases/"+urlPath(id)+"/quote", bytes.NewReader(raw), "application/json"); quoteErr == nil {
			var quote map[string]any
			if json.Unmarshal(quoteData, &quote) == nil {
				for _, key := range []string{"estimatedCredits", "amountMicrocredits", "billingMode", "quantity"} {
					if value, exists := quote[key]; exists {
						request[key] = value
					}
				}
			}
		} else {
			request["estimateError"] = quoteErr.Error()
		}
		proceed, err := gateGeneration(request, pendingAction{Kind: "tool", CanvasID: id, Tool: tool, Body: raw, Summary: request})
		if err != nil || !proceed {
			return err
		}
	}
	data, err := client.do("POST", "/cli/canvases/"+urlPath(id)+"/tools/"+urlPath(tool), bytes.NewReader(raw), "application/json")
	return finish(data, err)
}

func stringify(value any) string {
	text, _ := value.(string)
	return text
}

func cmdAsset(args []string) error {
	if len(args) == 0 || args[0] != "upload" {
		return errors.New("用法：linggan asset upload --file <文件>")
	}
	flags := flag.NewFlagSet("asset upload", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "本地文件")
	kind := flags.String("kind", "", "image、video 或 audio")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if strings.TrimSpace(*file) == "" || *file == "-" {
		return errors.New("请用 --file 指定要上传的文件")
	}
	handle, err := os.Open(*file)
	if err != nil {
		return err
	}
	defer handle.Close()
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	data, err := client.upload("/resources", handle, filepath.Base(*file), strings.TrimSpace(*kind))
	return finish(data, err)
}

func cmdTask(args []string) error {
	if len(args) == 0 {
		return errors.New("用法：linggan task create|get")
	}
	switch args[0] {
	case "get":
		if len(args) != 2 {
			return errors.New("用法：linggan task get <任务ID>")
		}
		client, _, err := authorizedClient()
		if err != nil {
			return err
		}
		data, err := client.do("GET", "/tasks/"+urlPath(args[1]), nil, "")
		return finish(data, err)
	case "create":
		return taskCreate(args[1:])
	default:
		return errors.New("未知任务命令")
	}
}

func taskCreate(args []string) error {
	flags := flag.NewFlagSet("task create", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "任务 JSON 文件")
	canvasID := flags.String("canvas", "", "画布 ID")
	if err := flags.Parse(args); err != nil {
		return err
	}
	raw, err := readInput(*file)
	if err != nil {
		return err
	}
	var request map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return errors.New("任务文件必须是一个 JSON 对象")
	}
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	id := currentCanvas(*canvasID, session)
	if id == "" {
		return errors.New("还没有当前画布，请先 create 或 use")
	}
	if existing, _ := request["projectId"].(string); existing != "" && existing != id {
		return errors.New("任务里的 projectId 与当前画布不一致")
	}
	request["projectId"] = id
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	proceed, err := gateGeneration(request, pendingAction{Kind: "task", CanvasID: id, Body: body, Summary: request})
	if err != nil || !proceed {
		return err
	}
	data, err := client.do("POST", "/tasks", bytes.NewReader(body), "application/json")
	return finish(data, err)
}

func cmdConfirm(args []string) error {
	if len(args) != 1 || strings.HasPrefix(args[0], "-") {
		return errors.New("用法：linggan confirm <确认编号>")
	}
	action, err := loadPending(args[0])
	if err != nil {
		return err
	}
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	var data json.RawMessage
	switch action.Kind {
	case "tool":
		data, err = client.do("POST", "/cli/canvases/"+urlPath(action.CanvasID)+"/tools/"+urlPath(action.Tool), bytes.NewReader(action.Body), "application/json")
	case "task":
		data, err = client.do("POST", "/tasks", bytes.NewReader(action.Body), "application/json")
	default:
		return errors.New("待确认记录的类型无效")
	}
	if err != nil {
		return err
	}
	if err := deletePending(action.ID); err != nil {
		return err
	}
	return printJSON(data)
}

func authorizedClient() (apiClient, sessionFile, error) {
	session, err := loadSession()
	if err != nil {
		return apiClient{}, sessionFile{}, err
	}
	client, err := newAPI(session.BaseURL, session.Cookie)
	return client, session, err
}

func currentCanvas(flagValue string, session sessionFile) string {
	if strings.TrimSpace(flagValue) != "" {
		return strings.TrimSpace(flagValue)
	}
	return strings.TrimSpace(session.CanvasID)
}

func readInput(path string) ([]byte, error) {
	if path == "" {
		return nil, errors.New("请用 --file 指定 JSON 文件，或用 --file - 从标准输入读取")
	}
	if path == "-" {
		return io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	}
	return os.ReadFile(path)
}

func promptLine(label string) (string, error) {
	fmt.Fprint(os.Stderr, label)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	value := strings.TrimSpace(line)
	if value == "" {
		return "", errors.New("输入不能为空")
	}
	return value, nil
}

func newCanvasID() (string, error) {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "cli-" + hex.EncodeToString(raw[:]), nil
}

func urlPath(id string) string {
	return strings.ReplaceAll(id, "/", "%2F")
}

func shorten(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "…"
}

func finish(data json.RawMessage, err error) error {
	if err != nil {
		return err
	}
	return printJSON(data)
}

func printJSON(data json.RawMessage) error {
	if len(data) == 0 {
		data = []byte("null")
	}
	var decoded any
	if json.Unmarshal(data, &decoded) != nil {
		_, err := os.Stdout.Write(append(bytes.TrimSpace(data), '\n'))
		return err
	}
	encoded, err := json.MarshalIndent(decoded, "", "  ")
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(append(encoded, '\n'))
	return err
}
