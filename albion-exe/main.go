// Ayudante Albion — ejecutable autocontenido, sin ventana de consola.
// Embebe toda la app (HTML, JS, CSS, íconos y datos), levanta un servidor
// local y abre el navegador. La página envía un latido a /alive; cuando
// no quedan pestañas abiertas, el servidor se apaga solo.
package main

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed app
var appFS embed.FS

// User-Agent de navegador: necesario para que gameinfo no responda 502.
const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// Momento del último latido, en UnixNano (atómico para acceso concurrente).
var lastBeat atomic.Int64

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func main() {
	sub, err := fs.Sub(appFS, "app")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))

	// Latido de la página: renueva el contador de vida.
	http.HandleFunc("/alive", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		w.WriteHeader(http.StatusNoContent)
	})

	// Proxy hacia la API oficial de jugadores (gameinfo no envía CORS,
	// así que el navegador no puede llamarla directo).
	http.HandleFunc("/gameinfo/", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		url := "https://gameinfo.albiononline.com/api/gameinfo" + strings.TrimPrefix(r.URL.Path, "/gameinfo")
		if r.URL.RawQuery != "" {
			url += "?" + r.URL.RawQuery
		}
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadGateway)
			return
		}
		// gameinfo bloquea los User-Agent de bot desde el borde de Cloudflare
		// (502). Mismas cabeceras que usa el Worker de Cloudflare: sin esto el
		// killboard no carga en el ejecutable.
		req.Header.Set("User-Agent", browserUA)
		req.Header.Set("Accept", "application/json, text/plain, */*")
		req.Header.Set("Accept-Language", "es-AR,es;q=0.9,en;q=0.8")
		req.Header.Set("Origin", "https://gameinfo.albiononline.com")
		req.Header.Set("Referer", "https://gameinfo.albiononline.com/game-info-players/")
		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "gameinfo no disponible", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})

	// Proxy hacia Murderledger/AlbionOnline2D: testigo de frescura del
	// Tracker por Zona (el killboard oficial puede atrasarse; Murderledger
	// sincroniza su propia base cada ~5 min). Allowlist estricta, igual que
	// el Worker de Cloudflare.
	http.HandleFunc("/murderledger/", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		sub := strings.TrimPrefix(r.URL.Path, "/murderledger")
		if sub == "" {
			sub = "/home"
		}
		if sub != "/home" && sub != "/vod-events" {
			http.Error(w, "ruta no permitida", http.StatusNotFound)
			return
		}
		url := "https://murderledger.albiononline2d.com/api" + sub
		if r.URL.RawQuery != "" {
			url += "?" + r.URL.RawQuery
		}
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadGateway)
			return
		}
		req.Header.Set("User-Agent", browserUA)
		req.Header.Set("Accept", "application/json, text/plain, */*")
		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "murderledger no disponible", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})

	// Proxy hacia DecAPI: estado EN VIVO/OFFLINE de los canales de Twitch de
	// los creadores. La app prueba el fetch directo primero; esto cubre los
	// entornos donde el servicio no manda CORS (mismo truco que /gameinfo).
	http.HandleFunc("/twitch/", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		// Ojo: en DecAPI el prefijo /twitch es parte de la ruta real
		// (https://decapi.me/twitch/uptime/<canal>); recortarlo devolvía 404
		// y el indicador EN VIVO/OFFLINE nunca aparecía en el ejecutable.
		url := "https://decapi.me" + r.URL.Path
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadGateway)
			return
		}
		req.Header.Set("User-Agent", "AyudanteAlbion/1.0")
		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "twitch no disponible", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Cualquier pedido cuenta como señal de vida (navegación, íconos…)
		lastBeat.Store(time.Now().UnixNano())
		// Mismas reglas de caché que server.py: íconos 7 días, resto sin caché
		if strings.HasPrefix(r.URL.Path, "/icons/") {
			w.Header().Set("Cache-Control", "public, max-age=604800")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
		fileServer.ServeHTTP(w, r)
	})

	// Puerto fijo 3000; si está ocupado, uno libre asignado por el sistema
	ln, err := net.Listen("tcp", "127.0.0.1:3000")
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			panic(err)
		}
	}
	url := fmt.Sprintf("http://%s", ln.Addr().String())

	// Gracia inicial: 75 s para que el navegador arranque aunque sea lento.
	lastBeat.Store(time.Now().Add(75 * time.Second).UnixNano())

	// Vigilante: sin latidos por 15 MINUTOS → apagar. El latido llega cada
	// 3 s con la pestaña activa; los navegadores lo frenan hasta ~1/min en
	// pestañas en segundo plano, por eso la ventana es generosa: podés dejar
	// la app abierta sin usarla hasta 15 minutos y sigue funcionando.
	// Solo se apaga cuando cerraste la pestaña de verdad.
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for range t.C {
			if time.Since(time.Unix(0, lastBeat.Load())) > 15*time.Minute {
				os.Exit(0)
			}
		}
	}()

	go func() {
		time.Sleep(400 * time.Millisecond)
		openBrowser(url)
	}()

	if err := http.Serve(ln, nil); err != nil {
		panic(err)
	}
}
