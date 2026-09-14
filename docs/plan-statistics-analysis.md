# Plan: llevar las capacidades de *Statistics Analysis Tool* al ejecutable de Ayudante Albion

> Estado: **propuesta de diseño** (no hay código de tracking todavía).
> Alcance: `albion-exe/` (Go) + `albion-app/` (frontend) + build y release.
> Referencia analizada: <https://triky313.github.io/AlbionOnline-StatisticsAnalysis/> (v10.x, WPF/.NET 10, Windows).

---

## 1. Qué hace realmente la herramienta que queremos imitar

Statistics Analysis Tool (SAT) es una app de escritorio Windows que **escucha el tráfico de red del
cliente de Albion** (protocolo Photon sobre UDP) y reconstruye lo que pasa en pantalla. No modifica
el juego, no inyecta nada, no dibuja overlay y solo ve lo que tu personaje ve. Esa es la línea que
SBI considera permitida y es la misma línea que no vamos a cruzar.

### 1.1 Capacidades, agrupadas por lo que necesitan

| # | Módulo de SAT | Qué muestra | Fuente de datos |
|---|---|---|---|
| 1 | **Header / estado** | Servidor, si el tracking está activo, personaje actual, party, tiempo de sesión | Red (eventos de join/party) |
| 2 | **Dashboard** | Fame, Respec, Silver, Might, Favor, tiempo de sesión, tasas por hora, fuentes de fama y plata, loot reciente, loot valioso, facción, cofres abiertos | Red + precios |
| 3 | **Dashboard → Combate** | Kills, muertes, K/D, valor del loot tomado, lugares de kill/muerte, historial | Red + precios |
| 4 | **Dashboard → Mobs** | Mobs matados, más frecuentes, tier, facción, tasa por hora | Red + tabla de mobs |
| 5 | **Item Search** | Todos los ítems del juego, ficha con detalle y precios | **Solo datos + API de precios** |
| 6 | **Logging** | Ítems que recogen los jugadores cercanos, fama, plata, puntos de facción | Red |
| 7 | **Loot Comparator** | Cruza logs de cofre y de loot por jugador con valor estimado; filtros y estados guardables | Red + precios |
| 8 | **Dungeons** | Solo/Group/Avalon/Mists/Mist Dungeon/Hellgate/Corrupted/HCE con fama, plata, duración, tier | Red |
| 9 | **Damage Meter** | Daño y curación de vos y tu party, DPS/HPS, snapshots | Red |
| 10 | **Damage Meter → Top Stats** | Golpe más grande, burst 5 s y 10 s, daño total, curación efectiva, overheal, daño recibido, objetivos, desglose por tipo y por habilidad | Red |
| 11 | **Trade Monitoring** | Ventas y compras por correo del juego y trades directos, estadísticas, entradas manuales | Red (+ manual) |
| 12 | **Gathering** | Recursos recolectados y pesca | Red |
| 13 | **Party Builder** | Item power tuyo y de la party | Red + API oficial |
| 14 | **Storage History** | Contenido de cofres de banco, hideout e isla al momento de abrirlos | Red |
| 15 | **Map History** | Mapas visitados, del más nuevo al más viejo | Red |
| 16 | **Calculadora de crafteo / auction house** | Costos, márgenes, precios | Datos + API de precios |
| 17 | **Player Information** | Datos del jugador desde los servidores oficiales | API gameinfo |
| 18 | **Dungeon entry timer** | Cooldown de entrada a mazmorras | Red |

### 1.2 Dónde ya estamos parados

Ayudante Albion **ya cubre, y en varios casos mejor, todo lo que no depende de la red**:

| Capacidad de SAT | Nuestro estado hoy |
|---|---|
| Item Search (5) | ✅ *Buscador de precios* (7 ciudades + Mercado Negro, historial, tendencia) |
| Crafting calculator (16) | ✅ Cocina, Equipo, Refinamiento, Alquimia, Encantado, Granja, Transmutación, Artefactos |
| Trade Monitoring (11) | 🟡 *Registro de operaciones* — existe con P&L y CSV, pero es **manual**; SAT lo llena solo |
| Player Information (13, 17) | ✅ Perfil + killboard oficial vía proxy `/gameinfo/` |
| Dashboard de sesión (2) | 🟡 Hay analítica de ledger (`js/ledger/analytics.js`), no de sesión de juego |
| Map History (15) | 🟡 Tenemos el grafo de 851 mapas (`albion_map_connections.json`) y el Tracker por Zona, pero sin saber dónde está el jugador |
| 1, 3, 4, 6, 7, 8, 9, 10, 12, 14, 18 | ❌ Requieren leer la red |

