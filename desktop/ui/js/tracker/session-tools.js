/* Ayudante Albion — herramientas internas de Sesión inspiradas en Albion Analytics/SAT. */
(function (root) {
  'use strict';

  var TRADE_KEY = 'aaSessionPlayerTradesV1';
  var TRADE_PREF_KEY = 'aaSessionTradePrefsV1';
  var WORKER_URL = 'https://ayudantealbion.josemesina21.workers.dev';
  var latest = null;
  var tradeRows = readJSON(TRADE_KEY, []);
  var tradePrefs = Object.assign({ enabled: true, direction: 'all', query: '' }, readJSON(TRADE_PREF_KEY, {}));
  var playerState = { query: '', loading: false, error: '', profile: null, kills: null, deaths: null, selectedId: '', selectedName: '' };
  var tradeQueryTimer = null;
  var combatLive = Object.create(null);
  var itemIndex = { byUnique: Object.create(null), byGatheringIndex: Object.create(null), ready: false };
  var itemIndexPromise = null;
  var initialized = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(value, digits) {
    if (value == null || isNaN(value)) return '—';
    return new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits || 0, minimumFractionDigits: digits || 0 }).format(Number(value) || 0);
  }
  function money(value) { return fmt(value) + ' plata'; }
  function shortDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function duration(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }
  function readJSON(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* localStorage puede estar lleno o bloqueado */ }
  }
  function saveTradePrefs() { writeJSON(TRADE_PREF_KEY, tradePrefs); }
  function saveTrades() { writeJSON(TRADE_KEY, tradeRows.slice(-5000)); }
  function state() { return root.AATrackerAnalytics ? root.AATrackerAnalytics.state() : (root.AATracker ? root.AATracker.state() : null); }
  function metrics() { return (latest && latest.metrics) || latest || {}; }
  function identity() { return (latest && latest.identity) || {}; }
  function maps() {
    if (latest && latest.world && Array.isArray(latest.world.history)) return latest.world.history;
    if (latest && Array.isArray(latest.maps)) return latest.maps;
    return [];
  }
  function combatants() {
    var m = metrics();
    var rows = Array.isArray(m.combatants) ? m.combatants.slice() : [];
    if (!Object.keys(combatLive).length && rows.length) mergeCombatSnapshot(rows);
    return Object.keys(combatLive).map(function (key) { return Object.assign({}, combatLive[key]); });
  }
  function combatKey(name) { return String(name || 'Desconocido').trim().toLowerCase() || 'desconocido'; }
  function ensureCombatant(name) {
    var key = combatKey(name);
    if (!combatLive[key]) combatLive[key] = { name: name || 'Desconocido', damage: 0, healing: 0, overheal: 0, taken: 0, biggestHit: 0, deaths: 0, kills: 0, dps: 0, hps: 0, shareDamage: 0, shareHealing: 0, self: false };
    return combatLive[key];
  }
  function mergeCombatSnapshot(rows) {
    rows.forEach(function (row) {
      var c = ensureCombatant(row.name);
      Object.assign(c, row);
    });
  }
  function replaceCombatSnapshot(rows) {
    combatLive = Object.create(null);
    mergeCombatSnapshot(rows || []);
  }
  function recordCombatEvent(payload, type) {
    if (!payload || !payload.source) return;
    var c = ensureCombatant(payload.source);
    var amount = Math.max(0, Number(payload.amount || 0));
    if (type === 'heal') c.healing = (Number(c.healing) || 0) + amount;
    else {
      c.damage = (Number(c.damage) || 0) + amount;
      c.biggestHit = Math.max(Number(c.biggestHit) || 0, amount);
    }
    var seconds = Math.max(1, Number((latest && (latest.seconds || (latest.metrics && latest.metrics.seconds))) || 1));
    c.dps = (Number(c.damage) || 0) / seconds;
    c.hps = (Number(c.healing) || 0) / seconds;
  }
  function displayMap(value) {
    if (root.AATrackerMaps && root.AATrackerMaps.display) return root.AATrackerMaps.display(value);
    return value || 'Ubicación no detectada';
  }
  function activeSessionKey() {
    var active = document.querySelector('[data-session-view].active');
    return active ? active.dataset.sessionView : 'tracker';
  }
  function setHTML(id, html) {
    var node = document.getElementById(id);
    if (node) node.innerHTML = html;
    return node;
  }
  function kpi(label, value, sub) {
    return '<div class="sat-mini-card"><span>' + esc(label) + '</span><b>' + esc(value) + '</b><small class="muted">' + esc(sub || '') + '</small></div>';
  }
  function statusPills() {
    var st = state() || {};
    var id = identity();
    var cap = st.capture || (latest && latest.capture) || {};
    var captureText = st.capturing ? 'Captura activa' : 'Captura detenida';
    var player = id.name || (latest && latest.character) || 'Personaje no detectado';
    var accepted = (cap.phase === 'demo') || (id.valid && id.filterMatched !== false);
    return '<div class="sat-status-line">' +
      '<span class="sat-pill ' + (st.capturing ? 'pos' : '') + '">' + esc(captureText) + '</span>' +
      '<span class="sat-pill ' + (accepted ? 'pos' : 'neg') + '">' + esc(accepted ? 'Métricas aceptadas' : 'Esperando JoinResponse') + '</span>' +
      '<span class="sat-pill">' + esc(player) + '</span>' +
      '<span class="sat-pill">' + esc(displayMap((latest && latest.zone) || (latest && latest.world && latest.world.map) || '')) + '</span>' +
      '</div>';
  }
  function toolCard(key, title, text) {
    return '<button class="sat-tool-card" type="button" data-session-go="' + esc(key) + '"><strong>' + esc(title) + '</strong><small>' + esc(text) + '</small></button>';
  }

  function loadItemIndex() {
    if (itemIndexPromise) return itemIndexPromise;
    itemIndexPromise = Promise.all([
      fetch('data/catalog.json', { cache: 'force-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      fetch('data/tracker_gathering_items.json', { cache: 'force-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    ]).then(function (parts) {
      var catalog = Array.isArray(parts[0]) ? parts[0] : [];
      catalog.forEach(function (row) {
        if (!Array.isArray(row) || !row[0]) return;
        itemIndex.byUnique[String(row[0])] = { unique: String(row[0]), name: row[1] || row[2] || row[0], tier: row[3] || 0, enchant: row[4] || 0, category: row[5] || '' };
      });
      var gathering = parts[1] && parts[1].items ? parts[1].items : {};
      Object.keys(gathering).forEach(function (idx) {
        var it = gathering[idx];
        if (it && it.n) itemIndex.byGatheringIndex[String(idx)] = { unique: it.u || '', name: it.n, tier: it.r || 0, enchant: it.e || 0, category: it.t || 'resource' };
      });
      itemIndex.ready = true;
      render('trade');
      return itemIndex;
    });
    return itemIndexPromise;
  }
  function itemInfo(row) {
    if (row.isSilver) return { unique: '', name: 'Plata', tier: 0, enchant: 0, category: 'silver' };
    var unique = row.itemId && !/^\d+$/.test(String(row.itemId)) ? String(row.itemId) : '';
    if (unique && itemIndex.byUnique[unique]) return itemIndex.byUnique[unique];
    var byGathering = itemIndex.byGatheringIndex[String(row.itemIndex || row.itemId || '')];
    if (byGathering) return byGathering;
    return { unique: unique, name: unique || ('Ítem #' + (row.itemIndex || row.itemId || '—')), tier: 0, enchant: 0, category: '' };
  }
  function icon(info) {
    if (!info || !info.unique) return '<span class="chip-ico" style="width:34px;height:34px"><svg><use href="#i-flip"/></svg></span>';
    return '<img class="sat-item-icon" loading="lazy" src="https://render.albiononline.com/v1/item/' + encodeURIComponent(info.unique) + '.png?size=64" alt="">';
  }

  function addTradePayload(payload) {
    if (!tradePrefs.enabled || !payload) return;
    var entries = Array.isArray(payload.entries) ? payload.entries : [payload];
    var changed = false;
    entries.map(normalizeTrade).filter(Boolean).forEach(function (row) {
      if (tradeRows.some(function (r) { return r.uid === row.uid; })) return;
      tradeRows.push(row);
      changed = true;
    });
    if (changed) {
      tradeRows = tradeRows.slice(-5000);
      saveTrades();
      renderDashboard();
      render('trade');
    }
  }
  function normalizeTrade(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var ts = Number(raw.ts || Date.now());
    var direction = String(raw.direction || raw.type || '').toLowerCase();
    if (direction.indexOf('incoming') >= 0 || direction.indexOf('recib') >= 0) direction = 'incoming';
    else if (direction.indexOf('outgoing') >= 0 || direction.indexOf('entreg') >= 0) direction = 'outgoing';
    else direction = 'incoming';
    var uid = String(raw.uid || ('pt:' + (raw.tradeId || ts) + ':' + direction + ':' + (raw.itemIndex || raw.itemId || raw.silver || 'silver') + ':' + ts));
    var internal = Number(raw.internalSilver || 0);
    var silver = Number(raw.silver || (internal ? Math.floor(internal / 10000) : 0));
    return {
      uid: uid,
      ts: ts,
      tradeId: Number(raw.tradeId || 0),
      revision: Number(raw.revision || 0),
      partnerName: String(raw.partnerName || '').trim(),
      direction: direction,
      isSilver: !!raw.isSilver,
      itemIndex: Number(raw.itemIndex || 0),
      itemId: raw.itemId ? String(raw.itemId) : '',
      quantity: Math.max(1, Number(raw.quantity || 1)),
      silver: Math.max(0, silver),
      internalSilver: Math.max(0, internal),
      map: raw.map || raw.zone || ''
    };
  }
  function filteredTrades() {
    var q = String(tradePrefs.query || '').trim().toLowerCase();
    return tradeRows.filter(function (row) {
      if (tradePrefs.direction !== 'all' && row.direction !== tradePrefs.direction) return false;
      if (!q) return true;
      var info = itemInfo(row);
      return [row.partnerName, info.name, row.map, row.tradeId].some(function (value) {
        return String(value || '').toLowerCase().indexOf(q) >= 0;
      });
    });
  }
  function tradeSums(rows) {
    return rows.reduce(function (acc, row) {
      if (row.direction === 'incoming') {
        acc.incoming++;
        if (row.isSilver) acc.silverIn += row.silver;
      } else {
        acc.outgoing++;
        if (row.isSilver) acc.silverOut += row.silver;
      }
      if (row.partnerName) acc.partners[row.partnerName.toLowerCase()] = row.partnerName;
      return acc;
    }, { incoming: 0, outgoing: 0, silverIn: 0, silverOut: 0, partners: Object.create(null) });
  }

  function renderDashboard() {
    var target = document.getElementById('satGeneralAnalytics');
    if (!target) return;
    var m = metrics();
    var mapRows = maps();
    var gatheringRows = root.AAGathering && root.AAGathering.rows ? root.AAGathering.rows() : [];
    var dungeonRows = root.AADungeons && root.AADungeons.rows ? root.AADungeons.rows() : [];
    var damage = combatants().reduce(function (sum, row) { return sum + (Number(row.damage) || 0); }, 0);
    var healing = combatants().reduce(function (sum, row) { return sum + (Number(row.healing) || 0); }, 0);
    var netTrade = tradeSums(tradeRows).silverIn - tradeSums(tradeRows).silverOut;
    target.innerHTML = '<div class="sat-hero">' +
      '<div><span class="sat-eyebrow">PANEL GENERAL</span><h3>Resumen de la sesión</h3><p class="muted">Contadores vivos del backend y módulos locales al estilo de Analytics.</p></div>' +
      statusPills() +
      '</div>' +
      '<div class="sat-mini-cards">' +
      kpi('Fama', fmt(m.fame || 0), fmt(m.famePerHour || 0) + ' /h') +
      kpi('Plata recogida', money(m.silver || 0), fmt(m.silverPerHour || 0) + ' /h') +
      kpi('Daño / curación', fmt(damage) + ' / ' + fmt(healing), combatants().length + ' combatientes') +
      kpi('Mapas visitados', fmt(mapRows.length), displayMap((latest && latest.zone) || (latest && latest.world && latest.world.map) || '')) +
      kpi('Recolección', fmt(gatheringRows.length), 'eventos guardados') +
      kpi('Mazmorras', fmt(dungeonRows.length), 'partidas registradas') +
      kpi('Comercio jugador', money(netTrade), tradeRows.length + ' filas') +
      kpi('Estado', (state() && state().hasTracking) ? 'Tracker' : 'Web', 'Sesión interna') +
      '</div>' +
      '<div class="sat-tool-grid">' +
      toolCard('dungeons', 'Mazmorras', 'Historial, filtros por tipo/tier y eficiencia por hora.') +
      toolCard('damage', 'Medidor de daño', 'Ranking de daño, curación, DPS/HPS y participación.') +
      toolCard('trade', 'Seguimiento de comercio', 'PlayerTrade entrante/saliente con filas tipo PlayerTradeContent de SAT.') +
      toolCard('gathering', 'Recolección', 'Recursos, pesca, valor estimado y productividad.') +
      toolCard('player', 'Información del jugador', 'Personaje detectado y perfil oficial del killboard.') +
      toolCard('maps', 'Historial de mapas', 'Línea de tiempo de cambios de cluster y duración.') +
      '</div>';
  }

  function renderDamage() {
    var target = document.getElementById('damageMount');
    if (!target) return;
    var rows = combatants();
    var sort = target.dataset.sort || 'damage';
    var totalDmg = rows.reduce(function (a, r) { return a + (Number(r.damage) || 0); }, 0);
    var totalHeal = rows.reduce(function (a, r) { return a + (Number(r.healing) || 0); }, 0);
    var maxDamage = Math.max(1, totalDmg);
    rows.sort(function (a, b) { return (Number(b[sort]) || 0) - (Number(a[sort]) || 0); });
    target.innerHTML = '<div class="panel trk-card">' +
      '<div class="sat-hero"><div><span class="sat-eyebrow">ANALYTICS · DAMAGE METER</span><h2>Medidor de daño</h2><p class="muted">Consume los mismos eventos de combate de la sesión: daño, curación, daño recibido, DPS/HPS, muertes y asesinatos.</p></div>' +
      '<div class="sat-toolbar"><select id="satDamageSort"><option value="damage">Ordenar por daño</option><option value="dps">Ordenar por DPS</option><option value="healing">Ordenar por curación</option><option value="taken">Ordenar por daño recibido</option></select><button class="btn ghost" id="satDamageCopy" type="button">Copiar ranking</button><button class="btn ghost" id="satDamageReset" type="button">Reiniciar sesión</button></div></div>' +
      '<div class="sat-mini-cards">' +
      kpi('Daño total', fmt(totalDmg), rows.length + ' combatientes') +
      kpi('Curación total', fmt(totalHeal), 'healing + overheal separado') +
      kpi('DPS grupo', fmt(rows.reduce(function (a, r) { return a + (Number(r.dps) || 0); }, 0), 1), 'promedio vivo') +
      kpi('HPS grupo', fmt(rows.reduce(function (a, r) { return a + (Number(r.hps) || 0); }, 0), 1), 'promedio vivo') +
      '</div>' +
      (rows.length ? '<div class="sat-meter-list" style="margin-top:14px">' + rows.map(function (r, i) {
        var share = totalDmg ? (Number(r.damage) || 0) / totalDmg : 0;
        return '<div class="sat-meter-row">' +
          '<div><b>' + (i + 1) + '. ' + esc(r.name || 'Desconocido') + (r.self ? ' <span class="sat-pill pos">yo</span>' : '') + '</b><div class="micro muted">Kills ' + fmt(r.kills || 0) + ' · Muertes ' + fmt(r.deaths || 0) + ' · Mayor golpe ' + fmt(r.biggestHit || 0) + '</div></div>' +
          '<div class="sat-meter-bar"><i style="width:' + Math.max(2, Math.min(100, share * 100)) + '%"></i></div>' +
          '<div class="num"><b>' + fmt(r.damage || 0) + '</b><br><small class="muted">' + fmt(r.dps || 0, 1) + ' DPS</small></div>' +
          '<div class="num"><b>' + fmt(r.healing || 0) + '</b><br><small class="muted">' + fmt(r.hps || 0, 1) + ' HPS</small></div>' +
          '</div>';
      }).join('') + '</div>' : '<div class="sat-muted-box" style="margin-top:14px">Sin datos de combate todavía. Activá el tracking de red en Panel general y entrá con tu personaje para que el JoinResponse habilite métricas.</div>') +
      '</div>';
    var select = document.getElementById('satDamageSort');
    if (select) {
      select.value = sort;
      select.onchange = function () { target.dataset.sort = select.value; renderDamage(); };
    }
    var copy = document.getElementById('satDamageCopy');
    if (copy) copy.onclick = copyDamageRanking;
    var reset = document.getElementById('satDamageReset');
    if (reset) reset.onclick = function () {
      if (!root.AATracker || !confirm('¿Reiniciar contadores de la sesión?')) return;
      root.AATracker.reset().then(function (snap) {
        latest = snap || latest;
        replaceCombatSnapshot([]);
        if (latest && latest.metrics && Array.isArray(latest.metrics.combatants)) replaceCombatSnapshot(latest.metrics.combatants);
        renderAll();
      }).catch(function () {});
    };
  }
  function copyDamageRanking() {
    var rows = combatants().sort(function (a, b) { return (b.damage || 0) - (a.damage || 0); });
    var text = rows.length ? rows.map(function (r, i) { return (i + 1) + '. ' + (r.name || 'Desconocido') + ' — ' + fmt(r.damage || 0) + ' daño · ' + fmt(r.dps || 0, 1) + ' DPS · ' + fmt(r.healing || 0) + ' curación'; }).join('\n') : 'Sin datos de combate.';
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
  }

  function renderTrade() {
    var target = document.getElementById('tradeMount');
    if (!target) return;
    loadItemIndex();
    var rows = filteredTrades().sort(function (a, b) { return b.ts - a.ts; });
    var sums = tradeSums(rows);
    var partnerCount = Object.keys(sums.partners).length;
    var net = sums.silverIn - sums.silverOut;
    target.innerHTML = '<div class="panel trk-card">' +
      '<div class="sat-hero"><div><span class="sat-eyebrow">ANALYTICS · TRADE MONITORING</span><h2>Seguimiento de comercio</h2><p class="muted">Registra PlayerTrade como Analytics: invitación/respuesta, update, cancelación y finished. El historial se guarda localmente en esta vista, separado del ledger manual.</p></div>' +
      '<div class="sat-toolbar"><label class="check"><input id="satTradeEnabled" type="checkbox"> PlayerTrade activo</label><select id="satTradeDirection"><option value="all">Todas</option><option value="incoming">Recibido</option><option value="outgoing">Entregado</option></select><input id="satTradeQuery" class="search" type="search" placeholder="Jugador, ítem o mapa"><button class="btn ghost" id="satTradeExport" type="button">Exportar CSV</button><button class="btn ghost" id="satTradeClear" type="button">Borrar</button></div></div>' +
      '<div class="sat-mini-cards">' +
      kpi('Filas visibles', fmt(rows.length), tradeRows.length + ' guardadas') +
      kpi('Recibido', fmt(sums.incoming), money(sums.silverIn)) +
      kpi('Entregado', fmt(sums.outgoing), money(sums.silverOut)) +
      kpi('Neto en plata', money(net), partnerCount + ' jugadores') +
      '</div>' +
      '<div class="table-wrap" style="margin-top:14px"><table class="sat-table"><thead><tr><th>Hora</th><th>Jugador</th><th>Contenido</th><th>Mapa</th><th class="num">Cantidad</th><th>Dirección</th></tr></thead><tbody>' +
      (rows.length ? rows.slice(0, 300).map(function (row) {
        var info = itemInfo(row);
        var label = row.isSilver ? money(row.silver) : info.name;
        var dir = row.direction === 'incoming' ? 'Recibido' : 'Entregado';
        return '<tr><td class="muted micro">' + esc(shortDate(row.ts)) + '</td><td>' + esc(row.partnerName || 'Jugador') + '<div class="micro muted">Trade #' + esc(row.tradeId || '—') + '</div></td><td><div class="sat-row-main">' + icon(info) + '<div><b>' + esc(label) + '</b><div class="micro muted">' + (row.isSilver ? 'PlayerTradeContent.IsSilver' : 'Índice ' + esc(row.itemIndex || row.itemId || '—')) + '</div></div></div></td><td>' + esc(displayMap(row.map)) + '</td><td class="num">' + fmt(row.quantity) + '</td><td><span class="sat-pill ' + (row.direction === 'incoming' ? 'pos' : 'neg') + '">' + dir + '</span></td></tr>';
      }).join('') : '<tr><td colspan="6" class="loading-cell">Todavía no hay intercambios jugador-a-jugador. Dejá activo el tracking de red y completá un trade.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="micro muted pad">Códigos SAT usados: InvitationPlayerTrade 176, PlayerTradeUpdate 179, PlayerTradeCancel 178, PlayerTradeFinished 180, InviteToPlayerTrade 161.</div>' +
      '</div>';
    var enabled = document.getElementById('satTradeEnabled');
    if (enabled) {
      enabled.checked = tradePrefs.enabled !== false;
      enabled.onchange = function () { tradePrefs.enabled = enabled.checked; saveTradePrefs(); };
    }
    var direction = document.getElementById('satTradeDirection');
    if (direction) {
      direction.value = tradePrefs.direction || 'all';
      direction.onchange = function () { tradePrefs.direction = direction.value; saveTradePrefs(); renderTrade(); };
    }
    var query = document.getElementById('satTradeQuery');
    if (query) {
      query.value = tradePrefs.query || '';
      query.oninput = function () {
        tradePrefs.query = query.value;
        saveTradePrefs();
        clearTimeout(tradeQueryTimer);
        tradeQueryTimer = setTimeout(function () {
          renderTrade();
          var next = document.getElementById('satTradeQuery');
          if (next) {
            next.focus();
            try { next.setSelectionRange(next.value.length, next.value.length); } catch (e) { /* no soportado */ }
          }
        }, 180);
      };
    }
    var exportBtn = document.getElementById('satTradeExport');
    if (exportBtn) exportBtn.onclick = exportTrades;
    var clearBtn = document.getElementById('satTradeClear');
    if (clearBtn) clearBtn.onclick = function () {
      if (!tradeRows.length || !confirm('¿Borrar el historial local de comercio de Sesión?')) return;
      tradeRows = [];
      saveTrades();
      renderDashboard();
      renderTrade();
    };
  }
  function exportTrades() {
    var header = ['ts', 'partnerName', 'direction', 'isSilver', 'itemIndex', 'itemId', 'quantity', 'silver', 'map', 'tradeId'];
    var csv = header.join(';') + '\n' + filteredTrades().map(function (row) {
      return header.map(function (key) { return '"' + String(row[key] == null ? '' : row[key]).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ayudante-albion-player-trades.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function fetchGameInfo(path) {
    var local = await fetch('/gameinfo' + path, { cache: 'no-store' }).catch(function () { return null; });
    if (local && local.ok) return local.json();
    var remote = await fetch(WORKER_URL + '/gameinfo' + path, { cache: 'no-store' }).catch(function () { return null; });
    if (remote && remote.ok) return remote.json();
    throw new Error('killboard no disponible');
  }
  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    return data.players || data.kills || data.deaths || data.events || data.matches || [];
  }
  async function retryGameInfo(path, tries) {
    tries = tries || 3;
    for (var i = 0; i < tries; i++) {
      try { return await fetchGameInfo(path); }
      catch (e) { if (i === tries - 1) throw e; await new Promise(function (resolve) { setTimeout(resolve, 900); }); }
    }
  }
  async function loadPlayer(nameOrId, displayName) {
    if (playerState.loading) return;
    var q = String(nameOrId || playerState.query || '').trim();
    if (!q) return;
    playerState.loading = true;
    playerState.error = '';
    renderPlayer();
    try {
      var id = q;
      var name = displayName || q;
      if (!/^[0-9a-f-]{20,}$/i.test(q)) {
        var search = await retryGameInfo('/search?q=' + encodeURIComponent(q));
        var players = asArray(search);
        var exact = players.filter(function (p) { return String(p.Name || '').toLowerCase() === q.toLowerCase(); })[0] || players[0];
        if (!exact) throw new Error('sin resultados para ' + q);
        id = exact.Id;
        name = exact.Name;
      }
      var detail = await retryGameInfo('/players/' + encodeURIComponent(id));
      var parallel = await Promise.all([
        retryGameInfo('/players/' + encodeURIComponent(id) + '/kills').catch(function () { return null; }),
        retryGameInfo('/players/' + encodeURIComponent(id) + '/deaths').catch(function () { return null; })
      ]);
      playerState.profile = detail;
      playerState.kills = parallel[0] ? asArray(parallel[0]) : null;
      playerState.deaths = parallel[1] ? asArray(parallel[1]) : null;
      playerState.selectedId = id;
      playerState.selectedName = detail.Name || name;
      playerState.query = detail.Name || name;
    } catch (e) {
      playerState.error = e.message || String(e);
    }
    playerState.loading = false;
    renderPlayer();
  }
  function renderPlayer() {
    var target = document.getElementById('playerInfoMount');
    if (!target) return;
    var id = identity();
    if (!playerState.query && (id.name || (latest && latest.character))) playerState.query = id.name || latest.character;
    var d = playerState.profile;
    var ls = (d && d.LifetimeStatistics) || {};
    var pve = ls.PvE || {};
    var gathering = (ls.Gathering || {}).All || {};
    var ratio = d && d.DeathFame > 0 ? (d.KillFame || 0) / d.DeathFame : null;
    target.innerHTML = '<div class="panel trk-card">' +
      '<div class="sat-hero"><div><span class="sat-eyebrow">ANALYTICS · PLAYER INFORMATION</span><h2>Información del jugador</h2><p class="muted">Usa el personaje detectado por JoinResponse y permite consultar el perfil oficial del killboard dentro de Sesión.</p></div>' +
      '<div class="sat-toolbar"><input id="satPlayerQuery" class="search" type="search" placeholder="Nombre del personaje" value="' + esc(playerState.query || '') + '"><button class="btn primary" id="satPlayerLoad" type="button">Cargar datos oficiales</button><button class="btn ghost" id="satPlayerUseDetected" type="button">Usar detectado</button></div></div>' +
      (playerState.loading ? '<div class="sat-muted-box">Cargando perfil oficial…</div>' : '') +
      (playerState.error ? '<div class="sat-muted-box">No se pudo cargar: ' + esc(playerState.error) + '</div>' : '') +
      '<div class="sat-player-card">' +
      '<div class="sat-profile-banner"><span class="sat-eyebrow">PERSONAJE DE LA SESIÓN</span><h3>' + esc(id.name || (latest && latest.character) || 'No detectado') + '</h3><p class="muted">' + esc(id.guild || 'Sin gremio detectado') + (id.alliance ? ' · ' + esc(id.alliance) : '') + '</p>' + statusPills() + '</div>' +
      '<div>' + (d ? '<div class="sat-mini-cards">' +
        kpi('Fama de kills', fmt(d.KillFame || 0), 'PvP') +
        kpi('Fama de muertes', fmt(d.DeathFame || 0), 'perdida') +
        kpi('Ratio K/D', ratio == null ? '—' : fmt(ratio, 2), 'por fama') +
        kpi('Fama PvE', fmt(pve.Total || 0), 'histórica') +
        kpi('Recolección', fmt(gathering.Total || 0), 'histórica') +
        kpi('Crafteo', fmt((ls.Crafting || {}).Total || 0), 'histórica') +
        kpi('Pesca', fmt(ls.FishingFame || 0), 'histórica') +
        kpi('Gremio', d.GuildName || 'Sin gremio', d.AllianceName || '') +
        '</div>' : '<div class="sat-muted-box">Cargá el perfil para ver fama histórica, gremio y eventos recientes. El módulo Perfil original queda intacto.</div>') + '</div>' +
      '</div>' +
      (d ? renderPlayerEvents(playerState.kills, playerState.deaths) : '') +
      '</div>';
    var input = document.getElementById('satPlayerQuery');
    var load = document.getElementById('satPlayerLoad');
    var use = document.getElementById('satPlayerUseDetected');
    if (input) input.oninput = function () { playerState.query = input.value; };
    if (input) input.onkeydown = function (ev) { if (ev.key === 'Enter') loadPlayer(playerState.query); };
    if (load) load.onclick = function () { loadPlayer(playerState.query); };
    if (use) use.onclick = function () { playerState.query = (identity().name || (latest && latest.character) || '').trim(); renderPlayer(); if (playerState.query) loadPlayer(playerState.query); };
  }
  function renderPlayerEvents(kills, deaths) {
    function row(ev, mode) {
      var other = mode === 'kill' ? (ev.Victim || {}) : (ev.Killer || {});
      var fame = ev.TotalVictimKillFame || ev.Fame || 0;
      return '<tr><td class="muted micro">' + esc(shortDate(Date.parse(ev.TimeStamp || ev.timeStamp || ev.Timestamp || '') || Date.now())) + '</td><td><b>' + esc(other.Name || '—') + '</b><div class="micro muted">' + esc(other.GuildName || 'sin gremio') + '</div></td><td class="num">' + fmt(other.AverageItemPower || 0) + '</td><td class="num ' + (mode === 'kill' ? 'pos' : 'neg') + '">' + fmt(fame) + '</td></tr>';
    }
    var killsRows = Array.isArray(kills) ? kills.slice(0, 8) : [];
    var deathRows = Array.isArray(deaths) ? deaths.slice(0, 8) : [];
    return '<div class="sat-grid cols-2" style="margin-top:14px">' +
      '<div class="table-wrap"><table class="sat-table"><thead><tr><th colspan="4">Asesinatos recientes</th></tr><tr><th>Fecha</th><th>Víctima</th><th class="num">IP</th><th class="num">Fama</th></tr></thead><tbody>' + (killsRows.length ? killsRows.map(function (ev) { return row(ev, 'kill'); }).join('') : '<tr><td colspan="4" class="loading-cell">Sin datos recientes.</td></tr>') + '</tbody></table></div>' +
      '<div class="table-wrap"><table class="sat-table"><thead><tr><th colspan="4">Muertes recientes</th></tr><tr><th>Fecha</th><th>Asesino</th><th class="num">IP</th><th class="num">Fama</th></tr></thead><tbody>' + (deathRows.length ? deathRows.map(function (ev) { return row(ev, 'death'); }).join('') : '<tr><td colspan="4" class="loading-cell">Sin datos recientes.</td></tr>') + '</tbody></table></div>' +
      '</div>';
  }

  function renderMaps() {
    var target = document.getElementById('mapsMount');
    if (!target) return;
    var rows = maps().slice().sort(function (a, b) { return (b.enter || 0) - (a.enter || 0); });
    var current = (latest && latest.world && latest.world.map) || (latest && latest.zone) || '';
    var unique = Object.create(null);
    var totalSeconds = 0;
    rows.forEach(function (row) { unique[displayMap(row.name || row.map || row.zone)] = true; totalSeconds += Number(row.seconds) || 0; });
    target.innerHTML = '<div class="panel trk-card">' +
      '<div class="sat-hero"><div><span class="sat-eyebrow">ANALYTICS · MAP HISTORY</span><h2>Historial de mapas</h2><p class="muted">Línea de tiempo generada desde JoinResponse, ChangeCluster y JoinFinished, con resolución local de clusters.</p></div>' +
      '<div class="sat-toolbar"><button class="btn ghost" id="satMapsCopy" type="button">Copiar historial</button></div></div>' +
      '<div class="sat-mini-cards">' +
      kpi('Mapa actual', displayMap(current), (latest && latest.world && latest.world.instance) || '') +
      kpi('Visitas', fmt(rows.length), Object.keys(unique).length + ' mapas únicos') +
      kpi('Tiempo acumulado', duration(totalSeconds), 'en historial') +
      kpi('Último cambio', rows[0] ? shortDate(rows[0].enter) : '—', rows[0] ? displayMap(rows[0].name) : 'sin datos') +
      '</div>' +
      '<div class="sat-timeline" style="margin-top:14px">' +
      (rows.length ? rows.slice(0, 120).map(function (row) {
        var name = displayMap(row.name || row.map || row.zone || '');
        var seconds = Number(row.seconds || 0);
        if (!row.leave && row.enter) seconds = Math.max(seconds, Math.floor((Date.now() - row.enter) / 1000));
        return '<div class="sat-timeline-row"><div><b>' + esc(shortDate(row.enter)) + '</b><br><small class="muted">' + (row.leave ? esc(shortDate(row.leave)) : 'en curso') + '</small></div><div><b>' + esc(name) + '</b><div class="micro muted">' + esc(row.instance || row.cluster || '') + '</div></div><div class="num"><span class="sat-pill">' + esc(duration(seconds)) + '</span></div></div>';
      }).join('') : '<div class="sat-muted-box">Sin cambios de mapa registrados todavía. El historial aparece cuando la captura recibe JoinResponse o ChangeCluster.</div>') +
      '</div>' +
      '</div>';
    var copy = document.getElementById('satMapsCopy');
    if (copy) copy.onclick = function () {
      var text = rows.map(function (row) { return shortDate(row.enter) + ' — ' + displayMap(row.name || row.map || row.zone || '') + ' — ' + duration(row.seconds || 0); }).join('\n') || 'Sin historial de mapas.';
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
    };
  }

  function render(key) {
    key = key || activeSessionKey();
    if (key === 'tracker') renderDashboard();
    if (key === 'damage') renderDamage();
    if (key === 'trade') renderTrade();
    if (key === 'player') renderPlayer();
    if (key === 'maps') renderMaps();
  }
  function renderAll() {
    renderDashboard();
    renderDamage();
    renderTrade();
    renderPlayer();
    renderMaps();
  }
  function handleTrackerEvent(payload, type) {
    if (type === 'snapshot' || type === 'status') {
      latest = payload || latest;
      if (payload && payload.metrics && Array.isArray(payload.metrics.combatants)) replaceCombatSnapshot(payload.metrics.combatants);
      else if (payload && Array.isArray(payload.combatants)) replaceCombatSnapshot(payload.combatants);
    }
    if (type === 'damage' || type === 'heal') recordCombatEvent(payload, type);
    if (type === 'trade') addTradePayload(payload);
    if (type === 'map' && latest && latest.world && payload && payload.zone) latest.world.map = payload.zone;
    var active = activeSessionKey();
    if (type !== 'trade') {
      renderDashboard();
      if (active === 'damage' && (type === 'damage' || type === 'heal' || type === 'combat' || type === 'snapshot' || type === 'status')) renderDamage();
      if (active === 'player' && (type === 'snapshot' || type === 'status')) renderPlayer();
      if (active === 'maps' && (type === 'map' || type === 'snapshot' || type === 'status')) renderMaps();
    }
  }
  function loadCurrentSession() {
    if (!root.AATracker || typeof root.AATracker.session !== 'function') return;
    root.AATracker.session().then(function (data) {
      latest = data || latest;
      if (data && data.metrics && Array.isArray(data.metrics.combatants)) replaceCombatSnapshot(data.metrics.combatants);
      else if (data && Array.isArray(data.combatants)) replaceCombatSnapshot(data.combatants);
      renderAll();
    }).catch(function () { renderAll(); });
  }
  function init() {
    if (initialized) return;
    initialized = true;
    tradeRows = tradeRows.map(normalizeTrade).filter(Boolean);
    saveTrades();
    loadItemIndex();
    document.addEventListener('click', function (event) {
      var go = event.target.closest('[data-session-go]');
      if (!go) return;
      event.preventDefault();
      if (root.AANavigation) {
        root.AANavigation.activateTab('tracker');
        root.AANavigation.activateSessionView(go.dataset.sessionGo, true);
      }
    });
    if (root.AATrackerAnalytics) {
      root.AATrackerAnalytics.subscribe(handleTrackerEvent);
      root.AATrackerAnalytics.detect().then(loadCurrentSession).catch(loadCurrentSession);
    } else if (root.AATracker) {
      root.AATracker.on(function (type, payload) { handleTrackerEvent(payload, type); });
      root.AATracker.detect().then(loadCurrentSession).catch(loadCurrentSession);
    } else {
      renderAll();
    }
    if (root.AATrackerMaps && root.AATrackerMaps.ready) root.AATrackerMaps.ready.then(renderAll).catch(function () {});
    setInterval(function () {
      var active = activeSessionKey();
      renderDashboard();
      if (active === 'damage') renderDamage();
      if (active === 'maps') renderMaps();
    }, 5000);
  }

  root.AASessionTools = Object.freeze({
    render: render,
    addTrade: addTradePayload,
    trades: function () { return tradeRows.slice(); },
    loadPlayer: loadPlayer
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}(window));
