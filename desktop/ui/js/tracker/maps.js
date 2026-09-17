/* Ayudante Albion — resolución de zonas a nombres legibles.
 *
 * Photon comunica zonas de dos formas:
 *  - Índice del mundo ("3003" = Caerleon) o id de cluster ("DNG-KPR-02-MAIN-010"):
 *    se resuelven con el índice generado del world.xml oficial.
 *  - Instancias ("@RANDOMDUNGEON@<guid>", "@MISTS@<guid>"): el primer tramo no
 *    vacío es el TOKEN de la instancia, no un mapa que exista en el índice.
 *    Todas las copias comparten el token, así que el nombre legible es el del
 *    tipo de contenido.
 *
 * El índice vive dentro de la app para que la pantalla de sesión no dependa de
 * una API ni exponga identificadores técnicos como si fueran ubicaciones.
 */
(function (root) {
  'use strict';

  var names = Object.create(null);
  var loaded = false;

  // Tokens de instancia del protocolo → nombre del tipo de contenido. Son los
  // mismos nombres que usa la pestaña Mazmorras (localización es-ES de la app
  // de referencia).
  var INSTANCE_NAMES = {
    RANDOMDUNGEON: 'Mazmorra aleatoria',
    MISTS: 'Nieblas',
    MISTSDUNGEON: 'Abadía de Knightfall',
    CORRUPTEDDUNGEON: 'Mazmorra corrupta',
    HELLDUNGEON: 'Abyssal Depths',
    HELLCLUSTER: 'Hellgate',
    HELLGATE: 'Hellgate',
    ABYSSAL: 'Abyssal Depths',
    EXPEDITION: 'Expedición',
    DRAGONAREA: 'Ancient Lands',
    ANCIENT: 'Ancient Lands',
    KNIGHTFALLABBEY: 'Abadía de Knightfall',
    ARENA: 'Arena',
    ISLAND: 'Isla',
    HIDEOUT: 'Escondite'
  };

  function clusterID(value) {
    // "@TOKEN@guid" (formato del protocolo) → TOKEN; "cluster@instancia"
    // (formato interno viejo) → primer tramo; "3003" → tal cual.
    var s = String(value == null ? '' : value).trim();
    if (s.charAt(0) === '@') s = s.slice(1);
    return s.split('@')[0].split('#')[0].trim();
  }

  function display(value) {
    var id = clusterID(value);
    if (!id) return 'Ubicación no detectada';
    var token = INSTANCE_NAMES[id.toUpperCase()];
    if (token) return token;
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
