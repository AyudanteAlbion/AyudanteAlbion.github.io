/* Regresiones Black Market. Ejecutar: node black-market-test.js (requiere jsdom). */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const assert = require('node:assert/strict');
const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window: w } = dom;
const $ = id => w.document.getElementById(id);
const BM = 'Black Market';
const fmt = n => Math.round(n).toLocaleString('es-AR');
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; console.log('✓', message); }
const near = (a, b) => Math.abs(a - b) < 0.00001;
const hasBM = id => [...$(id).options].some(o => o.value === BM);
const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event('change', { bubbles: true })); };
const requests = [];
w.fetch = async input => {
  const url = String(input); requests.push(url);
  let data = [];
  if (url.startsWith('data/')) data = JSON.parse(fs.readFileSync(url, 'utf8'));
  else if (url.includes('/discord/config')) data = { configured: false };
  else if (url.includes('/prices/')) {
    const u = new URL(url);
    const ids = decodeURIComponent(u.pathname.split('/prices/')[1].replace(/\.json$/, '')).split(',');
    for (const id of ids) for (const city of u.searchParams.get('locations').split(',')) {
      // Ask deliberadamente inválido del BM: nunca debe usarse para comprar/vender.
      data.push({ item_id: id, city, quality: 1, sell_price_min: city === BM ? 1 : 1000,
        buy_price_max: city === BM ? 1500 : 900,
        sell_price_min_date: '2026-09-01T10:00:00', buy_price_max_date: '2026-09-09T10:00:00' });
    }
  }
  return { ok: true, json: async () => data, text: async () => 'offline' };
};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
w.HTMLElement.prototype.scrollIntoView = function () {};
// Exponer estado solo dentro del entorno de prueba; no se agrega a la app publicada.
w.eval(fs.readFileSync('app.js', 'utf8') + '\nwindow.testBM = { GEAR, EN, PS, WA };');

