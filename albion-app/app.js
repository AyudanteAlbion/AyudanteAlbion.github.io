/* ===== Ayudante Albion — servidor Americas (West) ===== */
const API = 'https://west.albion-online-data.com/api/v2/stats';
const ICON = id => `https://render.albiononline.com/v1/item/${id}.png?size=64`;
// Íconos locales (carpeta icons/): carga instantánea, sin depender del servicio de render.
// Solo ítems base: los encantados (@1..@4) tienen ícono propio y van al servicio remoto.
const ICON_LOCAL = id => id.includes('@') ? null : `icons/${id}.png`;

/* Cadena de carga: ícono local → servicio de render (con reintentos por los 502
   intermitentes) → placeholder. */
const IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="%231d2129"/><text x="32" y="40" font-size="26" text-anchor="middle" fill="%238b93a3">?</text></svg>'
).replace(/%25/g, '%');
window.imgRetry = function (img) {
  if (img.dataset.local === '1') {
    // No existe el ícono local: pasar al servicio de render remoto
    img.dataset.local = '0';
    img.src = img.dataset.base;
    return;
  }
  const tries = +(img.dataset.tries || 0);
  if (tries < 6) {
    img.dataset.tries = tries + 1;
    // Espera exponencial (0,5s→16s) + jitter aleatorio para desincronizar
    // las ráfagas: el servicio de render devuelve 502 transitorios bajo carga.
    const delay = 500 * Math.pow(2, tries) + Math.random() * 400;
    setTimeout(() => { img.src = img.dataset.base + '&r=' + Date.now(); }, delay);
  } else {
    img.onerror = null;
    img.src = IMG_PLACEHOLDER;
  }
};
function iconImg(id, cls, title) {
  const local = ICON_LOCAL(id);
  const src = local || ICON(id);
  return `<img class="${cls}" loading="lazy" src="${src}" data-local="${local ? 1 : 0}" data-base="${ICON(id)}" onerror="imgRetry(this)" alt=""${title ? ` title="${title}"` : ''}>`;
}
const CITIES = ['Bridgewatch','Caerleon','Fort Sterling','Lymhurst','Martlock','Thetford','Brecilien'];
const fmt = n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('es-AR');
const pct = n => n == null || isNaN(n) ? '—' : (n * 100).toFixed(1).replace('.', ',') + '%';

let CATALOG = null; // [[id, es, en, tier, maxEnch, cat], ...]

/* ---------- helpers ---------- */
// timeout: si la API queda colgada, el botón de actualizar no queda inutilizado para siempre
async function fetchJSON(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('tiempo de espera agotado');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Pedir precios en bloques (límite de longitud de URL + rate limit)
async function fetchPrices(itemIds, locations) {
  const out = {};
  const chunks = [];
  let cur = [];
  for (const id of itemIds) {
    cur.push(id);
    if (cur.join(',').length > 3500) { chunks.push(cur); cur = []; }
  }
  if (cur.length) chunks.push(cur);
  for (const chunk of chunks) {
    const url = `${API}/prices/${chunk.join(',')}.json?locations=${locations.join(',')}&qualities=1`;
    const data = await fetchJSON(url);
    for (const row of data) {
      const id = row.item_id;
      (out[id] = out[id] || {})[row.city] = {
        sell: row.sell_price_min || 0,
        sellDate: row.sell_price_min_date,
        buy: row.buy_price_max || 0,
        buyDate: row.buy_price_max_date,
      };
    }
  }
  return out;
}

/* ---------- fórmulas ---------- */
// RRR = bono / (1 + bono)
function returnRate(bonus) { return bonus / (1 + bonus); }
// FCE: espec ×250 + maestría ×30 ; cada 10.000 FCE reduce el focus a la mitad
function focusCost(baseFocus, mastery, spec) {
  const fce = spec * 250 + mastery * 30;
  return baseFocus * Math.pow(0.5, fce / 10000);
}

function ageBadge(dateStr) {
  if (!dateStr || dateStr.startsWith('0001')) return '';
  const h = (Date.now() - new Date(dateStr + 'Z').getTime()) / 3.6e6;
  if (h < 1) return `<span class="price-sub">hace ${Math.max(1, Math.round(h * 60))} min</span>`;
  if (h < 48) return `<span class="price-sub">hace ${Math.round(h)} h</span>`;
  return `<span class="price-sub">hace ${Math.round(h / 24)} días</span>`;
}

/* ---------- precios manuales (compartidos entre pestañas) ---------- */
let manualPrices = {};
try { manualPrices = JSON.parse(localStorage.getItem('manualPrices') || '{}'); } catch (e) {}
function saveManual() { localStorage.setItem('manualPrices', JSON.stringify(manualPrices)); }
function mpKey(id, city, kind) { return `${id}|${city}|${kind}`; }

/* ---------- pestañas ---------- */
// Grupos de pestañas por dropdown: su trigger se marca activo cuando la actual es una de sus herramientas
const DD_GROUPS = [
  { dd: 'craftDd', btn: 'craftDdBtn', keys: ['gear', 'refine', 'alch', 'food', 'enchant', 'farm'] },
  { dd: 'flipDd', btn: 'flipDdBtn', keys: ['flip', 'transmute', 'meld', 'alerts'] },
];
function gotoTab(key) {
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
  document.querySelectorAll('.dd-item').forEach(i => i.classList.toggle('active', i.dataset.tab === key));
  document.querySelectorAll('.top-action').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  for (const g of DD_GROUPS) {
    document.getElementById(g.btn).classList.toggle('active', g.keys.includes(key));
  }
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + key));
  const mod = craftModules[key];
  if (mod && !mod.loadedOnce) mod.loadPrices();
  if (key === 'sg') twCheckAll(); // refresca EN VIVO/OFFLINE al entrar a la pestaña
  window.scrollTo({ top: 0 });
}
document.getElementById('mainTabs').addEventListener('click', e => {
  const dd = e.target.closest('.dd-item');
  if (dd) { gotoTab(dd.dataset.tab); closeAllDd(); return; }
  const trigger = e.target.closest('.dd-trigger');
  if (trigger) { toggleDd(trigger.closest('.tab-dd')); return; }
  const btn = e.target.closest('.tab[data-tab]'); if (!btn) return;
  closeAllDd();
  gotoTab(btn.dataset.tab);
});

/* ---- dropdowns: hover en escritorio, clic/tap como respaldo ---- */
const ddTimers = new Map();
function openDd(dd) {
  clearTimeout(ddTimers.get(dd));
  closeAllDd(dd); // solo un menú abierto a la vez
  dd.classList.add('open');
  document.getElementById('mainTabs').classList.add('dd-open');
  dd.querySelector('.dd-trigger').setAttribute('aria-expanded', 'true');
}
function closeDd(dd) {
  dd.classList.remove('open');
  dd.querySelector('.dd-trigger').setAttribute('aria-expanded', 'false');
  if (!document.querySelector('.tab-dd.open')) {
    document.getElementById('mainTabs').classList.remove('dd-open');
  }
}
function closeAllDd(except) {
  document.querySelectorAll('.tab-dd').forEach(dd => { if (dd !== except) closeDd(dd); });
}
function toggleDd(dd) {
  dd.classList.contains('open') ? closeDd(dd) : openDd(dd);
}
// Hover solo cuando hay puntero fino (mouse); en táctil se usa el clic
if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  document.querySelectorAll('.tab-dd').forEach(dd => {
    dd.addEventListener('mouseenter', () => openDd(dd));
    dd.addEventListener('mouseleave', () => {
      // pequeño retraso para tolerar salidas accidentales del puntero
      ddTimers.set(dd, setTimeout(() => closeDd(dd), 120));
    });
  });
}
document.addEventListener('click', e => {
  if (!e.target.closest('.tab-dd')) closeAllDd();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllDd(); });
// Accesos directos de la página de inicio
document.getElementById('tab-home').addEventListener('click', e => {
  const card = e.target.closest('[data-goto]'); if (!card) return;
  gotoTab(card.dataset.goto);
});

/* ====================================================================
   FAVORITOS — marcá recetas/ítems con ★ y velos juntos en Inicio
   ==================================================================== */
const FAV = { list: [] };
try { FAV.list = JSON.parse(localStorage.getItem('favorites') || '[]'); } catch (e) {}
const FAV_TABS = { food: 'Cocina', alch: 'Alquimia', refine: 'Refinamiento', gear: 'Crafteo', enchant: 'Encantado', farm: 'Granja', flip: 'Flipping', transmute: 'Transmutación' };
function favSave() { localStorage.setItem('favorites', JSON.stringify(FAV.list)); favRenderHome(); }
function favHas(tab, id) { return FAV.list.some(f => f.tab === tab && f.id === id); }
function favBtnHtml(tab, id, name) {
  const on = favHas(tab, id);
  return `<button class="btn micro-btn fav-btn ${on ? 'on' : ''}" data-fav-tab="${tab}" data-fav-id="${id}" data-fav-name="${String(name || id).replace(/"/g, '&quot;')}" title="${on ? 'Quitar de favoritos' : 'Guardar en favoritos (aparece en Inicio)'}">${on ? '★ Favorito' : '☆ Favorito'}</button>`;
}
function favRenderHome() {
  const box = document.getElementById('homeFavs');
  if (!box) return;
  if (!FAV.list.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  document.getElementById('homeFavList').innerHTML = FAV.list.map(f => `
    <div class="fav-row" data-fav-goto="${f.tab}" title="Ir a ${FAV_TABS[f.tab] || f.tab}">
      ${iconImg(f.id, 'item-icon sm')}
      <div class="fav-info"><div class="n">${f.name}</div><div class="m">${FAV_TABS[f.tab] || f.tab}</div></div>
      <button class="fav-del" data-fav-del="${f.tab}|${f.id}" title="Quitar de favoritos">✕</button>
    </div>`).join('');
}
document.addEventListener('click', e => {
  const star = e.target.closest('.fav-btn');
  if (star) {
    const tab = star.dataset.favTab, id = star.dataset.favId;
    if (favHas(tab, id)) FAV.list = FAV.list.filter(f => !(f.tab === tab && f.id === id));
    else FAV.list.push({ tab, id, name: star.dataset.favName || id, ts: Date.now() });
    favSave();
    const on = favHas(tab, id);
    star.classList.toggle('on', on);
    star.textContent = on ? '★ Favorito' : '☆ Favorito';
    star.title = on ? 'Quitar de favoritos' : 'Guardar en favoritos (aparece en Inicio)';
    return;
  }
  const del = e.target.closest('[data-fav-del]');
  if (del) {
    const [tab, id] = del.dataset.favDel.split('|');
    FAV.list = FAV.list.filter(f => !(f.tab === tab && f.id === id));
    favSave();
    return;
  }
  const go = e.target.closest('[data-fav-goto]');
  if (go) gotoTab(go.dataset.favGoto);
});
favRenderHome();

/* ====================================================================
   MOTOR DE CRAFTEO — una instancia por pestaña (Cocina, Alquimia)
   ==================================================================== */
const craftModules = {};

function createCraftModule(cfg) {
  // cfg: { key, title, intro, dataUrl, defaultCity, bonusCityNote, searchPlaceholder }
  const P = cfg.key; // prefijo de ids del DOM
  const root = document.querySelector(`#tab-${cfg.key}`);

  const m = {
    cfg,
    DATA: null,
    prices: {},
    rows: [],
    sortKey: 'profit',
    sortDir: -1,
    tierFilter: 'all',
    enchFilter: 'all',
    catFilter: 'all',
    expandedRecipe: null,
    loadedOnce: false,
  };
  craftModules[cfg.key] = m;

  /* ---- plantilla del panel ---- */
  root.innerHTML = `
  ${cfg.cityGuide ? `
  <div class="panel city-guide">
    <div class="cg-head">
      <div class="cd-title">Bonos de refinamiento por ciudad</div>
      <div class="micro muted">Cada ciudad se especializa en un recurso: +40% además del +18% base → 58% de bono (RRR 36,7%; con Foco 53,9%). Hacé clic en una ciudad para configurarla.</div>
    </div>
    <div class="cg-grid">
      ${cfg.cityGuide.map(g => `
        <button class="cg-card" data-city="${g.city}" data-cat="${g.cat}" title="Configurar ${g.city} y filtrar ${g.label}">
          ${iconImg(g.icon, 'item-icon')}
          <div class="cg-info">
            <div class="cg-city">${g.city}</div>
            <div class="cg-res">${g.label} <span class="cg-bonus">+40%</span></div>
          </div>
        </button>`).join('')}
    </div>
  </div>` : ''}
  <div class="panel controls">
    <div class="control-grid">
      <div class="control">
        <label>Comprar materiales en</label>
        <select id="${P}BuyCity"></select>
      </div>
      <div class="control">
        <label>Vender producto en</label>
        <select id="${P}SellCity"></select>
      </div>
      <div class="control">
        <label>Lugar de crafteo</label>
        <select id="${P}CraftPlace">
          ${cfg.placeOptions.map(([v, label, sel]) => `<option value="${v}"${sel ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="control" id="${P}HideoutBonusWrap" style="display:none">
        <label>Bono del hideout (%)</label>
        <input type="number" id="${P}HideoutBonus" value="28" min="0" max="80" step="1">
      </div>
      <div class="control">
        <label>Ciudad de crafteo</label>
        <select id="${P}CraftCity">
          <option value="">— sin ciudad (usa lugar de crafteo)</option>
          ${(cfg.cityChoices || CITIES).map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        ${cfg.cityChoices ? '' : '<div class="micro muted">El bono especial se aplica solo a los ítems bonificados en esa ciudad; el resto usa ciudad real (+18%)</div>'}
      </div>
      <div class="control">
        <label>Bono diario (${cfg.dailyLabel})</label>
        <div class="daily-bonus-row">
          <label class="check" title="Activalo solo si hoy esta categoría aparece con bono diario en el juego">
            <input type="checkbox" id="${P}DailyBonusOn">
          </label>
          <input type="number" id="${P}DailyBonusVal" value="10" min="0" max="50" step="1" disabled title="Porcentaje del bono diario">
          <span class="muted micro">%</span>
        </div>
      </div>
      <div class="control">
        <label>Tasa de uso (por 100 nutrición)</label>
        <input type="number" id="${P}UsageFee" value="200" min="0" step="10">
      </div>
      <div class="control toggles">
        <label class="check"><input type="checkbox" id="${P}UseFocus"> Usar Foco (+59%)</label>
        <label class="check"><input type="checkbox" id="${P}Premium" checked> Premium (impuesto 4%)</label>
        <label class="check"><input type="checkbox" id="${P}SetupFee" checked> Orden de venta (+2,5%)</label>
        <label class="check"><input type="checkbox" id="${P}UseBuyOrders"> Materiales con órdenes de compra</label>
      </div>
    </div>

    <div class="control-grid secondary">
      <div class="control">
        <label>Maestría (${cfg.masteryLabel})</label>
        <input type="number" id="${P}Mastery" value="0" min="0" max="100">
      </div>
      <div class="control">
        <label>Especialización (ítem)</label>
        <input type="number" id="${P}Spec" value="0" min="0" max="120">
      </div>
      <div class="control rrr-display">
        <label>Tasa de retorno efectiva</label>
        <div class="rrr-value" id="${P}RrrValue"><span class="rrr-part"><span class="rrr-num">15,3%</span><span class="rrr-cap">todos los ítems</span></span></div>
        <div class="micro muted" id="${P}RrrSub"></div>
      </div>
      <div class="control">
        <button class="btn primary" id="${P}Refresh">↻ Actualizar precios</button>
        <div class="micro muted" id="${P}Updated"></div>
      </div>
    </div>
  </div>

  <div class="panel filters">
    <input type="search" id="${P}Search" placeholder="${cfg.searchPlaceholder}" class="search">
    <div class="chip-group" id="${P}TierChips">
      <button class="chip active" data-tier="all">Todos</button>
      ${cfg.tiers.map(t => `<button class="chip" data-tier="${t}">T${t}</button>`).join('')}
    </div>
    <div class="chip-group" id="${P}EnchChips">
      <button class="chip active" data-ench="all">Todos</button>
      ${(cfg.enchLevels || [0,1,2,3]).map(l => `<button class="chip" data-ench="${l}">.${l}</button>`).join('')}
    </div>
    ${cfg.cats ? `<div class="chip-group" id="${P}CatChips">
      <button class="chip active" data-cat="all">Todas</button>
      ${cfg.cats.map(([k, label]) => `<button class="chip" data-cat="${k}">${label}</button>`).join('')}
    </div>` : ''}
    <label class="check small"><input type="checkbox" id="${P}OnlyProfitable"> Solo rentables</label>
  </div>

  <div class="stat-row" id="${P}Stats"></div>

  <div class="panel table-wrap">
    <table class="ledger" id="${P}Table">
      <thead>
        <tr>
          <th class="sortable" data-sort="name">Ítem</th>
          <th>Ingredientes</th>
          <th class="num sortable" data-sort="cost">Costo</th>
          <th class="num sortable" data-sort="sell">Venta</th>
          <th class="num sortable" data-sort="profit">Ganancia ↓</th>
          <th class="num sortable" data-sort="margin">Margen</th>
          <th class="num sortable" data-sort="spf">Plata/Foco</th>
        </tr>
      </thead>
      <tbody id="${P}Body">
        <tr><td colspan="7" class="loading-cell">Cargando precios del mercado…</td></tr>
      </tbody>
    </table>
  </div>`;

  const $ = id => document.getElementById(P + id);
  const buySel = $('BuyCity'), sellSel = $('SellCity');
  for (const c of CITIES) { buySel.add(new Option(c, c)); sellSel.add(new Option(c, c)); }
  buySel.value = cfg.defaultCity; sellSel.value = cfg.defaultCity;

  /* ---- estado del bono diario (persistente por pestaña) ---- */
  const dailyOn = $('DailyBonusOn'), dailyVal = $('DailyBonusVal');
  try {
    const saved = JSON.parse(localStorage.getItem('dailyBonus_' + P) || 'null');
    if (saved) { dailyOn.checked = !!saved.on; dailyVal.value = saved.val ?? 10; }
  } catch (e) {}
  dailyVal.disabled = !dailyOn.checked;
  function saveDaily() {
    localStorage.setItem('dailyBonus_' + P, JSON.stringify({ on: dailyOn.checked, val: parseFloat(dailyVal.value) || 0 }));
  }
  dailyOn.addEventListener('change', () => { dailyVal.disabled = !dailyOn.checked; saveDaily(); m.render(); });
  dailyVal.addEventListener('input', saveDaily);

  /* ---- opciones actuales ---- */
  function getPlaceBonus() {
    const v = $('CraftPlace').value;
    let bonus = v === 'hideout' ? (parseFloat($('HideoutBonus').value) || 0) / 100 : parseFloat(v);
    if (dailyOn.checked) bonus += (parseFloat(dailyVal.value) || 0) / 100;
    return bonus;
  }
  // Extra que se suma al stack (bono diario + Foco)
  function extraBonus(useFocus) {
    return (useFocus ? 0.59 : 0) + (dailyOn.checked ? (parseFloat(dailyVal.value) || 0) / 100 : 0);
  }
  // Bono por receta: si hay Ciudad de crafteo elegida, solo los ítems
  // bonificados en esa ciudad reciben el bono especial; el resto, ciudad real (+18%)
  function bonusFor(r, useFocus) {
    const cc = $('CraftCity').value;
    if (!cc) return getPlaceBonus() + (useFocus ? 0.59 : 0);
    const bCity = cfg.bonusCityOf ? cfg.bonusCityOf(r) : null;
    return (bCity === cc ? (cfg.specialBonus ?? 0.33) : 0.18) + extraBonus(useFocus);
  }
  function getOpts() {
    const useFocus = $('UseFocus').checked;
    return {
      craftCity: $('CraftCity').value,
      rrrFor: r => returnRate(bonusFor(r, useFocus)),
      rrr: returnRate(getPlaceBonus() + (useFocus ? 0.59 : 0)),
      buyCity: buySel.value,
      sellCity: sellSel.value,
      usageFee: parseFloat($('UsageFee').value) || 0,
      premium: $('Premium').checked,
      setup: $('SetupFee').checked,
      useBuy: $('UseBuyOrders').checked,
      mastery: parseFloat($('Mastery').value) || 0,
      spec: parseFloat($('Spec').value) || 0,
      useFocus,
    };
  }

  // Precio efectivo: manual pisa API
  function effPrice(id, city, kind) {
    const k = mpKey(id, city, kind);
    if (k in manualPrices) return { value: manualPrices[k], manual: true };
    const p = m.prices[id]?.[city];
    return { value: (kind === 'buy' ? p?.buy : p?.sell) || 0, manual: false };
  }

  function calcRecipe(r, opts) {
    let matCost = 0, itemValue = 0, missing = false;
    const rrr = opts.rrrFor ? opts.rrrFor(r) : opts.rrr;
    for (const res of r.resources) {
      const kind = opts.useBuy ? 'buy' : 'sell';
      let ep = effPrice(res.id, opts.buyCity, kind);
      if (!ep.value && opts.useBuy) ep = effPrice(res.id, opts.buyCity, 'sell');
      if (!ep.value) missing = true;
      matCost += ep.value * res.count;
      itemValue += (m.DATA.ingredients[res.id]?.itemvalue || 0) * res.count;
    }
    matCost *= (1 - rrr);
    const stationFee = itemValue * 0.1125 * (opts.usageFee / 100);
    const spE = effPrice(r.id, opts.sellCity, 'sell');
    const sellPrice = spE.value, sellManual = spE.manual;
    const sellDate = m.prices[r.id]?.[opts.sellCity]?.sellDate;
    const taxRate = (opts.premium ? 0.04 : 0.08) + (opts.setup ? 0.025 : 0);
    const revenue = r.amount * sellPrice * (1 - taxRate);
    const totalCost = matCost + stationFee;
    const profit = sellPrice ? revenue - totalCost : NaN;
    const margin = sellPrice && totalCost > 0 ? profit / totalCost : NaN;
    const realFocus = focusCost(r.focus, opts.mastery, opts.spec);
    const spf = opts.useFocus && realFocus > 0 ? profit / realFocus : NaN;
    return { matCost, stationFee, totalCost, sellPrice, sellManual, sellDate, revenue, profit, margin, realFocus, spf, missing };
  }

  /* ---- carga de precios ---- */
  m.loadPrices = async function () {
    if (!m.DATA) return;
    m.loadedOnce = true;
    const btn = $('Refresh');
    btn.disabled = true;
    $('Body').innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando precios del mercado…</td></tr>';
    try {
      const ids = new Set();
      for (const r of m.DATA.recipes) {
        ids.add(r.id);
        for (const res of r.resources) ids.add(res.id);
      }
      const locs = [...new Set([buySel.value, sellSel.value])];
      m.prices = await fetchPrices([...ids], locs);
      $('Updated').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR');
    } catch (err) {
      $('Body').innerHTML = `<tr><td colspan="7" class="loading-cell">Error al cargar precios: ${err.message}. Reintentá en unos segundos (límite de la API).</td></tr>`;
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    m.render();
  };

  /* ---- render ---- */
  function updateRRRLabel() {
    const uf = $('UseFocus').checked;
    const cc = $('CraftCity').value;
    if (cc) {
      const bHi = (cfg.specialBonus ?? 0.33) + extraBonus(uf);
      const bLo = 0.18 + extraBonus(uf);
      $('RrrValue').innerHTML = `
        <span class="rrr-part"><span class="rrr-num">${pct(returnRate(bHi))}</span><span class="rrr-cap">ítems con bono en ${cc}</span></span>
        <span class="rrr-part"><span class="rrr-num dim">${pct(returnRate(bLo))}</span><span class="rrr-cap">resto de los ítems</span></span>`;
      $('RrrSub').textContent = '';
    } else {
      const b = getPlaceBonus() + (uf ? 0.59 : 0);
      $('RrrValue').innerHTML = `
        <span class="rrr-part"><span class="rrr-num">${pct(returnRate(b))}</span><span class="rrr-cap">todos los ítems</span></span>`;
      $('RrrSub').textContent = '';
    }
  }

  m.render = function () {
    updateRRRLabel();
    if (!m.DATA || !Object.keys(m.prices).length) return;
    const opts = getOpts();
    const q = $('Search').value.trim().toLowerCase();
    const onlyProf = $('OnlyProfitable').checked;

    m.rows = [];
    for (const r of m.DATA.recipes) {
      if (m.tierFilter !== 'all' && r.tier !== +m.tierFilter) continue;
      if (m.enchFilter !== 'all' && r.ench !== +m.enchFilter) continue;
      if (m.catFilter !== 'all' && r.cat !== m.catFilter) continue;
      const name = r.name_es || r.name_en || r.id;
      if (q && !name.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) continue;
      const c = calcRecipe(r, opts);
      if (onlyProf && !(c.profit > 0)) continue;
      m.rows.push({ r, c, name });
    }

    const val = row => ({
      name: row.name, cost: row.c.totalCost, sell: row.c.sellPrice,
      profit: isNaN(row.c.profit) ? -Infinity : row.c.profit,
      margin: isNaN(row.c.margin) ? -Infinity : row.c.margin,
      spf: isNaN(row.c.spf) ? -Infinity : row.c.spf,
    })[m.sortKey];
    m.rows.sort((a, b) => {
      const va = val(a), vb = val(b);
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * m.sortDir;
    });

    const priced = m.rows.filter(x => !isNaN(x.c.profit));
    const profitable = priced.filter(x => x.c.profit > 0);
    const best = profitable.slice().sort((a, b) => b.c.profit - a.c.profit)[0];
    const bestSpf = opts.useFocus ? profitable.slice().sort((a, b) => (b.c.spf || -1) - (a.c.spf || -1))[0] : null;
    $('Stats').innerHTML = `
      <div class="stat"><div class="k">Líneas rentables</div><div class="v ${profitable.length ? 'pos' : ''}">${profitable.length}</div><div class="s">de ${priced.length} con precio (${m.rows.length} mostradas)</div></div>
      <div class="stat"><div class="k">Mejor crafteo</div><div class="v">${best ? best.name : '—'}</div><div class="s">${best ? '+' + fmt(best.c.profit) + ' plata / lote' : 'sin crafteos rentables'}</div></div>
      <div class="stat"><div class="k">Mejor plata/Foco</div><div class="v">${bestSpf ? fmt(bestSpf.c.spf) : (opts.useFocus ? '—' : 'off')}</div><div class="s">${bestSpf ? bestSpf.name : (opts.useFocus ? '' : 'activá "Usar Foco"')}</div></div>
      <div class="stat"><div class="k">Tasa de retorno</div><div class="v">${opts.craftCity ? $('RrrValue').textContent : pct(opts.rrr)}</div><div class="s">${opts.craftCity ? 'bonificado / resto en ' + opts.craftCity : (opts.useFocus ? 'con Foco (+59%)' : 'sin Foco')}</div></div>`;

    const body = $('Body');
    if (!m.rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="loading-cell">Sin resultados con los filtros actuales.</td></tr>';
      return;
    }
    body.innerHTML = m.rows.map(({ r, c, name }) => {
      const ings = r.resources.map(res =>
        `<span class="ing">${iconImg(res.id, 'item-icon sm', (m.DATA.ingredients[res.id]?.name_es || res.id))}<span class="qty">${res.count}</span></span>`
      ).join('');
      const profitCls = c.profit > 0 ? 'pos' : (isNaN(c.profit) ? '' : 'neg');
      const manualMark = c.sellManual ? ' <span class="badge gold" title="Precio editado manualmente">✎</span>' : '';
      const expanded = m.expandedRecipe === r.id;
      const mainRow = `<tr class="clickable craft-row ${expanded ? 'expanded' : ''}" data-rid="${r.id}">
        <td><div class="item-cell">
          <span class="expander">${expanded ? '▾' : '▸'}</span>
          ${iconImg(r.id, 'item-icon')}
          <div><div class="item-name">${name}</div>
          <div class="item-meta">T${r.tier}${r.ench ? '.' + r.ench : ''}${r.cat_es ? ' · ' + r.cat_es : ''} · lote de ${r.amount} · focus ${fmt(focusCost(r.focus, opts.mastery, opts.spec))}</div></div>
        </div></td>
        <td><div class="ing-row">${ings}</div></td>
        <td class="num">${c.missing ? '<span class="badge warn">faltan precios</span>' : fmt(c.totalCost)}</td>
        <td class="num">${c.sellPrice ? fmt(c.sellPrice) + manualMark + ' <span class="price-sub">× ' + r.amount + '</span>' + (c.sellManual ? '' : ageBadge(c.sellDate)) : '<span class="badge warn">sin precio</span>'}</td>
        <td class="num ${profitCls}">${isNaN(c.profit) ? '—' : (c.profit > 0 ? '+' : '') + fmt(c.profit)}</td>
        <td class="num ${profitCls}">${pct(c.margin)}</td>
        <td class="num">${isNaN(c.spf) ? '—' : fmt(c.spf)}</td>
      </tr>`;
      return mainRow + (expanded ? detailRow(r, c, opts) : '');
    }).join('');
  };

  /* ---- detalle expandible con precios editables ---- */
  function detailRow(r, c, opts) {
    const name = r.name_es || r.name_en || r.id;
    const kind = opts.useBuy ? 'buy' : 'sell';
    const ingRows = r.resources.map(res => {
      const ing = m.DATA.ingredients[res.id] || {};
      const apiP = m.prices[res.id]?.[opts.buyCity];
      const apiVal = (kind === 'buy' ? (apiP?.buy || apiP?.sell) : apiP?.sell) || 0;
      const ep = effPrice(res.id, opts.buyCity, kind);
      const valNow = (!ep.value && opts.useBuy) ? effPrice(res.id, opts.buyCity, 'sell').value : ep.value;
      const isManual = ep.manual;
      return `<tr>
        <td><div class="item-cell">${iconImg(res.id, 'item-icon sm')}
          <div><div>${ing.name_es || ing.name_en || res.id}</div><div class="item-meta">${res.id}</div></div></div></td>
        <td class="num">× ${res.count}</td>
        <td class="num">
          <span class="price-edit-wrap">
            <input type="number" class="price-edit ${isManual ? 'manual' : ''}" min="0" step="1"
              value="${valNow || ''}" placeholder="sin precio"
              data-pid="${res.id}" data-city="${opts.buyCity}" data-kind="${kind}"
              title="${isManual ? 'Precio manual (editado por vos)' : 'Precio de la API'}">
            ${isManual ? `<button class="reset-price" data-pid="${res.id}" data-city="${opts.buyCity}" data-kind="${kind}" title="Volver al precio de la API (${fmt(apiVal)})">↺</button>` : ''}
          </span>
          <span class="price-sub">${isManual ? 'manual · API: ' + (apiVal ? fmt(apiVal) : '—') : (apiVal ? 'API · ' + opts.buyCity : 'sin datos en la API')}</span>
        </td>
        <td class="num">${valNow ? fmt(valNow * res.count) : '—'}</td>
      </tr>`;
    }).join('');

    const sellApi = m.prices[r.id]?.[opts.sellCity]?.sell || 0;
    const sellEp = effPrice(r.id, opts.sellCity, 'sell');

    return `<tr class="detail-tr"><td colspan="7">
      <div class="craft-detail">
        <div class="cd-section">
          <div class="cd-title">Materiales — comprar en ${opts.buyCity} <span class="muted micro">(editá cualquier precio; ✎ = valor manual)</span></div>
          <table class="matrix cd-table">
            <thead><tr><th>Ingrediente</th><th>Cant.</th><th>Precio unitario</th><th>Subtotal</th></tr></thead>
            <tbody>${ingRows}</tbody>
          </table>
        </div>
        <div class="cd-section cd-summary">
          <div class="cd-title">Resumen del crafteo</div>
          <div class="cd-line"><span>Precio de venta (${opts.sellCity})</span>
            <span class="price-edit-wrap">
              <input type="number" class="price-edit ${sellEp.manual ? 'manual' : ''}" min="0" step="1"
                value="${sellEp.value || ''}" placeholder="sin precio"
                data-pid="${r.id}" data-city="${opts.sellCity}" data-kind="sell"
                title="${sellEp.manual ? 'Precio manual' : 'Precio de la API'}">
              ${sellEp.manual ? `<button class="reset-price" data-pid="${r.id}" data-city="${opts.sellCity}" data-kind="sell" title="Volver al precio de la API (${fmt(sellApi)})">↺</button>` : ''}
            </span></div>
          <div class="cd-line muted"><span>Materiales (con retorno ${pct(opts.rrrFor ? opts.rrrFor(r) : opts.rrr)})</span><span>− ${fmt(c.matCost)}</span></div>
          <div class="cd-line muted"><span>Tasa de estación</span><span>− ${fmt(c.stationFee)}</span></div>
          <div class="cd-line muted"><span>Ingreso neto (lote de ${r.amount}, tras impuestos)</span><span>${fmt(c.revenue)}</span></div>
          <div class="cd-line total ${c.profit > 0 ? 'pos' : 'neg'}"><span>Ganancia por lote</span><span>${isNaN(c.profit) ? '—' : (c.profit > 0 ? '+' : '') + fmt(c.profit)}</span></div>
          <div class="cd-actions">
            <button class="btn micro-btn" onclick="llPrefill('${r.id}','craft',${((c.matCost || 0) + (c.stationFee || 0)) / (r.amount || 1)},'')" title="Anotar el crafteo (materiales + estación, por unidad) en el Registro">✎ Registrar crafteo</button>
            ${sellEp.value ? `<button class="btn micro-btn" onclick="llPrefill('${r.id}','sell',${sellEp.value},'${opts.sellCity}')" title="Anotar la venta en el Registro">✎ Registrar venta</button>` : ''}
            ${favBtnHtml(P, r.id, name)}
          </div>
        </div>
      </div>
    </td></tr>`;
  }

  /* ---- eventos ---- */
  $('CraftPlace').addEventListener('change', e => {
    $('HideoutBonusWrap').style.display = e.target.value === 'hideout' ? '' : 'none';
    m.render();
  });
  ['Search','OnlyProfitable','UseFocus','Premium','SetupFee','UseBuyOrders','UsageFee','Mastery','Spec','HideoutBonus','DailyBonusVal']
    .forEach(id => $(id).addEventListener('input', m.render));
  $('CraftCity').addEventListener('change', m.render);
  buySel.addEventListener('change', m.loadPrices);
  sellSel.addEventListener('change', m.loadPrices);
  $('Refresh').addEventListener('click', m.loadPrices);

  $('TierChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    m.tierFilter = c.dataset.tier;
    c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
    m.render();
  });
  $('EnchChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    m.enchFilter = c.dataset.ench;
    c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
    m.render();
  });
  const cityGuideEl = root.querySelector('.city-guide');
  if (cityGuideEl) {
    cityGuideEl.addEventListener('click', e => {
      const card = e.target.closest('.cg-card'); if (!card) return;
      // marcar la tarjeta activa
      cityGuideEl.querySelectorAll('.cg-card').forEach(x => x.classList.toggle('active', x === card));
      // configurar ciudad de compra/venta y ciudad de crafteo especializada
      buySel.value = card.dataset.city;
      sellSel.value = card.dataset.city;
      $('CraftCity').value = card.dataset.city;
      $('CraftPlace').value = '0.18';
      $('HideoutBonusWrap').style.display = 'none';
      // filtrar por la categoría del recurso
      m.catFilter = card.dataset.cat;
      const chips = document.getElementById(P + 'CatChips');
      if (chips) chips.querySelectorAll('.chip').forEach(x =>
        x.classList.toggle('active', x.dataset.cat === card.dataset.cat));
      m.loadPrices();
    });
  }
  const catChips = document.getElementById(P + 'CatChips');
  if (catChips) {
    catChips.addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      m.catFilter = c.dataset.cat;
      c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
      m.render();
    });
  }
  root.querySelector(`#${P}Table thead`).addEventListener('click', e => {
    const th = e.target.closest('.sortable'); if (!th) return;
    const k = th.dataset.sort;
    if (m.sortKey === k) m.sortDir *= -1; else { m.sortKey = k; m.sortDir = k === 'name' ? 1 : -1; }
    m.render();
  });

  $('Body').addEventListener('click', e => {
    // el botón ↺ vive DENTRO de .price-edit-wrap: hay que chequearlo antes del guard
    const reset = e.target.closest('.reset-price');
    if (reset) {
      delete manualPrices[mpKey(reset.dataset.pid, reset.dataset.city, reset.dataset.kind)];
      saveManual();
      m.render();
      return;
    }
    if (e.target.closest('.price-edit-wrap') || e.target.classList.contains('price-edit')) return;
    const tr = e.target.closest('tr.craft-row');
    if (!tr) return;
    m.expandedRecipe = m.expandedRecipe === tr.dataset.rid ? null : tr.dataset.rid;
    m.render();
  });
  $('Body').addEventListener('change', e => {
    const inp = e.target.closest('.price-edit');
    if (!inp) return;
    const k = mpKey(inp.dataset.pid, inp.dataset.city, inp.dataset.kind);
    const v = parseFloat(inp.value);
    if (!inp.value || isNaN(v) || v < 0) delete manualPrices[k];
    else manualPrices[k] = v;
    saveManual();
    m.render();
  });

  updateRRRLabel();
  return m;
}

/* ---------- FLIPPING ---------- */
const flipSearch = document.getElementById('flipSearch');
const flipResults = document.getElementById('flipResults');
let flipItems = [];
let flipData = {};
// Pool de ítems recomendados para llenar la lista de 50 (bolsos, capas, comida,
// pociones, monturas, armas, armaduras y recursos refinados de alta rotación)
const DEFAULT_FLIPS = ["T4_BAG","T4_CAPE","T5_BAG","T5_CAPE","T6_BAG","T6_CAPE","T7_BAG","T7_CAPE","T8_BAG","T8_CAPE","T3_MEAL_SOUP","T4_MEAL_STEW","T5_MEAL_OMELETTE","T6_MEAL_SANDWICH","T8_MEAL_STEW","T7_MEAL_OMELETTE","T8_MEAL_SANDWICH","T4_POTION_HEAL","T6_POTION_HEAL","T4_POTION_ENERGY","T6_POTION_ENERGY","T3_POTION_REVIVE","T5_POTION_SLOWFIELD","T3_MOUNT_HORSE","T4_MOUNT_HORSE","T5_MOUNT_ARMORED_HORSE","T6_MOUNT_ARMORED_HORSE","T7_MOUNT_ARMORED_HORSE","T3_MOUNT_OX","T4_MOUNT_OX","T5_MOUNT_OX","T6_MOUNT_OX","T7_MOUNT_SWAMPDRAGON","T8_MOUNT_HORSE","T4_2H_BOW","T5_2H_BOW","T6_2H_BOW","T4_MAIN_SWORD","T5_MAIN_SWORD","T6_MAIN_SWORD","T4_2H_CLAYMORE","T5_2H_CLAYMORE","T4_MAIN_FIRESTAFF","T5_MAIN_FIRESTAFF","T4_MAIN_ARCANESTAFF","T4_2H_HOLYSTAFF","T5_2H_HOLYSTAFF","T4_MAIN_CURSEDSTAFF","T4_2H_HALBERD","T4_MAIN_AXE","T5_MAIN_AXE","T4_MAIN_DAGGER","T4_MAIN_MACE","T4_MAIN_HAMMER","T4_MAIN_SPEAR","T4_2H_QUARTERSTAFF","T4_MAIN_NATURESTAFF","T4_MAIN_FROSTSTAFF","T4_OFF_SHIELD","T4_OFF_TORCH","T4_OFF_BOOK","T4_ARMOR_PLATE_SET1","T4_HEAD_LEATHER_SET1","T4_SHOES_CLOTH_SET1","T4_ARMOR_LEATHER_SET1","T4_HEAD_CLOTH_SET1","T4_ARMOR_PLATE_SET2","T4_HEAD_LEATHER_SET2","T4_SHOES_CLOTH_SET2","T4_ARMOR_LEATHER_SET2","T4_HEAD_CLOTH_SET2","T4_ARMOR_PLATE_SET3","T4_HEAD_LEATHER_SET3","T4_SHOES_CLOTH_SET3","T4_ARMOR_LEATHER_SET3","T4_HEAD_CLOTH_SET3","T5_ARMOR_PLATE_SET1","T5_HEAD_LEATHER_SET1","T5_SHOES_CLOTH_SET1","T5_ARMOR_LEATHER_SET1","T5_HEAD_CLOTH_SET1","T5_ARMOR_PLATE_SET2","T5_HEAD_LEATHER_SET2","T5_SHOES_CLOTH_SET2","T5_ARMOR_LEATHER_SET2","T5_HEAD_CLOTH_SET2","T5_ARMOR_PLATE_SET3","T5_HEAD_LEATHER_SET3","T5_SHOES_CLOTH_SET3","T5_ARMOR_LEATHER_SET3","T5_HEAD_CLOTH_SET3","T6_ARMOR_PLATE_SET1","T6_HEAD_LEATHER_SET1","T6_SHOES_CLOTH_SET1","T6_ARMOR_LEATHER_SET1","T6_HEAD_CLOTH_SET1","T6_ARMOR_PLATE_SET2","T6_HEAD_LEATHER_SET2","T6_SHOES_CLOTH_SET2","T6_ARMOR_LEATHER_SET2","T6_HEAD_CLOTH_SET2","T6_ARMOR_PLATE_SET3","T6_HEAD_LEATHER_SET3","T6_SHOES_CLOTH_SET3","T6_ARMOR_LEATHER_SET3","T6_HEAD_CLOTH_SET3","T4_PLANKS","T4_METALBAR","T4_LEATHER","T4_CLOTH","T4_STONEBLOCK","T5_PLANKS","T5_METALBAR","T5_LEATHER","T5_CLOTH","T5_STONEBLOCK","T6_PLANKS","T6_METALBAR","T6_LEATHER","T6_CLOTH","T6_STONEBLOCK"];
const flipUserAdded = new Set();

flipSearch.addEventListener('input', () => {
  const q = flipSearch.value.trim().toLowerCase();
  if (q.length < 2 || !CATALOG) { flipResults.classList.remove('open'); return; }
  const hits = [];
  for (const [id, es, en, tier, maxEnch] of CATALOG) {
    if (es.toLowerCase().includes(q) || en.toLowerCase().includes(q) || id.toLowerCase().includes(q)) {
      hits.push([id, es, en, tier, maxEnch]);
      if (hits.length >= 30) break;
    }
  }
  flipResults.innerHTML = hits.map(([id, es, en, tier, maxEnch]) => {
    const enchs = [''].concat(Array.from({ length: maxEnch }, (_, i) => '@' + (i + 1)));
    return enchs.map(suf =>
      `<div class="sr-item" data-id="${id}${suf}">
        ${iconImg(id + suf, 'item-icon sm')}
        <div><div class="n">${es}${suf ? ' .' + suf.slice(1) : ''}</div><div class="m">T${tier}${suf ? '.' + suf.slice(1) : ''} · ${id}${suf}</div></div>
      </div>`).join('');
  }).join('');
  flipResults.classList.toggle('open', hits.length > 0);
});
flipResults.addEventListener('click', e => {
  const it = e.target.closest('.sr-item'); if (!it) return;
  flipResults.classList.remove('open');
  flipSearch.value = '';
  flipUserAdded.add(it.dataset.id);
  if (!flipItems.includes(it.dataset.id)) {
    flipItems.unshift(it.dataset.id);
    loadFlipPrices([it.dataset.id]);
  } else {
    renderFlip();
  }
  flipSavePrefs();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) flipResults.classList.remove('open');
});
document.getElementById('refreshFlip').addEventListener('click', () => loadFlipPrices(flipItems));
['flipPremium','flipSetup'].forEach(id => document.getElementById(id).addEventListener('input', () => { renderFlip(); flipSavePrefs(); }));

