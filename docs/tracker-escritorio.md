# App de escritorio y tracker en vivo

Documento de arquitectura de la separación **web / app de escritorio**, y del
motor de estadísticas en vivo que solo existe en la segunda.

El plan de capacidades que queremos replicar y su orden está en
[`plan-statistics-analysis.md`](plan-statistics-analysis.md); el plan original
de la app nativa, en [`PLAN_APP_ESCRITORIO.md`](PLAN_APP_ESCRITORIO.md). Este
documento describe **lo que ya está construido** y los contratos que hay que
respetar al seguir.

> **Licencia:** el repositorio y el ejecutable se distribuyen bajo
> **GPL-3.0-only**. El tracker contiene adaptaciones del ciclo de entidades de
> [AlbionOnline-StatisticsAnalysis (SAT)](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis);
> la atribución, el commit de referencia y el código fuente correspondiente se
> documentan en [`../NOTICE`](../NOTICE) y [`licencia-gpl.md`](licencia-gpl.md).

---

## 1. Dos productos independientes

| | Web | App de escritorio |
|---|---|---|
| Qué es | Sitio estático en GitHub Pages | `AyudanteAlbionDesktop.exe` (Wails v2 + WebView2) |
| Código | `albion-app/` | `desktop/` |
| Publicación | workflow **Web** (`web.yml`) | workflow **Escritorio** (`desktop.yml`) |
| Pestañas Sesión / Recolección / Mazmorras | **no** | sí |

**No comparten código de frontend.** El frontend del escritorio vive en
`desktop/ui/` como un fork versionado de `albion-app/` (ver
[`../desktop/ui/README.md`](../desktop/ui/README.md)). Tocar la web no cambia
el `.exe`, y tocar el `.exe` no cambia la web.

Lo único compartido son los **assets sin lógica** —`data/`, `icons/` e `img/`
de `albion-app/`— que `desktop/sync_frontend.sh` copia junto al código de
`desktop/ui/` para armar `desktop/frontend/`, la carpeta que Go embebe al
compilar. `frontend/` es generada y no se versiona.

Antes existió el **ejecutable clásico** (`AyudanteAlbion.exe` y
`AyudanteAlbion-Tracker.exe`, construidos con build tags desde `albion-exe/`):
abría el navegador del sistema, levantaba un servidor local con heartbeat y se
publicaba en dos ediciones. Fue retirado por completo; hoy hay **un solo
binario**, con el tracker siempre compilado y apagado por defecto.

### La web ya no ofrece las pestañas del tracker

**Sesión**, **Recolección** y **Mazmorras** son exclusivas de la app de
escritorio: las tres se alimentan de la captura de red del juego, imposible en
un navegador. La web no muestra esas pestañas ni carga `js/tracker/*` ni sus
CSS; durante la transición mostraban un cartel de «En desarrollo en App de
Escritorio». Por el mismo motivo, el interruptor «seguimiento de comercio» del
Registro de operaciones solo existe en `desktop/ui/`.

---

## 2. La app de escritorio (Wails v2)

```desktop/
  main.go             arranque Wails: ventana propia + AssetServer
  app.go              ciclo de vida (OnShutdown detiene el tracker)
  router.go           http.Handler: estáticos + proxies + tracker
  internal/proxy/     relays sin CORS (gameinfo / murderledger / twitch)
  internal/tracker/   motor del tracker (ver §3)
  ui/                 frontend propio (fork versionado)
  sync_frontend.sh    arma frontend/ = ui/ + assets compartidos
```

Diferencias clave con el ejecutable clásico:

- **Ventana propia (WebView2), sin navegador.** La interfaz pide `http://wails/…`
  y el `AssetServer` lo resuelve dentro del proceso: **no se abre ningún puerto
  TCP**, y los proxies y la API del tracker viajan por el mismo canal
  (`router.go` monta todo en un único `http.ServeMux`).
- **Sin heartbeat ni watchdog.** La app se apaga al cerrar la ventana (lo maneja
  Wails). El viejo `/alive` solo lo conoce el frontend en modo desarrollo local
  clásico.
- **Edición unificada.** El motor del tracker **siempre se compila y se monta**;
  arranca apagado y se enciende desde la interfaz.
- **Ventana sin marco**: el frontend aporta la barra de título integrada
  (arrastre, doble clic y botones de ventana) vía el bridge de Wails.

En el frontend, `js/desktop/environment.js` es el único punto que detecta el
entorno (`AAEnvironment`): dentro de Wails habilita los controles nativos y
apaga el anti-pausa (las WebView no congelan pestañas); en la web y en el
desarrollo local todo queda apagado.

