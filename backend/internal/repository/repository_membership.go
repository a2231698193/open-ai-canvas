package repository

import (
	"errors"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

// EnabledMembershipPlans 返回启用中的等级配置，按 level 升序（用户端可选购列表）。
func (r *Repository) EnabledMembershipPlans() ([]model.MembershipPlan, error) {
	var plans []model.MembershipPlan
	err := r.db.Where("enabled = ?", true).Order("level asc").Find(&plans).Error
	return plans, err
}

// MembershipPlans 返回全部等级配置，按 level 升序。
func (r *Repository) MembershipPlans() ([]model.MembershipPlan, error) {
	var plans []model.MembershipPlan
	err := r.db.Order("level asc").Find(&plans).Error
	return plans, err
}

// SaveMembershipPlan 创建或按 ID 更新等级配置。
func (r *Repository) SaveMembershipPlan(plan *model.MembershipPlan) error {
	if r.db.Where("id = ?", plan.ID).First(&model.MembershipPlan{}).RowsAffected == 1 {
		return r.db.Model(&model.MembershipPlan{}).Where("id = ?", plan.ID).Updates(map[string]any{
			"name": plan.Name, "level": plan.Level, "enabled": plan.Enabled, "sort_order": plan.SortOrder,
			"monthly_grant_microcredits": plan.MonthlyGrantMicrocredits, "active_task_limit": plan.ActiveTaskLimit,
			"storage_gb": plan.StorageGB, "daily_upload_mb": plan.DailyUploadMB,
			"checkin_bonus_override_microcredits": plan.CheckinBonusOverrideMicrocredits,
		}).Error
	}
	// Enabled=false 是合法配置；GORM 会把零值字段交给 default 标签，必须 Select 强制写入。
	return r.db.Select("ID", "Name", "Level", "Enabled", "SortOrder", "MonthlyGrantMicrocredits", "ActiveTaskLimit", "StorageGB", "DailyUploadMB", "CheckinBonusOverrideMicrocredits").Create(plan).Error
}

// UserMembershipByID 按 ID 读取订阅。
func (r *Repository) UserMembershipByID(id string) (*model.UserMembership, error) {
	var membership model.UserMembership
	if err := r.db.First(&membership, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &membership, nil
}

// ActiveMembershipsByPlanCount 统计某等级下生效中的订阅数，删除等级前必须为零。
func (r *Repository) ActiveMembershipsByPlanCount(planID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.UserMembership{}).
		Where("plan_id = ? AND status = ? AND period_end > ?", planID, model.MembershipStatusActive, time.Now()).
		Count(&count).Error
	return count, err
}

// DeleteMembershipPlan 硬删除等级配置；仅限无生效订阅时调用。
func (r *Repository) DeleteMembershipPlan(planID string) error {
	return r.db.Delete(&model.MembershipPlan{}, "id = ?", planID).Error
}

// SaveUserMembership 创建订阅记录。
func (r *Repository) SaveUserMembership(membership *model.UserMembership) error {
	return r.db.Create(membership).Error
}

// ExtendUserMembership 续费顺延周期并跟随最新等级配置。
func (r *Repository) ExtendUserMembership(id string, periodEnd time.Time, planID string, note string) error {
	return r.db.Model(&model.UserMembership{}).Where("id = ?", id).
		Updates(map[string]any{"period_end": periodEnd, "plan_id": planID, "note": note}).Error
}

// UpdateUserMembershipPlan 切换订阅等级并记录备注。
func (r *Repository) UpdateUserMembershipPlan(id string, planID string, note string) error {
	return r.db.Model(&model.UserMembership{}).Where("id = ?", id).
		Updates(map[string]any{"plan_id": planID, "note": note}).Error
}

// CancelUserMembership 作废用户的 active 订阅，返回影响的行数。
func (r *Repository) CancelUserMembership(userID string) (int64, error) {
	result := r.db.Model(&model.UserMembership{}).
		Where("user_id = ? AND status = ?", userID, model.MembershipStatusActive).
		Update("status", model.MembershipStatusCancelled)
	return result.RowsAffected, result.Error
}

// ActiveUserMemberships 返回全部生效且未过期的订阅，供锚点发放扫描。
func (r *Repository) ActiveUserMemberships() ([]model.UserMembership, error) {
	var memberships []model.UserMembership
	err := r.db.Where("status = ? AND period_end > ?", model.MembershipStatusActive, time.Now()).Find(&memberships).Error
	return memberships, err
}

// UpdateMembershipGrantedMonths 以 CAS 方式推进已发放窗口数，防止清扫任务并发重复计数。
func (r *Repository) UpdateMembershipGrantedMonths(id string, from int, to int) error {
	result := r.db.Model(&model.UserMembership{}).
		Where("id = ? AND granted_months = ?", id, from).
		Update("granted_months", to)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// GrantMembershipCredits 向会员池发放积分并写台账；同一 referenceKey 幂等。
// 到期时间取「现有未过期到期时间」与「本次发放到期时间」的较大者，不缩短已发放余额的有效期。
func (r *Repository) GrantMembershipCredits(userID string, amount int64, expiresAt time.Time, entryType model.CreditLedgerType, referenceKey string, note string) (*model.CreditAccount, bool, error) {
	var account model.CreditAccount
	var granted bool
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.CreditAccount{UserID: userID}).Error; err != nil {
			return err
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.CreditLedgerEntry{}).Where("reference_key = ?", referenceKey).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		newExpiry := expiresAt
		if !account.MembershipExpiresAt.IsZero() && account.MembershipExpiresAt.After(time.Now()) && account.MembershipExpiresAt.After(newExpiry) {
			newExpiry = account.MembershipExpiresAt
		}
		updated := tx.Model(&model.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]any{
				"membership_microcredits": gorm.Expr("membership_microcredits + ?", amount),
				"membership_expires_at":   newExpiry,
				"version":                 gorm.Expr("version + 1"),
				"updated_at":              time.Now(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		key := referenceKey
		if err := tx.Create(&model.CreditLedgerEntry{
			ID:                          newRepositoryID(),
			UserID:                      userID,
			Type:                        entryType,
			AmountMicrocredits:          amount,
			MembershipDeltaMicrocredits: amount,
			MembershipAfterMicrocredits: account.MembershipMicrocredits,
			AvailableAfterMicrocredits:  account.AvailableMicrocredits,
			ReservedAfterMicrocredits:   account.ReservedMicrocredits,
			ReferenceKey:                &key,
			Note:                        note,
		}).Error; err != nil {
			return err
		}
		granted = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &account, granted, nil
}