/* ---- preferencias de flipping: ruta, impuestos e ítems agregados persisten ---- */
function flipSavePrefs() {
  try {
    localStorage.setItem('flipPrefs', JSON.stringify({
      from: document.getElementById('flipFrom').value,
      to: document.getElementById('flipTo').value,
      premium: document.getElementById('flipPremium').checked,
      setup: document.getElementById('flipSetup').checked,
      user: [...flipUserAdded],
    }));
  } catch (e) {}
}
// se llama al iniciar (init) una vez poblados los selects de ciudad
function flipRestorePrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem('flipPrefs') || 'null'); } catch (e) {}
  if (!p) return;
  if (p.premium != null) document.getElementById('flipPremium').checked = !!p.premium;
  if (p.setup != null) document.getElementById('flipSetup').checked = !!p.setup;
  for (const id of (p.user || [])) {
    if (typeof id !== 'string' || !id || id.startsWith('__')) continue;
    if (!flipItems.includes(id)) flipItems.unshift(id);
    flipUserAdded.add(id);
  }
  if (CITIES.includes(p.from)) document.getElementById('flipFrom').value = p.from;
  if (CITIES.includes(p.to) && p.to !== document.getElementById('flipFrom').value) document.getElementById('flipTo').value = p.to;
}

/* ---- ruta fija: selects de ciudad de compra y de venta ---- */
for (const selId of ['flipFrom', 'flipTo']) {
  const sel = document.getElementById(selId);
  for (const c of CITIES) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    // evitar origen === destino: si coinciden, el otro vuelve a «Mejor ciudad»
    const other = document.getElementById(selId === 'flipFrom' ? 'flipTo' : 'flipFrom');
    if (sel.value && sel.value === other.value) other.value = '';
    renderFlip();
    flipSavePrefs();
  });
}

