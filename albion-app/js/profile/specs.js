/* Ayudante Albion — perfil del jugador (etapa 7 de la modularización).
 *
 * Dos responsabilidades, ambas puras:
 *   · las especializaciones del Destiny Board que alimentan el costo de Foco
 *     de las pestañas de crafteo;
 *   · las estadísticas derivadas del killboard (ratio K/D, ordenamiento del
 *     ranking del gremio y posiciones).
 *
 * Nada de DOM ni de `fetch`: el killboard se sigue consultando desde app.js
 * y acá solo se transforman los datos ya traídos. Los rangos se recortan
 * siempre, porque estos valores los tipea el usuario a mano y un 999 mal
 * puesto desfiguraba el costo de Foco en cuatro pestañas a la vez.
 */
(function (root) {
  'use strict';

  var BRANCHES = [
    { key: 'food', label: 'Cocina', specMax: 120 },
    { key: 'alch', label: 'Alquimia', specMax: 120 },
    { key: 'refine', label: 'Refinamiento', specMax: 120 },
    { key: 'gear', label: 'Crafteo de equipo', specMax: 120 },
  ];
  var MASTERY_MAX = 100;

  function clamp(n, min, max) {
    n = parseInt(n, 10);
    if (isNaN(n)) n = 0;
    return Math.max(min, Math.min(max, n));
  }

  function branch(key) {
    for (var i = 0; i < BRANCHES.length; i++) if (BRANCHES[i].key === key) return BRANCHES[i];
    return null;
  }

  /* Normaliza una rama: recorta al rango válido y garantiza los dos campos.
     Una rama desconocida devuelve null y el llamador la ignora. */
  function normalize(key, values) {
    var b = branch(key);
    if (!b) return null;
    values = values || {};
    return {
      spec: clamp(values.spec, 0, b.specMax),
      mastery: clamp(values.mastery, 0, MASTERY_MAX),
    };
  }

  /* Fama de crafteo efectiva (FCE) y el multiplicador que aplica al Foco.
     Misma fórmula que AACrafting.focusCost, expuesta acá para la tabla del
     Perfil, que muestra el porcentaje sin calcular ninguna receta. */
  function efficiency(values) {
    values = values || {};
    return (values.spec || 0) * 250 + (values.mastery || 0) * 30;
  }

  function focusMultiplier(values) {
    return Math.pow(0.5, efficiency(values) / 10000);
  }

  /* ---------------- estadísticas del killboard ---------------- */

  /* Ratio K/D por fama. Sin muertes no hay ratio: devolver Infinity o un
     número inventado haría que alguien sin muertes encabece el ranking por
     accidente, así que se distingue explícitamente. */
  function fameRatio(entry) {
    entry = entry || {};
    var deaths = entry.DeathFame || 0;
    if (deaths <= 0) return null;
    return (entry.KillFame || 0) / deaths;
  }

  /* Ordena miembros del gremio por la columna elegida.
     `sort`: 'name' | 'kf' | 'df' | 'ratio'; `dir`: 1 asc, -1 desc.
     Los que no tienen ratio van siempre al fondo (se ordenan como -1). */
  function sortMembers(members, sort, dir, filter) {
    var list = (members || []).filter(function (m) {
      if (!filter) return true;
      return String((m && m.Name) || '').toLowerCase().indexOf(String(filter).toLowerCase()) !== -1;
    });
    var rank = function (m) { var r = fameRatio(m); return r == null ? -1 : r; };
    return list.slice().sort(function (a, b) {
      var d = 0;
      if (sort === 'name') d = String(a.Name || '').localeCompare(String(b.Name || ''), 'es', { sensitivity: 'base' });
      else if (sort === 'df') d = (a.DeathFame || 0) - (b.DeathFame || 0);
      else if (sort === 'ratio') d = rank(a) - rank(b);
      else d = (a.KillFame || 0) - (b.KillFame || 0);
      return d * (dir || 1);
    });
  }

  /* Posición absoluta por fama de kills, independiente del filtro y del
     orden que esté mirando el usuario: el «#3 del gremio» no puede cambiar
     porque alguien escribió en el buscador. */
  function positions(members) {
    var pos = {};
    (members || []).slice()
      .sort(function (a, b) { return (b.KillFame || 0) - (a.KillFame || 0); })
      .forEach(function (m, i) { pos[m.Id] = i + 1; });
    return pos;
  }

  root.AAProfile = Object.freeze({
    BRANCHES: BRANCHES,
    MASTERY_MAX: MASTERY_MAX,
    branch: branch,
    normalize: normalize,
    efficiency: efficiency,
    focusMultiplier: focusMultiplier,
    fameRatio: fameRatio,
    sortMembers: sortMembers,
    positions: positions,
  });
}(window));
