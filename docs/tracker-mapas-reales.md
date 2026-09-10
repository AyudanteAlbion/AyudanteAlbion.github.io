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
