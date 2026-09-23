package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 画布不存在时，命令行必须从 HTTP 响应里读到"画布不存在"，而不是 500「系统处理失败，请稍后
// 重试」。这条链路的终点是用户看到的那行输出，所以在 HTTP 层再验一次响应码、reason 和文案。
func TestCLICanvasRoutesReportMissingCanvasAsNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "user", Username: "user", Email: "user@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "user", UserID: "user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterCLICanvasRoutes(router.Group("/api"), svc)

	checks := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"canvas state", http.MethodGet, "/api/cli/canvases/ghost-canvas/state", ""},
		{"canvas quote", http.MethodPost, "/api/cli/canvases/ghost-canvas/quote", `{"mode":"image","prompt":"海报","nodeId":"image-1"}`},
	}
	for _, check := range checks {
		request := httptest.NewRequest(check.method, check.path, bytes.NewReader([]byte(check.body)))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "user.test-token"})
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s: HTTP %d，期望 404：%s", check.name, recorder.Code, recorder.Body.String())
		}
		var envelope struct {
			Code   int    `json:"code"`
			Msg    string `json:"msg"`
			Reason string `json:"reason"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
			t.Fatalf("%s: 响应不是统一信封：%s", check.name, recorder.Body.String())
		}
		if envelope.Code != 404 || envelope.Reason != "not_found" || !strings.Contains(envelope.Msg, "画布不存在") {
			t.Fatalf("%s: 命令行读到的是 %#v", check.name, envelope)
		}
	}
}
