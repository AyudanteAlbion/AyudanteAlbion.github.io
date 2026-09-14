# Ediciones del ejecutable y tracker de escritorio

Documento de arquitectura de la separación **web / escritorio estándar / escritorio Tracker**, y
del motor de estadísticas en vivo que distingue a la tercera.

El plan completo de qué capacidades queremos replicar y en qué orden está en
[`plan-statistics-analysis.md`](plan-statistics-analysis.md). Este documento describe **lo que ya
está construido** y los contratos que hay que respetar al seguir.

---

## 1. Las tres formas de correr la app

| | Web | `AyudanteAlbion.exe` | `AyudanteAlbion-Tracker.exe` |
|---|---|---|---|
| Origen | GitHub Pages | Go + `embed` | Go + `embed` + `-tags tracker` |
| Herramientas de cálculo | todas | todas | todas |
| Pestaña **Sesión** | no | no | sí |
| Motor de captura en el binario | no | **no compilado** | sí |
| Permisos de administrador | no | no | sí (captura de red) |

**El frontend es uno solo.** No hay copias del HTML ni ramas de build por edición: la misma
`albion-app/` se sirve en los tres casos y se adapta en tiempo de ejecución.

---

## 2. Cómo se separan las ediciones

### 2.1 En el binario: build tags de Go

```
albion-exe/
  main.go                 servidor, proxies y apagado por heartbeat (común)
  edition_standard.go     //go:build !tracker   → status «no disponible»
  edition_tracker.go      //go:build tracker    → monta el motor
  tracker/                hub.go · state.go · source.go · server.go
```

`main.go` llama a una sola función, `registerEdition(mux, touch)`, y cada archivo de edición la
implementa a su manera. Con esto:

- La edición estándar **no compila el paquete `tracker`**: no hay código muerto, no crece el
  binario, no aparecen dependencias nuevas y no hay forma de activar el tracking por accidente.
- Sumar capacidades al tracker nunca puede romper la edición estándar, porque no la toca.

```bash
go build                 -o AyudanteAlbion.exe          # estándar
go build -tags tracker   -o AyudanteAlbion-Tracker.exe  # Tracker
```

`build.sh` compila las dos y las mete en el `.zip`. El workflow de release publica los dos `.exe`
con sus SHA-256.

### 2.2 En el frontend: detección en tiempo de ejecución

`js/tracker/client.js` consulta `GET /api/tracker/status` al arrancar:

| Contexto | Respuesta | Resultado |
|---|---|---|
| Web pública | 404 | `edition: "web"` — la pestaña Sesión queda oculta |
| `AyudanteAlbion.exe` | `{edition:"standard", available:false}` | pestaña visible con el aviso de por qué no hay tracking |
| `AyudanteAlbion-Tracker.exe` | `{edition:"tracker", available:true}` | pestaña completa y conexión al stream |

El botón de la pestaña nace con `hidden` en el HTML y solo se revela cuando la detección confirma
que estamos en escritorio. Si algo falla —timeout, red caída, respuesta rara— el módulo cae a
`web` y la app se comporta exactamente como hoy. **La degradación siempre es hacia la web.**

---

## 3. El motor de estadísticas

```
Source ──publica──► Hub ──SSE──► navegador
   │                  ▲
   └──actualiza──► State ──REST──► navegador (primer render)
```

### 3.1 `tracker.Source` — la pieza reemplazable

```go
type Source interface {
    Name() string
    Available() (bool, string)
    Run(ctx context.Context, st *State, hub *Hub) error
}
```

Hoy la única implementación es `Simulator`, que genera una sesión verosímil sin tocar la red. No es
un juguete: permite terminar y probar toda la interfaz sin Windows, sin Npcap y sin el juego
abierto, y le deja al usuario ver cómo se ve la pestaña antes de decidir si instala nada.

**La captura real de Photon implementa esta misma interfaz y se enchufa en una línea de
`edition_tracker.go`.** Ni el hub, ni el estado, ni la API HTTP, ni el frontend cambian.

### 3.2 `tracker.State` — agregación

Protegido por `sync.RWMutex` porque la fuente escribe desde su goroutine y los handlers HTTP leen
desde las suyas. Acumula por jugador daño, curación, sobrecuración, daño recibido, golpe máximo,
kills y muertes; y por sesión fama, plata, respec, mapas visitados y botín.

`Snapshot()` calcula DPS, HPS y porcentajes **en el servidor**, para que el frontend solo dibuje.
El historial de mapas y el botín salen del más nuevo al más viejo, y están recortados a 200 y 500
entradas para que una sesión larga no coma memoria.

