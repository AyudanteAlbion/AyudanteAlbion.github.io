package tracker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func mutateShippedCodes(t *testing.T, mutate func(map[string]any)) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "..", "albion-app", "data", "photon_codes.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var table map[string]any
	if err = json.Unmarshal(raw, &table); err != nil {
		t.Fatal(err)
	}
	mutate(table)
	raw, err = json.Marshal(table)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestCodeTableRejectsInvalidActivation(t *testing.T) {
	cases := map[string]func(map[string]any){
		"missing version":       func(table map[string]any) { delete(table, "version") },
		"wrong event authority": func(table map[string]any) { table["parameterKeys"].(map[string]any)["eventCode"] = float64(251) },
		"missing canonical guid": func(table map[string]any) {
			delete(table["selfOperation"].(map[string]any)["parameters"].(map[string]any), "guid")
		},
		"missing ChangeCluster schema": func(table map[string]any) {
			delete(table["eventParameters"].(map[string]any)["ChangeCluster"].(map[string]any), "zone")
		},
		"duplicate event code": func(table map[string]any) {
			events := table["events"].(map[string]any)
			events["Leave"] = events["JoinFinished"]
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parseCodes(mutateShippedCodes(t, mutate), name); err == nil {
				t.Fatal("invalid table activated")
			}
		})
	}
}

func TestReloadKeepsLastValidTableWhenExternalEditIsInvalid(t *testing.T) {
	current := shippedCodes(t)
	path := filepath.Join(t.TempDir(), "photon_codes.json")
	if err := os.WriteFile(path, []byte(`{"version":"broken"}`), 0600); err != nil {
		t.Fatal(err)
	}
	store := NewCodeStore(nil, path)
	store.set(current, "")
	if loaded, err := store.Load(); err == nil || loaded != nil {
		t.Fatal("invalid external edit replaced the active table")
	}
	kept, warning := store.Current()
	if kept != current || warning == "" {
		t.Fatalf("last valid table was not preserved: kept=%v warning=%q", kept == current, warning)
	}
}

func TestCodeTableRejectsTrailingJSON(t *testing.T) {
	raw := mutateShippedCodes(t, func(map[string]any) {})
	raw = append(raw, []byte(" {}")...)
	if _, err := parseCodes(raw, "trailing"); err == nil {
		t.Fatal("trailing JSON activated")
	}
}
