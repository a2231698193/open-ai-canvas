package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newSQLiteTestDB 打开一个测试用的 SQLite 库。
//
// 默认写法 `file:<id>?mode=memory&cache=shared` 在"后台 worker 并发写 + 测试线程读"时会报
// `database table is locked`：共享缓存模式下 SQLite 用的是**表级锁**（SQLITE_LOCKED），
// 它不受 `_busy_timeout` 约束（那只管 SQLITE_BUSY），只能靠 `sqlite3_unlock_notify` 重试，
// 而当前驱动没有启用。实测并发读写 400 次能撞到 70+ 次，CI 上因此偶发失败
// （TestDeleteGeneratedAssetTaskReferences/cancelled_output 就是这样挂的）。
//
// 因此凡是会触发后台删除 outbox（`go s.drainResourceDeletionJobs`）的用例，统一用
// 文件库 + WAL + busy_timeout：WAL 允许"一写多读"并发，写冲突退化成 SQLITE_BUSY 并由
// busy_timeout 重试。
//
// 库文件刻意放在 `os.MkdirTemp` 而不是 `t.TempDir()` 下：outbox goroutine 可能在用例返回后
// 仍在写库，`t.TempDir()` 的清理遇到这种写入会以 "directory not empty" 直接判失败，
// 而它本身与用例断言无关。
func newSQLiteTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	directory, err := os.MkdirTemp("", "canvas-test-db-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	db, err := gorm.Open(sqlite.Open(filepath.Join(directory, "test.db")+"?_journal_mode=WAL&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

// TestSQLiteTestDBAllowsConcurrentReadWrite 守的是 newSQLiteTestDB 的选型：并发读写不得报锁。
// 换回 `mode=memory&cache=shared` 会立刻变红（见上面的机制说明）。
func TestSQLiteTestDBAllowsConcurrentReadWrite(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.Exec("create table lock_probe (id integer primary key, value text)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("insert into lock_probe (id, value) values (1, 'a')").Error; err != nil {
		t.Fatal(err)
	}

	var mutex sync.Mutex
	var failure error
	record := func(err error) {
		if err == nil {
			return
		}
		mutex.Lock()
		defer mutex.Unlock()
		if failure == nil {
			failure = err
		}
	}

	stop := make(chan struct{})
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			var count int64
			record(db.Table("lock_probe").Count(&count).Error)
		}
	}()
	go func() {
		defer workers.Done()
		defer close(stop)
		for index := 0; index < 300; index++ {
			record(db.Exec("update lock_probe set value = ? where id = 1", fmt.Sprint(index)).Error)
			time.Sleep(time.Millisecond)
		}
	}()
	workers.Wait()

	if failure != nil {
		if strings.Contains(failure.Error(), "locked") {
			t.Fatalf("并发读写命中 SQLite 锁：%v（说明测试库不该回退到共享缓存内存库）", failure)
		}
		t.Fatalf("并发读写失败：%v", failure)
	}
}
