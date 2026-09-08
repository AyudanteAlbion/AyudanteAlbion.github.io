/* Control de calidad profundo: ejercita cada módulo con precios simulados */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const appjs = fs.readFileSync('app.js', 'utf8');
const errors = [], warns = [], oks = [];

const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const PRICE = 1000; // precio simulado para todo

window.fetch = (url) => {
  const u = String(url);
  let data = [];
  try {
    if (u.includes('.json') && !u.includes('albion-online-data')) {
      const f = u.match(/data\/[a-z_]+\.json/)[0];
      data = JSON.parse(fs.readFileSync(f, 'utf8'));
    } else if (u.includes('/prices/')) {
      // API simulada: extraer ids y ciudades de la URL y devolver precios
      const ids = decodeURIComponent(u.split('/prices/')[1].split('.json')[0]).split(',');
      const locs = (u.match(/locations=([^&]+)/) || [,''])[1].split('%2C').join(',').split(',').filter(Boolean);
      data = [];
      for (const id of ids) for (const loc of (locs.length ? locs : ['Caerleon'])) {
        for (const q of (u.includes('qualities=1') ? [1] : [1,2,3])) {
          data.push({ item_id: id, city: decodeURIComponent(loc), quality: q,
            sell_price_min: PRICE, sell_price_min_date: new Date().toISOString().slice(0,19),
            buy_price_max: PRICE * 0.9, buy_price_max_date: new Date().toISOString().slice(0,19) });
        }
      }
    } else if (u.includes('/gold')) {
      data = [{ price: 4000, timestamp: new Date().toISOString() }];
    } else if (u.includes('/gameinfo/search')) {
      data = { players: [{ Id: 'qa1', Name: 'TestPlayer', GuildName: 'QA Guild', AllianceName: '' }], guilds: [] };
    } else if (u.includes('/gameinfo/players/qa1/topkills')) {
      data = [{ EventId: 71, TimeStamp: '2026-09-01T10:00:00Z', TotalVictimKillFame: 999999, numberOfParticipants: 5,
        Killer: { Name: 'TestPlayer', GuildName: 'QA Guild', AverageItemPower: 1500 },
        Victim: { Name: 'TopVictim', GuildName: 'Otros', AverageItemPower: 1450, Equipment: { MainHand: { Type: 'T8_MAIN_SWORD' } } } }];
    } else if (u.includes('/gameinfo/players/qa1/solokills')) {
      data = [{ EventId: 72, TimeStamp: '2026-09-02T10:00:00Z', TotalVictimKillFame: 55555, numberOfParticipants: 1,
        Killer: { Name: 'TestPlayer', GuildName: 'QA Guild', AverageItemPower: 1500 },
        Victim: { Name: 'SoloVictim', GuildName: 'Otros', AverageItemPower: 1200, Equipment: { MainHand: { Type: 'T6_MAIN_DAGGER' } } } }];
    } else if (u.includes('/gameinfo/players/qa1/kills') || u.includes('/gameinfo/players/qa1/deaths')) {
      data = [{ EventId: 1, TimeStamp: '2026-09-07T12:00:00Z', TotalVictimKillFame: 12345, numberOfParticipants: 2,
        Killer: { Name: 'TestPlayer', GuildName: 'QA Guild', AverageItemPower: 1400 },
        Victim: { Name: 'Rival', GuildName: 'Otros', AverageItemPower: 1300, Equipment: { MainHand: { Type: 'T4_MAIN_SWORD' } } } }];
    } else if (u.includes('/gameinfo/players/qa1')) {
      data = { Name: 'TestPlayer', Id: 'qa1', GuildName: 'QA Guild', GuildId: 'g9', AllianceName: '', AllianceTag: '',
        KillFame: 1000000, DeathFame: 500000, FameRatio: 2,
        LifetimeStatistics: { PvE: { Total: 99999 }, Gathering: { All: { Total: 5555 } }, Crafting: { Total: 7777 }, FishingFame: 1, FarmingFame: 2 } };
    } else if (u.includes('/gameinfo/guilds/g9/top')) {
      data = [{ EventId: 81, TimeStamp: '2026-09-05T10:00:00Z', TotalVictimKillFame: 777777,
        Killer: { Name: 'GuildStar', GuildName: 'QA Guild' },
        Victim: { Name: 'GuildVictim', GuildName: 'Otros' } }];
    } else if (u.includes('/gameinfo/guilds/g9')) {
      data = { Name: 'QA Guild', MemberCount: 42, killFame: 123, DeathFame: 456, FounderName: 'Fundador', Founded: '2024-01-01T00:00:00Z', AllianceName: '' };
    }
  } catch (e) { /* vacío */ }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
};
window.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
window.alert = () => {}; window.confirm = () => true; window.scrollTo = () => {};
window.localStorage.clear();
window.onerror = (m, s, l) => errors.push(`window.onerror: ${m} @${l}`);
window.HTMLElement.prototype.scrollIntoView = function(){};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => window.document.getElementById(id);
const bodyOf = id => ($(id) ? $(id).innerHTML : '(no existe)');
const rowsIn = id => $(id) ? $(id).querySelectorAll('tr').length : -1;
const check = (cond, okMsg, errMsg) => cond ? oks.push(okMsg) : errors.push(errMsg);

