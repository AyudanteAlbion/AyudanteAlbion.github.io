/* Ayudante Albion — cálculo de crafteo (etapa 6 de la modularización).
 *
 * Acá vive SOLO la aritmética de una receta: bonos, tasa de retorno, costo de
 * Foco, impuestos y ganancia. Nada de DOM, nada de `fetch`, nada de estado
 * global: quien llama pasa las opciones ya leídas de la interfaz y una
 * función `price(id, city, kind)` que resuelve el precio efectivo (manual o
 * de la API). Así las fórmulas se pueden verificar solas y el día que
 * cambien las tasas del juego se toca un archivo, no cinco pantallas.
 *
 * Se expone como script clásico (window.AACrafting) mientras dura la
 * migración incremental de app.js.
 */
(function (root) {
  'use strict';

  /* Tasa de retorno de recursos: RRR = bono / (1 + bono).
     El bono se declara sobre el material consumido, así que la fracción que
     efectivamente vuelve es esa, no el bono a secas. */
  function returnRate(bonus) {
    return bonus / (1 + bonus);
  }

  /* Costo real de Foco. La eficiencia (FCE) suma especialización ×250 y
     maestría ×30; cada 10.000 FCE parten el costo a la mitad. */
  function focusEfficiency(mastery, spec) {
    return (spec || 0) * 250 + (mastery || 0) * 30;
  }

  function focusCost(baseFocus, mastery, spec) {
    return baseFocus * Math.pow(0.5, focusEfficiency(mastery, spec) / 10000);
  }

  /* Extras que se apilan sobre el bono del lugar: Foco (+59%) y el bono
     diario de la categoría, si hoy está activo. */
  function extraBonus(useFocus, daily) {
    daily = daily || {};
    return (useFocus ? 0.59 : 0) + (daily.on ? (daily.value || 0) / 100 : 0);
  }

  /* Bono del lugar de crafteo (ciudad, hideout con su porcentaje propio…)
     más los extras. Es el bono "general", sin ciudad de especialización. */
  function placeBonus(base, useFocus, daily) {
    return (base || 0) + extraBonus(useFocus, daily);
  }

  /* Bono de UNA receta. Con ciudad de crafteo elegida, solo los ítems
     bonificados en esa ciudad reciben el bono especial (0,33 por defecto);
     el resto usa el de ciudad real (+18%). Sin ciudad, gana el lugar. */
  function recipeBonus(opts) {
    opts = opts || {};
    var extras = extraBonus(opts.useFocus, opts.daily);
    if (!opts.craftCity) return (opts.baseBonus || 0) + extras;
    var special = opts.specialBonus == null ? 0.33 : opts.specialBonus;
    return (opts.bonusCity === opts.craftCity ? special : 0.18) + extras;
  }

  /* Impuesto de venta: 4% con Premium, 8% sin él, más 2,5% si se publica
     como orden de venta en lugar de vender al instante. */
  function taxRate(premium, setupFee) {
    return (premium ? 0.04 : 0.08) + (setupFee ? 0.025 : 0);
  }

  /* Costo de los materiales de una receta, ya descontada la tasa de retorno.
     `price(id, city, kind)` debe devolver {value, manual}; si no hay precio
     de compra y se pidieron órdenes de compra, se cae al de venta (es lo que
     realmente pagarías). `itemValue` acumula el valor nominal para la tasa
     de estación. */
  function materialCost(resources, opts, price, ingredients) {
    resources = resources || [];
    ingredients = ingredients || {};
    var kind = opts.useBuy ? 'buy' : 'sell';
    var gross = 0, itemValue = 0, missing = false;
    for (var i = 0; i < resources.length; i++) {
      var res = resources[i];
      var ep = price(res.id, opts.buyCity, kind) || { value: 0 };
      if (!ep.value && opts.useBuy) ep = price(res.id, opts.buyCity, 'sell') || { value: 0 };
      if (!ep.value) missing = true;
      gross += (ep.value || 0) * res.count;
      itemValue += ((ingredients[res.id] || {}).itemvalue || 0) * res.count;
    }
    return {
      gross: gross,
      net: gross * (1 - (opts.rrr || 0)),
      itemValue: itemValue,
      missing: missing,
    };
  }

  /* Tasa de la estación de crafteo: 11,25% del valor de ítem por cada 100
     de nutrición cobrada. */
  function stationFee(itemValue, usageFee) {
    return itemValue * 0.1125 * ((usageFee || 0) / 100);
  }

  /* Cálculo completo de una receta.
   *   recipe: { id, amount, focus, resources: [{id, count}] }
   *   opts:   { rrr, buyCity, sellCity, useBuy, usageFee, premium, setup,
   *             mastery, spec, useFocus }
   *   price:  (id, city, kind) => { value, manual }
   * Devuelve los mismos campos que usaba app.js, para que el render no
   * tenga que cambiar junto con la extracción. */
  function calcRecipe(recipe, opts, price, ingredients) {
    var mats = materialCost(recipe.resources, opts, price, ingredients);
    var fee = stationFee(mats.itemValue, opts.usageFee);
    var sellEp = price(recipe.id, opts.sellCity, 'sell') || { value: 0 };
    var sellPrice = sellEp.value || 0;
    var tax = taxRate(opts.premium, opts.setup);
    var revenue = recipe.amount * sellPrice * (1 - tax);
    var totalCost = mats.net + fee;
    var profit = sellPrice ? revenue - totalCost : NaN;
    var margin = sellPrice && totalCost > 0 ? profit / totalCost : NaN;
    var realFocus = focusCost(recipe.focus, opts.mastery, opts.spec);
    return {
      matCost: mats.net,
      stationFee: fee,
      totalCost: totalCost,
      sellPrice: sellPrice,
      sellManual: !!sellEp.manual,
      revenue: revenue,
      profit: profit,
      margin: margin,
      realFocus: realFocus,
      /* plata por punto de Foco: solo tiene sentido si se está usando */
      spf: opts.useFocus && realFocus > 0 ? profit / realFocus : NaN,
      missing: mats.missing,
      taxRate: tax,
    };
  }

  root.AACrafting = Object.freeze({
    returnRate: returnRate,
    focusEfficiency: focusEfficiency,
    focusCost: focusCost,
    extraBonus: extraBonus,
    placeBonus: placeBonus,
    recipeBonus: recipeBonus,
    taxRate: taxRate,
    materialCost: materialCost,
    stationFee: stationFee,
    calcRecipe: calcRecipe,
  });
}(window));
