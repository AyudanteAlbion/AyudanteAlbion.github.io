/* Ayudante Albion — validación central de frescura de precios.
 *
 * Las alertas no deben dispararse con precios sin fecha o más viejos que el
 * límite elegido por el usuario. El resto de herramientas puede seguir
 * mostrando precios históricos como información de mercado.
 */
(function (root) {
  'use strict';

  var DEFAULT_MAX_AGE_MIN = 60;
  var FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

  function normalizeLimit(maxAgeMin) {
    if (maxAgeMin === 'none' || maxAgeMin === 'sin-limite' || maxAgeMin === Infinity) return 'none';
    var n = Number(maxAgeMin);
    if (!isFinite(n) || n <= 0) return DEFAULT_MAX_AGE_MIN;
    return Math.max(1, Math.min(24 * 60, Math.round(n)));
  }

  function maxAgeMs(maxAgeMin) {
    var n = normalizeLimit(maxAgeMin);
    return n === 'none' ? Infinity : n * 60 * 1000;
  }

  function parseTimestamp(value, now) {
    var ref = now == null ? Date.now() : Number(now);
    if (!isFinite(ref)) ref = Date.now();
    if (value == null) return null;

    if (typeof value === 'number') {
      var numeric = value < 1e12 ? value * 1000 : value;
      if (!isFinite(numeric) || numeric > ref + FUTURE_TOLERANCE_MS) return null;
      return numeric;
    }

    var text = String(value).trim();
    if (!text || text.indexOf('0001-') === 0) return null;

    var ms;
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      var n = Number(text);
      ms = n < 1e12 ? n * 1000 : n;
    } else {
      var normalized = text;
      /* Albion Data suele entregar timestamps UTC sin sufijo. Si no trae zona,
         se interpreta como UTC para evitar que la zona horaria local cambie la
         frescura de una misma cotización. */
      if (/^\d{4}-\d{2}-\d{2}T/.test(normalized) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
        normalized += 'Z';
      }
      ms = Date.parse(normalized);
    }
    if (!isFinite(ms) || ms > ref + FUTURE_TOLERANCE_MS) return null;
    return ms;
  }

  function validate(price, timestamp, maxAgeMin, now) {
    var p = Number(price);
    if (!isFinite(p) || p <= 0) {
      return { ok: false, reason: 'nonpositive', price: p || 0, ts: null, ageMs: null };
    }
    var ref = now == null ? Date.now() : Number(now);
    if (!isFinite(ref)) ref = Date.now();
    var ts = parseTimestamp(timestamp, ref);
    if (ts == null) {
      return { ok: false, reason: timestamp == null || String(timestamp).trim() === '' ? 'missing-timestamp' : 'invalid-timestamp', price: p, ts: null, ageMs: null };
    }
    var age = Math.max(0, ref - ts);
    var limit = maxAgeMs(maxAgeMin);
    if (age > limit) {
      return { ok: false, reason: 'stale', price: p, ts: ts, ageMs: age, maxAgeMs: limit };
    }
    return { ok: true, reason: 'ok', price: p, ts: ts, ageMs: age, maxAgeMs: limit };
  }

  function isWaitingReason(reason) {
    return reason === 'missing-timestamp' || reason === 'invalid-timestamp' || reason === 'stale';
  }

  function reasonText(reason) {
    return ({
      nonpositive: 'sin precio positivo',
      'missing-timestamp': 'sin fecha de cotización',
      'invalid-timestamp': 'fecha inválida',
      stale: 'cotización vieja',
      ok: 'cotización reciente'
    })[reason] || 'cotización no válida';
  }

  function shortLimitLabel(maxAgeMin) {
    var n = normalizeLimit(maxAgeMin);
    return n === 'none' ? 'sin límite de antigüedad' : 'máx. ' + n + ' min';
  }

  root.AAPriceFreshness = Object.freeze({
    DEFAULT_MAX_AGE_MIN: DEFAULT_MAX_AGE_MIN,
    normalizeLimit: normalizeLimit,
    maxAgeMs: maxAgeMs,
    parseTimestamp: parseTimestamp,
    validate: validate,
    isWaitingReason: isWaitingReason,
    reasonText: reasonText,
    shortLimitLabel: shortLimitLabel
  });
}(window));
