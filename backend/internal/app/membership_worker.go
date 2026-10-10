package app

import (
	"context"
	"log/slog"
	"time"
)

// startMembershipWorker 周期清零已过期的会员积分池。
// ExpireMembershipPools 幂等，清扫频率只影响残留余额的可见时长。
func (s *Service) startMembershipWorker(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		s.expireMembershipPools()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.expireMembershipPools()
			}
		}
	})
}

func (s *Service) expireMembershipPools() {
	cleared, err := s.repo.ExpireMembershipPools(time.Now())
	if err != nil {
		slog.Warn("membership pool expire sweep failed", "error", err)
		return
	}
	if cleared > 0 {
		slog.Info("membership pools expired", "cleared", cleared)
	}
}
