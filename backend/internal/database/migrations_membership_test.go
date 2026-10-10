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
