// Package proxy expone los relays HTTP hacia servicios externos que no envían
// CORS, de modo que el frontend pueda llamarlos con rutas relativas igual que
// en la web (donde el Worker de Cloudflare hace este mismo trabajo).
//
// Es una extracción directa de los handlers del ejecutable clásico, ya retirado.
// La allowlist de rutas y parámetros es idéntica a la del Worker: este proxy
// tampoco es un relay genérico hacia gameinfo.
package proxy

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// User-Agent de navegador: necesario para que gameinfo no responda 502.
const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

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

// Register cuelga los tres proxies (/gameinfo, /murderledger, /twitch) en el
// mux indicado. `touch` renueva el latido de vida del proceso; puede ser nil.
func Register(mux *http.ServeMux, touch func()) {
	if touch == nil {
		touch = func() {}
	}

	// Proxy hacia la API oficial de jugadores (gameinfo no envía CORS,
	// así que el navegador no puede llamarla directo). Allowlist de rutas
	// y parámetros, igual que el Worker de Cloudflare.
	mux.HandleFunc("/gameinfo/", func(w http.ResponseWriter, r *http.Request) {
		touch()
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
		touch()
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
		touch()
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
}
