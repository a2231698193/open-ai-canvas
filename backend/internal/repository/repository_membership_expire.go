package repository

import (
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// ExpireMembershipPools 清零已过期的会员积分池并逐户写入台账，返回清零账户数。
// 幂等：只有余额大于零且到期时间已过的账户会被处理。
func (r *Repository) ExpireMembershipPools(now time.Time) (int64, error) {
	var expired []model.CreditAccount
	// 零值到期时间在 SQLite 中不是 NULL；用 > 1970 同时排除 NULL/零值与过去时间无冲突。
	if err := r.db.Where("membership_microcredits > 0 AND membership_expires_at > ? AND membership_expires_at < ?", time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC), now).Find(&expired).Error; err != nil {
		return 0, err
	}
	cleared := int64(0)
	for _, account := range expired {
		err := r.db.Transaction(func(tx *gorm.DB) error {
			result := tx.Model(&model.CreditAccount{}).
				Where("user_id = ? AND membership_microcredits = ?", account.UserID, account.MembershipMicrocredits).
				Updates(map[string]any{"membership_microcredits": int64(0), "version": gorm.Expr("version + 1"), "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return nil
			}
			return tx.Create(&model.CreditLedgerEntry{
				ID:                          newRepositoryID(),
				UserID:                      account.UserID,
				Type:                        model.CreditLedgerMembershipExpireClear,
				AmountMicrocredits:          -account.MembershipMicrocredits,
				MembershipDeltaMicrocredits: -account.MembershipMicrocredits,
				AvailableAfterMicrocredits:  account.AvailableMicrocredits,
				MembershipAfterMicrocredits: 0,
				ReservedAfterMicrocredits:   account.ReservedMicrocredits,
				Note:                        "会员积分池到期清零",
			}).Error
		})
		if err != nil {
			return cleared, err
		}
		cleared++
	}
	return cleared, nil
}
