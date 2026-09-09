/* Regresiones de Granja. Ejecutar desde albion-app: node farm-test.js (jsdom). */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const assert = require('node:assert/strict');
const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true,
});
const w = dom.window;
const $ = id => w.document.getElementById(id);
let checks = 0;
const check = (ok, msg) => { assert.ok(ok, msg); checks++; console.log('✓', msg); };
const near = (a, b) => Math.abs(a - b) < 0.000001;
const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event('change', { bubbles: true })); };
w.fetch = async input => {
  const url = String(input);
  let data = [];
  if (url.startsWith('data/')) data = JSON.parse(fs.readFileSync(url, 'utf8'));
  else if (url.includes('/discord/config')) data = { configured: false };
  else if (url.includes('/prices/')) {
    const u = new URL(url);
    const ids = decodeURIComponent(u.pathname.split('/prices/')[1].replace(/\.json$/, '')).split(',');
    for (const id of ids) for (const city of u.searchParams.get('locations').split(',')) {
      data.push({ item_id: id, city, quality: 1, sell_price_min: city === 'Lymhurst' ? 200 : 100, buy_price_max: 90 });
    }
  }
  return { ok: true, json: async () => data, text: async () => 'offline' };
};
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
w.HTMLElement.prototype.scrollIntoView = function () {};
w.eval(fs.readFileSync('app.js', 'utf8') + '\nwindow.farmTestState = FM;');
const data = JSON.parse(fs.readFileSync('data/farm_data.json', 'utf8'));
const byId = Object.fromEntries(data.map(f => [f.id, f]));
const crops = ['CARROT', 'BEAN', 'WHEAT', 'TURNIP', 'CABBAGE', 'POTATO', 'CORN', 'PUMPKIN'].map((c, i) => `T${i + 1}_FARM_${c}_SEED`);
const expected = {
  Lymhurst: ['T1_FARM_CARROT_SEED', 'T8_FARM_PUMPKIN_SEED', 'T4_FARM_BURDOCK_SEED', 'T5_FARM_GOOSE_GROWN'],
  Bridgewatch: ['T2_FARM_BEAN_SEED', 'T7_FARM_CORN_SEED', 'T5_FARM_TEASEL_SEED', 'T4_FARM_GOAT_GROWN'],
  Martlock: ['T3_FARM_WHEAT_SEED', 'T6_FARM_POTATO_SEED', 'T6_FARM_FOXGLOVE_SEED', 'T8_FARM_COW_GROWN'],
  Thetford: ['T5_FARM_CABBAGE_SEED', 'T2_FARM_AGARIC_SEED', 'T7_FARM_MULLEIN_SEED'],
  'Fort Sterling': ['T4_FARM_TURNIP_SEED', 'T8_FARM_YARROW_SEED', 'T3_FARM_CHICKEN_GROWN', 'T6_FARM_SHEEP_GROWN'],
  Caerleon: ['T3_FARM_COMFREY_SEED', 'T5_FARM_TEASEL_SEED', 'T7_FARM_MULLEIN_SEED'],
  Brecilien: crops,
};
const opts = { islandCity: 'Caerleon', premium: true, focus: false };
const calc = (id, settings = {}) => w.fmCalc(byId[id], { ...opts, ...settings }, 100, 100);

