package app

import (
	"net/http"
	"strings"
	"testing"
)

func TestParseObjectStorageXMLError(t *testing.T) {
	code, message := parseObjectStorageXMLError([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>InvalidBucketName</Code>
  <Message>The specified bucket is not valid.</Message>
  <RequestId>request-id</RequestId>
</Error>`))
	if code != "InvalidBucketName" {
		t.Fatalf("code = %q", code)
	}
	if message != "The specified bucket is not valid." {
		t.Fatalf("message = %q", message)
	}
}

func TestSanitizeObjectStorageMessageDropsSignatureMaterial(t *testing.T) {
	_, message := parseObjectStorageXMLError([]byte(`<Error><Code>SignatureDoesNotMatch</Code><Message>signature mismatch</Message></Error>`))
	if message != "" {
		t.Fatalf("message = %q", message)
	}
}

func TestObjectStorageHTTPErrorUsesPublicHint(t *testing.T) {
	err := newObjectStorageHTTPError(aliyunOSSProvider, "写入", http.StatusBadRequest, []byte(`<Error><Code>InvalidBucketName</Code><Message>The specified bucket is not valid.</Message></Error>`))
	storageErr, ok := err.(*objectStorageError)
	if !ok {
		t.Fatalf("type = %T", err)
	}
	if storageErr.Code != "InvalidBucketName" || storageErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("%#v", storageErr)
	}
	if !strings.Contains(storageErr.Error(), "Bucket 名称无效") || !strings.Contains(storageErr.Error(), "InvalidBucketName") {
		t.Fatalf("error = %q", storageErr.Error())
	}
	if strings.Contains(storageErr.Error(), "specified bucket") {
		t.Fatalf("leaked upstream message: %q", storageErr.Error())
	}
}
