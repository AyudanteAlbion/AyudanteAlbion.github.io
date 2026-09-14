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

Hay tres implementaciones:

| Fuente | Cuándo se usa |
|---|---|
| `LiveSource` | Npcap instalado: captura real del tráfico del juego |
| `Simulator` | Sin Npcap: datos verosímiles para ver cómo funciona la interfaz |
| `FallbackSource` | Envuelve a las dos y elige según disponibilidad |

`edition_tracker.go` arma `LiveSource` y, si Npcap no está, lo envuelve en `FallbackSource` para que
la pestaña siga siendo usable. En cuanto se instala Npcap, el siguiente arranque usa la captura real
sin tocar nada.

### 3.1.1 Captura: `tracker/capture`

Llama a **`wpcap.dll` de Npcap por syscall**, no a `gopacket/pcap`. Dos razones, y las dos importan
para este repositorio:

- **Sin dependencias externas.** `build.sh` compila con una toolchain de Go fija y sin acceso a
  `proxy.golang.org`; todo lo que necesita el binario viaja en el repo.
- **Sin cgo.** El `.exe` de Windows se compila desde Linux (`GOOS=windows`). `gopacket/pcap`
  necesita cgo y un toolchain de C cruzado, que rompería ese flujo.

`pcap_windows.go` tiene la implementación real y `pcap_other.go` un stub, para que el paquete
compile en Linux y macOS (tests, `go vet`, CI).

Se escuchan **todas las interfaces a la vez** con el filtro BPF
`udp and (port 5055 or port 5056 or port 5057 or port 5058)`. Cuál usa Albion depende de la PC
—Wi-Fi, Ethernet, VPN—, y escuchar todas es más simple y más robusto que hacer elegir al usuario.
El modo promiscuo va **apagado**: alcanza con el tráfico de esta máquina.

### 3.1.2 Protocolo: `tracker/photon`

Implementación propia de Protocol16, también sin dependencias. Dos capas:

- `parser.go` — el envoltorio eNet: comandos, y el **reensamblado de fragmentos** (un mensaje puede
  venir partido en varios paquetes UDP, desordenados). Los fragmentos incompletos caducan a los 30 s
  y hay un tope de sets simultáneos, para que un paquete corrupto no haga crecer la memoria.
- `protocol16.go` — la deserialización de valores. Acota el anidamiento a 8 niveles: un paquete
  malformado no puede hundir al parser en recursión.

Los mensajes cifrados se detectan y se descartan; no se intenta leerlos.

**La captura real ya está implementada.** Lo que falta es verificarla contra el juego en una PC con
Windows, que es la parte que no se puede hacer desde este entorno.

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

## 3.5 La tabla de códigos: `photon_codes.json`

El corazón del mantenimiento a largo plazo. Los códigos de evento de Albion cambian en casi cada
parche, así que **viven fuera del binario** en `albion-app/data/photon_codes.json`.

`tracker/codes.go` la busca en tres lugares, en orden: junto al `.exe`, en `%APPDATA%`, y por último
la copia embebida de fábrica. Una tabla externa rota **nunca deja al tracker sin tabla**: se informa
el error y se sigue con la de fábrica.

Dos detalles que no son obvios:

- **Los códigos van de 0 a 65535, no de 0 a 255.** Albion manda el código real en el parámetro 252
  (eventos) o 253 (operaciones) como entero de 16 bits; el byte del envelope solo alcanza para los
  códigos bajos y se usa como respaldo. Hay eventos reales con código 273, 304 y 318.
- **Los índices de `eventParameters` sí son bytes** (0-255): son claves del diccionario Photon.

`POST /api/tracker/codes/reload` relee el archivo y reinicia la captura si estaba activa. **Un
parche de Albion se arregla editando texto y tocando un botón**, sin recompilar ni reinstalar.

El modo diagnóstico (`/api/tracker/diagnostic`) cuenta los códigos que están llegando, separando los
que la tabla reconoce de los que no: es la herramienta para saber qué número corregir.

Guía completa de uso en [`photon-codes.md`](photon-codes.md).

---

## 4. Contrato HTTP

```
GET  /api/tracker/status    edición, disponibilidad, fuente, si está capturando
POST /api/tracker/start     arranca la captura (opt-in explícito)
POST /api/tracker/stop      la detiene
POST /api/tracker/reset     reinicia contadores conservando personaje y party
GET  /api/tracker/session   snapshot completo, para el primer render
GET  /api/tracker/stream    SSE: snapshot inicial + eventos + keepalive cada 10 s
POST /api/tracker/codes/reload  relee photon_codes.json sin reiniciar la app
GET  /api/tracker/diagnostic    códigos que están llegando (conocidos y desconocidos)
POST /api/tracker/diagnostic?on=1|0   enciende o apaga el conteo
```

Tipos de evento: `snapshot`, `status`, `damage`, `heal`, `loot`, `map`, `warning`.

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

Captura, protocolo y tabla de códigos están implementados. Lo que falta:

1. **Verificar contra el juego real** en una PC con Windows y Npcap. Los números de
   `photon_codes.json` salen de referencias comunitarias y hay que confirmarlos con el modo
   diagnóstico; es esperable tener que corregir varios la primera vez.
2. **Persistencia** en `%APPDATA%\AyudanteAlbion\` para que las sesiones sobrevivan al cierre.
3. **Mazmorras, recolección y almacenamiento** sobre el mismo `State`.
4. **Valuación del botín** con el motor de precios que ya tiene la app.
5. **Trades → Registro de operaciones**: la integración más valiosa, porque el P&L, el CSV y la
   sincronización entre dispositivos ya existen y lo reciben gratis.

---

## 8. Límites que no se cruzan

- No se modifica el cliente del juego, ni se lee su memoria, ni se inyecta nada.
- No hay overlay sobre el juego.
- No se rastrean jugadores fuera del campo de visión del personaje.
- El tracking arranca apagado y se activa a mano.
- Nada sale de la PC salvo lo que el usuario suba a la nube deliberadamente.
