package model

import "time"

const (
	MembershipStatusActive    = "active"
	MembershipStatusCancelled = "cancelled"
)

// MembershipPlan 是后台可配的会员等级；0 值限制表示沿用全局默认，-1 表示不限制。
type MembershipPlan struct {
	ID        string `json:"id" gorm:"primaryKey;size:36"`
	Name      string `json:"name" gorm:"size:80;not null"`
	Level     int    `json:"level" gorm:"not null;uniqueIndex"`
	Enabled   bool   `json:"enabled" gorm:"not null;default:true"`
	SortOrder int    `json:"sortOrder" gorm:"not null;default:0"`

	MonthlyGrantMicrocredits         int64 `json:"monthlyGrantMicrocredits" gorm:"not null;default:0"`
	ActiveTaskLimit                  int   `json:"activeTaskLimit" gorm:"not null;default:0"`
	StorageGB                        int64 `json:"storageGB" gorm:"not null;default:0"`
	DailyUploadMB                    int64 `json:"dailyUploadMB" gorm:"not null;default:0"`
	CheckinBonusOverrideMicrocredits int64 `json:"checkinBonusOverrideMicrocredits" gorm:"not null;default:0"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// UserMembership 是用户当前会员订阅；partial unique index 保证同一用户只有一条 active。
type UserMembership struct {
	ID            string    `json:"id" gorm:"primaryKey;size:36"`
	UserID        string    `json:"userId" gorm:"size:36;not null;index"`
	PlanID        string    `json:"planId" gorm:"size:36;not null;index"`
	Status        string    `json:"status" gorm:"size:16;not null;default:active"`
	PeriodStart   time.Time `json:"periodStart"`
	PeriodEnd     time.Time `json:"periodEnd"`
	GrantedMonths int       `json:"grantedMonths" gorm:"not null;default:0"`
	Note          string    `json:"note,omitempty" gorm:"size:500"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
