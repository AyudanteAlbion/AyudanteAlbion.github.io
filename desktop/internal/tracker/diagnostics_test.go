package tracker

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProtocolDiagnosticsContainOnlyCodesAndCounts(t *testing.T) {
	codes := testCodes(t)
	store := &CodeStore{}
	store.set(codes, "")
	diagnostics := newProtocolDiagnostics()
	diagnostics.setEnabled(true)
	diagnostics.envelope(true, 29)
	diagnostics.logical(true, 231)
	diagnostics.envelope(false, 2)
	diagnostics.logical(false, 41)
	diagnostics.missingCode(true)
	encoded, err := json.Marshal(diagnostics.snapshot(store))
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, forbidden := range []string{"SecretCharacter", "00000000-0000-0000-0000-000000000001", "packetContents", "parameters"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("diagnostics leaked %q: %s", forbidden, text)
		}
	}
	if !strings.Contains(text, "missingAuthoritativeCodes") || !strings.Contains(text, "PartyJoined") || !strings.Contains(text, "ChangeCluster") {
		t.Fatalf("diagnostics lack safe metadata: %s", text)
	}
}

func TestSocketExposesSameSafeDiagnosticsContract(t *testing.T) {
	var source Diagnosable = NewSocketSource(&CodeStore{})
	source.SetDiagnostic(true)
	if enabled, ok := source.Diagnostic()["enabled"].(bool); !ok || !enabled {
		t.Fatalf("Socket diagnostics = %#v", source.Diagnostic())
	}
}
