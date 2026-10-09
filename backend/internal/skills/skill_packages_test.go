package skills

import (
	"archive/zip"
	"bytes"
	"fmt"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type builtinSkillDefinition struct {
	SkillID     string
	SkillName   string
	Description string
	Instruction string
}

func TestArchiveFromMarkdownInfersMetadata(t *testing.T) {
	archive, err := archiveFromMarkdown([]byte("# 小说转分镜\n\n把小说段落拆成可拍摄的镜头。\n"), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Name != "小说转分镜" || archive.Metadata.Description != "把小说段落拆成可拍摄的镜头。" {
		t.Fatalf("metadata = %#v", archive.Metadata)
	}
	if string(archive.Files["SKILL.md"]) == "" || archive.ContentHash == "" {
		t.Fatal("archive did not preserve the entry file or compute a hash")
	}
}

func TestBuiltinSkillPackageBoundsMetadata(t *testing.T) {
	skill := builtinSkillDefinition{
		SkillID:     "test-builtin-skill",
		SkillName:   "测试技能",
		Description: strings.Repeat("描述内容。", 140),
		Instruction: "# 测试技能\n\n保留完整正文。\n",
	}
	archive, err := archiveFromMarkdown([]byte(skill.Instruction), skill.SkillName, skill.Description)
	if err != nil {
		t.Fatal(err)
	}
	if got := len([]rune(archive.Metadata.Description)); got > 500 {
		t.Fatalf("builtin skill metadata description length = %d, want <= 500", got)
	}
	if string(archive.Files["SKILL.md"]) != skill.Instruction {
		t.Fatal("builtin skill package must preserve the complete instruction")
	}
}

func TestEnsureSkillPackagesBoundsLegacyFallbackMetadata(t *testing.T) {
	for _, source := range []int{3, skillSourceUser} {
		db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
			t.Fatal(err)
		}
		svc := New(repository.New(db), t.TempDir(), nil)
		skill := model.Skill{ID: kernel.NewID(), Name: strings.Repeat("名", 81), Description: strings.Repeat("文", 503), Instruction: "## 旧技能\n", Status: skillStatusEnabled, Source: source}
		if err := db.Create(&skill).Error; err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if err := svc.EnsureSkillPackages(); err != nil {
				t.Fatal(err)
			}
		}
		assertSkillVersionCount(t, db, skill.ID, 1)
		var saved model.Skill
		if err := db.First(&saved, "id = ?", skill.ID).Error; err != nil {
			t.Fatal(err)
		}
		if saved.Name != skill.Name || saved.Description != skill.Description || saved.Instruction != skill.Instruction {
			t.Fatal("migration changed original skill fields")
		}
		version, err := svc.repo.SkillVersion(saved.CurrentVersionID)
		if err != nil {
			t.Fatal(err)
		}
		body, err := svc.readSkillArchiveEntry(version, "SKILL.md")
		if err != nil || string(body) != skill.Instruction {
			t.Fatalf("original instruction not preserved: %v", err)
		}
	}
	if _, err := archiveFromMarkdown([]byte("## 旧技能\n"), strings.Repeat("名", 81), strings.Repeat("文", 503)); err == nil {
		t.Fatal("non-migration archive input must still reject oversized fallback metadata")
	}
}

