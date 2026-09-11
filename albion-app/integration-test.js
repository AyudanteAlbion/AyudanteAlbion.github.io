/* ============================================================
   Integración: app.js CON los módulos cargados
   ------------------------------------------------------------
   El resto de la suite evalúa app.js aislado, o sea siempre por
   la rama del fallback. Esta prueba arma el escenario real de
   index.html — los ocho módulos primero, app.js después — y
   compara ambos caminos.

   Cubre dos riesgos que ninguna otra prueba veía:

   1. Que app.js explote solo cuando los módulos están presentes
      (choque de nombres, doble declaración, orden de carga).
   2. Que un módulo y su fallback se separen. Hoy cada fórmula
      está escrita dos veces; si alguien corrige una sola, los
      usuarios ven un número distinto según de dónde cargue la
      app. Acá las dos ramas se ejecutan y se comparan.

   Uso: node integration-test.js
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');

const errors = [];
const oks = [];
function check(cond, okMsg, errMsg) {
  if (cond) { oks.push(okMsg); console.log('  ✓ ' + okMsg); }
  else { errors.push(errMsg); console.log('  ✗ ' + errMsg); }
}

const html = fs.readFileSync('index.html', 'utf8');
const appjs = fs.readFileSync('app.js', 'utf8');

/* Los mismos que index.html, en el mismo orden. */
const MODULES = [
  'js/core/storage.js', 'js/core/format.js', 'js/core/api.js', 'js/core/navigation.js',
  'js/market/history.js', 'js/crafting/recipe.js', 'js/profile/specs.js', 'js/builds/build.js',
];
const GLOBALS = ['AAStorage', 'AAFormat', 'AAApi', 'AANavigation',
  'AAMarketHistory', 'AACrafting', 'AAProfile', 'AABuilds'];

/* Sonda: se concatena a app.js para leer valores que son `const` de módulo
   y por lo tanto no quedan colgados de window. */
const PROBE = `
;(function () {
  window.__probe = {
    fmtMil:   fmt(1234.6),
    fmtNull:  fmt(null),
    pct:      pct(0.153),
    rr0:      returnRate(0),
    rr18:     returnRate(0.18),
    rr40:     returnRate(0.40),
    focus:    focusCost(100, 50, 20),
    focus0:   focusCost(100, 0, 0),
    ageCero:  ageBadge('0001-01-01T00:00:00'),
  };
})();`;

function boot(withModules) {
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  /* jsdom no trae estas dos; el navegador sí. Mismo polyfill que usan
     qa-test.js y smoke-test.js. */
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

  if (withModules) for (const m of MODULES) window.eval(fs.readFileSync(m, 'utf8'));
  window.eval(appjs + PROBE);
  return window;
}

console.log('Integración: app.js + módulos del frontend\n');

/* ── 1 · los módulos se cargan y publican su global ── */
console.log('— carga de módulos —');
let conMod;
try {
  conMod = boot(true);
  check(true, 'app.js evalúa sin excepción con los 8 módulos activos',
    'app.js no debería fallar con los módulos cargados');
} catch (e) {
  check(false, '', `app.js EXPLOTA con los módulos cargados: ${e.message}`);
  console.error(`\n${oks.length} OK · ${errors.length} errores`);
  process.exit(1);
}
for (const g of GLOBALS) {
  check(typeof conMod[g] === 'object' && conMod[g] !== null,
    `window.${g} disponible`, `window.${g} no quedó expuesto`);
}

/* ── 2 · app.js sigue funcionando sin los módulos ──
   La regla de migración del repo exige que los fallbacks aguanten solos. */
console.log('\n— app.js aislado (fallbacks) —');
let sinMod;
try {
  sinMod = boot(false);
  check(true, 'app.js evalúa sin excepción sin ningún módulo',
    'app.js no debería fallar aislado');
} catch (e) {
  check(false, '', `app.js aislado EXPLOTA: ${e.message}`);
}

/* ── 3 · las dos ramas dan lo mismo ──
   Es el punto de la prueba: mientras convivan módulo y fallback, tienen
   que devolver exactamente el mismo número. */
console.log('\n— módulo vs fallback: mismo resultado —');
if (sinMod) {
  const a = conMod.__probe, b = sinMod.__probe;
  for (const k of Object.keys(a)) {
    check(Object.is(a[k], b[k]), `${k}: ${JSON.stringify(a[k])} en ambas ramas`,
      `${k} DIVERGE — con módulos ${JSON.stringify(a[k])}, con fallback ${JSON.stringify(b[k])}`);
  }
}

console.log(`\n${oks.length} OK · ${errors.length} errores`);
if (errors.length) console.error('\nFallos:\n' + errors.map(e => '  - ' + e).join('\n'));

/* app.js arranca timers (el latido del ejecutable, las alertas) que jsdom
   mantiene vivos: sin cerrar las ventanas y salir a mano, el proceso nunca
   termina y en CI el job queda colgado hasta el timeout. Mismo criterio que
   qa-test.js y smoke-test.js, que también salen con process.exit. */
for (const w of [conMod, sinMod]) { try { if (w) w.close(); } catch (e) {} }
process.exit(errors.length ? 1 : 0);
