// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type failingSource struct {
	done chan struct{}
}

func (f failingSource) Name() string                 { return "failing source" }
func (f failingSource) Available() (bool, string)    { return true, "" }
func (f failingSource) Run(context.Context, *State, *Hub) error {
	close(f.done)
	return errors.New("the capture handle closed")
}

func TestEngineReportsUnexpectedSourceExit(t *testing.T) {
	source := failingSource{done: make(chan struct{})}
	engine := NewEngine(source, nil, nil)
	if err := engine.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-source.done:
	case <-time.After(time.Second):
		t.Fatal("source was not started")
	}

	deadline := time.Now().Add(time.Second)
	for {
		running, runError := engine.runStatus()
		if !running {
			if runError != "the capture handle closed" {
				t.Fatalf("run error = %q, want source failure", runError)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("Engine remained running after Source.Run returned")
		}
		time.Sleep(time.Millisecond)
	}
}

// blockingSource keeps running until the context is cancelled, so the test can
// tell apart "the capture survived" from "the capture was torn down".
type blockingSource struct {
	runs chan struct{}
}

func (b blockingSource) Name() string              { return "blocking source" }
func (b blockingSource) Available() (bool, string) { return true, "" }
func (b blockingSource) Run(ctx context.Context, _ *State, _ *Hub) error {
	b.runs <- struct{}{}
	<-ctx.Done()
	return ctx.Err()
}

// "Detectar de nuevo" must never tear down a live capture. It used to call
// Stop()+Start(), which dropped the Photon/server-confirmed progress the user
// already had, so the button appeared to break the working connection.
func TestRefreshCharacterKeepsLiveCaptureAndIdentity(t *testing.T) {
	source := blockingSource{runs: make(chan struct{}, 4)}
	engine := NewEngine(source, nil, nil)
	if err := engine.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-source.runs:
	case <-time.After(time.Second):
		t.Fatal("source was not started")
	}
	defer engine.Stop()

	identity := LocalIdentity{ObjectID: 7, GUID: "00000000-0000-0000-0000-00000000000a", Name: "Detected"}
	if !engine.state.ApplyJoinIdentity(identity) {
		t.Fatal("identity was not applied")
	}
	if !engine.state.AddFame(25) {
		t.Fatal("metrics were not enabled by a valid identity")
	}

	mux := http.NewServeMux()
	engine.Register(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/tracker/character/refresh", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var body struct {
		OK       bool `json:"ok"`
		Started  bool `json:"started"`
		Detected bool `json:"detected"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	if !body.OK || !body.Detected {
		t.Fatalf("body = %+v, want ok and detected", body)
	}
	if body.Started {
		t.Fatal("a live capture must not be restarted by a character refresh")
	}
	// A restart would have pushed a second value into runs.
	select {
	case <-source.runs:
		t.Fatal("the capture source was restarted")
	case <-time.After(50 * time.Millisecond):
	}
	if !engine.running() {
		t.Fatal("the capture was stopped by a character refresh")
	}
	if got := engine.state.Identity(); !got.Valid || got.Name != "Detected" {
		t.Fatalf("identity = %+v, want the detected character preserved", got)
	}
	if got := engine.state.Snapshot().Fame; got != 25 {
		t.Fatalf("fame = %d, want 25 preserved", got)
	}
}

// With no identity yet, the refresh clears identity state and waits for the
// next JoinResponse — but still without restarting a capture that is running.
func TestRefreshCharacterWaitsForJoinWithoutRestart(t *testing.T) {
	source := blockingSource{runs: make(chan struct{}, 4)}
	engine := NewEngine(source, nil, nil)
	if err := engine.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-source.runs:
	case <-time.After(time.Second):
		t.Fatal("source was not started")
	}
	defer engine.Stop()

	mux := http.NewServeMux()
	engine.Register(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/tracker/character/refresh", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var body struct {
		OK       bool `json:"ok"`
		Detected bool `json:"detected"`
		Started  bool `json:"started"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	if !body.OK || body.Detected || body.Started {
		t.Fatalf("body = %+v, want ok without detection and without restart", body)
	}
	if got := engine.state.Identity().Detection; got != "waiting" {
		t.Fatalf("detection = %q, want waiting", got)
	}
	if !engine.running() {
		t.Fatal("the capture was stopped while waiting for JoinResponse")
	}
}
