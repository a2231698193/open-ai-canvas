package service

import "strings"

func resourceFileURL(id string) string {
	return "/api/resources/" + id + "/file"
}

func isResourceFileURL(value string) bool {
	return resourceIDFromFileURL(value) != ""
}

func resourceIDFromFileURL(value string) string {
	const prefix = "/api/resources/"
	value = strings.TrimSpace(value)
	index := strings.Index(value, prefix)
	if index < 0 {
		return ""
	}
	remainder := value[index+len(prefix):]
	if remainder == "" {
		return ""
	}
	if end := strings.IndexAny(remainder, "/?#"); end >= 0 {
		remainder = remainder[:end]
	}
	return remainder
}
