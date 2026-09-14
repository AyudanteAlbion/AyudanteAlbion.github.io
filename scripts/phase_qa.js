#!/usr/bin/env node
/* Pruebas sin dependencias para P1–P4: módulos puros del frontend. */
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

console.log('QA P1–P4 OK');