async function loadFlipPrices(ids) {
  if (!ids.length) return;
  const btn = document.getElementById('refreshFlip');
  btn.disabled = true;
  try {
    const data = await fetchPrices(ids, CITIES);
    Object.assign(flipData, data);
  } catch (err) {
    document.getElementById('flipBody').innerHTML = `<tr><td colspan="8" class="loading-cell">Error: ${err.message}. Esperá unos segundos y reintentá.</td></tr>`;
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  renderFlip();
}

function flipCalc(id) {
  const cityData = flipData[id] || {};
  const fixedFrom = document.getElementById('flipFrom').value;
  const fixedTo = document.getElementById('flipTo').value;
  let bestBuy = null, bestSell = null, bestQuick = null;
  for (const city of CITIES) {
    const p = cityData[city];
    if (!p) continue;
    // en modo auto, el origen descarta la ciudad de destino fijada (y viceversa):
    // sin eso, si la ciudad más barata coincide con el destino el flip quedaba inválido
    const buyOk = fixedFrom ? city === fixedFrom : city !== fixedTo;
    const sellOk = fixedTo ? city === fixedTo : city !== fixedFrom;
    if (buyOk && p.sell > 0 && (!bestBuy || p.sell < bestBuy.price)) bestBuy = { city, price: p.sell, date: p.sellDate };
    if (sellOk && p.sell > 0 && (!bestSell || p.sell > bestSell.price)) bestSell = { city, price: p.sell, date: p.sellDate };
    if ((fixedTo ? city === fixedTo : true) && p.buy > 0 && (!bestQuick || p.buy > bestQuick.price)) bestQuick = { city, price: p.buy };
  }
  const premium = document.getElementById('flipPremium').checked;
  const setup = document.getElementById('flipSetup').checked;
  const tax = (premium ? 0.04 : 0.08) + (setup ? 0.025 : 0);
  const quickTax = premium ? 0.04 : 0.08;
  let profit = NaN, margin = NaN, quick = NaN;
  if (bestBuy && bestSell && bestSell.city !== bestBuy.city) {
    profit = bestSell.price * (1 - tax) - bestBuy.price;
    margin = profit / bestBuy.price;
  }
  if (bestBuy && bestQuick) quick = bestQuick.price * (1 - quickTax) - bestBuy.price;
  return { bestBuy, bestSell, bestQuick, profit, margin, quick };
}

function catalogName(fullId) {
  const base = fullId.split('@')[0];
  const suf = fullId.includes('@') ? ' .' + fullId.split('@')[1] : '';
  const row = CATALOG?.find(x => x[0] === base);
  return row ? row[1] + suf : fullId;
}

function renderFlip() {
  const body = document.getElementById('flipBody');
  if (!flipItems.length) {
    body.innerHTML = '<tr><td colspan="8" class="loading-cell">Buscá un ítem arriba para agregarlo.</td></tr>';
    return;
  }
  const all = flipItems.map(id => ({ id, f: flipCalc(id) }));
  // Con precio primero: rentables de mayor a menor ganancia y, a continuación,
  // los de pérdida ordenados de menor a mayor pérdida (orden natural por profit desc)
  const priced = all.filter(x => !isNaN(x.f.profit)).sort((a, b) => b.f.profit - a.f.profit);
  const unpriced = all.filter(x => isNaN(x.f.profit));

  // Lista fija de 50: los agregados por el usuario siempre entran
  const shown = [];
  const inShown = new Set();
  for (const x of priced) {
    if (shown.length < 50 || flipUserAdded.has(x.id)) { shown.push(x); inShown.add(x.id); }
  }
  for (const x of unpriced) {
    if (flipUserAdded.has(x.id) || shown.length < 50) { shown.push(x); inShown.add(x.id); }
  }

  const profitable = priced.filter(x => x.f.profit > 0);
  const best = profitable[0];
  document.getElementById('flipStats').innerHTML = `
    <div class="stat"><div class="k">Ítems monitoreados</div><div class="v">${all.length}</div><div class="s">mostrando ${shown.length} · en 7 ciudades</div></div>
    <div class="stat"><div class="k">Flips rentables</div><div class="v ${profitable.length ? 'pos' : ''}">${profitable.length}</div><div class="s">tras impuestos</div></div>
    <div class="stat"><div class="k">Mejor flip</div><div class="v">${best ? catalogName(best.id) : '—'}</div><div class="s">${best ? '+' + fmt(best.f.profit) + ' plata/u (' + best.f.bestBuy.city + ' → ' + best.f.bestSell.city + ')' : ''}</div></div>`;

  const fixedFrom = document.getElementById('flipFrom').value;
  const fixedTo = document.getElementById('flipTo').value;
  body.innerHTML = shown.map(({ id, f }) => {
    const ench = id.includes('@') ? '.' + id.split('@')[1] : '.0';
    const cls = f.profit > 0 ? 'pos' : (isNaN(f.profit) ? '' : 'neg');
    const qCls = f.quick > 0 ? 'pos' : (isNaN(f.quick) ? '' : 'neg');
    // con ciudad fijada sin datos, explicar el "—" en vez de dejarlo huérfano
    const buyCell = f.bestBuy ? fmt(f.bestBuy.price) + '<span class="price-sub">' + f.bestBuy.city + '</span>'
      : (fixedFrom ? '<span class="badge warn" title="Sin ventas activas en la ciudad elegida: editá un precio manual o dejá «Mejor ciudad»">sin datos en ' + fixedFrom + '</span>' : '—');
    const sellCell = f.bestSell ? fmt(f.bestSell.price) + '<span class="price-sub">' + f.bestSell.city + '</span>'
      : (fixedTo ? '<span class="badge warn" title="Sin ventas activas en la ciudad elegida: editá un precio manual o dejá «Mejor ciudad»">sin datos en ' + fixedTo + '</span>' : '—');
    return `<tr class="clickable" data-id="${id}">
      <td><div class="item-cell">${iconImg(id, 'item-icon')}
        <div><div class="item-name">${catalogName(id)}</div><div class="item-meta">${id}</div></div></div></td>
      <td><span class="badge">${ench}</span></td>
      <td class="num">${buyCell}</td>
      <td class="num">${sellCell}</td>
      <td class="num ${cls}">${isNaN(f.profit) ? '—' : (f.profit > 0 ? '+' : '') + fmt(f.profit)}</td>
      <td class="num ${cls}">${pct(f.margin)}</td>
      <td class="num ${qCls}">${isNaN(f.quick) ? '—' : (f.quick > 0 ? '+' : '') + fmt(f.quick)}</td>
      <td style="white-space:nowrap">
        <button class="btn micro-btn" data-alert="${id}" title="Crear alerta de precio para este ítem">🔔</button>
        <button class="btn micro-btn" data-remove="${id}" title="Quitar">✕</button>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('flipBody').addEventListener('click', e => {
  const al = e.target.closest('[data-alert]');
  if (al) { waPrefillFlip(al.dataset.alert); e.stopPropagation(); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    flipItems = flipItems.filter(x => x !== rm.dataset.remove);
    flipUserAdded.delete(rm.dataset.remove);
    renderFlip();
    flipSavePrefs();
    e.stopPropagation();
    return;
  }
  const tr = e.target.closest('tr[data-id]');
  if (tr) showFlipDetail(tr.dataset.id);
});

function showFlipDetail(id) {
  const panel = document.getElementById('flipDetail');
  const cityData = flipData[id] || {};
  const f = flipCalc(id);
  const rows = CITIES.map(city => {
    const p = cityData[city];
    const isBuy = f.bestBuy?.city === city, isSell = f.bestSell?.city === city;
    return `<tr>
      <td>${city}${isBuy ? ' <span class="badge gold">comprar acá</span>' : ''}${isSell ? ' <span class="badge gold">vender acá</span>' : ''}</td>
      <td class="${isBuy ? 'best-buy' : ''}">${p?.sell ? fmt(p.sell) : '—'}</td>
      <td class="${isSell ? 'best-sell' : ''}">${p?.sell ? fmt(p.sell) : '—'}</td>
      <td>${p?.buy ? fmt(p.buy) : '—'}</td>
      <td class="muted micro">${p?.sellDate && !p.sellDate.startsWith('0001') ? new Date(p.sellDate + 'Z').toLocaleString('es-AR') : '—'}</td>
    </tr>`;
  }).join('');
  panel.style.display = '';
  panel.innerHTML = `
    <div class="detail-head">
      ${iconImg(id, 'item-icon')}
      <div><div class="item-name">${catalogName(id)}</div><div class="item-meta">${id} · matriz de precios en las 7 ciudades</div></div>
      ${f.bestBuy ? `<button class="btn micro-btn" onclick="llPrefill('${id}','buy',${f.bestBuy.price},'${f.bestBuy.city}')" title="Anotar la compra en el Registro de operaciones">✎ Registrar compra</button>` : ''}
      ${f.bestSell ? `<button class="btn micro-btn" onclick="llPrefill('${id}','sell',${f.bestSell.price},'${f.bestSell.city}')" title="Anotar la venta en el Registro de operaciones">✎ Registrar venta</button>` : ''}
      <button class="btn micro-btn" onclick="waPrefillFlip('${id}')" title="Crear una alerta de precio para este ítem">🔔 Alerta de precio</button>
      ${favBtnHtml('flip', id, catalogName(id))}
      <button class="btn detail-close" onclick="this.closest('#flipDetail').style.display='none'">Cerrar</button>
    </div>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>Ciudad</th><th>Venta acá — para comprar</th><th>Venta acá — para vender</th><th>Mejor orden de compra</th><th>Actualizado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ====================================================================
   CRAFTEO DE EQUIPO (armas, manos secundarias, armaduras, capas, bolsas)
   Incluye diarios (vacíos/llenos) y Black Market como punto de venta.
   ==================================================================== */
const GEAR = {
  DATA: null, prices: {}, bm: {}, byId: {},
  family: null, tierF: 'all', enchF: 'all',
  sortKey: 'profit', sortDir: -1, expanded: null,
  plan: [], loadedOnce: false,
};
try { GEAR.plan = JSON.parse(localStorage.getItem('gearPlan') || '[]'); } catch (e) {}
function saveGearPlan() { localStorage.setItem('gearPlan', JSON.stringify(GEAR.plan)); }

const G = id => document.getElementById('gear' + id);

// Precios del Black Market: agrega la mejor orden de compra entre todas las calidades
async function fetchBM(ids) {
  const out = {};
  const chunks = []; let cur = [];
  for (const id of ids) { cur.push(id); if (cur.join(',').length > 3500) { chunks.push(cur); cur = []; } }
  if (cur.length) chunks.push(cur);
  for (const chunk of chunks) {
    const data = await fetchJSON(`${API}/prices/${chunk.join(',')}.json?locations=Black%20Market`);
    for (const row of data) {
      const o = out[row.item_id] = out[row.item_id] || { buy: 0, sell: 0, date: null };
      if (row.buy_price_max > o.buy) { o.buy = row.buy_price_max; o.date = row.buy_price_max_date; }
      if (row.sell_price_min > 0 && (!o.sell || row.sell_price_min < o.sell)) o.sell = row.sell_price_min;
    }
  }
  return out;
}

function gEff(id, city, kind) {
  const k = mpKey(id, city, kind);
  if (k in manualPrices) return { value: manualPrices[k], manual: true };
  const p = GEAR.prices[id]?.[city];
  return { value: (kind === 'buy' ? p?.buy : p?.sell) || 0, manual: false };
}

// familia → ciudad que la bonifica (derivado de cityBonuses)
let gearFamCity = null;
function gearBonusCityOf(family) {
  if (!gearFamCity) {
    gearFamCity = {};
    for (const [city, fams] of Object.entries(GEAR.DATA.cityBonuses)) {
      for (const f of fams) gearFamCity[f] = city;
    }
  }
  return gearFamCity[family] || null;
}

function gearOpts() {
  const useFocus = G('UseFocus').checked;
  let bonus = G('CraftPlace').value === 'hideout'
    ? (parseFloat(G('HideoutBonus').value) || 0) / 100
    : parseFloat(G('CraftPlace').value);
  if (G('DailyOn').checked) bonus += (parseFloat(G('DailyVal').value) || 0) / 100;
  const extra = (useFocus ? 0.59 : 0) + (G('DailyOn').checked ? (parseFloat(G('DailyVal').value) || 0) / 100 : 0);
  const craftCity = G('CraftCity').value;
  return {
    craftCity,
    rrrFor: craftCity
      ? r => returnRate((gearBonusCityOf(r.family) === craftCity ? 0.33 : 0.18) + extra)
      : null,
    bonusHi: 0.33 + extra,
    bonusLo: 0.18 + extra,
    bonusFlat: bonus + (useFocus ? 0.59 : 0),
    rrrHi: returnRate(0.33 + extra),
    rrrLo: returnRate(0.18 + extra),
    rrr: returnRate(bonus + (useFocus ? 0.59 : 0)),
    buyCity: G('BuyCity').value,
    sellCity: G('SellCity').value,
    sellBM: G('SellCity').value === 'Black Market',
    usageFee: parseFloat(G('UsageFee').value) || 0,
    premium: G('Premium').checked,
    setup: G('SetupFee').checked,
    useBuy: G('UseBuyOrders').checked,
    useJournals: G('UseJournals').checked,
    mastery: parseFloat(G('Mastery').value) || 0,
    spec: parseFloat(G('Spec').value) || 0,
    useFocus,
  };
}

function journalCalc(r, o) {
  const type = GEAR.DATA.journalOf[r.family];
  const mf = GEAR.DATA.journals[type]?.[r.tier];
  if (!mf || !r.fame) return null;
  const per = r.fame / mf;
  const eId = `T${r.tier}_JOURNAL_${type}_EMPTY`, fId = `T${r.tier}_JOURNAL_${type}_FULL`;
  const eP = gEff(eId, o.buyCity, 'sell'), fP = gEff(fId, o.buyCity, 'sell');
  const tax = (o.premium ? 0.04 : 0.08) + (o.setup ? 0.025 : 0);
  return { per, type, empty: eP.value, full: fP.value, eManual: eP.manual, fManual: fP.manual,
           cost: per * eP.value, revenue: per * fP.value * (1 - tax), eId, fId };
}

function gearCalc(r, o) {
  let matCost = 0, missing = false;
  const rrr = o.rrrFor ? o.rrrFor(r) : o.rrr;
  for (const res of r.resources) {
    let ep = gEff(res.id, o.buyCity, o.useBuy ? 'buy' : 'sell');
    if (!ep.value && o.useBuy) ep = gEff(res.id, o.buyCity, 'sell');
    if (!ep.value) missing = true;
    matCost += ep.value * res.count * (res.ret ? (1 - rrr) : 1);
  }
  const stationFee = r.itemvalue * 0.1125 * (o.usageFee / 100);
  let sellPrice = 0, sellManual = false, sellDate = null;
  if (o.sellBM) {
    const k = mpKey(r.id, 'Black Market', 'bm');
    if (k in manualPrices) { sellPrice = manualPrices[k]; sellManual = true; }
    else { const b = GEAR.bm[r.id]; sellPrice = b?.buy || b?.sell || 0; sellDate = b?.date; }
  } else {
    const ep = gEff(r.id, o.sellCity, 'sell');
    sellPrice = ep.value; sellManual = ep.manual;
    sellDate = GEAR.prices[r.id]?.[o.sellCity]?.sellDate;
  }
  const tax = (o.premium ? 0.04 : 0.08) + ((!o.sellBM && o.setup) ? 0.025 : 0);
  const revenue = sellPrice * (1 - tax);
  const j = o.useJournals ? journalCalc(r, o) : null;
  const totalCost = matCost + stationFee + (j ? j.cost : 0);
  const profit = sellPrice ? revenue + (j ? j.revenue : 0) - totalCost : NaN;
  const margin = sellPrice && totalCost > 0 ? profit / totalCost : NaN;
  const realFocus = focusCost(r.focus, o.mastery, o.spec);
  const spf = o.useFocus && realFocus > 0 ? profit / realFocus : NaN;
  return { matCost, stationFee, totalCost, sellPrice, sellManual, sellDate, revenue, j, profit, margin, realFocus, spf, missing };
}

function journalIdsFor(types) {
  const ids = [];
  for (const t of types) for (let n = 2; n <= 8; n++) ids.push(`T${n}_JOURNAL_${t}_EMPTY`, `T${n}_JOURNAL_${t}_FULL`);
  return ids;
}

async function loadGearPrices(recipeList) {
  const btn = G('Refresh'); btn.disabled = true;
  G('Updated').textContent = 'Cargando…';
  try {
    const ids = new Set(), types = new Set();
    for (const r of recipeList) {
      ids.add(r.id);
      for (const res of r.resources) ids.add(res.id);
      types.add(GEAR.DATA.journalOf[r.family]);
    }
    for (const jid of journalIdsFor([...types])) ids.add(jid);
    const o = gearOpts();
    const locs = [...new Set([o.buyCity, !o.sellBM ? o.sellCity : null].filter(Boolean))];
    const cityData = await fetchPrices([...ids], locs);
    for (const [id, d] of Object.entries(cityData)) GEAR.prices[id] = Object.assign(GEAR.prices[id] || {}, d);
    const bmData = await fetchBM(recipeList.map(r => r.id));
    Object.assign(GEAR.bm, bmData);
    G('Updated').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR');
  } catch (err) {
    G('Updated').textContent = 'Error: ' + err.message + ' — reintentá en unos segundos.';
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  renderGear();
  renderPlanner();
}

function gearVisibleRecipes() {
  const q = G('Search').value.trim().toLowerCase();
  const out = [];
  for (const r of GEAR.DATA.recipes) {
    if (GEAR.family && r.family !== GEAR.family) continue;
    if (GEAR.tierF !== 'all' && r.tier !== +GEAR.tierF) continue;
    if (GEAR.enchF !== 'all' && r.ench !== +GEAR.enchF) continue;
    if (q) {
      const name = (r.name_es || r.name_en || r.id).toLowerCase();
      if (!name.includes(q) && !r.id.toLowerCase().includes(q)) continue;
    }
    if (!GEAR.family && !q && !(GEAR.prices[r.id] || GEAR.bm[r.id])) continue;
    out.push(r);
  }
  return out;
}

function renderGear() {
  if (!GEAR.DATA) return;
  const o = gearOpts();
  if (o.craftCity) {
    G('RrrValue').innerHTML = `
      <span class="rrr-part"><span class="rrr-num">${pct(o.rrrHi)}</span><span class="rrr-cap">familias con bono en ${o.craftCity}</span></span>
      <span class="rrr-part"><span class="rrr-num dim">${pct(o.rrrLo)}</span><span class="rrr-cap">resto de las familias</span></span>`;
    G('RrrSub').textContent = '';
  } else {
    G('RrrValue').innerHTML = `
      <span class="rrr-part"><span class="rrr-num">${pct(o.rrr)}</span><span class="rrr-cap">todos los ítems</span></span>`;
    G('RrrSub').textContent = '';
  }
  const onlyProf = G('OnlyProfitable').checked;
  let rows = gearVisibleRecipes().map(r => ({ r, c: gearCalc(r, o), name: r.name_es || r.name_en || r.id }));
  if (onlyProf) rows = rows.filter(x => x.c.profit > 0);

  const val = row => ({
    name: row.name, cost: row.c.totalCost, sell: row.c.sellPrice,
    profit: isNaN(row.c.profit) ? -Infinity : row.c.profit,
    margin: isNaN(row.c.margin) ? -Infinity : row.c.margin,
    spf: isNaN(row.c.spf) ? -Infinity : row.c.spf,
  })[GEAR.sortKey];
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * GEAR.sortDir;
  });

  const priced = rows.filter(x => !isNaN(x.c.profit));
  const profitable = priced.filter(x => x.c.profit > 0);
  const best = profitable.slice().sort((a, b) => b.c.profit - a.c.profit)[0];
  const famName = GEAR.family ? (GEAR.DATA.families.find(f => f[0] === GEAR.family) || [])[1] : 'todas las familias';
  G('Stats').innerHTML = `
    <div class="stat"><div class="k">Líneas rentables</div><div class="v ${profitable.length ? 'pos' : ''}">${profitable.length}</div><div class="s">de ${priced.length} con precio · ${famName}</div></div>
    <div class="stat"><div class="k">Mejor crafteo</div><div class="v">${best ? best.name : '—'}</div><div class="s">${best ? '+' + fmt(best.c.profit) + ' plata/u' + (best.r.ench ? ' (.' + best.r.ench + ')' : '') : 'sin datos aún'}</div></div>
    <div class="stat"><div class="k">Venta en</div><div class="v">${o.sellBM ? 'Black Market' : o.sellCity}</div><div class="s">${o.sellBM ? 'mejor orden de compra, sin tasa de publicación' : 'orden de venta'}</div></div>
    <div class="stat"><div class="k">Tasa de retorno</div><div class="v">${o.craftCity ? pct(o.rrrHi) + ' / ' + pct(o.rrrLo) : pct(o.rrr)}</div><div class="s">${o.craftCity ? 'bonificado / resto en ' + o.craftCity : 'solo materiales refinados'}${o.useJournals ? ' · diarios ON' : ''}</div></div>`;

  const total = rows.length;
  const shown = rows.slice(0, 50);
  const body = G('Body');
  if (!shown.length) {
    body.innerHTML = `<tr><td colspan="7" class="loading-cell">${GEAR.family ? 'Sin resultados. Tocá «↻ Actualizar precios» para cargar esta familia.' : 'Elegí una familia arriba (o usá «Escanear rentables») para empezar.'}</td></tr>`;
    return;
  }
  body.innerHTML = shown.map(({ r, c, name }) => {
    const ings = r.resources.map(res =>
      `<span class="ing">${iconImg(res.id, 'item-icon sm', (GEAR.DATA.ingredients[res.id]?.name_es || res.id))}<span class="qty">${res.count}</span></span>`
    ).join('');
    const cls = c.profit > 0 ? 'pos' : (isNaN(c.profit) ? '' : 'neg');
    const manualMark = c.sellManual ? ' <span class="badge gold">✎</span>' : '';
    const expanded = GEAR.expanded === r.id;
    const main = `<tr class="clickable craft-row ${expanded ? 'expanded' : ''}" data-rid="${r.id}">
      <td><div class="item-cell">
        <span class="expander">${expanded ? '▾' : '▸'}</span>
        ${iconImg(r.id, 'item-icon')}
        <div><div class="item-name">${name}</div>
        <div class="item-meta">T${r.tier}${r.ench ? '.' + r.ench : ''} · fama ${fmt(r.fame)} · focus ${fmt(focusCost(r.focus, o.mastery, o.spec))}</div></div>
      </div></td>
      <td><div class="ing-row">${ings}</div></td>
      <td class="num">${c.missing ? '<span class="badge warn">faltan precios</span>' : fmt(c.totalCost)}</td>
      <td class="num">${c.sellPrice ? fmt(c.sellPrice) + manualMark + (c.sellManual ? '' : ageBadge(c.sellDate)) : '<span class="badge warn">sin precio</span>'}</td>
      <td class="num ${cls}">${isNaN(c.profit) ? '—' : (c.profit > 0 ? '+' : '') + fmt(c.profit)}</td>
      <td class="num ${cls}">${pct(c.margin)}</td>
      <td><button class="btn plan-add" data-plan="${r.id}" title="Agregar al planeador">+ Plan</button></td>
    </tr>`;
    return main + (expanded ? gearDetailRow(r, c, o) : '');
  }).join('') + (total > 50 ? `<tr><td colspan="7" class="loading-cell">Mostrando los 50 mejores de ${total} resultados — afiná los filtros para ver el resto.</td></tr>` : '');
}

function gearDetailRow(r, c, o) {
  const name = r.name_es || r.name_en || r.id;
  const kind = o.useBuy ? 'buy' : 'sell';
  const rrr = o.rrrFor ? o.rrrFor(r) : o.rrr;
  const ingRows = r.resources.map(res => {
    const ing = GEAR.DATA.ingredients[res.id] || {};
    const apiP = GEAR.prices[res.id]?.[o.buyCity];
    const apiVal = (kind === 'buy' ? (apiP?.buy || apiP?.sell) : apiP?.sell) || 0;
    const ep = gEff(res.id, o.buyCity, kind);
    const valNow = (!ep.value && o.useBuy) ? gEff(res.id, o.buyCity, 'sell').value : ep.value;
    const factor = res.ret ? (1 - rrr) : 1;
    return `<tr>
      <td><div class="item-cell">${iconImg(res.id, 'item-icon sm')}
        <div><div>${ing.name_es || ing.name_en || res.id}</div><div class="item-meta">${res.id}${res.ret ? '' : ' · sin retorno'}</div></div></div></td>
      <td class="num">× ${res.count}</td>
      <td class="num">
        <span class="price-edit-wrap">
          <input type="number" class="price-edit ${ep.manual ? 'manual' : ''}" min="0" step="1"
            value="${valNow || ''}" placeholder="sin precio"
            data-pid="${res.id}" data-city="${o.buyCity}" data-kind="${kind}">
          ${ep.manual ? `<button class="reset-price" data-pid="${res.id}" data-city="${o.buyCity}" data-kind="${kind}" title="Volver a la API (${fmt(apiVal)})">↺</button>` : ''}
        </span>
        <span class="price-sub">${ep.manual ? 'manual · API: ' + (apiVal ? fmt(apiVal) : '—') : (apiVal ? 'API · ' + o.buyCity : 'sin datos en la API')}</span>
      </td>
      <td class="num">${valNow ? fmt(valNow * res.count * factor) : '—'}</td>
    </tr>`;
  }).join('');

  const j = c.j;
  const sellCityLabel = o.sellBM ? 'Black Market' : o.sellCity;
  const sellKey = o.sellBM ? ['bm', 'Black Market'] : ['sell', o.sellCity];
  const sellApi = o.sellBM ? (GEAR.bm[r.id]?.buy || GEAR.bm[r.id]?.sell || 0) : (GEAR.prices[r.id]?.[o.sellCity]?.sell || 0);
  const sellManualKey = mpKey(r.id, sellKey[1], sellKey[0]);
  const sellIsManual = sellManualKey in manualPrices;

  return `<tr class="detail-tr"><td colspan="7">
    <div class="craft-detail">
      <div class="cd-section">
        <div class="cd-title">Materiales — comprar en ${o.buyCity} <span class="muted micro">(el retorno ${pct(rrr)} aplica solo a refinados${o.craftCity ? ' · crafteando en ' + o.craftCity : ''})</span></div>
        <table class="matrix cd-table">
          <thead><tr><th>Material</th><th>Cant.</th><th>Precio unitario</th><th>Costo neto</th></tr></thead>
          <tbody>${ingRows}</tbody>
        </table>
        ${j ? `
        <div class="cd-title" style="margin-top:14px">Diarios (${j.type.toLowerCase()}, T${r.tier}) — ${j.per.toFixed(3).replace('.', ',')} diarios por crafteo</div>
        <table class="matrix cd-table">
          <tbody>
            <tr><td><div class="item-cell">${iconImg(j.eId, 'item-icon sm')}<div>Diario vacío (compra)</div></div></td>
              <td class="num">
                <span class="price-edit-wrap"><input type="number" class="price-edit ${j.eManual ? 'manual' : ''}" min="0" step="1" value="${j.empty || ''}" placeholder="sin precio" data-pid="${j.eId}" data-city="${o.buyCity}" data-kind="sell">
                ${j.eManual ? `<button class="reset-price" data-pid="${j.eId}" data-city="${o.buyCity}" data-kind="sell">↺</button>` : ''}</span></td>
              <td class="num neg">− ${fmt(j.cost)}</td></tr>
            <tr><td><div class="item-cell">${iconImg(j.fId, 'item-icon sm')}<div>Diario lleno (venta)</div></div></td>
              <td class="num">
                <span class="price-edit-wrap"><input type="number" class="price-edit ${j.fManual ? 'manual' : ''}" min="0" step="1" value="${j.full || ''}" placeholder="sin precio" data-pid="${j.fId}" data-city="${o.buyCity}" data-kind="sell">
                ${j.fManual ? `<button class="reset-price" data-pid="${j.fId}" data-city="${o.buyCity}" data-kind="sell">↺</button>` : ''}</span></td>
              <td class="num pos">+ ${fmt(j.revenue)}</td></tr>
          </tbody>
        </table>` : ''}
      </div>
      <div class="cd-section cd-summary">
        <div class="cd-title">Resumen del crafteo</div>
        <div class="cd-line"><span>Precio de venta (${sellCityLabel})</span>
          <span class="price-edit-wrap">
            <input type="number" class="price-edit ${sellIsManual ? 'manual' : ''}" min="0" step="1"
              value="${c.sellPrice || ''}" placeholder="sin precio"
              data-pid="${r.id}" data-city="${sellKey[1]}" data-kind="${sellKey[0]}">
            ${sellIsManual ? `<button class="reset-price" data-pid="${r.id}" data-city="${sellKey[1]}" data-kind="${sellKey[0]}" title="Volver a la API (${fmt(sellApi)})">↺</button>` : ''}
          </span></div>
        <div class="cd-line muted"><span>Materiales (neto)</span><span>− ${fmt(c.matCost)}</span></div>
        <div class="cd-line muted"><span>Tasa de estación</span><span>− ${fmt(c.stationFee)}</span></div>
        ${j ? `<div class="cd-line muted"><span>Diarios: compra vacíos</span><span>− ${fmt(j.cost)}</span></div>
        <div class="cd-line muted"><span>Diarios: venta llenos (neto)</span><span>+ ${fmt(j.revenue)}</span></div>` : ''}
        <div class="cd-line muted"><span>Ingreso por el ítem (tras impuestos${o.sellBM ? ', sin tasa de publicación' : ''})</span><span>${fmt(c.revenue)}</span></div>
        <div class="cd-line total ${c.profit > 0 ? 'pos' : 'neg'}"><span>Ganancia por unidad</span><span>${isNaN(c.profit) ? '—' : (c.profit > 0 ? '+' : '') + fmt(c.profit)}</span></div>
        <div class="cd-actions">
          <button class="btn micro-btn" onclick="llPrefill('${r.id}','craft',${(c.matCost || 0) + (c.stationFee || 0)},'')" title="Anotar el crafteo (costo de materiales + estación) en el Registro">✎ Registrar crafteo</button>
          ${c.sellPrice ? `<button class="btn micro-btn" onclick="llPrefill('${r.id}','sell',${c.sellPrice},'${o.sellBM ? 'Black Market' : sellKey[1]}')" title="Anotar la venta en el Registro">✎ Registrar venta</button>` : ''}
          ${favBtnHtml('gear', r.id, name)}
        </div>
      </div>
    </div>
  </td></tr>`;
}

/* ---- planeador de sesión ---- */
function addToPlan(id) {
  const existing = GEAR.plan.find(p => p.id === id);
  if (existing) existing.qty += 1;
  else GEAR.plan.push({ id, qty: 1 });
  saveGearPlan();
  renderPlanner();
  G('PlannerPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPlanner() {
  const panel = G('PlannerPanel');
  if (!GEAR.plan.length) {
    panel.innerHTML = `<div class="cg-head" style="padding:14px 16px"><div class="cd-title">Planeador de sesión</div>
      <div class="micro muted">Agregá ítems desde la tabla con el botón «+ Plan» y elegí cuántas unidades craftear de cada uno.</div></div>`;
    return;
  }
  const o = gearOpts();
  let totProfit = 0, totCost = 0, totRevenue = 0, totFocus = 0, anyMissing = false;
  const matAgg = new Map();
  const rowsHtml = GEAR.plan.map(p => {
    const r = GEAR.byId[p.id];
    if (!r) return '';
    const c = gearCalc(r, o);
    const name = r.name_es || r.name_en || r.id;
    if (!isNaN(c.profit)) { totProfit += c.profit * p.qty; totCost += c.totalCost * p.qty; totRevenue += (c.revenue + (c.j ? c.j.revenue : 0)) * p.qty; }
    else anyMissing = true;
    totFocus += c.realFocus * p.qty;
    const rRrr = o.rrrFor ? o.rrrFor(r) : o.rrr;
    for (const res of r.resources) {
      const cur = matAgg.get(res.id) || { count: 0, eff: 0, ret: res.ret };
      cur.count += res.count * p.qty;
      cur.eff += res.count * p.qty * (res.ret ? (1 - rRrr) : 1);
      matAgg.set(res.id, cur);
    }
    const cls = c.profit > 0 ? 'pos' : (isNaN(c.profit) ? '' : 'neg');
    return `<tr>
      <td><div class="item-cell">${iconImg(r.id, 'item-icon sm')}
        <div><div>${name}</div><div class="item-meta">T${r.tier}${r.ench ? '.' + r.ench : ''}</div></div></div></td>
      <td class="num"><input type="number" class="qty-edit" min="1" step="1" value="${p.qty}" data-qid="${p.id}"></td>
      <td class="num ${cls}">${isNaN(c.profit) ? '—' : (c.profit > 0 ? '+' : '') + fmt(c.profit)}</td>
      <td class="num ${cls}">${isNaN(c.profit) ? '—' : (c.profit * p.qty > 0 ? '+' : '') + fmt(c.profit * p.qty)}</td>
      <td><button class="btn micro-btn" data-unplan="${p.id}" title="Quitar">✕</button></td>
    </tr>`;
  }).join('');

  const matsHtml = [...matAgg.entries()].map(([mid, m]) => {
    const eff = m.ret ? Math.ceil(m.eff) : m.count;
    return `<span class="ing plan-mat" title="${GEAR.DATA.ingredients[mid]?.name_es || mid} — brutos: ${fmt(m.count)}${m.ret ? ' · netos con retorno: ' + fmt(eff) : ''}">${iconImg(mid, 'item-icon sm')}<span class="qty">${fmt(eff)}</span></span>`;
  }).join('');

  panel.innerHTML = `
    <div class="cg-head" style="padding:14px 16px 0"><div class="cd-title">Planeador de sesión — ${GEAR.plan.length} ítem(s)</div></div>
    <div class="table-wrap"><table class="matrix cd-table">
      <thead><tr><th>Ítem</th><th>Cantidad</th><th>Ganancia/u</th><th>Ganancia total</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
    <div class="plan-summary">
      <div class="cd-title">Materiales totales <span class="muted micro">(cantidades netas esperadas${o.craftCity ? ' · crafteando en ' + o.craftCity : ' con retorno ' + pct(o.rrr)})</span></div>
      <div class="ing-row" style="margin:6px 0 12px">${matsHtml}</div>
      <div class="cd-line muted"><span>Costo total (materiales + estación + diarios)</span><span>− ${fmt(totCost)}</span></div>
      <div class="cd-line muted"><span>Ingreso total estimado</span><span>+ ${fmt(totRevenue)}</span></div>
      ${o.useFocus ? `<div class="cd-line muted"><span>Focus total requerido</span><span>${fmt(totFocus)}</span></div>` : ''}
      <div class="cd-line total ${totProfit > 0 ? 'pos' : 'neg'}"><span>Ganancia total de la sesión${anyMissing ? ' (hay ítems sin precio)' : ''}</span><span>${(totProfit > 0 ? '+' : '') + fmt(totProfit)}</span></div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">
        <button class="btn" id="gearPlanLoad">↻ Cargar precios del plan</button>
        <button class="btn" id="gearPlanClear">Vaciar plan</button>
      </div>
    </div>`;

  panel.querySelector('#gearPlanClear').addEventListener('click', () => {
    GEAR.plan = []; saveGearPlan(); renderPlanner();
  });
  panel.querySelector('#gearPlanLoad').addEventListener('click', () => {
    const list = GEAR.plan.map(p => GEAR.byId[p.id]).filter(Boolean);
    if (list.length) loadGearPrices(list);
  });
}

function buildGearUI() {
  const root = document.getElementById('tab-gear');
  const D = GEAR.DATA;
  const famName = f => (D.families.find(x => x[0] === f) || [f, f])[1];

  root.innerHTML = `
  <div class="panel city-guide">
    <div class="cg-head">
      <div class="cd-title">Bonos de crafteo por ciudad (+15% además del +18% base)</div>
      <div class="micro muted">Cada ciudad bonifica familias específicas. Hacé clic en una familia para seleccionarla y configurar su ciudad con bono.</div>
    </div>
    <div class="cg-grid gear-guide">
      ${Object.entries(D.cityBonuses).map(([city, fams]) => `
        <div class="cg-card gear-city">
          <div class="cg-info">
            <div class="cg-city">${city}</div>
            <div class="fam-tags">${fams.filter(f => D.families.some(x => x[0] === f)).map(f =>
              `<button class="fam-tag" data-fam="${f}" data-city="${city}">${famName(f)}</button>`).join('')}</div>
          </div>
        </div>`).join('')}
    </div>
  </div>

  <div class="panel controls">
    <div class="control-grid">
      <div class="control"><label>Comprar materiales en</label><select id="gearBuyCity"></select></div>
      <div class="control"><label>Vender producto en</label><select id="gearSellCity"></select></div>
      <div class="control"><label>Lugar de crafteo</label>
        <select id="gearCraftPlace">
          <option value="0">Isla personal (0% bono)</option>
          <option value="0.18" selected>Ciudad real (+18%)</option>
          <option value="hideout">Hideout (bono manual)</option>
        </select></div>
      <div class="control" id="gearHideoutBonusWrap" style="display:none"><label>Bono del hideout (%)</label>
        <input type="number" id="gearHideoutBonus" value="28" min="0" max="80" step="1"></div>
      <div class="control"><label>Ciudad de crafteo</label>
        <select id="gearCraftCity">
          <option value="">— sin ciudad (usa lugar de crafteo)</option>
          ${CITIES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <div class="micro muted">Solo las familias bonificadas en esa ciudad reciben +33%; el resto, ciudad real (+18%)</div></div>
      <div class="control"><label>Bono diario</label>
        <div class="daily-bonus-row">
          <label class="check"><input type="checkbox" id="gearDailyOn"></label>
          <input type="number" id="gearDailyVal" value="10" min="0" max="50" step="1" disabled>
          <span class="muted micro">%</span>
        </div></div>
      <div class="control"><label>Tasa de uso (por 100 nutrición)</label>
        <input type="number" id="gearUsageFee" value="200" min="0" step="10"></div>
      <div class="control toggles">
        <label class="check"><input type="checkbox" id="gearUseJournals" checked> Usar diarios (compra vacíos / vende llenos)</label>
        <label class="check"><input type="checkbox" id="gearUseFocus"> Usar Foco (+59%)</label>
        <label class="check"><input type="checkbox" id="gearPremium" checked> Premium (impuesto 4%)</label>
        <label class="check"><input type="checkbox" id="gearSetupFee" checked> Orden de venta (+2,5%)</label>
        <label class="check"><input type="checkbox" id="gearUseBuyOrders"> Materiales con órdenes de compra</label>
      </div>
    </div>
    <div class="control-grid secondary">
      <div class="control"><label>Maestría</label><input type="number" id="gearMastery" value="0" min="0" max="100"></div>
      <div class="control"><label>Especialización (ítem)</label><input type="number" id="gearSpec" value="0" min="0" max="120"></div>
      <div class="control rrr-display">
        <label>Tasa de retorno efectiva</label>
        <div class="rrr-value" id="gearRrrValue"><span class="rrr-part"><span class="rrr-num">15,3%</span><span class="rrr-cap">todos los ítems</span></span></div>
        <div class="micro muted" id="gearRrrSub"></div>
      </div>
      <div class="control"><button class="btn primary" id="gearRefresh">↻ Actualizar precios</button>
        <div class="micro muted" id="gearUpdated"></div></div>
      <div class="control"><button class="btn shimmer" id="gearScan"><svg class="btn-ico"><use href="#i-bolt"/></svg> Escanear rentables (todas las familias)</button></div>
    </div>
  </div>

  <div class="panel filters">
    <input type="search" id="gearFamSearch" placeholder="Buscar familia… (ej: espadas, arcos, capuchas)" class="search">
    <div class="fam-chips" id="gearFamChips"></div>
  </div>

  <div class="panel filters">
    <input type="search" id="gearSearch" placeholder="Buscar ítem… (ej: claymore, daga doble)" class="search">
    <div class="chip-group" id="gearTierChips">
      <button class="chip active" data-tier="all">Todos</button>
      ${[2,3,4,5,6,7,8].map(t => `<button class="chip" data-tier="${t}">T${t}</button>`).join('')}
    </div>
    <div class="chip-group" id="gearEnchChips">
      <button class="chip active" data-ench="all">Todos</button>
      ${[0,1,2,3,4].map(l => `<button class="chip" data-ench="${l}">.${l}</button>`).join('')}
    </div>
    <label class="check small"><input type="checkbox" id="gearOnlyProfitable"> Solo rentables</label>
  </div>

  <div class="stat-row" id="gearStats"></div>

  <div class="panel table-wrap">
    <table class="ledger" id="gearTable">
      <thead><tr>
        <th class="sortable" data-sort="name">Ítem</th>
        <th>Materiales</th>
        <th class="num sortable" data-sort="cost">Costo</th>
        <th class="num sortable" data-sort="sell">Venta</th>
        <th class="num sortable" data-sort="profit">Ganancia ↓</th>
        <th class="num sortable" data-sort="margin">Margen</th>
        <th></th>
      </tr></thead>
      <tbody id="gearBody"><tr><td colspan="7" class="loading-cell">Elegí una familia arriba (o usá «Escanear rentables») para empezar.</td></tr></tbody>
    </table>
  </div>

  <div class="panel" id="gearPlannerPanel"></div>`;

  const buySel = G('BuyCity'), sellSel = G('SellCity');
  for (const c of CITIES) buySel.add(new Option(c, c));
  for (const c of [...CITIES, 'Black Market']) sellSel.add(new Option(c, c));
  buySel.value = 'Caerleon'; sellSel.value = 'Black Market';

  // chips de familias
  function renderFamChips(filter) {
    const q = (filter || '').toLowerCase();
    G('FamChips').innerHTML = D.families
      .filter(([f, es]) => !q || es.toLowerCase().includes(q) || f.includes(q))
      .map(([f, es]) => `<button class="chip fam ${GEAR.family === f ? 'active' : ''}" data-fam="${f}">${es}</button>`).join('');
  }
  renderFamChips('');
  G('FamSearch').addEventListener('input', e => renderFamChips(e.target.value));
  G('FamChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    GEAR.family = GEAR.family === c.dataset.fam ? null : c.dataset.fam;
    renderFamChips(G('FamSearch').value);
    if (GEAR.family) loadGearPrices(D.recipes.filter(r => r.family === GEAR.family));
    else renderGear();
  });

  // guía de ciudades: clic en familia
  root.querySelector('.gear-guide').addEventListener('click', e => {
    const t = e.target.closest('.fam-tag'); if (!t) return;
    GEAR.family = t.dataset.fam;
    buySel.value = t.dataset.city; sellSel.value = 'Black Market';
    G('CraftCity').value = t.dataset.city;
    G('CraftPlace').value = '0.18';
    renderFamChips(G('FamSearch').value);
    loadGearPrices(D.recipes.filter(r => r.family === GEAR.family));
  });

  // filtros
  G('TierChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    GEAR.tierF = c.dataset.tier;
    c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
    renderGear();
  });
  G('EnchChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    GEAR.enchF = c.dataset.ench;
    c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
    renderGear();
  });
  ['Search','OnlyProfitable','UseFocus','Premium','SetupFee','UseBuyOrders','UsageFee','Mastery','Spec','HideoutBonus','DailyVal','UseJournals']
    .forEach(id => G(id).addEventListener('input', () => { renderGear(); renderPlanner(); }));
  G('CraftPlace').addEventListener('change', e => {
    G('HideoutBonusWrap').style.display = e.target.value === 'hideout' ? '' : 'none';
    renderGear(); renderPlanner();
  });
  G('CraftCity').addEventListener('change', () => { renderGear(); renderPlanner(); });
  G('DailyOn').addEventListener('change', () => {
    G('DailyVal').disabled = !G('DailyOn').checked;
    renderGear(); renderPlanner();
  });
  buySel.addEventListener('change', () => { if (GEAR.family) loadGearPrices(D.recipes.filter(r => r.family === GEAR.family)); });
  sellSel.addEventListener('change', () => { if (GEAR.family) loadGearPrices(D.recipes.filter(r => r.family === GEAR.family)); else { renderGear(); renderPlanner(); } });
  G('Refresh').addEventListener('click', () => {
    const list = GEAR.family ? D.recipes.filter(r => r.family === GEAR.family) : gearVisibleRecipes();
    if (list.length) loadGearPrices(list);
  });
  G('Scan').addEventListener('click', () => {
    const list = D.recipes.filter(r =>
      (GEAR.tierF === 'all' || r.tier === +GEAR.tierF) &&
      (GEAR.enchF === 'all' || r.ench === +GEAR.enchF));
    if (list.length > 1800) {
      G('Updated').textContent = `Demasiados ítems (${list.length}). Elegí un tier o encantamiento específico para escanear.`;
      return;
    }
    GEAR.family = null;
    renderFamChips(G('FamSearch').value);
    loadGearPrices(list);
  });

  // orden
  root.querySelector('#gearTable thead').addEventListener('click', e => {
    const th = e.target.closest('.sortable'); if (!th) return;
    const k = th.dataset.sort;
    if (GEAR.sortKey === k) GEAR.sortDir *= -1; else { GEAR.sortKey = k; GEAR.sortDir = k === 'name' ? 1 : -1; }
    renderGear();
  });

  // tabla: expandir, plan, precios editables
  G('Body').addEventListener('click', e => {
    const reset = e.target.closest('.reset-price');
    if (reset) {
      delete manualPrices[mpKey(reset.dataset.pid, reset.dataset.city, reset.dataset.kind)];
      saveManual(); renderGear(); renderPlanner(); return;
    }
    if (e.target.closest('.price-edit-wrap') || e.target.classList.contains('price-edit')) return;
    const planBtn = e.target.closest('[data-plan]');
    if (planBtn) { addToPlan(planBtn.dataset.plan); e.stopPropagation(); return; }
    const tr = e.target.closest('tr.craft-row');
    if (!tr) return;
    GEAR.expanded = GEAR.expanded === tr.dataset.rid ? null : tr.dataset.rid;
    renderGear();
  });
  G('Body').addEventListener('change', e => {
    const inp = e.target.closest('.price-edit'); if (!inp) return;
    const k = mpKey(inp.dataset.pid, inp.dataset.city, inp.dataset.kind);
    const v = parseFloat(inp.value);
    if (!inp.value || isNaN(v) || v < 0) delete manualPrices[k]; else manualPrices[k] = v;
    saveManual(); renderGear(); renderPlanner();
  });

  // planeador: cantidades y quitar
  G('PlannerPanel').addEventListener('change', e => {
    const q = e.target.closest('.qty-edit'); if (!q) return;
    const p = GEAR.plan.find(x => x.id === q.dataset.qid);
    if (p) { p.qty = Math.max(1, parseInt(q.value) || 1); saveGearPlan(); renderPlanner(); }
  });
  G('PlannerPanel').addEventListener('click', e => {
    const rm = e.target.closest('[data-unplan]'); if (!rm) return;
    GEAR.plan = GEAR.plan.filter(x => x.id !== rm.dataset.unplan);
    saveGearPlan(); renderPlanner();
  });

  renderPlanner();
}

/* ---------- init ---------- */
const CRAFT_PLACES = [
  ['0', 'Isla personal (0% bono)', false],
  ['0.18', 'Ciudad real (+18%)', true],
  ['hideout', 'Hideout (bono manual)', false],
];
// Refinamiento: el bono de ciudad especializada se aplica desde «Ciudad de crafteo»
const REFINE_PLACES = [
  ['0', 'Isla personal (0% bono)', false],
  ['0.18', 'Ciudad real (+18%)', true],
  ['hideout', 'Hideout (bono manual)', false],
];

(async function init() {
  const food = createCraftModule({
    key: 'food',
    dataUrl: 'data/food_data.json',
    defaultCity: 'Caerleon',
    bonusCityNote: 'Bono de comida: Caerleon',
    dailyLabel: 'comida',
    masteryLabel: 'cocina',
    searchPlaceholder: 'Buscar comida… (ej: estofado, sopa, sándwich)',
    tiers: [1,2,3,4,5,6,7,8],
    placeOptions: CRAFT_PLACES,
    specialBonus: 0.33,
    cityChoices: ['Caerleon'], // única ciudad con bono de comida
    bonusCityOf: () => 'Caerleon', // toda la comida se bonifica en Caerleon
  });
  const alch = createCraftModule({
    key: 'alch',
    dataUrl: 'data/potion_data.json',
    defaultCity: 'Brecilien',
    bonusCityNote: 'Bono de pociones: Brecilien',
    dailyLabel: 'pociones',
    masteryLabel: 'alquimia',
    searchPlaceholder: 'Buscar poción… (ej: curación, energía, gigante)',
    tiers: [2,3,4,5,6,7,8],
    placeOptions: CRAFT_PLACES,
    specialBonus: 0.33,
    cityChoices: ['Brecilien'], // única ciudad con bono de pociones
    bonusCityOf: () => 'Brecilien', // todas las pociones se bonifican en Brecilien
  });
  const refine = createCraftModule({
    key: 'refine',
    dataUrl: 'data/refine_data.json',
    defaultCity: 'Fort Sterling',
    bonusCityNote: 'Ciudad especializada: madera Fort Sterling · mineral Thetford · piedra Bridgewatch · piel Martlock · fibra Lymhurst',
    dailyLabel: 'refinado',
    masteryLabel: 'refinamiento',
    searchPlaceholder: 'Buscar material… (ej: tablones, lingote, cuero, tela)',
    tiers: [2,3,4,5,6,7,8],
    enchLevels: [0,1,2,3,4],
    placeOptions: REFINE_PLACES,
    specialBonus: 0.58,
    bonusCityOf: r => ({ wood: 'Fort Sterling', ore: 'Thetford', rock: 'Bridgewatch', hide: 'Martlock', fiber: 'Lymhurst' })[r.cat] || null,
    cats: [['wood','Madera'],['ore','Mineral'],['rock','Piedra'],['hide','Piel'],['fiber','Fibra']],
    cityGuide: [
      { city: 'Fort Sterling', cat: 'wood',  label: 'Madera → Tablas',   icon: 'T5_PLANKS' },
      { city: 'Thetford',      cat: 'ore',   label: 'Mineral → Lingotes', icon: 'T5_METALBAR' },
      { city: 'Bridgewatch',   cat: 'rock',  label: 'Piedra → Bloques',  icon: 'T5_STONEBLOCK' },
      { city: 'Martlock',      cat: 'hide',  label: 'Piel → Cuero',      icon: 'T5_LEATHER' },
      { city: 'Lymhurst',      cat: 'fiber', label: 'Fibra → Tela',      icon: 'T5_CLOTH' },
    ],
  });

  try {
    const [foodData, potionData, refineData, gearData, catalog] = await Promise.all([
      fetchJSON('data/food_data.json'),
      fetchJSON('data/potion_data.json'),
      fetchJSON('data/refine_data.json'),
      fetchJSON('data/gear_data.json'),
      fetchJSON('data/catalog.json'),
    ]);
    food.DATA = foodData;
    alch.DATA = potionData;
    refine.DATA = refineData;
    GEAR.DATA = gearData;
    for (const r of gearData.recipes) GEAR.byId[r.id] = r;
    buildGearUI();
    CATALOG = catalog;
  } catch (e) {
    document.getElementById('foodBody').innerHTML = `<tr><td colspan="7" class="loading-cell">Error cargando datos locales: ${e.message}</td></tr>`;
    return;
  }

  // Crafteo es la pestaña inicial (carga bajo demanda); Cocina/Alquimia/Refinamiento
  // cargan precios la primera vez que se abre cada pestaña
  flipItems = [...DEFAULT_FLIPS];
  flipRestorePrefs();
  loadFlipPrices(flipItems);
  waRestart(); // retoma las alertas activas sin necesidad de abrir la pestaña
})();

/* ====================================================================
   TRANSMUTACIÓN — subir recursos de tier/encantamiento pagando plata.
   Datos oficiales de ao-bin-dumps (items.xml): 191 recetas, siempre 1→1.
   Costo real = base × (1 − descuento global) + valorÍtem × 5 × (tasa%/100)
   Descuento global = 1 − precioOro/5000 (solo si el oro < 5.000, tope 50%).
   Sin tasa de retorno ni Foco.
   ==================================================================== */
const TRANS = {
  data: null, prices: {}, gold: null, goldDate: null,
  typeF: 'all', stepF: 'all', tierF: 'all',
  sortKey: 'profit', sortDir: -1, expanded: null,
  loadedOnce: false, loading: false,
};
const TR = id => document.getElementById('trans' + id);

const TRANS_TYPE_ES = { WOOD: 'Madera', ORE: 'Mineral', HIDE: 'Piel', FIBER: 'Fibra', ROCK: 'Piedra' };

function transName(type, tier, ench) {
  return `${TRANS_TYPE_ES[type]} T${tier}${ench ? '.' + ench : ''}`;
}
function transGlobalDiscount() {
  if (!TRANS.gold || TRANS.gold >= 5000) return 0;
  return Math.min(0.5, 1 - TRANS.gold / 5000);
}
// Costo total de un paso de transmutación (plata base con descuento + tasa de estación)
function transStepCost(row) {
  const feePct = parseFloat(TR('Fee').value) || 0;
  const disc = transGlobalDiscount();
  return row.silver * (1 - disc) + row.ivOut * 5 * (feePct / 100);
}
function transPrice(id, city, kind) {
  const k = mpKey(id, city, kind);
  if (k in manualPrices) return { value: manualPrices[k], manual: true };
  const p = TRANS.prices[id]?.[city];
  if (!p || !p.sell) return { value: 0, manual: false, date: p?.sellDate };
  return { value: p.sell, manual: false, date: p.sellDate };
}
function transSellNet(gross) {
  const tax = TR('Premium').checked ? 0.04 : 0.08;
  const setup = TR('Setup').checked ? 0.025 : 0;
  return gross * (1 - tax - setup);
}

async function transLoadPrices() {
  if (TRANS.loading) return;
  TRANS.loading = true;
  TRANS.loadedOnce = true;
  TR('Body').innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando precios del mercado…</td></tr>';
  try {
    if (!TRANS.data) TRANS.data = await fetchJSON('data/transmute_data.json');
    const ids = [...new Set(TRANS.data.flatMap(r => [r.in, r.out]))];
    const [prices, gold] = await Promise.all([
      fetchPrices(ids, CITIES),
      fetchJSON(`${API}/gold.json?count=1`).catch(() => null),
    ]);
    TRANS.prices = prices;
    if (gold && gold.length) { TRANS.gold = gold[0].price; TRANS.goldDate = gold[0].timestamp; }
    renderTrans();
    renderTransRouteSelectors();
  } catch (e) {
    TR('Body').innerHTML = `<tr><td colspan="7" class="loading-cell">Error cargando precios: ${e.message}</td></tr>`;
  }
  TRANS.loading = false;
}

function transRows() {
  const buyCity = TR('BuyCity').value, sellCity = TR('SellCity').value;
  const rows = [];
  for (const r of TRANS.data) {
    if (TRANS.typeF !== 'all' && r.type !== TRANS.typeF) continue;
    const isTier = r.tt > r.ft;
    if (TRANS.stepF === 'tier' && !isTier) continue;
    if (TRANS.stepF === 'ench' && isTier) continue;
    if (TRANS.tierF !== 'all' && r.tt !== +TRANS.tierF) continue;
    const buy = transPrice(r.in, buyCity, 'buy');
    const sell = transPrice(r.out, sellCity, 'sell');
    const cost = transStepCost(r);
    const sellNet = transSellNet(sell.value);
    const profit = (buy.value && sell.value) ? sellNet - buy.value - cost : null;
    const invested = buy.value + cost;
    const margin = (profit != null && invested > 0) ? profit / invested : null;
    rows.push({ r, buy, sell, cost, sellNet, profit, margin, isTier });
  }
  const k = TRANS.sortKey, d = TRANS.sortDir;
  rows.sort((a, b) => {
    const va = k === 'cost' ? a.cost : k === 'margin' ? a.margin : a.profit;
    const vb = k === 'cost' ? b.cost : k === 'margin' ? b.margin : b.profit;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * d;
  });
  return rows;
}

function renderTrans() {
  if (!TRANS.data) return;
  const buyCity = TR('BuyCity').value, sellCity = TR('SellCity').value;
  const rows = transRows();
  const disc = transGlobalDiscount();

  // Chip informativo del oro / descuento global
  const gi = document.getElementById('transGoldInfo');
  if (TRANS.gold) {
    gi.innerHTML = `Oro: <b>${fmt(TRANS.gold)}</b> plata → descuento global sobre el costo base: <b>${(disc * 100).toFixed(1).replace('.', ',')}%</b>` +
      (disc === 0 ? ' (se activa solo si el oro cotiza bajo 5.000).' : '.') +
      ' Sin tasa de retorno ni Foco: conviene transmutar donde la tasa de estación sea baja.';
  }

  // Stats
  const withProfit = rows.filter(x => x.profit != null);
  const winners = withProfit.filter(x => x.profit > 0);
  const best = withProfit.length ? withProfit.reduce((a, b) => (b.profit > a.profit ? b : a)) : null;
  document.getElementById('transStats').innerHTML = `
    <div class="stat"><div class="k">Rentables</div><div class="v ${winners.length ? 'pos' : ''}">${winners.length} / ${withProfit.length}</div><div class="s">con precios en ambas ciudades</div></div>
    <div class="stat"><div class="k">Mejor transmutación</div><div class="v ${best && best.profit > 0 ? 'pos' : 'neg'}">${best ? fmt(best.profit) : '—'}</div><div class="s">${best ? transName(best.r.type, best.r.ft, best.r.fe) + ' → ' + transName(best.r.type, best.r.tt, best.r.te) : 'sin datos'}</div></div>
    <div class="stat"><div class="k">Descuento global</div><div class="v">${(disc * 100).toFixed(1).replace('.', ',')}%</div><div class="s">oro a ${TRANS.gold ? fmt(TRANS.gold) : '—'} plata</div></div>`;

  if (!rows.length) {
    TR('Body').innerHTML = '<tr><td colspan="7" class="loading-cell">No hay transmutaciones con estos filtros.</td></tr>';
    return;
  }

  TR('Body').innerHTML = rows.map(x => {
    const { r } = x;
    const rid = r.in + '>' + r.out;
    const exp = TRANS.expanded === rid;
    const main = `
    <tr class="craft-row clickable ${exp ? 'expanded' : ''}" data-rid="${rid}">
      <td><div class="item-cell">
        <span class="expander">${exp ? '▾' : '▸'}</span>
        ${iconImg(r.in, 'item-icon sm', transName(r.type, r.ft, r.fe))}
        <span class="muted">→</span>
        ${iconImg(r.out, 'item-icon sm', transName(r.type, r.tt, r.te))}
        <div><div class="item-name">${transName(r.type, r.ft, r.fe)} → ${transName(r.type, r.tt, r.te)}</div>
        <div class="item-meta">${TRANS_TYPE_ES[r.type]}</div></div>
      </div></td>
      <td><span class="badge">${x.isTier ? 'Tier +1' : 'Encant. +1'}</span></td>
      <td class="num">${x.buy.value ? fmt(x.buy.value) : '—'}${x.buy.manual ? ' <span class="badge gold">manual</span>' : ageBadge(x.buy.date)}</td>
      <td class="num">${fmt(x.cost)}</td>
      <td class="num">${x.sell.value ? fmt(x.sell.value) : '—'}${x.sell.manual ? ' <span class="badge gold">manual</span>' : ageBadge(x.sell.date)}</td>
      <td class="num ${x.profit == null ? '' : x.profit > 0 ? 'pos' : 'neg'}">${x.profit == null ? '—' : fmt(x.profit)}</td>
      <td class="num ${x.margin == null ? '' : x.margin > 0 ? 'pos' : 'neg'}">${x.margin == null ? '—' : pct(x.margin)}</td>
    </tr>`;
    if (!exp) return main;
    const feePct = parseFloat(TR('Fee').value) || 0;
    return main + `
    <tr class="detail-tr"><td colspan="7"><div class="craft-detail">
      <div class="cd-section cd-summary">
        <div class="cd-title">Desglose por unidad</div>
        <div class="cd-line"><span>Compra ${transName(r.type, r.ft, r.fe)} (${buyCity})</span>
          <span class="price-edit-wrap">
            <input type="number" class="price-edit ${x.buy.manual ? 'manual' : ''}" value="${x.buy.value || ''}" placeholder="—" data-pid="${r.in}" data-city="${buyCity}" data-kind="buy">
            ${x.buy.manual ? `<button class="reset-price" title="Volver al precio de la API" data-pid="${r.in}" data-city="${buyCity}" data-kind="buy">↺</button>` : ''}
          </span></div>
        <div class="cd-line"><span>Costo base oficial</span><span>${fmt(r.silver)}</span></div>
        <div class="cd-line"><span>Descuento global (oro ${TRANS.gold ? fmt(TRANS.gold) : '—'})</span><span>−${fmt(r.silver * transGlobalDiscount())}</span></div>
        <div class="cd-line"><span>Tasa de estación (valor ${r.ivOut} × 5 × ${feePct}%)</span><span>${fmt(r.ivOut * 5 * feePct / 100)}</span></div>
        <div class="cd-line"><span>Venta ${transName(r.type, r.tt, r.te)} (${sellCity})</span>
          <span class="price-edit-wrap">
            <input type="number" class="price-edit ${x.sell.manual ? 'manual' : ''}" value="${x.sell.value || ''}" placeholder="—" data-pid="${r.out}" data-city="${sellCity}" data-kind="sell">
            ${x.sell.manual ? `<button class="reset-price" title="Volver al precio de la API" data-pid="${r.out}" data-city="${sellCity}" data-kind="sell">↺</button>` : ''}
          </span></div>
        <div class="cd-line"><span>Venta neta (impuestos descontados)</span><span>${fmt(x.sellNet)}</span></div>
        <div class="cd-line total"><span>Ganancia por unidad</span><span class="${x.profit == null ? '' : x.profit > 0 ? 'pos' : 'neg'}">${x.profit == null ? '—' : fmt(x.profit)}</span></div>
        <div class="cd-actions">
          ${x.buy.value ? `<button class="btn micro-btn" onclick="llPrefill('${r.in}','buy',${x.buy.value},'${buyCity}')" title="Anotar la compra del recurso de origen en el Registro">✎ Registrar compra</button>` : ''}
          ${x.sell.value ? `<button class="btn micro-btn" onclick="llPrefill('${r.out}','sell',${x.sell.value},'${sellCity}')" title="Anotar la venta del recurso transmutado en el Registro">✎ Registrar venta</button>` : ''}
          ${favBtnHtml('transmute', r.out, transName(r.type, r.tt, r.te))}
        </div>
      </div>
    </div></td></tr>`;
  }).join('');
}

/* ---- Planificador de ruta ---- */
function transNodesOf(type) {
  // nodos (tier, ench) válidos para el tipo, según las recetas existentes
  const set = new Map();
  for (const r of TRANS.data) {
    if (r.type !== type) continue;
    set.set(r.ft + '.' + r.fe, { t: r.ft, e: r.fe });
    set.set(r.tt + '.' + r.te, { t: r.tt, e: r.te });
  }
  return set;
}
function transIdOf(type, t, e) {
  const base = `T${t}_${type}`;
  return e ? `${base}_LEVEL${e}@${e}` : base;
}
function renderTransRouteSelectors() {
  const type = document.getElementById('routeType').value;
  const nodes = TRANS.data ? transNodesOf(type) : new Map();
  const tiers = [...new Set([...nodes.values()].map(n => n.t))].sort();
  const tSel = document.getElementById('routeTier');
  const prevT = tSel.value;
  tSel.innerHTML = tiers.map(t => `<option value="${t}">T${t}</option>`).join('');
  if (tiers.includes(+prevT)) tSel.value = prevT; else tSel.value = tiers[tiers.length - 1] || '';
  const enchs = [...new Set([...nodes.values()].filter(n => n.t === +tSel.value).map(n => n.e))].sort();
  const eSel = document.getElementById('routeEnch');
  const prevE = eSel.value;
  eSel.innerHTML = enchs.map(e => `<option value="${e}">${e === 0 ? 'Sin encantar (.0)' : '.' + e}</option>`).join('');
  if (enchs.includes(+prevE)) eSel.value = prevE;
}
function transRoutes() {
  const type = document.getElementById('routeType').value;
  const dt = +document.getElementById('routeTier').value;
  const de = +document.getElementById('routeEnch').value;
  const buyCity = TR('BuyCity').value;
  // Dijkstra hacia atrás desde el destino: costo mínimo de transmutación desde cada nodo
  const edges = TRANS.data.filter(r => r.type === type);
  const cost = { [dt + '.' + de]: 0 };
  const stepOf = {};
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of edges) {
      const from = r.ft + '.' + r.fe, to = r.tt + '.' + r.te;
      if (!(to in cost)) continue;
      const c = cost[to] + transStepCost(r);
      if (!(from in cost) || c < cost[from] - 1e-9) {
        cost[from] = c; stepOf[from] = r; changed = true;
      }
    }
  }
  // Cada nodo alcanzable = una ruta: comprar ahí + transmutar hasta el destino
  const routes = [];
  for (const key of Object.keys(cost)) {
    const [t, e] = key.split('.').map(Number);
    const id = transIdOf(type, t, e);
    const buy = transPrice(id, buyCity, 'buy');
    if (!buy.value) continue;
    // reconstruir cadena de pasos
    const steps = [];
    let cur = key;
    while (stepOf[cur]) {
      const r = stepOf[cur];
      steps.push(r);
      cur = r.tt + '.' + r.te;
    }
    routes.push({ t, e, id, buy, transCost: cost[key], total: buy.value + cost[key], steps });
  }
  routes.sort((a, b) => a.total - b.total);
  return { routes, type, dt, de };
}
function renderTransRoutes() {
  const box = document.getElementById('routeResults');
  if (!TRANS.data || !Object.keys(TRANS.prices).length) {
    box.innerHTML = '<div class="micro muted">Primero actualizá los precios de la tabla.</div>';
    return;
  }
  const { routes, type, dt, de } = transRoutes();
  if (!routes.length) {
    box.innerHTML = '<div class="micro muted">No hay precios de compra disponibles para ningún origen.</div>';
    return;
  }
  const bestTotal = routes[0].total;
  box.innerHTML = `
  <div class="table-wrap"><table class="ledger">
    <thead><tr><th>Origen</th><th>Cadena</th><th class="num">Compra origen</th><th class="num">Transmutaciones</th><th class="num">Costo total</th><th class="num">vs. mejor</th></tr></thead>
    <tbody>${routes.map((rt, i) => {
      const chain = [transName(type, rt.t, rt.e), ...rt.steps.map(s => transName(type, s.tt, s.te))].join(' → ');
      const diff = rt.total - bestTotal;
      const isDirect = rt.steps.length === 0;
      return `<tr>
        <td><div class="item-cell">${iconImg(rt.id, 'item-icon sm')}<div>
          <div class="item-name">${transName(type, rt.t, rt.e)}${isDirect ? ' <span class="badge gold">directo</span>' : ''}${i === 0 ? ' <span class="badge" style="color:var(--green);border-color:rgba(20,185,138,.4)">más barato</span>' : ''}</div>
          <div class="item-meta">${rt.steps.length} transmutación${rt.steps.length === 1 ? '' : 'es'}</div>
        </div></div></td>
        <td class="micro muted" style="max-width:340px">${chain}</td>
        <td class="num">${fmt(rt.buy.value)}${rt.buy.manual ? ' <span class="badge gold">manual</span>' : ''}</td>
        <td class="num">${fmt(rt.transCost)}</td>
        <td class="num"><b>${fmt(rt.total)}</b></td>
        <td class="num ${diff === 0 ? 'pos' : 'neg'}">${diff === 0 ? '✓' : '+' + fmt(diff)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  <div class="micro muted pad">Costo total = compra del origen en ${TR('BuyCity').value} + todas las transmutaciones de la cadena (con descuento global y tasa de estación actuales). El destino es ${transName(type, dt, de)}.</div>`;
}

/* ---- eventos ---- */
(function initTrans() {
  TR('BuyCity').innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');
  TR('SellCity').innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');

  TR('Refresh').addEventListener('click', transLoadPrices);
  for (const id of ['BuyCity', 'SellCity', 'Fee']) TR(id).addEventListener('change', () => { renderTrans(); });
  TR('Premium').addEventListener('change', renderTrans);
  TR('Setup').addEventListener('change', renderTrans);

  document.getElementById('transTypeChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    TRANS.typeF = chip.dataset.type;
    document.querySelectorAll('#transTypeChips .chip').forEach(c => c.classList.toggle('active', c === chip));
    renderTrans();
  });
  document.getElementById('transStepChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    TRANS.stepF = chip.dataset.step;
    document.querySelectorAll('#transStepChips .chip').forEach(c => c.classList.toggle('active', c === chip));
    renderTrans();
  });
  TR('TierF').addEventListener('change', () => { TRANS.tierF = TR('TierF').value; renderTrans(); });

  document.querySelectorAll('#transTable th.sortable').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (TRANS.sortKey === k) TRANS.sortDir *= -1; else { TRANS.sortKey = k; TRANS.sortDir = k === 'cost' ? 1 : -1; }
    renderTrans();
  }));

  TR('Body').addEventListener('click', e => {
    const reset = e.target.closest('.reset-price');
    if (reset) {
      delete manualPrices[mpKey(reset.dataset.pid, reset.dataset.city, reset.dataset.kind)];
      saveManual(); renderTrans(); return;
    }
    if (e.target.closest('.price-edit-wrap') || e.target.classList.contains('price-edit')) return;
    const tr = e.target.closest('tr.craft-row'); if (!tr) return;
    TRANS.expanded = TRANS.expanded === tr.dataset.rid ? null : tr.dataset.rid;
    renderTrans();
  });
  TR('Body').addEventListener('change', e => {
    const inp = e.target.closest('.price-edit'); if (!inp) return;
    const k = mpKey(inp.dataset.pid, inp.dataset.city, inp.dataset.kind);
    const v = parseFloat(inp.value);
    if (!inp.value || isNaN(v) || v < 0) delete manualPrices[k]; else manualPrices[k] = v;
    saveManual(); renderTrans();
  });

  document.getElementById('routeType').addEventListener('change', renderTransRouteSelectors);
  document.getElementById('routeTier').addEventListener('change', renderTransRouteSelectors);
  document.getElementById('routeCalc').addEventListener('click', renderTransRoutes);

  // registro para el lazy-load de gotoTab
  craftModules['transmute'] = { get loadedOnce() { return TRANS.loadedOnce; }, loadPrices: transLoadPrices };
})();

/* ====================================================================
   ARTEFACTOS — fusión (melding) en el Transmutador de artefactos.
   Datos oficiales de ao-bin-dumps: 440 artefactos de runa/alma/reliquia.
   Mecánica (wiki oficial): 36 fragmentos → artefacto aleatorio entre
   todas las categorías; 50 fragmentos → aleatorio dentro de la categoría
   elegida (Guerrero/Cazador/Mago). Distribución uniforme en el pool.
   Sin plata, sin Foco, sin tasa de retorno.
   EV = Σ(venta neta de cada artefacto) / n ; ganancia esp. = EV − costo.
   ==================================================================== */
const MELD = {
  data: null, prices: {},
  fragF: 'all', tierF: 'all',
  sortKey: 'profit', sortDir: -1, expanded: null,
  loadedOnce: false, loading: false,
};
const MD = id => document.getElementById('meld' + id);

const MELD_FRAG_ES = { RUNE: 'Runas', SOUL: 'Almas', RELIC: 'Reliquias' };
const MELD_FRAG_ONE = { RUNE: 'runa', SOUL: 'alma', RELIC: 'reliquia' };
const MELD_CAT_ES = { warrior: 'Guerrero', hunter: 'Cazador', mage: 'Mago', all: 'Todas' };

function meldFragId(frag, tier) { return `T${tier}_${frag}`; }
function meldNameOf(id) {
  if (!CATALOG) return id;
  const row = CATALOG.find(r => r[0] === id);
  return row ? row[1] : id;
}
function meldPrice(id, city, kind) {
  const k = mpKey(id, city, kind);
  if (k in manualPrices) return { value: manualPrices[k], manual: true };
  const p = MELD.prices[id]?.[city];
  if (!p || !p.sell) return { value: 0, manual: false, date: p?.sellDate };
  return { value: p.sell, manual: false, date: p.sellDate };
}
function meldSellNet(gross) {
  const tax = MD('Premium').checked ? 0.04 : 0.08;
  const setup = MD('Setup').checked ? 0.025 : 0;
  return gross * (1 - tax - setup);
}

async function meldLoadPrices() {
  if (MELD.loading) return;
  MELD.loading = true;
  MELD.loadedOnce = true;
  MD('Body').innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando precios del mercado…</td></tr>';
  try {
    if (!MELD.data) MELD.data = await fetchJSON('data/meld_data.json');
    const ids = [...new Set([
      ...MELD.data.filter(a => a.mkt).map(a => a.id),
      ...['RUNE', 'SOUL', 'RELIC'].flatMap(f => [4, 5, 6, 7, 8].map(t => meldFragId(f, t))),
    ])];
    MELD.prices = await fetchPrices(ids, CITIES);
    renderMeld();
    renderMeldSimSelector();
  } catch (e) {
    MD('Body').innerHTML = `<tr><td colspan="7" class="loading-cell">Error cargando precios: ${e.message}</td></tr>`;
  }
  MELD.loading = false;
}

// Estrategias: por cada (fragmento, tier) → 36 aleatorio + 50 por categoría
function meldStrategies() {
  const buyCity = MD('BuyCity').value, sellCity = MD('SellCity').value;
  const out = [];
  for (const frag of ['RUNE', 'SOUL', 'RELIC']) {
    if (MELD.fragF !== 'all' && MELD.fragF !== frag) continue;
    for (const tier of [4, 5, 6, 7, 8]) {
      if (MELD.tierF !== 'all' && +MELD.tierF !== tier) continue;
      const fragPrice = meldPrice(meldFragId(frag, tier), buyCity, 'buy');
      for (const cat of ['all', 'warrior', 'hunter', 'mage']) {
        const n = cat === 'all' ? 36 : 50;
        const pool = MELD.data.filter(a => a.frag === frag && a.tier === tier && (cat === 'all' || a.cat === cat));
        if (!pool.length) continue;
        // valor neto de cada resultado posible (no comerciable = 0)
        const values = pool.map(a => a.mkt ? meldSellNet(meldPrice(a.id, sellCity, 'sell').value) : 0);
        const priced = pool.filter((a, i) => a.mkt && meldPrice(a.id, sellCity, 'sell').value > 0).length;
        const ev = values.reduce((s, v) => s + v, 0) / pool.length;
        const cost = fragPrice.value ? fragPrice.value * n : null;
        const profit = cost != null ? ev - cost : null;
        const margin = (profit != null && cost > 0) ? profit / cost : null;
        const winrate = cost != null ? values.filter(v => v > cost).length / values.length : null;
        // desviación estándar del pool (para el simulador)
        const variance = values.reduce((s, v) => s + (v - ev) ** 2, 0) / values.length;
        out.push({ frag, tier, cat, n, pool, values, priced, ev, cost, profit, margin, winrate, sd: Math.sqrt(variance), fragPrice });
      }
    }
  }
  const k = MELD.sortKey, d = MELD.sortDir;
  out.sort((a, b) => {
    const va = a[k === 'cost' ? 'cost' : k === 'margin' ? 'margin' : k === 'winrate' ? 'winrate' : 'profit'];
    const vb = b[k === 'cost' ? 'cost' : k === 'margin' ? 'margin' : k === 'winrate' ? 'winrate' : 'profit'];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * d;
  });
  return out;
}
function meldStratKey(s) { return `${s.frag}|${s.tier}|${s.cat}`; }
function meldStratName(s) {
  return `${MELD_FRAG_ES[s.frag]} T${s.tier} — ${s.cat === 'all' ? '36 aleatorio total' : '50 ' + MELD_CAT_ES[s.cat]}`;
}

function renderMeld() {
  if (!MELD.data) return;
  const buyCity = MD('BuyCity').value, sellCity = MD('SellCity').value;
  const strats = meldStrategies();

  const withProfit = strats.filter(s => s.profit != null);
  const winners = withProfit.filter(s => s.profit > 0);
  const best = withProfit.length ? withProfit.reduce((a, b) => (b.profit > a.profit ? b : a)) : null;
  document.getElementById('meldStats').innerHTML = `
    <div class="stat"><div class="k">Estrategias rentables</div><div class="v ${winners.length ? 'pos' : ''}">${winners.length} / ${withProfit.length}</div><div class="s">con precio de fragmento en ${buyCity}</div></div>
    <div class="stat"><div class="k">Mejor estrategia</div><div class="v ${best && best.profit > 0 ? 'pos' : 'neg'}">${best ? fmt(best.profit) : '—'}</div><div class="s">${best ? meldStratName(best) : 'sin datos'}</div></div>
    <div class="stat"><div class="k">Venta de artefactos</div><div class="v">${sellCity}</div><div class="s">impuestos ya descontados del EV</div></div>`;

  if (!strats.length) {
    MD('Body').innerHTML = '<tr><td colspan="7" class="loading-cell">No hay estrategias con estos filtros.</td></tr>';
    return;
  }

  MD('Body').innerHTML = strats.map(s => {
    const rid = meldStratKey(s);
    const exp = MELD.expanded === rid;
    const fragId = meldFragId(s.frag, s.tier);
    const main = `
    <tr class="craft-row clickable ${exp ? 'expanded' : ''}" data-rid="${rid}">
      <td><div class="item-cell">
        <span class="expander">${exp ? '▾' : '▸'}</span>
        ${iconImg(fragId, 'item-icon sm', MELD_FRAG_ES[s.frag] + ' T' + s.tier)}
        <div><div class="item-name">${MELD_FRAG_ES[s.frag]} T${s.tier} · ${s.cat === 'all' ? '36 aleatorio' : '50 ' + MELD_CAT_ES[s.cat]}</div>
        <div class="item-meta">${s.n} × ${MELD_FRAG_ONE[s.frag]} ${s.fragPrice.value ? 'a ' + fmt(s.fragPrice.value) : 'sin precio'}${s.fragPrice.manual ? ' (manual)' : ''}</div></div>
      </div></td>
      <td><span class="badge">${s.pool.length} artefactos</span>${s.priced < s.pool.length ? `<span class="price-sub">${s.pool.length - s.priced} sin precio</span>` : ''}</td>
      <td class="num">${s.cost != null ? fmt(s.cost) : '—'}</td>
      <td class="num">${fmt(s.ev)}</td>
      <td class="num ${s.profit == null ? '' : s.profit > 0 ? 'pos' : 'neg'}">${s.profit == null ? '—' : fmt(s.profit)}</td>
      <td class="num ${s.margin == null ? '' : s.margin > 0 ? 'pos' : 'neg'}">${s.margin == null ? '—' : pct(s.margin)}</td>
      <td class="num">${s.winrate == null ? '—' : pct(s.winrate)}</td>
    </tr>`;
    if (!exp) return main;
    const sorted = [...s.pool].map((a, i) => ({ a, v: s.values[i] })).sort((x, y) => y.v - x.v);
    const median = [...s.values].sort((a, b) => a - b)[Math.floor(s.values.length / 2)];
    return main + `
    <tr class="detail-tr"><td colspan="7"><div class="craft-detail">
      <div class="cd-section">
        <div class="cd-title">Pool: ${s.pool.length} artefactos equiprobables (${pct(1 / s.pool.length)} cada uno) — venta en ${sellCity}</div>
        <table class="cd-table ledger"><thead><tr><th>Artefacto</th><th class="num">Precio venta</th><th class="num">Neto</th><th class="num">Resultado de la tirada</th></tr></thead>
        <tbody>${sorted.map(({ a, v }) => {
          const p = meldPrice(a.id, sellCity, 'sell');
          const res = s.cost != null ? v - s.cost : null;
          return `<tr>
            <td><div class="item-cell">${iconImg(a.id, 'item-icon sm', a.id)}<div>
              <div>${meldNameOf(a.id)}</div>
              ${a.mkt ? '' : '<div class="item-meta">no comerciable — vale 0</div>'}
            </div></div></td>
            <td class="num">${a.mkt ? `<span class="price-edit-wrap">
              <input type="number" class="price-edit ${p.manual ? 'manual' : ''}" value="${p.value || ''}" placeholder="—" data-pid="${a.id}" data-city="${sellCity}" data-kind="sell">
              ${p.manual ? `<button class="reset-price" title="Volver al precio de la API" data-pid="${a.id}" data-city="${sellCity}" data-kind="sell">↺</button>` : ''}
            </span>` : '—'}</td>
            <td class="num">${a.mkt && p.value ? fmt(v) : '—'}</td>
            <td class="num ${res == null ? '' : res > 0 ? 'pos' : 'neg'}">${res == null ? '—' : fmt(res)}</td>
          </tr>`;
        }).join('')}</tbody></table>
      </div>
      <div class="cd-section cd-summary">
        <div class="cd-title">Resumen de la estrategia</div>
        <div class="cd-line"><span>Costo tirada (${s.n} × ${fmt(s.fragPrice.value)})</span><span>${s.cost != null ? fmt(s.cost) : '—'}</span></div>
        <div class="cd-line"><span>Valor esperado (promedio del pool)</span><span>${fmt(s.ev)}</span></div>
        <div class="cd-line"><span>Mediana (resultado típico)</span><span>${fmt(median)}</span></div>
        <div class="cd-line"><span>Mejor resultado</span><span class="pos">${fmt(Math.max(...s.values))}</span></div>
        <div class="cd-line"><span>Peor resultado</span><span class="neg">${fmt(Math.min(...s.values))}</span></div>
        <div class="cd-line"><span>Desviación estándar</span><span>${fmt(s.sd)}</span></div>
        <div class="cd-line"><span>Tiradas que cubren el costo</span><span>${s.winrate == null ? '—' : pct(s.winrate)}</span></div>
        <div class="cd-line total"><span>Ganancia esperada por tirada</span><span class="${s.profit == null ? '' : s.profit > 0 ? 'pos' : 'neg'}">${s.profit == null ? '—' : fmt(s.profit)}</span></div>
      </div>
    </div></td></tr>`;
  }).join('');
}

/* ---- simulador de sesión ---- */
function renderMeldSimSelector() {
  const sel = document.getElementById('simStrategy');
  const prev = sel.value;
  const strats = [];
  for (const frag of ['RUNE', 'SOUL', 'RELIC'])
    for (const tier of [4, 5, 6, 7, 8])
      for (const cat of ['all', 'warrior', 'hunter', 'mage'])
        strats.push({ frag, tier, cat });
  sel.innerHTML = strats.map(s =>
    `<option value="${s.frag}|${s.tier}|${s.cat}">${MELD_FRAG_ES[s.frag]} T${s.tier} — ${s.cat === 'all' ? '36 aleatorio total' : '50 ' + MELD_CAT_ES[s.cat]}</option>`
  ).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}
function renderMeldSim() {
  const box = document.getElementById('simResults');
  if (!MELD.data || !Object.keys(MELD.prices).length) {
    box.innerHTML = '<div class="micro muted">Primero actualizá los precios de la tabla.</div>';
    return;
  }
  const [frag, tier, cat] = document.getElementById('simStrategy').value.split('|');
  const rolls = Math.max(1, parseInt(document.getElementById('simRolls').value) || 1);
  // recalcular la estrategia puntual con los filtros actuales ignorados
  const saveF = MELD.fragF, saveT = MELD.tierF;
  MELD.fragF = frag; MELD.tierF = tier;
  const strats = meldStrategies().filter(s => s.cat === cat);
  MELD.fragF = saveF; MELD.tierF = saveT;
  if (!strats.length || strats[0].cost == null) {
    box.innerHTML = '<div class="micro muted">No hay precio del fragmento en la ciudad de compra: cargá uno manual en la tabla.</div>';
    return;
  }
  const s = strats[0];
  const totCost = s.cost * rolls;
  const totEV = s.ev * rolls;
  const totProfit = s.profit * rolls;
  // suma de N variables iid: sd_total = sd × √N
  const sdTot = s.sd * Math.sqrt(rolls);
  const lo = totEV - sdTot, hi = totEV + sdTot;
  const fragsNeeded = s.n * rolls;
  box.innerHTML = `
  <div class="stat-row">
    <div class="stat"><div class="k">Inversión total</div><div class="v">${fmt(totCost)}</div><div class="s">${fmt(fragsNeeded)} ${MELD_FRAG_ONE[s.frag]}s × ${fmt(s.fragPrice.value)}</div></div>
    <div class="stat"><div class="k">Retorno esperado</div><div class="v">${fmt(totEV)}</div><div class="s">rango probable: ${fmt(lo)} — ${fmt(hi)}</div></div>
    <div class="stat"><div class="k">Ganancia esperada</div><div class="v ${totProfit > 0 ? 'pos' : 'neg'}">${fmt(totProfit)}</div><div class="s">rango: ${fmt(lo - totCost)} — ${fmt(hi - totCost)}</div></div>
    <div class="stat"><div class="k">Incertidumbre</div><div class="v">±${fmt(sdTot)}</div><div class="s">±1 desv. estándar sobre ${rolls} tirada${rolls === 1 ? '' : 's'}</div></div>
  </div>
  <div class="micro muted">Estrategia: ${meldStratName(s)}. El rango cubre ~68% de los casos; con ${rolls} tirada${rolls === 1 ? '' : 's'} la incertidumbre relativa es ${pct(totEV > 0 ? sdTot / totEV : 0)} del retorno esperado${rolls < 30 ? ' — con pocas tiradas la suerte pesa mucho' : ''}.</div>`;
}

/* ---- eventos ---- */
(function initMeld() {
  MD('BuyCity').innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');
  MD('SellCity').innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');

  MD('Refresh').addEventListener('click', meldLoadPrices);
  for (const id of ['BuyCity', 'SellCity']) MD(id).addEventListener('change', renderMeld);
  MD('Premium').addEventListener('change', renderMeld);
  MD('Setup').addEventListener('change', renderMeld);

  document.getElementById('meldFragChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    MELD.fragF = chip.dataset.frag;
    document.querySelectorAll('#meldFragChips .chip').forEach(c => c.classList.toggle('active', c === chip));
    renderMeld();
  });
  MD('TierF').addEventListener('change', () => { MELD.tierF = MD('TierF').value; renderMeld(); });

  document.querySelectorAll('#meldTable th.sortable').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (MELD.sortKey === k) MELD.sortDir *= -1; else { MELD.sortKey = k; MELD.sortDir = k === 'cost' ? 1 : -1; }
    renderMeld();
  }));

  MD('Body').addEventListener('click', e => {
    const reset = e.target.closest('.reset-price');
    if (reset) {
      delete manualPrices[mpKey(reset.dataset.pid, reset.dataset.city, reset.dataset.kind)];
      saveManual(); renderMeld(); return;
    }
    if (e.target.closest('.price-edit-wrap') || e.target.classList.contains('price-edit')) return;
    const tr = e.target.closest('tr.craft-row'); if (!tr) return;
    MELD.expanded = MELD.expanded === tr.dataset.rid ? null : tr.dataset.rid;
    renderMeld();
  });
  MD('Body').addEventListener('change', e => {
    const inp = e.target.closest('.price-edit'); if (!inp) return;
    const k = mpKey(inp.dataset.pid, inp.dataset.city, inp.dataset.kind);
    const v = parseFloat(inp.value);
    if (!inp.value || isNaN(v) || v < 0) delete manualPrices[k]; else manualPrices[k] = v;
    saveManual(); renderMeld();
  });

  document.getElementById('simCalc').addEventListener('click', renderMeldSim);
  renderMeldSimSelector();

  // registro para el lazy-load de gotoTab
  craftModules['meld'] = { get loadedOnce() { return MELD.loadedOnce; }, loadPrices: meldLoadPrices };
})();

/* ====================================================================
   BOTONES GLOBALES DE LA BARRA (buscador de precios / registro)
   ==================================================================== */
document.querySelectorAll('.top-action').forEach(btn =>
  btn.addEventListener('click', () => gotoTab(btn.dataset.tab)));

/* ====================================================================
   BUSCADOR GLOBAL DE PRECIOS
   Venta más barata y mejor orden de compra por ciudad × calidad.
   ==================================================================== */
const PS = { item: null, ench: 0, data: null, history: [] };
try { PS.history = JSON.parse(localStorage.getItem('psHistory') || '[]'); } catch (e) {}

const QUALITY_ES = { 1: 'Normal', 2: 'Buena', 3: 'Notable', 4: 'Excelente', 5: 'Obra maestra' };
const PS_CITIES = [...CITIES, 'Black Market'];

function psSaveHistory(id, name) {
  PS.history = [[id, name], ...PS.history.filter(h => h[0] !== id)].slice(0, 10);
  localStorage.setItem('psHistory', JSON.stringify(PS.history));
  psRenderHistory();
}
function psRenderHistory() {
  document.getElementById('psHistory').innerHTML =
    PS.history.map(([id, n]) => `<button class="fam-tag" data-id="${id}">${n}</button>`).join('');
}
async function psLoad() {
  if (!PS.item) return;
  const box = document.getElementById('psResult');
  box.innerHTML = '<div class="panel"><div class="loading-cell">Cargando precios…</div></div>';
  const id = PS.item + (PS.ench > 0 ? '@' + PS.ench : '');
  try {
    // sin filtro de calidad → devuelve todas
    const data = await fetchJSON(`${API}/prices/${id}.json?locations=${PS_CITIES.map(c => c.replace(' ', '%20')).join(',')}`);
    PS.data = data;
    psRender(id);
  } catch (e) {
    box.innerHTML = `<div class="panel"><div class="loading-cell">Error: ${e.message}</div></div>`;
  }
}
function psRender(id) {
  const box = document.getElementById('psResult');
  const row = CATALOG.find(r => r[0] === PS.item);
  const name = row ? row[1] : PS.item;
  // organizar: city → quality → {sell, buy}
  const grid = {};
  for (const r of PS.data) {
    (grid[r.city] = grid[r.city] || {})[r.quality] = {
      sell: r.sell_price_min, sellD: r.sell_price_min_date,
      buy: r.buy_price_max, buyD: r.buy_price_max_date,
    };
  }
  const cities = PS_CITIES.filter(c => grid[c]);
  if (!cities.length) {
    box.innerHTML = '<div class="panel"><div class="loading-cell">Sin datos de mercado para este ítem.</div></div>';
    return;
  }
  // mejor precio de venta global (para resaltar)
  let bestSell = Infinity, bestBuy = 0;
  for (const c of cities) for (const q in grid[c]) {
    const v = grid[c][q];
    if (v.sell > 0 && v.sell < bestSell) bestSell = v.sell;
    if (v.buy > bestBuy) bestBuy = v.buy;
  }
  box.innerHTML = `
  <div class="panel table-wrap">
    <div class="flip-head" style="padding:14px 14px 4px">
      <div class="item-cell">${iconImg(id, 'item-icon')}<div>
        <div class="item-name">${name}${PS.ench ? ' .' + PS.ench : ''}</div>
        <div class="item-meta">${id} · venta más barata: <b class="pos">${fmt(bestSell === Infinity ? null : bestSell)}</b> · mejor orden de compra: <b>${fmt(bestBuy || null)}</b></div>
      </div></div>
    </div>
    <table class="ledger">
      <thead><tr><th>Ciudad</th><th>Calidad</th><th class="num">Venta (más barato)</th><th class="num">Orden de compra (mejor)</th></tr></thead>
      <tbody>${cities.map(c => {
        const quals = Object.keys(grid[c]).map(Number).sort();
        return quals.map((q, i) => {
          const v = grid[c][q];
          if (!v.sell && !v.buy) return '';
          return `<tr>
            ${i === 0 ? `<td rowspan="${quals.filter(qq => grid[c][qq].sell || grid[c][qq].buy).length}"><b>${c}</b></td>` : ''}
            <td>${QUALITY_ES[q] || q}</td>
            <td class="num ${v.sell && v.sell === bestSell ? 'pos' : ''}">${v.sell ? fmt(v.sell) : '—'}${v.sell ? ageBadge(v.sellD) : ''}</td>
            <td class="num ${v.buy && v.buy === bestBuy ? 'pos' : ''}">${v.buy ? fmt(v.buy) : '—'}${v.buy ? ageBadge(v.buyD) : ''}</td>
          </tr>`;
        }).join('');
      }).join('')}</tbody>
    </table>
    <div class="micro muted pad">El Mercado Negro solo compra (órdenes de compra). Los precios con más de 1 día pueden estar desactualizados.</div>
  </div>`;
}
(function initPS() {
  const inp = document.getElementById('psSearch');
  const res = document.getElementById('psResults');
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2 || !CATALOG) { res.classList.remove('open'); return; }
    const hits = [];
    for (const [id, es, en, tier] of CATALOG) {
      if (es.toLowerCase().includes(q) || en.toLowerCase().includes(q) || id.toLowerCase().includes(q)) {
        hits.push([id, es, tier]);
        if (hits.length >= 25) break;
      }
    }
    res.innerHTML = hits.map(([id, es, tier]) =>
      `<div class="sr-item" data-id="${id}" data-name="${es}">
        ${iconImg(id, 'item-icon sm')}
        <div><div class="n">${es}</div><div class="m">T${tier} · ${id}</div></div>
      </div>`).join('');
    res.classList.toggle('open', hits.length > 0);
  });
  res.addEventListener('click', e => {
    const it = e.target.closest('.sr-item'); if (!it) return;
    PS.item = it.dataset.id;
    inp.value = it.dataset.name;
    res.classList.remove('open');
    psSaveHistory(it.dataset.id, it.dataset.name);
    psLoad();
  });
  document.getElementById('psHistory').addEventListener('click', e => {
    const t = e.target.closest('.fam-tag'); if (!t) return;
    PS.item = t.dataset.id;
    inp.value = t.textContent;
    psLoad();
  });
  document.getElementById('psEnch').addEventListener('change', e => { PS.ench = +e.target.value; if (PS.item) psLoad(); });
  document.getElementById('psRefresh').addEventListener('click', psLoad);
  psRenderHistory();
})();

/* ====================================================================
   REGISTRO DE OPERACIONES (personal, localStorage)
   ==================================================================== */
const LL = { rows: [], filter: 'all', item: null };
try { LL.rows = JSON.parse(localStorage.getItem('tradeLog') || '[]'); } catch (e) {}
function llSave() { localStorage.setItem('tradeLog', JSON.stringify(LL.rows)); }

/* Prefill desde otras pestañas: botones «Registrar» en Flipping/Crafteo */
function llPrefill(id, type, price, city) {
  LL.item = id;
  document.getElementById('llItem').value = catalogName(id);
  document.getElementById('llType').value = type;
  document.getElementById('llQty').value = 1;
  document.getElementById('llPrice').value = price && isFinite(price) ? Math.round(price) : '';
  const sel = document.getElementById('llCity');
  sel.value = city && [...sel.options].some(o => o.value === city) ? city : '—';
  gotoTab('ledgerlog');
  document.getElementById('llQty').focus();
}
const LL_TYPE_ES = { buy: 'Compra', sell: 'Venta', craft: 'Crafteo' };

function llRender() {
  const rows = LL.rows.filter(r => LL.filter === 'all' || r.type === LL.filter);
  // stats: P&L = ventas − compras − crafteos
  const sum = t => LL.rows.filter(r => r.type === t).reduce((s, r) => s + r.qty * r.price, 0);
  const bought = sum('buy'), sold = sum('sell'), crafted = sum('craft');
  const pnl = sold - bought - crafted;
  const DAY = 86400e3;
  const last7 = LL.rows.filter(r => Date.now() - r.ts < 7 * DAY);
  const pnl7 = last7.filter(r => r.type === 'sell').reduce((s, r) => s + r.qty * r.price, 0)
             - last7.filter(r => r.type !== 'sell').reduce((s, r) => s + r.qty * r.price, 0);
  document.getElementById('llStats').innerHTML = `
    <div class="stat"><div class="k">Invertido (compras + crafteos)</div><div class="v">${fmt(bought + crafted)}</div><div class="s">${LL.rows.filter(r => r.type !== 'sell').length} operaciones</div></div>
    <div class="stat"><div class="k">Recuperado (ventas)</div><div class="v">${fmt(sold)}</div><div class="s">${LL.rows.filter(r => r.type === 'sell').length} ventas</div></div>
    <div class="stat"><div class="k">P&L total</div><div class="v ${pnl >= 0 ? 'pos' : 'neg'}">${fmt(pnl)}</div><div class="s">ventas − compras − crafteos</div></div>
    <div class="stat"><div class="k">P&L últimos 7 días</div><div class="v ${pnl7 >= 0 ? 'pos' : 'neg'}">${fmt(pnl7)}</div><div class="s">${last7.length} operaciones</div></div>`;
  const body = document.getElementById('llBody');
  const thead = document.querySelector('#llTable thead tr');

  /* ---- vista «Resumen por ítem»: agrupa todas las operaciones ---- */
  if (LL.filter === 'byitem') {
    thead.innerHTML = `<th>Ítem</th><th class="num">Compradas</th><th class="num">Crafteadas</th><th class="num">Vendidas</th>
      <th class="num">Invertido</th><th class="num">Recuperado</th><th class="num">P&L</th><th class="num">P&L por unidad vendida</th><th></th>`;
    const byItem = {};
    for (const r of LL.rows) {
      const k = r.id;
      const g = byItem[k] = byItem[k] || { id: k, name: r.name, buyQ: 0, craftQ: 0, sellQ: 0, spent: 0, earned: 0 };
      if (r.type === 'sell') { g.sellQ += r.qty; g.earned += r.qty * r.price; }
      else { g[r.type === 'buy' ? 'buyQ' : 'craftQ'] += r.qty; g.spent += r.qty * r.price; }
    }
    const groups = Object.values(byItem).sort((a, b) => (b.earned - b.spent) - (a.earned - a.spent));
    if (!groups.length) {
      body.innerHTML = '<tr><td colspan="9" class="loading-cell">Sin operaciones registradas.</td></tr>';
      return;
    }
    body.innerHTML = groups.map(g => {
      const p = g.earned - g.spent;
      const perU = g.sellQ > 0 ? p / g.sellQ : null;
      return `<tr>
        <td><div class="item-cell">${iconImg(g.id, 'item-icon sm')}<span>${g.name || catalogName(g.id)}</span></div></td>
        <td class="num">${g.buyQ ? fmt(g.buyQ) : '—'}</td>
        <td class="num">${g.craftQ ? fmt(g.craftQ) : '—'}</td>
        <td class="num">${g.sellQ ? fmt(g.sellQ) : '—'}</td>
        <td class="num">${fmt(g.spent)}</td>
        <td class="num">${fmt(g.earned)}</td>
        <td class="num ${p >= 0 ? 'pos' : 'neg'}"><b>${(p > 0 ? '+' : '') + fmt(p)}</b></td>
        <td class="num ${perU == null ? '' : perU >= 0 ? 'pos' : 'neg'}">${perU == null ? '—' : (perU > 0 ? '+' : '') + fmt(perU)}</td>
        <td></td>
      </tr>`;
    }).join('');
    return;
  }

  thead.innerHTML = `<th>Fecha</th><th>Ítem</th><th>Tipo</th>
    <th class="num">Cant.</th><th class="num">Precio/u</th><th class="num">Total</th>
    <th>Ciudad</th><th>Nota</th><th></th>`;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="loading-cell">Sin operaciones registradas.</td></tr>';
    return;
  }
  body.innerHTML = [...rows].sort((a, b) => b.ts - a.ts).map(r => {
    const row = CATALOG ? CATALOG.find(c => c[0] === r.id.split('@')[0]) : null;
    const name = r.name || (row ? row[1] : r.id);
    const d = new Date(r.ts);
    const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return `<tr>
      <td class="muted">${fecha}</td>
      <td><div class="item-cell">${iconImg(r.id, 'item-icon sm')}<span>${name}</span></div></td>
      <td><span class="badge ${r.type === 'sell' ? 'gold' : ''}">${LL_TYPE_ES[r.type]}</span></td>
      <td class="num">${fmt(r.qty)}</td>
      <td class="num">${fmt(r.price)}</td>
      <td class="num ${r.type === 'sell' ? 'pos' : ''}">${r.type === 'sell' ? '+' : '−'}${fmt(r.qty * r.price)}</td>
      <td>${r.city || '—'}</td>
      <td class="muted micro">${r.note || ''}</td>
      <td class="num"><button class="reset-price" data-del="${r.ts}" title="Eliminar">✕</button></td>
    </tr>`;
  }).join('');
}
(function initLL() {
  document.getElementById('llCity').innerHTML = ['—', ...CITIES, 'Black Market'].map(c => `<option>${c}</option>`).join('');
  const inp = document.getElementById('llItem');
  const res = document.getElementById('llResults');
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2 || !CATALOG) { res.classList.remove('open'); return; }
    const hits = [];
    for (const [id, es, en, tier] of CATALOG) {
      if (es.toLowerCase().includes(q) || en.toLowerCase().includes(q)) {
        hits.push([id, es, tier]);
        if (hits.length >= 20) break;
      }
    }
    res.innerHTML = hits.map(([id, es, tier]) =>
      `<div class="sr-item" data-id="${id}" data-name="${es}">${iconImg(id, 'item-icon sm')}<div><div class="n">${es}</div><div class="m">T${tier}</div></div></div>`).join('');
    res.classList.toggle('open', hits.length > 0);
  });
  res.addEventListener('click', e => {
    const it = e.target.closest('.sr-item'); if (!it) return;
    LL.item = it.dataset.id;
    inp.value = it.dataset.name;
    res.classList.remove('open');
  });
  document.getElementById('llAdd').addEventListener('click', () => {
    const qty = Math.max(1, parseInt(document.getElementById('llQty').value) || 1);
    const price = parseFloat(document.getElementById('llPrice').value);
    if (!LL.item || isNaN(price) || price < 0) {
      alert('Elegí un ítem del buscador y cargá el precio unitario.');
      return;
    }
    const city = document.getElementById('llCity').value;
    LL.rows.push({
      ts: Date.now(), id: LL.item, name: document.getElementById('llItem').value,
      type: document.getElementById('llType').value, qty, price,
      city: city === '—' ? '' : city,
      note: document.getElementById('llNoteTxt').value.trim(),
    });
    llSave(); llRender();
    document.getElementById('llPrice').value = '';
    document.getElementById('llNoteTxt').value = '';
  });
  document.getElementById('llFilter').addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    LL.filter = chip.dataset.f;
    document.querySelectorAll('#llFilter .chip').forEach(c => c.classList.toggle('active', c === chip));
    llRender();
  });
  document.getElementById('llBody').addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (!del) return;
    LL.rows = LL.rows.filter(r => r.ts !== +del.dataset.del);
    llSave(); llRender();
  });
  document.getElementById('llExport').addEventListener('click', () => {
    const head = 'fecha,item,id,tipo,cantidad,precio_unitario,total,ciudad,nota\n';
    const csv = head + LL.rows.map(r =>
      [new Date(r.ts).toISOString(), `"${(r.name || r.id).replace(/"/g, '""')}"`, r.id, LL_TYPE_ES[r.type], r.qty, r.price, r.qty * r.price, r.city, `"${(r.note || '').replace(/"/g, '""')}"`].join(',')
    ).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = 'registro-operaciones.csv';
    a.click();
  });
  document.getElementById('llClear').addEventListener('click', () => {
    if (confirm('¿Vaciar todo el registro? Esta acción no se puede deshacer.')) {
      LL.rows = []; llSave(); llRender();
    }
  });

  /* ---- Respaldo completo: exporta/importa TODO el localStorage de la app ---- */
  document.getElementById('bkExport').addEventListener('click', () => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      data[k] = localStorage.getItem(k);
    }
    const payload = { app: 'AyudanteAlbion', version: 1, exported: new Date().toISOString(), data };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = `ayudante-albion-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });
  document.getElementById('bkImport').addEventListener('click', () => document.getElementById('bkFile').click());
  document.getElementById('bkFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (payload.app !== 'AyudanteAlbion' || !payload.data) throw new Error('formato');
        const n = Object.keys(payload.data).length;
        if (!confirm(`Respaldo del ${(payload.exported || '').slice(0, 10)} con ${n} claves.\n¿Restaurar? Se sobreescribirán los datos actuales de la app.`)) return;
        for (const [k, v] of Object.entries(payload.data)) localStorage.setItem(k, v);
        alert('Respaldo restaurado. La página se recargará para aplicar los cambios.');
        location.reload();
      } catch (err) {
        alert('El archivo no parece ser un respaldo válido de Ayudante Albion.');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  });
  llRender();
})();

