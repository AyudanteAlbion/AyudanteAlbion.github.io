/* Ayudante Albion — utilidades de red compartidas.
 * Las rutas y fórmulas permanecen en app.js; este módulo solo centraliza
 * fetch con timeout y validación de respuestas.
 */
(function (root) {
  'use strict';

  async function fetchJSON(url, timeoutMs) {
    var ms = timeoutMs == null ? 25000 : timeoutMs;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    try {
      var response = await fetch(url, { signal: ctrl.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('tiempo de espera agotado');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchPrices(itemIds, locations, options) {
    options = options || {};
    var api = options.api;
    if (!api) throw new Error('falta configurar la API de precios');
    var blackMarket = options.blackMarket || 'Black Market';
    var out = {};
    var chunks = [];
    var current = [];
    (itemIds || []).forEach(function (id) {
      current.push(id);
      if (current.join(',').length > 3500) {
        chunks.push(current);
        current = [];
      }
    });
    if (current.length) chunks.push(current);
    for (var i = 0; i < chunks.length; i++) {
      var url = api + '/prices/' + chunks[i].join(',') + '.json?locations=' + locations.join(',') + '&qualities=1';
      var data = await fetchJSON(url);
      (data || []).forEach(function (row) {
        var id = row.item_id;
        (out[id] = out[id] || {})[row.city] = {
          sell: row.city === blackMarket ? 0 : row.sell_price_min || 0,
          sellDate: row.sell_price_min_date,
          buy: row.buy_price_max || 0,
          buyDate: row.buy_price_max_date
        };
      });
    }
    return out;
  }

  root.AAApi = Object.freeze({ fetchJSON: fetchJSON, fetchPrices: fetchPrices });
}(window));