Compilación: **solo en Windows** (workflow `desktop.yml` sobre
`windows-latest`; Wails + WebView2 son nativos). El pipeline valida la tabla
Photon, corre `go test ./...`, prepara `frontend/` con `sync_frontend.sh` y
empaqueta el `.exe` con `photon_codes.json`, `LICENSE`, `NOTICE`,
`SOURCE_CODE.txt`, `SHA256SUMS.txt` y `BUILD_INFO.txt` como artefacto de la
ejecución (7 días). `SOURCE_CODE.txt` enlaza el commit exacto que contiene el
código fuente correspondiente de ese binario.

---

## 3. El motor del tracker

```
Source ──publica──► Hub ──SSE──► WebView
   │                  ▲
   └──actualiza──► State ──REST──► WebView (primer render)
```

Todo el paquete vive en `desktop/internal/tracker/` y se valida con
`go test ./...` en el workflow Escritorio. Las capas de captura, Photon y
agregación son propias; el ciclo de identidad/entidades y party contiene
adaptaciones GPL-3.0 de SAT, señaladas en los archivos fuente y en `NOTICE`.

### 3.1 `tracker.Source` — la pieza reemplazable

```go
type Source interface {
    Name() string
    Available() (bool, string)
    Run(ctx context.Context, st *State, hub *Hub) error
}
```

`router.go` arma la fuente una vez al iniciar:

| Fuente | Cuándo se usa |
|---|---|
| `LiveSource` (Npcap) | **Predeterminada.** Captura real del tráfico del juego |
| `SocketSource` | Socket sin procesar de Windows: no necesita Npcap, pero exige ejecutar como administrador |
| `Simulator` | Sin Npcap: datos verosímiles para ver cómo funciona la interfaz |
| `FallbackSource` | Envuelve Npcap y, si no está disponible, cae al simulador |
| `SelectableSource` | Mantiene los dos proveedores reales (Npcap/Socket) detrás de la misma API para que el usuario elija |
| `BrokenSource` | La tabla de códigos no cargó: la interfaz muestra el error en vez de morir en silencio |

Si Npcap aparece después (se instala), el siguiente arranque captura de verdad
sin tocar nada.

### 3.1.1 Captura: `tracker/capture`

Llama a **`wpcap.dll` de Npcap por syscall**, no a `gopacket/pcap`:

- **Sin dependencias externas**: no hace falta bajar módulos de Go para compilar
  (el go.mod solo declara Wails para la UI).
- **Sin cgo**: la toolchain de Go compila todo el binario de una pieza.

`pcap_windows.go` tiene la implementación real y `pcap_other.go` un stub, para
que el paquete compile en Linux y macOS (tests, `go vet`, CI).

Se escuchan **todas las interfaces a la vez** con el filtro BPF
`udp and (port 5055 or port 5056 or port 5058)`. Cuál usa Albion
depende de la PC —Wi-Fi, Ethernet, VPN—, y escuchar todas es más simple y más
robusto que hacer elegir al usuario. El modo promiscuo va **apagado**: alcanza
con el tráfico de esta máquina. El usuario puede reducir la escucha a un
adaptador concreto desde la pestaña Sesión (`/api/tracker/devices`).

### 3.1.2 Protocolo: `tracker/photon`

Implementación propia y sin dependencias externas de **Protocol18**, el formato
compacto que usa Albion actualmente, con compatibilidad de lectura para
capturas históricas Protocol16. Tiene dos capas:

- `parser.go` — el envoltorio eNet: separa datagramas Photon coalescidos,
  verifica CRC cuando está presente, procesa comandos y reensambla fragmentos
  por conexión, canal y secuencia. Los fragmentos incompletos caducan a los 30 s
  y sus cantidades/tamaños tienen topes defensivos.
- `protocol18.go` — deserializa los valores compactos Protocol18: enteros
  varint, cadenas, valores personalizados, colecciones y tablas de parámetros de
  un byte. Acota profundidad, longitudes y colecciones antes de asignar memoria.
  `protocol16.go` conserva el decoder ASCII anterior para capturas viejas.

Los mensajes cifrados se detectan y se descartan; no se intenta descifrarlos.

### 3.2 Identidad, entidades y party

`entity.go` mantiene el modelo de correlación adaptado de SAT: una respuesta
exitosa de **Join** registra el personaje local con `GUID`, `ObjectId`, nombre,
gremio y alianza. El GUID es estable y el `ObjectId` es el índice de corta vida
que usan los eventos de combate, botín y salida.

`NewCharacter` actualiza o vuelve a enlazar un `ObjectId` por GUID; al entrar a
otra zona se invalidan los ObjectId de las entidades visibles no locales, pero
se conserva el GUID, el nombre y la party. `PartyJoined` recibe el roster de
GUIDs/nombres; `PartyPlayerJoined`, `PartyPlayerLeft` y `PartyDisbanded` lo
actualizan. Tras un disband queda únicamente el personaje local, como en SAT.