/* ====================================================================
   ENCANTADO — ¿comprar encantado o encantar con fragmentos?
   Cantidades oficiales por ítem (upgraderequirements de ao-bin-dumps).
   0→1 runas · 1→2 almas · 2→3 reliquias.
   ==================================================================== */
const EN = { data: null, byId: {}, item: null, prices: {}, loading: false, from: 0, to: 3 };

async function enEnsureData() {
  if (!EN.data) {
    EN.data = await fetchJSON('data/enchant_data.json');
    for (const e of EN.data) EN.byId[e.id] = e;
  }
}
async function enLoad() {
  if (!EN.item || EN.loading) return;
  EN.loading = true;
  const box = document.getElementById('enResult');
  box.innerHTML = '<div class="panel"><div class="loading-cell">Cargando precios…</div></div>';
  try {
    await enEnsureData();
    const rec = EN.byId[EN.item];
    if (!rec) {
      box.innerHTML = '<div class="panel"><div class="loading-cell">Este ítem no se puede encantar con fragmentos.</div></div>';
      EN.loading = false; return;
    }
    const city = document.getElementById('enCity').value;
    const ids = [EN.item, ...[1, 2, 3].map(l => EN.item + '@' + l), ...new Set(rec.u.map(u => u[1]))];
    EN.prices = await fetchPrices(ids, [city]);
    enRender();
  } catch (e) {
    box.innerHTML = `<div class="panel"><div class="loading-cell">Error: ${e.message}</div></div>`;
  }
  EN.loading = false;
}
function enPrice(id) {
  const city = document.getElementById('enCity').value;
  const k = mpKey(id, city, 'buy');
  if (k in manualPrices) return { value: manualPrices[k], manual: true };
  const p = EN.prices[id]?.[city];
  return { value: p?.sell || 0, manual: false, date: p?.sellDate };
}
function enRender() {
  const box = document.getElementById('enResult');
  const rec = EN.byId[EN.item];
  const city = document.getElementById('enCity').value;
  const row = CATALOG.find(r => r[0] === EN.item);
  const name = row ? row[1] : EN.item;
  const FRAG_ES = id => id.includes('RUNE') ? 'runas' : id.includes('SOUL') ? 'almas' : 'reliquias';

  let cum = 0; // costo acumulado de encantar desde .0
  const base = enPrice(EN.item);
  const rows = rec.u.map(([lvl, fragId, count]) => {
    const frag = enPrice(fragId);
    const target = enPrice(EN.item + '@' + lvl);
    const prev = lvl === 1 ? base : enPrice(EN.item + '@' + (lvl - 1));
    const enchStep = (prev.value && frag.value) ? prev.value + frag.value * count : null; // comprar nivel anterior + encantar
    cum = (cum !== null && frag.value && base.value) ? (lvl === 1 ? base.value : cum) + frag.value * count : null;
    const direct = target.value || null;
    const best = enchStep != null && direct != null ? Math.min(enchStep, direct) : null;
    return { lvl, fragId, count, frag, target, prev, enchStep, direct,
             save: (enchStep != null && direct != null) ? direct - enchStep : null };
  });

  /* editor de precio inline: input editable + botón de reset si es manual */
  const priceInput = (id, p, extra = '') => `
    <span class="price-edit-wrap">
      <input type="number" class="price-edit ${p.manual ? 'manual' : ''}" min="0" step="1"
        value="${p.value || ''}" placeholder="sin precio"
        data-pid="${id}" data-city="${city}" data-kind="buy" ${extra}>
      ${p.manual ? `<button class="reset-price" data-pid="${id}" data-city="${city}" data-kind="buy" title="Volver al precio de la API">↺</button>` : ''}
    </span>`;

  /* ---- planificador de salto libre (.X → .Y) ---- */
  const from = EN.from, to = EN.to;
  const lvlName = l => '.' + l;
  const fromP = from === 0 ? base : enPrice(EN.item + '@' + from);
  const toP = to === 0 ? base : enPrice(EN.item + '@' + to);
  const steps = rec.u.filter(([lvl]) => lvl > from && lvl <= to); // pasos necesarios
  let fragTotal = 0, fragOk = true;
  const stepRows = steps.map(([lvl, fragId, count]) => {
    const fp = enPrice(fragId);
    if (!fp.value) fragOk = false; else fragTotal += fp.value * count;
    return { lvl, fragId, count, fp };
  });
  const planCost = (fromP.value && fragOk) ? fromP.value + fragTotal : null; // comprar .from + todos los fragmentos
  const planSave = (planCost != null && toP.value) ? toP.value - planCost : null;
  const tax = document.getElementById('enPremium').checked ? 0.04 : 0.08;
  const sellNet = toP.value ? toP.value * (1 - tax - 0.025) : null; // impuesto + tasa de publicación
  const planProfit = (planCost != null && sellNet != null) ? sellNet - planCost : null;

  const jumpOpts = sel => [0, 1, 2, 3].map(l =>
    `<option value="${l}"${l === sel ? ' selected' : ''}>${lvlName(l)}</option>`).join('');

  box.innerHTML = `
  <div class="panel table-wrap">
    <div class="flip-head" style="padding:14px 14px 4px">
      <div class="item-cell">${iconImg(EN.item, 'item-icon')}<div>
        <div class="item-name">${name}</div>
        <div class="item-meta">Precios en ${city} · editá cualquier precio si el mercado está vacío</div>
      </div></div>
    </div>
    <table class="ledger">
      <thead><tr>
        <th>Nivel</th><th>Fragmentos necesarios</th>
        <th class="num">Precio fragmento</th>
        <th class="num">Costo fragmentos</th>
        <th class="num">Nivel anterior + encantar</th>
        <th class="num">Comprar directo</th>
        <th class="num">Conviene</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><b>.0</b> <span class="muted micro">(base)</span></td>
          <td class="muted micro" colspan="3">precio del ítem sin encantar</td>
          <td class="num" colspan="2">${priceInput(EN.item, base)}</td>
          <td></td>
        </tr>
        ${rows.map(r => `
        <tr>
          <td><b>.${r.lvl - 1} → .${r.lvl}</b></td>
          <td><div class="item-cell">${iconImg(r.fragId, 'item-icon sm')}<span>${fmt(r.count)} ${FRAG_ES(r.fragId)}</span></div></td>
          <td class="num">${priceInput(r.fragId, r.frag)}</td>
          <td class="num">${r.frag.value ? fmt(r.frag.value * r.count) : '—'}</td>
          <td class="num">${r.enchStep != null ? fmt(r.enchStep) : '—'}</td>
          <td class="num">${priceInput(EN.item + '@' + r.lvl, r.target)}</td>
          <td class="num ${r.save == null ? '' : r.save > 0 ? 'pos' : 'neg'}">${
            r.save == null ? '—' :
            r.save > 0 ? `Encantar (ahorrás ${fmt(r.save)})` : `Comprar directo (${fmt(-r.save)} más barato)`}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="micro muted pad">«Nivel anterior + encantar» = comprar el ítem un nivel abajo en ${city} y pagar los fragmentos. Cantidades oficiales del juego para este ítem. El encantado en el Transmutador no tiene costo de plata adicional. Los precios editados quedan guardados como manuales (↺ para volver a la API).</div>
  </div>

  <div class="panel">
    <div class="cd-title" style="padding:14px 14px 0">Planificador de salto</div>
    <div class="toggles inline" style="padding:10px 14px">
      <div class="control"><label>Desde</label><select id="enFrom">${jumpOpts(from)}</select></div>
      <div class="control"><label>Hasta</label><select id="enTo">${jumpOpts(to)}</select></div>
    </div>
    ${from >= to ? '<div class="loading-cell">Elegí un nivel de destino mayor que el de origen.</div>' : `
    <div class="cd-grid" style="padding:0 14px 14px">
      <div class="cd-section">
        <div class="cd-title">Materiales para ${lvlName(from)} → ${lvlName(to)}</div>
        <div class="cd-line"><span>Comprar ${name} ${lvlName(from)}</span><span>${fromP.value ? fmt(fromP.value) : '<b class="neg">sin precio</b>'}</span></div>
        ${stepRows.map(s => `
        <div class="cd-line"><span>${fmt(s.count)} ${FRAG_ES(s.fragId)} (paso .${s.lvl - 1}→.${s.lvl})</span>
          <span>${s.fp.value ? fmt(s.fp.value * s.count) : '<b class="neg">sin precio</b>'}</span></div>`).join('')}
        <div class="cd-line total"><span>Costo total del plan</span><span>${planCost != null ? fmt(planCost) : '—'}</span></div>
      </div>
      <div class="cd-section cd-summary">
        <div class="cd-title">Resultado</div>
        <div class="cd-line"><span>Comprar ${lvlName(to)} directo</span><span>${toP.value ? fmt(toP.value) : '—'}</span></div>
        <div class="cd-line ${planSave == null ? '' : planSave > 0 ? 'pos' : 'neg'}"><span>Ahorro encantando</span>
          <span>${planSave == null ? '—' : (planSave > 0 ? '+' : '') + fmt(planSave)}</span></div>
        <div class="cd-line muted"><span>Venta ${lvlName(to)} neta (impuesto ${(tax * 100).toFixed(0)}% + publicación 2,5%)</span>
          <span>${sellNet != null ? fmt(sellNet) : '—'}</span></div>
        <div class="cd-line total ${planProfit == null ? '' : planProfit > 0 ? 'pos' : 'neg'}"><span>Ganancia si lo vendés</span>
          <span>${planProfit == null ? '—' : (planProfit > 0 ? '+' : '') + fmt(planProfit)}</span></div>
        <div class="cd-actions">
          ${fromP.value ? `<button class="btn micro-btn" onclick="llPrefill('${from === 0 ? EN.item : EN.item + '@' + from}','buy',${fromP.value},'${city}')" title="Anotar la compra del ítem ${lvlName(from)} en el Registro">✎ Registrar compra ${lvlName(from)}</button>` : ''}
          ${toP.value ? `<button class="btn micro-btn" onclick="llPrefill('${to === 0 ? EN.item : EN.item + '@' + to}','sell',${toP.value},'${city}')" title="Anotar la venta del ítem ${lvlName(to)} en el Registro">✎ Registrar venta ${lvlName(to)}</button>` : ''}
          ${favBtnHtml('enchant', EN.item, name)}
        </div>
      </div>
    </div>`}
    <div class="micro muted pad">El plan compra el ítem en ${lvlName(from)} y aplica todos los pasos de fragmentos hasta ${lvlName(to)}. La ganancia asume que vendés en ${city} al precio de ${lvlName(to)} mostrado arriba.</div>
  </div>`;

  document.getElementById('enFrom').addEventListener('change', e => { EN.from = +e.target.value; enRender(); });
  document.getElementById('enTo').addEventListener('change', e => { EN.to = +e.target.value; enRender(); });
}
(function initEN() {
  document.getElementById('enCity').innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');
  const inp = document.getElementById('enSearch');
  const res = document.getElementById('enResults');
  inp.addEventListener('input', async () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2 || !CATALOG) { res.classList.remove('open'); return; }
    await enEnsureData();
    const hits = [];
    for (const [id, es, en, tier] of CATALOG) {
      if (!EN.byId[id]) continue; // solo ítems encantables
      if (es.toLowerCase().includes(q) || en.toLowerCase().includes(q) || id.toLowerCase().includes(q)) {
        hits.push([id, es, tier]);
        if (hits.length >= 25) break;
      }
    }
    res.innerHTML = hits.map(([id, es, tier]) =>
      `<div class="sr-item" data-id="${id}" data-name="${es}">${iconImg(id, 'item-icon sm')}<div><div class="n">${es}</div><div class="m">T${tier} · ${id}</div></div></div>`).join('');
    res.classList.toggle('open', hits.length > 0);
  });
  res.addEventListener('click', e => {
    const it = e.target.closest('.sr-item'); if (!it) return;
    EN.item = it.dataset.id;
    inp.value = it.dataset.name;
    res.classList.remove('open');
    enLoad();
  });
  document.getElementById('enCity').addEventListener('change', () => { if (EN.item) enLoad(); });
  document.getElementById('enPremium').addEventListener('change', () => { if (EN.item) enRender(); });
  document.getElementById('enRefresh').addEventListener('click', enLoad);

  /* precios editables dentro del resultado: guardar override manual y recalcular */
  const box = document.getElementById('enResult');
  box.addEventListener('change', e => {
    const inp = e.target.closest('.price-edit'); if (!inp) return;
    const k = mpKey(inp.dataset.pid, inp.dataset.city, inp.dataset.kind);
    const v = parseFloat(inp.value);
    if (!inp.value || isNaN(v) || v < 0) delete manualPrices[k];
    else manualPrices[k] = v;
    saveManual();
    enRender();
  });
  box.addEventListener('click', e => {
    const reset = e.target.closest('.reset-price'); if (!reset) return;
    delete manualPrices[mpKey(reset.dataset.pid, reset.dataset.city, reset.dataset.kind)];
    saveManual();
    enRender();
  });
})();

/* ====================================================================
   GRANJA — cultivos y animales de isla.
   Datos oficiales: growtime, semilla devuelta, crías, productos.
   Ganancia/día normalizada por ciclo. Premium: +50% de cosecha.
   ==================================================================== */
const FM = { data: null, prices: {}, kind: 'plant', sortKey: 'daily', sortDir: -1, expanded: null, loadedOnce: false, loading: false };
const FM_NAME = id => { const r = CATALOG?.find(c => c[0] === id); return r ? r[1] : id; };

async function fmLoad() {
  if (FM.loading) return;
  FM.loading = true; FM.loadedOnce = true;
  document.getElementById('fmBody').innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando precios…</td></tr>';
  try {
    if (!FM.data) FM.data = await fetchJSON('data/farm_data.json');
    const ids = new Set();
    for (const f of FM.data) {
      ids.add(f.id.replace('_SEED', '_SEED')); // semillas y crías se comercian
      if (f.product) ids.add(f.product);
      if (f.grown) ids.add(f.grown);
    }
    FM.prices = await fetchPrices([...ids], CITIES);
    fmRender();
  } catch (e) {
    document.getElementById('fmBody').innerHTML = `<tr><td colspan="7" class="loading-cell">Error: ${e.message}</td></tr>`;
  }
  FM.loading = false;
}
function fmPrice(id, kind) {
  const city = document.getElementById('fmCity').value;
  const k = mpKey(id, city, kind);
  if (k in manualPrices) return { value: manualPrices[k], manual: true };
  const p = FM.prices[id]?.[city];
  return { value: p?.sell || 0, manual: false, date: p?.sellDate };
}
function fmRows() {
  const premium = document.getElementById('fmPremium').checked;
  const focus = document.getElementById('fmFocus').checked;
  const tax = premium ? 0.04 : 0.08;
  const yieldBase = premium ? 13.5 : 9; // 9 por parcela, +50% con premium
  const out = [];
  for (const f of FM.data) {
    if (FM.kind === 'plant' && f.kind !== 'plant') continue;
    if (FM.kind === 'animal' && f.kind !== 'animal') continue;
    if (f.kind === 'plant') {
      if (!f.product) continue;
      const seed = fmPrice(f.id, 'buy');
      const crop = fmPrice(f.product, 'sell');
      if (!seed.value && !f.vendor) continue;
      const seedCost = seed.value || f.vendor || 0;
      // rendimiento por semilla: cosecha (con foco: + focusBonus)
      const cropPer = (yieldBase / 9) * (1 + (focus ? f.focusBonus : 0));
      const seedBack = f.seedBack || 0;
      const gross = crop.value * cropPer * (1 - tax);
      const unit = gross - seedCost * (1 - seedBack);
      const cycleDays = f.grow / 86400;
      const daily = unit * 9 / cycleDays; // 9 unidades por parcela
      out.push({ f, name: FM_NAME(f.product), inId: f.id, outId: f.product,
                 cost: seedCost, prod: crop.value, cropPer, unit, daily, cycleDays, seedBack });
    } else {
      // animales: cría → adulto (venta) o adulto productor (huevos/leche)
      if (f.grown) {
        const baby = fmPrice(f.id, 'buy');
        const grown = fmPrice(f.grown, 'sell');
        if (!baby.value && !grown.value) continue;
        const offspring = focus ? (f.offspring || 0) * 2 : (f.offspring || 0);
        const gross = grown.value * (1 - tax) + baby.value * offspring;
        const unit = gross - baby.value;
        const cycleDays = f.grow / 86400;
        const daily = unit * 9 / cycleDays;
        out.push({ f, name: FM_NAME(f.grown), inId: f.id, outId: f.grown,
                   cost: baby.value, prod: grown.value, cropPer: 1, unit, daily, cycleDays, offspring });
      } else if (f.product && f.prodTime) {
        const animal = fmPrice(f.id, 'buy');
        const prod = fmPrice(f.product, 'sell');
        if (!prod.value) continue;
        const perCycle = (premium ? 1.5 : 1) * (1 + (focus ? f.focusBonus : 0));
        const unit = prod.value * perCycle * (1 - tax); // el animal no se consume
        const cycleDays = f.prodTime / 86400;
        const daily = unit * 9 / cycleDays;
        out.push({ f, name: FM_NAME(f.product) + ' (' + FM_NAME(f.id) + ')', inId: f.id, outId: f.product,
                   cost: animal.value, prod: prod.value, cropPer: perCycle, unit, daily, cycleDays, keeper: true });
      }
    }
  }
  const k = FM.sortKey, d = FM.sortDir;
  out.sort((a, b) => {
    const va = k === 'unit' ? a.unit : k === 'total' ? a.daily : a.daily;
    const vb = k === 'unit' ? b.unit : k === 'total' ? b.daily : b.daily;
    return (va - vb) * d;
  });
  return out;
}
function fmRender() {
  if (!FM.data || !CATALOG) return;
  const plots = Math.max(1, parseInt(document.getElementById('fmPlots').value) || 9);
  const rows = fmRows();
  const winners = rows.filter(r => r.daily > 0);
  const best = rows.length ? rows.reduce((a, b) => (b.daily > a.daily ? b : a)) : null;
  document.getElementById('fmStats').innerHTML = `
    <div class="stat"><div class="k">Rentables</div><div class="v ${winners.length ? 'pos' : ''}">${winners.length} / ${rows.length}</div><div class="s">con precios actuales</div></div>
    <div class="stat"><div class="k">Mejor opción</div><div class="v ${best && best.daily > 0 ? 'pos' : 'neg'}">${best ? fmt(best.daily * plots) : '—'}</div><div class="s">${best ? best.name + ' · por día con ' + plots + ' parcelas' : 'sin datos'}</div></div>
    <div class="stat"><div class="k">Parcelas</div><div class="v">${plots}</div><div class="s">9 unidades por parcela</div></div>`;
  const body = document.getElementById('fmBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="loading-cell">Sin precios de mercado para esta categoría. Probá otra ciudad.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const rid = r.inId;
    const exp = FM.expanded === rid;
    const main = `
    <tr class="craft-row clickable ${exp ? 'expanded' : ''}" data-rid="${rid}">
      <td><div class="item-cell">
        <span class="expander">${exp ? '▾' : '▸'}</span>
        ${iconImg(r.inId, 'item-icon sm')}<span class="muted">→</span>${iconImg(r.outId, 'item-icon sm')}
        <div><div class="item-name">${r.name}</div><div class="item-meta">T${r.f.tier}${r.keeper ? ' · productor (no se consume)' : ''}</div></div>
      </div></td>
      <td class="num">${fmt(r.cost || null)}</td>
      <td class="num">${fmt(r.prod || null)}${r.cropPer !== 1 ? ` <span class="price-sub">×${r.cropPer.toFixed(2)}</span>` : ''}</td>
      <td class="num">${r.cycleDays < 1.05 ? Math.round(r.cycleDays * 24) + ' h' : r.cycleDays.toFixed(1) + ' días'}</td>
      <td class="num ${r.unit > 0 ? 'pos' : 'neg'}">${fmt(r.unit)}</td>
      <td class="num ${r.daily > 0 ? 'pos' : 'neg'}">${fmt(r.daily)}</td>
      <td class="num ${r.daily > 0 ? 'pos' : 'neg'}"><b>${fmt(r.daily * plots)}</b></td>
    </tr>`;
    if (!exp) return main;
    const city = document.getElementById('fmCity').value;
    const bp = fmPrice(r.inId, 'buy'), sp = fmPrice(r.outId, 'sell');
    return main + `
    <tr class="detail-tr"><td colspan="7"><div class="craft-detail">
      <div class="cd-section cd-summary">
        <div class="cd-title">Desglose por unidad — precios en ${city} (editables)</div>
        <div class="cd-line"><span>${r.keeper ? 'Animal' : (r.f.kind === 'plant' ? 'Semilla' : 'Cría')} (${FM_NAME(r.inId)})</span>
          <span class="price-edit-wrap">
            <input type="number" class="price-edit ${bp.manual ? 'manual' : ''}" value="${bp.value || ''}" placeholder="—" data-pid="${r.inId}" data-city="${city}" data-kind="buy">
            ${bp.manual ? `<button class="reset-price" data-pid="${r.inId}" data-city="${city}" data-kind="buy">↺</button>` : ''}
          </span></div>
        <div class="cd-line"><span>Producto (${FM_NAME(r.outId)})</span>
          <span class="price-edit-wrap">
            <input type="number" class="price-edit ${sp.manual ? 'manual' : ''}" value="${sp.value || ''}" placeholder="—" data-pid="${r.outId}" data-city="${city}" data-kind="sell">
            ${sp.manual ? `<button class="reset-price" data-pid="${r.outId}" data-city="${city}" data-kind="sell">↺</button>` : ''}
          </span></div>
        ${r.seedBack ? `<div class="cd-line"><span>Semilla devuelta</span><span>${pct(r.seedBack)}</span></div>` : ''}
        ${r.offspring ? `<div class="cd-line"><span>Crías extra por ciclo</span><span>${r.offspring.toFixed(2)}</span></div>` : ''}
        <div class="cd-line"><span>Ciclo</span><span>${r.cycleDays < 1.05 ? Math.round(r.cycleDays * 24) + ' h' : r.cycleDays.toFixed(1) + ' días'}</span></div>
        <div class="cd-line total"><span>Ganancia por unidad</span><span class="${r.unit > 0 ? 'pos' : 'neg'}">${fmt(r.unit)}</span></div>
        <div class="cd-actions">
          ${bp.value ? `<button class="btn micro-btn" onclick="llPrefill('${r.inId}','buy',${bp.value},'${city}')" title="Anotar la compra de ${r.keeper ? 'animales' : (r.f.kind === 'plant' ? 'semillas' : 'crías')} en el Registro">✎ Registrar compra</button>` : ''}
          ${sp.value ? `<button class="btn micro-btn" onclick="llPrefill('${r.outId}','sell',${sp.value},'${city}')" title="Anotar la venta del producto en el Registro">✎ Registrar venta</button>` : ''}
          ${favBtnHtml('farm', r.outId, FM_NAME(r.outId))}
        </div>
      </div>
    </div></td></tr>`;
  }).join('');
}
(function initFM() {
  document.getElementById('fmCity').innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');
  document.getElementById('fmRefresh').addEventListener('click', fmLoad);
  for (const id of ['fmCity', 'fmPremium', 'fmFocus', 'fmPlots'])
    document.getElementById(id).addEventListener('change', fmRender);
  document.getElementById('fmKindChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    FM.kind = chip.dataset.k;
    document.querySelectorAll('#fmKindChips .chip').forEach(c => c.classList.toggle('active', c === chip));
    fmRender();
  });
  document.querySelectorAll('#fmTable th.sortable').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (FM.sortKey === k) FM.sortDir *= -1; else { FM.sortKey = k; FM.sortDir = -1; }
    fmRender();
  }));
  document.getElementById('fmBody').addEventListener('click', e => {
    const reset = e.target.closest('.reset-price');
    if (reset) {
      delete manualPrices[mpKey(reset.dataset.pid, reset.dataset.city, reset.dataset.kind)];
      saveManual(); fmRender(); return;
    }
    if (e.target.closest('.price-edit-wrap') || e.target.classList.contains('price-edit')) return;
    const tr = e.target.closest('tr.craft-row'); if (!tr) return;
    FM.expanded = FM.expanded === tr.dataset.rid ? null : tr.dataset.rid;
    fmRender();
  });
  document.getElementById('fmBody').addEventListener('change', e => {
    const inp = e.target.closest('.price-edit'); if (!inp) return;
    const k = mpKey(inp.dataset.pid, inp.dataset.city, inp.dataset.kind);
    const v = parseFloat(inp.value);
    if (!inp.value || isNaN(v) || v < 0) delete manualPrices[k]; else manualPrices[k] = v;
    saveManual(); fmRender();
  });
  craftModules['farm'] = { get loadedOnce() { return FM.loadedOnce; }, loadPrices: fmLoad };
})();

/* ====================================================================
   PERFIL — jugador real desde el killboard oficial (gameinfo API).
   La API no envía CORS: se llama vía proxy local /gameinfo/* (server.py
   y el ejecutable lo implementan igual).
   Además: especializaciones del Destiny Board del usuario, usadas por
   las pestañas de crafteo para calcular el costo real de Foco.
   ==================================================================== */
const PF = { player: null, loading: false, loadedOnce: false, kills: null, deaths: null, guildId: null, expandedEv: null,
             killMode: 'recent', topkills: null, solokills: null, guildTop: null };
const PF_SLOTS = [
  ['MainHand', 'Mano principal'], ['OffHand', 'Mano secundaria'], ['Head', 'Cabeza'],
  ['Armor', 'Pecho'], ['Shoes', 'Pies'], ['Cape', 'Capa'], ['Bag', 'Bolsa'],
  ['Mount', 'Montura'], ['Potion', 'Poción'], ['Food', 'Comida'],
];
let pfSpecs = {};
try { pfSpecs = JSON.parse(localStorage.getItem('pfSpecs') || '{}'); } catch (e) {}
function pfSaveSpecs() { localStorage.setItem('pfSpecs', JSON.stringify(pfSpecs)); }

const PF_BRANCHES = [
  { key: 'food',   label: 'Cocina',             specMax: 120 },
  { key: 'alch',   label: 'Alquimia',           specMax: 120 },
  { key: 'refine', label: 'Refinamiento',       specMax: 120 },
  { key: 'gear',   label: 'Crafteo de equipo',  specMax: 120 },
];

/* aplica las especializaciones guardadas a los inputs de las pestañas de crafteo */
function pfApplySpecs() {
  for (const b of PF_BRANCHES) {
    const s = pfSpecs[b.key];
    if (!s) continue;
    const spec = document.getElementById(b.key + 'Spec');
    const mast = document.getElementById(b.key + 'Mastery');
    if (spec && s.spec != null) spec.value = s.spec;
    if (mast && s.mastery != null) mast.value = s.mastery;
  }
}

function pfRenderSpecs() {
  const box = document.getElementById('pfSpecList');
  box.innerHTML = `
    <div class="table-wrap"><table class="ledger">
      <thead><tr><th>Rama</th><th class="num">Especialización (0–120)</th><th class="num">Maestría (0–100)</th><th class="num">Eficiencia (FCE)</th><th class="num">Foco: reducción</th></tr></thead>
      <tbody>${PF_BRANCHES.map(b => {
        const s = pfSpecs[b.key] || { spec: 0, mastery: 0 };
        const fce = (s.spec || 0) * 250 + (s.mastery || 0) * 30;
        const mult = Math.pow(0.5, fce / 10000);
        return `<tr>
          <td><b>${b.label}</b></td>
          <td class="num"><input type="number" class="price-edit" style="width:90px" min="0" max="${b.specMax}" value="${s.spec || 0}" data-spec="${b.key}"></td>
          <td class="num"><input type="number" class="price-edit" style="width:90px" min="0" max="100" value="${s.mastery || 0}" data-mast="${b.key}"></td>
          <td class="num">${fmt(fce)}</td>
          <td class="num ${mult < 1 ? 'pos' : ''}">paga el ${(mult * 100).toFixed(1)}%</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="micro muted" style="margin-top:8px">Ejemplo: espec 100 + maestría 100 = 28.000 FCE → el Foco cuesta el ${(Math.pow(0.5, 28000 / 10000) * 100).toFixed(1)}% del valor base. Los valores se guardan solos y se aplican en Cocina, Alquimia, Refinamiento y Crafteo.</div>`;
}

const PF_FMT_DATE = ts => {
  const d = new Date(ts);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

async function pfFetch(path) {
  const r = await fetch('/gameinfo' + path);
  if (!r.ok) throw new Error('gameinfo HTTP ' + r.status);
  return r.json();
}

/* reintentos: el killboard oficial es intermitente (502 frecuentes) */
async function pfFetchRetry(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await pfFetch(path); }
    catch (e) { if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 1200)); }
  }
}

