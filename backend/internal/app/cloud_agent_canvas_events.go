package app

import (
	"reflect"

	"infinite-canvas/backend/internal/repository"
)

// Persist the delta in the same transaction as the canvas and run checkpoint.
// Clients can project it without fetching the entire canvas for every task.
func cloudAgentCanvasEventRecorder(runID string, state *cloudAgentRuntime) cloudAgentMutationRecorder {
	return func(repo *repository.Repository, input cloudAgentMutationInput) error {
		if err := cloudAgentMutationRecorderForRun(runID)(repo, input); err != nil {
			return err
		}
		return emitCloudAgentCanvasChange(repo, runID, state, input.UserID, input.CanvasID, input.BeforeJSON, input.Operation)
	}
}

func cloudAgentObjectChanges(before, after any) []map[string]any {
	previous := map[string]map[string]any{}
	for _, item := range creationMaps(before) {
		previous[stringValue(item["id"])] = item
	}
	changes := []map[string]any{}
	for _, item := range creationMaps(after) {
		old := previous[stringValue(item["id"])]
		if !reflect.DeepEqual(old, item) {
			changes = append(changes, map[string]any{"before": old, "after": item})
		}
	}
	return changes
}

func emitCloudAgentCanvasChange(repo *repository.Repository, runID string, state *cloudAgentRuntime, userID, canvasID, beforeJSON, operation string) error {
	before, err := creationDocument(beforeJSON)
	if err != nil {
		return err
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return err
	}
	after, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	nodes := cloudAgentObjectChanges(before["nodes"], after["nodes"])
	edges := cloudAgentObjectChanges(before["connections"], after["connections"])
	if len(nodes) == 0 && len(edges) == 0 {
		return nil
	}
	actions := []map[string]any{}
	for _, change := range nodes {
		node := change["after"].(map[string]any)
		action := "updated"
		if old, _ := change["before"].(map[string]any); old == nil {
			action = "created"
		}
		actions = append(actions, map[string]any{"action": action, "nodeId": node["id"], "title": node["title"], "nodeType": node["type"]})
	}
	byID, err := creationObjects(after["nodes"])
	if err != nil {
		return err
	}
	for _, change := range edges {
		edge := change["after"].(map[string]any)
		if node := byID[stringValue(edge["fromNodeId"])]; node != nil {
			actions = append(actions, map[string]any{"action": "referenced", "nodeId": node["id"], "title": node["title"], "nodeType": node["type"], "targetNodeId": edge["toNodeId"]})
		}
	}
	payload := map[string]any{
		"canvasId": canvasID, "operation": operation, "actions": actions,
		"canvasPatch": map[string]any{"canvasId": canvasID, "updatedAt": after["updatedAt"], "nodes": nodes, "connections": edges},
	}
	if state.CallIndex >= 0 && state.CallIndex < len(state.Calls) {
		payload["callId"] = state.Calls[state.CallIndex].ID
	}
	state.event(runID, "canvas_updated", payload)
	return nil
}