(async () => {
  try { window.eval(appjs); oks.push('app.js cargó'); }
  catch (e) { errors.push('CRASH al cargar app.js: ' + e.message); return finish(); }
  await sleep(800); // init: catálogo + datos locales

  // ── COCINA ──
  window.eval(`gotoTab('food')`); await sleep(600);
  check(rowsIn('foodBody') > 5, `Cocina: ${rowsIn('foodBody')} filas`, 'Cocina: tabla vacía → ' + bodyOf('foodBody').slice(0,120));
  // expandir primera fila
  try {
    const tr = $('foodBody').querySelector('tr.clickable');
    if (tr) { tr.click(); await sleep(200);
      check($('foodBody').querySelector('.craft-detail') !== null, 'Cocina: detalle expandido OK', 'Cocina: no se expandió el detalle');
      const regBtns = $('foodBody').querySelectorAll('.craft-detail [onclick^="llPrefill"]');
      check(regBtns.length >= 2, `Cocina: ${regBtns.length} botones «Registrar» en el detalle`, 'Cocina: faltan botones Registrar en el detalle');
      // favoritos: marcar ★, verificar guardado con nombre en español y panel en Inicio
      const star = $('foodBody').querySelector('.fav-btn');
      if (!star) errors.push('Cocina: falta botón ☆ Favorito');
      else {
        star.click(); await sleep(150);
        const favs = JSON.parse(window.localStorage.getItem('favorites') || '[]');
        check(favs.length === 1 && favs[0].tab === 'food' && !/^T\d_/.test(favs[0].name),
          `Favoritos: guardado con nombre español («${(favs[0] || {}).name}»)`, 'Favoritos: no se guardó o quedó el ID → ' + JSON.stringify(favs));
        window.eval(`gotoTab('home')`); await sleep(150);
        check($('homeFavs').style.display !== 'none' && $('homeFavList').querySelectorAll('.fav-row').length === 1,
          'Favoritos: panel visible en Inicio con 1 fila', 'Favoritos: panel de Inicio no renderiza');
        $('homeFavList').querySelector('.fav-del').click(); await sleep(150);
        check(JSON.parse(window.localStorage.getItem('favorites') || '[]').length === 0 && $('homeFavs').style.display === 'none',
          'Favoritos: quitar desde Inicio oculta el panel', 'Favoritos: no se quitó desde Inicio');
        window.eval(`gotoTab('food')`); await sleep(200);
      } }
  } catch (e) { errors.push('Cocina expandir: ' + e.message); }

  // ── ALQUIMIA ──
  window.eval(`gotoTab('alch')`); await sleep(600);
  check(rowsIn('alchBody') > 5, `Alquimia: ${rowsIn('alchBody')} filas`, 'Alquimia: tabla vacía → ' + bodyOf('alchBody').slice(0,120));

  // ── REFINAMIENTO ──
  window.eval(`gotoTab('refine')`); await sleep(600);
  check(rowsIn('refineBody') > 5, `Refinamiento: ${rowsIn('refineBody')} filas`, 'Refinamiento: vacío → ' + bodyOf('refineBody').slice(0,120));

  // ── CRAFTEO DE EQUIPO ──
  window.eval(`gotoTab('gear')`); await sleep(300);
  try {
    const fam = window.document.querySelector('#gearFamChips .chip[data-fam]');
    if (fam) { fam.click(); await sleep(700);
      check(rowsIn('gearBody') > 2, `Crafteo: familia «${fam.textContent.trim()}» → ${rowsIn('gearBody')} filas`, 'Crafteo: tabla vacía tras elegir familia'); }
    else errors.push('Crafteo: no hay chips de familia');
  } catch (e) { errors.push('Crafteo: ' + e.message); }

  // ── ENCANTADO ──
  window.eval(`gotoTab('enchant')`); await sleep(300);
  try {
    $('enSearch').value = 'arco';
    $('enSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(150);
    const hit = window.document.querySelector('#enResults .sr-item');
    if (!hit) { errors.push('Encantado: búsqueda «arco» sin resultados'); }
    else {
      hit.click(); await sleep(700);
      const res = bodyOf('enResult');
      check(res.includes('nivel') || res.includes('Nivel') || res.length > 300,
        'Encantado: comparación renderizada tras elegir ítem',
        'Encantado: resultado vacío → ' + res.slice(0,150));
      const enReg = $('enResult').querySelectorAll('[onclick^="llPrefill"]');
      check(enReg.length >= 2, `Encantado: ${enReg.length} botones «Registrar» en el planificador`, 'Encantado: faltan botones Registrar');
    }
  } catch (e) { errors.push('Encantado: ' + e.message); }

  // ── GRANJA ──
  window.eval(`gotoTab('farm')`); await sleep(800);
  check(rowsIn('fmBody') > 5, `Granja: ${rowsIn('fmBody')} filas`, 'Granja: tabla vacía → ' + bodyOf('fmBody').slice(0,150));
  check(($('fmStats')?.textContent || '').length > 10, 'Granja: stats renderizadas', 'Granja: stats vacías');
  try {
    const ftr = $('fmBody').querySelector('tr.clickable');
    if (ftr) { ftr.click(); await sleep(250);
      const fReg = $('fmBody').querySelectorAll('[onclick^="llPrefill"]');
      check(fReg.length === 2, 'Granja: detalle con 2 botones «Registrar»', `Granja: ${fReg.length} botones Registrar (esperaba 2)`); }
  } catch (e) { errors.push('Granja expandir: ' + e.message); }

  // ── FLIPPING ──
  window.eval(`gotoTab('flip')`); await sleep(300);
  try { window.eval(`document.getElementById('flipRefresh')?.click()`); } catch (e) {}
  await sleep(900);
  check(rowsIn('flipBody') > 5, `Flipping: ${rowsIn('flipBody')} filas`, 'Flipping: vacío → ' + bodyOf('flipBody').slice(0,120));
  // detalle + botones registrar
  try {
    const tr = $('flipBody').querySelector('tr[data-id]');
    if (tr) { tr.click(); await sleep(200);
      const det = bodyOf('flipDetail');
      check(det.includes('Registrar'), 'Flipping: detalle con botones «Registrar»', 'Flipping: detalle sin botones Registrar'); }
  } catch (e) { errors.push('Flipping detalle: ' + e.message); }
  // ruta fija: fijar origen y verificar que la columna «Comprar en» lo respeta
  try {
    check($('flipFrom') && $('flipFrom').options.length === 8 && $('flipTo').options.length === 8,
      'Flipping: selects de ruta con 7 ciudades + «Mejor ciudad»', 'Flipping: selects de ruta mal poblados');
    $('flipFrom').value = 'Lymhurst';
    $('flipFrom').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(300);
    const r = $('flipBody').querySelector('tr.clickable');
    const buyTd = r ? r.querySelectorAll('td')[2].textContent : '';
    check(buyTd.includes('Lymhurst'), 'Flipping: origen fijo respetado (compra en Lymhurst)', 'Flipping: origen fijo ignorado → ' + buyTd);
    $('flipTo').value = 'Lymhurst';
    $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
    check($('flipFrom').value === '', 'Flipping: colisión origen=destino resetea el otro select', 'Flipping: colisión de ruta no manejada');
    $('flipTo').value = ''; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(200);
    // persistencia de la ruta elegida (flipPrefs)
    $('flipTo').value = 'Brecilien'; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
    const prefs = JSON.parse(window.localStorage.getItem('flipPrefs') || 'null');
    check(prefs && prefs.to === 'Brecilien', 'Flipping: ruta elegida persiste en localStorage', 'Flipping: flipPrefs no guarda la ruta → ' + JSON.stringify(prefs));
    $('flipTo').value = ''; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
  } catch (e) { errors.push('Flipping ruta: ' + e.message); }

  // ── FLIPPING: destino fijo + origen auto → no puede elegir la misma ciudad (regresión) ──
  try {
    const saveFetch = window.fetch;
    window.fetch = (u) => {
      const url = String(u);
      if (url.includes('T4_BAG') && url.includes('prices/')) {
        // Caerleon (el destino fijado) es la MÁS BARATA para comprar: antes del fix
        // el origen auto la tomaba, colisionaba y la fila quedaba en "—"
        const rows = [
          { item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: 450, sell_price_min_date: '2026-09-07T12:00:00', buy_price_max: 400, buy_price_max_date: null },
          { item_id: 'T4_BAG', city: 'Thetford', quality: 1, sell_price_min: 500, sell_price_min_date: null, buy_price_max: 460, buy_price_max_date: null },
          { item_id: 'T4_BAG', city: 'Lymhurst', quality: 1, sell_price_min: 900, sell_price_min_date: null, buy_price_max: 850, buy_price_max_date: null },
        ];
        return Promise.resolve({ ok: true, json: () => Promise.resolve(rows) });
      }
      return saveFetch(u);
    };
    $('flipTo').value = 'Caerleon'; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true }));
    $('flipFrom').value = ''; $('flipFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
    window.eval(`loadFlipPrices(['T4_BAG'])`); await sleep(500);
    const f = window.eval(`flipCalc('T4_BAG')`);
    const expect = Math.round((450 * 0.935 - 500) * 100) / 100; // destino fijo → compra en la siguiente más barata
    check(f.bestBuy && f.bestBuy.city === 'Thetford' && Math.abs(f.profit - expect) < 0.01,
      'Flipping: destino fijo + origen auto descarta el destino (Thetford→Caerleon)',
      'Flipping: colisión destino/origen sin resolver → bestBuy=' + (f.bestBuy && f.bestBuy.city) + ' profit=' + f.profit);
    window.fetch = saveFetch;
    $('flipTo').value = ''; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
  } catch (e) { errors.push('Flipping destino-fijo: ' + e.message); }

  // ── ALERTAS DE PRECIO: alta, disparo, re-arma ──
  try {
    window.eval(`gotoTab('alerts')`); await sleep(200);
    check(!!$('waBody') && !!$('waAdd'), 'Alertas: pestaña renderizada', 'Alertas: faltan controles de la pestaña');
    // acceso rápido desde Flipping (prefill por fila)
    window.eval(`waPrefillFlip('T4_BAG')`); await sleep(150);
    check($('waItemInput').value.length > 0, 'Alertas: prefill desde Flipping carga el ítem', 'Alertas: prefill no cargó el ítem');
    $('waMetric').value = 'sell'; $('waMetric').dispatchEvent(new window.Event('change', { bubbles: true }));
    $('waThreshold').value = '100000'; // mock: toda venta vale 1000 → la condición se cumple apenas se chequea
    $('waAdd').click(); await sleep(200);
    let saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
    check(saved.length === 1 && saved[0].metric === 'sell' && saved[0].threshold === 100000 && saved[0].on === true,
      'Alertas: creación persistida en localStorage', 'Alertas: creación falla → ' + JSON.stringify(saved));
    window.eval(`waTick()`); await sleep(700); // verificación forzada
    saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
    check(saved[0].fired === true && saved[0].on === false && saved[0].price === 1000,
      'Alertas: se dispara al cumplirse y se apaga (modo "una vez")', 'Alertas: estado tras check → ' + JSON.stringify(saved[0]));
    check(!!window.document.querySelector('.wa-toast'), 'Alertas: toast visible al disparar', 'Alertas: no se mostró el toast');
    // re-arma al reactivarla
    const btn = window.document.querySelector('[data-wa-on]');
    if (btn) { btn.click(); await sleep(300);
      saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
      check(saved[0].on === true && saved[0].fired === false, 'Alertas: ▶ reactiva y re-arma', 'Alertas: reactivación no re-arma → ' + JSON.stringify(saved[0]));
      const del = window.document.querySelector('[data-wa-del]');
      if (del) { del.click(); await sleep(150);
        saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
        check(saved.length === 0, 'Alertas: eliminación limpia la lista', 'Alertas: no se eliminó la alerta');
      } }
  } catch (e) { errors.push('Alertas: ' + e.message); }

  // ── TWITCH: indicador EN VIVO / OFFLINE en creadores de SG ──
  try {
    check(window.document.querySelectorAll('.sg-creator[data-twitch]').length === 3,
      'Twitch: 3 tarjetas de creador con canal declarado', 'Twitch: cantidad de canales ≠ 3');
    const saveFetch = window.fetch;
    window.fetch = (u) => {
      const url = String(u);
      if (url.includes('/twitch/uptime/j4acksp4rr0w')) return Promise.resolve({ ok: true, text: () => Promise.resolve('2 hours, 5 minutes') });
      if (url.includes('/twitch/uptime/santiagosigma')) return Promise.resolve({ ok: true, text: () => Promise.resolve('santiagosigma is offline') });
      if (url.includes('/twitch/uptime/fraxuzve')) return Promise.resolve({ ok: true, text: () => Promise.resolve('Channel is offline') });
      return saveFetch(u);
    };
    window.eval(`gotoTab('sg')`); await sleep(1600); // 3 checks escalonados (350 ms c/u)
    const badge = chan => window.document.querySelector(`.sg-creator[data-twitch="${chan}"] .sg-live`);
    check(badge('j4acksp4rr0w').classList.contains('live') && badge('j4acksp4rr0w').textContent.includes('EN VIVO')
        && badge('j4acksp4rr0w').textContent.includes('2 h 5 min'),
      'Twitch: badge EN VIVO con tiempo al aire en es-AR', 'Twitch: badge live → ' + badge('j4acksp4rr0w').textContent);
    check(badge('santiagosigma').classList.contains('off') && badge('santiagosigma').textContent.includes('OFFLINE'),
      'Twitch: badge OFFLINE', 'Twitch: badge offline → ' + badge('santiagosigma').textContent);
    check(window.document.querySelector('.sg-creator[data-twitch="j4acksp4rr0w"]').classList.contains('sg-live-on')
        && !window.document.querySelector('.sg-creator[data-twitch="santiagosigma"]').classList.contains('sg-live-on'),
      'Twitch: glow morado solo en la tarjeta en vivo', 'Twitch: glow de tarjeta mal asignado');
    const card = JSON.parse(window.sessionStorage.getItem('twitchLive') || '{}');
    check(card.j4acksp4rr0w && card.j4acksp4rr0w.live === true && card.santiagosigma && card.santiagosigma.live === false,
      'Twitch: estado cacheado en sessionStorage (no parpadea al cambiar de pestaña)', 'Twitch: cache → ' + JSON.stringify(card));
    window.fetch = saveFetch;
  } catch (e) { errors.push('Twitch: ' + e.message); }

  // ── ⚡ ANTI-PAUSA: nunca congelar la app mientras la pestaña está abierta ──
  try {
    check(!!$('kaBtn') && $('kaBtn').classList.contains('ka-on'),
      'Anti-pausa: botón en la barra, activo por defecto', 'Anti-pausa: botón ausente o estado inicial apagado');
    check(window.eval('typeof kaRunDue') === 'function' && window.eval('typeof kaHush') === 'function'
        && window.eval('typeof kaLock') === 'function' && window.eval('typeof kaWake') === 'function',
      'Anti-pausa: lock + wake + hush presentes (jsdom sin AudioContext degrada sin romper)', 'Anti-pausa: faltan funciones');
    // toggle off → persiste; toggle on → vuelve (verificable por DOM + localStorage)
    $('kaBtn').click(); await sleep(80);
    check(window.localStorage.getItem('kaOn') === '0' && !$('kaBtn').classList.contains('ka-on')
        && $('kaBtn').getAttribute('aria-pressed') === 'false',
      'Anti-pausa: clic lo apaga y persiste en localStorage', 'Anti-pausa: toggle off no aplicó → ' + window.localStorage.getItem('kaOn'));
    $('kaBtn').click(); await sleep(80);
    check(window.localStorage.getItem('kaOn') === '1' && $('kaBtn').classList.contains('ka-on'),
      'Anti-pausa: clic lo reactiva', 'Anti-pausa: toggle on no aplicó');
    // catch-up: con una alerta activa y el tick vencido, kaRunDue dispara waTick YA.
    // se crea la alerta por la UI real y se espían waTick/waSchedule (globales reasignables)
    window.eval('window.__origTick = waTick; window.__origSch = waSchedule; waSchedule = function(){}; waTick = async () => { window.__kaSpy = (window.__kaSpy||0) + 1; };');
    window.eval(`waPrefillFlip('T4_BAG')`); await sleep(120);
    $('waThreshold').value = '100000';
    $('waAdd').click(); await sleep(120);
    const kaAlerts = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
    check(kaAlerts.length === 1 && kaAlerts[0].on === true, 'Anti-pausa: alerta creada por la UI queda activa', 'Anti-pausa: setup de alerta falló → ' + JSON.stringify(kaAlerts));
    window.dispatchEvent(new window.Event('focus')); await sleep(150);
    check(window.eval('window.__kaSpy') === 1, 'Anti-pausa: catch-up dispara el tick vencido al volver', 'Anti-pausa: kaRunDue no re-disparó waTick → spy=' + window.eval('window.__kaSpy'));
    const delBtn = window.document.querySelector('[data-wa-del]');
    if (delBtn) delBtn.click(); await sleep(80);
    window.eval('waTick = window.__origTick; waSchedule = window.__origSch;');
    check(JSON.parse(window.localStorage.getItem('priceAlerts') || '[]').length === 0,
      'Anti-pausa: limpieza del test', 'Anti-pausa: quedó una alerta de test');
  } catch (e) { errors.push('Anti-pausa: ' + e.message); }

  // ── TRANSMUTACIÓN ──
  window.eval(`gotoTab('transmute')`); await sleep(900);
  const trB = window.document.querySelector('#tab-transmute tbody');
  check(trB && trB.querySelectorAll('tr').length > 3, 'Transmutación: tabla poblada', 'Transmutación: tabla vacía');
  try {
    const ttr = trB && trB.querySelector('tr.clickable');
    if (ttr) { ttr.click(); await sleep(250);
      const tReg = trB.querySelectorAll('[onclick^="llPrefill"]');
      check(tReg.length === 2, 'Transmutación: detalle con 2 botones «Registrar»', `Transmutación: ${tReg.length} botones Registrar (esperaba 2)`); }
  } catch (e) { errors.push('Transmutación expandir: ' + e.message); }

  // ── ARTEFACTOS ──
  window.eval(`gotoTab('meld')`); await sleep(1200);
  const meldB = window.document.querySelector('#tab-meld tbody');
  check(meldB && meldB.querySelectorAll('tr').length > 3, 'Artefactos: tabla poblada', 'Artefactos: tabla vacía');

  // ── BUSCADOR ──
  window.eval(`gotoTab('search')`); await sleep(200);
  try {
    $('psSearch').value = 'espada';
    $('psSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(150);
    const hit = window.document.querySelector('#psResults .sr-item');
    if (!hit) errors.push('Buscador: «espada» sin resultados');
    else {
      hit.click(); await sleep(700);
      const res = bodyOf('psResult');
      check(res.includes('Caerleon') || res.includes('Martlock'), 'Buscador: matriz de ciudades renderizada', 'Buscador: sin matriz → ' + res.slice(0,150));
      const psReg = $('psResult').querySelectorAll('[onclick^="llPrefill"]');
      check(psReg.length === 0, 'Buscador: sin botones «Registrar» (solo consulta, por pedido del usuario)', `Buscador: ${psReg.length} botones Registrar (esperaba 0)`);
      const hist = JSON.parse(window.localStorage.getItem('psHistory') || '[]');
      check(hist.length === 1, 'Buscador: historial guardado', 'Buscador: historial no se guardó');
    }
  } catch (e) { errors.push('Buscador: ' + e.message); }

  // ── REGISTRO ──
  window.eval(`gotoTab('ledgerlog')`); await sleep(200);
  try {
    window.eval(`llPrefill('T4_BAG','buy',5000,'Martlock')`);
    $('llQty').value = '10';
    $('llAdd').click(); await sleep(100);
    window.eval(`llPrefill('T4_BAG','sell',7000,'Caerleon')`);
    $('llQty').value = '10';
    $('llAdd').click(); await sleep(100);
    const rows = JSON.parse(window.localStorage.getItem('tradeLog') || '[]');
    check(rows.length === 2, 'Registro: 2 operaciones guardadas', `Registro: ${rows.length} filas (esperaba 2)`);
    const stats = $('llStats').textContent;
    check(stats.includes('20.000') || stats.includes('20,000') || stats.includes('20 000'),
      'Registro: P&L = +20.000 correcto (70.000−50.000)', 'Registro: P&L no muestra 20.000 → ' + stats.slice(0,200));
    // CSV
    let csvOk = false;
    window.URL.createObjectURL = () => { csvOk = true; return 'blob:x'; };
    window.URL.revokeObjectURL = () => {};
    $('llExport').click(); await sleep(100);
    check(csvOk, 'Registro: exportación CSV dispara descarga', 'Registro: CSV no generó blob');
    // Respaldo completo
    let bkBlob = null;
    window.URL.createObjectURL = (b) => { bkBlob = b; return 'blob:x'; };
    $('bkExport').click(); await sleep(150);
    if (!bkBlob) errors.push('Registro: respaldo completo no generó archivo');
    else {
      const bkTxt = await bkBlob.text();
      const bk = JSON.parse(bkTxt);
      check(bk.app === 'AyudanteAlbion' && bk.data && bk.data.tradeLog,
        'Registro: respaldo completo incluye tradeLog con formato válido', 'Registro: respaldo malformado');
    }
    check($('bkImport') && $('bkFile'), 'Registro: botón e input de importar respaldo presentes', 'Registro: falta importar respaldo');
    // Resumen por ítem: 1 grupo (T4_BAG), P&L +20.000, +2.000/unidad vendida
    window.document.querySelector('#llFilter [data-f="byitem"]').click(); await sleep(150);
    const gRows = $('llBody').querySelectorAll('tr');
    const gTxt = $('llBody').textContent;
    check(gRows.length === 1 && gTxt.includes('+20.000') && gTxt.includes('+2.000'),
      'Registro: resumen por ítem agrupa y calcula P&L +20.000 (+2.000/u)',
      `Registro: resumen por ítem mal → ${gRows.length} filas, ${gTxt.slice(0,150)}`);
    window.document.querySelector('#llFilter [data-f="all"]').click(); await sleep(150);
    check(window.document.querySelector('#llTable thead').textContent.includes('Fecha') && $('llBody').querySelectorAll('tr').length === 2,
      'Registro: vuelta del resumen a la vista cronológica', 'Registro: no restaura la vista normal tras el resumen');
  } catch (e) { errors.push('Registro: ' + e.message); }

  // ── PERFIL ──
  window.eval(`gotoTab('profile')`); await sleep(200);
  try {
    $('pfSearch').value = 'TestPlayer';
    $('pfSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(700);
    const hit = window.document.querySelector('#pfResults .sr-item[data-id]');
    if (!hit) errors.push('Perfil: búsqueda sin resultados');
    else {
      hit.click(); await sleep(900);
      const t = bodyOf('pfResult');
      check(t.includes('1.000.000') || t.includes('1,000,000'), 'Perfil: fama de asesinatos renderizada', 'Perfil: falta killfame');
      check(t.includes('QA Guild') && t.includes('42'), 'Perfil: panel de gremio', 'Perfil: falta gremio');
      check(t.includes('Rival'), 'Perfil: tablas de kills/muertes', 'Perfil: faltan eventos');
      // chips de modo de kills: Mejores (topkills) y En solitario (solokills)
      const chipTop = window.document.querySelector('#pfKillChips [data-kmode="top"]');
      if (!chipTop) errors.push('Perfil: faltan chips de modo de kills');
      else {
        chipTop.click(); await sleep(500);
        check(bodyOf('pfResult').includes('TopVictim'), 'Perfil: chip «Mejores» carga topkills', 'Perfil: topkills no cargó');
        const chipSolo = window.document.querySelector('#pfKillChips [data-kmode="solo"]');
        chipSolo.click(); await sleep(500);
        check(bodyOf('pfResult').includes('SoloVictim'), 'Perfil: chip «En solitario» carga solokills', 'Perfil: solokills no cargó');
        window.document.querySelector('#pfKillChips [data-kmode="recent"]').click(); await sleep(300);
        check(bodyOf('pfResult').includes('Rival'), 'Perfil: vuelta a «Recientes» desde caché', 'Perfil: no volvió a recientes');
      }
      // top semanal del gremio
      const gbtn = $('pfGuildTopBtn');
      if (!gbtn) errors.push('Perfil: falta botón de top semanal del gremio');
      else {
        gbtn.click(); await sleep(500);
        const gbox = $('pfGuildTopBox');
        check(gbox && gbox.style.display !== 'none' && gbox.textContent.includes('GuildVictim'),
          'Perfil: top semanal del gremio renderizado', 'Perfil: top del gremio vacío → ' + (gbox ? gbox.textContent.slice(0,120) : 'sin caja'));
      }
    }
    // especializaciones → FCE y aplicación a Cocina
    const sp = window.document.querySelector('[data-spec="food"]');
    sp.value = '100'; sp.dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(100);
    const ma = window.document.querySelector('[data-mast="food"]');
    ma.value = '100'; ma.dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(200);
    const specTxt = window.document.getElementById('pfSpecList').textContent;
    check(specTxt.includes('28.000'), 'Perfil: FCE 28.000 calculado', 'Perfil: FCE incorrecto');
    const foodSpec = $('foodSpec');
    check(foodSpec && foodSpec.value === '100', 'Perfil: spec aplicada a Cocina', 'Perfil: spec no llegó a Cocina');
  } catch (e) { errors.push('Perfil: ' + e.message); }

  // ── VALIDACIÓN NUMÉRICA independiente: Granja T4 zanahoria ──
  try {
    const farm = JSON.parse(fs.readFileSync('data/farm_data.json', 'utf8'));
    const carrot = farm.find(f => f.id === 'T4_FARM_TURNIP_SEED');
    if (carrot) {
      check(carrot.grow === 79200 && carrot.product && carrot.seedBack > 0,
        `Datos granja: nabo T4 OK (grow 22h, seedBack ${carrot.seedBack})`,
        'Datos granja: nabo T4 inconsistente: ' + JSON.stringify(carrot));
    } else errors.push('Datos granja: no hay T4_FARM_TURNIP_SEED');
    const ench = JSON.parse(fs.readFileSync('data/enchant_data.json', 'utf8'));
    const bow = ench.find(e => e.id === 'T4_2H_BOW');
    check(bow && bow.u.length === 3 && bow.u[0][2] === 384,
      'Datos encantado: arco T4 = 384 fragmentos ✓', 'Datos encantado: arco T4 mal: ' + JSON.stringify(bow));
  } catch (e) { errors.push('Validación de datos: ' + e.message); }


  // ── PRECIO MANUAL: editar un precio en Cocina y verificar recálculo ──
  try {
    window.eval(`gotoTab('food')`); await sleep(300);
    // el detalle debe estar expandido para ver los inputs: asegurarlo
    if (!window.document.querySelector('#foodBody .price-edit')) {
      const crow = window.document.querySelector('#foodBody tr.craft-row');
      if (crow) { crow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(200); }
    }
    const inp = window.document.querySelector('#foodBody .price-edit');
    if (inp) {
      inp.value = '99999';
      inp.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(200);
      const mp = JSON.parse(window.localStorage.getItem('manualPrices') || '{}');
      check(Object.keys(mp).length > 0, 'Precios manuales: override guardado en localStorage', 'Precios manuales: no se guardó el override');
      // el botón ↺ debe borrar el override (regresión: estaba muerto por el guard de .price-edit-wrap)
      const rb = window.document.querySelector('#foodBody .reset-price');
      if (rb) {
        rb.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(250);
        const mp2 = JSON.parse(window.localStorage.getItem('manualPrices') || '{}');
        check(Object.values(mp2).every(v => v !== 99999),
          'Precios manuales: botón ↺ restaura el precio de la API', 'Precios manuales: ↺ no borró el override → ' + JSON.stringify(mp2));
      } else errors.push('Precios manuales: no apareció el botón ↺ tras editar');
    } else warns.push('Precios manuales: no encontré input editable en Cocina (¿detalle no expandido?)');
  } catch (e) { errors.push('Precio manual: ' + e.message); }

  // ── FÓRMULA RRR: verificación numérica independiente ──
  try {
    const rrr = b => b / (1 + b);
    const cases = [[0.18, 0.1525], [0.33, 0.2481], [0.92, 0.4792], [0.77, 0.4350]];
    const bad = cases.filter(([b, exp]) => Math.abs(rrr(b) - exp) > 0.001);
    check(bad.length === 0, 'Fórmula RRR: 4 casos de referencia OK', 'Fórmula RRR: desvíos ' + JSON.stringify(bad));
  } catch (e) { errors.push('RRR: ' + e.message); }

  // ── BOTONES GLOBALES de la barra ──
  try {
    const btns = window.document.querySelectorAll('.top-action[data-tab]');
    check(btns.length === 2, 'Barra superior: 2 botones de navegación', `Barra: ${btns.length} botones (esperaba 2)`);
    btns[0].click(); await sleep(100);
    const active = window.document.querySelector('.tab-panel.active');
    check(active && (active.id === 'tab-search' || active.id === 'tab-ledgerlog'),
      'Barra: botón global navega a su pestaña', 'Barra: botón no navegó, activa=' + (active ? active.id : 'ninguna'));
  } catch (e) { errors.push('Barra: ' + e.message); }

  // ── DATOS: todos los enchant tienen 3 niveles bien formados ──
  try {
    const ench = JSON.parse(fs.readFileSync('data/enchant_data.json', 'utf8'));
    const mal = ench.filter(e => !e.u || e.u.length !== 3 || e.u.some(x => x.length !== 3 || x[2] <= 0));
    check(mal.length === 0, `Datos encantado: ${ench.length} ítems con 3 niveles válidos`, `Datos encantado: ${mal.length} ítems malformados`);
    const farm = JSON.parse(fs.readFileSync('data/farm_data.json', 'utf8'));
    const kinds = {};
    for (const f of farm) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    check(farm.length === 109, `Datos granja: 109 farmables (${JSON.stringify(kinds)})`, `Datos granja: ${farm.length} (esperaba 109)`);
  } catch (e) { errors.push('Datos: ' + e.message); }

  finish();

  function finish() {
    console.log('\n════════ RESULTADO QA ════════');
    for (const o of oks) console.log('  ✓', o);
    for (const w of warns) console.log('  ⚠', w);
    if (errors.length) { console.log('\n  ── ERRORES ──'); for (const e of errors) console.log('  ✗', e); }
    console.log(`\n${oks.length} OK · ${warns.length} avisos · ${errors.length} errores`);
    process.exit(errors.length ? 1 : 0);
  }
})();
