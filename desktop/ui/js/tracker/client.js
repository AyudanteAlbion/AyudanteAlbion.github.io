/* Ayudante Albion — cliente del tracker (solo edición de escritorio).
 *
 * Detecta en qué edición corre la app y, si hay motor de tracking, se conecta
 * al flujo de eventos del ejecutable. En la web pública `/api/tracker/status`
 * no existe: el detect falla, el módulo queda inactivo y la interfaz nunca
 * muestra las pestañas de escritorio.
 */
(function (root) {
  'use strict';

  var STATUS_URL = '/api/tracker/status';
  var STREAM_URL = '/api/tracker/stream';
  var SESSION_URL = '/api/tracker/session';

  var state = {
    edition: 'web',      // 'web' | 'standard' | 'tracker'
    available: false,    // el motor puede capturar en esta PC
    reason: '',
    capturing: false,
    source: '',
    runError: '',
    trackingCharacter: '',
    capture: { phase: 'off' },
    identityValid: false,
    filterMatched: true,
    codes: null,          // versión y conteo de la tabla de códigos Photon
    codesWarning: ''
  };

  var listeners = [];
  var stream = null;
  var retryDelay = 1000;

  var METRIC_EVENTS = { fame:1, silver:1, respec:1, faction:1, factionStanding:1, might:1, favor:1, damage:1, heal:1, loot:1, gathering:1, dungeon:1, dungeonRun:1, trade:1, vault:1 };
  function metricsAccepted() {
    return state.capture && state.capture.phase === 'demo' || (state.identityValid && state.filterMatched);
  }
  function emit(type, payload) {
    // Defense in depth for every browser-side statistics/persistence consumer.
    // The backend already applies the same gate before publishing real metrics.
    if (METRIC_EVENTS[type] && !metricsAccepted()) return;
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](type, payload);
      } catch (e) {
        // Un handler roto no puede cortar la entrega al resto.
        if (root.console && console.error) console.error('tracker listener', e);
      }
    }
  }

  /* Suscribe un handler (tipo, payload) y devuelve la baja. */
  function on(handler) {
    if (typeof handler !== 'function') return function () {};
    listeners.push(handler);
    return function () {
      var i = listeners.indexOf(handler);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /* Pregunta la edición. Sin respuesta válida asumimos web pública. */
  async function detect() {
    try {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 2500);
      var res = await fetch(STATUS_URL, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      state.edition = data.edition || 'standard';
      state.available = !!data.available;
      state.reason = data.reason || '';
      state.capturing = !!data.capturing;
      state.source = data.source || '';
      state.runError = data.runError || '';
      state.trackingCharacter = data.trackingCharacter || '';
      state.capture = data.capture || { phase: state.capturing ? 'preparing' : 'off' };
      state.identityValid = !!data.identityValid;
      state.filterMatched = data.filterMatched !== false;
      state.codes = data.codes || null;
      state.codesWarning = data.codesWarning || '';
    } catch (e) {
      state.edition = 'web';
      state.available = false;
      state.reason = 'La versión web no incluye tracking en vivo.';
      state.capturing = false;
      state.source = '';
      state.runError = '';
      state.trackingCharacter = '';
      state.capture = { phase: 'off' };
      state.identityValid = false;
      state.filterMatched = true;
      state.codes = null;
      state.codesWarning = '';
    }
    emit('edition', snapshotState());
    return snapshotState();
  }

  function snapshotState() {
    return {
      edition: state.edition,
      available: state.available,
      reason: state.reason,
      capturing: state.capturing,
      source: state.source,
      runError: state.runError,
      trackingCharacter: state.trackingCharacter,
      capture: state.capture,
      identityValid: state.identityValid,
      filterMatched: state.filterMatched,
      codes: state.codes,
      codesWarning: state.codesWarning,
      // AAEnvironment es la única fuente para saber si existe una ventana
      // Wails. La edición del tracker describe al backend, no al contenedor.
      isDesktop: !!(root.AAEnvironment && root.AAEnvironment.isDesktop),
      hasTracking: state.edition === 'tracker'
    };
  }

  /* Abre el flujo de eventos. Reintenta con espera creciente si se corta. */
  function connect() {
    if (!state.available || stream) return;
    try {
      stream = new EventSource(STREAM_URL);
    } catch (e) {
      stream = null;
      return;
    }
    stream.onopen = function () { retryDelay = 1000; };
    stream.onmessage = function (msg) {
      var ev;
      try {
        ev = JSON.parse(msg.data);
      } catch (e) {
        return;
      }
      if (!ev || !ev.type) return;
      if (ev.type === 'snapshot' || ev.type === 'status') {
        state.capturing = !!(ev.payload && ev.payload.capturing);
        state.capture = (ev.payload && ev.payload.capture) || state.capture;
        state.identityValid = !!(ev.payload && ev.payload.identity && ev.payload.identity.valid);
        state.filterMatched = !(ev.payload && ev.payload.identity && ev.payload.identity.filterMatched === false);
      } else if (ev.type === 'warning' && ev.payload && typeof ev.payload.message === 'string' && ev.payload.message.indexOf('La captura se detuvo: ') === 0) {
        state.runError = ev.payload.message.slice('La captura se detuvo: '.length);
      }
      emit(ev.type, ev.payload);
    };
    stream.onerror = function () {
      disconnect();
      var delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, 15000);
      setTimeout(connect, delay);
    };
  }

  function disconnect() {
    if (stream) {
      try { stream.close(); } catch (e) { /* ya cerrado */ }
      stream = null;
    }
  }

  async function post(path) {
    var res = await fetch(path, { method: 'POST', cache: 'no-store' });
    if (!res.ok && res.status !== 409) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function start() {
    var data = await post('/api/tracker/start');
    if (data && data.ok) {
      state.capturing = true;
      state.runError = '';
      connect();
    }
    return data;
  }

  async function stop() {
    var data = await post('/api/tracker/stop');
    state.capturing = false;
    state.runError = '';
    return data;
  }

  async function reset() {
    return post('/api/tracker/reset');
  }

  /* Vuelve a pedir la identidad del personaje sin cortar la captura de red.
     Si ya hay un personaje detectado, el backend solo reemite el snapshot. Si
     no lo hay, queda esperando el próximo JoinResponse: cambiar de zona solo
     entrega ChangeCluster, así que hay que volver al selector de personaje y
     entrar de nuevo. */
  async function refreshCharacter() {
    var data = await post('/api/tracker/character/refresh');
    if (data && data.ok) {
      state.capturing = true;
      state.runError = '';
      connect();
    }
    return data;
  }

  /* Recarga photon_codes.json desde disco, sin reiniciar la aplicación. */
  async function reloadCodes() {
    var data = await post('/api/tracker/codes/reload');
    if (data && data.codes) {
      state.codes = data.codes;
      state.codesWarning = data.warning || '';
    }
    return data;
  }

  /* Consulta (y opcionalmente activa) el modo diagnóstico de códigos. */
  async function diagnostic(enable) {
    var url = '/api/tracker/diagnostic';
    var opts = { cache: 'no-store' };
    if (enable !== undefined) {
      url += '?on=' + (enable ? '1' : '0');
      opts.method = 'POST';
    }
    var res = await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function session() {
    var res = await fetch(SESSION_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function devices() {
    var res = await fetch('/api/tracker/devices', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function restart(provider, adapter, character) {
    var url = '/api/tracker/restart?provider=' + encodeURIComponent(provider || 'npcap') +
      '&adapter=' + encodeURIComponent(adapter || '') +
      '&character=' + encodeURIComponent(character || '');
    var data = await post(url);
    if (!data || !data.ok) throw new Error((data && data.reason) || 'no se pudo reiniciar');
    state.capturing = true;
    state.runError = '';
    if (data.source) state.source = data.source;
    connect();
    return data;
  }

  root.AATracker = Object.freeze({
    detect: detect,
    state: snapshotState,
    on: on,
    connect: connect,
    disconnect: disconnect,
    start: start,
    stop: stop,
    reset: reset,
    refreshCharacter: refreshCharacter,
    session: session,
    reloadCodes: reloadCodes,
    diagnostic: diagnostic,
    devices: devices,
    restart: restart
  });
}(window));
