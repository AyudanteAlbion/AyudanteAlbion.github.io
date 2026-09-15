// Ayudante Albion — aplicación de escritorio nativa (Wails v2).
//
// A diferencia del ejecutable anterior (que abría el navegador del sistema y
// se apagaba por falta de latidos), esta es una app con ventana propia: la
// interfaz corre dentro de una WebView2 y el mismo backend Go de siempre
// (proxies + motor del tracker) se sirve a esa WebView vía el AssetServer de
// Wails. Un solo binario, edición unificada: el tracking se enciende desde la
// interfaz.
package main

import (
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func main() {
	// El router arma estáticos + proxies + tracker sobre un http.Handler que
	// Wails sirve a la WebView. El engine se detiene al cerrar la ventana.
	handler, engine := newRouter()
	app := NewApp(engine)

	err := wails.Run(&options.App{
		Title:     "Ayudante Albion",
		Width:     1280,
		Height:    800,
		MinWidth:  1024,
		MinHeight: 640,
		// La barra blanca nativa rompe la continuidad del tema oscuro. La
		// ventana queda sin marco y el frontend aporta una barra integrada con
		// arrastre, doble clic y controles de ventana accesibles.
		Frameless: true,

		// AssetServer.Handler: la WebView pide http://wails/… y todo se resuelve
		// dentro del proceso, sin abrir un puerto TCP público. El frontend sigue
		// usando rutas relativas (/gameinfo/…, /api/tracker/stream, …) sin
		// cambios.
		AssetServer: &assetserver.Options{
			Handler: handler,
		},

		OnStartup:  app.OnStartup,
		OnShutdown: app.OnShutdown,

		Windows: &windows.Options{
			// WebviewIsTransparent y WindowIsTranslucent en false: fondo opaco
			// normal. La app trae su propio tema oscuro en el CSS.
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},

		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		panic(err)
	}
}
