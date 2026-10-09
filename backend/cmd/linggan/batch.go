package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
)

// 批量生成与预算确认。逐笔生成都要用户点头的话，整集出片就没法在命令行里跑完：
// 这里把 N 笔生成各自走一次报价与准入链路挂起，用户同意一笔预算后用
// confirm --all --max-credits 一次提交，超预算的留在挂起列表里等下一批。

const (
	// maxBatchGenerateItems 单批上限：防止一个写错的请求文件把账号额度打穿。
	maxBatchGenerateItems = 50
	// creditScale 与服务端 app.CreditScale 一致：微积分换算成积分。
	creditScale = 1_000_000
)

func cmdBatch(args []string) error {
	if len(args) == 0 || args[0] != "generate" {
		return errors.New("用法：linggan batch generate --file <请求.json> | linggan batch generate --from-batch-table <节点ID> --model <模型> --size <比例>")
	}
	return batchGenerate(args[1:])
}

func batchGenerate(args []string) error {
	flags := flag.NewFlagSet("batch generate", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "请求 JSON 文件：generate_media 参数数组，或 {\"requests\": [...]}")
	fromTable := flags.String("from-batch-table", "", "从批量创作表节点读取任务行")
	model := flags.String("model", "", "模型：渠道ID::模型键 或逻辑模型ID（--from-batch-table 必填）")
	size := flags.String("size", "", "画幅，如 1:1、16:9（--from-batch-table 必填）")
	rowIDs := flags.String("row-ids", "", "逗号分隔的 rowId，只提交这些行（可选）")
	canvasID := flags.String("canvas", "", "画布 ID")
	limit := flags.Int("limit", maxBatchGenerateItems, "单批最多提交笔数")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *limit < 1 || *limit > maxBatchGenerateItems {
		return fmt.Errorf("--limit 必须在 1 到 %d 之间", maxBatchGenerateItems)
	}
	client, session, err := authorizedClient()
	if err != nil {
		return err
	}
	canvas := currentCanvas(*canvasID, session)
	if canvas == "" {
		return errors.New("还没有当前画布，请先 create 或 use")
	}

	var requests []json.RawMessage
	switch {
	case strings.TrimSpace(*fromTable) != "":
		if *file != "" {
			return errors.New("--file 与 --from-batch-table 只能填一个")
		}
		if strings.TrimSpace(*model) == "" || strings.TrimSpace(*size) == "" {
			return errors.New("从批量创作表提交需要 --model 和 --size")
		}
		requests, err = batchTableRequests(client, canvas, *fromTable, *model, *size, *rowIDs)
		if err != nil {
			return err
		}
	case strings.TrimSpace(*file) != "":
		if *fromTable != "" || *model != "" || *size != "" || *rowIDs != "" {
			return errors.New("--file 不能与 --from-batch-table/--model/--size/--row-ids 混用")
		}
		requests, err = batchRequestsFromFile(*file)
		if err != nil {
			return err
		}
	default:
		return errors.New("请用 --file 指定请求文件，或用 --from-batch-table 从批量创作表提交")
	}
	if len(requests) == 0 {
		return errors.New("没有可提交的生成请求：检查请求文件内容或批量表的启用行、参考图与提示词")
	}
	if len(requests) > *limit {
		requests = requests[:*limit]
	}

	// 每笔独立走报价与准入：算不出报价的当场剔出来报告，不进挂起列表，
	// 避免 confirm --all 时才撞上必然失败的提交。
	items := []map[string]any{}
	invalid := []map[string]any{}
	var actions []pendingAction
	for index, raw := range requests {
		action, err := prepareMediaPending(client, canvas, "generate_media", raw)
		if err != nil {
			invalid = append(invalid, map[string]any{"index": index, "error": err.Error()})
			continue
		}
		saved, err := savePending(action)
		if err != nil {
			return err
		}
		item := map[string]any{
			"confirmationId": saved.ID,
			"expiresAt":      saved.ExpiresAt,
			"summary":        saved.Summary,
		}
		if credits, ok := summaryCredits(saved.Summary); ok {
			item["estimatedCredits"] = credits
		}
		items = append(items, item)
		actions = append(actions, saved)
	}
	if len(actions) == 0 {
		return printJSON(mustJSON(map[string]any{
			"status":      "invalid",
			"invalid":     invalid,
			"instruction": "没有一笔能算出报价：按 invalid 里每笔的 estimateError 修正参数后重新执行批量生成。",
		}))
	}

	total := 0.0
	for _, action := range actions {
		if credits, ok := summaryCredits(action.Summary); ok {
			total += credits
		}
	}
	if tty, err := userTerminal(); err == nil {
		defer tty.Close()
		return batchConfirmOnTerminal(tty, client, actions, total, len(invalid))
	}
	budget := int(total) + 1
	return printJSON(mustJSON(map[string]any{
		"status":                "needs_confirmation",
		"items":                 items,
		"invalid":               invalid,
		"count":                 len(actions),
		"totalEstimatedCredits": total,
		"nextCommand":           fmt.Sprintf("linggan confirm --all --max-credits %d", budget),
		"listCommand":           "linggan confirm --list",
		"instruction":           "先把整批摘要（笔数、每笔预估积分、总额）告诉用户并询问。用户明确同意后执行 nextCommand；invalid 里的请求要修正参数后重新执行。",
	}))
}

