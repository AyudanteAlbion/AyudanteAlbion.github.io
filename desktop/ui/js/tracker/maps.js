/* Ayudante Albion — resolución local de IDs de cluster a nombres de mapa.
 *
 * Photon comunica el ID interno del cluster (por ejemplo, "0006") en vez del
 * texto que aparece en el mapa. El índice se genera del world.xml oficial y
 * se mantiene dentro de la app para que la pantalla de sesión no dependa de
 * una API ni exponga el identificador técnico como si fuera una ubicación.
 */
(function (root) {
  'use strict';

  var names = Object.create(null);
  var loaded = false;

  function clusterID(value) {
    // Las instancias vienen como "cluster@tipo@extra". El primer tramo es el
    // cluster real; #n solo diferencia copias de una misma instancia.
    return String(value == null ? '' : value).trim().split('@')[0].split('#')[0].trim();
  }

  function display(value) {
    var id = clusterID(value);
    if (!id) return 'Ubicación no detectada';
    var name = names[id] || names[id.toUpperCase()] || names[id.toLowerCase()];
    if (name) return name;
    // No mostramos un ID numérico como si fuera el nombre de un mapa mientras
    // el pequeño índice local todavía está cargando.
    if (!loaded && /^[0-9]+$/.test(id)) return 'Resolviendo mapa…';
    return id;
  }

  var ready = fetch('data/tracker_map_names.json', { cache: 'force-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      var source = data && data.names;
      if (source && typeof source === 'object') {
        Object.keys(source).forEach(function (id) {
          if (typeof source[id] === 'string' && source[id].trim()) names[id] = source[id].trim();
        });
      }
      loaded = true;
      return names;
    })
    .catch(function () {
      // La ubicación sigue funcionando con clusters que ya son nombres (p. ej.
      // Martlock). No se bloquea la sesión si una instalación vieja no tiene el
      // índice todavía.
      loaded = true;
      return names;
    });

  root.AATrackerMaps = Object.freeze({
    clusterID: clusterID,
    display: display,
    ready: ready,
    loaded: function () { return loaded; }
  });
}(window));
