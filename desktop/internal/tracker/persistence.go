// SPDX-License-Identifier: GPL-3.0-only

package tracker

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type sessionStore struct{ directory string }

func newSessionStore() *sessionStore {
	root, err := os.UserConfigDir()
	if err != nil || root == "" {
		return nil
	}
	return &sessionStore{directory: filepath.Join(root, "AyudanteAlbion", "sessions")}
}

func safeFilePart(value string) string {
	value = strings.TrimSpace(value)
	var builder strings.Builder
	for _, char := range value {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' {
			builder.WriteRune(char)
		}
	}
	if builder.Len() == 0 {
		return "character"
	}
	return builder.String()
}

// Save persists only confirmed, real sessions. Demo data and pre-identity
// packets can never create a statistics snapshot.
func (s *sessionStore) Save(snapshot Snapshot) error {
	if s == nil || !snapshot.Identity.Valid || !snapshot.Identity.FilterMatched || snapshot.Simulated {
		return nil
	}
	if err := os.MkdirAll(s.directory, 0700); err != nil {
		return err
	}
	date := time.UnixMilli(snapshot.StartedAt).Format("2006-01-02")
	name := fmt.Sprintf("%s-%s-%d.json", date, safeFilePart(snapshot.Identity.Name), snapshot.StartedAt)
	path := filepath.Join(s.directory, name)
	temporary := path + ".tmp"
	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(temporary, data, 0600); err != nil {
		return err
	}
	if err = os.Rename(temporary, path); err == nil {
		return nil
	}
	// Windows does not replace an existing destination with os.Rename.
	if removeErr := os.Remove(path); removeErr != nil && !os.IsNotExist(removeErr) {
		return err
	}
	return os.Rename(temporary, path)
}