**Conclusión del análisis:** la brecha no son las cuentas — es **la captura de paquetes**. Todo el
valor que falta sale de una sola pieza nueva: un *sniffer* Photon corriendo dentro del `.exe`.

---

## 2. Arquitectura propuesta

El `.exe` hoy es un servidor Go que embebe la app y la sirve en `127.0.0.1:3000`, con proxies
allowlisted a gameinfo / murderledger / decapi y apagado por heartbeat. **No hay que cambiar ese
modelo: hay que sumarle un productor de eventos y un canal en vivo hacia la página.**

```
┌──────────────────────────── AyudanteAlbion.exe (Go) ────────────────────────────┐
│                                                                                  │
│  capture/            photon/            game/              store/                │
│  ├ pcap (Npcap)  →   ├ parser        →  ├ handlers      →  ├ sesión en RAM       │
│  └ rawsocket         └ ev/op codes      ├ estado juego     └ JSON en disco       │
│     (fallback)                          └ agregadores          %APPDATA%          │
│                                                │                                 │
│                                                ▼                                 │
│                                       hub (pub/sub)  ──────► /ws  (WebSocket)    │
│                                                      ──────► /api/tracker/*      │
│  http mux existente: /, /alive, /gameinfo/, /murderledger/, /twitch/             │
└──────────────────────────────────────────────────────────────────────────────────┘
                                          │
                         navegador local ─┘  albion-app/js/tracker/*  → pestañas nuevas
```

### 2.1 Decisiones de diseño (y por qué)

1. **Motor en Go, dentro del `.exe` que ya tenemos.** Nada de un segundo proceso ni de .NET:
   conservamos “un archivo, doble clic”. `gopacket` + `Npcap` es el camino probado; el proyecto
   oficial `ao-data/albiondata-client` es Go y ya resuelve captura y Photon.
2. **UI en la app web que ya existe.** Cero UI nativa. Las pestañas nuevas son HTML/JS igual que
   Flipping o Granja, así la versión web sigue compilando (sin tracker, degradada con elegancia).
3. **WebSocket `/ws` para lo vivo, REST `/api/tracker/*` para lo histórico.** El Damage Meter
   necesita empuje a 4–10 Hz; el historial de mazmorras no.
4. **La web pública nunca ve estas pestañas.** Se detectan con un `GET /api/tracker/status`: si
   responde, es el `.exe`; si da 404, se ocultan. Sin ramas de código duplicadas.
