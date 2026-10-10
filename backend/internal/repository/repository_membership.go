package repository

import (
	"errors"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// ActiveUserMembership 返回用户当前 active 且未过期的订阅；没有时返回 nil 而不是错误。
func (r *Repository) ActiveUserMembership(userID string) (*model.UserMembership, error) {
	var membership model.UserMembership
	err := r.db.Where("user_id = ? AND status = ? AND period_end > ?", userID, model.MembershipStatusActive, time.Now()).First(&membership).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &membership, nil
}

// MembershipPlan 按 ID 读取等级配置；不存在时返回 gorm.ErrRecordNotFound。
func (r *Repository) MembershipPlan(planID string) (*model.MembershipPlan, error) {
	var plan model.MembershipPlan
	if err := r.db.First(&plan, "id = ?", planID).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}
