/* Pruebas unitarias de los módulos extraídos de app.js.
 *
 * La QA general (qa-test.js) ejercita la app entera con jsdom y verifica que
 * la interfaz siga funcionando. Esto es lo complementario: cada módulo
 * probado solo, sin DOM ni interfaz, para que las fórmulas queden fijadas y
 * una extracción futura no pueda cambiarlas por accidente.
 *
 * Correr con: node modules-test.js
 */
const fs = require('fs');
const vm = require('vm');

const errors = [];
let ok = 0;

function check(cond, okMsg, errMsg) {
  if (cond) { ok++; console.log('  ✓', okMsg); }
  else { errors.push(errMsg); console.log('  ✗', errMsg); }
}
/* comparación con tolerancia: son cuentas con decimales */
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* Los módulos son scripts clásicos que se cuelgan de `window`. Se cargan en
   un contexto mínimo, sin DOM: si alguno empezara a depender del documento,
   esta prueba falla y avisa que dejó de ser lógica pura. */
const win = {};
win.window = win;
const ctx = vm.createContext(win);
for (const f of ['js/core/storage.js', 'js/core/format.js', 'js/market/history.js',
  'js/crafting/recipe.js', 'js/profile/specs.js', 'js/builds/build.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { AAFormat, AAMarketHistory, AACrafting, AAProfile, AABuilds } = win;

console.log('Pruebas unitarias de los módulos del frontend\n');

/* ============ core/format ============ */
console.log('— core/format —');
/* es-AR: punto como separador de miles, coma decimal */
check(AAFormat.fmt(1234.6) === '1.235', 'fmt redondea y separa miles con punto (es-AR)', 'fmt → ' + AAFormat.fmt(1234.6));
check(AAFormat.fmt(null) === '—' && AAFormat.fmt(NaN) === '—', 'fmt: sin dato → guion', 'fmt no maneja null/NaN');
check(AAFormat.pct(0.153) === '15,3%', 'pct usa coma decimal (es-AR)', 'pct → ' + AAFormat.pct(0.153));
check(AAFormat.ageBadge('0001-01-01T00:00:00') === '', 'ageBadge: fecha cero del API → vacío', 'ageBadge no filtra la fecha cero');

/* ============ crafting/recipe ============ */
console.log('\n— crafting/recipe —');
check(near(AACrafting.returnRate(0.5), 1 / 3), 'RRR = bono/(1+bono)', 'returnRate → ' + AACrafting.returnRate(0.5));
check(AACrafting.returnRate(0) === 0, 'RRR sin bono = 0', 'returnRate(0) ≠ 0');
/* espec 100 + maestría 100 = 28.000 FCE → el Foco cuesta 2^-2.8 del base */
check(AACrafting.focusEfficiency(100, 100) === 28000, 'FCE = espec×250 + maestría×30', 'FCE → ' + AACrafting.focusEfficiency(100, 100));
check(near(AACrafting.focusCost(1000, 100, 100), 1000 * Math.pow(0.5, 2.8)),
  'Foco: cada 10.000 FCE parte el costo a la mitad', 'focusCost → ' + AACrafting.focusCost(1000, 100, 100));
check(AACrafting.focusCost(1000, 0, 0) === 1000, 'Foco sin especialización = costo base', 'focusCost base ≠ 1000');
check(near(AACrafting.extraBonus(true, { on: true, value: 10 }), 0.69),
  'extras: Foco (+59%) + bono diario se suman', 'extraBonus → ' + AACrafting.extraBonus(true, { on: true, value: 10 }));
check(AACrafting.extraBonus(false, { on: false, value: 10 }) === 0,
  'extras: bono diario apagado no suma', 'extraBonus con daily apagado ≠ 0');
/* ciudad de crafteo: solo el ítem bonificado en esa ciudad recibe el especial */
check(near(AACrafting.recipeBonus({ craftCity: 'Lymhurst', bonusCity: 'Lymhurst', useFocus: false }), 0.33),
  'bono de receta: ítem bonificado en su ciudad → 33%', 'recipeBonus bonificado mal');
check(near(AACrafting.recipeBonus({ craftCity: 'Lymhurst', bonusCity: 'Bridgewatch', useFocus: false }), 0.18),
  'bono de receta: ítem sin bono en esa ciudad → 18%', 'recipeBonus no bonificado mal');
check(near(AACrafting.recipeBonus({ craftCity: '', baseBonus: 0.15, useFocus: false }), 0.15),
  'bono de receta: sin ciudad elegida manda el lugar de crafteo', 'recipeBonus sin ciudad mal');
check(near(AACrafting.taxRate(true, true), 0.065) && near(AACrafting.taxRate(false, false), 0.08),
  'impuesto: 4%+2,5% con Premium y orden; 8% sin nada', 'taxRate → ' + AACrafting.taxRate(true, true));

/* receta completa, con números redondos para poder verificarla a mano */
const price = (id) => ({ value: id === 'OUT' ? 1000 : 100, manual: false });
const recipe = { id: 'OUT', amount: 1, focus: 0, resources: [{ id: 'MAT', count: 10 }] };
const opts = { rrr: 0.2, buyCity: 'Caerleon', sellCity: 'Caerleon', useBuy: false,
  usageFee: 0, premium: true, setup: false, mastery: 0, spec: 0, useFocus: false };
const calc = AACrafting.calcRecipe(recipe, opts, price, { MAT: { itemvalue: 0 } });
check(near(calc.matCost, 800), 'materiales: 10×100 con 20% de retorno = 800', 'matCost → ' + calc.matCost);
check(near(calc.revenue, 960), 'ingreso: 1000 menos 4% de impuesto = 960', 'revenue → ' + calc.revenue);
check(near(calc.profit, 160), 'ganancia = 960 − 800 = 160', 'profit → ' + calc.profit);
check(near(calc.margin, 0.2), 'margen = ganancia / costo', 'margin → ' + calc.margin);
check(isNaN(calc.spf), 'sin Foco activo no hay plata por punto de Foco', 'spf debería ser NaN');
/* la tasa de estación cobra 11,25% del valor de ítem por cada 100 de nutrición */
const fee = AACrafting.calcRecipe(recipe, { ...opts, usageFee: 200 }, price, { MAT: { itemvalue: 100 } });
check(near(fee.stationFee, 1000 * 0.1125 * 2), 'tasa de estación: 11,25% del valor por 100 de nutrición', 'stationFee → ' + fee.stationFee);
/* sin precio de venta no se inventa una ganancia negativa */
const noSale = AACrafting.calcRecipe(recipe, opts, (id) => ({ value: id === 'OUT' ? 0 : 100 }), {});
check(isNaN(noSale.profit), 'sin precio de venta la ganancia es NaN, no un número inventado', 'profit sin venta → ' + noSale.profit);
/* material sin precio se marca: el costo mostrado sería más bajo que el real */
const noMat = AACrafting.calcRecipe(recipe, opts, (id) => ({ value: id === 'OUT' ? 1000 : 0 }), {});
check(noMat.missing === true, 'material sin precio → missing=true', 'no marcó materiales faltantes');
/* órdenes de compra sin bid: cae al precio de venta, que es lo que pagarías */
const fallback = AACrafting.materialCost([{ id: 'MAT', count: 1 }],
  { useBuy: true, buyCity: 'Caerleon', rrr: 0 },
  (id, city, kind) => ({ value: kind === 'buy' ? 0 : 250 }), {});
check(fallback.gross === 250 && fallback.missing === false,
  'órdenes de compra sin bid caen al precio de venta', 'fallback de compra → ' + JSON.stringify(fallback));

/* ============ profile/specs ============ */
console.log('\n— profile/specs —');
check(AAProfile.BRANCHES.length === 4, 'cuatro ramas de especialización', 'BRANCHES → ' + AAProfile.BRANCHES.length);
check(AAProfile.normalize('gear', { spec: 999, mastery: 999 }).spec === 120,
  'especialización se recorta a 120', 'normalize spec → ' + JSON.stringify(AAProfile.normalize('gear', { spec: 999 })));
check(AAProfile.normalize('gear', { spec: 999, mastery: 999 }).mastery === 100,
  'maestría se recorta a 100', 'normalize mastery mal');
check(AAProfile.normalize('gear', { spec: -5 }).spec === 0, 'valores negativos → 0', 'normalize negativo mal');
check(AAProfile.normalize('gear', { spec: 'abc' }).spec === 0, 'texto basura → 0', 'normalize texto mal');
check(AAProfile.normalize('rama-inventada', {}) === null, 'rama desconocida → null', 'normalize aceptó una rama inexistente');
check(near(AAProfile.focusMultiplier({ spec: 100, mastery: 100 }), Math.pow(0.5, 2.8)),
  'multiplicador de Foco coincide con la fórmula de crafteo', 'focusMultiplier → ' + AAProfile.focusMultiplier({ spec: 100, mastery: 100 }));
check(AAProfile.fameRatio({ KillFame: 100, DeathFame: 50 }) === 2, 'ratio K/D por fama', 'fameRatio → ' + AAProfile.fameRatio({ KillFame: 100, DeathFame: 50 }));
check(AAProfile.fameRatio({ KillFame: 100, DeathFame: 0 }) === null,
  'sin muertes no hay ratio (null, no Infinity)', 'fameRatio sin muertes → ' + AAProfile.fameRatio({ KillFame: 100, DeathFame: 0 }));

const members = [
  { Id: 'a', Name: 'Zeta', KillFame: 100, DeathFame: 100 },
  { Id: 'b', Name: 'alfa', KillFame: 300, DeathFame: 100 },
  { Id: 'c', Name: 'Beta', KillFame: 200, DeathFame: 0 },
];
check(AAProfile.sortMembers(members, 'kf', -1)[0].Id === 'b', 'ranking por fama de kills descendente', 'sortMembers kf mal');
check(AAProfile.sortMembers(members, 'name', 1).map(m => m.Name).join(',') === 'alfa,Beta,Zeta',
  'orden por nombre ignora mayúsculas (es)', 'sortMembers name → ' + AAProfile.sortMembers(members, 'name', 1).map(m => m.Name).join(','));
check(AAProfile.sortMembers(members, 'ratio', -1)[AAProfile.sortMembers(members, 'ratio', -1).length - 1].Id === 'c',
  'sin ratio queda último, no primero', 'sortMembers ratio mal');
check(AAProfile.sortMembers(members, 'kf', -1, 'et').length === 2,
  'el filtro busca por nombre sin distinguir mayúsculas', 'filtro de miembros mal');
const pos = AAProfile.positions(members);
check(pos.b === 1 && pos.c === 2 && pos.a === 3, 'posiciones absolutas por fama de kills', 'positions → ' + JSON.stringify(pos));
check(JSON.stringify(AAProfile.positions(members)) === JSON.stringify(pos) && members[0].Id === 'a',
  'positions no reordena el arreglo original', 'positions mutó la lista original');

/* ============ builds/build ============ */
console.log('\n— builds/build —');
const build = AABuilds.create('Prueba', 1000);
check(AABuilds.isEmpty(build), 'una build nueva arranca vacía', 'la build nueva no está vacía');
check(Object.keys(build.items).length === AABuilds.SLOTS.length, 'la build nueva tiene todos los slots', 'faltan slots');
build.items.mainHand = 'T8_MAIN_SWORD';
build.items.chest = 'T8_ARMOR_PLATE_SET1';
check(AABuilds.itemIds(build).length === 2, 'itemIds ignora los slots vacíos', 'itemIds → ' + AABuilds.itemIds(build));
const copy = AABuilds.duplicate(build, 2000);
copy.items.mainHand = 'T4_MAIN_SWORD';
check(build.items.mainHand === 'T8_MAIN_SWORD',
  'duplicar clona los slots: editar la copia no toca el original', 'la copia comparte items con el original');
check(copy.id !== build.id && copy.name.includes('copia'), 'la copia tiene identidad y nombre propios', 'duplicate → ' + JSON.stringify(copy));

const CITIES_T = ['Caerleon', 'Bridgewatch', 'Lymhurst'];
const prices = {
  T8_MAIN_SWORD: { Caerleon: { sell: 500 }, Bridgewatch: { sell: 300 }, Lymhurst: { sell: 0 },
    'Black Market': { sell: 0, buy: 1 } },
  T8_ARMOR_PLATE_SET1: { Caerleon: { sell: 200 }, Bridgewatch: { sell: 0 }, Lymhurst: { sell: 250 } },
};
const best = AABuilds.bestPrice(prices.T8_MAIN_SWORD, CITIES_T);
check(best.value === 300 && best.city === 'Bridgewatch', 'mejor precio = venta más barata entre ciudades reales', 'bestPrice → ' + JSON.stringify(best));
check(AABuilds.bestPrice(prices.T8_MAIN_SWORD, CITIES_T).city !== 'Black Market',
  'el Black Market nunca se ofrece como origen de compra', 'bestPrice ofreció el Black Market');
const costed = AABuilds.cost(build, prices, CITIES_T);
check(costed.total === 500 && costed.rows.length === 2, 'costo total = suma de los mejores precios', 'cost → ' + JSON.stringify(costed));
check(costed.missing === 0, 'sin ítems sin precio, missing=0', 'cost.missing → ' + costed.missing);
const partial = AABuilds.cost(build, { T8_MAIN_SWORD: prices.T8_MAIN_SWORD }, CITIES_T);
check(partial.missing === 1, 'un ítem sin precio se cuenta como faltante (el total quedaría bajo)', 'cost.missing parcial → ' + partial.missing);
check(AABuilds.alertThreshold(1000) === 900, 'la alerta se dispara con una baja del 10%', 'alertThreshold → ' + AABuilds.alertThreshold(1000));

/* ============ market/history ============ */
console.log('\n— market/history —');
const snap = AAMarketHistory.saveSnapshot([], 'T4_BAG',
  [{ city: 'Caerleon', quality: 1, sell_price_min: 100, buy_price_max: 90 }], 1000);
check(snap.length === 1 && snap[0].rows[0].sell === 100, 'saveSnapshot guarda la captura', 'saveSnapshot → ' + JSON.stringify(snap));
const dup = AAMarketHistory.saveSnapshot(snap, 'T4_BAG',
  [{ city: 'Caerleon', quality: 1, sell_price_min: 110 }], 1000 + 30e3);
check(dup.length === 1, 'capturas del mismo ítem a menos de 2 min se colapsan', 'saveSnapshot duplicó → ' + dup.length);
const hist = [
  { id: 'T4_BAG', ts: 1, rows: [{ city: 'Caerleon', quality: 1, sell: 100 }] },
  { id: 'T4_BAG', ts: 2, rows: [{ city: 'Caerleon', quality: 1, sell: 150 }] },
];
const tr = AAMarketHistory.trend(hist, 'T4_BAG', 1, 'Black Market');
check(tr && near(tr.change, 0.5) && tr.last === 150, 'trend calcula la variación entre extremos', 'trend → ' + JSON.stringify(tr));
check(AAMarketHistory.trend([hist[0]], 'T4_BAG', 1, 'Black Market') === null,
  'con una sola captura no hay tendencia', 'trend con un punto no devolvió null');

console.log(`\n${ok} OK · ${errors.length} errores`);
process.exit(errors.length ? 1 : 0);