(async () => {
  await new Promise(resolve => setTimeout(resolve, 800));
  check(!hasBM('flipFrom') && hasBM('flipTo'), 'Flipping: BM solo como destino');
  check(!hasBM('gearBuyCity') && hasBM('gearSellCity'), 'Crafteo: BM solo como destino');
  check(!hasBM('enCity') && hasBM('enSellCity'), 'Encantado: compras y ventas separadas');
  check(['foodBuyCity', 'foodSellCity', 'refineBuyCity', 'refineSellCity', 'alchBuyCity', 'alchSellCity', 'transBuyCity', 'transSellCity', 'meldBuyCity', 'meldSellCity', 'fmCity']
    .every(id => $(id) && !hasBM(id)), 'Recursos, consumibles y granja no ofrecen BM');

  await w.loadFlipPrices(['T4_BAG']);
  check(requests.some(u => u.includes('/prices/T4_BAG.json') && new URL(u).searchParams.get('locations').includes(BM)), 'Flipping consulta precios del BM');
  const map = await w.fetchPrices(['T4_BAG'], ['Caerleon', BM]);
  check(map.T4_BAG[BM].sell === 0 && map.T4_BAG[BM].buy === 1500, 'Ignora asks del BM al cargar precios');
  change('flipFrom', 'Caerleon'); change('flipTo', BM);
  let f = w.flipCalc('T4_BAG');
  check(f.bestBuy.city === 'Caerleon' && f.bestSell.city === BM && f.bestSell.price === 1500, 'Ruta fija usa el bid del BM');
  check(near(f.profit, 440) && near(f.quick, 440), 'BM con Premium: impuesto 4%, sin publicación');
  $('flipSetup').checked = false;
  check(near(w.flipCalc('T4_BAG').profit, 440), 'La tasa de publicación no altera la venta al BM');
  $('flipPremium').checked = false;
  check(near(w.flipCalc('T4_BAG').profit, 380), 'BM sin Premium: impuesto 8%');
  $('flipSetup').checked = true; $('flipPremium').checked = true;
  w.flipSavePrefs(); $('flipTo').value = ''; w.flipRestorePrefs();
  check($('flipTo').value === BM, 'Restaura Black Market como destino guardado');
  w.showFlipDetail('T4_BAG');
  const bmRow = [...$('flipDetail').querySelectorAll('tbody tr')].find(r => r.cells[0].textContent.includes(BM));
  check(bmRow.cells[1].textContent === 'No disponible' && bmRow.cells[2].textContent === fmt(1500), 'Detalle: BM no tiene precio de compra para el jugador');
  check(bmRow.cells[4].textContent.includes('9/9/2026'), 'Detalle: fecha de la orden de compra, no del ask');
  const sellButton = [...$('flipDetail').querySelectorAll('button')].find(b => b.textContent.includes('Registrar venta'));
  sellButton.click(); // botón delegado por data-ll-* (sin onclick inline: CSP)
  check($('llType').value === 'sell' && $('llCity').value === BM && +$('llPrice').value === 1500, 'Registrar desde Flipping conserva destino y bid');
  change('llType', 'buy');
  check(!hasBM('llCity') && $('llCity').value !== BM, 'Registro: cambiar a compra elimina BM');
  change('llType', 'craft'); check(!hasBM('llCity'), 'Registro: no permite craftear en BM');
  w.llPrefill('T4_BAG', 'buy', 1, BM);
  check($('llCity').value !== BM, 'Prefill tampoco permite una compra en BM');

  const market = { Caerleon: { sell: 1000, buy: 9999 }, Lymhurst: { sell: 1500 }, [BM]: { sell: 1, buy: 1490 } };
  let r = w.marketRoute(market);
  check(r.bestSell.city === BM && near(r.profit, 430.4), 'Automático compara ganancia neta, no solo precio bruto');
  check(r.bestBuy.city !== BM && r.bestQuick.city !== r.bestBuy.city, 'Ninguna ruta compra en BM ni revende en su propio origen');
  r = w.marketRoute(market, '', 'Lymhurst');
  check(r.bestBuy.city === 'Caerleon' && near(r.profit, 402.5), 'Destino normal mantiene publicación e impuesto');
  r = w.marketRoute({ Caerleon: { sell: 1000 }, [BM]: { sell: 5000, buy: 0 } }, '', BM);
  check(r.bestSell === null && Number.isNaN(r.profit), 'Sin bid no inventa rentabilidad con el ask');
  r = w.marketRoute(market, BM);
  check(r.bestBuy === null && Number.isNaN(r.profit), 'El cálculo también rechaza BM como origen');
  const alertValue = w.waValue({ id: 'x', metric: 'flip' }, { x: market });
  check(alertValue.to === BM && near(alertValue.value, 43.04), 'Alertas de flip aplican las mismas rutas y tasas');
  change('waMetric', 'buy'); check(hasBM('waCity'), 'Alertas para vender a una orden incluyen BM');
  change('waCity', BM); change('waMetric', 'sell');
  check(!hasBM('waCity') && $('waCity').value !== BM, 'Alertas para comprar nunca ofrecen BM');
  check(w.waValue({ id: 'x', city: BM, metric: 'sell' }, { x: market }).value === null, 'Alerta guardada inválida no usa un ask del BM');
  check(w.waValue({ id: 'x', city: BM, metric: 'buy' }, { x: market }).value === 1490, 'Alerta de venta al BM usa el bid');
  const wa = w.testBM.WA;
  wa.list = [{ id: 'T4_BAG', city: BM, metric: 'buy', threshold: 1400, on: true, once: true }];
  await w.waCheck();
  check(wa.list[0].price === 1500 && wa.list[0].fired, 'Comprobación de alertas consulta BM y dispara con su bid');

  const bm = await w.fetchBM(['T4_BAG']);
  check(bm.T4_BAG.buy === 1500 && !bm.T4_BAG.sell, 'Crafteo no conserva asks del BM');
  check(new URL(requests.filter(u => u.includes('locations=Black%20Market')).at(-1)).searchParams.get('qualities') === '1', 'Crafteo compara calidad Normal, sin mezclar calidades');
  w.testBM.GEAR.bm.T4_BAG = { buy: 0, sell: 999999 };
  const c = w.gearCalc({ id: 'T4_BAG', resources: [], itemvalue: 0, focus: 0 },
    { sellBM: true, premium: true, setup: true, usageFee: 0, rrr: 0, mastery: 0, spec: 0 });
  check(c.sellPrice === 0 && Number.isNaN(c.profit), 'Crafteo sin bid no recurre a sell_price_min');

  await w.enEnsureData();
  w.testBM.EN.item = 'T4_BAG';
  change('enSellCity', BM); await w.enLoad();
  const saleInput = $('enResult').querySelector('.price-edit[data-city="Black Market"]');
  check(saleInput && +saleInput.value === 1500 && saleInput.dataset.kind === 'bm', 'Encantado: editor separado del precio de venta al BM');
  check($('enResult').textContent.includes('sin publicación') && $('enResult').textContent.includes(fmt(1440)), 'Encantado: venta neta BM sin tasa de publicación');
  saleInput.value = 2000; saleInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  check($('enResult').textContent.includes(fmt(1920)), 'Encantado recalcula el precio manual de venta');
  $('enResult').querySelector('.reset-price[data-city="Black Market"]').click();
  check(+$('enResult').querySelector('.price-edit[data-city="Black Market"]').value === 1500, 'Encantado restaura el bid de la API');
  const enSell = [...$('enResult').querySelectorAll('button')].find(b => b.textContent.includes('Registrar venta'));
  enSell.click();
  check($('llCity').value === BM && +$('llPrice').value === 1500, 'Encantado registra venta en BM, no una compra allí');
  change('enSellCity', '');
  check(!$('enResult').querySelector('.price-edit[data-city="Black Market"]'), 'Encantado puede volver a vender en la ciudad de compra');

  w.testBM.PS.item = 'T4_BAG';
  w.testBM.PS.data = [
    { city: BM, quality: 1, sell_price_min: 1, buy_price_max: 0 },
    { city: BM, quality: 2, sell_price_min: 2, buy_price_max: 1500 },
    { city: 'Caerleon', quality: 1, sell_price_min: 1000, buy_price_max: 900 },
  ];
  w.psRender('T4_BAG');
  const searchBM = [...$('psResult').querySelectorAll('tbody tr')].find(row => row.textContent.includes(BM));
  check(searchBM && searchBM.cells[2].textContent === '—', 'Buscador no ofrece compras en BM ni mezcla filas sin bid');
  check($('psResult').textContent.includes('venta más barata: ' + fmt(1000)), 'Buscador excluye BM al buscar dónde comprar barato');
  console.log(`\n${checks} comprobaciones Black Market OK`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => dom.window.close());
