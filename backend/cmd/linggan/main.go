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

// version 由发布流水线通过 -ldflags "-X main.version=<tag>" 注入；本地构建显示 dev。
var version = "dev"

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
	case "batch":
		err = cmdBatch(os.Args[2:])
	case "wallet":
		err = cmdWallet(os.Args[2:])
	case "confirm":
		err = cmdConfirm(os.Args[2:])
	case "version":
		fmt.Println("linggan " + version)
		return
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
  linggan asset list [--kind image|video|audio] [--query <关键词>] [--limit N]
  linggan task create --file <任务.json>
  linggan task get <任务ID>
  linggan task list [--canvas <画布ID>] [--active] [--limit N]
  linggan task wait <任务ID> [--timeout 秒] [--interval 秒]
  linggan batch generate --file <请求.json> | --from-batch-table <节点ID> --model <模型> --size <比例>
  linggan wallet [--entries N]
  linggan confirm <确认编号>
  linggan confirm --all [--max-credits N] [--canvas <画布ID>]
  linggan confirm --list
  linggan confirm --cancel <确认编号>
  linggan version

在终端里直接运行生成命令时，输入 y 后立即提交。由 Agent 运行时不提交，先返回 needs_confirmation；用户在对话里同意后，Agent 再执行 linggan confirm。批量生成用 linggan batch generate，整批确认用 linggan confirm --all --max-credits <预算>，超预算的留在挂起列表。待确认生成保留 30 分钟，过期作废；用 linggan confirm --list 查看，用 linggan confirm --cancel 取消。
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
		action, err := prepareMediaPending(client, id, tool, raw)
		if err != nil {
			return err
		}
		proceed, err := gateGeneration(action.Summary, action)
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
	if len(args) == 0 {
		return errors.New("用法：linggan asset upload --file <文件> | linggan asset list")
	}
	switch args[0] {
	case "upload":
		return assetUpload(args[1:])
	case "list":
		return assetList(args[1:])
	default:
		return errors.New("未知素材命令")
	}
}

