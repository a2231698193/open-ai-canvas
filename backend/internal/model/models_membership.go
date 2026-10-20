package model

import "time"

const (
	MembershipStatusActive    = "active"
	MembershipStatusCancelled = "cancelled"
)

// MembershipWindowDays 是会员积分发放的锚点窗口；后台开通与在线购买共用同一计算。
const MembershipWindowDays = 30 * 24 * time.Hour

type MembershipWindow struct {
	Index int
	Start time.Time
	End   time.Time
}

// MembershipDueWindows 返回当前应发放的窗口；最后一个窗口按周期末截断。
func MembershipDueWindows(periodStart, periodEnd time.Time, grantedMonths int, now time.Time) []MembershipWindow {
	windows := make([]MembershipWindow, 0)
	for index := grantedMonths + 1; ; index++ {
		start := periodStart.Add(time.Duration(index-1) * MembershipWindowDays)
		if !start.Before(periodEnd) || !start.Before(now) {
			return windows
		}
		end := start.Add(MembershipWindowDays)
		if end.After(periodEnd) {
			end = periodEnd
		}
		windows = append(windows, MembershipWindow{Index: index, Start: start, End: end})
	}
}

// MembershipPlan 是后台可配的会员等级；0 值限制表示沿用全局默认，-1 表示不限制。
type MembershipPlan struct {
	ID    string `json:"id" gorm:"primaryKey;size:36"`
	Name  string `json:"name" gorm:"size:80;not null"`
	Level int    `json:"level" gorm:"not null;uniqueIndex"`
	// Enabled 不加 default 标签：false 是合法配置，零值也必须写入。
	Enabled   bool `json:"enabled" gorm:"not null"`
	SortOrder int  `json:"sortOrder" gorm:"not null;default:0"`

	MonthlyGrantMicrocredits         int64 `json:"monthlyGrantMicrocredits" gorm:"not null;default:0"`
	ActiveTaskLimit                  int   `json:"activeTaskLimit" gorm:"not null;default:0"`
	StorageGB                        int64 `json:"storageGB" gorm:"not null;default:0"`
	DailyUploadMB                    int64 `json:"dailyUploadMB" gorm:"not null;default:0"`
	CheckinBonusOverrideMicrocredits int64 `json:"checkinBonusOverrideMicrocredits" gorm:"not null;default:0"`

	// 价格为 0 表示该时长未开放购买；单位分。
	MonthPriceFen   int64 `json:"monthPriceFen" gorm:"not null;default:0"`
	QuarterPriceFen int64 `json:"quarterPriceFen" gorm:"not null;default:0"`
	YearPriceFen    int64 `json:"yearPriceFen" gorm:"not null;default:0"`

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
