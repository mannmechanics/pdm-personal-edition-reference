package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// Guardrail test: ensure the audit root field name stays aligned with docs/UI/output.
func TestStepTraceJSON_FieldName_HashChainRoot(t *testing.T) {
	tr := StepTrace{HashChainRoot: "abc"}
	b, err := json.Marshal(tr)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	s := string(b)
	if !strings.Contains(s, `"hash_chain_root"`) {
		t.Fatalf("expected JSON to contain hash_chain_root, got: %s", s)
	}
	if strings.Contains(s, `"merkle_root"`) {
		t.Fatalf("did not expect merkle_root in JSON, got: %s", s)
	}
}
