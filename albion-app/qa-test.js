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
    } else if (u.includes('/gameinfo/players/qa1/kills') || u.includes('/gameinfo/players/qa1/deaths')) {
      data = [{ EventId: 1, TimeStamp: '2026-09-07T12:00:00Z', TotalVictimKillFame: 12345, numberOfParticipants: 2,
        Killer: { Name: 'TestPlayer', GuildName: 'QA Guild', AverageItemPower: 1400 },
        Victim: { Name: 'Rival', GuildName: 'Otros', AverageItemPower: 1300, Equipment: { MainHand: { Type: 'T4_MAIN_SWORD' } } } }];
    } else if (u.includes('/gameinfo/players/qa1')) {
      data = { Name: 'TestPlayer', Id: 'qa1', GuildName: 'QA Guild', GuildId: 'g9', AllianceName: '', AllianceTag: '',
        KillFame: 1000000, DeathFame: 500000, FameRatio: 2,
        LifetimeStatistics: { PvE: { Total: 99999 }, Gathering: { All: { Total: 5555 } }, Crafting: { Total: 7777 }, FishingFame: 1, FarmingFame: 2 } };
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
      check($('foodBody').querySelector('.craft-detail') !== null, 'Cocina: detalle expandido OK', 'Cocina: no se expandió el detalle'); }
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
    }
  } catch (e) { errors.push('Encantado: ' + e.message); }

  // ── GRANJA ──
  window.eval(`gotoTab('farm')`); await sleep(800);
  check(rowsIn('fmBody') > 5, `Granja: ${rowsIn('fmBody')} filas`, 'Granja: tabla vacía → ' + bodyOf('fmBody').slice(0,150));
  check(($('fmStats')?.textContent || '').length > 10, 'Granja: stats renderizadas', 'Granja: stats vacías');

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

  // ── TRANSMUTACIÓN ──
  window.eval(`gotoTab('transmute')`); await sleep(900);
  const trB = window.document.querySelector('#tab-transmute tbody');
  check(trB && trB.querySelectorAll('tr').length > 3, 'Transmutación: tabla poblada', 'Transmutación: tabla vacía');

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
    const inp = window.document.querySelector('#foodBody .price-edit');
    if (inp) {
      inp.value = '99999';
      inp.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(200);
      const mp = JSON.parse(window.localStorage.getItem('manualPrices') || '{}');
      check(Object.keys(mp).length > 0, 'Precios manuales: override guardado en localStorage', 'Precios manuales: no se guardó el override');
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
    const btns = window.document.querySelectorAll('.top-action');
    check(btns.length === 2, 'Barra superior: 2 botones globales', `Barra: ${btns.length} botones (esperaba 2)`);
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
