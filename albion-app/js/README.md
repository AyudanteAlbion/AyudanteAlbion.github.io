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

### Mercado — completado

- `market/history.js` centraliza snapshots, tendencias y oportunidades.
- El Buscador conserva la presentación y delega el análisis en
  `window.AAMarketHistory`.
- Las reglas de Black Market se reciben como configuración y no se mezclan
  con las ciudades de origen.

La suite completa debe seguir pasando antes de cada extracción siguiente.

## Orden de extracción

1. `core/storage.js`: lectura y escritura segura de `localStorage`.
2. `core/format.js`: formato de plata, porcentajes y fechas.
3. `core/api.js`: precios, catálogo y datos externos.
4. `core/navigation.js`: pestañas, slides y favoritos.
5. `market/`: buscador, flipping, alertas e historial.
6. `crafting/`: recetas, cálculo y planificador.
7. `profile/`: sesión, sincronización y datos del personaje.
8. `builds/`: builds, IP y recomendaciones.

Cada extracción debe mantener la API global que utilizan las pruebas actuales.
Después de cada paso hay que ejecutar `npm test` antes de continuar.

## Regla de migración

- Extraer una responsabilidad por vez.
- No cambiar fórmulas y estructura al mismo tiempo.
- Evitar duplicar estado entre `app.js` y el módulo nuevo.
- Mantener la app funcionando como script clásico hasta que todos los módulos
  estén listos para pasar a ES modules.
- No cargar archivos de esta carpeta desde producción hasta que tengan pruebas
  y estén conectados explícitamente desde `index.html`.
