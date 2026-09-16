// SPDX-License-Identifier: GPL-3.0-only
//
// Raw socket lifecycle is adapted for Go from Statistics Analysis Tool (SAT)
// revision 9f4471b2905f4152938d84721492c6ac86499750 (GPL-3.0-only).

package tracker

import (
	"context"
	"fmt"
	"runtime"
	"time"
)

// platformRawCapture is produced by socket_windows.go. Both IP families and
// all usable local addresses feed the same packet channel.
type platformRawCapture struct {
	packets <-chan CapturedDatagram
	errors  <-chan error
	// frames entrega true/false por cada trama cruda leída del socket, según
	// se haya podido interpretar o no. Sirve para el mismo diagnóstico que en
	// Npcap: distinguir "no llega nada" de "llega y se descarta".
	frames    <-chan bool
	count     int
	signature string
	close     func()
}

type SocketSource struct {
	store       *CodeStore
	diagnostics *protocolDiagnostics
}

func NewSocketSource(store *CodeStore) *SocketSource {
	return &SocketSource{store: store, diagnostics: newProtocolDiagnostics()}
}
func (s *SocketSource) Name() string               { return "socket de Windows (SIO_RCVALL)" }
func (s *SocketSource) SetDiagnostic(on bool)      { s.diagnostics.setEnabled(on) }
func (s *SocketSource) Diagnostic() map[string]any { return s.diagnostics.snapshot(s.store) }

func (s *SocketSource) Available() (bool, string) {
	if runtime.GOOS != "windows" {
		return false, "Socket solo está disponible en Windows"
	}
	ctx, cancel := context.WithCancel(context.Background())
	capture, err := openPlatformRawCapture(ctx)
	cancel()
	if capture != nil && capture.close != nil {
		capture.close()
	}
	if err != nil {
		return false, err.Error()
	}
	if capture == nil || capture.count == 0 {
		return false, "no se pudo abrir ningún socket de captura"
	}
	return true, ""
}

func (s *SocketSource) Run(ctx context.Context, st *State, hub *Hub) error {
	codes, warn := s.store.Current()
	if codes == nil {
		var err error
		codes, err = s.store.Load()
		if err != nil {
			return err
		}
		_, warn = s.store.Current()
	}
	if warn != "" {
		hub.Publish(NewEvent("warning", map[string]any{"message": warn}))
	}

	entities := NewEntityStore()
	pipeline := newPacketPipeline(s.diagnostics, st, hub, codes, entities, nil)
	var active *platformRawCapture
	var activeCancel context.CancelFunc
	open := func() error {
		if activeCancel != nil {
			activeCancel()
		}
		if active != nil && active.close != nil {
			active.close()
		}
		captureCtx, cancel := context.WithCancel(ctx)
		capture, err := openPlatformRawCapture(captureCtx)
		if err != nil {
			cancel()
			return err
		}
		active, activeCancel = capture, cancel
		st.CaptureOpened("socket", capture.count)
		hub.Publish(NewEvent("status", st.Snapshot()))
		return nil
	}
	if err := open(); err != nil {
		return err
	}
	defer func() {
		if activeCancel != nil {
			activeCancel()
		}
		if active != nil && active.close != nil {
			active.close()
		}
	}()

	snapshotTicker := time.NewTicker(time.Second)
	networkTicker := time.NewTicker(3 * time.Second)
	defer snapshotTicker.Stop()
	defer networkTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case packet, ok := <-active.packets:
			if !ok {
				pipeline.ResetTransport()
				st.CaptureRecovering("socket", "la red cambió; reabriendo raw sockets")
				hub.Publish(NewEvent("status", st.Snapshot()))
				if err := reopenRawCapture(ctx, open); err != nil {
					return err
				}
				continue
			}
			pipeline.Ingest(packet)
		case parsed, ok := <-active.frames:
			if ok {
				pipeline.MarkFrame(0, parsed)
			}
		case err, ok := <-active.errors:
			if !ok || err != nil {
				pipeline.ResetTransport()
				st.CaptureRecovering("socket", "un raw socket dejó de responder; esperando una red activa")
				hub.Publish(NewEvent("status", st.Snapshot()))
				hub.Publish(NewEvent("warning", map[string]any{"message": "Socket se recuperará después de un error de red."}))
				if reopenErr := reopenRawCapture(ctx, open); reopenErr != nil {
					return fmt.Errorf("socket: %w", reopenErr)
				}
			}
		case <-networkTicker.C:
			if signature, err := platformNetworkSignature(); err == nil && signature != active.signature {
				pipeline.ResetTransport()
				st.CaptureRecovering("socket", "se detectó un cambio de red; reabriendo raw sockets")
				hub.Publish(NewEvent("status", st.Snapshot()))
				if err := reopenRawCapture(ctx, open); err != nil {
					return fmt.Errorf("cambio de red: %w", err)
				}
			}
		case <-snapshotTicker.C:
			hub.Publish(NewEvent("snapshot", st.Snapshot()))
		}
	}
}

func reopenRawCapture(ctx context.Context, open func() error) error {
	for {
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if err := open(); err == nil {
			return nil
		}
		// Losing every address during a Wi-Fi/VPN switch is expected. Initial
		// startup already validated elevation, so keep waiting rather than
		// silently ending tracking or changing to Demo.
	}
}
