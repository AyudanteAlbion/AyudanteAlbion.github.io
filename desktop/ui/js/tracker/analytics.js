/* Ayudante Albion — bus único de analítica del tracker.
 *
 * Todas las pestañas consumen la misma suscripción a AATracker. Así no hay
 * carreras entre detect() ni listeners que se registran tarde o duplican una
 * recolección/mazmorra. El backend sigue siendo la fuente de verdad y este
 * módulo solo reparte eventos ya filtrados por tracker/client.js.
 */
(function (root) {
  'use strict';

  var listeners = Object.create(null);
  var all = [];
  var detectPromise = null;

  function on(type, handler) {
    if (typeof handler !== 'function') return function () {};
    var list = listeners[type] || (listeners[type] = []);
    list.push(handler);
    return function () {
      var i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  function subscribe(handler) {
    if (typeof handler !== 'function') return function () {};
    all.push(handler);
    return function () {
      var i = all.indexOf(handler);
      if (i >= 0) all.splice(i, 1);
    };
  }

  function dispatch(type, payload) {
    var specific = (listeners[type] || []).slice();
    var every = all.slice();
    specific.concat(every).forEach(function (handler) {
      try { handler(payload, type); } catch (err) {
        if (root.console && console.error) console.error('tracker analytics listener', err);
      }
    });
  }

  function detect() {
    if (!root.AATracker) return Promise.resolve(null);
    if (!detectPromise) {
      detectPromise = root.AATracker.detect().catch(function (err) {
        detectPromise = null;
        throw err;
      });
    }
    return detectPromise;
  }

  if (root.AATracker) {
    root.AATracker.on(function (type, payload) { dispatch(type, payload); });
  }

  root.AATrackerAnalytics = Object.freeze({
    on: on,
    subscribe: subscribe,
    detect: detect,
    state: function () { return root.AATracker ? root.AATracker.state() : null; }
  });
}(window));
