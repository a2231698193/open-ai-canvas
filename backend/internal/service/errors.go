package service

import "fmt"

// AppError 是 service 层对外公开的结构化错误。
// Message 必须可安全展示给用户，Cause 仅用于保留内部诊断链路，不得直接写入 HTTP 响应。
type AppError struct {
	Status    int
	Code      int
	Reason    ErrorReason
	Message   string
	Retryable bool
	Cause     error
}

func (e *AppError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *AppError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func NewAppError(status int, message string) *AppError {
	return &AppError{Status: status, Code: status, Reason: ReasonForStatus(status), Message: message}
}

func WrapAppError(status int, message string, cause error) *AppError {
	err := NewAppError(status, message)
	err.Cause = cause
	return err
}

func RateLimited(message string) *AppError {
	return &AppError{Status: CodeTooManyRequests, Code: CodeRateLimited, Reason: ReasonRateLimited, Message: message, Retryable: true}
}

func QuotaExceeded(message string) *AppError {
	return &AppError{Status: CodeForbidden, Code: CodeQuotaExceeded, Reason: ReasonQuotaExceeded, Message: message}
}

// ModelErrorCode 定义模型相关的错误码
type ModelErrorCode string

const (
	// ErrCodeModelCapabilityNotSupported 当前模型能力不支持请求
	ErrCodeModelCapabilityNotSupported ModelErrorCode = "model_capability_not_supported"
	// ErrCodeModelPriceNotConfigured 当前模型未配置该能力组合价格
	ErrCodeModelPriceNotConfigured ModelErrorCode = "model_price_not_configured"
	// ErrCodeModelRouteUnavailable 没有可用供应线路
	ErrCodeModelRouteUnavailable ModelErrorCode = "model_route_unavailable"
	// ErrCodeProviderRequestFailed 供应商异常、响应格式错误或上游失败
	ErrCodeProviderRequestFailed ModelErrorCode = "provider_request_failed"
	// ErrCodeModelCatalogMismatch 模型目录已更新，请重新选择
	ErrCodeModelCatalogMismatch ModelErrorCode = "model_catalog_mismatch"
	// ErrCodeInvalidModelSelection 无效的模型选择
	ErrCodeInvalidModelSelection ModelErrorCode = "invalid_model_selection"
)

// ModelError 为模型选择、路由和供应商调用提供稳定的机器可读错误码。
// 嵌入 AppError，使统一 HTTP 投影仍能通过 errors.As 读取状态、reason 和安全文案。
type ModelError struct {
	*AppError
	ErrorCode ModelErrorCode
	Details   map[string]any
}

func (e *ModelError) Error() string {
	if e.AppError != nil {
		return e.AppError.Error()
	}
	return string(e.ErrorCode)
}

// NewModelError 创建模型错误
func NewModelError(code ModelErrorCode, message string) *ModelError {
	err := NewAppError(400, message)
	err.Reason = ErrorReason(code)
	return &ModelError{
		AppError:  err,
		ErrorCode: code,
		Details:   make(map[string]any),
	}
}

// WithDetails 添加错误详情
func (e *ModelError) WithDetails(details map[string]any) *ModelError {
	e.Details = details
	return e
}

// ModelCapabilityNotSupported 当前模型能力不支持请求
func ModelCapabilityNotSupported(message string) error {
	if message == "" {
		message = "当前模型不支持该能力"
	}
	return NewModelError(ErrCodeModelCapabilityNotSupported, message)
}

// ModelPriceNotConfigured 当前模型未配置价格
func ModelPriceNotConfigured(message string) error {
	if message == "" {
		message = "当前模型未配置该能力组合价格"
	}
	return NewModelError(ErrCodeModelPriceNotConfigured, message)
}

// ModelRouteUnavailable 没有可用供应线路
func ModelRouteUnavailable(message string) error {
	if message == "" {
		message = "没有可用供应线路"
	}
	return NewModelError(ErrCodeModelRouteUnavailable, message)
}

// ProviderRequestFailed 供应商请求失败
func ProviderRequestFailed(message string) error {
	if message == "" {
		message = "模型服务返回失败，请检查请求内容或渠道配置"
	}
	return NewModelError(ErrCodeProviderRequestFailed, message)
}

// ModelCatalogMismatch 模型目录已更新
func ModelCatalogMismatch(message string) error {
	if message == "" {
		message = "模型目录已更新，请重新选择"
	}
	return NewModelError(ErrCodeModelCatalogMismatch, message)
}

// InvalidModelSelection 无效的模型选择
func InvalidModelSelection(message string) error {
	if message == "" {
		message = "无效的模型选择"
	}
	return NewModelError(ErrCodeInvalidModelSelection, message)
}

// IsModelError 判断是否为模型错误
func IsModelError(err error) bool {
	_, ok := err.(*ModelError)
	return ok
}

// GetModelErrorCode 获取模型错误码
func GetModelErrorCode(err error) ModelErrorCode {
	if modelErr, ok := err.(*ModelError); ok {
		return modelErr.ErrorCode
	}
	return ""
}

// FormatModelError 格式化模型错误消息
func FormatModelError(err error) string {
	if modelErr, ok := err.(*ModelError); ok {
		if len(modelErr.Details) > 0 {
			return fmt.Sprintf("%s (错误码: %s)", modelErr.Message, modelErr.ErrorCode)
		}
		return modelErr.Message
	}
	return err.Error()
}
