package database

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
)

func TestSkillLibraryMigrationPreservesV38UserState(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "skills-upgrade.db")})
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
	// Restore the schema shape and migration ledger of a v38 database.
	if err := db.Migrator().DropTable(&model.SkillLibraryCategory{}, &model.BuiltinSkillTombstone{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.UserSkillState{}, "LibraryCategoryID"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version > ?", 38).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO user_skill_states (id, user_id, skill_id, added, liked) VALUES (?, ?, ?, ?, ?)", "legacy-state", "user", "16000000000106", true, true).Error; err != nil {
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
	for _, table := range []any{&model.SkillLibraryCategory{}, &model.BuiltinSkillTombstone{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing migrated table %T", table)
		}
	}
	var state model.UserSkillState
	if err := db.First(&state, "id = ?", "legacy-state").Error; err != nil {
		t.Fatal(err)
	}
	if state.UserID != "user" || state.SkillID != "16000000000106" || !state.Added || !state.Liked || state.LibraryCategoryID != "" {
		t.Fatalf("legacy skill relationship changed: %#v", state)
	}
}
