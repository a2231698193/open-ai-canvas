package handler

import (
	"strings"
	"testing"
)

func TestAttachmentDispositionUsesFilenameParameter(t *testing.T) {
	got := attachmentDisposition("角色三视图.png")
	if !strings.Contains(got, "attachment") {
		t.Fatalf("disposition = %q", got)
	}
	if !strings.Contains(got, "filename") || !strings.Contains(got, "png") {
		t.Fatalf("disposition = %q, want filename", got)
	}
}

func TestAttachmentDispositionStripsPathAndControlCharacters(t *testing.T) {
	got := attachmentDisposition(" ../evil\nname:.png ")
	if strings.Contains(got, "/") || strings.Contains(got, "\\") || strings.Contains(got, "\n") || strings.Contains(got, ":") {
		t.Fatalf("disposition = %q", got)
	}
	if !strings.Contains(got, "attachment") {
		t.Fatalf("disposition = %q", got)
	}
}

func TestAttachmentDispositionEmptyName(t *testing.T) {
	if got := attachmentDisposition("   "); got != "attachment" {
		t.Fatalf("disposition = %q", got)
	}
}