func TestArchiveFromMarkdownTruncatesInferredDescriptionWithinLimit(t *testing.T) {
	longDescription := bytes.Repeat([]byte("描述内容。"), 140)
	data := append([]byte("# 风格库四级匹配序\n\n"), longDescription...)

	archive, err := archiveFromMarkdown(data, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := len([]rune(archive.Metadata.Description)); got > 500 {
		t.Fatalf("inferred description length = %d, want <= 500", got)
	}
	if archive.Metadata.Description == "" {
		t.Fatal("inferred description is empty")
	}
	if !bytes.Equal(archive.Files["SKILL.md"], data) {
		t.Fatal("metadata truncation changed the original instruction")
	}
}

func TestSkillMetadataLengthBoundaries(t *testing.T) {
	for _, length := range []int{499, 500, 501, 553} {
		value := strings.Repeat("文", length)
		markdown := []byte("# 技能\n\n" + value)
		archive, err := archiveFromMarkdown(markdown, "", "")
		if err != nil {
			t.Fatalf("description length %d: %v", length, err)
		}
		want := value
		if length > 500 {
			want = strings.Repeat("文", 497) + "..."
		}
		if archive.Metadata.Description != want {
			t.Fatalf("description length %d: unexpected truncation", length)
		}
	}
	metadata := parseSkillPackageMetadata([]byte("---\nname: " + strings.Repeat("名", 81) + "\ndescription: " + strings.Repeat("文", 501) + "\nmetadata:\n  version: " + strings.Repeat("版", 65) + "\n---\n"))
	if len([]rune(metadata.Name)) != 80 || len([]rune(metadata.Description)) != 500 || len([]rune(metadata.Version)) != 64 {
		t.Fatalf("metadata exceeds bounds: %#v", metadata)
	}
	// Supplied metadata still goes through strict validation; no widening of
	// the archive contract is needed to fix inferred display metadata.
	if _, err := finalizeSkillArchive(map[string][]byte{"SKILL.md": []byte("# 技能")}, skillPackageMetadata{Name: "技能", Description: strings.Repeat("文", 501)}); err == nil {
		t.Fatal("expected overlong archive metadata to be rejected")
	}
}

func TestArchiveFromZipNormalizesWrapperAndNestedFiles(t *testing.T) {
	data := skillZip(t, map[string]string{
		"director-main/SKILL.md":             "---\nname: AI 导演\ndescription: 导演工作流\nmetadata:\n  version: 2.1\n---\n",
		"director-main/references/camera.md": "# Camera",
		"director-main/scripts/check.js":     "export default true",
	})
	archive, err := archiveFromZip(data, "")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Version != "2.1" || len(archive.Files) != 3 {
		t.Fatalf("archive = %#v", archive)
	}
	if string(archive.Files["references/camera.md"]) != "# Camera" {
		t.Fatalf("nested file missing: %#v", archive.Files)
	}
}

func TestArchiveFromZipRejectsTraversalAndMultipleSkills(t *testing.T) {
	for name, files := range map[string]map[string]string{
		"traversal": {"../SKILL.md": "# Bad"},
		"multiple": {
			"one/SKILL.md": "# One\n\nFirst",
			"two/SKILL.md": "# Two\n\nSecond",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := archiveFromZip(skillZip(t, files), ""); err == nil {
				t.Fatal("expected package validation error")
			}
		})
	}
}