El campo opcional **Nombre de personaje a rastrear** se pasa al motor al
reiniciar la captura. Replica el filtro de personaje principal de SAT: no
crea identidad; hasta que Join detecta un personaje permite la sesión, y luego
solo agrega estadísticas si el nombre detectado coincide.

Esto evita dos errores del modelo anterior: depender solo del nombre y usar un
ObjectId de una zona pasada. No cambia el requisito de arranque: si la captura
comienza cuando ya se está dentro de un personaje, **ChangeCluster solo puede
detectar la zona**. La identidad automática requiere una nueva respuesta Join,
por ejemplo al volver al selector de personaje y entrar otra vez.

### 3.3 `tracker.State` — agregación

Protegido por `sync.RWMutex` porque la fuente escribe desde su goroutine y los
handlers HTTP leen desde las suyas. Acumula por jugador daño, curación,
sobrecuración, daño recibido, golpe máximo, kills y muertes; y por sesión fama,
plata, respec, mapas visitados y botín.

`Snapshot()` calcula DPS, HPS y porcentajes **en el servidor**, para que el
frontend solo dibuje. El historial de mapas y el botín salen del más nuevo al
más viejo, y están recortados a 200 y 500 entradas para que una sesión larga no
coma memoria.

Detalle que importa: el daño recibido solo se acumula para jugadores conocidos
(vos y tu party). Sin eso, cada mob golpeado aparecería como una fila más en el
medidor.

### 3.4 `tracker.Hub` — reparto

Pub/sub mínimo. Cada suscriptor tiene un canal con buffer de 256 y el `Publish`
**nunca bloquea**: si una pestaña se atrasa, pierde eventos, pero el motor de
captura —que corre en tiempo real— no se frena jamás.

### 3.5 Transporte: SSE, no WebSocket

El flujo es unidireccional (servidor → WebView), lo resuelve la librería
estándar de Go sin dependencias, y `EventSource` reconecta solo desde el
frontend. Un WebSocket habría traído una dependencia y trabajo de reconexión
para nada.

---

## 3.6 La tabla de códigos: `photon_codes.json`

El corazón del mantenimiento a largo plazo. Los códigos de evento de Albion
cambian en casi cada parche, así que la fuente de verdad es texto plano en
`albion-app/data/photon_codes.json`.

`tracker/codes.go` la busca en tres lugares, en orden: junto al `.exe`, en
`%APPDATA%\AyudanteAlbion\`, y por último la copia embebida de fábrica. Una
tabla externa rota **nunca deja al tracker sin tabla**: se informa el error y
se sigue con la de fábrica.

Dos detalles que no son obvios:

- **Los códigos van de 0 a 65535, no de 0 a 255.** Albion manda el código real
  en el parámetro 252 (eventos) o 253 (operaciones) como entero de 16 bits; el
  byte del envelope solo alcanza para los códigos bajos y se usa como respaldo.
  Hay eventos reales con código 273, 304 y 318.
- **Los índices de `eventParameters` sí son bytes** (0-255): son claves del
  diccionario Photon.

`POST /api/tracker/codes/reload` relee el archivo y reinicia la captura si
estaba activa. **Un parche de Albion se arregla editando texto y tocando un
botón**, sin recompilar ni reinstalar.

El modo diagnóstico (`/api/tracker/diagnostic`) lista los códigos de eventos y
operaciones que están llegando (`Codes.Events()` / `Codes.Operations()`), sin
esperar a que el juego los mande primero, y cuenta los que llegan separando los
que la tabla reconoce de los que no. Solo expone código, nombre y frecuencia,
no el contenido de los paquetes.

`scripts/validate_photon_codes.py` valida la tabla antes de cada compilación en
el workflow Escritorio, y `validate_repo.py` impide editarla rota desde la web.
Guía completa de uso en [`photon-codes.md`](photon-codes.md).

---

## 4. Contrato HTTP

Lo monta `Engine.Register` (`desktop/internal/tracker/server.go`) sobre el
mismo mux que los estáticos y los proxies; nada escucha en un puerto externo.

```
GET  /api/tracker/status    fuente activa, disponibilidad, si está capturando, error del último Run e info de la tabla
POST /api/tracker/start     arranca la captura (opt-in explícito)
POST /api/tracker/stop      la detiene
POST /api/tracker/restart?provider=&adapter=&character=   aplica la configuración y reinicia la fuente actual
POST /api/tracker/reset     reinicia contadores conservando personaje y party
POST /api/tracker/character/refresh  olvida la identidad para esperar la próxima respuesta Join (no se recupera al cambiar de zona)
GET  /api/tracker/session   snapshot completo, para el primer render
GET  /api/tracker/stream    SSE: snapshot inicial + eventos + keepalive cada 10 s
POST /api/tracker/codes/reload  relee photon_codes.json sin reiniciar la app
GET  /api/tracker/devices   adaptadores de red disponibles para la captura
GET  /api/tracker/diagnostic    códigos que están llegando (conocidos y desconocidos)
POST /api/tracker/diagnostic?on=1|0   enciende o apaga el conteo
```

Tipos de evento: `snapshot`, `status`, `damage`, `heal`, `loot`, `map`,
`gathering`, `dungeon`, `warning`.

Todo responde `Cache-Control: no-store`. Al ser interno a la ventana, ya no
aplica el guardián de `Host` anti DNS-rebinding del ejecutable clásico —era
protección del puerto local que ahora no existe— y tampoco hay heartbeat de
`/alive`.

---

## 5. Frontend del escritorio

```
desktop/ui/js/tracker/
  client.js     stream SSE con reintento exponencial, API REST del tracker
  ui.js         pestaña Sesión: KPIs, medidor, mapas, botín, diagnóstico
  gathering.js  pestaña Recolección (eventos `gathering`)
  dungeons.js   pestaña Mazmorras (eventos `dungeon`)