/* gameinfo devuelve algunos listados envueltos ({kills:[...]}, {members:[...]})
   y otros como array directo. Normalizar evita que la tabla quede "sin datos". */
function pfAsArray(d) {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.kills)) return d.kills;
  if (d && Array.isArray(d.members)) return d.members;
  return [];
}

async function pfLoadPlayer(id, name) {
  if (PF.loading) return;
  PF.loading = true;
  const box = document.getElementById('pfResult');
  box.innerHTML = `<div class="panel"><div class="loading-cell">Cargando perfil de ${name}… (el killboard oficial puede tardar)</div></div>`;
  document.getElementById('pfRefresh').style.display = '';
  try {
    const detail = await pfFetchRetry(`/players/${id}`);
    // kills/muertes/gremio en paralelo; toleramos fallos parciales
    const [kills, deaths, guild] = await Promise.all([
      pfFetchRetry(`/players/${id}/kills`).catch(() => null),
      pfFetchRetry(`/players/${id}/deaths`).catch(() => null),
      detail.GuildId ? pfFetchRetry(`/guilds/${detail.GuildId}`).catch(() => null) : null,
    ]);
    PF.player = { id, name: detail.Name };
    PF.kills = kills ? pfAsArray(kills) : null;
    PF.deaths = deaths ? pfAsArray(deaths) : null;
    PF.guildId = detail.GuildId || null;
    PF.expandedEv = null;
    PF.killMode = 'recent'; PF.topkills = null; PF.solokills = null; PF.guildTop = null;
    localStorage.setItem('pfPlayer', JSON.stringify(PF.player));
    pfRender(detail, kills, deaths, guild);
  } catch (e) {
    box.innerHTML = `<div class="panel"><div class="loading-cell">No se pudo cargar el perfil: ${e.message}. El killboard oficial suele estar saturado — probá de nuevo en unos segundos.</div></div>`;
  }
  PF.loading = false;
}

