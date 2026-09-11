# Arquitectura modular del frontend

La aplicación todavía se inicializa desde `../app.js`. Esta carpeta es el punto
 de migración gradual para evitar una refactorización grande y riesgosa.

## Progreso

### Etapa 2 — completada

- `core/storage.js` ya está cargado antes de `app.js`.
- Expone `window.AAStorage` como API clásica y segura.
- Favoritos y precios manuales ya utilizan esta API, con fallback para las
  pruebas que evalúan `app.js` de forma aislada.

### Etapa 3 — completada

- `core/format.js` ya está cargado antes de `app.js`.
- Expone `window.AAFormat` para plata, porcentajes y antigüedad de precios.
- `fmt`, `pct` y `ageBadge` consumen el módulo cuando la app se carga desde
  `index.html`.
- `app.js` conserva fallbacks temporales para las pruebas aisladas.

### Etapa 4 — completada

- `core/api.js` ya está cargado antes de `app.js`.
- Expone `window.AAApi.fetchJSON` con timeout, validación HTTP y manejo de
  abortos.
- Las consultas específicas de precios todavía permanecen en `app.js` para
  no mezclar esta extracción con cambios de comportamiento.
- `app.js` conserva un fallback temporal para las pruebas aisladas.

### Etapa 5 — completada

- `core/navigation.js` ya está cargado antes de `app.js`.
- Expone `window.AANavigation.activateTab` para actualizar el estado visual
  de pestañas, desplegables, acciones superiores y paneles.
- `gotoTab` conserva las responsabilidades específicas de cada módulo y usa
  el helper común para la parte visual.
- Se mantiene fallback para evaluación aislada.

### Etapa 6 — crafteo — completada

- `crafting/recipe.js` concentra la aritmética de una receta: tasa de
  retorno, costo de Foco, bonos por ciudad, impuestos, tasa de estación y
  ganancia.
- Recibe una función `price(id, city, kind)` en vez de leer precios: no
  conoce `manualPrices` ni el estado de las pestañas.
- Cocina, Alquimia y Refinamiento consumen el módulo a través de
  `calcRecipe`; `app.js` solo arma el contexto y agrega la fecha del precio,
  que es dato de presentación.

### Etapa 7 — perfil — completada

- `profile/specs.js` tiene las ramas del Destiny Board, el recorte de
  especialización (0–120) y maestría (0–100), la eficiencia (FCE) y el
  multiplicador de Foco.
- Suma las estadísticas derivadas del killboard: ratio K/D, ordenamiento del
  ranking del gremio y posiciones absolutas.
- Sin muertes, `fameRatio` devuelve `null` en lugar de `Infinity`: así nadie
  encabeza el ranking por no haber muerto nunca.

### Etapa 8 — builds — completada

- `builds/build.js` cubre slots, creación, duplicado, mejor precio por ítem,
  costo total y umbral de alerta.
- `duplicate` clona los slots. Antes la copia compartía el objeto `items`
  con el original y editar una pisaba la otra.
- El costo usa solo ciudades reales: el Black Market no es origen de compra
  y contarlo haría parecer la build más barata de lo que cuesta equiparla.
- `cost` informa `missing` para poder avisar que un total está incompleto en
  vez de mostrar un número más bajo que el real.

### Mercado — completado

- `market/history.js` centraliza snapshots, tendencias y oportunidades.
- El Buscador conserva la presentación y delega el análisis en
  `window.AAMarketHistory`.
- Las reglas de Black Market se reciben como configuración y no se mezclan
  con las ciudades de origen.

La suite completa debe seguir pasando antes de cada extracción siguiente.

## Orden de extracción

| # | Módulo | Estado |
|---|---|---|
| 1 | `core/storage.js` — lectura y escritura segura de `localStorage` | ✅ |
| 2 | `core/format.js` — formato de plata, porcentajes y fechas | ✅ |
| 3 | `core/api.js` — precios, catálogo y datos externos | ✅ |
| 4 | `core/navigation.js` — pestañas, slides y favoritos | ✅ |
| 5 | `market/history.js` — capturas, tendencias y oportunidades | ✅ |
| 6 | `crafting/recipe.js` — recetas y cálculo | ✅ |
| 7 | `profile/specs.js` — especializaciones y estadísticas del killboard | ✅ |
| 8 | `builds/build.js` — builds, costeo y alertas | ✅ |

Las ocho etapas planificadas están completas. Lo que sigue no tiene un orden
fijo: quedan por extraer las herramientas grandes que todavía viven enteras en
`app.js` (flipping, granja, encantado, transmutación, artefactos, tracker por
zona y el Salón de miembros). Conviene atacarlas por el mismo criterio: primero
la aritmética, después el render.

Cada extracción debe mantener la API global que utilizan las pruebas actuales.
Después de cada paso hay que ejecutar `npm test` antes de continuar.

## Pruebas

`albion-app/modules-test.js` prueba cada módulo **solo**, en un contexto sin
DOM. Si un módulo empieza a depender del documento, esa prueba falla y avisa
que dejó de ser lógica pura. Corre primero en la suite (`npm run test:modules`),
antes de la QA con jsdom.

## Regla de migración

- Extraer una responsabilidad por vez.
- No cambiar fórmulas y estructura al mismo tiempo.
- Evitar duplicar estado entre `app.js` y el módulo nuevo.
- Mantener la app funcionando como script clásico hasta que todos los módulos
  estén listos para pasar a ES modules.
- No cargar archivos de esta carpeta desde producción hasta que tengan pruebas
  y estén conectados explícitamente desde `index.html`.
- Los módulos son **lógica pura**: sin DOM, sin `fetch` y sin leer estado
  global. Lo que necesiten llega por parámetro (por ejemplo, la función de
  precios que recibe `crafting/recipe.js`).
- Cada punto de consumo en `app.js` conserva su fallback: las pruebas que
  evalúan `app.js` de forma aislada tienen que seguir pasando.