func assetUpload(args []string) error {
	flags := flag.NewFlagSet("asset upload", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "本地文件")
	kind := flags.String("kind", "", "image、video 或 audio")
	if err := flags.Parse(args); err != nil {
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

// assetList 列出账号资源库。服务端只有 pageSize 参数，类型与关键词过滤在本机做：
// 资源库是上传产物，规模有限，不值得为它加一次服务端查询面。
func assetList(args []string) error {
	flags := flag.NewFlagSet("asset list", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	kind := flags.String("kind", "", "image、video 或 audio")
	query := flags.String("query", "", "按文件名关键词过滤")
	limit := flags.Int("limit", 200, "最多拉取的资源数")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *limit < 1 || *limit > 1000 {
		return errors.New("--limit 必须在 1 到 1000 之间")
	}
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	data, err := client.do("GET", fmt.Sprintf("/resources?pageSize=%d", *limit), nil, "")
	if err != nil {
		return err
	}
	var payload struct {
		Resources []map[string]any `json:"resources"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return errors.New("资源列表格式无效")
	}
	kindFilter := strings.ToLower(strings.TrimSpace(*kind))
	keyword := strings.ToLower(strings.TrimSpace(*query))
	matched := []map[string]any{}
	for _, resource := range payload.Resources {
		if kindFilter != "" {
			kind := strings.ToLower(stringify(resource["kind"]))
			if kind == "" {
				kind = strings.SplitN(strings.ToLower(stringify(resource["mimeType"])), "/", 2)[0]
			}
			if kind != kindFilter {
				continue
			}
		}
		if keyword != "" {
			name := strings.ToLower(stringify(resource["fileName"]) + " " + stringify(resource["objectKey"]))
			if !strings.Contains(name, keyword) {
				continue
			}
		}
		matched = append(matched, resource)
	}
	return printJSON(mustJSON(map[string]any{"resources": matched, "returned": len(matched), "total": len(payload.Resources)}))
}

func cmdTask(args []string) error {
	if len(args) == 0 {
		return errors.New("用法：linggan task create|get|list|wait")
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
	case "list":
		return taskList(args[1:])
	case "wait":
		return taskWait(args[1:])
	case "create":
		return taskCreate(args[1:])
	default:
		return errors.New("未知任务命令")
	}
}

func taskList(args []string) error {
	flags := flag.NewFlagSet("task list", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	canvasID := flags.String("canvas", "", "画布 ID，默认当前画布")
	all := flags.Bool("all", false, "列出全部画布的任务，不限当前画布")
	active := flags.Bool("active", false, "只列进行中的任务")
	limit := flags.Int("limit", 50, "最多返回条数")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *limit < 1 || *limit > 200 {
		return errors.New("--limit 必须在 1 到 200 之间")
	}
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	path := fmt.Sprintf("/tasks?pageSize=%d&activeOnly=%t", *limit, *active)
	if !*all {
		id := currentCanvas(*canvasID, session)
		if id == "" {
			return errors.New("还没有当前画布，请先 create 或 use，或用 --all 查看全部画布")
		}
		path += "&projectId=" + urlPath(id)
	}
	data, err := client.do("GET", path, nil, "")
	return finish(data, err)
}

// taskWait 轮询任务直到终态或超时。Agent 用它等一批生成收果，不必自己写 sleep 循环。
func taskWait(args []string) error {
	flags := flag.NewFlagSet("task wait", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	timeout := flags.Int("timeout", 900, "最长等待秒数")
	interval := flags.Int("interval", 5, "轮询间隔秒数")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 1 {
		return errors.New("用法：linggan task wait <任务ID> [--timeout 秒] [--interval 秒]")
	}
	if *timeout < 1 || *interval < 1 || *interval > *timeout {
		return errors.New("--timeout 与 --interval 必须是正数，且 interval 不能大于 timeout")
	}
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	taskID := flags.Arg(0)
	deadline := time.Now().Add(time.Duration(*timeout) * time.Second)
	var last json.RawMessage
	for {
		last, err = client.do("GET", "/tasks/"+urlPath(taskID), nil, "")
		if err != nil {
			return err
		}
		var task struct {
			Status string `json:"status"`
		}
		if json.Unmarshal(last, &task) == nil {
			switch task.Status {
			case "succeeded", "failed", "cancelled":
				return printJSON(last)
			}
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("等待 %d 秒后任务仍是 %s；可用 linggan task get %s 继续查询", *timeout, task.Status, taskID)
		}
		time.Sleep(time.Duration(*interval) * time.Second)
	}
}

func cmdWallet(args []string) error {
	flags := flag.NewFlagSet("wallet", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	entries := flags.Int("entries", 5, "返回最近流水条数")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *entries < 1 || *entries > 100 {
		return errors.New("--entries 必须在 1 到 100 之间")
	}
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	data, err := client.do("GET", fmt.Sprintf("/wallet?page=1&limit=%d", *entries), nil, "")
	if err != nil {
		return err
	}
	var wallet map[string]any
	if err := json.Unmarshal(data, &wallet); err != nil {
		return errors.New("钱包数据格式无效")
	}
	// 给 Agent 一个直接可用的可用积分读数；原始微积分整数保留在 account 里。
	if account, ok := wallet["account"].(map[string]any); ok {
		if micro, ok := account["availableMicrocredits"].(float64); ok {
			wallet["availableCredits"] = micro / creditScale
		}
	}
	return printJSON(mustJSON(wallet))
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
	if len(args) == 1 && args[0] == "--list" {
		actions, err := listPendingConfirmations()
		if err != nil {
			return err
		}
		return printPendingConfirmations(actions)
	}
	if len(args) == 2 && args[0] == "--cancel" {
		return cancelPendingConfirmation(args[1])
	}
	if len(args) > 0 && args[0] == "--all" {
		return confirmAll(args[1:])
	}
	if len(args) != 1 || strings.HasPrefix(args[0], "-") {
		return errors.New("用法：linggan confirm <确认编号> | linggan confirm --all [--max-credits N] | linggan confirm --list | linggan confirm --cancel <确认编号>")
	}
	action, err := loadPending(args[0])
	if err != nil {
		return err
	}
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	data, err := submitPending(client, action)
	if err != nil {
		return err
	}
	return printJSON(data)
}

// confirmAll 批量提交挂起的生成。--max-credits 给出本批积分预算：
// 按 createdAt 顺序累计预估积分，放不进预算的留在挂起列表里等下一批；
// 没给预算就是全量提交（--all 本身已经是明确动作）。
func confirmAll(args []string) error {
	flags := flag.NewFlagSet("confirm --all", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	maxCredits := flags.Float64("max-credits", 0, "本批积分预算上限；不传则不设预算")
	canvasID := flags.String("canvas", "", "只确认这个画布的挂起项")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 0 {
		return errors.New("confirm --all 不接受确认编号；单条确认请用 linggan confirm <编号>")
	}
	if *maxCredits < 0 {
		return errors.New("--max-credits 不能是负数")
	}
	actions, err := listPendingConfirmations()
	if err != nil {
		return err
	}
	if canvas := strings.TrimSpace(*canvasID); canvas != "" {
		filtered := actions[:0]
		for _, action := range actions {
			if action.CanvasID == canvas {
				filtered = append(filtered, action)
			}
		}
		actions = filtered
	}
	if len(actions) == 0 {
		return printJSON(mustJSON(map[string]any{"status": "submitted", "count": 0, "instruction": "没有待确认的生成。"}))
	}
	selected, remaining, unpriced := selectWithinBudget(actions, *maxCredits)
	client, _, err := authorizedClient()
	if err != nil {
		return err
	}
	confirmed := []map[string]any{}
	failed := []map[string]any{}
	total := 0.0
	for _, action := range selected {
		data, err := submitPending(client, action)
		if err != nil {
			failed = append(failed, map[string]any{"confirmationId": action.ID, "error": err.Error()})
			continue
		}
		if credits, ok := summaryCredits(action.Summary); ok {
			total += credits
		}
		confirmed = append(confirmed, map[string]any{"confirmationId": action.ID, "response": data})
	}
	remainingViews := []map[string]any{}
	for _, action := range remaining {
		remainingViews = append(remainingViews, pendingView(action))
	}
	for _, action := range unpriced {
		remainingViews = append(remainingViews, pendingView(action))
	}
	result := map[string]any{
		"status":           "submitted",
		"submittedCount":   len(confirmed),
		"confirmedCredits": total,
		"confirmed":        confirmed,
		"failed":           failed,
		"remaining":        remainingViews,
		"remainingCount":   len(remainingViews),
	}
	if *maxCredits > 0 {
		result["budgetCredits"] = *maxCredits
		result["instruction"] = "超过预算或没有报价的挂起项已保留；修正后可以再跑一次 confirm --all，或逐条 confirm。"
	} else if len(remainingViews) > 0 {
		result["instruction"] = "没有报价的挂起项已保留：先弄清它们的金额再确认，不要猜。"
	}
	return printJSON(mustJSON(result))
}

func pendingView(action pendingAction) map[string]any {
	view := map[string]any{
		"confirmationId": action.ID,
		"kind":           action.Kind,
		"canvasId":       action.CanvasID,
		"tool":           action.Tool,
		"createdAt":      action.CreatedAt,
		"expiresAt":      action.ExpiresAt,
	}
	if credits, ok := summaryCredits(action.Summary); ok {
		view["estimatedCredits"] = credits
	} else {
		view["estimatedCredits"] = nil
	}
	return view
}

func submitPending(client apiClient, action pendingAction) (json.RawMessage, error) {
	var data json.RawMessage
	var err error
	switch action.Kind {
	case "tool":
		data, err = client.do("POST", "/cli/canvases/"+urlPath(action.CanvasID)+"/tools/"+urlPath(action.Tool), bytes.NewReader(action.Body), "application/json")
	case "task":
		data, err = client.do("POST", "/tasks", bytes.NewReader(action.Body), "application/json")
	default:
		return nil, errors.New("待确认记录的类型无效")
	}
	if err != nil {
		return nil, err
	}
	if err := deletePending(action.ID); err != nil {
		return nil, err
	}
	return data, nil
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
