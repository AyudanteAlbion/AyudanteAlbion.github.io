# Tracker de enemigos por mapa real – investigación y diseño

## Problema original
La app no puede traer info de mapas de SG (no hay endpoint oficial /guilds/:id/territories). Se quería mejorar el tracker de enemigos aunque no haya territorios.

## Investigación de mapas de Albion
- Fuente oficial del cliente: `cluster/world.xml` en https://github.com/broderickhyman/ao-bin-dumps
  - Cada `<cluster id="0000" displayname="@CLUSTER_NAME_...">` es una zona.
  - Conexiones: `<exit targetid="@CLUSTER@XXXX" targettype="Cluster" />` donde XXXX es ID numérico de mapa vecino.
  - Regex de mapa: `^(PSG-)?[0-9]{4}$`, exit target: split('@')[-1] regex `^[0-9]{4}$`.
  - El archivo completo pesa ~3.5MB, descargado vía GitHub blob API (api.github.com/repos/.../git/blobs/3d42841...) porque raw.githubusercontent.com bloqueado en sandbox.
- Intentos fallidos:
  - cdn.albionfreemarket.com/AlbionWorld/map/clusters.json 404
  - data.json 404
  - proxies allorigins, corsproxy, codetabs devolvieron vacío (egress bloqueado)
  - cluster XML individual solo trae `B_*_Exit_*` posicional sin vecino ID, insuficiente.
- Solución: parsear world.xml completo.

## Grafo generado
- Script Python parsea world.xml:
  - `adj_by_name`: {nombre_display: [vecinos_display]}
  - `adj_by_id`: {mapID: [vecinoID]}
  - `maps`: 847 entradas {mapID, mapName, mapType, tier} (815 base + 32 cruces: Swamp Cross, Mountain Cross, Highland Cross, Steppe Cross, Forest Cross, markets, banks, The Lighthouse, The Cove)
- Archivo final: `albion-app/data/albion_map_connections.json` 272KB
  - byName 442 keys con vecinos (ej Martlock -> Bank of Martlock, Blackthorn Quarry, Eldon Hill, Haytor, Martlock Market, Mase Knoll)
  - byId 410
  - maps 851
- Archivo debug: `albion_map_graph.json` solo adjacency.

## Diseño del tracker mejorado
UI en Mapa de Guerra (wmMount):
- Selector buscable: input + datalist/div de resultados (30 máx) usando `maps` (nombre + ID + tipo + tier + nº conexiones)
- Selección guarda en localStorage `wmSelectedMap`
- Al seleccionar:
  - `selectedNeighbors = mapGraph[selectedMap]`
  - `zonasObjetivo = [selectedMap, ...neighbors]`
  - Render de chips con todas las zonas, clic rápido para cambiar.

Lógica de rastreo:
- `pfFetchRetry('/battles?limit=100&sort=recent')` -> array battles con clusterName
- Filtrado client-side: `zoneSet.has(clusterName.toLowerCase())`
- Stats: totalFame, totalKills, nº batallas filtradas vs totales
- Guilds activos: agregación por `battle.guilds` (objeto o array) -> kills, battles, lastAt, ordenado por kills
- Events recientes: `/events?limit=51` filtrado por guilds top 15 detectados (proxy para mostrar kills de esos gremios)
- Render:
  - Stats row
  - Chips zonas objetivo
  - Tabla batallas (fecha, mapa, kills, fama, gremios)
  - Lista gremios activos (tracker de enemigos)
  - Kills recientes de esos gremios
  - Manejo sin datos: mensaje explicativo, reintentar
- Expansión batalla: click en fila muestra ID y link a killboard oficial.

Persistencia y performance:
- Grafo se carga lazy con `fetchJSON('data/albion_map_connections.json')` en `wmLoadMapGraph()`, cache en WM
- Fallback a `albion_maps.json` si falla
- Tracker carga solo con mapa seleccionado, con flag `force` para evitar recargas innecesarias
- Botón "Rastrear zona" dispara `wmLoadTracker(true)`

## Referencias
- https://github.com/broderickhyman/ao-bin-dumps/blob/master/cluster/world.xml (fuente)
- https://github.com/ao-data/ao-bin-dumps (repo formateado)
- Albion Online wiki: map connections son bidireccionales, ciudades tienen 4-6 conexiones (ej Martlock)
- Killboard API: /battles incluye clusterName, /events no incluye zona, por eso se usa battles para tracker geográfico

## Mejora futura
- Mostrar mapa visual con SVG usando posiciones de exits (si se parsean x,y de world.xml)
- Alertas por zona: notificar cuando hay batalla en zonas vigiladas
- Heatmap de actividad por hora

