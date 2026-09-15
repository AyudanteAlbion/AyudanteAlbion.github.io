module ayudante-albion-desktop

go 1.23.4

// Las dependencias de Wails las resuelve `go mod tidy` en CI (el sandbox de
// desarrollo no tiene red). El workflow de GitHub Actions corre en Windows con
// acceso a internet y completa go.sum antes de `wails build`.
require github.com/wailsapp/wails/v2 v2.10.1