5. **Persistencia en `%APPDATA%\AyudanteAlbion\`**, JSON por dominio (sesiones, mazmorras, loot,
   almacenamiento, trades, mapas). Reutiliza el formato del Registro de operaciones para poder
   **volcar los trades detectados dentro del ledger existente**, que es la integración más jugosa
   que SAT no tiene.
6. **Opt-in explícito.** El tracking arranca apagado. Botón “Activar tracking” que explica que
   requiere Npcap y privilegios de administrador, con enlace a la política de SBI.

### 2.2 Librerías candidatas

| Pieza | Opción | Nota |
|---|---|---|
| Captura | `github.com/google/gopacket/pcap` | Requiere Npcap instalado; filtro BPF `udp port 5056` |
| Captura (fallback) | Raw socket Windows (`SIO_RCVALL`) | Sin Npcap, pero exige admin y es más frágil |
| Photon | `github.com/ao-data/albiondata-client/client/photon` | Port oficial de `PhotonParser.cs`, callbacks `OnEvent`/`OnRequest`/`OnResponse` |
| Photon (alt.) | `AutoDruid/photon-parser` | Genérico, v16/v18 |
| Códigos evento/op | `ao-bin-dumps` + tablas de SAT | **Cambian en cada patch** → ver §5 riesgos |
| Ítems/mobs | `ao-bin-dumps` (ya lo usamos para `catalog.json`) | Falta agregar `mobs.json` y `spells` para el desglose por habilidad |

---

## 3. Fases de entrega

Cada fase es publicable por sí sola y no rompe la web. Nada de un “big bang”.

### Fase 0 — Cimientos, sin red todavía *(riesgo bajo, valor inmediato)*
- `GET /api/tracker/status` → `{available:false, reason:"no-capture"}`.
- Hub pub/sub + `/ws` con eventos sintéticos (modo demo) para desarrollar la UI sin el juego.
- Capa `store/` con JSON atómico en `%APPDATA%` y rotación.
- En el frontend: `js/tracker/client.js` (conexión, reconexión, feature-detect) y una pestaña
  **Sesión** vacía que dice “Tracking no disponible en la versión web”.
- Script `scripts/tracker_fixtures.py`: genera capturas sintéticas para tests.

**Criterio de salida:** la web se comporta exactamente igual que hoy; el `.exe` muestra la pestaña
en gris y `npm test` sigue verde.

### Fase 1 — Captura y Photon *(el corazón)*
- `capture/`: enumerar interfaces con `pcap.FindAllDevs`, filtro `udp port 5056`, reensamblado.
- Detección de Npcap ausente → mensaje accionable con enlace, no un crash.
- `photon/`: decodificar y emitir eventos crudos a un log rotativo `%APPDATA%\logs\photon.jsonl`
  (solo en modo diagnóstico).
- Pestaña **Sesión**: servidor detectado, estado del tracking, personaje, party, tiempo.
  Equivale al *Header* de SAT (capacidad 1).

**Criterio de salida:** con el juego abierto, la pestaña muestra nombre de personaje y party real.
Ese es el “hello world” que valida toda la cadena.

### Fase 2 — Damage Meter *(capacidades 9 y 10 — lo más pedido)*
- Handlers de daño/curación/muerte, agregación por jugador y por habilidad.
- Ventanas deslizantes para burst 5 s y 10 s, golpe máximo, overheal, daño recibido.
- Push por WebSocket a 5 Hz con *delta* (no el estado completo).
- UI: tabla ordenable con barras, pausa/reanudar, reset, snapshot, copiar ranking al portapapeles
  (SAT lo tiene y la gente lo usa todo el tiempo en Discord).

### Fase 3 — Sesión, fama, plata y mapas *(capacidades 2, 4, 15)*
- Contadores de Fame / Silver / Respec / Might / Favor con tasa por hora y por fuente.
- Mobs matados con tier y facción.
- Historial de mapas, **enganchado al grafo que ya tenemos** (`albion_map_connections.json`):
  ruta recorrida y vecinos, algo que SAT no hace.
- Dashboard con rango de tiempo y filtro por tipo de contenido.

### Fase 4 — Mazmorras y recolección *(capacidades 8, 12, 18)*
- Detección de entrada/salida, tipo, tier, duración, fama, plata, respec.
- Timer de entrada a mazmorra.
- Recolección y pesca por recurso y tier, con **valor de mercado en vivo usando nuestros precios**.

### Fase 5 — Loot, almacenamiento y comparador *(capacidades 6, 7, 14)*
- Loot logger de jugadores cercanos.
- Historial de cofres (banco, hideout, isla).
- Loot Comparator con filtros por estado, tier, tipo y gremio, y estados guardables.
- **Extra propio:** valuación del loot con el mismo motor de precios de la app y export al Registro.

### Fase 6 — Trade Monitoring integrado al ledger *(capacidad 11 — nuestra ventaja)*
- Detección de ventas/compras por correo del juego y trades directos.
- **Alta automática en el Registro de operaciones**, con confirmación, deduplicación y marca de
  origen `auto`. El P&L, el CSV y la sincronización con Discord ya existen y lo reciben gratis.
- Esto convierte a Ayudante Albion en lo único que hace el circuito completo: detectar la venta,
  registrarla, calcular el margen y sincronizarla entre PCs.

### Fase 7 — Party Builder y pulido *(capacidad 13)*
- Item power propio y de la party, cruzado con el proxy `/gameinfo/` que ya existe.
- Snapshots exportables, atajos de teclado, modo compacto para segunda pantalla.

---

## 4. Contratos técnicos a fijar antes de escribir código

### 4.1 Endpoints nuevos del `.exe`

```
GET  /api/tracker/status      → {available, capturing, server, npcap, admin, version}
POST /api/tracker/start|stop  → arranque/parada del sniffer (opt-in)
GET  /api/tracker/session     → sesión actual completa (para primer render)
GET  /api/tracker/dungeons?from=&to=
GET  /api/tracker/loot?from=&to=
GET  /api/tracker/storage
GET  /api/tracker/maps
GET  /api/tracker/trades
POST /api/tracker/snapshot    → congela el damage meter actual
WS   /ws                      → {type, ts, payload} con tipos: dmg, heal, fame, silver,
                                 loot, map, party, dungeon, trade, status