func TestSkillPackageLargerThan20MiBCanBeReadAfterPersistence(t *testing.T) {
	files := map[string][]byte{"SKILL.md": []byte("# Large skill\n\nA large skill package.")}
	for index := 0; index < 3; index++ {
		files[fmt.Sprintf("assets/%d.bin", index)] = bytes.Repeat([]byte("x"), 8<<20)
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for filePath, content := range files {
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: filePath, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if buffer.Len() <= 20<<20 || buffer.Len() > maxSkillPackageBytes || SkillPackageUploadMaxBytes != 101<<20 {
		t.Fatal("large ZIP must fit the 100 MiB file and 101 MiB request limits")
	}
	archive, err := archiveFromZip(buffer.Bytes(), "")
	if err != nil {
		t.Fatal(err)
	}
	svc := New(nil, t.TempDir(), nil)
	packageKey, _, _, err := svc.persistSkillArchive("large-skill", "version", archive, "")
	if err != nil {
		t.Fatal(err)
	}
	contents, err := readSkillArchiveEntries(svc.dataDir, packageKey)
	if err != nil {
		t.Fatal(err)
	}
	for filePath, content := range files {
		if !bytes.Equal(contents[filePath], content) {
			t.Fatalf("persisted file %s differs", filePath)
		}
	}
}

func TestSkillPackageFileCountIgnoresDirectoriesAndMacJunk(t *testing.T) {
	var noisy bytes.Buffer
	writer := zip.NewWriter(&noisy)
	add := func(name, content string, directory bool) {
		t.Helper()
		header := &zip.FileHeader{Name: name, Method: zip.Store}
		if directory {
			header.SetMode(os.ModeDir | 0o755)
		}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if directory {
			return
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	add("SKILL.md", "# Skill\n\nDescription.", false)
	for index := 0; index < 600; index++ {
		add(fmt.Sprintf("refs/%d/", index), "", true)
		add(fmt.Sprintf("refs/%d.md", index), "x", false)
		add(fmt.Sprintf("__MACOSX/refs/._%d.md", index), "junk", false)
		add(".DS_Store", "junk", false)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(noisy.Bytes()), int64(noisy.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.File) <= 512+64 {
		t.Fatal("fixture must exceed the old raw entry ceiling")
	}
	archive, err := archiveFromZip(noisy.Bytes(), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.Files) != 601 {
		t.Fatalf("counted files = %d, want 601", len(archive.Files))
	}

	over := map[string]string{"SKILL.md": "# Skill\n\nDescription."}
	for index := 0; index < maxSkillPackageFiles; index++ {
		over[fmt.Sprintf("refs/%d.md", index)] = "x"
	}
	if _, err := archiveFromZip(skillZip(t, over), ""); err == nil || !strings.Contains(err.Error(), "4096") {
		t.Fatalf("expected file count error, got %v", err)
	}
}

func TestSkillPackageGitDirectoryDoesNotBlockReading(t *testing.T) {
	archive, err := archiveFromZip(skillZip(t, map[string]string{
		"omniailab-ai-director/SKILL.md":    "# Skill\n\nDescription.",
		"omniailab-ai-director/.git/config": "[core]\n",
		"omniailab-ai-director/notes.md":    "notes",
	}), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := archive.Files[".git/config"]; exists || archive.Files["notes.md"] == nil {
		t.Fatalf("import should drop .git and keep skill files: %#v", archive.Files)
	}

	data, err := encodeSkillArchive(map[string][]byte{
		"SKILL.md":    []byte("# Skill\n\nDescription."),
		".git/config": []byte("[core]\n"),
	})
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	dir := filepath.Join(root, "skill-packages")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pkg.zip"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	contents, err := readSkillArchiveEntries(root, "pkg.zip")
	if err != nil {
		t.Fatal(err)
	}
	if string(contents[".git/config"]) != "[core]\n" || contents["SKILL.md"] == nil {
		t.Fatalf("stored package should stay readable, got %#v", contents)
	}
	if _, err := normalizeSkillPath("docs/../../secret"); err == nil {
		t.Fatal("expected path traversal to be rejected")
	}
}

func TestSkillPackageSizeLimits(t *testing.T) {
	files := map[string]string{"SKILL.md": "# Large skill\n\nA large skill package."}
	for index := 0; index < 13; index++ {
		files[fmt.Sprintf("assets/%d.bin", index)] = strings.Repeat("x", 8<<20)
	}
	if _, err := archiveFromZip(skillZip(t, files), ""); err == nil || !strings.Contains(err.Error(), "100MB") {
		t.Fatalf("expected decompression limit error, got %v", err)
	}
	if _, err := archiveFromZip(skillZip(t, map[string]string{
		"SKILL.md":  "# Skill\n\nDescription.",
		"asset.bin": strings.Repeat("x", (8<<20)+1),
	}), ""); err != nil {
		t.Fatalf("file above 8MB must fit the package limit, got %v", err)
	}
	if _, err := archiveFromZip(skillZip(t, map[string]string{
		"SKILL.md":  "# Skill\n\nDescription.",
		"asset.bin": strings.Repeat("x", maxSkillFileBytes+1),
	}), ""); err == nil || !strings.Contains(err.Error(), "单个文件") {
		t.Fatalf("expected single-file limit error, got %v", err)
	}
	svc := New(nil, t.TempDir(), nil)
	if _, err := svc.InstallSkillUpload("user", "zip", &multipart.FileHeader{Size: (100 << 20) + 1}, SkillInstallRequest{}); err == nil || !strings.Contains(err.Error(), "100MB") {
		t.Fatalf("expected upload limit error, got %v", err)
	}
}

func TestParseGitHubSkillURL(t *testing.T) {
	spec, err := parseGitHubSkillURL("https://github.com/ddcat-ai/open-ai-canvas/tree/main/skills/canvas-context", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Owner != "ddcat-ai" || spec.Repo != "open-ai-canvas" || spec.Ref != "main" || spec.Subdir != "skills/canvas-context" {
		t.Fatalf("spec = %#v", spec)
	}
	if _, err := parseGitHubSkillURL("https://github.com/ddcat-ai/open-ai-canvas/blob/main/SKILL.md", "", ""); err == nil {
		t.Fatal("expected blob URL to be rejected")
	}
}

func TestArchiveFromMarkdownKeepsInferredMetadataWithinLimits(t *testing.T) {
	longName := strings.Repeat("名", 100)
	longDescription := strings.Repeat("简介", 300)
	for name, data := range map[string]string{
		"heading":     "# " + longName + "\n\n" + longDescription + "\n",
		"frontmatter": "---\nname: " + longName + "\ndescription: " + longDescription + "\n---\n\n正文",
	} {
		t.Run(name, func(t *testing.T) {
			archive, err := archiveFromMarkdown([]byte(data), "", "")
			if err != nil {
				t.Fatal(err)
			}
			if got := utf8.RuneCountInString(archive.Metadata.Name); got > 80 {
				t.Fatalf("name runes = %d, want <= 80", got)
			}
			if got := utf8.RuneCountInString(archive.Metadata.Description); got > 500 {
				t.Fatalf("description runes = %d, want <= 500", got)
			}
		})
	}
}

func TestEnsureSkillPackagesMigratesSkillWithLongInstructionMetadata(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	skill := model.Skill{
		ID:          kernel.NewID(),
		Name:        "长标题技能",
		Description: "描述",
		Instruction: "# " + strings.Repeat("长", 100) + "\n\n" + strings.Repeat("文", 600),
		Status:      skillStatusEnabled,
		Source:      3,
	}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, skill.ID, 1)
}

func TestEnsureSkillPackagesMigratesAndRefreshesBuiltinSkills(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	builtin := model.Skill{ID: kernel.NewID(), Name: "内置导演", Description: "内置工作流", Instruction: "# 内置导演\n\n第一版", Status: skillStatusEnabled, Source: 3}
	userSkill := model.Skill{ID: kernel.NewID(), Name: "用户技能", Description: "用户工作流", Instruction: "# 用户技能\n\n第一版", Status: skillStatusEnabled, Source: skillSourceUser}
	if err := db.Create(&builtin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&userSkill).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 1)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 1)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	if err := db.Model(&model.Skill{}).Where("id = ?", builtin.ID).Update("instruction", "# 内置导演\n\n第二版").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", userSkill.ID).Update("instruction", "# 用户技能\n\n不应在启动时重建").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 1)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	var refreshed model.Skill
	if err := db.First(&refreshed, "id = ?", builtin.ID).Error; err != nil {
		t.Fatal(err)
	}
	version, err := svc.repo.SkillVersion(refreshed.CurrentVersionID)
	if err != nil {
		t.Fatal(err)
	}
	body, err := svc.readSkillArchiveEntry(version, "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "# 内置导演\n\n第一版" {
		t.Fatalf("legacy package was unexpectedly rewritten: %q", body)
	}
}

func assertSkillVersionCount(t *testing.T, db *gorm.DB, skillID string, want int64) {
	t.Helper()
	var got int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", skillID).Count(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("skill %s version count = %d, want %d", skillID, got, want)
	}
}

func skillZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for filePath, content := range files {
		entry, err := writer.Create(filePath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
