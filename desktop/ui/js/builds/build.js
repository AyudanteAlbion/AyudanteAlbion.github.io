/* Ayudante Albion — compositor de builds (etapa 8 de la modularización).
 *
 * Lógica pura del armado y costeo de una build: slots, creación, duplicado,
 * mejor precio por ítem y total. Sin DOM y sin `fetch`; los precios llegan
 * ya cargados desde app.js.
 *
 * Decisión heredada que conviene dejar escrita: el costo usa siempre el
 * precio de VENTA más barato entre las ciudades reales. El Black Market no
 * entra nunca como origen de compra — ahí solo se vende — y meterlo haría
 * que la build parezca más barata de lo que realmente sale equiparla.
 */
(function (root) {
  'use strict';

  var SLOTS = [
    { key: 'mainHand', label: 'Mano Principal', icon: 'i-sword' },
    { key: 'offHand', label: 'Mano Secundaria', icon: 'i-shield' },
    { key: 'head', label: 'Cabeza', icon: 'i-user' },
    { key: 'chest', label: 'Pecho', icon: 'i-shield' },
    { key: 'shoes', label: 'Pies', icon: 'i-user' },
    { key: 'cape', label: 'Capa', icon: 'i-shield' },
    { key: 'food', label: 'Comida', icon: 'i-pot' },
    { key: 'potion', label: 'Poción', icon: 'i-flask' },
  ];

  /* Umbral por defecto de la alerta: avisar cuando la build baja un 10%. */
  var ALERT_DROP = 0.9;

  function emptyItems() {
    var out = {};
    for (var i = 0; i < SLOTS.length; i++) out[SLOTS[i].key] = null;
    return out;
  }

  function create(name, now) {
    now = now || Date.now();
    return { id: now, name: name || 'Nueva Build', items: emptyItems(), createdAt: now };
  }

  /* Copia con identidad propia: sin clonar `items` la copia y el original
     compartían el mismo objeto y editar una pisaba la otra. */
  function duplicate(build, now) {
    now = now || Date.now();
    var items = {};
    for (var i = 0; i < SLOTS.length; i++) {
      var k = SLOTS[i].key;
      items[k] = (build.items || {})[k] || null;
    }
    return { id: now, name: (build.name || 'Build') + ' (copia)', items: items, createdAt: now };
  }

  /* Ids realmente equipados, en el orden de los slots. */
  function itemIds(build) {
    var ids = [];
    for (var i = 0; i < SLOTS.length; i++) {
      var id = ((build || {}).items || {})[SLOTS[i].key];
      if (id) ids.push(id);
    }
    return ids;
  }

  function isEmpty(build) {
    return itemIds(build).length === 0;
  }

  /* Ciudad real más barata para comprar un ítem. `cities` no debe incluir
     el Black Market (ver la nota de arriba). */
  function bestPrice(byCity, cities) {
    var best = { value: 0, city: '' };
    cities = cities || [];
    for (var i = 0; i < cities.length; i++) {
      var entry = (byCity || {})[cities[i]];
      var v = entry ? entry.sell || 0 : 0;
      if (v > 0 && (best.value === 0 || v < best.value)) best = { value: v, city: cities[i] };
    }
    return best;
  }

  /* Costo de la build: una fila por slot equipado más el total.
     `missing` marca los ítems sin precio en ninguna ciudad, para que la
     interfaz pueda avisar que el total está incompleto en vez de mostrar
     un número más bajo de lo real. */
  function cost(build, prices, cities) {
    var rows = [];
    var total = 0;
    var missing = 0;
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i];
      var id = ((build || {}).items || {})[slot.key];
      if (!id) continue;
      var price = bestPrice((prices || {})[id], cities);
      if (!price.value) missing++;
      total += price.value || 0;
      rows.push({ slot: slot, id: id, price: price });
    }
    return { rows: rows, total: total, missing: missing };
  }

  /* Umbral de la alerta de precio de una build. */
  function alertThreshold(currentCost) {
    return Math.round((currentCost || 0) * ALERT_DROP);
  }

  root.AABuilds = Object.freeze({
    SLOTS: SLOTS,
    ALERT_DROP: ALERT_DROP,
    emptyItems: emptyItems,
    create: create,
    duplicate: duplicate,
    itemIds: itemIds,
    isEmpty: isEmpty,
    bestPrice: bestPrice,
    cost: cost,
    alertThreshold: alertThreshold,
  });
}(window));
