package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"ayudante-albion-desktop/internal/tracker"
	"github.com/wailsapp/wails/v2/pkg/runtime"
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

// Minimise, ToggleMaximise y Close son el puente mínimo para la barra de
// título propia. Se exponen al frontend mediante Bind y conservan en Go las
// operaciones nativas de la ventana (incluido el cierre ordenado de Wails).
func (a *App) Minimise() {
	if a.ctx != nil {
		runtime.WindowMinimise(a.ctx)
	}
}

func (a *App) ToggleMaximise() {
	if a.ctx != nil {
		runtime.WindowToggleMaximise(a.ctx)
	}
}

func (a *App) Close() {
	if a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}


// SelectGameDirectory abre el selector nativo usado por el paso 2 del
// asistente. La ruta se guarda en el frontend, no se envía a ningún servidor.
func (a *App) SelectGameDirectory() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("la ventana todavía no está lista")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Seleccionar la carpeta de Albion Online",
	})
}

func executableDirectory() (string, error) {
	exe, err := os.Executable()
	if err != nil { return "", err }
	return filepath.Dir(exe), nil
}

func userDataDirectory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil { return "", err }
	dir := filepath.Join(base, "Ayudante Albion", "userData")
	if err := os.MkdirAll(dir, 0755); err != nil { return "", err }
	return dir, nil
}

func openExplorer(path string) error {
	return exec.Command("explorer.exe", path).Start()
}

func (a *App) OpenToolDirectory() error {
	dir, err := executableDirectory()
	if err != nil { return err }
	return openExplorer(dir)
}

func (a *App) OpenUserDataDirectory() error {
	dir, err := userDataDirectory()
	if err != nil { return err }
	return openExplorer(dir)
}

// CreateDesktopShortcut crea un .lnk mediante el componente WScript de
// Windows. Los apóstrofes se duplican para mantener segura la cadena de
// PowerShell aunque el nombre de usuario o la ruta los contengan.
func (a *App) CreateDesktopShortcut() error {
	exe, err := os.Executable()
	if err != nil { return err }
	desktop := filepath.Join(os.Getenv("USERPROFILE"), "Desktop")
	if desktop == "Desktop" { return fmt.Errorf("no se encontró el escritorio del usuario") }
	shortcut := filepath.Join(desktop, "Ayudante Albion.lnk")
	quote := func(v string) string { return strings.ReplaceAll(v, "'", "''") }
	script := fmt.Sprintf("$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('%s'); $s.TargetPath='%s'; $s.WorkingDirectory='%s'; $s.Save()", quote(shortcut), quote(exe), quote(filepath.Dir(exe)))
	return exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Run()
}