```

Todos detrás del `hostAllowed` que ya existe (anti DNS rebinding) y con el mismo `no-store`.
El heartbeat debe **ignorar** el tráfico del WebSocket como señal de vida o el `.exe` nunca se
apagaría solo; en cambio, el WS abierto cuenta como pestaña viva de forma explícita.

### 4.2 Estructura en disco

```
%APPDATA%\AyudanteAlbion\
  config.json          preferencias del tracker
  sessions\YYYY-MM-DD.json
  dungeons.json
  loot.jsonl
  storage.json
  trades.jsonl
  logs\photon.jsonl    solo en modo diagnóstico, rotado a 20 MB
```

### 4.3 Reglas de frontend

- Todo lo nuevo vive en `albion-app/js/tracker/` como módulos, siguiendo `docs/frontend-modules.md`.
  **Nada nuevo entra a `app.js`**, que ya tiene 9138 líneas.
- Pestañas nuevas: **Sesión**, **Combate**, **Botín**. El resto se cuelga de las que ya existen
  (mazmorras dentro de Sesión, trades dentro del Registro, mapas dentro del Tracker por Zona).
- El build ya copia `albion-app/js` completo al `.exe`; no hay que tocar `build.sh` salvo por
  la dependencia de `gopacket` en `go.mod`.

---

## 5. Riesgos, y cómo los manejamos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Los códigos de evento cambian en cada patch de Albion** | El tracker se rompe solo | Tabla de códigos en un JSON de datos, no en el binario: `albion-app/data/photon_codes.json`. Se actualiza sin recompilar. Detección de “versión de protocolo desconocida” con aviso claro en vez de números falsos |
| **Npcap no instalado o sin admin** | No captura | Detección temprana, mensaje con enlace y pasos. La app sigue funcionando completa sin tracker |
| **Antivirus marca el `.exe` por usar pcap** | Descargas bloqueadas | Mantener la firma de checksums que ya publicamos, documentar el permiso en `LEEME.txt` y en el README, y considerar dos binarios: `AyudanteAlbion.exe` (como hoy) y `AyudanteAlbion-Tracker.exe` |
| **Peso del binario y del build** | Release más pesada | `gopacket` es liviano; Npcap es instalación aparte, no se embebe |
| **Percepción de “cheat”** | Reputación | Copiar la postura explícita de SAT en README y en la propia UI: solo monitorea, no modifica el cliente, no ve jugadores fuera de tu vista, no hay overlay. Enlazar el hilo oficial de SBI |
| **VPN / ExitLag** | No captura | Documentarlo (a SAT le pasa igual) y ofrecer filtro por IP/puerto como hace SAT |
| **Privacidad** | Datos de terceros | Nada sale de la PC salvo lo que el usuario sube a la nube a mano; el log Photon es opt-in y rotado |
| **VPS/CI sin Windows** | No se puede testear | Fixtures sintéticas (Fase 0) + tests de los agregadores sin red; la captura se prueba a mano |

---

## 6. Qué NO vamos a copiar

- **Overlay sobre el juego.** SAT no lo tiene y es exactamente la línea que vuelve “cheat” a una
  herramienta. Nuestra segunda pestaña del navegador cumple igual.
- **Lectura de memoria o inyección.** Nunca.
- **Tracking de jugadores fuera de tu campo de visión.**
- Duplicar la calculadora de crafteo de SAT: la nuestra ya es mejor y está en español.

---

## 7. Orden recomendado y esfuerzo estimado

| Fase | Entregable | Esfuerzo |
|---|---|---|
| 0 | Cimientos + modo demo | 1 iteración |
| 1 | Captura + Photon + pestaña Sesión | 2–3 iteraciones ⚠️ la más incierta |
| 2 | Damage Meter completo | 2 iteraciones |
| 3 | Dashboard de sesión + mapas | 2 iteraciones |
| 4 | Mazmorras + recolección | 2 iteraciones |
| 5 | Loot + almacenamiento + comparador | 2–3 iteraciones |
| 6 | Trades → Registro de operaciones | 1–2 iteraciones |
| 7 | Party Builder + pulido | 1 iteración |

**Recomendación:** hacer Fase 0 y Fase 1 como un solo PR de exploración, detrás de una bandera, y
**no prometer nada público hasta que la Fase 1 muestre tu nombre de personaje real en pantalla**.
Ese es el punto donde el resto del plan pasa de ser una idea a ser trabajo mecánico.

---

## 8. Decisiones abiertas

1. ¿Un solo `.exe` con tracker o dos binarios (liviano / tracker) por el tema antivirus y admin?
2. ¿Npcap como requisito duro, o intentamos primero el fallback de raw socket?
3. ¿El tracker se limita al servidor West, como el resto de la app, o detectamos los tres?
4. ¿Los datos de sesión entran en la sincronización en la nube, o quedan solo locales por volumen?