Detalle que importa: el daño recibido solo se acumula para jugadores conocidos (vos y tu party).
Sin eso, cada mob golpeado aparecería como una fila más en el medidor.

### 3.3 `tracker.Hub` — reparto

Pub/sub mínimo. Cada suscriptor tiene un canal con buffer de 256 y el `Publish` **nunca bloquea**:
si una pestaña se atrasa, pierde eventos, pero el motor de captura —que corre en tiempo real— no
se frena jamás.

### 3.4 Transporte: SSE, no WebSocket

El flujo es unidireccional (servidor → navegador), lo resuelve la librería estándar de Go sin
dependencias, y `EventSource` reconecta solo desde el navegador. Un WebSocket habría traído una
dependencia y trabajo de reconexión para nada.

---

## 4. Contrato HTTP

```
GET  /api/tracker/status    edición, disponibilidad, fuente, si está capturando
POST /api/tracker/start     arranca la captura (opt-in explícito)
POST /api/tracker/stop      la detiene
POST /api/tracker/reset     reinicia contadores conservando personaje y party
GET  /api/tracker/session   snapshot completo, para el primer render
GET  /api/tracker/stream    SSE: snapshot inicial + eventos + keepalive cada 10 s
```

Tipos de evento: `snapshot`, `status`, `damage`, `heal`, `loot`, `map`.

Todo pasa por el guardián de `Host` que ya existía en `main.go` (anti DNS rebinding) y responde
`Cache-Control: no-store`.

**Heartbeat:** cada evento escrito y cada keepalive renuevan el latido de vida del proceso. Sin
esto, el `.exe` se apagaría solo a los 15 minutos aunque hubiera una pestaña mirando el medidor de
daño en silencio.

---

## 5. Frontend

```
albion-app/js/tracker/
  client.js   detección de edición, stream SSE con reintento exponencial, API
  ui.js       pestaña Sesión: KPIs, medidor, mapas y botín
```

Sigue las reglas de [`frontend-modules.md`](frontend-modules.md): módulos nuevos en `js/`, **nada
se agrega a `app.js`**. No hay dependencias entre estos módulos y el resto de la app, así que se
pueden romper sin arrastrar a nadie.

`ui.js` **desacopla los eventos del repintado**: los eventos de daño llegan varias veces por
segundo, pero el DOM se redibuja como mucho cada 500 ms. Redibujar por evento trabaría la pestaña.

Todo lo que viene del motor pasa por `esc()` antes de entrar al DOM. Los nombres de jugadores son
datos externos.

---

## 6. Desarrollo

```bash
python3 tools/tracker_dev.py 3000   # simulador: la app + /api/tracker/* en vivo
python3 tools/server.py             # servidor de siempre: se comporta como la web
```

`tools/tracker_dev.py` replica en Python el contrato JSON de la implementación en Go. No se
distribuye; es para poder trabajar la interfaz sin Windows. **Si cambia el contrato en Go, hay que
cambiarlo acá también**, porque es lo que se prueba a diario.

---

## 7. Lo que sigue

La base está: separación de ediciones, detección, transporte, agregación e interfaz. Lo que falta
es **una sola pieza**, la captura real, y después las capacidades se suman de a una sobre esta
misma estructura.

1. **Captura Photon** — `gopacket` + Npcap, filtro `udp port 5056`, implementando `tracker.Source`.
   Detección de Npcap ausente con mensaje accionable. Es la pieza incierta del proyecto.
2. **Tabla de códigos de evento** en `albion-app/data/photon_codes.json`, **fuera del binario**:
   cambian en cada patch de Albion y tienen que poder actualizarse sin recompilar.
3. **Persistencia** en `%APPDATA%\AyudanteAlbion\` para que las sesiones sobrevivan al cierre.
4. **Mazmorras, recolección y almacenamiento** sobre el mismo `State`.
5. **Trades → Registro de operaciones**: la integración más valiosa, porque el P&L, el CSV y la
   sincronización entre dispositivos ya existen y lo reciben gratis.

---

## 8. Límites que no se cruzan

- No se modifica el cliente del juego, ni se lee su memoria, ni se inyecta nada.
- No hay overlay sobre el juego.
- No se rastrean jugadores fuera del campo de visión del personaje.
- El tracking arranca apagado y se activa a mano.
- Nada sale de la PC salvo lo que el usuario suba a la nube deliberadamente.
