/* Ayudante Albion — interfaz de la pestaña Sesión (edición de escritorio).
 *
 * Dibuja el estado de la sesión y el medidor de daño con los datos que llegan
 * del ejecutable. Si la app corre en la web, el módulo pinta el aviso de
 * «solo escritorio» y no hace nada más.
 */
(function (root) {
  'use strict';

  var EXE_URL = 'https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/latest';
  var mounted = false;
  var latest = null;
  var dirty = false;

  function el(id) { return document.getElementById(id); }

  function num(value) {
    if (root.AAFormat && typeof AAFormat.silver === 'function') return AAFormat.silver(value);
    return new Intl.NumberFormat('es-AR').format(Math.round(value || 0));
  }

  function clock(seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(r);
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Aviso para la web pública: explica la diferencia entre ediciones. */
  function renderWebNotice(panel, info) {
    panel.innerHTML = '' +
      '<div class="card trk-card">' +
      '  <h2>Sesión en vivo</h2>' +
      '  <p class="muted">' + esc(info.reason || 'Disponible solo en la aplicación de escritorio.') + '</p>' +
      '  <p>El <strong>medidor de daño</strong>, el historial de mapas, la fama y la plata por hora ' +
      '  y el registro de botín necesitan leer el tráfico del juego en tu PC. ' +
      '  El navegador no puede hacerlo, así que viven en la edición <strong>Tracker</strong> del ejecutable.</p>' +
      '  <p><a class="btn" href="' + EXE_URL + '" target="_blank" rel="noopener">Descargar la edición Tracker</a></p>' +
      '  <p class="muted small">Solo monitorea el tráfico de red: no modifica el cliente del juego, ' +
      '  no dibuja nada encima y no ve jugadores fuera de tu campo de visión.</p>' +
      '</div>';
  }

  /* Interfaz completa de la edición Tracker. */
  function renderShell(panel) {
    panel.innerHTML = '' +
      '<div class="card trk-card">' +
      '  <div class="trk-head">' +
      '    <h2>Sesión en vivo</h2>' +
      '    <div class="trk-actions">' +
      '      <button class="btn" id="trkToggle" type="button">Activar tracking</button>' +
      '      <button class="btn ghost" id="trkReset" type="button">Reiniciar sesión</button>' +
      '      <button class="btn ghost" id="trkCopy" type="button">Copiar ranking</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="trk-status" id="trkStatus">Tracking detenido.</div>' +
      '  <div class="trk-kpis" id="trkKpis"></div>' +
      '</div>' +
      '<div class="card trk-card">' +
      '  <h3>Medidor de daño</h3>' +
      '  <div id="trkMeter" class="trk-meter"><p class="muted">Sin datos de combate todavía.</p></div>' +
      '</div>' +
      '<div class="trk-split">' +
      '  <div class="card trk-card"><h3>Historial de mapas</h3><div id="trkMaps"><p class="muted">Sin mapas registrados.</p></div></div>' +
      '  <div class="card trk-card"><h3>Botín reciente</h3><div id="trkLoot"><p class="muted">Sin botín registrado.</p></div></div>' +
      '</div>';

    el('trkToggle').addEventListener('click', onToggle);
    el('trkReset').addEventListener('click', onReset);
    el('trkCopy').addEventListener('click', onCopy);
  }

  async function onToggle() {
    var btn = el('trkToggle');
    if (!btn) return;
    btn.disabled = true;
    try {
      var info = AATracker.state();
      if (info.capturing) {
        await AATracker.stop();
      } else {
        await AATracker.start();
      }
    } catch (e) {
      setStatus('No se pudo cambiar el estado del tracking: ' + e.message);
    } finally {
      btn.disabled = false;
      paintControls();
    }
  }

  async function onReset() {
    try {
      var snap = await AATracker.reset();
      latest = snap;
      dirty = true;
    } catch (e) {
      setStatus('No se pudo reiniciar: ' + e.message);
    }
  }

  function onCopy() {
    if (!latest || !latest.combatants || !latest.combatants.length) return;
    var lines = latest.combatants.slice(0, 10).map(function (c, i) {
      return (i + 1) + '. ' + c.name + ' — ' + num(c.damage) + ' daño (' +
        (c.shareDamage || 0).toFixed(1) + '%)';
    });
    var text = 'Ayudante Albion — ' + clock(latest.seconds) + '\n' + lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus('Ranking copiado al portapapeles.');
      });
    }
  }

  function setStatus(text) {
    var node = el('trkStatus');
    if (node) node.textContent = text;
  }

  function paintControls() {
    var info = AATracker.state();
    var btn = el('trkToggle');
    if (btn) btn.textContent = info.capturing ? 'Detener tracking' : 'Activar tracking';
    if (!info.available) {
      setStatus(info.reason || 'Motor de captura no disponible.');
    } else if (info.capturing) {
      setStatus('Tracking activo · fuente: ' + (info.source || 'desconocida'));
    } else {
      setStatus('Tracking detenido. Activalo para empezar a medir.');
    }
  }

  function paintKpis(snap) {
    var node = el('trkKpis');
    if (!node) return;
    var cards = [
      ['Personaje', esc(snap.character || '—')],
      ['Zona', esc(snap.zone || '—')],
      ['Tiempo', clock(snap.seconds)],
      ['Fama', num(snap.fame)],
      ['Fama / h', num(snap.famePerHour)],
      ['Plata', num(snap.silver)],
      ['Plata / h', num(snap.silverPerHour)],
      ['Party', String((snap.party || []).length)]
    ];
    node.innerHTML = cards.map(function (c) {
      return '<div class="trk-kpi"><span class="trk-kpi-label">' + c[0] +
        '</span><span class="trk-kpi-value">' + c[1] + '</span></div>';
    }).join('');
  }

  function paintMeter(snap) {
    var node = el('trkMeter');
    if (!node) return;
    var rows = (snap.combatants || []).filter(function (c) {
      return c.damage > 0 || c.healing > 0;
    });
    if (!rows.length) {
      node.innerHTML = '<p class="muted">Sin datos de combate todavía.</p>';
      return;
    }
    node.innerHTML = '<table class="trk-table"><thead><tr>' +
      '<th>#</th><th>Jugador</th><th>Daño</th><th>DPS</th><th>%</th>' +
      '<th>Curación</th><th>HPS</th><th>Recibido</th><th>Máx.</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (c, i) {
        return '<tr class="' + (c.self ? 'trk-self' : '') + '">' +
          '<td>' + (i + 1) + '</td>' +
          '<td><span class="trk-bar" style="width:' + Math.max(2, c.shareDamage || 0) + '%"></span>' +
          esc(c.name) + '</td>' +
          '<td>' + num(c.damage) + '</td>' +
          '<td>' + num(c.dps) + '</td>' +
          '<td>' + (c.shareDamage || 0).toFixed(1) + '%</td>' +
          '<td>' + num(c.healing) + '</td>' +
          '<td>' + num(c.hps) + '</td>' +
          '<td>' + num(c.taken) + '</td>' +
          '<td>' + num(c.biggestHit) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function paintMaps(snap) {
    var node = el('trkMaps');
    if (!node) return;
    var maps = snap.maps || [];
    if (!maps.length) {
      node.innerHTML = '<p class="muted">Sin mapas registrados.</p>';
      return;
    }
    node.innerHTML = '<ul class="trk-list">' + maps.slice(0, 20).map(function (m) {
      return '<li><strong>' + esc(m.name) + '</strong><span class="muted"> · ' +
        clock(m.seconds) + '</span></li>';
    }).join('') + '</ul>';
  }

  function paintLoot(snap) {
    var node = el('trkLoot');
    if (!node) return;
    var loot = snap.loot || [];
    if (!loot.length) {
      node.innerHTML = '<p class="muted">Sin botín registrado.</p>';
      return;
    }
    node.innerHTML = '<ul class="trk-list">' + loot.slice(0, 20).map(function (l) {
      return '<li><strong>' + esc(l.itemId) + '</strong> ×' + (l.quantity || 1) +
        '<span class="muted"> · ' + esc(l.player) + '</span></li>';
    }).join('') + '</ul>';
  }

  function paint() {
    if (!dirty || !latest) return;
    dirty = false;
    paintKpis(latest);
    paintMeter(latest);
    paintMaps(latest);
    paintLoot(latest);
  }

  /* Monta la pestaña. Se llama una sola vez, desde init(). */
  function mount(info) {
    var panel = el('tab-tracker');
    if (!panel || mounted) return;
    mounted = true;
    if (!info.hasTracking) {
      renderWebNotice(panel, info);
      return;
    }
    renderShell(panel);
    paintControls();

    AATracker.on(function (type, payload) {
      if (type === 'snapshot' || type === 'status') {
        latest = payload;
        dirty = true;
        paintControls();
      }
    });

    // Un solo repintado por frame: los eventos de daño llegan muy seguidos y
    // redibujar por cada uno trabaría la pestaña.
    setInterval(paint, 500);

    AATracker.connect();
    AATracker.session().then(function (snap) {
      latest = snap;
      dirty = true;
    }).catch(function () { /* el stream va a traerlo igual */ });
  }

  /* Muestra u oculta el botón de la pestaña según la edición. */
  function applyVisibility(info) {
    var tab = document.querySelector('.tab[data-tab="tracker"]');
    if (tab) tab.hidden = !info.isDesktop;
  }

  async function init() {
    if (!root.AATracker) return;
    var info = await AATracker.detect();
    applyVisibility(info);
    mount(info);
  }

  root.AATrackerUI = Object.freeze({ init: init });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
