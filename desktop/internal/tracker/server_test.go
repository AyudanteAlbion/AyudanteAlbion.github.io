// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	"context"
	"errors"
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
