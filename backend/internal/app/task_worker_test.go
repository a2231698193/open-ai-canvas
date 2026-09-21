package app

import (
	"context"
	"testing"
	"time"
)

// 续租必须比"这条任务的执行时限"活得更久：否则父 context 到点时，续租请求会被自己的
// 执行时限取消，失败后被误判成"租约失效"（任务停在 running，租约过期后被别的 worker 重跑）。
func TestTaskLeaseRenewContextSurvivesExecutionDeadline(t *testing.T) {
	parent, cancelParent := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancelParent()
	<-parent.Done()
	if parent.Err() == nil {
		t.Fatal("父 context 应当已到点")
	}

	renew, cancelRenew := taskLeaseRenewContext(parent)
	defer cancelRenew()
	if err := renew.Err(); err != nil {
		t.Fatalf("父 context 到点后，续租 context 不该被取消：%v", err)
	}
	deadline, ok := renew.Deadline()
	if !ok {
		t.Fatal("续租 context 必须保有自己的上限")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > 5*time.Second {
		t.Fatalf("续租上限应当是全新的 5 秒，实际剩余 %v", remaining)
	}

	// 父 context 之后再取消，也不能把已经建好的续租 context 一起取消（worker 退出时
	// 续租请求最多自己超时，而不是被"任务已结束"顺手打断）。
	parent2, cancelParent2 := context.WithCancel(context.Background())
	renew2, cancelRenew2 := taskLeaseRenewContext(parent2)
	defer cancelRenew2()
	cancelParent2()
	if err := renew2.Err(); err != nil {
		t.Fatalf("父 context 取消不该连带取消续租 context：%v", err)
	}
}