function pfKillRow(ev, mode) {
  // mode 'kill': yo maté a Victim · mode 'death': Killer me mató
  const other = mode === 'kill' ? ev.Victim : ev.Killer;
  const me = mode === 'kill' ? ev.Killer : ev.Victim;
  const eq = ev.Victim.Equipment || {};
  const mh = eq.MainHand ? eq.MainHand.Type : null;
  const evKey = mode + ':' + ev.EventId;
  const open = PF.expandedEv === evKey;
  let html = `<tr class="clickable ${open ? 'expanded' : ''}" data-ev="${evKey}">
    <td class="muted micro">${PF_FMT_DATE(ev.TimeStamp)}</td>
    <td><div class="item-cell">${mh ? iconImg(mh, 'item-icon sm') : ''}<div>
      <div class="item-name">${other.Name}</div>
      <div class="item-meta">${other.GuildName || 'sin gremio'}${other.AllianceName ? ' · ' + other.AllianceName : ''}</div>
    </div></div></td>
    <td class="num">${other.AverageItemPower ? fmt(other.AverageItemPower) : '—'}</td>
    <td class="num">${me.AverageItemPower ? fmt(me.AverageItemPower) : '—'}</td>
    <td class="num ${mode === 'kill' ? 'pos' : 'neg'}">${fmt(ev.TotalVictimKillFame)}</td>
    <td class="num muted">${ev.numberOfParticipants || 1}</td>
  </tr>`;
  if (open) html += pfEvDetail(ev);
  return html;
}

