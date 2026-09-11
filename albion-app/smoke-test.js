const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const appjs = fs.readFileSync('app.js', 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
// stubs de red: devolver promesas que nunca resuelven no sirve; devolvemos datos vacíos
window.fetch = (url) => {
  u = String(url);
  let data = [];
  try {
    if (u.includes('catalog.json')) data = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
    else if (u.includes('food_data.json')) data = JSON.parse(fs.readFileSync('data/food_data.json', 'utf8'));
    else if (u.includes('gear_data.json')) data = JSON.parse(fs.readFileSync('data/gear_data.json', 'utf8'));
    else if (u.includes('refine_data.json')) data = JSON.parse(fs.readFileSync('data/refine_data.json', 'utf8'));
    else if (u.includes('alch_data.json')) data = JSON.parse(fs.readFileSync('data/alch_data.json', 'utf8'));
    else if (u.includes('transmute_data.json')) data = JSON.parse(fs.readFileSync('data/transmute_data.json', 'utf8'));
    else if (u.includes('meld_data.json')) data = JSON.parse(fs.readFileSync('data/meld_data.json', 'utf8'));
    else if (u.includes('enchant_data.json')) data = JSON.parse(fs.readFileSync('data/enchant_data.json', 'utf8'));
    else if (u.includes('farm_data.json')) data = JSON.parse(fs.readFileSync('data/farm_data.json', 'utf8'));
  } catch (e) { /* API externa: lista vacía */ }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
};
window.onerror = (msg, src, line) => { errors.push(`window.onerror: ${msg} (línea ${line})`); };
window.alert = () => {};
window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
window.scrollTo = () => {};
window.localStorage.clear();

try {
  window.eval(appjs);
  console.log('✓ app.js evaluado sin excepciones de carga');
} catch (e) {
  errors.push('EXCEPCIÓN al evaluar app.js: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0,4).join('\n'));
}

// esperar promesas pendientes (carga del catálogo, datos)
setTimeout(() => {
  // recorrer todas las pestañas
  const tabs = ['home','gear','refine','alch','food','enchant','farm','flip','transmute','meld','alerts','search','ledgerlog','profile','sg','formulas'];
  for (const t of tabs) {
    try {
      window.eval(`gotoTab('${t}')`);
      const panel = window.document.getElementById('tab-' + t);
      if (!panel) errors.push(`pestaña ${t}: no existe #tab-${t}`);
      else if (!panel.classList.contains('active')) errors.push(`pestaña ${t}: no se activó`);
    } catch (e) {
      errors.push(`pestaña ${t}: EXCEPCIÓN ${e.message}`);
    }
  }
  // probar el prefill del registro
  try {
    window.eval(`llPrefill('T4_BAG','buy',1234,'Martlock')`);
    const v = window.document.getElementById('llPrice').value;
    if (v !== '1234') errors.push('llPrefill: precio no precargado, valor=' + v);
    else console.log('✓ llPrefill funciona (precio precargado: ' + v + ')');
  } catch (e) { errors.push('llPrefill: EXCEPCIÓN ' + e.message); }
  // probar alta en el registro
  try {
    window.eval(`document.getElementById('llQty').value='3'; document.getElementById('llAdd').click();`);
    const rows = JSON.parse(window.localStorage.getItem('tradeLog') || '[]');
    if (rows.length === 1 && rows[0].qty === 3) console.log('✓ Registro: alta de operación OK');
    else errors.push('Registro: no se guardó la fila, rows=' + JSON.stringify(rows));
  } catch (e) { errors.push('Registro alta: EXCEPCIÓN ' + e.message); }

  setTimeout(() => {
    if (errors.length) { console.log('\n=== ERRORES ==='); errors.forEach(e => console.log('✗', e)); process.exit(1); }
    console.log('\n✅ PRUEBA DE HUMO COMPLETA SIN ERRORES');
    process.exit(0);
  }, 1500);
}, 1500);

