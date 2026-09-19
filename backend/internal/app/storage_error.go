package app

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

type objectStorageError struct {
	Provider   string
	Operation  string
	StatusCode int
	Code       string
}

func (e *objectStorageError) Error() string {
	if e == nil {
		return "对象存储请求失败"
	}
	if hint := objectStorageErrorHint(e.Code); hint != "" {
		if e.Code != "" {
			return fmt.Sprintf("%s（%s）", hint, e.Code)
		}
		return hint
	}
	if e.Code != "" {
		return fmt.Sprintf("对象存储返回 %s", e.Code)
	}
	if e.StatusCode > 0 {
		return fmt.Sprintf("对象存储请求失败（HTTP %d）", e.StatusCode)
	}
	return "对象存储请求失败"
}

func newObjectStorageHTTPError(provider string, operation string, status int, body []byte) error {
	code, _ := parseObjectStorageXMLError(body)
	return &objectStorageError{Provider: provider, Operation: operation, StatusCode: status, Code: code}
}

func parseObjectStorageXMLError(body []byte) (string, string) {
	return xmlTagValue(body, "Code"), sanitizeObjectStorageMessage(xmlTagValue(body, "Message"))
}

func xmlTagValue(body []byte, tag string) string {
	if len(body) == 0 || tag == "" {
		return ""
	}
	pattern := regexp.MustCompile(`(?is)<` + regexp.QuoteMeta(tag) + `>\s*([^<]+)\s*</` + regexp.QuoteMeta(tag) + `>`)
	match := pattern.FindSubmatch(body)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(string(match[1]))
}

func sanitizeObjectStorageMessage(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return ""
	}
	lower := strings.ToLower(message)
	if strings.ContainsAny(message, "\n\r") || strings.Contains(lower, "signature") || strings.Contains(lower, "canonical") || strings.Contains(lower, "authorization") || strings.Contains(lower, "ossaccesskeyid") || strings.Contains(lower, "secretkey") || strings.Contains(lower, "accesskey") {
		return ""
	}
	return message
}

func objectStorageErrorHint(code string) string {
	switch strings.TrimSpace(code) {
	case "InvalidBucketName":
		return "Bucket 名称无效"
	case "NoSuchBucket":
		return "Bucket 不存在，请检查 Bucket 与 Endpoint 区域是否一致"
	case "InvalidAccessKeyId", "InvalidAccessKeyId.NotFound", "InvalidAccessKeyId.Inactive":
		return "AccessKey ID 无效或已停用"
	case "UserDisable":
		return "对象存储账号已停用"
	case "SignatureDoesNotMatch", "InvalidSignature", "AccessDenied", "InvalidSecurity":
		return "鉴权失败，请检查 AccessKey、Secret 和 Bucket 权限"
	case "InvalidArgument":
		return "请求参数无效，请检查 Endpoint、Bucket 和对象路径"
	case "InvalidObjectName":
		return "对象路径无效"
	case "InvalidLocationConstraint", "IllegalLocationConstraintException":
		return "Region 与 Endpoint 不匹配"
	case "RequestTimeTooSkewed":
		return "服务器时间偏差过大"
	case "EntityTooLarge", "MaxMessageLengthExceeded":
		return "上传对象过大"
	case "InvalidRequest":
		return "对象存储拒绝了该请求，请检查 Endpoint 是否为 Bucket 所在区域"
	default:
		return ""
	}
}

func objectStorageErrorStatus(status int) int {
	switch status {
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return http.StatusBadRequest
	default:
		return http.StatusBadGateway
	}
}