/* fila expandida: equipo completo del asesino y de la víctima, con íconos */
function pfEvDetail(ev) {
  const gearCol = who => {
    const eq = who.Equipment || {};
    const rows = PF_SLOTS
      .filter(([slot]) => eq[slot])
      .map(([slot, label]) => {
        const it = eq[slot];
        const ench = it.Type.includes('@') ? '.' + it.Type.split('@')[1] : '';
        return `<div class="cd-line"><span style="display:flex;align-items:center;gap:8px">${iconImg(it.Type, 'item-icon sm')}${label}</span>
          <span class="muted micro">${catalogName(it.Type.split('@')[0])}${ench} ${it.Quality > 1 ? '· calidad ' + it.Quality : ''}</span></div>`;
      }).join('');
    return rows || '<div class="muted micro">Sin datos de equipo</div>';
  };
  const inv = (ev.Victim.Inventory || []).filter(Boolean);
  return `<tr class="craft-detail"><td colspan="6">
    <div class="cd-grid">
      <div class="cd-section">
        <div class="cd-title">⚔ ${ev.Killer.Name} (asesino) · IP ${fmt(ev.Killer.AverageItemPower) || '—'}</div>
        ${gearCol(ev.Killer)}
      </div>
      <div class="cd-section">
        <div class="cd-title">💀 ${ev.Victim.Name} (víctima) · IP ${fmt(ev.Victim.AverageItemPower) || '—'}</div>
        ${gearCol(ev.Victim)}
        ${inv.length ? `<div class="cd-line muted" style="margin-top:6px"><span>Inventario perdido</span><span>${inv.length} ítems</span></div>` : ''}
      </div>
    </div>
  </td></tr>`;
}

function pfRender(d, kills, deaths, guild) {
  PF.lastRender = { d, kills, deaths, guild };
  const box = document.getElementById('pfResult');
  const ls = d.LifetimeStatistics || {};
  const pve = ls.PvE || {};
  const gat = (ls.Gathering || {}).All || {};
  const ratio = d.DeathFame > 0 ? d.KillFame / d.DeathFame : null;

  const pveRows = [
    ['Total PvE', pve.Total], ['Zonas reales', pve.Royal], ['Outlands', pve.Outlands],
    ['Avalon', pve.Avalon], ['Hellgates', pve.Hellgate], ['Mazmorras corruptas', pve.CorruptedDungeon], ['Nieblas', pve.Mists],
  ].filter(([, v]) => v);

  box.innerHTML = `
  <div class="panel">
    <div class="flip-head" style="padding:14px">
      <div class="item-cell">
        <span class="chip-ico" style="width:44px;height:44px"><svg><use href="#i-user"/></svg></span>
        <div>
          <div class="item-name" style="font-size:1.2rem">${d.Name}</div>
          <div class="item-meta">${d.GuildName ? `Gremio: <b>${d.GuildName}</b>` : 'Sin gremio'}${d.AllianceName ? ` · Alianza: ${d.AllianceName}${d.AllianceTag ? ' [' + d.AllianceTag + ']' : ''}` : ''}</div>
        </div>
      </div>
    </div>
    <div class="stats" style="padding:0 14px 14px">
      <div class="stat"><div class="k">Fama de asesinatos</div><div class="v pos">${fmt(d.KillFame)}</div><div class="s">PvP total</div></div>
      <div class="stat"><div class="k">Fama de muertes</div><div class="v neg">${fmt(d.DeathFame)}</div><div class="s">lo que te sacaron</div></div>
      <div class="stat"><div class="k">Ratio K/D</div><div class="v ${ratio >= 1 ? 'pos' : 'neg'}">${ratio == null ? '—' : ratio.toFixed(2)}</div><div class="s">fama kills / fama muertes</div></div>
      <div class="stat"><div class="k">Fama de crafteo</div><div class="v">${fmt((ls.Crafting || {}).Total)}</div><div class="s">total histórico</div></div>
    </div>
  </div>

  ${guild ? `
  <div class="panel">
    <div class="cd-title" style="padding:14px 14px 4px">Gremio: ${guild.Name}</div>
    <div class="stats" style="padding:0 14px 14px">
      <div class="stat"><div class="k">Miembros</div><div class="v">${fmt(guild.MemberCount)}</div><div class="s">${guild.AllianceName ? 'alianza ' + guild.AllianceName : 'sin alianza'}</div></div>
      <div class="stat"><div class="k">Fama de asesinatos</div><div class="v">${fmt(guild.killFame)}</div><div class="s">todo el gremio</div></div>
      <div class="stat"><div class="k">Fama de muertes</div><div class="v">${fmt(guild.DeathFame)}</div><div class="s">todo el gremio</div></div>
      <div class="stat"><div class="k">Fundado</div><div class="v" style="font-size:1rem">${guild.Founded ? new Date(guild.Founded).toLocaleDateString('es-AR') : '—'}</div><div class="s">por ${guild.FounderName || '—'}</div></div>
    </div>
    <div id="pfMembersBox" style="padding:0 14px 14px; display:flex; gap:8px; flex-wrap:wrap">
      <button class="btn" id="pfMembersBtn">Ver miembros del gremio (ranking de fama)</button>
      <button class="btn" id="pfGuildTopBtn">Mejores asesinatos del gremio (semana)</button>
    </div>
    <div id="pfGuildTopBox" style="padding:0 14px 14px; display:none"></div>
  </div>` : ''}

  <div class="panel">
    <div class="cd-title" style="padding:14px 14px 4px">Fama PvE y recolección</div>
    <div class="cd-grid" style="padding:0 14px 14px">
      <div class="cd-section">
        <div class="cd-title">PvE por zona</div>
        ${pveRows.map(([k, v]) => `<div class="cd-line"><span>${k}</span><span>${fmt(v)}</span></div>`).join('') || '<div class="muted micro">Sin datos</div>'}
      </div>
      <div class="cd-section">
        <div class="cd-title">Recolección y otros</div>
        <div class="cd-line"><span>Recolección (total)</span><span>${fmt(gat.Total)}</span></div>
        <div class="cd-line"><span>Pesca</span><span>${fmt(ls.FishingFame)}</span></div>
        <div class="cd-line"><span>Granja</span><span>${fmt(ls.FarmingFame)}</span></div>
        <div class="cd-line"><span>Crafteo</span><span>${fmt((ls.Crafting || {}).Total)}</span></div>
      </div>
    </div>
  </div>

  <div class="panel table-wrap">
    <div class="cd-title" style="padding:14px 14px 4px"><svg style="width:15px;height:15px;vertical-align:-2px"><use href="#i-bolt"/></svg> Asesinatos</div>
    <div class="chips" style="padding:4px 14px 8px" id="pfKillChips">
      <button class="chip ${PF.killMode === 'recent' ? 'active' : ''}" data-kmode="recent">Recientes ${kills ? `(${kills.length})` : ''}</button>
      <button class="chip ${PF.killMode === 'top' ? 'active' : ''}" data-kmode="top">Mejores (por fama)</button>
      <button class="chip ${PF.killMode === 'solo' ? 'active' : ''}" data-kmode="solo">En solitario</button>
    </div>
    ${(() => {
      const src = PF.killMode === 'top' ? PF.topkills : PF.killMode === 'solo' ? PF.solokills : kills;
      if (src === undefined || (PF.killMode !== 'recent' && src === null))
        return '<div class="loading-cell">Cargando…</div>';
      if (!src) return `<div class="loading-cell">El killboard no respondió — probá «Actualizar».</div>`;
      if (!src.length) return `<div class="loading-cell">${PF.killMode === 'solo' ? 'Sin asesinatos en solitario registrados.' : PF.killMode === 'top' ? 'Sin datos de mejores asesinatos.' : 'Sin asesinatos recientes.'}</div>`;
      return `<table class="ledger">
        <thead><tr><th>Fecha</th><th>Víctima</th><th class="num">IP víctima</th><th class="num">IP tuya</th><th class="num">Fama</th><th class="num">Participantes</th></tr></thead>
        <tbody>${src.map(ev => pfKillRow(ev, 'kill')).join('')}</tbody>
      </table>`;
    })()}
  </div>

  <div class="panel table-wrap">
    <div class="cd-title" style="padding:14px 14px 4px"><svg style="width:15px;height:15px;vertical-align:-2px"><use href="#i-skull"/></svg> Últimas muertes ${deaths ? `(${deaths.length})` : ''}</div>
    ${deaths && deaths.length ? `<table class="ledger">
      <thead><tr><th>Fecha</th><th>Asesino</th><th class="num">IP asesino</th><th class="num">IP tuya</th><th class="num">Fama perdida</th><th class="num">Participantes</th></tr></thead>
      <tbody>${deaths.map(ev => pfKillRow(ev, 'death')).join('')}</tbody>
    </table>` : `<div class="loading-cell">${deaths ? 'Sin muertes recientes. 🛡️' : 'El killboard no respondió — probá «Actualizar».'}</div>`}
  </div>
  <div class="micro muted pad">Fuente: killboard oficial de Albion Online (servidor Américas). La fama y los eventos pueden demorar en actualizarse. IP = poder de ítem promedio en el evento.</div>`;
}