---

# Fase 2 (2026-09): minimapa, alertas por zona, rutas y scoring de peligro

## Coordenadas del mundo
- world.xml trae `worldmapposition="x y"` en cada `<cluster>` del mapa del mundo: 418 zonas
  posicionadas (todo el continente Royal + Zona Negra). Bancos, mercados y zonas interiores no
  tienen posición; los Caminos de Avalon son dinámicos y tampoco.
- `scripts/build_map_data.py` agrega `x`,`y` a `maps[]` de `albion_map_connections.json`
  sin tocar byName/byId (los nombres deben seguir casando 1:1 con `clusterName` de /battles).
  Verifica el join con una lista de zonas obligatorias (ciudades, Blackthorn Quarry, etc.).

## 1 · Minimapa SVG (`wmRenderMinimap`)
- Nodos = zonas con posición; aristas = conexiones del grafo entre zonas posicionadas (~634).
- Verde = seleccionado, amarillo = vecinos, rojo pulsante = batallas (radio según score de
  peligro), rombo dorado = territorios SG, línea dorada = ruta calculada.
- Tooltip con tipo/tier, score, batallas 2 h, kills y fama. Clic en nodo = seleccionar.
- Zoom con rueda (centrado en el puntero), paneo arrastrando, botones ＋/−/⤢.

## 2 · Alertas por zona (`WZ`)
- Mismo patrón que las alertas de precio (`WA`): `wmZoneAlerts` + `wmZoneSeen` en localStorage.
- Ciclo por defecto cada 3 min (configurable 2–15). `wzTick` usa `wmFetchBattles(45e3)`: el
  motor de alertas fuerza datos frescos; la caché de 5 min queda para la UI.
- Primer ciclo = línea de base (no dispara). Después avisa batallas nuevas (<15 min de
  antigüedad) en zonas vigiladas: toast + `waBeep` + `Notification` opcional. Dedupe por id
  (tope 1000 vistos), máx 20 zonas, máx 5 avisos por ciclo.

## 3 · Rutas (`wmRouteCalc`)
- Más corta: BFS por saltos sobre `byName`. Más segura: Dijkstra donde entrar a una zona cuesta
  `1 + min(12, score/4)` (cada 4 puntos de peligro = un salto extra; aplica a cualquier tipo de
  zona: si el killboard reporta batallas ahí, no es segura).
- Checkbox «Evitar Caminos de Avalon». Chips por salto con badge de peligro y batallas 2 h.
- La ruta segura se dibuja en el minimapa.

## 4 · Scoring de peligro
- `danger = Σ (kills·1 + fama/1000) · 0.5^(Δt/2h)` por zona (vida media 2 h), sobre las
  últimas 100 batallas del servidor.
- Umbrales: 🟢 ≤ 4 tranquilo · 🟡 ≤ 20 activo · 🔴 > 20 muy caliente (heurístico).
- Badges en chips de zona, filas de batalla, rutas y minimapa. Gremios activos con K/D.

## 5 · Detalle de batalla
- Clic en fila → `pfFetchRetry('/battles/{id}')` (ruta nueva en el Worker) → tabla de
  participantes: jugador, gremio, IP promedio, K/D, fama y arma (decodificada vía catálogo).
- Caché en memoria (`WM.detailCache`), «ver todos» para batallas grandes.

## 6 · Filtros por tipo de mapa
- Chips: Todos · Ciudades y hubs · Royals · Zona Negra · Negra T7–T8 · Caminos de Avalon.
- Filtran el buscador y atenúan los nodos del minimapa. Persisten en `wmMapFilter`.

## 7 · Territorios SG
- BFS desde el mapa seleccionado hasta los territorios reconstruidos por GvG:
  «Tu territorio más cercano: X a N saltos» + rival más cercano. Marcados en el minimapa.

## 8 · UX y share
- `?map=Nombre` abre directo el Mapa de Guerra con esa zona (validada contra el grafo; si no
  hay sesión, queda preseleccionada para después del ingreso). Botón 🔗 copia el link.
- Export CSV de batallas filtradas (separador `;`, BOM, neutralización de fórmulas).
- Caché de /battles en localStorage (`wmBattlesCache`, 5 min, versión aligerada de cada batalla).
- Móvil: el tracker se abre como hoja inferior con botón flotante 🎯.

## QA
- `qa-test.js`: stubs de `/battles` y `/battles/:id`, territorio propio en zona real
  (Kindlegrass Steppe, adyacente a Astolat) y ~20 chequeos nuevos del tracker por zona.
- `worker/selftest.mjs`: `/battles/:id` permitida y traversal bloqueado.
