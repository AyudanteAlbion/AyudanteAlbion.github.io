#!/usr/bin/env node
/* Pruebas sin dependencias para P1–P5: módulos puros del frontend. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function loadModule(path) {
  const sandbox = { window: {}, console, URLSearchParams, Date, Math, Number, String, Object, Array, Map, Set, JSON, isFinite, parseInt, parseFloat, encodeURIComponent };
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), sandbox, { filename: path });
  return sandbox.window;
}

const win1 = loadModule('albion-app/js/market/price-freshness.js');
const F = win1.AAPriceFreshness;
const now = Date.parse('2026-09-14T18:00:00Z');
assert.strictEqual(F.validate(100, '2026-09-14T17:55:00', 15, now).ok, true, 'P1 reciente válida');
const stale = F.validate(100, '2026-09-14T17:40:00', 15, now);
assert.strictEqual(stale.ok, false, 'P1 vieja no dispara');
assert.strictEqual(stale.reason, 'stale', 'P1 vieja marcada como stale');
assert.strictEqual(F.validate(100, '', 60, now).ok, false, 'P1 timestamp ausente no dispara');
assert.strictEqual(F.validate(100, 'fecha rota', 60, now).ok, false, 'P1 timestamp inválido no dispara');
assert.strictEqual(F.validate(100, '2026-09-13T18:00:00', 'none', now).ok, true, 'P1 sin límite mantiene timestamp válido');

const win2 = loadModule('albion-app/js/market/api-history.js');
const H = win2.AAApiHistory;
const url = H.buildUrl('https://west.albion-online-data.com/api/v2/stats', 'T4_BAG@1', { city: 'Caerleon', quality: 2, days: 7, end: '2026-09-14T00:00:00Z' });
assert(url.includes('/history/T4_BAG@1.json?'), 'P2 URL de stats/history');
assert(url.includes('locations=Caerleon') && url.includes('qualities=2') && url.includes('time-scale=24'), 'P2 parámetros');
const points = H.normalize([{ location: 'Caerleon', quality: 2, data: [
  { timestamp: '2026-09-12T00:00:00', avg_price: 1000, item_count: 3 },
  { timestamp: '2026-09-13T00:00:00', avg_price: 1200, item_count: 5 },
] }], { city: 'Caerleon', quality: 2 });
assert.strictEqual(points.length, 2, 'P2 normaliza serie');
assert.strictEqual(H.coverage(points, 7).enough, true, 'P2 cobertura suficiente básica');

const win3 = loadModule('albion-app/js/ledger/analytics.js');
const L = win3.AALedger;
const oldTs = Date.parse('2026-09-10T12:00:00Z');
const migrated = L.migrateRows([{ ts: oldTs, id: 'T4_BAG', name: 'Bolsa', type: 'buy', qty: 2, price: 100 }]);
assert.strictEqual(migrated.rows[0].qty, 2, 'P3 migración conserva cantidad');
assert.strictEqual(migrated.rows[0].price, 100, 'P3 migración conserva precio');
assert.strictEqual(migrated.rows[0].ts, oldTs, 'P3 migración conserva fecha');
assert.strictEqual(migrated.rows[0].fee, 0, 'P3 operación antigua recibe comisión 0');
const rows = L.migrateRows([
  { ts: oldTs, id: 'T4_BAG', type: 'buy', qty: 2, price: 100, fee: 10, city: 'Caerleon' },
  { ts: oldTs + 1, id: 'T4_BAG', type: 'craft', qty: 1, price: 50, fee: 0, craftCost: 5, city: 'Caerleon' },
  { ts: oldTs + 2, id: 'T4_BAG', type: 'sell', qty: 2, price: 200, fee: 20, city: 'Martlock' },
]).rows;
const m = L.metrics(rows);
assert.strictEqual(m.netIncome, 380, 'P3 ingreso neto = venta - comisión');
assert.strictEqual(L.netIncome({ type: 'sell', qty: 1, price: 10, fee: 15 }), -5, 'P3 ingreso neto no se recorta si la comisión supera la venta');
assert.strictEqual(m.investment, 265, 'P3 inversión = compras/crafteo + tasas');
assert.strictEqual(m.profit, 115, 'P3 beneficio neto');
assert(Math.abs(m.roi - 115 / 265) < 1e-9, 'P3 ROI');
assert.strictEqual(m.profitPerSold, 57.5, 'P3 beneficio por unidad vendida agregado');
assert.strictEqual(L.cityGroups(rows).length, 2, 'P3 desglose por ciudad');

const win4 = loadModule('albion-app/js/losses/public-losses.js');
const P = win4.AAPublicLosses;
const ev = { EventId: 123, TimeStamp: '2026-09-14T10:00:00', Victim: {
  Equipment: { MainHand: { Type: 'T4_MAIN_SWORD', Count: 1, Quality: 2 } },
  Inventory: [{ Type: 'T4_PLANKS', Count: 12, Quality: 1 }]
} };
let merged = P.merge(P.emptyCache(), [ev, ev], Date.parse('2026-09-14T12:00:00Z'));
assert.strictEqual(merged.added, 1, 'P4 evento duplicado no suma doble');
assert.strictEqual(merged.cache.events[0].equipment.length, 1, 'P4 equipo separado');
assert.strictEqual(merged.cache.events[0].inventory.length, 1, 'P4 inventario separado');
assert.strictEqual(P.normalizeEvent({ EventId: 'zero', TimeStamp: '2026-09-14T10:00:00', Victim: { Inventory: [{ Type: 'T4_PLANKS', Count: 0 }] } }).inventory.length, 0, 'P4 no cuenta cantidades cero');
let ag = P.aggregate(merged.cache.events, { kind: 'all', quality: 'all', categoryOf: id => id.includes('PLANKS') ? 'crafting' : 'weapons', valueOf: () => 10 });
assert.strictEqual(ag.reduce((s, g) => s + g.equipmentQty, 0), 1, 'P4 cantidad equipo');
assert.strictEqual(ag.reduce((s, g) => s + g.inventoryQty, 0), 12, 'P4 cantidad inventario');
const old = { id: 'old', ts: Date.parse('2026-09-01T00:00:00Z'), equipment: [], inventory: [] };
const pruned = P.prune({ v: 1, updated: 0, events: [old, merged.cache.events[0]], processed: {} }, Date.parse('2026-09-14T12:00:00Z'));
assert.strictEqual(pruned.events.length, 1, 'P4 elimina eventos fuera de 7 días');
const oldRaw = { EventId: 'old-raw', TimeStamp: '2026-09-01T00:00:00', Victim: { Equipment: { MainHand: { Type: 'T4_MAIN_SWORD' } }, Inventory: [] } };
const oldMerge = P.merge(P.emptyCache(), [oldRaw], Date.parse('2026-09-14T12:00:00Z'));
assert.strictEqual(oldMerge.added, 0, 'P4 no cuenta como nuevo un evento fuera de ventana');

const win5 = loadModule('albion-app/js/ledger/sessions.js');
const S = win5.AASessions;

// P5: Normalización de sesiones y cálculo de duración / métricas
const sessRaw = { id: 's1', title: 'Transporte Caerleon', activity: 'Transporte', startTs: '2026-09-14T10:00:00Z', endTs: '2026-09-14T11:00:00Z', expenses: 50000, note: 'Buey T8' };
const normSess = S.normalizeSession(sessRaw);
assert.strictEqual(normSess.activity, 'transport', 'P5 normaliza actividad a clave canónica');
assert.strictEqual(normSess.expenses, 50000, 'P5 normaliza gastos operativos');

const sRows = [
  { ts: Date.parse('2026-09-14T10:10:00Z'), id: 'T4_BAG', type: 'buy', qty: 10, price: 1000, fee: 100, sessionId: 's1' },
  { ts: Date.parse('2026-09-14T10:50:00Z'), id: 'T4_BAG', type: 'sell', qty: 10, price: 1800, fee: 300, sessionId: 's1' }
];

const sMetrics = S.sessionMetrics(normSess, sRows);
assert.strictEqual(sMetrics.grossSales, 18000, 'P5 ingreso bruto ventas');
assert.strictEqual(sMetrics.netIncome, 17700, 'P5 ingreso neto ventas (18000 - 300)');
assert.strictEqual(sMetrics.operationInvestment, 10100, 'P5 inversión operativa compras (10000 + 100)');
assert.strictEqual(sMetrics.totalInvestment, 60100, 'P5 inversión total con gastos (10100 + 50000)');
assert.strictEqual(sMetrics.profit, -42400, 'P5 beneficio neto sesión');
assert.strictEqual(sMetrics.durationHours, 1, 'P5 duración 1 hora');

// P5: Sesión rentable y plata por hora
const sessProf = { id: 's2', title: 'Farmeo Nieblas', activity: 'farming', startTs: Date.parse('2026-09-14T12:00:00Z'), endTs: Date.parse('2026-09-14T14:00:00Z'), expenses: 20000 };
const sProfRows = [
  { ts: Date.parse('2026-09-14T13:00:00Z'), id: 'T7_ORE', type: 'sell', qty: 100, price: 5000, fee: 10000, sessionId: 's2' }
];
const sProfMetrics = S.sessionMetrics(sessProf, sProfRows);
assert.strictEqual(sProfMetrics.profit, 470000, 'P5 beneficio farmeo (490000 - 20000)');
assert.strictEqual(sProfMetrics.silverPerHour, 235000, 'P5 plata por hora (470000 / 2h)');
assert.strictEqual(sProfMetrics.roi > 0, true, 'P5 ROI positivo');

// P5: Resumen agregado de sesiones
const summary = S.sessionsSummary([normSess, sessProf], [...sRows, ...sProfRows]);
assert.strictEqual(summary.totalSessions, 2, 'P5 total sesiones');
assert.strictEqual(summary.totalDurationHours, 3, 'P5 duración total horas');
assert.strictEqual(summary.bestSession.sessionId, 's2', 'P5 mejor sesión detectada');

// P5: Parser de CSV robusto con delimitadores y protección anti-inyección
const csvSample = '\ufefffecha,item,tipo,cantidad,precio_unitario,comision,ciudad,nota\n' +
  '2026-09-14T10:00:00Z,T4_BAG,Compra,5,2000,50,Caerleon,"nota con coma, prueba"\n' +
  '2026-09-14T11:00:00Z,T4_BAG,Venta,5,3000,100,Martlock,=1+2\n';

const parsedCsv = S.parseTradeLogCSV(csvSample);
assert.strictEqual(parsedCsv.valid.length, 2, 'P5 parsea CSV correctamente');
assert.strictEqual(parsedCsv.valid[0].qty, 5, 'P5 cantidad parseada');
assert.strictEqual(parsedCsv.valid[0].price, 2000, 'P5 precio parseado');
assert.strictEqual(parsedCsv.valid[0].type, 'buy', 'P5 tipo compra mapeado a buy');
assert.strictEqual(parsedCsv.valid[1].type, 'sell', 'P5 tipo venta mapeado a sell');
assert.strictEqual(parsedCsv.valid[1].note, '1+2', 'P5 sanitiza fórmula inyectada en nota');

// P5: Fusión y desduplicación de filas importadas
const mergedRows = S.mergeTradeRows(sRows, parsedCsv.valid, 'append');
assert.strictEqual(mergedRows.added, 2, 'P5 agrega filas no duplicadas');
const mergedAgain = S.mergeTradeRows(mergedRows.rows, parsedCsv.valid, 'append');
assert.strictEqual(mergedAgain.added, 0, 'P5 deduplica filas idénticas');
assert.strictEqual(mergedAgain.skipped, 2, 'P5 reporta filas omitidas');

// Escritorio: AAEnvironment es la única fuente de capacidades y Wails no
// inicia heartbeat ni anti-pausa.
function loadEnvironment(hostname, withBridge, source) {
  let intervals = 0;
  const nodes = {};
  ['kaBtn', 'desktopMinimise', 'desktopMaximise', 'desktopClose', 'desktopTitlebarDrag'].forEach(id => {
    nodes[id] = { hidden: false, disabled: false, addEventListener() {}, setAttribute() {} };
  });
  const document = {
    readyState: 'complete',
    body: { classList: { add() {} } },
    getElementById: id => nodes[id] || null,
  };
  const window = {
    location: { hostname, protocol: 'http:' },
    console,
    Promise,
    fetch: () => Promise.resolve(),
    setInterval: () => { intervals += 1; return intervals; },
  };
  if (withBridge) window.go = { main: { App: {} } };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'),
    { window, document, Object, Promise }, { filename: 'environment.js' });
  return { env: window.AAEnvironment, nodes, intervals: () => intervals };
}

// El frontend del escritorio es un fork versionado (desktop/ui/), independiente
// de la web. Las mismas garantías se verifican sobre AMBAS copias: si una
// diverge y pierde una capacidad, CI lo marca en vez de dejarlo pasar.
const ENVIRONMENTS = [
  ['web', 'albion-app/js/desktop/environment.js'],
  ['escritorio', 'desktop/ui/js/desktop/environment.js'],
];

for (const [label, source] of ENVIRONMENTS) {
const desktopEnv = loadEnvironment('wails', true, source);
assert.strictEqual(desktopEnv.env.isDesktop, true, `[${label}] Escritorio detecta Wails`);
assert.strictEqual(desktopEnv.env.capabilities.antiPause, false, `[${label}] Escritorio desactiva anti-pausa`);
assert.strictEqual(desktopEnv.env.capabilities.legacyHeartbeat, false, `[${label}] Escritorio desactiva /alive`);
assert.strictEqual(desktopEnv.env.startLegacyHeartbeat(), null, `[${label}] Escritorio no crea timer de /alive`);
assert.strictEqual(desktopEnv.intervals(), 0, `[${label}] Escritorio queda sin heartbeat`);
assert.strictEqual(desktopEnv.nodes.kaBtn.hidden, true, `[${label}] Escritorio oculta anti-pausa`);

const legacyEnv = loadEnvironment('127.0.0.1', false, source);
assert.strictEqual(legacyEnv.env.isDesktop, false, `[${label}] localhost clásico no se confunde con Wails`);
assert.strictEqual(legacyEnv.env.capabilities.antiPause, true, `[${label}] Ejecutable clásico conserva anti-pausa web`);
legacyEnv.env.startLegacyHeartbeat();
assert.strictEqual(legacyEnv.intervals(), 1, `[${label}] Ejecutable clásico conserva su heartbeat`);
}

console.log('QA P1–P5 + entorno de escritorio (web + fork) OK');
