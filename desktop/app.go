package main

import (
	"context"

	"ayudante-albion-desktop/internal/tracker"
)

// App concentra el ciclo de vida de la aplicación de escritorio. Wails llama a
// OnStartup cuando la ventana está lista y a OnShutdown cuando se cierra: es
// donde se para limpio el motor del tracker.
type App struct {
	ctx    context.Context
	engine *tracker.Engine
}

// NewApp arma la aplicación con el motor del tracker ya construido (el mismo
// que el router monta sobre el servidor interno).
func NewApp(engine *tracker.Engine) *App {
	return &App{engine: engine}
}

// OnStartup guarda el contexto de Wails para poder usar el runtime más adelante
// (diálogos nativos, eventos, etc.).
func (a *App) OnStartup(ctx context.Context) {
	a.ctx = ctx
}

// OnShutdown detiene la captura antes de cerrar. Sin heartbeat ni watchdog: el
// cierre de la ventana es la señal de apagado.
func (a *App) OnShutdown(ctx context.Context) {
	if a.engine != nil {
		a.engine.Stop()
	}
}