(async () => {
  await new Promise(resolve => setTimeout(resolve, 800));
  await w.fmLoad();
  check(data.length === 109, 'Conserva las 109 especies del catálogo');
  for (const [city, ids] of Object.entries(expected)) {
    assert.deepEqual(data.filter(f => w.fmLocalBonus(f, city)).map(f => f.id).sort(), [...ids].sort());
    check(true, `Distribución exacta de bonos: ${city}`);
  }
  check(data.every(f => !w.fmLocalBonus(f, 'Black Market') && !w.fmLocalBonus(f, 'desconocida')), 'No aplica bonos a ciudades inválidas');
  check(data.filter(f => f.grown).every(f => Object.keys(expected).every(city => w.fmLocalBonus(f, city) === 0)), 'Ninguna cría, montura o adulto para venta recibe +10%');
  check(byId.T1_FARM_CARROT_SEED.yieldBase === 4.5 && byId.T3_FARM_CHICKEN_GROWN.yieldBase === 9, 'Rendimientos base extraídos del loot del juego');

  for (const f of data.filter(f => f.bonusCities.length)) {
    const city = f.bonusCities[0];
    const outside = Object.keys(expected).find(c => !f.bonusCities.includes(c));
    for (const premium of [false, true]) for (const focus of [false, true]) {
      const a = calc(f.id, { premium, focus, islandCity: outside });
      const b = calc(f.id, { premium, focus, islandCity: city });
      assert.ok(near(b.cropPer, a.cropPer * 1.1), `${f.id}: producción`);
      assert.ok(near(b.unit - a.unit, a.cropPer * .1 * 100 * (premium ? .96 : .92)), `${f.id}: ingreso adicional, no 10% del beneficio`);
      assert.equal(a.seedBack, b.seedBack);
      assert.equal(a.offspring, b.offspring);
      assert.equal(a.cycleDays, b.cycleDays);
    }
  }
  check(true, 'Cada producto bonificado: +10% nominal, con/sin Premium y Foco, sin alterar semillas o ciclos');
  const plain = calc(crops[0]);
  const watered = calc(crops[0], { focus: true });
  check(plain.cropPer === 9 && calc(crops[0], { premium: false }).cropPer === 4.5, 'Premium duplica la cosecha, no usa +50%');
  check(watered.cropPer === plain.cropPer && watered.seedBack === 2, 'Regar zanahoria devuelve dos semillas sin multiplicar zanahorias');
  check(near(calc(crops[0], { islandCity: 'Lymhurst' }).cropPer, 9.9), 'Zanahoria con Premium y bono local: media nominal 9,9');
  check(near(plain.daily, plain.unit * 9 / (22 / 24)), 'Diario por parcela: nueve plantas, ciclo de 22 horas');
  check(calc('T3_FARM_CHICKEN_GROWN').cropPer === 18 && calc('T3_FARM_CHICKEN_GROWN', { focus: true }).cropPer === 18, 'Productores: cosecha real por ciclo y Foco no multiplica huevos');
  const chick = calc('T3_FARM_CHICKEN_BABY', { focus: true, islandCity: 'Fort Sterling' });
  check(near(chick.offspring, 1.4) && chick.cropPer === 1 && chick.cityBonus === 0, 'Gallina: cuidados mejoran crías, no hay bono local al adulto');
  check(near(chick.cycleDays * 24, 22) && near(calc('T3_FARM_CHICKEN_BABY', { premium: false }).cycleDays * 24, 44), 'Premium reduce a la mitad el crecimiento de crías');
  check(near(calc('T4_FARM_HORSE_BABY', { focus: true }).offspring, .7867 + .1333 * 2), 'Cuidados múltiples del caballo T4 usan el máximo del juego');
  check(calc('T6_FARM_DIREWOLF_BABY', { focus: true }).offspring > 0, 'Cuidar un animal raro con retorno base cero sí mejora las crías');

  check($('fmIslandCity').options.length === 7 && $('fmCity').options.length === 7, 'Selectores independientes de isla y mercado, sin Black Market');
  const row = id => w.fmRows().find(r => r.inId === id);
  change('fmCity', 'Caerleon'); change('fmIslandCity', 'Lymhurst');
  let before = row(crops[0]);
  check(near(before.cropPer, 9.9) && before.prod === 100, 'Isla Lymhurst y precios Caerleon: bono y cotización separados');
  change('fmCity', 'Lymhurst');
  let after = row(crops[0]);
  check(after.cropPer === before.cropPer && after.prod === 200, 'Cambiar el mercado no altera el bono');
  change('fmIslandCity', 'Caerleon');
  check(row(crops[0]).cropPer === 9 && row(crops[0]).prod === 200, 'Cambiar la isla no altera el mercado');
  change('fmIslandCity', 'Lymhurst');
  const stored = JSON.parse(w.localStorage.getItem('farmPrefs'));
  check(stored.island === 'Lymhurst' && stored.market === 'Lymhurst', 'Ciudades guardadas en preferencias');
  $('fmIslandCity').value = 'Caerleon'; $('fmCity').value = 'Caerleon'; w.fmRestorePrefs();
  check($('fmIslandCity').value === 'Lymhurst' && $('fmCity').value === 'Lymhurst', 'Restaura ambas ciudades');
  w.localStorage.setItem('farmPrefs', '{'); w.fmRestorePrefs();
  check($('fmIslandCity').value === 'Lymhurst', 'Preferencias corruptas no rompen la app');
  w.localStorage.setItem('farmPrefs', JSON.stringify({ island: 'Black Market', market: 'evil' })); w.fmRestorePrefs();
  check($('fmCity').value === 'Lymhurst', 'Ignora ciudades guardadas inválidas');

  change('fmCity', 'Caerleon');
  const tableRow = $('fmBody').querySelector(`[data-rid="${crops[0]}"]`);
  check(tableRow.textContent.includes('+10% isla'), 'Identifica las filas bonificadas');
  tableRow.click();
  check($('fmBody').textContent.includes('Bono local de isla (Lymhurst)') && $('fmBody').textContent.includes('10,0%'), 'Desglose muestra el bono local');
  const input = $('fmBody').querySelector(`[data-pid="T1_CARROT"][data-kind="sell"].price-edit`);
  check(input.dataset.city === 'Caerleon', 'Edición de precios utiliza el mercado, no la isla');
  input.value = 300; input.dispatchEvent(new w.Event('change', { bubbles: true }));
  check(row(crops[0]).prod === 300 && near(row(crops[0]).cropPer, 9.9), 'Precio manual recalcula el margen sin cambiar el bono');
  $('fmBody').querySelector('.reset-price[data-pid="T1_CARROT"]').click();
  check(row(crops[0]).prod === 100, 'Restablece el precio de mercado');
  change('fmPlots', '3');
  const displayed = $('fmBody').querySelector(`[data-rid="${crops[0]}"]`).cells[6].textContent;
  check(displayed === Math.round(row(crops[0]).daily * 3).toLocaleString('es-AR'), 'Total multiplica el margen bonificado por las parcelas');
  $('fmKindChips').querySelector('[data-k="animal"]').click();
  change('fmIslandCity', 'Fort Sterling');
  check($('fmBonusInfo').textContent.includes('Huevos de gallina') && $('fmBonusInfo').textContent.includes('Leche de oveja'), 'Muestra productos animales bonificados de Fort Sterling');
  change('fmIslandCity', 'Thetford');
  check($('fmBonusInfo').textContent.includes('sin bono de huevos o leche'), 'Thetford no inventa producción de leche o huevos para cerdos');
  check($('fmStats').textContent.includes('antes de alimento'), 'Márgenes animales explicitan que no descuentan alimento');
  console.log(`\n${checks} comprobaciones de Granja OK`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => dom.window.close());
