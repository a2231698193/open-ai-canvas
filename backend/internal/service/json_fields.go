package service

import (
	"fmt"
	"strings"
)

// optionalJSONString reads an optional untyped JSON string.
// Missing or null yields "". A present non-string is a protocol error and is not coerced.
func optionalJSONString(payload map[string]any, key string) (string, error) {
	if payload == nil {
		return "", nil
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("field %s: expected string, got %T", key, value)
	}
	return text, nil
}

// requireJSONString reads a required non-empty JSON string.
func requireJSONString(payload map[string]any, key string) (string, error) {
	text, err := optionalJSONString(payload, key)
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("missing field: %s", key)
	}
	return text, nil
}

// firstJSONString returns the first present non-empty string among keys.
// Missing keys are skipped. A present non-string is a protocol error unless a later key supplies a valid string.
func firstJSONString(payload map[string]any, keys ...string) (string, error) {
	var typeErr error
	for _, key := range keys {
		text, err := optionalJSONString(payload, key)
		if err != nil {
			if typeErr == nil {
				typeErr = err
			}
			continue
		}
		text = strings.TrimSpace(text)
		if text != "" {
			return text, nil
		}
	}
	if typeErr != nil {
		return "", typeErr
	}
	return "", nil
}