// batchTableRequests 读取批量创作表节点，映射规则见 mapBatchTableRows。
func batchTableRequests(client apiClient, canvasID, nodeID, modelSpec, size, rowIDs string) ([]json.RawMessage, error) {
	body, _ := json.Marshal(map[string]any{"nodeId": nodeID})
	data, err := client.do("POST", "/cli/canvases/"+urlPath(canvasID)+"/tools/canvas_read_batch_table", bytes.NewReader(body), "application/json")
	if err != nil {
		return nil, err
	}
	return mapBatchTableRows(data, modelSpec, size, rowIDs)
}

// mapBatchTableRows 把 canvas_read_batch_table 的返回映射成 generate_media 请求。
// 口径与网页端一致：globalPrompt 非空时覆盖行提示词；try_on 每行至少两张参考图，
// creative 至少一张；行上有 outputNodeId 时复用输出节点。
func mapBatchTableRows(data json.RawMessage, modelSpec, size, rowIDs string) ([]json.RawMessage, error) {
	var read struct {
		BatchTable map[string]any `json:"batchTable"`
	}
	if err := json.Unmarshal(data, &read); err != nil || read.BatchTable == nil {
		return nil, errors.New("批量创作表读取结果无效")
	}
	operation := strings.TrimSpace(stringify(read.BatchTable["operation"]))
	globalPrompt := strings.TrimSpace(stringify(read.BatchTable["globalPrompt"]))
	minInputs := 1
	if operation == "try_on" {
		minInputs = 2
	}
	wanted := map[string]bool{}
	for _, id := range strings.Split(rowIDs, ",") {
		if id = strings.TrimSpace(id); id != "" {
			wanted[id] = true
		}
	}
	rows, _ := read.BatchTable["rows"].([]any)
	channelID, channelKey, logicalModelID := splitModelSpec(modelSpec)
	requests := []json.RawMessage{}
	submitIndex := 0
	for _, value := range rows {
		row, ok := value.(map[string]any)
		if !ok {
			continue
		}
		if enabled, ok := row["enabled"].(bool); !ok || !enabled {
			continue
		}
		if len(wanted) > 0 && !wanted[stringify(row["id"])] {
			continue
		}
		prompt := globalPrompt
		if prompt == "" {
			prompt = strings.TrimSpace(stringify(row["prompt"]))
		}
		if prompt == "" {
			continue
		}
		inputs := []string{}
		if raw, ok := row["inputNodeIds"].([]any); ok {
			for _, item := range raw {
				if id, ok := item.(string); ok && id != "" {
					inputs = append(inputs, id)
				}
			}
		}
		if len(inputs) < minInputs {
			continue
		}
		request := map[string]any{
			"mode":             "image",
			"prompt":           prompt,
			"referenceNodeIds": inputs,
			"size":             size,
			"title":            fmt.Sprintf("%s · %d", map[string]string{"try_on": "换装", "creative": "创意"}[operation], submitIndex+1),
		}
		if channelID != "" {
			request["channelId"] = channelID
			request["channelModelKey"] = channelKey
		} else {
			request["logicalModelId"] = logicalModelID
		}
		if output := stringify(row["outputNodeId"]); output != "" {
			request["nodeId"] = output
		}
		raw, err := json.Marshal(request)
		if err != nil {
			return nil, err
		}
		requests = append(requests, raw)
		submitIndex++
	}
	return requests, nil
}

// splitModelSpec 拆「渠道ID::模型键」；不含 :: 时按逻辑模型 ID 处理。
func splitModelSpec(spec string) (channelID, channelKey, logicalModelID string) {
	if channelID, channelKey, found := strings.Cut(spec, "::"); found && channelID != "" && channelKey != "" {
		return channelID, channelKey, ""
	}
	return "", "", spec
}

