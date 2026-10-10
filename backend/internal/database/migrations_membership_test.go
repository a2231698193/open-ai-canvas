package database

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func openMigratedMembershipDB(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "membership-migration.db")
	db, err := Open(Config{Driver: "sqlite", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	return db, dsn
}

func TestMembershipMigrationCreatesTablesColumnsAndActiveIndex(t *testing.T) {
	db, _ := openMigratedMembershipDB(t)

	for _, table := range []any{&model.MembershipPlan{}, &model.UserMembership{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing migrated table %T", table)
		}
	}
	for _, column := range []struct {
		model  any
		column string
	}{{&model.CreditAccount{}, "MembershipMicrocredits"}, {&model.CreditAccount{}, "MembershipExpiresAt"}} {
		if !db.Migrator().HasColumn(column.model, column.column) {
			t.Fatalf("missing column %s on %T", column.column, column.model)
		}
	}
	if !db.Migrator().HasIndex(&model.UserMembership{}, "idx_user_memberships_active_user") {
		t.Fatal("missing partial unique index idx_user_memberships_active_user")
	}
}

func TestMembershipMigrationUpgradesV49Database(t *testing.T) {
	db, dsn := openMigratedMembershipDB(t)

	// 还原成 v49 形态：去掉 v50 的对象并回退迁移台账，验证老库可原地升级。
	if err := db.Migrator().DropTable(&model.MembershipPlan{}, &model.UserMembership{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.CreditAccount{}, "MembershipMicrocredits"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.CreditAccount{}, "MembershipExpiresAt"); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_user_memberships_active_user").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version > ?", 49).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		if err := RequireSchemaVersion(db); err != nil {
			t.Fatal(err)
		}
	}

	if !db.Migrator().HasTable(&model.MembershipPlan{}) || !db.Migrator().HasTable(&model.UserMembership{}) {
		t.Fatal("v49 database was not upgraded with membership tables")
	}
	if !db.Migrator().HasIndex(&model.UserMembership{}, "idx_user_memberships_active_user") {
		t.Fatal("v49 database was not upgraded with membership active index")
	}
	_ = dsn
}

func TestMembershipMigrationBackfillsExistingCreditAccounts(t *testing.T) {
	// 模拟 v49 生产库：已有积分账户行，升级后会员列必须回填 0 而不是 NULL，
	// 否则发放的 `membership_microcredits + ?` 会算出 NULL，余额永远是空。
	dsn := filepath.Join(t.TempDir(), "membership-backfill.db")
	db, err := Open(Config{Driver: "sqlite", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	// 还原 v49 形态：删掉 v50+ 对象，插入一份旧的账户行。
	if err := db.Migrator().DropTable(&model.MembershipPlan{}, &model.UserMembership{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.CreditAccount{}, "MembershipMicrocredits"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.CreditAccount{}, "MembershipExpiresAt"); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_user_memberships_active_user").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version > ?", 49).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO credit_accounts (user_id, available_microcredits, reserved_microcredits, version) VALUES ('legacy-user', 100, 5, 1)").Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}

	var raw struct {
		MembershipMicrocredits *int64
	}
	if err := db.Raw("SELECT membership_microcredits FROM credit_accounts WHERE user_id = ?", "legacy-user").Scan(&raw).Error; err != nil {
		t.Fatal(err)
	}
	if raw.MembershipMicrocredits == nil || *raw.MembershipMicrocredits != 0 {
		t.Fatalf("legacy account membership column must be backfilled to 0, got %v", raw.MembershipMicrocredits)
	}
}
