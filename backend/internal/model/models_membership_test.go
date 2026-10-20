package model

import (
	"testing"
	"time"
)

func TestMembershipDueWindowsIncludesStartedWindowsAndTruncatesLast(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	periodStart := now.AddDate(0, 0, -65)
	periodEnd := now.AddDate(0, 0, 5)

	windows := MembershipDueWindows(periodStart, periodEnd, 0, now)
	if len(windows) != 3 {
		t.Fatalf("windows = %+v, want 3", windows)
	}
	if windows[0].Index != 1 || !windows[0].Start.Equal(periodStart) {
		t.Fatalf("first window = %+v", windows[0])
	}
	if windows[2].Index != 3 || !windows[2].End.Equal(periodEnd) {
		t.Fatalf("last window must be truncated to period end: %+v", windows[2])
	}
}

func TestMembershipDueWindowsSkipsGrantedWindows(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	periodStart := now.AddDate(0, 0, -65)
	periodEnd := now.AddDate(0, 0, 5)

	windows := MembershipDueWindows(periodStart, periodEnd, 2, now)
	if len(windows) != 1 || windows[0].Index != 3 {
		t.Fatalf("windows = %+v, want only window 3", windows)
	}
}

func TestMembershipDueWindowsDoesNotGrantFutureWindow(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	if windows := MembershipDueWindows(now, now.AddDate(0, 1, 0), 0, now); len(windows) != 0 {
		t.Fatalf("future window must not be due: %+v", windows)
	}
}
