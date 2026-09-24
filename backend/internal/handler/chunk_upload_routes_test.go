package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestChunkedUploadRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("/api")
	RegisterChunkedUploadRoutes(group, &service.Service{})
	wanted := map[string]bool{
		"POST /api/resources/uploads":                  false,
		"PUT /api/resources/uploads/:id/chunks/:index": false,
		"POST /api/resources/uploads/:id/complete":     false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
		}
	}
}

// 分片链路的幂等完全依赖这个键：客户端按 `X-Idempotency-Key` 头发送，
// 会话创建只读正文会让合并落库拿不到键，响应丢失后的重传就会重复落对象。
func TestChunkUploadIdempotencyKeyPrefersHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/resources/uploads", nil)

	c.Request.Header.Set("X-Idempotency-Key", "  video:user-1:abc  ")
	if got := chunkUploadIdempotencyKey(c, "body-key"); got != "video:user-1:abc" {
		t.Fatalf("头部幂等键 = %q，期望裁剪后的头部值", got)
	}

	c.Request.Header.Del("X-Idempotency-Key")
	if got := chunkUploadIdempotencyKey(c, "  body-key  "); got != "body-key" {
		t.Fatalf("正文兜底幂等键 = %q，期望裁剪后的正文值", got)
	}

	if got := chunkUploadIdempotencyKey(c, "   "); got != "" {
		t.Fatalf("无幂等键时应返回空串，实际 %q", got)
	}
}
