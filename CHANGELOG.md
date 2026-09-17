# Changelog

Historial de versiones de **Ayudante Albion**. El formato sigue el espíritu de
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones usan
[SemVer](https://semver.org/lang/es/).

Las notas completas de cada versión, tal como se publican en el release, están
en [`docs/releases/`](docs/releases/). Las descargas (`.exe` y `.zip`) están en
[Releases](https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases).

---

## [v1.4.0] — sin publicar

### Añadido

- Avisos de licencia y procedencia (`NOTICE` y `docs/licencia-gpl.md`) para las
  adaptaciones GPL-3.0 del ciclo de entidades del tracker basadas en
  **AlbionOnline-StatisticsAnalysis (SAT)**, con el commit de referencia y la
  ruta al código fuente correspondiente.
- Modelo persistente de entidades por **GUID + ObjectId** en el tracker de
  escritorio: Join registra el jugador local; NewCharacter vuelve a enlazar
  IDs de zona; y el roster completo de party, altas, bajas y disband quedan
  correlacionados por GUID.
- Pruebas de la representación de GUID de Photon, rebinding tras cambio de
  zona, ciclo completo de party y final inesperado de una fuente de captura.

### Cambiado

- La licencia de Ayudante Albion cambia de **MIT** a **GPL-3.0-only**. Los
  paquetes de escritorio incluyen `LICENSE`, `NOTICE` y `SOURCE_CODE.txt` con
  la referencia al commit de la fuente correspondiente.
- **Las pestañas Sesión, Recolección y Mazmorras pasan a ser exclusivas de la
  app de escritorio.** Las tres se alimentan de la captura de red del juego,
  imposible en un navegador, así que la web ya no las muestra ni carga su
  código (`js/tracker/*` y sus CSS); la app de escritorio las mantiene tal
  cual, ya implementadas. La web conserva todas las herramientas de cálculo,
  mercado, registro, perfil y SG.
- El interruptor «seguimiento de comercio» del Registro de operaciones ya no
  aparece en la web: solo tiene efecto en la app de escritorio, la única con
  rastreo en vivo.
- README actualizado al modelo vigente: dos productos independientes (web en
  `albion-app/` y escritorio en `desktop/`), un solo `.exe`, distribución del
  binario como artefacto del workflow **Escritorio** y cierre del capítulo del
  ejecutable clásico con sus dos ediciones.
- `docs/tracker-escritorio.md` reescrito: describe la app de escritorio Wails
  y el motor del tracker tal como están hoy (antes documentaba `albion-exe/`
  y el modelo de dos ejecutables con build tags).
- `tools/tracker_dev.py` ahora sirve `desktop/ui/` (donde están las pestañas
  del tracker) con `data/`, `icons/` e `img/` resueltos desde `albion-app/`,
  como hace el frontend embebido del `.exe`.
- `CODEOWNERS`: retira las rutas muertas `/build.sh` y `/albion-exe/`, y
  protege `/desktop/`.
- `docs/photon-codes.md`, `docs/frontend-modules.md` y `desktop/ui/README.md`
  actualizados a la separación web/escritorio.
- **Recolección y Mazmorras registran solas, en segundo plano.** El usuario
  activa el tracking una vez en **Sesión**; en cuanto el JoinResponse detecta
  el personaje, las dos pestañas empiezan a acumular sin que haya que abrirlas
  ni encender nada en ellas. Sus interruptores dejan de ser controles (que
  arrancaban y detenían la captura por su cuenta, pisando lo configurado en
  Sesión) y pasan a ser indicadores de solo lectura con el estado real:
  «Activá el tracking en la pestaña Sesión», «Capturando · esperando detectar
  tu personaje» o «Registrando automáticamente».

### Corregido

- **El tracker se quedaba en cero con el juego abierto.** El primer byte de
  cada mensaje Photon es la *firma*, no un selector de formato: se usaba para
  elegir entre Protocol18 y Protocol16, así que todo mensaje cuya firma no
  fuera `0x00` (el `0xF3` clásico, entre otros) caía en el decodificador viejo
  y se descartaba entero. Ahora se decodifica siempre con Protocol18 —igual que
  la aplicación de referencia— y Protocol16 queda reservado a su firma
  explícita. Además, un byte de relleno al final ya no invalida un mensaje bien
  decodificado, y los `flags` de cabecera desconocidos se enmarcan como un
  paquete normal en vez de tirarlo.
- **Tracking con VPN, ExitLag o proxies:** un datagrama de Albion en un puerto
  remapeado se reconoce por su envelope Photon (`0xF1`/`0xF2`/`0xFE`) y ya no
  se descarta por no venir en 5055/5056/5058. El tráfico ajeno en puertos
  ajenos se sigue ignorando.
- **El diagnóstico ya distingue "no llega nada" de "llega y se descarta".** Se
  cuentan las tramas entregadas por el driver antes de interpretarlas, junto al
  tipo de enlace del adaptador; el panel explica qué revisar en cada caso. Sin
  ese contador, "UDP 0" no permitía saber si fallaba NPCap, el adaptador o el
  protocolo.
- La detección de personaje deja de inferirse desde el nombre o un ObjectId
  transitorio: se confirma únicamente con la respuesta exitosa de Join y se
  conserva por GUID. La tabla y los fixtures ahora usan `NewCharacter=29`, no
  el valor histórico 24.
- Se corrige la indicación anterior sobre cambios de zona: `ChangeCluster`
  actualiza únicamente la ubicación; no vuelve a emitir Join ni puede detectar
  el personaje si la captura empezó tarde. El panel indica volver al selector
  de personaje e ingresar otra vez.
- Si `Source.Run` termina inesperadamente, el motor deja de mostrarse como
  activo y expone el error de captura en vez de dejar `capturing:true` colgado.
- **Las pestañas Recolección y Mazmorras quedaban siempre vacías con captura
  real.** Los eventos `gathering` y `dungeonRun` que consumen solo los producía
  el simulador de demo: el motor de captura nunca los emitía, así que con el
  juego abierto no se registraba ni una recolección ni una partida. Ahora
  `HarvestFinished` se traduce en una recolección —sumando cantidad base, bonus
  de recolector y bonus premium, y descartando la de otros jugadores visibles
  en la zona— y las partidas de mazmorra se abren y cierran siguiendo los
  cambios de instancia del cluster (`guid@RANDOMDUNGEON@SOLO` y compañía), con
  fama, plata y respec calculados como la diferencia de los contadores de
  sesión entre entrar y salir. Las zonas abiertas, ciudades y refugios no
  generan partidas.
- `photon_codes.json` documenta los índices de parámetros de `HarvestFinished`
  (verificados contra `HarvestFinishedEvent` de SAT): el código del evento ya
  estaba en la tabla, pero sin índices no se podía leer ningún parámetro.
- **«Detectar de nuevo» rompía la conexión que ya funcionaba.** El botón
  llamaba a `/api/tracker/character/refresh`, que hacía `Stop()` + `Start()`:
  eso tiraba abajo la captura viva y obligaba a rehacer todo el pipeline
  (Photon detectado, servidor confirmado), además de borrar el personaje que
  ya estaba fijado. Ahora la ruta no toca una captura en curso: si hay
  identidad válida, solo reemite el snapshot para repintar el personaje; si no
  la hay, limpia la identidad —nunca las métricas— y espera el próximo
  JoinResponse. La captura únicamente se arranca si estaba detenida. Los
  textos de ambos botones aclaran qué hace cada uno: «Detectar de nuevo»
  vuelve a leer el personaje y «Reiniciar sesión» pone en cero los contadores.
- Los menús **Crafteo** y **Flipping** de la barra lateral se abren solo al
  hacer clic en su botón. Antes se desplegaban al pasar el cursor por encima,
  lo que tapaba el resto de la navegación sin que el usuario lo pidiera.
- El despliegue de la web (`web.yml`) ahora copia `albion-app/css/` al sitio y
  lo incluye en los disparadores: el `index.html` enlaza hojas de ese directorio
  que en producción devolvían **404** y dejaban módulos sin estilos (quedaba
  `css/trade-tracking.css`, del Registro de operaciones).

### Eliminado

- `DATA_CHECK.zip` (16 MB) y `DATA_CHECK1.zip` (10 MB) de la raíz: volcados de
  código C# sin referencias ni relación con el proyecto.
- De la web: `js/tracker/client.js`, `js/tracker/ui.js`,
  `js/tracker/gathering.js`, `js/tracker/dungeons.js` y las hojas
  `css/tracker-setup.css`, `css/gathering.css` y `css/dungeons.css` (siguen
  existiendo, sin cambios, en la app de escritorio).

---

## [v1.3.0] — sin publicar

Notas completas: [`docs/releases/v1.3.0.md`](docs/releases/v1.3.0.md) ·
README de la versión: [`docs/releases/v1.3.0-README.md`](docs/releases/v1.3.0-README.md)

### Añadido

- Sesiones manuales de actividad (transporte, farmeo, crafteo, flipping, PvE, PvP) con cálculo de rendimiento en plata por hora (silver/h), gastos operativos, seguimiento de sesión activa en tiempo real e importación/exportación universal y segura de archivos CSV.
- Alertas robustas contra precios viejos: validador central de cotizaciones, preferencia de frescura máxima (15 min, 60 min o sin límite) y estado “esperando cotización reciente”.
- Historial real de precios por ciudad/calidad desde `stats/history`, con gráfico SVG, rangos 7/30/90/180/365 días, caché corta y separación explícita entre **Historial de la API** y **Tus consultas guardadas**.
- Analítica avanzada del Registro de operaciones: `tradeLog` v2, comisiones/impuestos, coste extra de crafteo, fecha editable, métricas netas, rankings, pérdidas, resultado por ítem/ciudad, series diaria/semanal y distribución por hora local.
- Explorador de **ítems observados en pérdidas públicas** desde `/gameinfo/events`, con caché local de 7 días, deduplicado, separación equipo/inventario, filtros y valorización orientativa por lote.
- **Sincronización entre dispositivos** (Workers KV): los miembros de SG que
  ingresan con Discord pueden subir, bajar y borrar una copia de sus datos desde
  el bloque ☁️ del *Registro de operaciones*. Nada automático: cada acción pide
  confirmación y muestra la fecha de la copia remota.
- Ruta `/sync` en el Worker (`GET`, `PUT`, `DELETE`), la única que acepta
  métodos de escritura, con clave `u:<id de Discord>`.
- Binding KV `AA_SYNC` declarado en `wrangler.toml`.
- Planificador de producción con desglose recursivo, inventario, lista de
  compras y exportación CSV.
- Historial de capturas de precios, tendencias y detector de oportunidades de
  flipping.
- Módulos de lógica pura: `core/storage`, `core/format`, `core/api`,
  `core/navigation`, `market/history`, `crafting/recipe`, `profile/specs` y
  `builds/build` — se completan las ocho etapas de modularización.
- `SECURITY.md`: política de seguridad pública con canal de reporte privado,
  plazos y alcance.
- `docs/sincronizacion.md` y `docs/deploy-worker.md`.
- `package.json` en la raíz con la suite unificada de validación y pruebas sin dependencias externas.
- Suite local sin dependencias: `scripts/validate_repo.py` comprueba sintaxis,
  referencias y entradas del build; `scripts/phase_qa.js` cubre los contratos
  de frescura de alertas, historial API, analítica del registro y pérdidas
  públicas. `npm test` ejecuta ambas.
- Contrato de `/sync` replicado en `server.py` con un almacén en memoria, para
  probar el flujo completo sin Cloudflare.
- **Changelog en Discord**: cada push a `main` que toque `CHANGELOG.md` publica
  en el canal de Actualizaciones el resumen de la versión en curso
  (Añadido/Cambiado/Corregido), como mensaje aparte de la alerta de release.

### Cambiado

- **La sesión de Discord vence a los 7 días** y se revalida con el Worker en
  cada carga: cada tanto hay que volver a tocar «Ingresar con Discord».
- README reescrito para quien usa la app: herramientas agrupadas por propósito,
  lenguaje en presente e índice de documentación (236 → 176 líneas).
- Encabezado del README renovado: el escudo y el nombre de **Spetsnaz Grail**
  pasan a una insignia enmarcada que enlaza a spetsnazgrail.com
  (`docs/sg_badge.png`), el Discord de la app baja de banner de 520 px a una
  insignia discreta (`docs/discord_badge.svg`) y se retiran el banner
  `docs/boton_discord.png`, las citas a `docs/sincronizacion.md` y
  `docs/deploy-worker.md`, y la sección **Desarrollo**.
- Allowlist más estricta en Worker, `server.py` y ejecutable; `/battles/{id}`
  acotado por expresión regular.
- El ejecutable valida el header `Host` (anti DNS rebinding) y suma cabeceras de
  seguridad.
- CI/CD: los datos del evento entran por variables de entorno y el JSON se arma
  con `jq`, sin interpolación de shell; actions pineadas por SHA.

### Corregido

- **El tracker vuelve a detectar el personaje y la ubicación.** La tabla
  `photon_codes.json` tenía códigos desfasados respecto del protocolo actual
  (`NewCharacter` 24 → **29**, `UpdateFame` 89 → **82**, `ChangeCluster` 38 →
  **41**, entre otros): el ejecutable recibía los paquetes de Albion pero no
  reconocía ninguno, así que mostraba «Datos del juego recibidos» junto a
  «Personaje no detectado». Los números se recalcularon como el ordinal de cada
  miembro de los enums `EventCodes.cs` y `OperationCodes.cs` de la app de
  referencia, y un test nuevo los fija para que no se vuelvan a desfasar.
- **La ubicación se detecta al entrar, no solo al cambiar de mapa.** La
  respuesta de `Join` trae el personaje *y* el mapa inicial (parámetro 8), pero
  solo se leía el nombre.
- **Cambiar de zona ahora recarga los datos del tracking.** `ChangeCluster` se
  estaba escuchando como *evento*, y en el protocolo es una *operación*: el
  `case` nunca se ejecutaba y un cambio de mapa no actualizaba nada. Ahora se
  atiende como operación (pedido y respuesta), se cierra la visita al mapa
  anterior, se descartan las entidades de la zona vieja y se conserva la
  identidad propia. Gracias a esto, quien active el tracking con la sesión ya
  abierta puede recuperar personaje y ubicación **cambiando de zona**, sin
  cerrar sesión.
- **Plata y botín dejan de contar de más.** `TakeSilver` solo suma si la levantó
  el personaje propio, y el saqueador de `OtherGrabbedLoot` se lee como nombre
  (que es como lo manda el juego) en lugar de como id de entidad.
- **El fix de detección de personaje/zona de arriba llega por fin al ejecutable
  real.** Se había corregido antes en `desktop/internal/tracker` (la copia
  usada por la variante Wails), pero `AyudanteAlbion-Tracker.exe` se compila
  desde `albion-exe/tracker`, una copia forkeada aparte que nunca recibió el
  port: seguía tratando `ChangeCluster` como evento y no leía la zona del
  `Join` inicial, así que el bug persistía en la app que la gente baja aunque
  el changelog ya lo diera por corregido. Ahora `albion-exe/tracker` está
  sincronizado con la versión corregida (incluidos los endpoints
  `/api/tracker/devices` y `/api/tracker/restart` que la interfaz ya llamaba
  para elegir Npcap/socket y adaptador de red, y que faltaban del todo en el
  backend distribuido).
- **Los avisos de cambios vuelven a llegar a Discord**: el workflow ahora
  detecta `CHANGELOG.md` y `README.md` comparando los árboles Git anterior y
  nuevo del push. Antes dependía de la lista `commits` del evento, que podía no
  incluir los archivos modificados al fusionar un PR y dejaba ambos avisos
  salteados aunque la ejecución figurara como exitosa.
- **Los módulos del frontend ahora sí llegan al navegador.** `index.html`
  cargaba los ocho archivos de `js/`, pero ni el workflow de GitHub Pages ni
  `build.sh` copiaban esa carpeta: la web y el `.exe` pedían los ocho, recibían
  404 y la app corría con los fallbacks de `app.js`. Los cálculos eran
  correctos —módulo y fallback devuelven lo mismo, ahora verificado por
  prueba—, pero la modularización nunca se había ejecutado fuera del servidor
  de desarrollo.
- **Duplicar un build ya no pisa el original**: la copia compartía el objeto
  `items` con el build de origen.
- **El ranking del gremio ya no lo encabeza quien nunca murió**: sin muertes, el
  ratio de fama devolvía `Infinity`; ahora devuelve `null`.
- Recorte de especialización (0–120) y maestría (0–100): un valor absurdo
  desfiguraba el cálculo de Foco en cuatro pestañas a la vez.

### Validación

QA 250 · Worker 95 · Módulos 54 · Recursos 31 · Integración 19 · Black Market 39 ·
Granja 38 · evidencia del Tracker y prueba de humo, todo sin errores.

---

## [v1.2.11] — 2026-09-10

Notas completas: [`docs/releases/v1.2.11.md`](docs/releases/v1.2.11.md)

### Añadido

- Ranking **«Actividad por zona»** ordenado por asesinatos, con barra
  proporcional, batallas, fama y última actividad.
- Feed **«Asesinatos recientes en la zona»** con enlaces de verificación por
  kill (KillBoard#1, AlbionOnline2D y batalla oficial).
- Panel **«Fuentes de datos»** con estado por proveedor y veredicto de frescura
  (✅ al día · 🟡 hasta 30 min · 🔴 atraso).
- Exportación CSV de asesinatos filtrados.
- Aviso al entrar al Tracker y al Mapa de Guerra: «Función todavía en
  desarrollo. Los datos no son 100% seguros».
- Proxy acotado a Murderledger / AlbionOnline2D con allowlist estricta, en
  Worker, `server.py` y ejecutable.

### Cambiado

- **Datos insuficientes ≠ zona tranquila**: desaparece el 🟢 «tranquilo». Con
  evidencia baja, ausente o vieja la zona se marca ⚪ «no hay datos
  suficientes». La ausencia de registros no demuestra seguridad.
- Las rutas dejan de presentarse como garantía: la alternativa se describe como
  «menor actividad registrada».
- Mapa de Guerra y Tracker por Zona pasan a ser **dos botones independientes**
  del Salón de miembros, cada uno con su pestaña; antes se pisaban.
- Móvil: se elimina la hoja inferior y el botón flotante 🎯.
- Cada kill crudo aporta al score de peligro por zona, con decaimiento de 2 h.

### Corregido

- **«Killboard oficial sin respuesta»**: la API rechaza `limit` mayor que 51, así
  que `/battles` se trae en 3 páginas de 51 con dedupe y tolerancia a 502.
- Los asesinatos en solitario ya aparecen: se suma el feed crudo `/events`
  (5 páginas de 51) con zona de la víctima.
- Fechas inválidas o futuras se descartan como evidencia.

---

## [v1.2.10] — 2026-09-10

Notas completas: [`docs/releases/v1.2.10.md`](docs/releases/v1.2.10.md)

### Añadido

- **Tracker de actividad PvP por zona** sobre el grafo oficial de 851 zonas de
  `world.xml`.
- **Minimapa del mundo** (418 zonas) con zona seleccionada, vecinas, batallas
  recientes como puntos rojos pulsantes y territorios de SG en rombo dorado;
  zoom, paneo y detalles al pasar el mouse.
- **Rutas seguras**: camino más corto (BFS) y camino más seguro, que esquiva
  zonas calientes según las batallas de las últimas 2 h, con opción de evitar
  los Caminos de Avalon.
- **Peligro por zona**: score con decaimiento de 2 h y badges 🟢 / 🟡 / 🔴.
- **Alertas por zona**: hasta 20 zonas vigiladas, chequeo cada 2–15 min y aviso
  con toast, beep y notificación del navegador.
- **Detalle de batalla** con participantes, gremio, IP promedio, K/D y arma
  decodificada en español.
- Filtros por tipo de mapa, links `?map=NombreDeZona`, exportación CSV y caché
  local de 5 min.

### Cambiado

- El Worker deja pasar `/battles/{id}` (solo lectura, misma allowlist estricta).
- `albion_map_connections.json` incorpora coordenadas x,y y queda 80 KB más
  liviano al compactarse.
- El ejecutable incorpora lo que la web ya tenía desde v1.2.9.

---

## [v1.2.9] — 2026-09-09

Notas completas: [`docs/releases/v1.2.9.md`](docs/releases/v1.2.9.md)
*(documentada; no se publicó como release en GitHub — sus cambios llegaron al
ejecutable con v1.2.10)*

### Añadido

- Pastilla **«Únete a nuestra comunidad»** en el Inicio, que abre el Discord de
  la app (avisos de versiones, bugs y pedidos de funciones).
- Nuevo arte de marca: portada, logo y escudo de Spetsnaz Grail, optimizados
  para tema claro y oscuro.

### Cambiado

- El logo de Discord del Inicio es SVG inline: no se agregaron imágenes, no
  cambió la CSP y el build no necesita pasos extra.
- Las fuentes de alta resolución pasan a `docs/branding/`, así no viajan dentro
  del `.zip` (~5,6 MB menos).
- Quedan diferenciados el Discord de la app y el del gremio, que es el que
  verifica la membresía del Salón.

---

## [v1.2.8] — 2026-09-09

Notas completas: [`docs/releases/v1.2.8.md`](docs/releases/v1.2.8.md)

### Añadido

- **Mercado Negro** como destino de venta en Flipping, incluido en la mejor ruta
  automática y en las preferencias guardadas.
- **Salón de miembros** separado de la pestaña SG, con acceso y herramientas.
- Botón **Reportar un problema** al final del Inicio, que abre un issue de
  GitHub con plantilla en español.
- **Ciudad de la isla** separada de **ciudad de precios** en Granja, con bono
  local nominal de +10%, indicador y desglose por producto.

### Cambiado

- Inicio reorganizado en dos slides manuales, **Crafteo** y **Flipping**, con
  navegación por teclado, adaptación a móvil y respeto por la preferencia de
  movimiento reducido.
- En crafteo, «familia» pasa a llamarse **«rama»**.
- La venta al Mercado Negro se calcula con su mejor orden de compra, con
  impuesto y sin tasa de publicación.

### Corregido

- Nunca se ofrece el Mercado Negro como lugar de compra ni de crafteo.
- No se inventa precio de venta del Mercado Negro cuando falta la orden de
  compra.
- Cosecha, Premium, devolución de semillas y cuidados de animales en Granja; el
  bono de isla no aumenta crías, animales vivos ni monturas.

---

## [v1.2.7] — 2026-09-09

### Corregido

- El botón **«Ingresar con Discord»** de la barra superior ya funciona: antes no
  estaba conectado al login.
- En el ejecutable, el killboard (Perfil y Salón) carga sin depender del proxy
  de Cloudflare, y el indicador EN VIVO / OFFLINE de Twitch funciona también con
  CORS bloqueado.

### Añadido

- Íconos que faltaban (candado del Salón, trofeo del ranking, vínculo del
  personaje, estadísticas, gamepad, descarga, actualizar) e íconos en las
  pestañas. El módulo SG pasa de emojis a los íconos de línea del resto.
- Vista previa con ícono y descripción al compartir la app en Discord o
  WhatsApp.

### Cambiado

- El indicador EN VIVO / OFFLINE de los creadores de SG va debajo de su foto.

---

## [v1.2.6] — 2026-09-08

Correcciones y ajustes menores. Sin notas propias en el release.

## [v1.2.5] — 2026-09-08

Correcciones y ajustes menores. Sin notas propias en el release.

## [v1.2.4] — 2026-09-08

Correcciones y ajustes menores. Sin notas propias en el release.

## [v1.2.3] — 2026-09-08

Correcciones y ajustes menores. Sin notas propias en el release.

## [v1.2.2] — 2026-09-08

Correcciones y ajustes menores. Sin notas propias en el release.

## [v1.2.1] — 2026-09-08

Correcciones y ajustes menores. Sin notas propias en el release.

## [v1.2.0] — 2026-09-08

Primera versión publicada desde el repositorio actual
(`AyudanteAlbion/AyudanteAlbion.github.io`). Sin notas propias en el release.

---

## [v1.1.0] — 2026-09-07

### Añadido

- **Pestaña Perfil**: búsqueda del personaje real en el killboard oficial, fama
  de asesinatos y muertes, ratio K/D, fama PvE por zona (Royal, Outlands,
  Avalon, Hellgates, Corruptas, Nieblas), recolección, pesca, granja y crafteo.
- Datos de **gremio y alianza**: miembros, fama total, fundador y fecha.
- **Últimos 10 asesinatos y muertes** con rival, gremio, arma, IP de ambos, fama
  y participantes.
- **Especializaciones del Destiny Board** (0–120) y maestría (0–100) por rama,
  con eficiencia (FCE) y porcentaje del Foco base; se aplican automáticamente en
  todas las pestañas de crafteo.
- **Ícono propio del ejecutable** (yunque dorado) en Explorador, barra de tareas
  y accesos directos.

---

## [v1.0.2] — 2026-09-07

### Añadido

- **Planificador de salto libre** en Encantado: elegís origen y destino
  (por ejemplo .1 → .3) y se muestran los materiales paso a paso, el costo total,
  el ahorro frente a comprar directo y la ganancia de venta, con impuesto y tasa
  de publicación descontados.
- Todos los precios de Encantado editables a mano, con guardado y botón ↺ para
  volver al precio de la API.

### Corregido

- **Conexión estable hasta 15 minutos de inactividad**: antes el servidor del
  `.exe` se apagaba a los pocos segundos porque los navegadores frenan los
  temporizadores de las pestañas en segundo plano.

---

## [v1.0.1] — 2026-09-07

### Añadido

- Botones **«Registrar»** en los detalles de Flipping y Crafteo de equipo, que
  precargan la operación (ítem, tipo, precio y ciudad) en el Registro.
- Tarjetas de Inicio y secciones de Fórmulas para Encantado, Granja, Buscador de
  precios y Registro.
- Suite de **26 verificaciones automatizadas** sobre los 11 módulos: fórmulas
  RRR y P&L validadas numéricamente, 1.240 ítems encantables y 109 farmables
  verificados.

### Cambiado

- Desplegables de Crafteo ▾ y Flipping ▾ solo con ícono y título, sin
  subtítulos.
- La marca de la barra superior pasa a «Servidor Americas (West)».

---

## [v1.0] — 2026-09-07

Primera versión pública.

### Añadido

- 11 herramientas: Cocina, Crafteo, Refinamiento, Alquimia, Encantado, Granja,
  Flipping, Transmutación, Artefactos, Buscador de precios y Registro de
  operaciones.
- Ejecutable de Windows: doble clic, se abre en el navegador y se apaga al
  cerrar la pestaña.
- Precios en tiempo real del servidor Américas (West) vía Albion Online Data
  Project.

---

[v1.3.0]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/compare/v1.2.11...main
[v1.2.11]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.11
[v1.2.10]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.10
[v1.2.9]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/blob/main/docs/releases/v1.2.9.md
[v1.2.8]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.8
[v1.2.7]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.7
[v1.2.6]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.6
[v1.2.5]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.5
[v1.2.4]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.4
[v1.2.3]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.3
[v1.2.2]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.2
[v1.2.1]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.1
[v1.2.0]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.2.0
[v1.1.0]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.1.0
[v1.0.2]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.0.2
[v1.0.1]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.0.1
[v1.0]: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/tag/v1.0