(function initPF() {
  const inp = document.getElementById('pfSearch');
  const res = document.getElementById('pfResults');
  let searchTimer = null;
  inp.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = inp.value.trim();
    if (q.length < 3) { res.classList.remove('open'); return; }
    searchTimer = setTimeout(async () => {
      try {
        const data = await pfFetch('/search?q=' + encodeURIComponent(q));
        const players = (data.players || []).slice(0, 12);
        res.innerHTML = players.length
          ? players.map(p => `<div class="sr-item" data-id="${p.Id}" data-name="${p.Name}">
              <span class="chip-ico" style="flex:none"><svg><use href="#i-user"/></svg></span>
              <div><div class="n">${p.Name}</div><div class="m">${p.GuildName || 'sin gremio'}${p.AllianceName ? ' · ' + p.AllianceName : ''}</div></div>
            </div>`).join('')
          : '<div class="sr-item"><div><div class="n muted">Sin resultados</div><div class="m">Verificá el nombre exacto del personaje</div></div></div>';
        res.classList.add('open');
      } catch (e) {
        res.innerHTML = `<div class="sr-item"><div><div class="n muted">Killboard no disponible (${e.message})</div><div class="m">Reintentá en unos segundos</div></div></div>`;
        res.classList.add('open');
      }
    }, 450);
  });
  res.addEventListener('click', e => {
    const it = e.target.closest('.sr-item[data-id]'); if (!it) return;
    res.classList.remove('open');
    inp.value = it.dataset.name;
    pfLoadPlayer(it.dataset.id, it.dataset.name);
  });
  document.getElementById('pfRefresh').addEventListener('click', () => {
    if (PF.player) pfLoadPlayer(PF.player.id, PF.player.name);
  });

  /* clics dentro del resultado: expandir eventos, ver miembros, abrir perfil de un miembro */
  document.getElementById('pfResult').addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-ev]');
    if (tr) {
      PF.expandedEv = PF.expandedEv === tr.dataset.ev ? null : tr.dataset.ev;
      if (PF.lastRender) pfRender(PF.lastRender.d, PF.lastRender.kills, PF.lastRender.deaths, PF.lastRender.guild);
      return;
    }
    const kchip = e.target.closest('#pfKillChips [data-kmode]');
    if (kchip && PF.player) {
      PF.killMode = kchip.dataset.kmode;
      PF.expandedEv = null;
      const rerender = () => { if (PF.lastRender) pfRender(PF.lastRender.d, PF.lastRender.kills, PF.lastRender.deaths, PF.lastRender.guild); };
      rerender();
      // carga perezosa de top/solo la primera vez
      if (PF.killMode === 'top' && PF.topkills === null) {
        try { PF.topkills = pfAsArray(await pfFetchRetry(`/players/${PF.player.id}/topkills`)); }
        catch (err) { PF.topkills = false; }
        rerender();
      } else if (PF.killMode === 'solo' && PF.solokills === null) {
        try { PF.solokills = pfAsArray(await pfFetchRetry(`/players/${PF.player.id}/solokills`)); }
        catch (err) { PF.solokills = false; }
        rerender();
      }
      return;
    }
    const gtop = e.target.closest('#pfGuildTopBtn');
    if (gtop && PF.guildId) {
      gtop.textContent = 'Cargando…'; gtop.disabled = true;
      const box = document.getElementById('pfGuildTopBox');
      try {
        const top = pfAsArray(await pfFetchRetry(`/guilds/${PF.guildId}/top?range=week`));
        box.style.display = '';
        box.innerHTML = top && top.length ? `
          <div class="table-wrap"><table class="ledger">
            <thead><tr><th>Fecha</th><th>Asesino</th><th>Víctima</th><th class="num">IP víctima</th><th class="num">Fama</th></tr></thead>
            <tbody>${top.slice(0, 10).map(ev => `<tr>
              <td class="muted micro">${PF_FMT_DATE(ev.TimeStamp)}</td>
              <td><b>${ev.Killer.Name}</b></td>
              <td><div class="item-cell">${ev.Victim.Equipment?.MainHand ? iconImg(ev.Victim.Equipment.MainHand.Type, 'item-icon sm') : ''}<div>
                <div class="item-name">${ev.Victim.Name}</div>
                <div class="item-meta">${ev.Victim.GuildName || 'sin gremio'}</div></div></div></td>
              <td class="num">${ev.Victim.AverageItemPower ? fmt(ev.Victim.AverageItemPower) : '—'}</td>
              <td class="num pos">${fmt(ev.TotalVictimKillFame)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="micro muted" style="margin-top:6px">Los 10 mejores asesinatos del gremio en los últimos 7 días, por fama.</div>`
          : '<div class="loading-cell">Sin asesinatos del gremio esta semana.</div>';
        gtop.style.display = 'none';
      } catch (err) {
        gtop.textContent = 'El killboard no respondió — probá de nuevo'; gtop.disabled = false;
      }
      return;
    }
    const mbtn = e.target.closest('#pfMembersBtn');
    if (mbtn && PF.guildId) {
      mbtn.textContent = 'Cargando miembros…'; mbtn.disabled = true;
      try {
        const members = pfAsArray(await pfFetchRetry(`/guilds/${PF.guildId}/members`));
        const sorted = [...members].sort((a, b) => (b.KillFame || 0) - (a.KillFame || 0));
        document.getElementById('pfMembersBox').innerHTML = `
          <div class="table-wrap"><table class="ledger">
            <thead><tr><th>#</th><th>Jugador</th><th class="num">Fama de asesinatos</th><th class="num">Fama de muertes</th><th class="num">Ratio</th></tr></thead>
            <tbody>${sorted.map((m, i) => `
              <tr class="clickable" data-member-id="${m.Id}" data-member-name="${m.Name}" title="Ver el perfil de ${m.Name}">
                <td class="muted">${i + 1}</td>
                <td><b>${m.Name}</b></td>
                <td class="num">${fmt(m.KillFame)}</td>
                <td class="num">${fmt(m.DeathFame)}</td>
                <td class="num ${(m.KillFame || 0) >= (m.DeathFame || 0) ? 'pos' : 'neg'}">${m.DeathFame > 0 ? ((m.KillFame || 0) / m.DeathFame).toFixed(2) : '—'}</td>
              </tr>`).join('')}</tbody>
          </table></div>
          <div class="micro muted" style="margin-top:6px">${sorted.length} miembros, ordenados por fama de asesinatos. Hacé clic en uno para ver su perfil.</div>`;
      } catch (err) {
        mbtn.textContent = 'El killboard no respondió — probá de nuevo'; mbtn.disabled = false;
      }
      return;
    }
    const member = e.target.closest('tr[data-member-id]');
    if (member) {
      document.getElementById('pfSearch').value = member.dataset.memberName;
      window.scrollTo({ top: 0 });
      pfLoadPlayer(member.dataset.memberId, member.dataset.memberName);
    }
  });

  /* especializaciones: edición en vivo + persistencia + aplicación a pestañas */
  pfRenderSpecs();
  document.getElementById('pfSpecList').addEventListener('change', e => {
    const sp = e.target.closest('[data-spec]');
    const ma = e.target.closest('[data-mast]');
    if (!sp && !ma) return;
    const key = (sp || ma).dataset.spec || (sp || ma).dataset.mast;
    if (!pfSpecs[key]) pfSpecs[key] = { spec: 0, mastery: 0 };
    if (sp) pfSpecs[key].spec = Math.max(0, Math.min(120, parseInt(sp.value) || 0));
    if (ma) pfSpecs[key].mastery = Math.max(0, Math.min(100, parseInt(ma.value) || 0));
    pfSaveSpecs();
    pfRenderSpecs();
    pfApplySpecs();
    // recalcular la pestaña afectada si ya tiene precios cargados
    if (key === 'gear') {
      if (typeof GEAR !== 'undefined' && GEAR.loadedOnce) renderGear();
    } else {
      const mod = craftModules[key];
      if (mod && mod.loadedOnce && typeof mod.render === 'function') mod.render();
    }
  });

  /* al abrir la pestaña: recordar el último jugador buscado */
  craftModules['profile'] = {
    get loadedOnce() { return PF.loadedOnce; },
    loadPrices() {
      PF.loadedOnce = true;
      try {
        const saved = JSON.parse(localStorage.getItem('pfPlayer') || 'null');
        if (saved) { document.getElementById('pfSearch').value = saved.name; pfLoadPlayer(saved.id, saved.name); }
      } catch (e) {}
    },
  };

  /* aplicar especializaciones guardadas a las pestañas de crafteo al iniciar */
  setTimeout(pfApplySpecs, 400);
})();

/* ====================================================================
   🔔 ALERTAS DE PRECIO — monitor mientras la app está abierta.
   Un temporizador global verifica cada N minutos (fetch agrupado con el
   mismo chunker de fetchPrices → una sola tanda de requests por ciclo),
   dispara con toast + sonido + notificación del navegador (opcional) y
   persiste en localStorage ('priceAlerts' + 'alertSettings').
   Sin servidor ni service worker: si cerrás la pestaña, no hay alertas.
   ==================================================================== */
const WA = {
  list: [], formItem: null,
  intervalMin: 5, sound: true, browser: false,
  timer: null, running: false, fails: 0, lastError: null, lastCheck: null, nextAt: 0,
  prices: null,
};
try { WA.list = JSON.parse(localStorage.getItem('priceAlerts') || '[]'); } catch (e) {}
try { Object.assign(WA, JSON.parse(localStorage.getItem('alertSettings') || '{}')); } catch (e) {}
function waSave() { localStorage.setItem('priceAlerts', JSON.stringify(WA.list)); }
function waSaveCfg() { localStorage.setItem('alertSettings', JSON.stringify({ intervalMin: WA.intervalMin, sound: WA.sound, browser: WA.browser })); }

function waIntervalMin() { return Math.max(1, Math.min(60, parseInt(WA.intervalMin, 10) || 5)); }
function waIntervalMs() { return waIntervalMin() * 60e3; }
function waPct(v) { return v == null || isNaN(v) ? '—' : v.toFixed(1).replace('.', ',') + '%'; }
function waCd(ms) { if (!(ms > 0)) return 'ahora'; const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

/* Precio/valor actual de la alerta según su métrica. `src` permite evaluar con
   datos frescos del motor o, al pintar la tabla, con lo último que se cargó. */
function waValue(a, src) {
  const map = src || WA.prices || (typeof flipData !== 'undefined' ? flipData : null);
  if (!map) return { value: null };
  const d = map[a.id];
  if (!d) return { value: null };
  if (a.metric === 'flip') {
    let lo = null, hi = null;
    for (const city of CITIES) {
      const p = d[city];
      if (!p || !p.sell) continue;
      if (!lo || p.sell < lo.v) lo = { v: p.sell, city };
      if (!hi || p.sell > hi.v) hi = { v: p.sell, city };
    }
    if (!lo || !hi || lo.city === hi.city) return { value: null };
    const tax = (document.getElementById('flipPremium').checked ? 0.04 : 0.08)
              + (document.getElementById('flipSetup').checked ? 0.025 : 0);
    return { value: (hi.v * (1 - tax) - lo.v) / lo.v * 100, from: lo.city, to: hi.city };
  }
  const p = d[a.city];
  if (!p) return { value: null };
  const v = a.metric === 'sell' ? p.sell : p.buy;
  return { value: v > 0 ? v : null };
}
function waMet(a, v) {
  if (v == null) return false;
  return a.metric === 'sell' ? v <= a.threshold : v >= a.threshold;
}
function waDist(a, cur) {
  if (cur.value == null) return '—';
  if (a.metric === 'flip') {
    const d = a.threshold - cur.value;
    return d <= 0 ? '✓' : '+' + d.toFixed(1).replace('.', ',') + ' pp';
  }
  if (a.metric === 'sell') {
    const d = (cur.value - a.threshold) / (a.threshold || 1) * 100;
    return d <= 0 ? '✓' : '−' + d.toFixed(1).replace('.', ',') + '%';
  }
  const d = (a.threshold - cur.value) / (a.threshold || 1) * 100;
  return d <= 0 ? '✓' : '−' + d.toFixed(1).replace('.', ',') + '%';
}
function waCondText(a) {
  if (a.metric === 'flip') return 'Mejor flip ≥ ' + waPct(a.threshold);
  return (a.metric === 'sell' ? 'Venta ≤ ' : 'Orden de compra ≥ ') + fmt(a.threshold) + ' en ' + a.city;
}

async function waCheck() {
  if (WA.running) return;
  const act = WA.list.filter(a => a.on);
  if (!act.length) { waRender(); waStatus(); return; }
  WA.running = true;
  waStatus();
  try {
    const ids = [...new Set(act.map(a => a.id))];
    WA.prices = await fetchPrices(ids, CITIES);
    WA.fails = 0;
    WA.lastError = null;
    WA.lastCheck = Date.now();
    let dirty = false;
    for (const a of act) {
      const cur = waValue(a, WA.prices);
      const met = waMet(a, cur.value);
      a.price = cur.value; a.from = cur.from || null; a.to = cur.to || null;
      a.lastCheck = Date.now();
      if (met && !a.fired) {
        a.fired = true; a.firedAt = Date.now();
        if (a.once) a.on = false;
        waNotify(a, cur);
        dirty = true;
      } else if (!met && a.fired) { a.fired = false; dirty = true; } // re-arma al dejar de cumplirse
    }
    if (dirty) waSave();
  } catch (e) {
    WA.fails++;
    WA.lastError = e.message;
    if (WA.fails === 3) waToast('⚠️ Alertas sin respuesta', 'La API de precios falla hace 3 ciclos. Se reintenta sola en el próximo.', 'err');
  }
  WA.running = false;
  waRender();
  waStatus();
}
async function waTick() {
  await waCheck();
  if (WA.list.some(a => a.on)) waSchedule(waIntervalMs());
  else { clearTimeout(WA.timer); WA.nextAt = 0; waStatus(); }
}
function waSchedule(ms) { clearTimeout(WA.timer); WA.timer = setTimeout(waTick, ms); WA.nextAt = Date.now() + ms; waStatus(); }
function waRestart() {
  clearTimeout(WA.timer);
  if (WA.list.some(a => a.on)) waSchedule(waIntervalMs());
  else { WA.nextAt = 0; waStatus(); }
}

/* ---- disparos: toast + beep + Notification (opcional) ---- */
function waToast(title, msg, cls) {
  let stack = document.getElementById('waToasts');
  if (!stack) { stack = document.createElement('div'); stack.id = 'waToasts'; stack.className = 'wa-toasts'; document.body.appendChild(stack); }
  const d = document.createElement('div');
  d.className = 'wa-toast' + (cls ? ' ' + cls : '');
  d.innerHTML = `<div style="min-width:0"><div class="t-n">${title}</div><div class="t-m">${msg}</div></div>`;
  d.addEventListener('click', () => { gotoTab('alerts'); d.remove(); });
  stack.appendChild(d);
  while (stack.children.length > 4) stack.firstChild.remove();
  setTimeout(() => d.remove(), 15000);
}
function waBeep() {
  if (!WA.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    WA.ac = WA.ac || new Ctx();
    if (WA.ac.state === 'suspended') WA.ac.resume().catch(() => {});
    const t = WA.ac.currentTime;
    [[880, 0], [1318.5, 0.16]].forEach(([f, dt]) => {
      const o = WA.ac.createOscillator();
      const g = WA.ac.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.3);
      o.connect(g);
      g.connect(WA.ac.destination);
      o.start(t + dt);
      o.stop(t + dt + 0.32);
    });
  } catch (e) {}
}
function waNotify(a, cur) {
  const valTxt = a.metric === 'flip'
    ? waPct(cur.value) + (cur.from ? ' (' + cur.from + ' → ' + cur.to + ')' : '')
    : fmt(cur.value) + ' en ' + a.city;
  const msg = (a.metric === 'sell' ? 'Venta cayó a ' : a.metric === 'buy' ? 'Orden de compra subió a ' : 'Flip rinde ') + valTxt
    + ' · umbral ' + (a.metric === 'flip' ? waPct(a.threshold) : fmt(a.threshold));
  waToast('🔔 ' + (a.name || a.id), msg + (a.once ? ' (alerta apagada tras disparar)' : ''));
  waBeep();
  if (WA.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification('Ayudante Albion — ' + (a.name || a.id), { body: msg, tag: a.uid });
      n.onclick = () => { window.focus(); gotoTab('alerts'); };
    } catch (e) {}
  }
}

/* ---- render de la lista ---- */
function waRender() {
  const body = document.getElementById('waBody');
  if (!body) return;
  if (!WA.list.length) {
    body.innerHTML = '<tr><td colspan="8" class="loading-cell">Sin alertas todavía. Creá una arriba o tocá 🔔 en una fila de Flipping.</td></tr>';
    return;
  }
  body.innerHTML = WA.list.map(a => {
    const cur = waValue(a);
    const met = waMet(a, cur.value);
    const state = !a.on
      ? (a.fired ? '<span class="badge gold">🔔 disparada</span>' : '<span class="badge">apagada</span>')
      : met ? '<span class="badge gold">🔔 ¡se cumple!</span>'
            : '<span class="badge" style="color:var(--green);border-color:rgba(20,185,138,.4)">vigilando</span>';
    const valTxt = cur.value == null ? '<span class="badge warn">sin datos</span>'
      : (a.metric === 'flip' ? waPct(cur.value) : fmt(cur.value));
    const route = a.metric === 'flip' && a.from ? '<span class="price-sub">' + a.from + ' → ' + a.to + '</span>' : '';
    return `<tr>
      <td><div class="item-cell">${iconImg(a.id, 'item-icon sm')}
        <div><div class="item-name">${a.name || catalogName(a.id)}</div><div class="item-meta">${a.id}</div></div></div></td>
      <td>${waCondText(a)}${route}</td>
      <td class="num ${met ? 'pos' : ''}">${valTxt}</td>
      <td class="num">${a.metric === 'flip' ? waPct(a.threshold) : fmt(a.threshold)}</td>
      <td class="num ${met ? 'pos' : 'muted'}">${waDist(a, cur)}</td>
      <td>${state}</td>
      <td class="muted micro">${a.lastCheck ? new Date(a.lastCheck).toLocaleTimeString('es-AR') : '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn micro-btn" data-wa-on="${a.uid}" title="${a.on ? 'Pausar' : 'Activar (se re-arma)'}">${a.on ? '⏸' : '▶'}</button>
        <button class="btn micro-btn" data-wa-del="${a.uid}" title="Eliminar">✕</button>
      </td>
    </tr>`;
  }).join('');
}
function waStatus() {
  const el = document.getElementById('waStatus');
  if (!el) return;
  const on = WA.list.filter(a => a.on).length;
  if (!on) { el.textContent = 'Sin alertas activas — verificación en pausa.'; return; }
  if (WA.running) { el.textContent = 'Verificando ' + on + ' alerta(s)…'; return; }
  let t = on + ' alerta(s) activas · cada ' + waIntervalMin() + ' min · próxima en ' + waCd(WA.nextAt - Date.now());
  if (WA.lastCheck) t += ' · última hace ' + Math.max(0, Math.round((Date.now() - WA.lastCheck) / 6e4)) + ' min';
  if (WA.lastError) t += ' · ⚠ ' + WA.lastError + (WA.fails > 1 ? ' (' + WA.fails + ' fallos seguidos)' : '');
  el.textContent = t;
}
// countdown vivo mientras la pestaña está a la vista
setInterval(() => {
  const p = document.getElementById('tab-alerts');
  if (p && p.classList.contains('active') && WA.nextAt) waStatus();
}, 1000);

/* ---- formulario ---- */
function waUpdateForm() {
  const m = document.getElementById('waMetric').value;
  document.getElementById('waCityWrap').style.display = m === 'flip' ? 'none' : '';
  document.getElementById('waThLabel').textContent = m === 'flip' ? 'Ganancia mínima (%)' : 'Precio (plata)';
  document.getElementById('waThreshold').placeholder = m === 'flip' ? 'ej: 15' : 'ej: 1500';
}
function waAddAlert() {
  if (!WA.formItem) { alert('Elegí un ítem del buscador primero.'); return; }
  const metric = document.getElementById('waMetric').value;
  const th = parseFloat(document.getElementById('waThreshold').value);
  if (!(th > 0)) { alert('Cargá un umbral mayor que 0' + (metric === 'flip' ? ' (porcentaje: 15 = 15%).' : '.')); return; }
  if (WA.list.length >= 30) { alert('Máximo 30 alertas para no saturar la API de precios.'); return; }
  WA.list.unshift({
    uid: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    id: WA.formItem, name: catalogName(WA.formItem), metric,
    city: metric === 'flip' ? '' : document.getElementById('waCity').value,
    threshold: th, once: document.getElementById('waOnce').checked,
    on: true, fired: false, price: null, from: null, to: null, lastCheck: null, createdAt: Date.now(),
  });
  waSave();
  waRender();
  waRestart();
  document.getElementById('waThreshold').value = '';
}
/* acceso rápido desde Flipping: prefill con la ruta/margen actual del ítem */
function waPrefillFlip(id) {
  gotoTab('alerts');
  WA.formItem = id;
  document.getElementById('waItemInput').value = catalogName(id);
  const f = flipCalc(id);
  const met = document.getElementById('waMetric');
  const th = document.getElementById('waThreshold');
  const city = document.getElementById('waCity');
  if (f.profit > 0) {
    met.value = 'flip';
    th.value = Math.max(1, Math.floor(f.margin * 100));
  } else if (f.bestBuy) {
    met.value = 'sell';
    city.value = f.bestBuy.city;
    th.value = Math.floor(f.bestBuy.price * 1.1); // avisa si la venta baja 10% más
  }
  waUpdateForm();
}
function waPermUpdate() {
  const btn = document.getElementById('waPerm');
  if (!btn) return;
  if (typeof Notification === 'undefined') { btn.style.display = 'none'; document.getElementById('waBrowser').closest('label').style.display = 'none'; return; }
  btn.textContent = Notification.permission === 'granted' ? '✓ Permiso concedido'
    : Notification.permission === 'denied' ? 'Bloqueado por el navegador' : 'Conceder permiso';
  btn.disabled = Notification.permission !== 'default';
}

(function initWA() {
  document.getElementById('waCity').innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');
  document.getElementById('waInterval').value = waIntervalMin();
  document.getElementById('waSound').checked = WA.sound !== false;
  document.getElementById('waBrowser').checked = !!WA.browser;
  document.getElementById('waMetric').addEventListener('change', waUpdateForm);
  document.getElementById('waAdd').addEventListener('click', waAddAlert);
  document.getElementById('waNow').addEventListener('click', waTick);
  document.getElementById('waInterval').addEventListener('change', e => {
    WA.intervalMin = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 5));
    e.target.value = waIntervalMin();
    waSaveCfg();
    waRestart();
  });
  document.getElementById('waSound').addEventListener('change', e => { WA.sound = e.target.checked; waSaveCfg(); });
  document.getElementById('waBrowser').addEventListener('change', e => {
    WA.browser = e.target.checked;
    if (WA.browser && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      Notification.requestPermission().then(p => {
        if (p !== 'granted') { WA.browser = false; e.target.checked = false; }
        waSaveCfg(); waPermUpdate();
      }).catch(() => {});
    } else waSaveCfg();
  });
  document.getElementById('waPerm').addEventListener('click', () => {
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then(() => {
      waPermUpdate();
      const chk = document.getElementById('waBrowser');
      if (Notification.permission === 'granted') { chk.checked = true; WA.browser = true; waSaveCfg(); }
    }).catch(() => {});
  });

  // buscador de ítems (mismo patrón que el resto de la app)
  const inpt = document.getElementById('waItemInput');
  const res = document.getElementById('waItemResults');
  inpt.addEventListener('input', () => {
    const q = inpt.value.trim().toLowerCase();
    if (q.length < 2 || !CATALOG) { res.classList.remove('open'); return; }
    const hits = [];
    for (const [id, es, en, tier, maxEnch] of CATALOG) {
      if (es.toLowerCase().includes(q) || en.toLowerCase().includes(q) || id.toLowerCase().includes(q)) {
        hits.push([id, es, tier]);
        if (hits.length >= 25) break;
      }
    }
    res.innerHTML = hits.map(([id, es, tier]) =>
      `<div class="sr-item" data-id="${id}" data-name="${es}">${iconImg(id, 'item-icon sm')}<div><div class="n">${es}</div><div class="m">T${tier} · ${id}</div></div></div>`).join('');
    res.classList.toggle('open', hits.length > 0);
  });
  res.addEventListener('click', e => {
    const it = e.target.closest('.sr-item'); if (!it) return;
    WA.formItem = it.dataset.id;
    inpt.value = it.dataset.name;
    res.classList.remove('open');
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) res.classList.remove('open'); });

  document.getElementById('waBody').addEventListener('click', e => {
    const tg = e.target.closest('[data-wa-on]');
    if (tg) {
      const a = WA.list.find(x => x.uid === tg.dataset.waOn);
      if (a) { a.on = !a.on; if (a.on) a.fired = false; waSave(); waRender(); waRestart(); }
      return;
    }
    const dl = e.target.closest('[data-wa-del]');
    if (dl) { WA.list = WA.list.filter(x => x.uid !== dl.dataset.waDel); waSave(); waRender(); waRestart(); }
  });

  waPermUpdate();
  waUpdateForm();
  waRender();
  waRestart();
  // primera verificación poco después de cargar (no compite con el fetch inicial de flipping)
  setTimeout(() => { if (WA.list.some(a => a.on)) waTick(); }, 4000);
})();

/* ====================================================================
   🎥 ESTADO DE TWITCH — indicador EN VIVO / OFFLINE en «Creadores de SG».
   Fuente: DecAPI (https://decapi.me/twitch/uptime/{canal}), sin clave.
   Responde el tiempo al aire si está transmitiendo o "…is offline".
   Se prueba fetch directo primero; si falla (CORS/red, p. ej. hosting
   estático), se cae al proxy local /twitch/ que incluyen server.py y el
   .exe. Nunca rompe: si nada responde, la tarjeta se queda sin badge.
   Refresca cada 60 s solo con la pestaña SG visible y cachea en
   sessionStorage para no parpadear al cambiar de pestaña.
   ==================================================================== */
const TW = { chs: [], timer: null, checking: false };
function twParse(txt) {
  if (!txt) return null;
  const t = String(txt).trim();
  if (!t || /not exist|rate limit|slow down|whoa|error|unavailable/i.test(t)) return null;
  if (/offline/i.test(t)) return { live: false };
  const h = t.match(/(\d+)\s*h/i), m = t.match(/(\d+)\s*m/i);
  const up = (h || m) ? [h ? h[1] + ' h' : '', m ? m[1] + ' min' : ''].filter(Boolean).join(' ') : t;
  return { live: true, up };
}
function twPaint(c, st) {
  const on = st && st.live === true, off = st && st.live === false;
  c.badge.className = 'sg-live' + (on ? ' live' : off ? ' off' : '');
  c.badge.innerHTML = on
    ? '<span class="dot"></span>EN VIVO' + (st.up ? ' · ' + st.up : '')
    : off ? '<span class="dot"></span>OFFLINE' : '';
  c.el.classList.toggle('sg-live-on', !!on);
}
async function twFetch(chan) {
  try {
    const r = await fetch('https://decapi.me/twitch/uptime/' + chan, { cache: 'no-store' });
    if (r.ok) return await r.text();
  } catch (e) {}
  try {
    const r = await fetch('/twitch/uptime/' + chan, { cache: 'no-store' });
    if (r.ok) return await r.text();
  } catch (e) {}
  return null;
}
async function twCheckAll() {
  if (TW.checking || !TW.chs.length) return;
  TW.checking = true;
  try {
    for (const c of TW.chs) {
      const st = twParse(await twFetch(c.chan));
      if (!st) continue; // sin respuesta confiable: conservar lo último
      c.state = st;
      twPaint(c, st);
      Object.assign(TW.cache, { [c.chan]: st });
      await new Promise(r => setTimeout(r, 350)); // escalonado, no saturar DecAPI
    }
    try { sessionStorage.setItem('twitchLive', JSON.stringify(TW.cache)); } catch (e) {}
  } catch (e) {
  } finally {
    TW.checking = false;
  }
}
(function initTwitch() {
  document.querySelectorAll('.sg-creator[data-twitch]').forEach(el => {
    TW.chs.push({ el, chan: el.dataset.twitch, badge: el.querySelector('.sg-live'), state: null });
  });
  if (!TW.chs.length) return;
  try { TW.cache = JSON.parse(sessionStorage.getItem('twitchLive') || '{}'); } catch (e) { TW.cache = {}; }
  if (!TW.cache) TW.cache = {};
  // pintar lo último sabido al toque, y verificar enseguida + cada 60 s
  TW.chs.forEach(c => { if (TW.cache[c.chan]) twPaint(c, TW.cache[c.chan]); });
  twCheckAll();
  TW.timer = setInterval(() => {
    const p = document.getElementById('tab-sg');
    if (p && p.classList.contains('active')) twCheckAll();
  }, 60e3);
})();
