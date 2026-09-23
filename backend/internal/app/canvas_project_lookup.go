package app

import (
	"errors"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

// canvasProjectForUser 读当前用户自己的画布，并把仓储层的"记录不存在"翻译成对外的 404。
//
// 仓储直接返回 gorm.ErrRecordNotFound 时，HTTP 投影认不出这个语义，只能落到 500
// "系统处理失败，请稍后重试"：命令行用户看不到服务端日志，只会对着一个不存在的画布反复
// 重试。归属别人的画布走同一条查询，也返回 404，不暴露画布是否存在。
func canvasProjectForUser(repo *repository.Repository, userID, canvasID string) (*model.CanvasProject, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("画布不存在或无权访问")
		}
		return nil, err
	}
	return canvas, nil
}
