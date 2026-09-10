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
	"net/url"
	"os"
	"os/exec"
	"regexp"
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

// Mismas rutas que el Worker de Cloudflare (GAMEINFO_ROUTES): el proxy local
// tampoco sirve de relay genérico hacia gameinfo. Si la app usa una ruta
// nueva, sumarla acá, al Worker y a server.py.
var gameinfoRoutes = []*regexp.Regexp{
	regexp.MustCompile(`^/search$`),
	regexp.MustCompile(`^/players/[A-Za-z0-9_-]{1,64}$`),
	regexp.MustCompile(`^/players/[A-Za-z0-9_-]{1,64}/(kills|deaths|topkills|solokills)$`),
	regexp.MustCompile(`^/guilds/[A-Za-z0-9_-]{1,64}$`),
	regexp.MustCompile(`^/guilds/[A-Za-z0-9_-]{1,64}/(members|top)$`),
	regexp.MustCompile(`^/events$`),
	regexp.MustCompile(`^/guildmatches/(next|past|top)$`),
	regexp.MustCompile(`^/guildmatches/[A-Za-z0-9_-]{1,64}$`),
	regexp.MustCompile(`^/battles$`),
	regexp.MustCompile(`^/battles/[A-Za-z0-9_-]{1,64}$`),
}

// Mismos parámetros que el Worker (GAMEINFO_PARAMS), valores de hasta 100 caracteres.
var gameinfoParams = map[string]bool{
	"q": true, "range": true, "limit": true, "offset": true, "sort": true, "guildId": true,
}

func gameinfoRouteAllowed(sub string) bool {
	for _, re := range gameinfoRoutes {
		if re.MatchString(sub) {
			return true
		}
	}
	return false
}

// hostAllowed valida el header Host: el servidor solo atiende al navegador
// local. Sin este chequeo, un ataque de DNS rebinding (un dominio público que
// resuelve a 127.0.0.1) le daría a una página remota el mismo origen que la
// app: podría leer el localStorage (sesión SG incluida) y usar los proxies.
func hostAllowed(r *http.Request) bool {
	if r.Host == "" {
		return false
	}
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host // venía sin puerto
	}
	host = strings.Trim(host, "[]")
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func openBrowser(appURL string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", appURL)
	case "darwin":
		cmd = exec.Command("open", appURL)
	default:
		cmd = exec.Command("xdg-open", appURL)
	}
	_ = cmd.Start()
}

func main() {
	sub, err := fs.Sub(appFS, "app")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()

	// Latido de la página: renueva el contador de vida.
	mux.HandleFunc("/alive", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		w.WriteHeader(http.StatusNoContent)
	})

	// Proxy hacia la API oficial de jugadores (gameinfo no envía CORS,
	// así que el navegador no puede llamarla directo). Allowlist de rutas
	// y parámetros, igual que el Worker de Cloudflare: el proxy local
	// tampoco es un relay genérico hacia gameinfo.
	mux.HandleFunc("/gameinfo/", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		subPath := strings.TrimPrefix(r.URL.Path, "/gameinfo")
		if !gameinfoRouteAllowed(subPath) {
			http.Error(w, "ruta no permitida", http.StatusNotFound)
			return
		}
		target := "https://gameinfo.albiononline.com/api/gameinfo" + subPath
		qs := url.Values{}
		for k, vs := range r.URL.Query() {
			if !gameinfoParams[k] {
				continue
			}
			for _, v := range vs {
				if len(v) <= 100 {
					qs.Add(k, v)
				}
			}
		}
		if q := qs.Encode(); q != "" {
			target += "?" + q
		}
		req, err := http.NewRequest("GET", target, nil)
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
	mux.HandleFunc("/murderledger/", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		mlPath := strings.TrimPrefix(r.URL.Path, "/murderledger")
		if mlPath == "" {
			mlPath = "/home"
		}
		if mlPath != "/home" && mlPath != "/vod-events" {
			http.Error(w, "ruta no permitida", http.StatusNotFound)
			return
		}
		target := "https://murderledger.albiononline2d.com/api" + mlPath
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		req, err := http.NewRequest("GET", target, nil)
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
	mux.HandleFunc("/twitch/", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixNano())
		// Ojo: en DecAPI el prefijo /twitch es parte de la ruta real
		// (https://decapi.me/twitch/uptime/<canal>); recortarlo devolvía 404
		// y el indicador EN VIVO/OFFLINE nunca aparecía en el ejecutable.
		target := "https://decapi.me" + r.URL.Path
		req, err := http.NewRequest("GET", target, nil)
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

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
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

	// Todo pasa por el guardián de Host (anti DNS rebinding); de paso se manda
	// X-Content-Type-Options para que el navegador no adivine tipos de contenido.
	guard := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r) {
			http.Error(w, "host no permitido", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})

	// Puerto fijo 3000; si está ocupado, uno libre asignado por el sistema
	ln, err := net.Listen("tcp", "127.0.0.1:3000")
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			panic(err)
		}
	}
	appURL := fmt.Sprintf("http://%s", ln.Addr().String())

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
		openBrowser(appURL)
	}()

	if err := http.Serve(ln, guard); err != nil {
		panic(err)
	}
}
