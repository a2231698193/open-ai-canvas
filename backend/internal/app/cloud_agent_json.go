package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

var errCloudAgentJSONSingleObject = errors.New("参数必须是单个 JSON 对象")

// Only syntax/schema errors may be repaired by the model; authorization and
// unsupported mutations still fail admission before any write or approval.
type cloudAgentArgumentError struct{ error }

func (e *cloudAgentArgumentError) Unwrap() error { return e.error }

func canvasArgumentError() error {
	return &cloudAgentArgumentError{BadAuthRequest("画布工具参数无效：仅允许一个 JSON 对象；顶层只含 snapshotHash 和 ops，snapshotHash 不得放入 ops。请按工具 schema 修正后重试")}
}

// decodeCloudAgentJSONObject is used for model tool arguments. Tool arguments
// are an untrusted protocol boundary: reject non-objects, unknown fields and
// trailing JSON instead of silently accepting an ambiguous payload.
func decodeCloudAgentJSONObject(raw string, target any) error {
	data := bytes.TrimSpace([]byte(raw))
	if len(data) == 0 || data[0] != '{' {
		return errCloudAgentJSONSingleObject
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errCloudAgentJSONSingleObject
		}
		return err
	}
	return nil
}
