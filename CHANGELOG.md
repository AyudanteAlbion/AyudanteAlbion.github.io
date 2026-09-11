# Changelog

Historial de versiones de **Ayudante Albion**. El formato sigue el espíritu de
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones usan
[SemVer](https://semver.org/lang/es/).

Las notas completas de cada versión, tal como se publican en el release, están
en [`docs/releases/`](docs/releases/). Las descargas (`.exe` y `.zip`) están en
[Releases](https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases).

---

## [v1.3.0] — sin publicar

Notas completas: [`docs/releases/v1.3.0.md`](docs/releases/v1.3.0.md) ·
README de la versión: [`docs/releases/v1.3.0-README.md`](docs/releases/v1.3.0-README.md)

### Añadido

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
- `package.json` en la raíz con la suite unificada de pruebas (`jsdom`).
- Dos pruebas nuevas que cubren el hueco por el que se coló el fallo de los
  módulos: `assets-test.js` comprueba que todo archivo referenciado por
  `index.html` exista en el artefacto publicado (corre en el workflow de Pages
  antes de subirlo y en `build.sh` antes de compilar el `.exe`), e
  `integration-test.js` carga `app.js` **con** los módulos, como el navegador,
  y compara cada fórmula contra su fallback para que las dos copias no se
  separen.
- Contrato de `/sync` replicado en `server.py` con un almacén en memoria, para
  probar el flujo completo sin Cloudflare.

### Cambiado

- **La sesión de Discord vence a los 7 días** y se revalida con el Worker en
  cada carga: cada tanto hay que volver a tocar «Ingresar con Discord».
- README reescrito para quien usa la app: herramientas agrupadas por propósito,
  lenguaje en presente e índice de documentación (236 → 176 líneas).
- Allowlist más estricta en Worker, `server.py` y ejecutable; `/battles/{id}`
  acotado por expresión regular.
- El ejecutable valida el header `Host` (anti DNS rebinding) y suma cabeceras de
  seguridad.
- CI/CD: los datos del evento entran por variables de entorno y el JSON se arma
  con `jq`, sin interpolación de shell; actions pineadas por SHA.

### Corregido

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