```

Sigue las reglas de [`frontend-modules.md`](frontend-modules.md): módulos
nuevos en `js/`, **nada se agrega a `app.js`** salvo el punto que los inicia.
No hay dependencias entre estos módulos y el resto de la app, así que se pueden
romper sin arrastrar a nadie. Todos se auto-inicializan y abortan en silencio
si su `<section>` no existe, y `client.js` degrada a «sin tracker» si la API no
responde —por eso la web pudo convivir con ellos mientras hizo falta.

`ui.js` **desacopla los eventos del repintado**: los eventos de daño llegan
varias veces por segundo, pero el DOM se redibuja como mucho cada 500 ms.
Redibujar por evento trabaría la pestaña.

Todo lo que viene del motor pasa por `esc()` antes de entrar al DOM. Los
nombres de jugadores son datos externos.

---

## 6. Desarrollo

```bash
python3 tools/tracker_dev.py 3000   # desktop/ui + /api/tracker/* simulado
wails dev                           # (en Windows, con la toolchain de Wails)
```

`tools/tracker_dev.py` sirve `desktop/ui/` y replica en Python el contrato JSON
de la implementación en Go (`/api/tracker/*`), resolviendo `data/`, `icons/` e
`img/` desde `albion-app/` igual que el frontend embebido. No se distribuye; es
para trabajar las pestañas del tracker sin Windows y sin Npcap. **Si cambia el
contrato en Go, hay que cambiarlo acá también.**

`tools/server.py` sigue sirviendo `albion-app/` para el desarrollo de la web —
ya sin `/api/tracker/*`, porque la web no las usa. (`wails dev` en Linux no es
objetivo soportado: el build real y el soporte de la app son Windows-only.)

---

## 7. Lo que sigue

Captura, protocolo, tabla de códigos y las tres pestañas (Sesión, Recolección
y Mazmorras) están implementados en la app de escritorio. Lo que falta:

1. **Verificar contra el juego real** en una PC con Windows y Npcap. Los
   números de `photon_codes.json` salen de referencias comunitarias y hay que
   confirmarlos con el modo diagnóstico; es esperable tener que corregir varios
   la primera vez.
2. **Persistencia** en `%APPDATA%\AyudanteAlbion\` para que las sesiones
   sobrevivan al cierre.
3. **Valuación del botín** con el motor de precios que ya tiene la app.
4. **Trades → Registro de operaciones**: la integración más valiosa, porque el
   P&L, el CSV y la sincronización entre dispositivos ya existen y lo reciben
   gratis. El interruptor del Registro ya enciende y apaga la captura.
5. **Distribución formal**: hoy el `.exe` se baja del artefacto del workflow;
   un workflow de release con tags lo publicaría en GitHub Releases.

---

## 8. Límites que no se cruzan

- No se modifica el cliente del juego, ni se lee su memoria, ni se inyecta nada.
- No hay overlay sobre el juego.
- No se rastrean jugadores fuera del campo de visión del personaje.
- Daño, curación y botín se agregan solo para el personaje propio y la party
  actual; los demás jugadores se descartan.
- El tracking arranca apagado y se activa a mano.
- Nada sale de la PC salvo lo que el usuario suba a la nube deliberadamente.
- Estas barreras están auditadas en
  [`cumplimiento-albion.md`](cumplimiento-albion.md) y la validación del
  repositorio bloquea APIs de inyección, memoria, automatización y
  always-on-top.
