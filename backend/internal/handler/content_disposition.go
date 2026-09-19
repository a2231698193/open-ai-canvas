package handler

import (
	"mime"
	"strings"
	"unicode"
)

const maxAttachmentFileNameLength = 180

func attachmentDisposition(fileName string) string {
	fileName = sanitizeAttachmentFileName(fileName)
	if fileName == "" {
		return "attachment"
	}
	return mime.FormatMediaType("attachment", map[string]string{"filename": fileName})
}

func sanitizeAttachmentFileName(fileName string) string {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" {
		return ""
	}
	var builder strings.Builder
	builder.Grow(len(fileName))
	for _, char := range fileName {
		if char < 32 || char == 127 || char == '/' || char == '\\' || char == ':' {
			builder.WriteByte('_')
			continue
		}
		if unicode.IsSpace(char) {
			builder.WriteByte(' ')
			continue
		}
		builder.WriteRune(char)
	}
	fileName = strings.TrimSpace(strings.Trim(builder.String(), "."))
	if len(fileName) > maxAttachmentFileNameLength {
		fileName = strings.TrimSpace(fileName[:maxAttachmentFileNameLength])
	}
	return fileName
}
