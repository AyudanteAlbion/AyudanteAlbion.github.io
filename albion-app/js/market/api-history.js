/* Ayudante Albion — historial publicado por Albion Online Data Project.
 * Independiente de los snapshots locales guardados por el buscador.
 */
(function (root) {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var RANGES = [7, 30, 90, 180, 365];

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatDateParam(date) {
    /* La documentación de Albion Data usa M-D-YYYY para date/end_date. */
    return (date.getUTCMonth() + 1) + '-' + date.getUTCDate() + '-' + date.getUTCFullYear();
  }

  function isoDay(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function pathItemId(id) {
    return encodeURIComponent(String(id || '')).replace(/%40/g, '@').replace(/%2C/g, ',');
  }

  function buildUrl(api, itemId, options) {
    options = options || {};
    var days = RANGES.includes(Number(options.days)) ? Number(options.days) : 30;
    var end = options.end ? new Date(options.end) : new Date();
    var start = new Date(end.getTime() - days * DAY);
    var params = new URLSearchParams();
    params.set('date', formatDateParam(start));
    params.set('end_date', formatDateParam(end));
    if (options.city) params.set('locations', options.city);
    if (options.quality) params.set('qualities', String(options.quality));
    params.set('time-scale', String(options.timeScale || 24));
    return String(api).replace(/\/$/, '') + '/history/' + pathItemId(itemId) + '.json?' + params.toString();
  }

  function parseTs(value) {
    if (value == null) return null;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    var text = String(value).trim();
    if (!text || text.indexOf('0001-') === 0) return null;
    if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z';
    var ms = Date.parse(text);
    return isFinite(ms) ? ms : null;
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function normalize(raw, options) {
    options = options || {};
    var selectedCity = options.city || '';
    var selectedQuality = options.quality == null ? null : Number(options.quality);
    var wrappers = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
    var byTs = new Map();

    wrappers.forEach(function (wrapper) {
      var city = wrapper.city || wrapper.location || wrapper.City || wrapper.Location || selectedCity;
      var quality = num(wrapper.quality != null ? wrapper.quality : (wrapper.Quality != null ? wrapper.Quality : selectedQuality));
      if (selectedCity && city && city !== selectedCity) return;
      if (selectedQuality != null && quality != null && Number(quality) !== selectedQuality) return;
      var points = Array.isArray(wrapper.data) ? wrapper.data : (Array.isArray(wrapper.Data) ? wrapper.Data : null);
      if (!points && (wrapper.timestamp || wrapper.Timestamp || wrapper.date || wrapper.Date)) points = [wrapper];
      (points || []).forEach(function (point) {
        var ts = parseTs(point.timestamp || point.Timestamp || point.date || point.Date);
        var price = num(point.avg_price != null ? point.avg_price
          : point.avgPrice != null ? point.avgPrice
          : point.price_avg != null ? point.price_avg
          : point.AvgPrice != null ? point.AvgPrice
          : point.average_price != null ? point.average_price
          : point.price);
        if (!(price > 0) || ts == null) return;
        var count = num(point.item_count != null ? point.item_count
          : point.itemCount != null ? point.itemCount
          : point.count != null ? point.count
          : point.Amount != null ? point.Amount
          : point.quantity);
        var key = String(ts);
        var prev = byTs.get(key);
        if (!prev) {
          byTs.set(key, { ts: ts, avgPrice: price, itemCount: count, city: city || selectedCity, quality: quality || selectedQuality || 1 });
        } else {
          var prevCount = prev.itemCount || 0;
          var nextCount = count || 0;
          if (prevCount + nextCount > 0) prev.avgPrice = (prev.avgPrice * prevCount + price * nextCount) / (prevCount + nextCount);
          else prev.avgPrice = (prev.avgPrice + price) / 2;
          prev.itemCount = prev.itemCount == null && count == null ? null : prevCount + nextCount;
        }
      });
    });
    return Array.from(byTs.values()).sort(function (a, b) { return a.ts - b.ts; });
  }

  function coverage(points, days) {
    var daySet = new Set();
    var totalCount = 0;
    var hasCount = false;
    (points || []).forEach(function (p) {
      daySet.add(isoDay(p.ts));
      if (p.itemCount != null && isFinite(p.itemCount)) {
        totalCount += p.itemCount;
        hasCount = true;
      }
    });
    return {
      points: (points || []).length,
      daysWithData: daySet.size,
      daysRequested: Number(days) || null,
      coverageRatio: days ? daySet.size / Number(days) : null,
      totalItemCount: hasCount ? totalCount : null,
      firstTs: points && points.length ? points[0].ts : null,
      lastTs: points && points.length ? points[points.length - 1].ts : null,
      enough: !!(points && points.length >= 2)
    };
  }

  function cacheKey(itemId, options) {
    options = options || {};
    return [itemId, options.city || '', options.quality || 1, options.days || 30, options.timeScale || 24].join('|');
  }

  root.AAApiHistory = Object.freeze({
    RANGES: RANGES.slice(),
    DAY: DAY,
    buildUrl: buildUrl,
    normalize: normalize,
    coverage: coverage,
    cacheKey: cacheKey,
    isoDay: isoDay,
    formatDateParam: formatDateParam
  });
}(window));
