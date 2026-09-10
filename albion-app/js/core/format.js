/* Ayudante Albion — formato compartido del frontend.
 * Se expone como API clásica durante la migración incremental de app.js.
 */
(function (root) {
  'use strict';

  function fmt(n) {
    return n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('es-AR');
  }

  function pct(n) {
    return n == null || isNaN(n) ? '—' : (n * 100).toFixed(1).replace('.', ',') + '%';
  }

  function ageBadge(dateStr) {
    if (!dateStr || dateStr.startsWith('0001')) return '';
    var h = (Date.now() - new Date(dateStr + 'Z').getTime()) / 3.6e6;
    if (h < 1) return '<span class="price-sub">hace ' + Math.max(1, Math.round(h * 60)) + ' min</span>';
    if (h < 48) return '<span class="price-sub">hace ' + Math.round(h) + ' h</span>';
    return '<span class="price-sub">hace ' + Math.round(h / 24) + ' días</span>';
  }

  root.AAFormat = Object.freeze({ fmt: fmt, pct: pct, ageBadge: ageBadge });
}(window));