func batchRequestsFromFile(path string) ([]json.RawMessage, error) {
	raw, err := readInput(path)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, errors.New("请求文件必须是 JSON 数组或含 requests 数组的对象")
	}
	if wrapper, ok := decoded.(map[string]any); ok {
		decoded = wrapper["requests"]
	}
	items, ok := decoded.([]any)
	if !ok {
		return nil, errors.New("请求文件必须是 JSON 数组或含 requests 数组的对象")
	}
	requests := make([]json.RawMessage, 0, len(items))
	for index, item := range items {
		encoded, err := json.Marshal(item)
		if err != nil {
			return nil, fmt.Errorf("第 %d 个请求无法序列化：%v", index+1, err)
		}
		var probe map[string]any
		if json.Unmarshal(encoded, &probe) != nil || probe == nil {
			return nil, fmt.Errorf("第 %d 个请求必须是 JSON 对象", index+1)
		}
		requests = append(requests, encoded)
	}
	return requests, nil
}

func batchConfirmOnTerminal(tty *os.File, client apiClient, actions []pendingAction, total float64, invalidCount int) error {
	fmt.Fprintf(tty, "即将批量提交 %d 笔生成，预估积分合计 %.2f", len(actions), total)
	if invalidCount > 0 {
		fmt.Fprintf(tty, "（另有 %d 笔报价失败被剔除）", invalidCount)
	}
	fmt.Fprintln(tty, "：")
	for _, action := range actions {
		fmt.Fprintf(tty, "  [%s] %s\n", action.ID, shorten(stringify(action.Summary["prompt"]), 80))
	}
	fmt.Fprint(tty, "确认提交整批？输入 y 后回车，其他输入都会取消：")
	line, err := bufioReadLine(tty)
	if err != nil {
		return err
	}
	if line != "y" {
		return errors.New("未确认，生成未提交")
	}
	results := make([]map[string]any, 0, len(actions))
	for _, action := range actions {
		data, err := client.do("POST", "/cli/canvases/"+urlPath(action.CanvasID)+"/tools/"+urlPath(action.Tool), bytes.NewReader(action.Body), "application/json")
		if err != nil {
			results = append(results, map[string]any{"confirmationId": action.ID, "status": "failed", "error": err.Error()})
			continue
		}
		_ = deletePending(action.ID)
		results = append(results, map[string]any{"confirmationId": action.ID, "status": "submitted", "response": data})
	}
	return printJSON(mustJSON(map[string]any{"status": "submitted", "results": results}))
}

// prepareMediaPending 对一笔 generate_media / image_layer_split 参数做报价并把结果并入摘要。
// 报价复用服务端准入链路：既给出金额，也在用户确认之前就把参数错误报出来，
// 避免「确认完才发现提交不了」。算不出来不阻断确认，但要如实带进摘要。
func prepareMediaPending(client apiClient, canvasID, tool string, raw []byte) (pendingAction, error) {
	var request map[string]any
	if err := json.Unmarshal(raw, &request); err != nil {
		return pendingAction{}, errors.New("生成参数必须是一个 JSON 对象")
	}
	request["type"] = "canvas_" + stringify(request["mode"])
	request["operation"] = tool
	request["prompt"] = stringify(request["prompt"])
	request["canvasId"] = canvasID
	request["model"] = stringify(request["logicalModelId"]) + stringify(request["channelModelKey"])
	if quoteData, quoteErr := client.do("POST", "/cli/canvases/"+urlPath(canvasID)+"/quote", bytes.NewReader(raw), "application/json"); quoteErr == nil {
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
	return pendingAction{Kind: "tool", CanvasID: canvasID, Tool: tool, Body: raw, Summary: request}, nil
}

// summaryCredits 读摘要里的预估积分。优先用整数微积分，浮点积分兜底。
func summaryCredits(summary map[string]any) (float64, bool) {
	if micro, ok := summary["amountMicrocredits"].(float64); ok && micro > 0 {
		return micro / creditScale, true
	}
	if credits, ok := summary["estimatedCredits"].(float64); ok && credits > 0 {
		return credits, true
	}
	return 0, false
}

// selectWithinBudget 按 createdAt 顺序累计预估积分，返回预算内可提交的与留下来的。
// 预算 <= 0 表示不限；无报价的笔一律留在原地（预算纪律不能建立在猜的金额上）。
func selectWithinBudget(actions []pendingAction, maxCredits float64) (selected, remaining, unpriced []pendingAction) {
	total := 0.0
	for _, action := range actions {
		credits, ok := summaryCredits(action.Summary)
		if !ok {
			unpriced = append(unpriced, action)
			continue
		}
		if maxCredits > 0 && total+credits > maxCredits {
			remaining = append(remaining, action)
			continue
		}
		total += credits
		selected = append(selected, action)
	}
	sort.Slice(unpriced, func(i, j int) bool { return unpriced[i].CreatedAt < unpriced[j].CreatedAt })
	return selected, remaining, unpriced
}
