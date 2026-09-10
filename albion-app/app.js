/* ===== Ayudante Albion — servidor Americas (West) ===== */
const API = 'https://west.albion-online-data.com/api/v2/stats';
/* Proxy de Cloudflare para killboard y badges (no envían CORS o hay que
   proteger la cuota). El exe y el server local lo usan solo como respaldo.
   Para pruebas, se puede pisar en runtime con localStorage.setItem('aaProxy', url). */
const AA_WORKER = 'https://ayudantealbion.josemesina21.workers.dev';
const WORKER_URL = (() => {
  let v = '';
  try { v = localStorage.getItem('aaProxy') || ''; } catch (e) {}
  return (v || AA_WORKER).replace(/\/+$/, '');
})();
const ICON = id => `https://render.albiononline.com/v1/item/${id}.png?size=64`;
// Íconos locales (carpeta icons/): carga instantánea, sin depender del servicio de render.
// Solo ítems base: los encantados (@1..@4) tienen ícono propio y van al servicio remoto.
const ICON_LOCAL = id => id.includes('@') ? null : `icons/${id}.png`;

/* Cadena de carga: ícono local → servicio de render (con reintentos por los 502
   intermitentes) → placeholder. */
const IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="%231d2129"/><text x="32" y="40" font-size="26" text-anchor="middle" fill="%238b93a3">?</text></svg>'
).replace(/%25/g, '%');
/* Delegación de eventos para los botones que antes usaban onclick inline.
   Necesario para servir la app con una CSP sin 'unsafe-inline' en scripts. */
document.addEventListener('click', e => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const ll = t.closest('[data-ll-id]');
  if (ll) { llPrefill(ll.dataset.llId, ll.dataset.llType, +ll.dataset.llPrice, ll.dataset.llCity || ''); return; }
  const wa = t.closest('[data-wa-flip]');
  if (wa) { waPrefillFlip(wa.dataset.waFlip); return; }
  const cd = t.closest('[data-close-detail]');
  if (cd) { const box = cd.closest(cd.dataset.closeDetail); if (box) box.style.display = 'none'; return; }
  const soon = t.closest('a.sg-creator-soon');
  if (soon) e.preventDefault();
});
/* 'error' no burbujea: se captura en fase de captura para <img data-img-retry> */
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.hasAttribute('data-img-retry')) imgRetry(img);
  else if (img.hasAttribute('data-sg-avatar')) sgAvatarFail(img);
}, true);

/* Latido para el ejecutable de escritorio: avisa al servidor local que la
   pestaña sigue abierta (tolera 15 min sin latidos). En GitHub Pages y en
   server.py /alive responde 404 y no hace nada. Vive acá y no como <script>
   inline para cumplir la CSP (script-src 'self'). */
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  setInterval(() => { fetch('/alive').catch(() => {}); }, 3000);
}

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
  return `<img class="${cls}" loading="lazy" src="${src}" data-local="${local ? 1 : 0}" data-base="${ICON(id)}" data-img-retry alt=""${title ? ` title="${title}"` : ''}>`;
}
const CITIES = ['Bridgewatch','Caerleon','Fort Sterling','Lymhurst','Martlock','Thetford','Brecilien'];
// El Black Market compra equipo al jugador; nunca es origen de compra.
const BLACK_MARKET = 'Black Market';
const SELL_CITIES = [...CITIES, BLACK_MARKET];
function saleQuote(p, city) {
  return city === BLACK_MARKET
    ? { price: p?.buy || 0, date: p?.buyDate }
    : { price: p?.sell || 0, date: p?.sellDate };
}
function saleTax(city, premium, setup) {
  return (premium ? 0.04 : 0.08) + (city !== BLACK_MARKET && setup ? 0.025 : 0);
}
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
        sell: row.city === BLACK_MARKET ? 0 : row.sell_price_min || 0,
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
function gotoTab(key, sgTab) {
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
  document.querySelectorAll('.dd-item').forEach(i => i.classList.toggle('active', i.dataset.tab === key));
  document.querySelectorAll('.top-action').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  for (const g of DD_GROUPS) {
    document.getElementById(g.btn).classList.toggle('active', g.keys.includes(key));
  }
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + key));
  const mod = craftModules[key];
  if (mod && !mod.loadedOnce) mod.loadPrices();
  if (key === 'sg') sgSelectTab(sgTab || SG.tab);
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
  gotoTab(card.dataset.goto, card.dataset.goto === 'sg' ? 'guild' : undefined);
});

/* ---- slides de Inicio: Crafteo y Flipping ---- */
const homeSlideTabs = [...document.querySelectorAll('[data-home-slide]')];
let homeSlideIndex = 0;
function homeShowSlide(index, focusTab = false) {
  // Flechas cíclicas: después del último slide vuelve el primero.
  homeSlideIndex = (index + homeSlideTabs.length) % homeSlideTabs.length;
  homeSlideTabs.forEach((tab, i) => {
    const active = i === homeSlideIndex;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
  document.getElementById('homeSlideCount').textContent = `${homeSlideIndex + 1} de ${homeSlideTabs.length}`;
  if (focusTab) homeSlideTabs[homeSlideIndex].focus();
}
homeSlideTabs.forEach(tab => {
  tab.addEventListener('click', () => homeShowSlide(+tab.dataset.homeSlide));
  tab.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? homeSlideTabs.length - 1
      : homeSlideIndex + (e.key === 'ArrowRight' ? 1 : -1);
    homeShowSlide(index, true);
  });
});
document.getElementById('homeSlidePrev').addEventListener('click', () => homeShowSlide(homeSlideIndex - 1));
document.getElementById('homeSlideNext').addEventListener('click', () => homeShowSlide(homeSlideIndex + 1));

/* ====================================================================
   FAVORITOS — marcá recetas/ítems con ★ y velos juntos en Inicio
   ==================================================================== */
const FAV = { list: [] };
try { FAV.list = JSON.parse(localStorage.getItem('favorites') || '[]'); } catch (e) {}
const FAV_TABS = { food: 'Cocina', alch: 'Alquimia', refine: 'Refinamiento', gear: 'Crafteo', enchant: 'Encantar Item', farm: 'Granja', flip: 'Flipping', transmute: 'Transmutación' };
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
      <div class="micro muted">Cada ciudad se especializa en un recurso, que recibe un bono de refinamiento. Haz clic en una ciudad para seleccionar su bono de refinamiento.</div>
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
  </div>
  ${cfg.planner ? `<div class="panel refine-planner">
    <h3>Planeador de refinamiento</h3>
    <div class="control-grid secondary">
      <div class="control"><label>Producto a refinar</label><select id="${P}PlanItem"></select></div>
      <div class="control"><label>Cantidad de lotes</label><input type="number" id="${P}PlanQty" value="1" min="1" step="1"></div>
    </div>
    <div class="stat-row" id="${P}PlanStats"></div>
    <div id="${P}PlanMaterials" class="planner-materials"></div>
  </div>` : ''}`;

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

  function updatePlanner() {
    if (!cfg.planner || !m.DATA || !Object.keys(m.prices).length) return;
    const sel = $('PlanItem');
    const recipes = m.DATA.recipes;
    if (!sel.options.length) sel.innerHTML = recipes.map(r => `<option value="${r.id}">${r.name_es || r.name_en || r.id} (T${r.tier}${r.ench ? '.' + r.ench : ''})</option>`).join('');
    const r = recipes.find(x => x.id === sel.value) || recipes[0];
    if (!r) return;
    sel.value = r.id;
    const qty = Math.max(1, parseInt($('PlanQty').value, 10) || 1);
    const opts = getOpts(), c = calcRecipe(r, opts);
    const totalOut = qty * r.amount;
    const profit = c.profit * qty;
    $('PlanStats').innerHTML = `<div class="stat"><div class="k">Producción</div><div class="v">${fmt(totalOut)} unidades</div><div class="s">${qty} lote${qty === 1 ? '' : 's'}</div></div><div class="stat"><div class="k">Costo materiales + estación</div><div class="v">${isNaN(c.totalCost) ? '—' : fmt(c.totalCost * qty)}</div><div class="s">precios actuales</div></div><div class="stat"><div class="k">Ganancia total</div><div class="v ${profit > 0 ? 'pos' : 'neg'}">${isNaN(profit) ? '—' : (profit > 0 ? '+' : '') + fmt(profit)}</div><div class="s">después de impuestos</div></div>`;
    $('PlanMaterials').innerHTML = `<strong>Materiales a comprar</strong><div class="planner-material-list">${r.resources.map(res => `<span class="planner-material">${iconImg(res.id, 'item-icon sm', m.DATA.ingredients[res.id]?.name_es || res.id)} <b>${fmt(res.count * qty)}</b> ${m.DATA.ingredients[res.id]?.name_es || res.id}</span>`).join('')}</div>`;
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
    updatePlanner();

    const priced = m.rows.filter(x => !isNaN(x.c.profit));
    const profitable = priced.filter(x => x.c.profit > 0);
    const best = profitable.slice().sort((a, b) => b.c.profit - a.c.profit)[0];
    $('Stats').innerHTML = `
      <div class="stat"><div class="k">Líneas rentables</div><div class="v ${profitable.length ? 'pos' : ''}">${profitable.length}</div><div class="s">de ${priced.length} con precio (${m.rows.length} mostradas)</div></div>
      <div class="stat"><div class="k">Mejor crafteo</div><div class="v">${best ? best.name : '—'}</div><div class="s">${best ? '+' + fmt(best.c.profit) + ' plata / lote' : 'sin crafteos rentables'}</div></div>
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

  if (cfg.planner) {
    $('PlanItem').addEventListener('change', m.render);
    $('PlanQty').addEventListener('input', m.render);
  }

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
            <button class="btn micro-btn" data-ll-id="${r.id}" data-ll-type="craft" data-ll-price="${((c.matCost || 0) + (c.stationFee || 0)) / (r.amount || 1)}" data-ll-city=""" title="Anotar el crafteo (materiales + estación, por unidad) en el Registro">✎ Registrar crafteo</button>
            ${sellEp.value ? `<button class="btn micro-btn" data-ll-id="${r.id}" data-ll-type="sell" data-ll-price="${sellEp.value}" data-ll-city="${opts.sellCity}" title="Anotar la venta en el Registro">✎ Registrar venta</button>` : ''}
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
const flipBranch = document.getElementById('flipBranch');
const flipEnch = document.getElementById('flipEnch');
const flipResults = document.getElementById('flipResults');
const FLIP_BRANCHES = {
  weapons: 'Armas', head: 'Cabeza', armors: 'Armaduras', shoes: 'Calzado',
  offhands: 'Mano secundaria', capes: 'Capas', bags: 'Bolsos',
  gathering: 'Recolección', consumables: 'Consumibles', mounts: 'Monturas',
  crafting: 'Crafteo', farming: 'Granja', artefacts: 'Artefactos',
  furniture: 'Muebles', other: 'Otros'
};

function initFlipFilters() {
  for (const [value, label] of Object.entries(FLIP_BRANCHES)) {
    const o = document.createElement('option'); o.value = value; o.textContent = label;
    flipBranch.appendChild(o);
  }
}
initFlipFilters();

/* ---- filtros del monitoreo: rama y encantamiento acotan la tabla de ítems
   monitoreados (no el buscador). Ej.: Armas + .1 → solo armas .1 en la vista ---- */
function flipFilterActive() {
  return !!flipBranch.value || flipEnch.value !== 'all';
}
function flipFilterLabel() {
  const parts = [];
  if (flipBranch.value) parts.push(FLIP_BRANCHES[flipBranch.value] || flipBranch.value);
  if (flipEnch.value !== 'all') parts.push('.' + flipEnch.value);
  return parts.join(' · ');
}
let catalogIndex = null; // id → fila del catálogo; se arma al primer uso
function catalogRow(baseId) {
  if (!CATALOG) return null;
  if (!catalogIndex) {
    catalogIndex = new Map();
    for (const row of CATALOG) catalogIndex.set(row[0], row);
  }
  return catalogIndex.get(baseId) || null;
}
// ¿el ítem monitoreado entra en el filtro vigente? La rama sale del catálogo
// (columna 6) y el encantamiento, del sufijo @1..@4 del ID (sin sufijo = .0).
function flipMatchesFilter(id) {
  if (!flipFilterActive()) return true;
  if (flipEnch.value !== 'all') {
    const ench = id.includes('@') ? +id.split('@')[1] : 0;
    if (ench !== +flipEnch.value) return false;
  }
  if (flipBranch.value) {
    const row = catalogRow(id.split('@')[0]);
    if (!row || row[5] !== flipBranch.value) return false;
  }
  return true;
}
function flipResetFilter() {
  flipBranch.value = '';
  flipEnch.value = 'all';
  renderFlip();
  flipSavePrefs();
}
let flipItems = [];
let flipData = {};
// Pool de ítems recomendados para llenar la lista de 50 (bolsos, capas, comida,
// pociones, monturas, armas, armaduras y recursos refinados de alta rotación)
const DEFAULT_FLIPS = ["T4_BAG","T4_CAPE","T5_BAG","T5_CAPE","T6_BAG","T6_CAPE","T7_BAG","T7_CAPE","T8_BAG","T8_CAPE","T3_MEAL_SOUP","T4_MEAL_STEW","T5_MEAL_OMELETTE","T6_MEAL_SANDWICH","T8_MEAL_STEW","T7_MEAL_OMELETTE","T8_MEAL_SANDWICH","T4_POTION_HEAL","T6_POTION_HEAL","T4_POTION_ENERGY","T6_POTION_ENERGY","T3_POTION_REVIVE","T5_POTION_SLOWFIELD","T3_MOUNT_HORSE","T4_MOUNT_HORSE","T5_MOUNT_ARMORED_HORSE","T6_MOUNT_ARMORED_HORSE","T7_MOUNT_ARMORED_HORSE","T3_MOUNT_OX","T4_MOUNT_OX","T5_MOUNT_OX","T6_MOUNT_OX","T7_MOUNT_SWAMPDRAGON","T8_MOUNT_HORSE","T4_2H_BOW","T5_2H_BOW","T6_2H_BOW","T4_MAIN_SWORD","T5_MAIN_SWORD","T6_MAIN_SWORD","T4_2H_CLAYMORE","T5_2H_CLAYMORE","T4_MAIN_FIRESTAFF","T5_MAIN_FIRESTAFF","T4_MAIN_ARCANESTAFF","T4_2H_HOLYSTAFF","T5_2H_HOLYSTAFF","T4_MAIN_CURSEDSTAFF","T4_2H_HALBERD","T4_MAIN_AXE","T5_MAIN_AXE","T4_MAIN_DAGGER","T4_MAIN_MACE","T4_MAIN_HAMMER","T4_MAIN_SPEAR","T4_2H_QUARTERSTAFF","T4_MAIN_NATURESTAFF","T4_MAIN_FROSTSTAFF","T4_OFF_SHIELD","T4_OFF_TORCH","T4_OFF_BOOK","T4_ARMOR_PLATE_SET1","T4_HEAD_LEATHER_SET1","T4_SHOES_CLOTH_SET1","T4_ARMOR_LEATHER_SET1","T4_HEAD_CLOTH_SET1","T4_ARMOR_PLATE_SET2","T4_HEAD_LEATHER_SET2","T4_SHOES_CLOTH_SET2","T4_ARMOR_LEATHER_SET2","T4_HEAD_CLOTH_SET2","T4_ARMOR_PLATE_SET3","T4_HEAD_LEATHER_SET3","T4_SHOES_CLOTH_SET3","T4_ARMOR_LEATHER_SET3","T4_HEAD_CLOTH_SET3","T5_ARMOR_PLATE_SET1","T5_HEAD_LEATHER_SET1","T5_SHOES_CLOTH_SET1","T5_ARMOR_LEATHER_SET1","T5_HEAD_CLOTH_SET1","T5_ARMOR_PLATE_SET2","T5_HEAD_LEATHER_SET2","T5_SHOES_CLOTH_SET2","T5_ARMOR_LEATHER_SET2","T5_HEAD_CLOTH_SET2","T5_ARMOR_PLATE_SET3","T5_HEAD_LEATHER_SET3","T5_SHOES_CLOTH_SET3","T5_ARMOR_LEATHER_SET3","T5_HEAD_CLOTH_SET3","T6_ARMOR_PLATE_SET1","T6_HEAD_LEATHER_SET1","T6_SHOES_CLOTH_SET1","T6_ARMOR_LEATHER_SET1","T6_HEAD_CLOTH_SET1","T6_ARMOR_PLATE_SET2","T6_HEAD_LEATHER_SET2","T6_SHOES_CLOTH_SET2","T6_ARMOR_LEATHER_SET2","T6_HEAD_CLOTH_SET2","T6_ARMOR_PLATE_SET3","T6_HEAD_LEATHER_SET3","T6_SHOES_CLOTH_SET3","T6_ARMOR_LEATHER_SET3","T6_HEAD_CLOTH_SET3","T4_PLANKS","T4_METALBAR","T4_LEATHER","T4_CLOTH","T4_STONEBLOCK","T5_PLANKS","T5_METALBAR","T5_LEATHER","T5_CLOTH","T5_STONEBLOCK","T6_PLANKS","T6_METALBAR","T6_LEATHER","T6_CLOTH","T6_STONEBLOCK"];
const flipUserAdded = new Set();

function renderFlipSearch() {
  const q = flipSearch.value.trim().toLowerCase();
  if (!q || !CATALOG) { flipResults.classList.remove('open'); return; }
  const hits = [];
  for (const [id, es, en, tier, maxEnch] of CATALOG) {
    if (!(es.toLowerCase().includes(q) || en.toLowerCase().includes(q) || id.toLowerCase().includes(q))) continue;
    hits.push([id, es, en, tier, maxEnch]);
    if (hits.length >= 30) break;
  }
  // El buscador filtra solo por texto: rama y encantamiento filtran el
  // monitoreo (la tabla), no esta lista. Cada ítem ofrece todas sus
  // versiones .0–.4 según el máximo real declarado en el catálogo.
  flipResults.innerHTML = hits.map(([id, es, en, tier, maxEnch]) => {
    const enchs = [''].concat(Array.from({ length: maxEnch }, (_, i) => '@' + (i + 1)));
    return enchs.map(suf =>
      `<div class="sr-item" data-id="${id}${suf}">
        ${iconImg(id + suf, 'item-icon sm')}
        <div><div class="n">${es}${suf ? ' .' + suf.slice(1) : ''}</div><div class="m">T${tier}${suf ? '.' + suf.slice(1) : ''} · ${id}${suf}</div></div>
      </div>`).join('');
  }).join('');
  flipResults.classList.toggle('open', hits.length > 0);
}
flipSearch.addEventListener('input', renderFlipSearch);
/* rama y encantamiento filtran el monitoreo (la tabla), no el buscador */
flipBranch.addEventListener('change', () => { renderFlip(); flipSavePrefs(); });
flipEnch.addEventListener('change', () => { renderFlip(); flipSavePrefs(); });
document.getElementById('flipFilterReset')?.addEventListener('click', flipResetFilter);
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
  // Si el filtro del monitoreo oculta lo recién agregado, avisarlo: sin esto
  // parece que el clic no hizo nada. El toast limpia el filtro al tocarlo.
  if (flipFilterActive() && !flipMatchesFilter(it.dataset.id)) {
    waToast('👀 El filtro lo oculta', `«${catalogName(it.dataset.id)}» quedó en el monitoreo, pero el filtro ${flipFilterLabel()} no lo muestra en la tabla. Tocá acá para quitar el filtro.`, '', () => {
      flipResetFilter();
      gotoTab('flip');
    });
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
      branch: flipBranch.value,
      ench: flipEnch.value,
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
  // filtro del monitoreo (rama + encantamiento): se retoma entre sesiones
  if (FLIP_BRANCHES[p.branch]) flipBranch.value = p.branch;
  if (['all', '0', '1', '2', '3', '4'].includes(p.ench)) flipEnch.value = p.ench;
  for (const id of (p.user || [])) {
    if (typeof id !== 'string' || !id || id.startsWith('__')) continue;
    if (!flipItems.includes(id)) flipItems.unshift(id);
    flipUserAdded.add(id);
  }
  if (CITIES.includes(p.from)) document.getElementById('flipFrom').value = p.from;
  if (SELL_CITIES.includes(p.to) && p.to !== document.getElementById('flipFrom').value) document.getElementById('flipTo').value = p.to;
}

/* ---- ruta fija: selects de ciudad de compra y de venta ---- */
for (const selId of ['flipFrom', 'flipTo']) {
  const sel = document.getElementById(selId);
  for (const c of (selId === 'flipFrom' ? CITIES : SELL_CITIES)) {
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
    const data = await fetchPrices(ids, SELL_CITIES);
    Object.assign(flipData, data);
  } catch (err) {
    document.getElementById('flipBody').innerHTML = `<tr><td colspan="8" class="loading-cell">Error: ${err.message}. Esperá unos segundos y reintentá.</td></tr>`;
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  renderFlip();
}

// Misma comparación para Flipping y sus alertas: rutas válidas, netas de tasas.
function marketRoute(cityData, fixedFrom = '', fixedTo = '', premium = true, setup = true) {
  const buys = CITIES.filter(city => (!fixedFrom || city === fixedFrom) && city !== fixedTo)
    .map(city => ({ city, price: cityData[city]?.sell || 0, date: cityData[city]?.sellDate }))
    .filter(p => p.price > 0).sort((a, b) => a.price - b.price);
  const sells = SELL_CITIES.filter(city => (!fixedTo || city === fixedTo) && city !== fixedFrom)
    .map(city => ({ city, ...saleQuote(cityData[city], city) }))
    .filter(p => p.price > 0)
    .map(p => ({ ...p, net: p.price * (1 - saleTax(p.city, premium, setup)) }))
    .sort((a, b) => b.net - a.net);
  let bestBuy = buys[0] || null, bestSell = sells[0] || null;
  let profit = NaN;
  for (const buy of buys) for (const sell of sells) {
    if (buy.city === sell.city) continue;
    const gain = sell.net - buy.price;
    if (isNaN(profit) || gain > profit) {
      bestBuy = buy; bestSell = sell; profit = gain;
    }
  }
  let bestQuick = null;
  for (const city of SELL_CITIES) {
    if ((fixedTo && city !== fixedTo) || city === bestBuy?.city) continue;
    const p = cityData[city];
    if (p?.buy > 0 && (!bestQuick || p.buy > bestQuick.price)) {
      bestQuick = { city, price: p.buy, date: p.buyDate };
    }
  }
  const margin = !isNaN(profit) && bestBuy ? profit / bestBuy.price : NaN;
  const quick = bestBuy && bestQuick ? bestQuick.price * (1 - saleTax(BLACK_MARKET, premium, false)) - bestBuy.price : NaN;
  return { bestBuy, bestSell, bestQuick, profit, margin, quick };
}
function flipCalc(id) {
  return marketRoute(flipData[id] || {},
    document.getElementById('flipFrom').value, document.getElementById('flipTo').value,
    document.getElementById('flipPremium').checked, document.getElementById('flipSetup').checked);
}

function catalogName(fullId) {
  const base = fullId.split('@')[0];
  const suf = fullId.includes('@') ? ' .' + fullId.split('@')[1] : '';
  const row = catalogRow(base);
  return row ? row[1] + suf : fullId;
}

function renderFlip() {
  const body = document.getElementById('flipBody');
  const resetBtn = document.getElementById('flipFilterReset');
  if (resetBtn) resetBtn.disabled = !flipFilterActive();
  if (!flipItems.length) {
    body.innerHTML = '<tr><td colspan="8" class="loading-cell">Buscá un ítem arriba para agregarlo.</td></tr>';
    return;
  }
  const all = flipItems.map(id => ({ id, f: flipCalc(id) }));
  // Filtro del monitoreo (rama + encantamiento): acota la vista, no la lista.
  // Ej.: Armas + .1 deja ver solo armas con encantamiento .1.
  const filtered = flipFilterActive() ? all.filter(x => flipMatchesFilter(x.id)) : all;
  // Con precio primero: rentables de mayor a menor ganancia y, a continuación,
  // los de pérdida ordenados de menor a mayor pérdida (orden natural por profit desc)
  const priced = filtered.filter(x => !isNaN(x.f.profit)).sort((a, b) => b.f.profit - a.f.profit);
  const unpriced = filtered.filter(x => isNaN(x.f.profit));

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
  const filterOn = flipFilterActive();
  document.getElementById('flipStats').innerHTML = `
    <div class="stat"><div class="k">Ítems monitoreados</div><div class="v">${filterOn ? filtered.length : all.length}</div><div class="s">${filterOn ? 'filtro: ' + flipFilterLabel() + ' · mostrando ' + shown.length + ' de ' + all.length : 'mostrando ' + shown.length + ' · en 7 ciudades'}</div></div>
    <div class="stat"><div class="k">Flips rentables</div><div class="v ${profitable.length ? 'pos' : ''}">${profitable.length}</div><div class="s">tras impuestos</div></div>
    <div class="stat"><div class="k">Mejor flip</div><div class="v">${best ? catalogName(best.id) : '—'}</div><div class="s">${best ? '+' + fmt(best.f.profit) + ' plata/u (' + best.f.bestBuy.city + ' → ' + best.f.bestSell.city + ')' : ''}</div></div>`;

  // el filtro no coincide con ningún ítem monitoreado: explicarlo en la tabla
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8" class="loading-cell">Ningún ítem monitoreado coincide con el filtro (${flipFilterLabel()}). <button class="btn micro-btn" data-clear-filter>✕ Quitar filtro</button></td></tr>`;
    return;
  }

  const fixedFrom = document.getElementById('flipFrom').value;
  const fixedTo = document.getElementById('flipTo').value;
  body.innerHTML = shown.map(({ id, f }) => {
    const ench = id.includes('@') ? '.' + id.split('@')[1] : '.0';
    const cls = f.profit > 0 ? 'pos' : (isNaN(f.profit) ? '' : 'neg');
    const qCls = f.quick > 0 ? 'pos' : (isNaN(f.quick) ? '' : 'neg');
    // con ciudad fijada sin datos, explicar el "—" en vez de dejarlo huérfano
    const buyCell = f.bestBuy ? fmt(f.bestBuy.price) + '<span class="price-sub">' + f.bestBuy.city + '</span>'
      : (fixedFrom ? '<span class="badge warn" title="Sin precios disponibles en la ciudad elegida: actualizá o dejá «Mejor ciudad»">sin datos en ' + fixedFrom + '</span>' : '—');
    const sellCell = f.bestSell ? fmt(f.bestSell.price) + '<span class="price-sub">' + f.bestSell.city + (f.bestSell.city === BLACK_MARKET ? ' · orden de compra' : '') + '</span>'
      : (fixedTo ? '<span class="badge warn" title="Sin precios disponibles en la ciudad elegida: actualizá o dejá «Mejor ciudad»">sin datos en ' + fixedTo + '</span>' : '—');
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
  const cf = e.target.closest('[data-clear-filter]');
  if (cf) { flipResetFilter(); e.stopPropagation(); return; }
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
  const rows = SELL_CITIES.map(city => {
    const p = cityData[city];
    const sale = saleQuote(p, city);
    const isBuy = f.bestBuy?.city === city, isSell = f.bestSell?.city === city;
    return `<tr>
      <td>${city}${isBuy ? ' <span class="badge gold">comprar acá</span>' : ''}${isSell ? ' <span class="badge gold">vender acá</span>' : ''}</td>
      <td class="${isBuy ? 'best-buy' : ''}">${city === BLACK_MARKET ? 'No disponible' : p?.sell ? fmt(p.sell) : '—'}</td>
      <td class="${isSell ? 'best-sell' : ''}">${sale.price ? fmt(sale.price) : '—'}</td>
      <td>${p?.buy ? fmt(p.buy) : '—'}</td>
      <td class="muted micro">${sale.date && !sale.date.startsWith('0001') ? new Date(sale.date + 'Z').toLocaleString('es-AR') : '—'}</td>
    </tr>`;
  }).join('');
  panel.style.display = '';
  panel.innerHTML = `
    <div class="detail-head">
      ${iconImg(id, 'item-icon')}
      <div><div class="item-name">${catalogName(id)}</div><div class="item-meta">${id} · calidad Normal · 7 ciudades + Black Market</div></div>
      ${f.bestBuy ? `<button class="btn micro-btn" data-ll-id="${id}" data-ll-type="buy" data-ll-price="${f.bestBuy.price}" data-ll-city="${f.bestBuy.city}" title="Anotar la compra en el Registro de operaciones">✎ Registrar compra</button>` : ''}
      ${f.bestSell ? `<button class="btn micro-btn" data-ll-id="${id}" data-ll-type="sell" data-ll-price="${f.bestSell.price}" data-ll-city="${f.bestSell.city}" title="Anotar la venta en el Registro de operaciones">✎ Registrar venta</button>` : ''}
      <button class="btn micro-btn" data-wa-flip="${id}" title="Crear una alerta de precio para este ítem">🔔 Alerta de precio</button>
      ${favBtnHtml('flip', id, catalogName(id))}
      <button class="btn detail-close" data-close-detail="#flipDetail">Cerrar</button>
    </div>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>Ciudad</th><th>Venta acá — para comprar</th><th>Precio para vender</th><th>Mejor orden de compra</th><th>Actualizado</th></tr></thead>
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

// Black Market: orden de compra de calidad Normal, igual que materiales y equipo.
async function fetchBM(ids) {
  const out = {};
  const chunks = []; let cur = [];
  for (const id of ids) { cur.push(id); if (cur.join(',').length > 3500) { chunks.push(cur); cur = []; } }
  if (cur.length) chunks.push(cur);
  for (const chunk of chunks) {
    const data = await fetchJSON(`${API}/prices/${chunk.join(',')}.json?locations=Black%20Market&qualities=1`);
    for (const row of data) {
      const o = out[row.item_id] = out[row.item_id] || { buy: 0, date: null };
      if (row.buy_price_max > o.buy) { o.buy = row.buy_price_max; o.date = row.buy_price_max_date; }
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

// rama → ciudad que la bonifica (derivado de cityBonuses)
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
    else { const b = GEAR.bm[r.id]; sellPrice = b?.buy || 0; sellDate = b?.date; }
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
      <span class="rrr-part"><span class="rrr-num">${pct(o.rrrHi)}</span><span class="rrr-cap">ramas con bono en ${o.craftCity}</span></span>
      <span class="rrr-part"><span class="rrr-num dim">${pct(o.rrrLo)}</span><span class="rrr-cap">resto de las ramas</span></span>`;
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
  const famName = GEAR.family ? (GEAR.DATA.families.find(f => f[0] === GEAR.family) || [])[1] : 'todas las ramas';
  G('Stats').innerHTML = `
    <div class="stat"><div class="k">Líneas rentables</div><div class="v ${profitable.length ? 'pos' : ''}">${profitable.length}</div><div class="s">de ${priced.length} con precio · ${famName}</div></div>
    <div class="stat"><div class="k">Mejor crafteo</div><div class="v">${best ? best.name : '—'}</div><div class="s">${best ? '+' + fmt(best.c.profit) + ' plata/u' + (best.r.ench ? ' (.' + best.r.ench + ')' : '') : 'sin datos aún'}</div></div>
    <div class="stat"><div class="k">Venta en</div><div class="v">${o.sellBM ? 'Black Market' : o.sellCity}</div><div class="s">${o.sellBM ? 'mejor orden de compra, sin tasa de publicación' : 'orden de venta'}</div></div>
    <div class="stat"><div class="k">Tasa de retorno</div><div class="v">${o.craftCity ? pct(o.rrrHi) + ' / ' + pct(o.rrrLo) : pct(o.rrr)}</div><div class="s">${o.craftCity ? 'bonificado / resto en ' + o.craftCity : 'solo materiales refinados'}${o.useJournals ? ' · diarios ON' : ''}</div></div>`;

  const total = rows.length;
  const shown = rows.slice(0, 50);
  const body = G('Body');
  if (!shown.length) {
    body.innerHTML = `<tr><td colspan="7" class="loading-cell">${GEAR.family ? 'Sin resultados. Tocá «↻ Actualizar precios» para cargar esta rama.' : 'Elegí una rama arriba (o usá «Escanear rentables») para empezar.'}</td></tr>`;
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
  const sellApi = o.sellBM ? (GEAR.bm[r.id]?.buy || 0) : (GEAR.prices[r.id]?.[o.sellCity]?.sell || 0);
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
          <button class="btn micro-btn" data-ll-id="${r.id}" data-ll-type="craft" data-ll-price="${(c.matCost || 0) + (c.stationFee || 0)}" data-ll-city=""" title="Anotar el crafteo (costo de materiales + estación) en el Registro">✎ Registrar crafteo</button>
          ${c.sellPrice ? `<button class="btn micro-btn" data-ll-id="${r.id}" data-ll-type="sell" data-ll-price="${c.sellPrice}" data-ll-city="${o.sellBM ? 'Black Market' : sellKey[1]}" title="Anotar la venta en el Registro">✎ Registrar venta</button>` : ''}
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
        <div class="micro muted">Solo las ramas bonificadas en esa ciudad reciben +33%; el resto, ciudad real (+18%)</div></div>
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
      <div class="control"><button class="btn shimmer" id="gearScan"><svg class="btn-ico"><use href="#i-bolt"/></svg> Escanear rentables (todas las ramas)</button></div>
    </div>
  </div>

  <div class="panel filters">
    <input type="search" id="gearFamSearch" placeholder="Buscar rama… (ej: espadas, arcos, capuchas)" class="search">
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
      <tbody id="gearBody"><tr><td colspan="7" class="loading-cell">Elegí una rama arriba (o usá «Escanear rentables») para empezar.</td></tr></tbody>
    </table>
  </div>

  <div class="panel" id="gearPlannerPanel"></div>`;

  const buySel = G('BuyCity'), sellSel = G('SellCity');
  for (const c of CITIES) buySel.add(new Option(c, c));
  for (const c of SELL_CITIES) sellSel.add(new Option(c, c));
  buySel.value = 'Caerleon'; sellSel.value = 'Black Market';

  // chips de ramas
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

  // guía de ciudades: clic en rama
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
    planner: true,
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
  // cargan precios la primera vez que se abre cada pestaña.
  // El escaneo de flipping debe cubrir tanto el ítem plano (.0) como sus
  // versiones encantadas. Los IDs de mercado usan @1..@4, según maxEnch.
  flipItems = DEFAULT_FLIPS.flatMap(id => {
    const row = CATALOG.find(r => r[0] === id);
    const max = row ? +row[4] || 0 : 0;
    return [id].concat(Array.from({ length: max }, (_, i) => id + '@' + (i + 1)));
  });
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
    gi.innerHTML = '';
  }

  // Stats
  const withProfit = rows.filter(x => x.profit != null);
  const winners = withProfit.filter(x => x.profit > 0);
  const best = withProfit.length ? withProfit.reduce((a, b) => (b.profit > a.profit ? b : a)) : null;
  document.getElementById('transStats').innerHTML = `
    <div class="stat"><div class="k">Rentables</div><div class="v ${winners.length ? 'pos' : ''}">${winners.length} / ${withProfit.length}</div><div class="s"></div></div>
    <div class="stat"><div class="k">Mejor transmutación</div><div class="v ${best && best.profit > 0 ? 'pos' : 'neg'}">${best ? fmt(best.profit) : '—'}</div><div class="s">${best ? transName(best.r.type, best.r.ft, best.r.fe) + ' → ' + transName(best.r.type, best.r.tt, best.r.te) : 'sin datos'}</div></div>
    <div class="stat"><div class="k">Descuento global</div><div class="v">${(disc * 100).toFixed(1).replace('.', ',')}%</div><div class="s"></div></div>`;

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
          ${x.buy.value ? `<button class="btn micro-btn" data-ll-id="${r.in}" data-ll-type="buy" data-ll-price="${x.buy.value}" data-ll-city="${buyCity}" title="Anotar la compra del recurso de origen en el Registro">✎ Registrar compra</button>` : ''}
          ${x.sell.value ? `<button class="btn micro-btn" data-ll-id="${r.out}" data-ll-type="sell" data-ll-price="${x.sell.value}" data-ll-city="${sellCity}" title="Anotar la venta del recurso transmutado en el Registro">✎ Registrar venta</button>` : ''}
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
   («.top-action» sin data-tab, como ⚡ Anti-pausa, no navegan)
   ==================================================================== */
document.querySelectorAll('.top-action[data-tab]').forEach(btn =>
  btn.addEventListener('click', () => gotoTab(btn.dataset.tab)));

/* ====================================================================
   BUSCADOR GLOBAL DE PRECIOS
   Venta más barata y mejor orden de compra por ciudad × calidad.
   ==================================================================== */
const PS = { item: null, ench: 0, data: null, history: [] };
try { PS.history = JSON.parse(localStorage.getItem('psHistory') || '[]'); } catch (e) {}

const QUALITY_ES = { 1: 'Normal', 2: 'Buena', 3: 'Notable', 4: 'Excelente', 5: 'Obra maestra' };
const PS_CITIES = SELL_CITIES;

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
      sell: r.city === BLACK_MARKET ? 0 : r.sell_price_min, sellD: r.sell_price_min_date,
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
        const quals = Object.keys(grid[c]).map(Number).filter(q => grid[c][q].sell || grid[c][q].buy).sort();
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
  llUpdateCities();
  document.getElementById('llQty').value = 1;
  document.getElementById('llPrice').value = price && isFinite(price) ? Math.round(price) : '';
  const sel = document.getElementById('llCity');
  sel.value = city && [...sel.options].some(o => o.value === city) ? city : '—';
  gotoTab('ledgerlog');
  document.getElementById('llQty').focus();
}
const LL_TYPE_ES = { buy: 'Compra', sell: 'Venta', craft: 'Crafteo' };
/* Celda CSV segura: comillas dobladas y, si el texto empieza como fórmula
   (= + - @ o tab/CR), se antepone un apóstrofo para que Excel/Sheets no la ejecuten. */
function csvCell(v) {
  let t = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g, '""') + '"';
}

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
function llUpdateCities() {
  const sel = document.getElementById('llCity'), previous = sel.value;
  const cities = document.getElementById('llType').value === 'sell' ? SELL_CITIES : CITIES;
  sel.replaceChildren(...['—', ...cities].map(c => new Option(c, c)));
  sel.value = ['—', ...cities].includes(previous) ? previous : '—';
}
(function initLL() {
  llUpdateCities();
  document.getElementById('llType').addEventListener('change', llUpdateCities);
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
    llUpdateCities();
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
      [new Date(r.ts).toISOString(), csvCell(r.name || r.id), csvCell(r.id), LL_TYPE_ES[r.type], r.qty, r.price, r.qty * r.price, csvCell(r.city), csvCell(r.note || '')].join(',')
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
      if (bkKeyOk(k)) data[k] = localStorage.getItem(k);
    }
    const payload = { app: 'AyudanteAlbion', version: 1, exported: new Date().toISOString(), data };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = `ayudante-albion-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });
  /* claves que viajan en el respaldo: datos del usuario, nunca la sesión de
     Discord (se obtiene ingresando) ni la URL del proxy (config de desarrollo) */
  const BK_KEYS = ['alertSettings', 'farmPrefs', 'favorites', 'flipPrefs', 'gearPlan', 'kaOn', 'manualPrices',
    'pfPlayer', 'pfSpecs', 'priceAlerts', 'psHistory', 'tradeLog', 'aaSGChar', 'aaSGGuild'];
  const BK_MAX_BYTES = 5 * 1024 * 1024;
  const bkKeyOk = k => typeof k === 'string' && (BK_KEYS.includes(k) || /^dailyBonus_[A-Za-z_]{1,40}$/.test(k));
  document.getElementById('bkImport').addEventListener('click', () => document.getElementById('bkFile').click());
  document.getElementById('bkFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (String(reader.result).length > BK_MAX_BYTES) throw new Error('tamaño');
        const payload = JSON.parse(reader.result);
        if (!payload || payload.app !== 'AyudanteAlbion' || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw new Error('formato');
        /* solo claves de datos de la app, con valores de texto: un respaldo
           ajeno no puede plantar sesiones, redirigir el proxy ni pisar otras claves */
        const entries = Object.entries(payload.data).filter(([k, v]) => bkKeyOk(k) && typeof v === 'string');
        for (const [k, v] of entries) JSON.parse(v); // cada valor debe ser JSON válido
        const n = entries.length;
        if (!n) throw new Error('vacío');
        if (!confirm(`Respaldo del ${String(payload.exported || '').slice(0, 10)} con ${n} claves.\n¿Restaurar? Se sobreescribirán los datos actuales de la app.`)) return;
        for (const [k, v] of entries) localStorage.setItem(k, v);
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
    const ids = [EN.item, ...[1, 2, 3].map(l => EN.item + '@' + l), ...new Set(rec.u.map(u => u[1]))];
    EN.prices = await fetchPrices(ids, SELL_CITIES);
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
  const sellCity = document.getElementById('enSellCity').value || city;
  const sellKind = sellCity === city ? 'buy' : sellCity === BLACK_MARKET ? 'bm' : 'sell';
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
  const priceInput = (id, p, priceCity = city, kind = 'buy') => `
    <span class="price-edit-wrap">
      <input type="number" class="price-edit ${p.manual ? 'manual' : ''}" min="0" step="1"
        value="${p.value || ''}" placeholder="sin precio"
        data-pid="${id}" data-city="${priceCity}" data-kind="${kind}">
      ${p.manual ? `<button class="reset-price" data-pid="${id}" data-city="${priceCity}" data-kind="${kind}" title="Volver al precio de la API">↺</button>` : ''}
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
  const sellId = to === 0 ? EN.item : EN.item + '@' + to;
  const sellKey = mpKey(sellId, sellCity, sellKind);
  const sale = saleQuote(EN.prices[sellId]?.[sellCity], sellCity);
  const sellP = sellCity === city ? toP : { value: sellKey in manualPrices ? manualPrices[sellKey] : sale.price, manual: sellKey in manualPrices };
  const tax = document.getElementById('enPremium').checked ? 0.04 : 0.08;
  // Solo se paga publicación al vender mediante orden de venta. La venta
  // directa a la mejor orden de compra (incluido Black Market) no la paga.
  const setup = document.getElementById('enSetup').checked && sellKind === 'sell' ? 0.025 : 0;
  const sellNet = sellP.value ? sellP.value * (1 - tax - setup) : null; // impuesto + tasa de publicación
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
        <div class="cd-line"><span>Precio de venta (${sellCity}${sellCity === BLACK_MARKET ? ' · orden de compra' : ''})</span>
          ${priceInput(sellId, sellP, sellCity, sellKind)}</div>
        <div class="cd-line muted"><span>Venta ${lvlName(to)} neta (impuesto ${(tax * 100).toFixed(0)}%${sellCity === BLACK_MARKET ? ', sin publicación' : ' + publicación 2,5%'})</span>
          <span>${sellNet != null ? fmt(sellNet) : '—'}</span></div>
        <div class="cd-line total ${planProfit == null ? '' : planProfit > 0 ? 'pos' : 'neg'}"><span>Ganancia si lo vendés</span>
          <span>${planProfit == null ? '—' : (planProfit > 0 ? '+' : '') + fmt(planProfit)}</span></div>
        <div class="cd-actions">
          ${fromP.value ? `<button class="btn micro-btn" data-ll-id="${from === 0 ? EN.item : EN.item + '@' + from}" data-ll-type="buy" data-ll-price="${fromP.value}" data-ll-city="${city}" title="Anotar la compra del ítem ${lvlName(from)} en el Registro">✎ Registrar compra ${lvlName(from)}</button>` : ''}
          ${sellP.value ? `<button class="btn micro-btn" data-ll-id="${sellId}" data-ll-type="sell" data-ll-price="${sellP.value}" data-ll-city="${sellCity}" title="Anotar la venta del ítem ${lvlName(to)} en el Registro">✎ Registrar venta ${lvlName(to)}</button>` : ''}
          ${favBtnHtml('enchant', EN.item, name)}
        </div>
      </div>
    </div>`}
    <div class="micro muted pad">El plan compra el ítem en ${lvlName(from)} y aplica todos los pasos de fragmentos hasta ${lvlName(to)}. La ganancia usa el precio de venta en ${sellCity}; las compras del ítem y fragmentos se calculan en ${city}.</div>
  </div>`;

  document.getElementById('enFrom').addEventListener('change', e => { EN.from = +e.target.value; enRender(); });
  document.getElementById('enTo').addEventListener('change', e => { EN.to = +e.target.value; enRender(); });
}
(function initEN() {
  document.getElementById('enSellCity').replaceChildren(new Option('Misma ciudad de compra', ''),
    ...SELL_CITIES.map(c => new Option(c, c)));
  document.getElementById('enSellCity').addEventListener('change', () => { if (EN.item && !EN.loading) enRender(); });
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
  document.getElementById('enSetup').addEventListener('change', () => { if (EN.item) enRender(); });
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
   Margen/día normalizado por ciclo. Premium duplica cosechas/productos.
   Bonos locales: +10% nominal, solo cultivos, hierbas, huevos y leche.
   Datos y alcance del modelo: docs/farming.md.
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
      ids.add(f.id); // semillas, crías y productores se comercian
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
// La ciudad de la isla es independiente de la ciudad usada para cotizar.
function fmIslandCity() { return document.getElementById('fmIslandCity').value; }
function fmLocalBonus(f, city) {
  const produces = f.kind === 'plant' || (!f.grown && f.product && f.prodTime);
  return produces && CITIES.includes(city) && f.bonusCities?.includes(city) ? 0.10 : 0;
}
function fmSavePrefs() {
  try {
    localStorage.setItem('farmPrefs', JSON.stringify({ island: fmIslandCity(), market: document.getElementById('fmCity').value }));
  } catch (e) {}
}
function fmRestorePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('farmPrefs') || 'null');
    if (CITIES.includes(p?.island)) document.getElementById('fmIslandCity').value = p.island;
    if (CITIES.includes(p?.market)) document.getElementById('fmCity').value = p.market;
  } catch (e) {}
}
function fmRenderBonus() {
  const city = fmIslandCity();
  const products = FM.data.filter(f => f.kind === FM.kind && fmLocalBonus(f, city)).map(f => FM_NAME(f.product));
  document.getElementById('fmBonusInfo').textContent = products.length
    ? `Isla en ${city}: +10% de producción en ${products.join(', ')}.`
    : `Isla en ${city}: sin bono de ${FM.kind === 'plant' ? 'cultivos o hierbas' : 'huevos o leche'}.`;
}
// Modelo de rendimientos medios; el juego entrega cantidades enteras aleatorias.
// Ni el bono local ni Premium multiplican las semillas devueltas o las crías.
function fmCalc(f, { premium, focus, islandCity }, cost, prod) {
  const tax = premium ? 0.04 : 0.08;
  const cityBonus = fmLocalBonus(f, islandCity);
  let cropPer, seedBack, offspring, cycleDays, keeper = false, unit;
  if (f.kind === 'plant') {
    cropPer = (f.yieldBase ?? 4.5) * (premium ? 2 : 1) * (1 + cityBonus);
    seedBack = (f.seedBack || 0) + (focus ? f.focusBonus || 0 : 0);
    unit = prod * cropPer * (1 - tax) - cost * (1 - seedBack);
    cycleDays = f.grow / 86400;
  } else if (f.grown) {
    cropPer = 1;
    offspring = (f.offspring || 0) + (focus ? (f.focusBonus || 0) * (f.focusCycles || 0) : 0);
    unit = prod * (1 - tax) + cost * offspring - cost;
    cycleDays = f.grow / (premium ? 2 : 1) / 86400;
  } else {
    keeper = true;
    cropPer = (f.yieldBase ?? 9) * (premium ? 2 : 1) * (1 + cityBonus);
    unit = prod * cropPer * (1 - tax); // productor reutilizable; alimento no incluido
    cycleDays = f.prodTime / 86400;
  }
  return { cropPer, seedBack, offspring, cycleDays, keeper, cityBonus, unit, daily: unit * 9 / cycleDays };
}
function fmRows() {
  const opts = {
    premium: document.getElementById('fmPremium').checked,
    focus: document.getElementById('fmFocus').checked,
    islandCity: fmIslandCity(),
  };
  const out = [];
  for (const f of FM.data) {
    if (f.kind !== FM.kind) continue;
    const outId = f.grown || f.product;
    if (!outId || (f.kind === 'animal' && !f.grown && !f.prodTime)) continue;
    const buy = fmPrice(f.id, 'buy'), sell = fmPrice(outId, 'sell');
    const cost = buy.value || f.vendor || 0;
    // Un precio desconocido no es una venta a cero ni una cría gratuita.
    if (!cost || !sell.value) continue;
    const c = fmCalc(f, opts, cost, sell.value);
    out.push({ f, name: FM_NAME(outId) + (c.keeper ? ' (' + FM_NAME(f.id) + ')' : ''),
      inId: f.id, outId, cost, prod: sell.value, ...c });
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
  fmRenderBonus();
  const plots = Math.max(1, Math.min(45, parseInt(document.getElementById('fmPlots').value) || 9));
  const rows = fmRows();
  const winners = rows.filter(r => r.daily > 0);
  const best = rows.length ? rows.reduce((a, b) => (b.daily > a.daily ? b : a)) : null;
  document.getElementById('fmStats').innerHTML = `
    <div class="stat"><div class="k">Margen positivo</div><div class="v ${winners.length ? 'pos' : ''}">${winners.length} / ${rows.length}</div><div class="s">${FM.kind === 'animal' ? 'antes de alimento' : 'con precios actuales'}</div></div>
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
        <div><div class="item-name">${r.name}</div><div class="item-meta">T${r.f.tier}${r.keeper ? ' · productor (no se consume)' : ''}${r.cityBonus ? ` · <span class="badge gold">+10% isla</span>` : ''}</div></div>
      </div></td>
      <td class="num">${fmt(r.cost || null)}</td>
      <td class="num">${fmt(r.prod || null)}${r.cropPer !== 1 ? ` <span class="price-sub">×${r.cropPer.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>` : ''}</td>
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
        <div class="cd-line"><span>Bono local de isla (${fmIslandCity()})</span><span>${pct(r.cityBonus)}${r.f.grown ? ' · no aplica a la cría' : ''}</span></div>
        <div class="cd-line"><span>Producción media por ${r.f.kind === 'plant' ? 'semilla' : 'animal'} y ciclo</span><span>${r.cropPer.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span></div>
        ${r.seedBack != null ? `<div class="cd-line"><span>Semillas devueltas (incluye riego)</span><span>${pct(r.seedBack)}</span></div>` : ''}
        ${r.offspring ? `<div class="cd-line"><span>Crías extra por ciclo</span><span>${r.offspring.toFixed(2)}</span></div>` : ''}
        <div class="cd-line"><span>Ciclo</span><span>${r.cycleDays < 1.05 ? Math.round(r.cycleDays * 24) + ' h' : r.cycleDays.toFixed(1) + ' días'}</span></div>
        <div class="cd-line total"><span>${r.f.kind === 'animal' ? 'Margen antes de alimento' : 'Ganancia por unidad'}</span><span class="${r.unit > 0 ? 'pos' : 'neg'}">${fmt(r.unit)}</span></div>
        <div class="cd-actions">
          ${bp.value ? `<button class="btn micro-btn" data-ll-id="${r.inId}" data-ll-type="buy" data-ll-price="${bp.value}" data-ll-city="${city}" title="Anotar la compra de ${r.keeper ? 'animales' : (r.f.kind === 'plant' ? 'semillas' : 'crías')} en el Registro">✎ Registrar compra</button>` : ''}
          ${sp.value ? `<button class="btn micro-btn" data-ll-id="${r.outId}" data-ll-type="sell" data-ll-price="${sp.value}" data-ll-city="${city}" title="Anotar la venta del producto en el Registro">✎ Registrar venta</button>` : ''}
          ${favBtnHtml('farm', r.outId, FM_NAME(r.outId))}
        </div>
      </div>
    </div></td></tr>`;
  }).join('');
}
(function initFM() {
  for (const id of ['fmCity', 'fmIslandCity'])
    document.getElementById(id).innerHTML = CITIES.map(c => `<option${c === 'Caerleon' ? ' selected' : ''}>${c}</option>`).join('');
  fmRestorePrefs();
  document.getElementById('fmRefresh').addEventListener('click', fmLoad);
  for (const id of ['fmIslandCity', 'fmCity', 'fmPremium', 'fmFocus', 'fmPlots'])
    document.getElementById(id).addEventListener('change', () => { fmSavePrefs(); fmRender(); });
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
  const local = await fetch('/gameinfo' + path).catch(() => null);
  if (local && local.ok) return local.json();
  if (WORKER_URL) {
    const w = await fetch(WORKER_URL + '/gameinfo' + path).catch(() => null);
    if (w && w.ok) return w.json();
  }
  throw new Error('gameinfo ' + (local ? 'HTTP ' + local.status : 'sin conexión'));
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
  if (!d || typeof d !== 'object') return [];
  if (Array.isArray(d.kills)) return d.kills;
  if (Array.isArray(d.members)) return d.members;
  if (Array.isArray(d.events)) return d.events;
  if (Array.isArray(d.matches)) return d.matches;
  if (Array.isArray(d.guildmatches)) return d.guildmatches;
  if (Array.isArray(d.battles)) return d.battles;
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
      <div class="item-name">${sgEsc(other.Name)}</div>
      <div class="item-meta">${sgEsc(other.GuildName || 'sin gremio')}${other.AllianceName ? ' · ' + sgEsc(other.AllianceName) : ''}</div>
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
        <div class="cd-title"><svg class="title-ico"><use href="#i-sword"/></svg> ${sgEsc(ev.Killer.Name)} (asesino) · IP ${fmt(ev.Killer.AverageItemPower) || '—'}</div>
        ${gearCol(ev.Killer)}
      </div>
      <div class="cd-section">
        <div class="cd-title"><svg class="title-ico"><use href="#i-skull"/></svg> ${sgEsc(ev.Victim.Name)} (víctima) · IP ${fmt(ev.Victim.AverageItemPower) || '—'}</div>
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
          <div class="item-name" style="font-size:1.2rem">${sgEsc(d.Name)}</div>
          <div class="item-meta">${d.GuildName ? `Gremio: <b>${sgEsc(d.GuildName)}</b>` : 'Sin gremio'}${d.AllianceName ? ` · Alianza: ${sgEsc(d.AllianceName)}${d.AllianceTag ? ' [' + sgEsc(d.AllianceTag) + ']' : ''}` : ''}</div>
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
    <div class="cd-title" style="padding:14px 14px 4px">Gremio: ${sgEsc(guild.Name)}</div>
    <div class="stats" style="padding:0 14px 14px">
      <div class="stat"><div class="k">Miembros</div><div class="v">${fmt(guild.MemberCount)}</div><div class="s">${guild.AllianceName ? 'alianza ' + sgEsc(guild.AllianceName) : 'sin alianza'}</div></div>
      <div class="stat"><div class="k">Fama de asesinatos</div><div class="v">${fmt(guild.killFame)}</div><div class="s">todo el gremio</div></div>
      <div class="stat"><div class="k">Fama de muertes</div><div class="v">${fmt(guild.DeathFame)}</div><div class="s">todo el gremio</div></div>
      <div class="stat"><div class="k">Fundado</div><div class="v" style="font-size:1rem">${guild.Founded ? new Date(guild.Founded).toLocaleDateString('es-AR') : '—'}</div><div class="s">por ${sgEsc(guild.FounderName || '—')}</div></div>
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
    <div class="cd-title" style="padding:14px 14px 4px"><svg class="title-ico"><use href="#i-bolt"/></svg> Asesinatos</div>
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
    <div class="cd-title" style="padding:14px 14px 4px"><svg class="title-ico"><use href="#i-skull"/></svg> Últimas muertes ${deaths ? `(${deaths.length})` : ''}</div>
    ${deaths && deaths.length ? `<table class="ledger">
      <thead><tr><th>Fecha</th><th>Asesino</th><th class="num">IP asesino</th><th class="num">IP tuya</th><th class="num">Fama perdida</th><th class="num">Participantes</th></tr></thead>
      <tbody>${deaths.map(ev => pfKillRow(ev, 'death')).join('')}</tbody>
    </table>` : `<div class="loading-cell">${deaths ? 'Sin muertes recientes.' : 'El killboard no respondió — probá «Actualizar».'}</div>`}
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
        // /search es tan caprichoso como el resto del killboard (404/502
        // intermitentes): va por pfFetchRetry en vez de un intento único.
        const data = await pfFetchRetry('/search?q=' + encodeURIComponent(q));
        const players = (data.players || []).slice(0, 12);
        res.innerHTML = players.length
          ? players.map(p => `<div class="sr-item" data-id="${sgEsc(p.Id)}" data-name="${sgEsc(p.Name)}">
              <span class="chip-ico" style="flex:none"><svg><use href="#i-user"/></svg></span>
              <div><div class="n">${sgEsc(p.Name)}</div><div class="m">${sgEsc(p.GuildName || 'sin gremio')}${p.AllianceName ? ' · ' + sgEsc(p.AllianceName) : ''}</div></div>
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
              <td><b>${sgEsc(ev.Killer.Name)}</b></td>
              <td><div class="item-cell">${ev.Victim.Equipment?.MainHand ? iconImg(ev.Victim.Equipment.MainHand.Type, 'item-icon sm') : ''}<div>
                <div class="item-name">${sgEsc(ev.Victim.Name)}</div>
                <div class="item-meta">${sgEsc(ev.Victim.GuildName || 'sin gremio')}</div></div></div></td>
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
      /* ranking de miembros: exclusivo para miembros SG verificados */
      if (!sgIsMember()) {
        document.getElementById('pfMembersBox').innerHTML = sgLockNote('El ranking completo de miembros del gremio es exclusivo de los miembros verificados de SG.');
        return;
      }
      mbtn.textContent = 'Cargando miembros…'; mbtn.disabled = true;
      try {
        const members = pfAsArray(await pfFetchRetry(`/guilds/${PF.guildId}/members`));
        const sorted = [...members].sort((a, b) => (b.KillFame || 0) - (a.KillFame || 0));
        document.getElementById('pfMembersBox').innerHTML = `
          <div class="table-wrap"><table class="ledger">
            <thead><tr><th>#</th><th>Jugador</th><th class="num">Fama de asesinatos</th><th class="num">Fama de muertes</th><th class="num">Ratio</th></tr></thead>
            <tbody>${sorted.map((m, i) => `
              <tr class="clickable" data-member-id="${sgEsc(m.Id)}" data-member-name="${sgEsc(m.Name)}" title="Ver el perfil de ${sgEsc(m.Name)}">
                <td class="muted">${i + 1}</td>
                <td><b>${sgEsc(m.Name)}</b></td>
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
   dispara con toast + aviso sonoro suave + notificación del navegador (opcional) y
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
    const f = marketRoute(d, '', '', document.getElementById('flipPremium').checked,
      document.getElementById('flipSetup').checked);
    return isNaN(f.margin) ? { value: null }
      : { value: f.margin * 100, from: f.bestBuy.city, to: f.bestSell.city };
  }
  if (a.city === BLACK_MARKET && a.metric !== 'buy') return { value: null };
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
    WA.prices = await fetchPrices(ids, SELL_CITIES);
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
function waToast(title, msg, cls, onOpen) {
  let stack = document.getElementById('waToasts');
  if (!stack) { stack = document.createElement('div'); stack.id = 'waToasts'; stack.className = 'wa-toasts'; document.body.appendChild(stack); }
  const d = document.createElement('div');
  d.className = 'wa-toast' + (cls ? ' ' + cls : '');
  /* título y mensaje como texto plano: acá pueden llegar datos que no
     controlamos (nombre de Discord, nombre de personaje), nunca HTML */
  const wrap = document.createElement('div');
  wrap.style.minWidth = '0';
  const tn = document.createElement('div'); tn.className = 't-n'; tn.textContent = String(title == null ? '' : title);
  const tm = document.createElement('div'); tm.className = 't-m'; tm.textContent = String(msg == null ? '' : msg);
  wrap.append(tn, tm);
  d.appendChild(wrap);
  d.addEventListener('click', () => {
    if (typeof onOpen === 'function') onOpen();
    else gotoTab('alerts');
    d.remove();
  });
  stack.appendChild(d);
  while (stack.children.length > 4) stack.firstChild.remove();
  setTimeout(() => d.remove(), 15000);
}
/* único sonido de toda la app: un aviso breve y suave (dos senoidales
   lejanas, volumen bajo, ataque y caída lentos) cuando una alerta de
   precio que el usuario creó pasa a cumplirse. Nada más reproduce audio. */
function waBeep() {
  if (!WA.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    WA.ac = WA.ac || new Ctx();
    if (WA.ac.state === 'suspended') WA.ac.resume().catch(() => {});
    const t = WA.ac.currentTime;
    [[659.25, 0], [880, 0.18]].forEach(([f, dt]) => {
      const o = WA.ac.createOscillator();
      const g = WA.ac.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.045, t + dt + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.55);
      o.connect(g);
      g.connect(WA.ac.destination);
      o.start(t + dt);
      o.stop(t + dt + 0.6);
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
  const city = document.getElementById('waCity');
  const previous = city.value;
  city.replaceChildren(...(m === 'buy' ? SELL_CITIES : CITIES).map(c => new Option(c, c)));
  city.value = [...city.options].some(o => o.value === previous) ? previous : 'Caerleon';
  document.getElementById('waCityWrap').style.display = m === 'flip' ? 'none' : '';
  document.getElementById('waThLabel').textContent = m === 'flip' ? 'Ganancia mínima (%)' : 'Precio (plata)';
  document.getElementById('waThreshold').placeholder = m === 'flip' ? 'ej: 15' : 'ej: 1500';
}
function waAddAlert() {
  if (!WA.formItem) { alert('Elegí un ítem del buscador primero.'); return; }
  const metric = document.getElementById('waMetric').value;
  waUpdateForm();
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
  if (WORKER_URL) {
    try {
      const r = await fetch(WORKER_URL + '/twitch/uptime/' + chan, { cache: 'no-store' });
      if (r.ok) return await r.text();
    } catch (e) {}
  }
  return null;
}
async function twCheckAll() {
  if (TW.checking || !TW.chs.length) return;
  TW.checking = true;
  TW.lastAt = Date.now();
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

/* ====================================================================
   ⚡ ANTI-PAUSA (keep-alive) — con la pestaña abierta, la app no se
   congela. NO reproduce ningún sonido (política de la app: silencio, con
   la única excepción del aviso suave de las alertas de precio). Cubre:
   1) Tab freezing / discard (ahorro de memoria) → una Web Lock abierta
      excluye a la página del congelamiento en Chromium/Edge.
   2) Suspensión del equipo → Wake Lock de pantalla mientras la pestaña
      está visible; el navegador lo suelta al ocultarla y se re-pide solos.
   Lo que NO se combate es el throttling de timers en segundo plano: con
   la pestaña de fondo un ciclo de verificación puede demorar hasta 1 min
   más. kaRunDue() lo amortigua: todo lo vencido corre en cuanto la
   pestaña vuelve a estar visible o enfocada. Con el .exe el latido
   /alive sigue saliendo (1/min bajo throttle) y la gracia de 15 min lo
   banca sin problema.
   ==================================================================== */
const KA = { on: true, lockCtl: null, lockHeld: false, wake: null };
try { KA.on = localStorage.getItem('kaOn') !== '0'; } catch (e) {}

function kaPaint() {
  const b = document.getElementById('kaBtn');
  if (!b) return;
  b.classList.toggle('ka-on', KA.on);
  b.setAttribute('aria-pressed', String(KA.on));
  b.title = KA.on
    ? '⚡ Anti-pausa ACTIVO: la pestaña no se congela en segundo plano (sin sonido). Clic para apagar.'
    : '⚡ Anti-pausa apagado: el navegador puede limitar la app con la pestaña de fondo. Clic para activar.';
}
function kaLock() {
  if (!navigator.locks || !navigator.locks.request || KA.lockHeld || KA.lockCtl) return;
  try {
    KA.lockCtl = new AbortController();
    navigator.locks.request('albion-app-keep-alive', { signal: KA.lockCtl.signal }, () => {
      KA.lockHeld = true;
      return new Promise(() => {}); // nunca se libera: mientras vive la página, vive el lock
    }).catch(() => { KA.lockHeld = false; KA.lockCtl = null; });
  } catch (e) {}
}
function kaLockStop() { try { if (KA.lockCtl) KA.lockCtl.abort(); } catch (e) {} KA.lockHeld = false; KA.lockCtl = null; }
function kaWake() {
  if (!('wakeLock' in navigator) || !KA.on || document.hidden || KA.wake) return;
  navigator.wakeLock.request('screen').then(w => {
    KA.wake = w;
    // Chrome lo suelta solo al ocultar la pestaña: se vuelve a pedir al volver
    w.addEventListener('release', () => {
      KA.wake = null;
      if (KA.on && !document.hidden) setTimeout(kaWake, 1200);
    });
  }).catch(() => {});
}
function kaWakeStop() { try { if (KA.wake) KA.wake.release(); } catch (e) {} KA.wake = null; }

/* atrasos vencidos → ejecutar ya, no esperar el próximo ciclo */
function kaRunDue() {
  if (document.hidden) return;
  try {
    if (typeof WA !== 'undefined' && !WA.running && WA.list.some(a => a.on)
        && (!WA.nextAt || Date.now() > WA.nextAt + 2e4)) {
      clearTimeout(WA.timer);
      waTick();
    }
    const sg = document.getElementById('tab-sg');
    if (typeof TW !== 'undefined' && TW.chs.length && sg && sg.classList.contains('active')
        && Date.now() - (TW.lastAt || 0) > 75e3) twCheckAll();
  } catch (e) {}
}
function kaStart() {
  kaPaint();
  if (!KA.on) return;
  kaLock();
  kaWake();
}
function kaStop() { kaLockStop(); kaWakeStop(); }

document.getElementById('kaBtn').addEventListener('click', () => {
  KA.on = !KA.on;
  try { localStorage.setItem('kaOn', KA.on ? '1' : '0'); } catch (e) {}
  if (KA.on) kaStart(); else kaStop();
  kaPaint();
  waToast('⚡ Anti-pausa', KA.on
    ? 'Activado: la app no se congela con la pestaña de fondo. Todo en silencio.'
    : 'Apagado: el navegador puede frenar alertas y precios en segundo plano; al volver se recupera lo vencido.');
});
document.addEventListener('visibilitychange', () => {
  if (KA.on && !document.hidden) kaWake();
  kaRunDue();
});
window.addEventListener('focus', kaRunDue);
document.addEventListener('resume', kaRunDue); // Page Lifecycle: descongela → catch-up
kaStart();

/* ====================================================================
   🔐 ACCESO DE MIEMBROS SG — login con Discord + Salón de miembros.
   ...
   Flujo: «Ingresar con Discord» → /discord/login del Worker (Cloudflare)
   → Discord pide autorización (identidad + servidores) → el Worker
   canjea el código, verifica si el usuario pertenece al servidor de
   Discord de SG y devuelve una sesión firmada (HMAC) válida 30 días.
   La app la guarda en localStorage y desbloquea el Salón de miembros.
   El secreto de Discord vive solo en el Worker; la app nunca lo ve.
   ==================================================================== */
const SG = {
  tab: 'guild',      // la información pública se muestra primero
  session: null,      // {u:{i,n,a}, m, t, e} decodificado del token
  configured: false,  // ¿el Worker tiene las variables de Discord?
  configMissing: [],  // nombres de las variables que faltan (diagnóstico)
  loginUrl: '',
  room: { guildId: null, guildData: null, members: null, top: [], loadedOnce: false, loading: false, sort: 'kf', dir: -1, filter: '' },
};
const SG_KEYS = { sess: 'aaDiscordSession', char: 'aaSGChar', guild: 'aaSGGuild' };
const SG_GUILD_NAME = 'Spetsnaz Grail';
const SG_DC_INVITE = 'https://discord.gg/TCNWUUA7UY';
/* logo de Discord como ícono: lo usan todos los CTA de ingreso */
const SG_DC_LOGO = '<svg class="sg-dc-svg" viewBox="0 0 127.14 96.36" aria-hidden="true"><path fill="currentColor" d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>';

/* ---- subpestañas: información pública y herramientas de miembros ---- */
function sgSelectTab(key) {
  if (!['guild', 'members'].includes(key)) return;
  SG.tab = key;
  document.querySelectorAll('[data-sg-tab]').forEach(button => {
    const active = button.dataset.sgTab === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
  });
  if (key === 'guild') twCheckAll();
  else sgRoomRender();
}

const sgTabs = document.querySelector('.sg-subtabs');
sgTabs.addEventListener('click', e => {
  const button = e.target.closest('[data-sg-tab]');
  if (button) sgSelectTab(button.dataset.sgTab);
});
sgTabs.addEventListener('keydown', e => {
  const button = e.target.closest('[data-sg-tab]');
  if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const buttons = [...sgTabs.querySelectorAll('[data-sg-tab]')];
  const index = buttons.indexOf(button);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
    : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  sgSelectTab(buttons[next].dataset.sgTab);
  buttons[next].focus();
});

function sgEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* base64url → JSON (unicode-safe; el Worker codifica con TextEncoder) */
function sgFromB64url(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  try { return JSON.parse(decodeURIComponent(escape(bin))); } catch (e) { return JSON.parse(bin); }
}

/* chequeo estructural previo (formato y vencimiento). NO alcanza para
   confiar: la firma HMAC solo la puede comprobar el Worker, que tiene la
   clave. Toda sesión pasa por sgVerifySession antes de usarse. */
function sgDecodeSession(raw) {
  try {
    const str = String(raw);
    if (str.length > 4096 || !str.includes('.')) return null;
    const s = sgFromB64url(str.split('.')[0]);
    if (!s || typeof s !== 'object' || !s.u || !s.u.i) return null;
    if (typeof s.e !== 'number' || s.e < Date.now()) return null; // vencida
    return s;
  } catch (e) { return null; }
}

/* Pregunta al servidor si la sesión es auténtica (firma + vigencia).
   Primero el proxy local (server.py / exe), después el Worker.
   Devuelve {valid, member, user, e} o null si nadie pudo responder. */
async function sgVerifySession(raw) {
  const q = '/discord/verify?s=' + encodeURIComponent(String(raw));
  const ask = async u => {
    const r = await fetch(u, { cache: 'no-store' });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return (j && typeof j === 'object' && typeof j.valid === 'boolean') ? j : null;
  };
  try { const j = await ask(q); if (j) return j; } catch (e) {}
  if (WORKER_URL) { try { const j = await ask(WORKER_URL + q); if (j) return j; } catch (e) {} }
  return null;
}

function sgIsMember() { return !!(SG.session && SG.session.m === true); }
function sgChar() { try { return JSON.parse(localStorage.getItem(SG_KEYS.char) || 'null'); } catch (e) { return null; } }

/* Guarda y activa una sesión SOLO si el servidor la confirma.
   Resultado: 'ok' · 'invalid' (falsa o vencida) · 'unverified' (sin respuesta). */
let sgVerifySeq = 0;
async function sgSaveSession(raw) {
  const seq = ++sgVerifySeq;
  if (!sgDecodeSession(raw)) return 'invalid';
  const v = await sgVerifySession(raw);
  if (seq !== sgVerifySeq) return 'stale'; // llegó otra sesión mientras tanto
  if (!v) {
    SG.session = null;
    sgPaintAccount(); sgRoomRender();
    return 'unverified';
  }
  if (!v.valid || !v.user || !v.user.i) {
    SG.session = null;
    try { localStorage.removeItem(SG_KEYS.sess); } catch (e) {}
    sgPaintAccount(); sgRoomRender();
    return 'invalid';
  }
  /* se usa lo que dijo el servidor, no lo que venía en el token */
  SG.session = {
    u: { i: String(v.user.i), n: String(v.user.n || 'miembro'), a: String(v.user.a || '') },
    m: v.member === true,
    e: typeof v.e === 'number' ? v.e : Date.now(),
  };
  try { localStorage.setItem(SG_KEYS.sess, String(raw)); } catch (e) {}
  sgPaintAccount();
  sgRoomRender();
  return 'ok';
}

function sgLogout() {
  SG.session = null;
  try { localStorage.removeItem(SG_KEYS.sess); } catch (e) {}
  sgToggleMenu(false);
  sgPaintAccount();
  sgRoomRender();
  waToast('🔐 Sesión cerrada', 'Seguís pudiendo usar toda la app pública.');
}

async function sgLogin() {
  if (!SG.configured) {
    /* puede que el Worker se haya configurado después de cargar la página:
       se vuelve a preguntar antes de dar el ingreso por inactivo */
    await sgRefreshConfig();
    if (!SG.configured) {
      waToast('🔐 Acceso SG', 'El ingreso con Discord todavía no está activo en el servidor de la app. Probá más tarde.', 'err');
      return;
    }
  }
  const base = SG.loginUrl || (WORKER_URL + '/discord/login');
  location.href = base + '?redirect=' + encodeURIComponent(location.origin + location.pathname);
}

/* vuelve a consultar /discord/config y repinta lo que depende de ella */
let sgCfgBusy = false;
async function sgRefreshConfig() {
  if (sgCfgBusy) return;
  sgCfgBusy = true;
  try {
    const cfg = await sgFetchConfig();
    const changed = cfg.configured !== SG.configured || cfg.loginUrl !== SG.loginUrl;
    SG.configured = cfg.configured;
    SG.loginUrl = cfg.loginUrl;
    SG.configMissing = cfg.missing || [];
    if (changed) {
      sgPaintAccount();
      const p = document.getElementById('tab-sg');
      if (p && p.classList.contains('active')) sgRoomRender();
    }
  } finally { sgCfgBusy = false; }
}

/* avatar: imagen de Discord con inicial de respaldo */
window.sgAvatarFail = function (img) { img.style.display = 'none'; };
function sgAvatarHTML(u, cls) {
  const ini = sgEsc((u.n || '?').trim().charAt(0).toUpperCase() || '?');
  const url = u.a ? `https://cdn.discordapp.com/avatars/${sgEsc(u.i)}/${sgEsc(u.a)}.png?size=64` : '';
  return `<span class="sg-av ${cls || ''}">${url
    ? `<img src="${url}" alt="" data-sg-avatar>` : ''}<span class="sg-av-ini">${ini}</span></span>`;
}

/* ---- chip de cuenta + menú en la barra superior ---- */
function sgPaintAccount() {
  const loginBtn = document.getElementById('sgLoginBtn');
  const wrap = document.getElementById('sgAccount');
  if (!loginBtn || !wrap) return;
  const s = SG.session;
  loginBtn.hidden = !(SG.configured && !s);
  wrap.hidden = !s;
  if (!s) { sgToggleMenu(false); return; }
  const img = document.getElementById('sgAccountImg');
  const ini = document.getElementById('sgAccountInitial');
  const dot = document.getElementById('sgAccountDot');
  if (s.u.a) {
    img.src = `https://cdn.discordapp.com/avatars/${s.u.i}/${s.u.a}.png?size=64`;
    img.hidden = false; ini.textContent = '';
    img.onerror = () => { img.hidden = true; ini.textContent = (s.u.n || '?').charAt(0).toUpperCase(); };
  } else {
    img.hidden = true;
    ini.textContent = (s.u.n || '?').charAt(0).toUpperCase();
  }
  dot.className = 'sg-account-dot' + (s.m ? ' member' : '');
  document.getElementById('sgAccountBtn').title = s.u.n + (s.m ? ' — miembro SG' : ' — cuenta de Discord');
  sgPaintMenu();
}

function sgPaintMenu() {
  const menu = document.getElementById('sgAccountMenu');
  if (!menu || !SG.session) return;
  const s = SG.session;
  const hasta = s.e ? new Date(s.e).toLocaleDateString('es-AR') : '';
  menu.innerHTML = `
    <div class="sg-menu-head">
      ${sgAvatarHTML(s.u, 'sg-menu-av')}
      <div style="min-width:0">
        <div class="sg-menu-name">${sgEsc(s.u.n)}</div>
        <div class="sg-menu-status ${s.m ? 'ok' : ''}">${s.m ? '<svg class="title-ico"><use href="#i-check"/></svg> Miembro de Spetsnaz Grail' : '<svg class="title-ico"><use href="#i-close"/></svg> Sin membresía SG'}</div>
      </div>
    </div>
    ${hasta ? `<div class="sg-menu-meta micro muted">Sesión verificada hasta el ${hasta}</div>` : ''}
    <div class="sg-menu-actions">
      ${s.m ? `<button class="btn" data-sg-goto-room><svg class="btn-ico"><use href="#i-lock"/></svg> Salón de miembros</button>` : ''}
      <button class="btn" data-sg-verify><svg class="btn-ico"><use href="#i-refresh"/></svg> Volver a verificar</button>
      <button class="btn" data-sg-logout>Cerrar sesión</button>
    </div>`;
}

function sgToggleMenu(force) {
  const menu = document.getElementById('sgAccountMenu');
  if (!menu) return;
  menu.hidden = typeof force === 'boolean' ? !force : !menu.hidden;
}

/* ---- tarjetas de candado ---- */
function sgLockCard(msg) {
  return `
  <div class="sg-lock-card">
    <span class="sg-lock-ico"><svg><use href="#i-lock"/></svg></span>
    <h3>Herramientas exclusivas para miembros</h3>
    <p class="muted">${msg}</p>
    <ul>
      <li><svg class="title-ico"><use href="#i-trophy"/></svg> Ranking completo del gremio: fama de kills, muertes y ratio de cada miembro</li>
      <li><svg class="title-ico"><use href="#i-chart"/></svg> Estadísticas de Spetsnaz Grail y mejores asesinatos de la semana</li>
      <li><svg class="title-ico"><use href="#i-gamepad"/></svg> Vinculá tu personaje de Albion y mirá tu puesto en la tabla</li>
      <li><svg class="title-ico"><use href="#i-download"/></svg> Exportación del ranking en CSV</li>
    </ul>
    ${SG.configured ? `
    <button class="btn btn-discord" data-sg-login>
      ${SG_DC_LOGO} Ingresar con Discord
    </button>`
    : `<div class="micro muted"><svg class="title-ico"><use href="#i-tools"/></svg> El ingreso con Discord se está configurando — disponible en breve.</div>
    <button class="btn" data-sg-recheck><svg class="btn-ico"><use href="#i-refresh"/></svg> Comprobar de nuevo</button>`}
  </div>`;
}

/* nota compacta de candado (usada en Perfil) */
function sgLockNote(msg) {
  return `
  <div class="sg-lock-note">
    <span class="chip-ico"><svg><use href="#i-lock"/></svg></span>
    <div style="min-width:0">
      <div class="sg-lock-note-t">Exclusivo para miembros SG</div>
      <div class="micro muted">${msg}</div>
    </div>
    ${SG.configured ? `<button class="btn btn-discord" data-sg-login>${SG_DC_LOGO}Ingresar con Discord</button>`
      : `<button class="btn" data-sg-goto-room>Ver el Salón de miembros</button>`}
  </div>`;
}

/* ---- Salón de miembros ---- */
function sgRoomRender() {
  const body = document.getElementById('sgRoomBody');
  if (!body || document.getElementById('sgPanelMembers').hidden) return;
  if (!SG.session) {
    body.innerHTML = sgLockCard('Ingresá con tu cuenta de Discord: verificamos solos si sos de Spetsnaz Grail y desbloqueamos el Salón.');
    return;
  }
  if (!sgIsMember()) {
    body.innerHTML = `
    <div class="sg-lock-card">
      <span class="sg-lock-ico"><svg><use href="#i-shield"/></svg></span>
      <h3>Hola, ${sgEsc(SG.session.u.n)}</h3>
      <p class="muted">No encontramos <b>Spetsnaz Grail</b> entre los servidores de tu cuenta de Discord.</p>
      <div class="sg-menu-actions">
        <a class="btn btn-discord" href="${SG_DC_INVITE}" target="_blank" rel="noopener">${SG_DC_LOGO}Unirme al Discord de SG</a>
        <button class="btn" data-sg-verify><svg class="btn-ico"><use href="#i-refresh"/></svg> Volver a verificar</button>
        <button class="btn" data-sg-logout>Cerrar sesión</button>
      </div>
      <div class="micro muted">Si acabás de entrar al servidor, dale a «Volver a verificar»: Discord a veces demora en refrescar la lista.</div>
    </div>`;
    return;
  }
  /* miembro: contenido de la Sala */
  if (!SG.room.loadedOnce) {
    body.innerHTML = `
    <div class="sg-welcome">
      <div class="sg-welcome-txt">
        <div class="sg-welcome-name">Hola, <b>${sgEsc(SG.session.u.n)}</b> 👋</div>
        <div class="micro muted">Cargando el Salón de miembros…</div>
      </div>
      <div class="sg-welcome-actions">
        <button class="btn" data-sg-verify><svg class="btn-ico"><use href="#i-refresh"/></svg> Re-verificar</button>
        <button class="btn" data-sg-logout>Cerrar sesión</button>
      </div>
    </div>
    <div class="loading-cell">Buscando a Spetsnaz Grail en el killboard…</div>`;
    sgLoadRoom();
    return;
  }
  sgRoomContent();
}

async function sgLoadRoom() {
  if (SG.room.loading) return;
  SG.room.loading = true;
  try {
    const gid = await sgResolveGuild();
    SG.room.guildId = gid;
    const [g, mem, top] = await Promise.all([
      pfFetchRetry('/guilds/' + gid).catch(() => null),
      pfFetchRetry('/guilds/' + gid + '/members').catch(() => null),
      pfFetchRetry('/guilds/' + gid + '/top?range=week').catch(() => null),
    ]);
    const members = pfAsArray(mem);
    if (!members.length) throw new Error('sin miembros');
    SG.room.guildData = g && g.Name ? g : null;
    SG.room.members = members;
    SG.room.top = pfAsArray(top);
    SG.room.loadedOnce = true;
  } catch (err) {
    const body = document.getElementById('sgRoomBody');
    if (body) body.innerHTML = `
      <div class="sg-welcome">
        <div class="sg-welcome-txt">
          <div class="sg-welcome-name">Hola, <b>${sgEsc((SG.session || { u: { n: '' } }).u.n)}</b> 👋</div>
        </div>
        <div class="sg-welcome-actions"><button class="btn" data-sg-logout>Cerrar sesión</button></div>
      </div>
      <div class="loading-cell">El killboard no respondió. <button class="btn" data-sg-refresh style="margin-left:10px"><svg class="btn-ico"><use href="#i-refresh"/></svg> Reintentar</button></div>`;
    SG.room.loading = false;
    return;
  }
  SG.room.loading = false;
  sgRoomRender();
}

/* resuelve el ID del gremio in-game por nombre (cache 24 h) */
async function sgResolveGuild(force) {
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(SG_KEYS.guild) || 'null');
      if (c && c.id && Date.now() - c.t < 24 * 3600e3) return c.id;
    } catch (e) {}
  }
  const data = await pfFetchRetry('/search?q=' + encodeURIComponent(SG_GUILD_NAME));
  const gs = (data && data.guilds) || [];
  const g = gs.find(x => (x.Name || '').toLowerCase() === SG_GUILD_NAME.toLowerCase()) || gs[0];
  if (!g || !g.Id) throw new Error('gremio no encontrado');
  try { localStorage.setItem(SG_KEYS.guild, JSON.stringify({ id: g.Id, t: Date.now() })); } catch (e) {}
  return g.Id;
}

/* Sub-tabs internas del salón: resumen, builds, mapa de guerra, tracker por zona.
   Cada herramienta tiene su propio botón: el Mapa de Guerra (territorios/GvG de SG)
   y el Tracker por zona real (PvP sobre el grafo de world.xml) son independientes. */
const SG_ROOM_TABS = {
  summary: { panel: 'sgRoomSummary' },
  builds:  { panel: 'sgRoomBuilds', render: () => bdRender() },
  war:     { panel: 'sgRoomWar',    render: () => wmRender() },
  tracker: { panel: 'sgRoomTracker', render: () => wmTrackerRender() },
};
let sgRoomTab = 'summary';
// Aviso por entrada a cada herramienta; no persiste la confirmación.
function sgShowDevelopmentNotice(tabId) {
  if (tabId !== 'war' && tabId !== 'tracker') return;
  const panel = document.getElementById(SG_ROOM_TABS[tabId].panel);
  if (!panel) return;
  panel.querySelector('.sg-development-notice')?.remove();
  const notice = document.createElement('div');
  notice.className = 'sg-development-notice';
  notice.setAttribute('role', 'note');
  notice.setAttribute('aria-label', 'Advertencia de función en desarrollo');
  const message = document.createElement('p');
  message.textContent = 'Función todavía en desarrollo. Los datos de esta herramienta no son 100% seguros. Usar teniendo eso en cuenta.';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn';
  confirm.textContent = 'De acuerdo';
  confirm.addEventListener('click', () => {
    // Al retirar el botón enfocado, devolver el foco a la pestaña activa.
    const hadFocus = document.activeElement === confirm;
    notice.remove();
    if (hadFocus) document.querySelector('[data-room-tab="' + tabId + '"]')?.focus();
  });
  notice.append(message, confirm);
  panel.prepend(notice);
}
function sgRoomContent() {
  const body = document.getElementById('sgRoomBody');
  if (!body) return;
  const g = SG.room.guildData, mem = SG.room.members || [];
  const linked = sgChar();
  const byKf = [...mem].sort((a, b) => (b.KillFame || 0) - (a.KillFame || 0));
  const myPos = linked ? byKf.findIndex(m => m.Id === linked.id) + 1 : 0;
  body.innerHTML = `
  <div class="sg-welcome">
    <div class="sg-welcome-txt">
      <div class="sg-welcome-name">Hola, <b>${sgEsc(SG.session.u.n)}</b> 👋</div>
      <div class="micro muted">${linked ? `Jugás como <b>${sgEsc(linked.name)}</b>${myPos ? ` · puesto <b>#${myPos}</b> de ${mem.length} en fama de kills` : ''}` : 'Vinculá tu personaje abajo para marcarte en la tabla'}</div>
    </div>
    <div class="sg-welcome-actions">
      <button class="btn" data-sg-refresh title="Volver a pedir los datos al killboard"><svg class="btn-ico"><use href="#i-refresh"/></svg> Actualizar</button>
      <button class="btn" data-sg-verify><svg class="btn-ico"><use href="#i-refresh"/></svg> Re-verificar</button>
      <button class="btn" data-sg-logout>Cerrar sesión</button>
    </div>
  </div>

  <div class="sg-room-tabs" role="tablist" aria-label="Herramientas del Salón">
    <button class="sg-room-tab${sgRoomTab === 'summary' ? ' active' : ''}" data-room-tab="summary" role="tab" aria-selected="${sgRoomTab === 'summary'}">
      <svg class="tab-ico"><use href="#i-trophy"/></svg> Resumen
    </button>
    <button class="sg-room-tab${sgRoomTab === 'builds' ? ' active' : ''}" data-room-tab="builds" role="tab" aria-selected="${sgRoomTab === 'builds'}">
      <svg class="tab-ico"><use href="#i-sword"/></svg> Builds
    </button>
    <button class="sg-room-tab${sgRoomTab === 'war' ? ' active' : ''}" data-room-tab="war" role="tab" aria-selected="${sgRoomTab === 'war'}">
      <svg class="tab-ico"><use href="#i-shield"/></svg> Mapa de Guerra
    </button>
    <button class="sg-room-tab${sgRoomTab === 'tracker' ? ' active' : ''}" data-room-tab="tracker" role="tab" aria-selected="${sgRoomTab === 'tracker'}">
      <svg class="tab-ico"><use href="#i-globe"/></svg> Tracker por Zona
    </button>
  </div>

  <div class="sg-room-panel" id="sgRoomSummary"${sgRoomTab !== 'summary' ? ' hidden' : ''}>
    <div class="stats sg-room-stats">
      <div class="stat"><div class="k">Miembros</div><div class="v">${fmt(g ? g.MemberCount : mem.length)}</div><div class="s">Spetsnaz Grail</div></div>
      <div class="stat"><div class="k">Fama de asesinatos</div><div class="v pos">${fmt(g ? g.killFame : byKf.reduce((s, m) => s + (m.KillFame || 0), 0))}</div><div class="s">todo el gremio</div></div>
      <div class="stat"><div class="k">Fama de muertes</div><div class="v neg">${fmt(g ? g.DeathFame : mem.reduce((s, m) => s + (m.DeathFame || 0), 0))}</div><div class="s">todo el gremio</div></div>
      <div class="stat"><div class="k">Fundado</div><div class="v" style="font-size:1rem">${g && g.Founded ? new Date(g.Founded).toLocaleDateString('es-AR') : '—'}</div><div class="s">${g && g.FounderName ? 'por ' + sgEsc(g.FounderName) : ''}</div></div>
    </div>

    <div class="sg-char">
      <span class="chip-ico"><svg><use href="#i-link"/></svg></span>
      <div class="sg-char-main">
        <div class="cd-title">Tu personaje de Albion</div>
        <div id="sgCharBox">${sgCharBoxHTML()}</div>
      </div>
    </div>

    <div class="sg-rank-bar">
      <div class="cd-title"><span class="chip-ico"><svg><use href="#i-trophy"/></svg></span> Ranking de miembros</div>
      <div class="sg-rank-tools">
        <input type="search" id="sgRankSearch" class="search" placeholder="Buscar miembro por nombre…" value="${sgEsc(SG.room.filter)}">
        <button class="btn" data-sg-csv title="Descargar el ranking visible en CSV"><svg class="btn-ico"><use href="#i-download"/></svg> CSV</button>
      </div>
    </div>
    <div id="sgRankTable">${sgRankTableHTML()}</div>

    <div class="sg-week">
      <div class="cd-title"><svg class="title-ico"><use href="#i-sword"/></svg> Mejores asesinatos de la semana</div>
      ${sgWeekHTML()}
    </div>
  </div>

  <div class="sg-room-panel" id="sgRoomBuilds"${sgRoomTab !== 'builds' ? ' hidden' : ''}>
    <div id="bdMount"></div>
  </div>

  <div class="sg-room-panel" id="sgRoomWar"${sgRoomTab !== 'war' ? ' hidden' : ''}>
    <div id="wmMount"></div>
  </div>

  <div class="sg-room-panel" id="sgRoomTracker"${sgRoomTab !== 'tracker' ? ' hidden' : ''}>
    <div id="wmTrackerMount"></div>
  </div>`;

  /* renderizar el panel activo */
  const tab = SG_ROOM_TABS[sgRoomTab] || SG_ROOM_TABS.summary;
  sgShowDevelopmentNotice(sgRoomTab);
  if (tab.render) tab.render();
}

function sgCharBoxHTML() {
  const linked = sgChar();
  if (!linked) return `
    <div class="sg-char-form">
      <input type="text" id="sgCharInput" class="search" placeholder="Nombre exacto de tu personaje…" maxlength="30">
      <button class="btn primary" id="sgCharBtn">Vincular</button>
    </div>
    <div class="micro muted" id="sgCharMsg">Lo verificamos contra el killboard: tiene que figurar en Spetsnaz Grail.</div>`;
  return `
    <div class="sg-char-linked">
      <span class="sg-char-tag"><svg class="title-ico"><use href="#i-gamepad"/></svg> <b>${sgEsc(linked.name)}</b></span>
      <button class="btn" data-sg-char-edit>cambiar</button>
      <button class="btn" data-sg-char-del>quitar</button>
    </div>
    <div class="micro muted">Tu fila queda marcada con <span class="sg-you">(vos)</span> en el ranking.</div>`;
}

function sgSortedMembers() {
  const list = (SG.room.members || []).filter(m =>
    !SG.room.filter || (m.Name || '').toLowerCase().includes(SG.room.filter));
  const k = SG.room.sort, dir = SG.room.dir;
  const ratio = m => (m.DeathFame > 0 ? (m.KillFame || 0) / m.DeathFame : -1);
  return list.sort((a, b) => {
    let d = 0;
    if (k === 'name') d = String(a.Name || '').localeCompare(String(b.Name || ''), 'es', { sensitivity: 'base' });
    else if (k === 'df') d = (a.DeathFame || 0) - (b.DeathFame || 0);
    else if (k === 'ratio') d = ratio(a) - ratio(b);
    else d = (a.KillFame || 0) - (b.KillFame || 0);
    return d * dir;
  });
}

function sgRankTableHTML() {
  const linked = sgChar();
  const rows = sgSortedMembers();
  if (!rows.length) return `<div class="loading-cell">Ningún miembro coincide con la búsqueda.</div>`;
  const arrow = k => SG.room.sort === k ? (SG.room.dir < 0 ? ' ▾' : ' ▴') : '';
  const base = [...(SG.room.members || [])].sort((a, b) => (b.KillFame || 0) - (a.KillFame || 0));
  const pos = {}; base.forEach((m, i) => { pos[m.Id] = i + 1; });
  return `
  <div class="table-wrap"><table class="ledger">
    <thead><tr>
      <th>#</th>
      <th class="sortable" data-sg-sort="name">Jugador${arrow('name')}</th>
      <th class="sortable num" data-sg-sort="kf">Fama de kills${arrow('kf')}</th>
      <th class="sortable num" data-sg-sort="df">Fama de muertes${arrow('df')}</th>
      <th class="sortable num" data-sg-sort="ratio">Ratio K/D${arrow('ratio')}</th>
    </tr></thead>
    <tbody>${rows.map(m => {
      const r = m.DeathFame > 0 ? (m.KillFame || 0) / m.DeathFame : null;
      const me = linked && linked.id === m.Id;
      return `<tr class="clickable${me ? ' sg-me' : ''}" data-sg-member="${sgEsc(m.Id)}" data-sg-name="${sgEsc(m.Name)}" title="Ver el perfil de ${sgEsc(m.Name)} en la pestaña Perfil">
        <td class="muted">${pos[m.Id] || ''}</td>
        <td><b>${sgEsc(m.Name)}</b>${me ? ' <span class="sg-you">(vos)</span>' : ''}</td>
        <td class="num pos">${fmt(m.KillFame)}</td>
        <td class="num">${fmt(m.DeathFame)}</td>
        <td class="num ${r == null ? '' : r >= 1 ? 'pos' : 'neg'}">${r == null ? '—' : r.toFixed(2)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  <div class="micro muted" style="padding:6px 2px">${rows.length} de ${(SG.room.members || []).length} miembros · fuente: killboard oficial (puede demorar en reflejar cambios). Tocá un nombre para ver su perfil.</div>`;
}

function sgWeekHTML() {
  const top = (SG.room.top || []).slice(0, 5);
  if (!top.length) return `<div class="loading-cell">Sin asesinatos del gremio esta semana.</div>`;
  return `<div class="table-wrap"><table class="ledger">
    <thead><tr><th>Fecha</th><th>Asesino</th><th>Víctima</th><th class="num">Fama</th></tr></thead>
    <tbody>${top.map(ev => `<tr>
      <td class="muted">${ev.TimeStamp ? new Date(ev.TimeStamp).toLocaleDateString('es-AR') : '—'}</td>
      <td><b>${sgEsc((ev.Killer || {}).Name || '?')}</b></td>
      <td>${sgEsc((ev.Victim || {}).Name || '?')}</td>
      <td class="num pos">${fmt(ev.TotalVictimKillFame)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/* ---- vínculo de personaje ---- */
async function sgSaveChar() {
  const inp = document.getElementById('sgCharInput');
  const msg = document.getElementById('sgCharMsg');
  const btn = document.getElementById('sgCharBtn');
  if (!inp || !msg || !btn) return;
  const q = inp.value.trim();
  if (q.length < 3) { msg.textContent = 'Escribí al menos 3 caracteres.'; msg.className = 'micro sg-err'; return; }
  btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const data = await pfFetchRetry('/search?q=' + encodeURIComponent(q));
    const players = (data && data.players) || [];
    let p = players.find(x => (x.Name || '').toLowerCase() === q.toLowerCase()) || players[0];
    if (!p) throw new Error('no-encontrado');
    /* el personaje debe figurar en Spetsnaz Grail */
    let gname = p.GuildName;
    if (gname == null) {
      try { const d = await pfFetchRetry('/players/' + p.Id); gname = d.GuildName; } catch (e) {}
    }
    if (gname != null && String(gname).toLowerCase() !== SG_GUILD_NAME.toLowerCase()) {
      throw new Error('otro-gremio:' + (gname || 'sin gremio'));
    }
    try { localStorage.setItem(SG_KEYS.char, JSON.stringify({ id: p.Id, name: p.Name })); } catch (e) {}
    waToast('🎮 Personaje vinculado', `«${p.Name}» queda marcado como vos en el ranking.`);
  } catch (err) {
    const m = String(err.message || '');
    msg.textContent = m.startsWith('otro-gremio:')
      ? `«${q}» figura en «${m.split(':')[1]}», no en Spetsnaz Grail. Si acabás de entrar al gremio, esperá a que el killboard se actualice.`
      : `No encontramos el personaje «${q}» en el killboard. Probá el nombre exacto.`;
    msg.className = 'micro sg-err';
    btn.disabled = false; btn.textContent = 'Vincular';
    return;
  }
  SG.room.loadedOnce ? sgRoomContent() : sgRoomRender();
}

function sgCharEditForm() {
  const box = document.getElementById('sgCharBox');
  if (!box) return;
  try { localStorage.removeItem(SG_KEYS.char); } catch (e) {}
  box.innerHTML = sgCharBoxHTML();
}
function sgCharDelete() {
  try { localStorage.removeItem(SG_KEYS.char); } catch (e) {}
  SG.room.loadedOnce ? sgRoomContent() : sgRoomRender();
}

/* ---- CSV del ranking visible ---- */
function sgMembersCSV() {
  const rows = sgSortedMembers();
  const base = [...(SG.room.members || [])].sort((a, b) => (b.KillFame || 0) - (a.KillFame || 0));
  const pos = {}; base.forEach((m, i) => { pos[m.Id] = i + 1; });
  const head = 'puesto,jugador,fama_kills,fama_muertes,ratio_kd\n';
  return head + rows.map(m => [
    pos[m.Id] || '',
    csvCell(m.Name || ''),
    m.KillFame || 0,
    m.DeathFame || 0,
    m.DeathFame > 0 ? ((m.KillFame || 0) / m.DeathFame).toFixed(2) : '',
  ].join(',')).join('\n');
}
function sgDownloadCSV() {
  if (typeof URL.createObjectURL !== 'function') return; // entorno sin descargas (pruebas)
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + sgMembersCSV()], { type: 'text/csv' }));
  a.download = `spetsnaz-grail-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function sgOpenMember(id, name) {
  gotoTab('profile');
  const inp = document.getElementById('pfSearch');
  if (inp) inp.value = name;
  pfLoadPlayer(id, name);
}

/* ---- eventos globales del módulo ---- */
document.addEventListener('click', e => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('#sgAccountBtn')) { sgToggleMenu(); return; }
  if (t.closest('[data-sg-login]')) { sgToggleMenu(false); sgLogin(); return; }
  if (t.closest('[data-sg-verify]')) { sgToggleMenu(false); sgLogin(); return; }
  if (t.closest('[data-sg-recheck]')) {
    const b = t.closest('[data-sg-recheck]'); b.disabled = true;
    sgRefreshConfig().then(() => {
      b.disabled = false;
      if (SG.configured) waToast('🔐 Acceso SG', 'El ingreso con Discord ya está activo.');
      else waToast('🔐 Acceso SG', 'Todavía no está activo en el servidor de la app.', 'err');
    });
    return;
  }
  if (t.closest('[data-sg-logout]')) { sgLogout(); return; }
  if (t.closest('[data-sg-goto-room]')) { sgToggleMenu(false); gotoTab('sg', 'members'); return; }
  if (t.closest('[data-sg-refresh]')) { SG.room.loadedOnce = false; sgRoomRender(); return; }
  if (t.closest('[data-sg-csv]')) { sgDownloadCSV(); return; }
  if (t.closest('#sgCharBtn')) { sgSaveChar(); return; }
  if (t.closest('[data-sg-char-edit]')) { sgCharEditForm(); return; }
  if (t.closest('[data-sg-char-del]')) { sgCharDelete(); return; }
  const sort = t.closest('[data-sg-sort]');
  if (sort) {
    const k = sort.dataset.sgSort;
    if (SG.room.sort === k) SG.room.dir *= -1;
    else { SG.room.sort = k; SG.room.dir = k === 'name' ? 1 : -1; }
    const box = document.getElementById('sgRankTable');
    if (box) box.innerHTML = sgRankTableHTML();
    return;
  }
  const mem = t.closest('[data-sg-member]');
  if (mem) { sgOpenMember(mem.dataset.sgMember, mem.dataset.sgName); return; }
  /* sub-tabs del salón (Resumen / Builds / Mapa de Guerra / Tracker por Zona) */
  const roomTab = t.closest('[data-room-tab]');
  if (roomTab) {
    sgRoomTab = roomTab.dataset.roomTab;
    document.querySelectorAll('.sg-room-tab').forEach(b => {
      const on = b.dataset.roomTab === sgRoomTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.sg-room-panel').forEach(p => p.hidden = true);
    const tab = SG_ROOM_TABS[sgRoomTab] || SG_ROOM_TABS.summary;
    const target = document.getElementById(tab.panel);
    if (target) target.hidden = false;
    sgShowDevelopmentNotice(sgRoomTab);
    if (tab.render) tab.render();
    return;
  }
  if (!t.closest('#sgAccountMenu') && !t.closest('#sgAccountBtn')) sgToggleMenu(false);
});
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'sgRankSearch') {
    SG.room.filter = e.target.value.trim().toLowerCase();
    const box = document.getElementById('sgRankTable');
    if (box) box.innerHTML = sgRankTableHTML();
  }
});

/* ====================================================================
   🛡️ COMPOSITOR DE BUILDS PERSONAL + SCOUT DE MERCADO
   Herramienta exclusiva para miembros de Spetsnaz Grail.
   Permite armar builds personales, ver costos en tiempo real,
   guardarlas y recibir alertas cuando bajan de precio.
   ==================================================================== */
const BD = {
  list: [], // builds guardadas
  current: null, // build en edición
  prices: {}, // precios cacheados
  loading: false,
};
try { BD.list = JSON.parse(localStorage.getItem('sgBuilds') || '[]'); } catch (e) {}
function bdSave() { localStorage.setItem('sgBuilds', JSON.stringify(BD.list)); }

const BD_SLOTS = [
  { key: 'mainHand', label: 'Mano Principal', icon: 'i-sword' },
  { key: 'offHand', label: 'Mano Secundaria', icon: 'i-shield' },
  { key: 'head', label: 'Cabeza', icon: 'i-user' },
  { key: 'chest', label: 'Pecho', icon: 'i-shield' },
  { key: 'shoes', label: 'Pies', icon: 'i-user' },
  { key: 'cape', label: 'Capa', icon: 'i-shield' },
  { key: 'food', label: 'Comida', icon: 'i-pot' },
  { key: 'potion', label: 'Poción', icon: 'i-flask' },
];

function bdNewItem() {
  return BD_SLOTS.reduce((acc, s) => { acc[s.key] = null; return acc; }, {});
}

function bdRender() {
  const mount = document.getElementById('bdMount');
  if (!mount) return;
  
  if (!BD.current) {
    // Lista de builds guardadas
    mount.innerHTML = `
      <div class="panel">
        <div class="cd-title">
          <svg class="title-ico"><use href="#i-sword"/></svg> Mis Builds
          <button class="btn primary" id="bdNewBtn" style="margin-left:auto">+ Nueva Build</button>
        </div>
        <div class="micro muted" style="padding:8px 14px">Armá tus builds personales, calculá el costo en tiempo real y recibí alertas cuando bajen de precio.</div>
        <div id="bdList">${bdListHTML()}</div>
      </div>`;
    document.getElementById('bdNewBtn').onclick = () => {
      BD.current = { id: Date.now(), name: 'Nueva Build', items: bdNewItem(), createdAt: Date.now() };
      bdRender();
    };
  } else {
    // Editor de build
    bdRenderEditor();
  }
}

function bdListHTML() {
  if (!BD.list.length) return '<div class="loading-cell">No tenés builds guardadas. Creá una para empezar.</div>';
  return BD.list.map(b => `
    <div class="bd-card" data-bd-id="${b.id}">
      <div class="bd-card-head">
        <div class="bd-card-name">${sgEsc(b.name)}</div>
        <div class="bd-card-meta">${new Date(b.createdAt).toLocaleDateString('es-AR')}</div>
      </div>
      <div class="bd-card-actions">
        <button class="btn micro-btn" data-bd-edit="${b.id}">Editar</button>
        <button class="btn micro-btn" data-bd-dup="${b.id}">Duplicar</button>
        <button class="btn micro-btn" data-bd-del="${b.id}">Eliminar</button>
      </div>
    </div>`).join('');
}

function bdRenderEditor() {
  const mount = document.getElementById('bdMount');
  const b = BD.current;
  mount.innerHTML = `
    <div class="panel">
      <div class="cd-title">
        <button class="btn micro-btn" id="bdBackBtn">← Volver</button>
        <input type="text" id="bdNameInput" class="search" value="${sgEsc(b.name)}" style="flex:1;margin-left:8px">
        <button class="btn primary" id="bdSaveBtn">Guardar</button>
        <button class="btn" id="bdCalcBtn">💰 Calcular Costo</button>
      </div>
      <div class="bd-editor">
        <div class="bd-slots">
          ${BD_SLOTS.map(s => bdSlotHTML(s, b.items[s.key])).join('')}
        </div>
        <div class="bd-cost" id="bdCostBox">
          <div class="loading-cell">Tocá "Calcular Costo" para ver precios en tiempo real.</div>
        </div>
      </div>
    </div>`;
  
  document.getElementById('bdBackBtn').onclick = () => { BD.current = null; bdRender(); };
  document.getElementById('bdNameInput').oninput = (e) => { BD.current.name = e.target.value; };
  document.getElementById('bdSaveBtn').onclick = () => {
    const idx = BD.list.findIndex(x => x.id === b.id);
    if (idx >= 0) BD.list[idx] = b; else BD.list.push(b);
    bdSave();
    waToast('✅ Build guardada', `"${b.name}" se guardó en tu lista.`);
    BD.current = null;
    bdRender();
  };
  document.getElementById('bdCalcBtn').onclick = () => bdCalcCost();
}

function bdSlotHTML(slot, itemId) {
  const item = itemId ? catalogItem(itemId) : null;
  return `
    <div class="bd-slot" data-bd-slot="${slot.key}">
      <div class="bd-slot-label">
        <svg class="title-ico"><use href="#${slot.icon}"/></svg> ${slot.label}
      </div>
      <div class="bd-slot-content">
        ${item ? `
          <div class="item-cell">
            ${iconImg(itemId, 'item-icon sm')}
            <div>
              <div class="item-name">${sgEsc(catalogName(itemId))}</div>
              <div class="item-meta">${sgEsc(itemId)}</div>
            </div>
          </div>
          <button class="btn micro-btn" data-bd-clear="${slot.key}">✕</button>
        ` : `
          <div class="bd-slot-empty">Vacío</div>
        `}
      </div>
      <button class="btn micro-btn" data-bd-pick="${slot.key}">Elegir</button>
    </div>`;
}

function catalogItem(id) {
  if (!CATALOG) return null;
  /* los ítems encantados no tienen fila propia en el catálogo: la base es el
     id sin el sufijo @N (T6_MAIN_SWORD@2 → T6_MAIN_SWORD) */
  const base = String(id).split('@')[0];
  return CATALOG.find(c => c[0] === base);
}

function bdCalcCost() {
  if (BD.loading) return;
  const b = BD.current;
  const ids = BD_SLOTS.map(s => b.items[s.key]).filter(Boolean);
  if (!ids.length) {
    waToast('⚠️ Build vacía', 'Agregá al menos un ítem para calcular costos.', 'err');
    return;
  }
  
  BD.loading = true;
  const box = document.getElementById('bdCostBox');
  box.innerHTML = '<div class="loading-cell">Cargando precios…</div>';
  
  fetchPrices(ids, [...CITIES, BLACK_MARKET]).then(prices => {
    BD.prices = prices;
    BD.loading = false;
    bdRenderCost();
  }).catch(err => {
    BD.loading = false;
    box.innerHTML = `<div class="loading-cell sg-err">Error al cargar precios: ${sgEsc(err.message)}</div>`;
  });
}

function bdRenderCost() {
  const box = document.getElementById('bdCostBox');
  const b = BD.current;
  const rows = BD_SLOTS.map(s => {
    const id = b.items[s.key];
    if (!id) return null;
    const p = BD.prices[id] || {};
    const best = bdBestPrice(p);
    return { slot: s, id, price: best };
  }).filter(Boolean);
  
  const total = rows.reduce((sum, r) => sum + (r.price.value || 0), 0);
  
  box.innerHTML = `
    <div class="bd-cost-table">
      <div class="bd-cost-row bd-cost-head">
        <div>Ítem</div>
        <div>Mejor Precio</div>
        <div>Ciudad</div>
      </div>
      ${rows.map(r => `
        <div class="bd-cost-row">
          <div class="item-cell">
            ${iconImg(r.id, 'item-icon sm')}
            <div class="item-name">${sgEsc(catalogName(r.id))}</div>
          </div>
          <div class="num pos">${fmt(r.price.value)}</div>
          <div class="muted">${sgEsc(r.price.city || '—')}</div>
        </div>`).join('')}
      <div class="bd-cost-row bd-cost-total">
        <div><b>TOTAL</b></div>
        <div class="num pos"><b>${fmt(total)}</b></div>
        <div></div>
      </div>
    </div>
    <div style="padding:10px 14px">
      <button class="btn primary" id="bdAlertBtn">🔔 Crear Alerta de Precio</button>
      <div class="micro muted" style="margin-top:6px">La app te avisa cuando el costo total baja.</div>
    </div>`;
  
  document.getElementById('bdAlertBtn').onclick = () => bdCreateAlert(total);
}

function bdBestPrice(p) {
  let best = { value: 0, city: '' };
  for (const city of CITIES) {
    const v = p[city] ? p[city].sell : 0;
    if (v > 0 && (best.value === 0 || v < best.value)) best = { value: v, city };
  }
  return best;
}

function bdCreateAlert(currentCost) {
  const b = BD.current;
  const threshold = Math.round(currentCost * 0.9); // alerta cuando baja 10%
  const alert = {
    uid: 'bd-' + b.id,
    id: b.items.mainHand || b.items.chest || 'build',
    name: 'Build: ' + b.name,
    metric: 'sell',
    city: CITIES[0],
    threshold,
    on: true,
    fired: false,
    once: false,
    buildId: b.id,
    createdAt: Date.now(),
  };
  WA.list.push(alert);
  waSave();
  waRestart();
  waToast('🔔 Alerta creada', `Te avisamos cuando "${b.name}" baje de ${fmt(threshold)}.`);
}

// Event delegation para el editor de builds
document.addEventListener('click', e => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  
  const edit = t.closest('[data-bd-edit]');
  if (edit) {
    const id = +edit.dataset.bdEdit;
    BD.current = BD.list.find(b => b.id === id);
    bdRender();
    return;
  }
  
  const dup = t.closest('[data-bd-dup]');
  if (dup) {
    const id = +dup.dataset.bdDup;
    const orig = BD.list.find(b => b.id === id);
    if (orig) {
      const copy = { ...orig, id: Date.now(), name: orig.name + ' (copia)', createdAt: Date.now() };
      BD.list.push(copy);
      bdSave();
      bdRender();
      waToast('✅ Build duplicada', `"${copy.name}" se agregó a tu lista.`);
    }
    return;
  }
  
  const del = t.closest('[data-bd-del]');
  if (del) {
    const id = +del.dataset.bdDel;
    if (confirm('¿Eliminar esta build?')) {
      BD.list = BD.list.filter(b => b.id !== id);
      bdSave();
      bdRender();
    }
    return;
  }
  
  const pick = t.closest('[data-bd-pick]');
  if (pick) {
    const slot = pick.dataset.bdPick;
    bdOpenPicker(slot);
    return;
  }
  
  const clear = t.closest('[data-bd-clear]');
  if (clear) {
    const slot = clear.dataset.bdClear;
    BD.current.items[slot] = null;
    bdRenderEditor();
    return;
  }
});

function bdOpenPicker(slotKey) {
  const modal = document.createElement('div');
  modal.className = 'bd-modal';
  modal.innerHTML = `
    <div class="bd-modal-box">
      <div class="bd-modal-head">
        <div class="cd-title">Elegir ítem para ${BD_SLOTS.find(s => s.key === slotKey).label}</div>
        <button class="btn micro-btn" id="bdModalClose">✕</button>
      </div>
      <input type="search" id="bdModalSearch" class="search big" placeholder="Buscar ítem… Ej: Espada ancha, T6_MAIN_SWORD" autofocus>
      <div class="micro muted" style="padding:6px 14px 0">Cada ítem aparece en su versión plana y en las encantadas <b>.1</b> a <b>.4</b> (según cuántas tenga).</div>
      <div class="bd-modal-list" id="bdModalList"></div>
    </div>`;
  document.body.appendChild(modal);
  
  const close = () => modal.remove();
  document.getElementById('bdModalClose').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  
  const list = document.getElementById('bdModalList');
  const search = document.getElementById('bdModalSearch');
  
  const render = (q) => {
    if (!CATALOG) { list.innerHTML = '<div class="loading-cell">Cargando catálogo…</div>'; return; }
    const query = q.toLowerCase();
    const hits = CATALOG.filter(c => !query
      || c[1].toLowerCase().includes(query)
      || (c[2] || '').toLowerCase().includes(query)
      || c[0].toLowerCase().includes(query)).slice(0, 40);
    if (!hits.length) { list.innerHTML = '<div class="loading-cell">Sin resultados.</div>'; return; }
    /* Como el buscador de Flipping: cada ítem aparece en su versión plana y en
       las encantadas (.1 a .4 según maxEnch del catálogo). El id de mercado
       lleva el sufijo @N (p. ej. T6_MAIN_SWORD@2); catalogName() y fetchPrices
       ya lo soportan, así que el costo y las alertas funcionan igual. */
    list.innerHTML = hits.map(([id, es, , tier, maxEnch]) => {
      const enchs = [''].concat(Array.from({ length: maxEnch || 0 }, (_, i) => '@' + (i + 1)));
      return enchs.map(suf => `
      <div class="bd-modal-item" data-bd-select="${sgEsc(id + suf)}">
        ${iconImg(id + suf, 'item-icon sm')}
        <div>
          <div class="item-name">${sgEsc(es)}${suf ? ' .' + suf.slice(1) : ''}</div>
          <div class="item-meta">T${tier}${suf ? '.' + suf.slice(1) : ''} · ${sgEsc(id + suf)}</div>
        </div>
      </div>`).join('');
    }).join('');
  };
  
  search.oninput = () => render(search.value);
  render('');
  
  list.onclick = (e) => {
    const item = e.target.closest('[data-bd-select]');
    if (item) {
      BD.current.items[slotKey] = item.dataset.bdSelect;
      close();
      bdRenderEditor();
    }
  };
}

/* ====================================================================
   🗺️ MAPA DE GUERRA DE SG + TRACKER DE ENEMIGOS POR MAPA REAL
   Herramienta exclusiva para miembros de Spetsnaz Grail.
   Son DOS botones separados en el Salón, para no mezclar las herramientas:
     · «Mapa de Guerra» (data-room-tab="war", #wmMount)  → wmRender()
     · «Tracker por Zona» (data-room-tab="tracker", #wmTrackerMount) → wmTrackerRender()
   El killboard oficial NO expone /guilds/:id/territories. Los territorios
   se reconstruyen a partir de los GvG (guildmatches past/next) y de los
   eventos PvP del gremio: el último ganador de un territorio es su dueño.
   El tracker por mapa real no depende de los territorios: su fuente es el grafo
   de mapas de broderickhyman/ao-bin-dumps cluster/world.xml
   (815 zonas, 1356 conexiones) parseado a data/albion_map_connections.json
   Estructura: byName {Mapa: [vecinos]} + maps[].
   El usuario elige un mapa real y se rastrean asesinatos (battles) en
   mapa elegido + todas las conexiones fronterizas.
   ==================================================================== */
const WM = {
  territories: [],
  upcoming: [],
  past: [],
  events: [],
  enemies: [],
  loading: false,
  loadedOnce: false,
  lastUpdate: null,
  error: null,
  filter: 'all', // all | owned | threatened | upcoming
  // Nuevo tracker por mapa real
  mapGraph: null, // byName {name: [neighbors]}
  mapList: [], // [{mapID, mapName, mapType, tier, x?, y?}]
  mapGraphById: null,
  selectedMap: null, // display name
  selectedNeighbors: [],
  selectedMapID: null,
  tracker: { loading:false, battles:[], filtered:[], guilds:[], lastUpdate:null, error:null, expandedBattle:null },
  mapSearchQuery: '',
  mapSearchResults: [],
  mapLoading: false,
  /* --- nuevas capas: minimapa, peligro, rutas, filtros, caché --- */
  mapPos: null,          // Map mapName(minúsculas) -> entrada de mapList con x,y
  mapFilter: 'all',      // all | city | royal | outlands | outlands78 | roads
  battles: [],           // últimas batallas del servidor (caché compartida)
  battlesAt: 0,          // cuándo se trajeron
  kills: [],             // asesinatos crudos (gameinfo /events): incluyen kills sueltos que no llegan a «batalla»
  killsAt: 0,
  providers: null,       // estado de cada fuente: {battles, events, murderledger} -> {ok, count, newest, ...}
  zoneDanger: {},        // zona(minúsculas) -> {score, battles2h, kills, fame, count, lastAt, evKills, evFame, lastKillAt}
  route: null,           // {short:[nombres], safe:[nombres], from, to}
  noRoads: false,        // rutas sin Caminos de Avalon
  detailCache: {},       // battleId -> detalle con players[] (en memoria)
  mm: { k: 1, tx: 0, ty: 0 }, // zoom/paneo del minimapa
};

try { WM.selectedMap = localStorage.getItem('wmSelectedMap') || null; } catch(e){}
try { WM.mapFilter = localStorage.getItem('wmMapFilter') || 'all'; } catch(e){}
try { WM.noRoads = localStorage.getItem('wmNoRoads') === '1'; } catch(e){}
if (!['all','city','royal','outlands','outlands78','roads'].includes(WM.mapFilter)) WM.mapFilter = 'all';
function wmSaveSelected(){
  try { if (WM.selectedMap) localStorage.setItem('wmSelectedMap', WM.selectedMap); } catch(e){}
}

/* ---- helpers de parseo de guildmatches / events ---- */
function wmGuildIdOf(g) {
  if (!g || typeof g !== 'object') return '';
  return String(g.Id || g.id || g.GuildId || g.AllianceId || '');
}
function wmGuildNameOf(g) {
  if (!g) return '';
  if (typeof g === 'string') return g;
  return String(g.Name || g.name || g.AllianceName || '');
}
function wmIsSG(g, gid) {
  const id = wmGuildIdOf(g);
  if (gid && id && id === gid) return true;
  return wmGuildNameOf(g).toLowerCase() === SG_GUILD_NAME.toLowerCase();
}
function wmMatchTeams(m) {
  let a = m.attacker || m.Attacker || m.team1 || m.Team1 || m.Team1Guild || m.team1Guild
    || m.guild1 || m.Guild1 || m.AllianceA || m.allianceA
    || (Array.isArray(m.guilds) ? m.guilds[0] : null)
    || (Array.isArray(m.Guilds) ? m.Guilds[0] : null) || null;
  let b = m.defender || m.Defender || m.team2 || m.Team2 || m.Team2Guild || m.team2Guild
    || m.guild2 || m.Guild2 || m.AllianceB || m.allianceB
    || (Array.isArray(m.guilds) ? m.guilds[1] : null)
    || (Array.isArray(m.Guilds) ? m.Guilds[1] : null) || null;
  if (!a && (m.attackerId || m.AttackerId || m.attackerName || m.AttackerName)) {
    a = { Id: m.attackerId || m.AttackerId, Name: m.attackerName || m.AttackerName };
  }
  if (!b && (m.defenderId || m.DefenderId || m.defenderName || m.DefenderName)) {
    b = { Id: m.defenderId || m.DefenderId, Name: m.defenderName || m.DefenderName };
  }
  return { a, b };
}
function wmMatchWinner(m) {
  const direct = m.winner || m.Winner || m.winningGuild || m.WinningGuild
    || m.TerritoryChangedOwner || m.territoryChangedOwner || null;
  if (direct) return direct;
  const { a, b } = wmMatchTeams(m);
  const w = m.winnerTeam || m.WinnerTeam || m.winnerSide || m.WinnerSide;
  if (w === 1 || w === '1' || w === 'team1' || w === 'attacker') return a;
  if (w === 2 || w === '2' || w === 'team2' || w === 'defender') return b;
  if (m.attackerWins === true || m.AttackerWins === true) return a;
  if (m.attackerWins === false || m.AttackerWins === false) return b;
  return null;
}
function wmTerritoryName(m) {
  const t = m.territory || m.Territory;
  if (t && typeof t === 'object') return t.Name || t.name || t.MapName || '';
  return t || m.TerritoryName || m.territoryName
    || m.MapName || m.mapName || m.Location || m.location
    || m.MatchType || m.matchType || '';
}
function wmMatchTime(m) {
  const raw = m.startTime || m.StartTime || m.StartTimeStamp || m.startTimeStamp
    || m.time || m.Time || m.timestamp || m.Timestamp
    || m.endTime || m.EndTime || null;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
function wmMatchInvolvesSG(m, gid) {
  const { a, b } = wmMatchTeams(m);
  if (wmIsSG(a, gid) || wmIsSG(b, gid)) return true;
  const w = wmMatchWinner(m);
  if (wmIsSG(w, gid)) return true;
  const flat = [m.attackerId, m.defenderId, m.AttackerId, m.DefenderId,
    m.guildId, m.GuildId, m.guild1Id, m.guild2Id].filter(Boolean).map(String);
  if (gid && flat.includes(String(gid))) return true;
  const names = [m.attackerName, m.defenderName, m.AttackerName, m.DefenderName,
    m.guildName, m.GuildName].filter(Boolean).map(s => String(s).toLowerCase());
  return names.includes(SG_GUILD_NAME.toLowerCase());
}
function wmOpponentOf(m, gid) {
  const { a, b } = wmMatchTeams(m);
  if (wmIsSG(a, gid)) return b;
  if (wmIsSG(b, gid)) return a;
  const w = wmMatchWinner(m);
  if (wmIsSG(w, gid)) {
    if (a && !wmIsSG(a, gid)) return a;
    if (b && !wmIsSG(b, gid)) return b;
  }
  return a || b || null;
}

function wmBuildTerritories(past, upcoming, gid) {
  const byName = new Map();
  const sorted = [...past].sort((x, y) => {
    const tx = wmMatchTime(x)?.getTime() || 0;
    const ty = wmMatchTime(y)?.getTime() || 0;
    return ty - tx;
  });
  for (const m of sorted) {
    if (!wmMatchInvolvesSG(m, gid)) continue;
    const name = wmTerritoryName(m);
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    const winner = wmMatchWinner(m);
    let ownedFinal = wmIsSG(winner, gid);
    if (winner == null) {
      const { b } = wmMatchTeams(m);
      ownedFinal = wmIsSG(b, gid);
    }
    const when = wmMatchTime(m);
    byName.set(key, {
      name,
      owned: ownedFinal,
      lastMatch: m,
      lastAt: when,
      opponent: wmGuildNameOf(wmOpponentOf(m, gid)) || '—',
      matchId: m.id || m.MatchId || m.matchId || null,
    });
  }
  for (const m of upcoming) {
    if (!wmMatchInvolvesSG(m, gid)) continue;
    const name = wmTerritoryName(m);
    if (!name) continue;
    const key = name.toLowerCase();
    const when = wmMatchTime(m);
    const opp = wmGuildNameOf(wmOpponentOf(m, gid)) || '—';
    if (byName.has(key)) {
      const t = byName.get(key);
      t.threatened = true;
      t.nextAt = when;
      t.nextOpponent = opp;
      t.nextMatch = m;
    } else {
      const { a, b } = wmMatchTeams(m);
      const defending = wmIsSG(b, gid);
      const attacking = wmIsSG(a, gid);
      byName.set(key, {
        name,
        owned: defending,
        contested: attacking && !defending,
        threatened: true,
        lastMatch: null, lastAt: null, opponent: opp,
        nextAt: when, nextOpponent: opp, nextMatch: m,
        matchId: m.id || m.MatchId || m.matchId || null,
      });
    }
  }
  return [...byName.values()].sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    if (!!a.threatened !== !!b.threatened) return a.threatened ? -1 : 1;
    return a.name.localeCompare(b.name, 'es');
  });
}

function wmProcessEnemies(events, past, gid) {
  const enemies = {};
  const bump = (name, when, kind) => {
    if (!name || name.toLowerCase() === SG_GUILD_NAME.toLowerCase()) return;
    if (!enemies[name]) enemies[name] = { name, kills: 0, gvg: 0, lastAt: null };
    if (kind === 'kill') enemies[name].kills++;
    else enemies[name].gvg++;
    if (when && (!enemies[name].lastAt || when > enemies[name].lastAt)) {
      enemies[name].lastAt = when;
    }
  };
  for (const ev of events) {
    const victim = ev.Victim || {};
    const killer = ev.Killer || {};
    const vGuild = victim.GuildName || '';
    const kGuild = killer.GuildName || '';
    const when = ev.TimeStamp ? new Date(ev.TimeStamp) : null;
    if (vGuild === SG_GUILD_NAME && kGuild && kGuild !== SG_GUILD_NAME) {
      bump(kGuild, when, 'kill');
    } else if (kGuild === SG_GUILD_NAME && vGuild && vGuild !== SG_GUILD_NAME) {
      bump(vGuild, when, 'kill');
    }
  }
  for (const m of past) {
    if (!wmMatchInvolvesSG(m, gid)) continue;
    const opp = wmOpponentOf(m, gid);
    bump(wmGuildNameOf(opp), wmMatchTime(m), 'gvg');
  }
  return Object.values(enemies).sort((a, b) => {
    const sa = a.kills + a.gvg * 3, sb = b.kills + b.gvg * 3;
    return sb - sa || ((b.lastAt && b.lastAt.getTime()) || 0) - ((a.lastAt && a.lastAt.getTime()) || 0);
  });
}

/* ---- NUEVO: grafo de mapas reales ---- */
async function wmLoadMapGraph(){
  if (WM.mapGraph) return WM.mapGraph;
  if (WM.mapLoading) return null;
  WM.mapLoading = true;
  try {
    const data = await fetchJSON('data/albion_map_connections.json');
    WM.mapGraph = data.byName || data;
    WM.mapGraphById = data.byId || {};
    WM.mapList = data.maps || [];
    // índice de posiciones (mapas con x,y del worldmapposition oficial)
    WM.mapPos = new Map();
    for (const m of WM.mapList) {
      if (typeof m.x === 'number' && typeof m.y === 'number') WM.mapPos.set(m.mapName.toLowerCase(), m);
    }
    // Si había selección guardada (localStorage o ?map= compartido), validarla
    if (WM.selectedMap){
      if (WM.mapGraph[WM.selectedMap]) {
        WM.selectedNeighbors = WM.mapGraph[WM.selectedMap];
        // buscar mapID
        const found = WM.mapList.find(m=>m.mapName===WM.selectedMap);
        if (found) WM.selectedMapID = found.mapID;
      } else {
        // nombre que ya no existe (enlace viejo o dato corrupto): limpiar
        waToast('⚠️ Mapa no encontrado', `«${WM.selectedMap}» no está en el mapa de Albion. Elegí otro.`, 'err', ()=>wmOpenTrackerTab());
        WM.selectedMap = null;
        WM.selectedNeighbors = [];
        WM.selectedMapID = null;
        try { localStorage.removeItem('wmSelectedMap'); } catch(e){}
      }
    }
    WM.mapLoading = false;
    return WM.mapGraph;
  } catch(e){
    WM.mapLoading = false;
    console.warn('No se pudo cargar grafo de mapas', e);
    WM.mapGraph = {};
    WM.mapGraphById = {};
    return null;
  }
}

/* abre SG → Salón de miembros → una subpestaña concreta (para toasts y enlaces) */
function wmOpenRoomTab(id){
  gotoTab('sg', 'members');
  const btn = document.querySelector('[data-room-tab="' + id + '"]');
  if (btn) btn.click();
}
/* abre directo el Mapa de Guerra (territorios / GvG de SG) */
function wmOpenWarTab(){
  wmOpenRoomTab('war');
}
/* abre directo el Tracker por zona real (otro botón, otra herramienta) */
function wmOpenTrackerTab(){
  wmOpenRoomTab('tracker');
}

/* mantiene ?map= en la URL para compartir la vigilancia de una zona */
function wmShareURL(name){
  try {
    const u = new URL(location.href);
    if (name) u.searchParams.set('map', name);
    else u.searchParams.delete('map');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch(e){}
}

function wmSelectMap(name){
  if (!name) return;
  WM.selectedMap = name;
  WM.selectedNeighbors = (WM.mapGraph && WM.mapGraph[name]) ? WM.mapGraph[name] : [];
  const found = WM.mapList.find(m=>m.mapName===name);
  WM.selectedMapID = found ? found.mapID : null;
  wmSaveSelected();
  wmShareURL(name);
  const inp = document.getElementById('wmMapSearch');
  if (inp && inp.value !== name) inp.value = name;
  wmRenderContent();
  wmRenderSelInfo();
  wmRenderMinimap();
  // auto cargar tracker
  wmLoadTracker(true);
}

/* filtro por tipo de mapa (chips): reduce ruido al buscar o mirar el minimapa */
const WM_MAP_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'city', label: 'Ciudades y hubs' },
  { id: 'royal', label: 'Royals' },
  { id: 'outlands', label: 'Zona Negra' },
  { id: 'outlands78', label: 'Negra T7–T8' },
  { id: 'roads', label: 'Caminos de Avalon' },
];
function wmMapMatches(m){
  switch (WM.mapFilter) {
    case 'city': return m.mapType === 'royal';
    case 'royal': return m.mapType === 'royalBlue' || m.mapType === 'royalYellow' || m.mapType === 'royalRed';
    case 'outlands': return m.mapType === 'outlands';
    case 'outlands78': return m.mapType === 'outlands' && (m.tier || 0) >= 7;
    case 'roads': return m.mapType === 'roads';
    default: return true;
  }
}
const WM_TYPE_ES = { royal: 'ciudad/hub', royalBlue: 'royal azul', royalYellow: 'royal amarilla', royalRed: 'royal roja', outlands: 'Zona Negra', roads: 'Camino de Avalon', other: 'especial' };

function wmMapSearch(q){
  WM.mapSearchQuery = q;
  if (!q || q.length < 2 || !WM.mapList.length){
    WM.mapSearchResults = [];
    return [];
  }
  const low = q.toLowerCase();
  const hits = WM.mapList.filter(m=>{
    if (!wmMapMatches(m)) return false;
    return m.mapName.toLowerCase().includes(low) || (m.mapID && m.mapID.toLowerCase().includes(low));
  }).slice(0, 30);
  WM.mapSearchResults = hits;
  return hits;
}

/* ---- NUEVO: tracker de enemigos por zona real ---- */
/* Caché compartida de batallas + kills: la usan el tracker, el minimapa, el
   scoring de peligro, las rutas y las alertas por zona. Se persiste en
   localStorage (5 min) para no quemar el rate limit del killboard (muy 502).

   ══ PROVEEDORES DE DATOS (2026-09) ═══════════════════════════════════════
   El feed oficial (gameinfo /battles?limit=51) era la única fuente: solo las
   últimas 51 batallas del servidor por página y sin kills sueltos (una «batalla»
   exige ≥3 kills; un asesinato en solitario jamás aparece). Ahora se consultan TRES
   fuentes y se cruzan:
     1 · Killboard oficial — /battles paginado (3×51): batallas recientes del servidor.
     2 · Killboard oficial — /events paginado (5×51): asesinatos CRUDOS con
         Victim.ZoneName; captura kills sueltos y lo último de los últimos
         minutos. Es lo que mantiene el dato «al día» de verdad.
     3 · Murderledger (murderledger.albiononline2d.com, AlbionOnline2D):
         mantiene su propia base con sync cada ~5 min. No expone zona por
         evento, pero su last_update + kill más reciente sirven de testigo:
         si el killboard oficial está atrasado (pasa seguido: 502, caché),
         Murderledger lo delata y avisamos al usuario.
   KillBoard#1 (killboard-1.com) también sincroniza cada ~5 min pero no expone
   API pública: se usa como enlace externo de verificación en cada kill.     */
const PV_BATTLE_LIMIT = 51;   // gameinfo rechaza cualquier limit superior a 51
const PV_BATTLE_PAGES = 3;     // 3 páginas × 51 batallas; reduce carga y evita 400/limit
const PV_EVENT_PAGES = 5;    // 5 páginas × 51 kills ≈ las últimas horas de asesinatos
const PV_CACHE_KEY = 'wmTrackerCacheV2';

function wmSlimBattle(b){
  const g = b.guilds || b.Guilds || {};
  let guilds = null;
  if (Array.isArray(g)) guilds = g.map(x=>({ name: x.name||x.Name||'', kills: x.kills||x.Kills||0, deaths: x.deaths||x.Deaths||0, fame: x.fame||x.Fame||0 }));
  else if (typeof g === 'object' && g) { guilds = {}; for (const k of Object.keys(g)) { const x = g[k]; guilds[k] = { name: x.name||x.Name||k, kills: x.kills||x.Kills||0, deaths: x.deaths||x.Deaths||0, fame: x.fame||x.Fame||0 }; } }
  return {
    id: b.id ?? b.Id ?? null,
    startTime: b.startTime ?? b.StartTime ?? null,
    clusterName: b.clusterName ?? b.ClusterName ?? b.location ?? '',
    totalKills: b.totalKills ?? b.TotalKills ?? b.kills ?? 0,
    totalFame: b.totalFame ?? b.TotalFame ?? b.fame ?? 0,
    totalPlayers: b.totalPlayers ?? b.TotalPlayers ?? 0,
    guilds,
  };
}
/* timestamp de un campo de fecha cualquiera (ISO o epoch); 0 si no se entiende */
function pvTimeOf(t){
  const d = t ? new Date(t).getTime() : NaN;
  return isFinite(d) && d > 0 ? d : 0;
}

/* asesinato crudo de /events → formato compacto (cacheable y pinteable) */
function pvSlimEvent(ev){
  const v = ev.Victim || ev.victim || {};
  const k = ev.Killer || ev.killer || {};
  return {
    id: ev.EventId ?? ev.eventId ?? ev.id ?? null,
    ts: ev.TimeStamp ?? ev.timeStamp ?? ev.Time ?? null,
    zone: v.ZoneName ?? v.zoneName ?? ev.ZoneName ?? '',
    v: v.Name ?? v.name ?? '',
    vg: v.GuildName ?? v.guildName ?? '',
    k: k.Name ?? k.name ?? '',
    kg: k.GuildName ?? k.guildName ?? '',
    f: ev.TotalVictimKillFame ?? ev.totalVictimKillFame ?? 0,
    ip: Math.round(v.AverageItemPower ?? v.averageItemPower ?? 0),
    bid: ev.BattleId ?? ev.battleId ?? 0,
  };
}

/* pagina /battles del killboard oficial (dedupe por id, tolera páginas 502) */
async function pvFetchBattlePages(pages = PV_BATTLE_PAGES){
  const jobs = [];
  for (let p = 0; p < pages; p++) {
    jobs.push(pfFetchRetry('/battles?limit=' + PV_BATTLE_LIMIT + '&offset=' + (p * PV_BATTLE_LIMIT) + '&sort=recent', 2).catch(() => null));
  }
  const res = await Promise.all(jobs);
  const byId = new Map();
  let okPages = 0;
  for (const raw of res){
    if (raw == null) continue;
    okPages++;
    for (const b of pfAsArray(raw)) {
      const id = String(b.id ?? b.Id ?? '');
      if (id && !byId.has(id)) byId.set(id, b);
    }
  }
  const list = [...byId.values()].sort((a, b) =>
    pvTimeOf(b.startTime ?? b.StartTime) - pvTimeOf(a.startTime ?? a.StartTime));
  return { list, okPages, pages };
}

/* pagina /events del killboard oficial: asesinatos crudos con zona. Sin esto,
   los kills sueltos (la mayoría) jamás entrarían al tracker. */
async function pvFetchEventPages(pages = PV_EVENT_PAGES){
  const jobs = [];
  for (let p = 0; p < pages; p++) {
    jobs.push(pfFetchRetry('/events?limit=51&offset=' + (p * 51) + '&sort=recent', 2).catch(() => null));
  }
  const res = await Promise.all(jobs);
  const byId = new Map();
  let okPages = 0;
  for (const raw of res){
    if (raw == null) continue;
    okPages++;
    for (const ev of pfAsArray(raw)) {
      const id = String(ev.EventId ?? ev.eventId ?? ev.id ?? '');
      if (id && !byId.has(id)) byId.set(id, pvSlimEvent(ev));
    }
  }
  const list = [...byId.values()].sort((a, b) => pvTimeOf(b.ts) - pvTimeOf(a.ts));
  return { list, okPages, pages };
}

/* Murderledger vive en AlbionOnline2D (mismo operador): /murderledger/* lo
   sirven el server.py local y el Worker (murderledger.albiononline2d.com/api).
   Devuelve el dashboard de kills: last_update + kills destacadas con época. */
async function mlFetch(path){
  const local = await fetch('/murderledger' + path).catch(() => null);
  if (local && local.ok) { try { return await local.json(); } catch(e){} }
  if (WORKER_URL) {
    const w = await fetch(WORKER_URL + '/murderledger' + path).catch(() => null);
    if (w && w.ok) { try { return await w.json(); } catch(e){} }
  }
  throw new Error('murderledger ' + (local ? 'HTTP ' + local.status : 'sin conexión'));
}

async function pvFetchMurderledger(){
  try {
    const d = await mlFetch('/home');
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('respuesta vacía');
    if (!d.last_update && !d.juicy_kills && !d.high_rank_cds) throw new Error('respuesta sin datos');
    const kills = [...(d.juicy_kills || []), ...(d.high_rank_cds || []), ...(d.streamed_fights || [])];
    let newest = 0;
    for (const k of kills) { const t = (k.time || 0) * 1000; if (t > newest) newest = t; }
    return { ok: true, count: kills.length, newest, lastUpdate: d.last_update ? new Date(d.last_update).getTime() : 0 };
  } catch (e) {
    return { ok: false, count: 0, newest: 0, lastUpdate: 0, error: e && e.message ? e.message : String(e) };
  }
}

/* trae batallas + kills + testigo Murderledger (en paralelo), con caché.
   opts: { pages, eventPages, light } — light = ciclo de alertas (1 página de
   cada cosa, sin Murderledger, para no martillar el killboard). */
async function wmFetchBattles(maxAgeMs = 5 * 60e3, opts = {}){
  const force = !(maxAgeMs > 0);
  if (!force && WM.battles.length && WM.battlesAt && Date.now() - WM.battlesAt < maxAgeMs) return WM.battles;
  if (!force) {
    // caché de sesión anterior (localStorage), aún fresca
    try {
      const c = JSON.parse(localStorage.getItem(PV_CACHE_KEY) || 'null');
      if (c && c.v === 2 && Array.isArray(c.battles) && c.battles.length && Date.now() - c.at < maxAgeMs) {
        WM.battles = c.battles; WM.battlesAt = c.at;
        WM.kills = Array.isArray(c.kills) ? c.kills : []; WM.killsAt = c.at;
        WM.providers = c.providers || null;
        wmBuildZoneDanger();
        return WM.battles;
      }
    } catch(e){}
  }
  const pages = opts.pages || (opts.light ? 1 : PV_BATTLE_PAGES);
  const eventPages = opts.eventPages || (opts.light ? 1 : PV_EVENT_PAGES);
  const [bp, ep, ml] = await Promise.all([
    pvFetchBattlePages(pages),
    pvFetchEventPages(eventPages),
    opts.light ? Promise.resolve(null) : pvFetchMurderledger(),
  ]);
  if (!bp.okPages) {
    // sin ninguna página de batallas el tracker queda ciego: avisar
    throw new Error('killboard oficial sin respuesta (battles)');
  }
  WM.battles = bp.list;
  WM.battlesAt = Date.now();
  if (ep.okPages) { WM.kills = ep.list; WM.killsAt = WM.battlesAt; }
  else if (!WM.kills.length) { WM.kills = []; WM.killsAt = 0; }
  WM.providers = {
    battles: { ok: true, count: bp.list.length, pages: bp.okPages + '/' + bp.pages,
               newest: bp.list.length ? pvTimeOf(bp.list[0].startTime ?? bp.list[0].StartTime) : 0 },
    events: { ok: ep.okPages > 0, count: ep.list.length, pages: ep.okPages + '/' + ep.pages,
              newest: ep.list.length ? pvTimeOf(ep.list[0].ts) : 0 },
    murderledger: ml ? { ok: ml.ok, count: ml.count, newest: ml.newest, lastUpdate: ml.lastUpdate }
                     : (WM.providers && WM.providers.murderledger) || { ok: false, count: 0, newest: 0, lastUpdate: 0 },
  };
  try {
    localStorage.setItem(PV_CACHE_KEY, JSON.stringify({
      v: 2, at: WM.battlesAt,
      battles: WM.battles.map(wmSlimBattle),
      kills: WM.kills.slice(0, 300),
      providers: WM.providers,
    }));
    // la clave vieja queda obsoleta: limpiar para no duplicar espacio
    localStorage.removeItem('wmBattlesCache');
  } catch(e){}
  wmBuildZoneDanger();
  return WM.battles;
}

/* ---- scoring de peligro por zona ----
   danger = Σ (kills·1 + fama/1000) · decaimiento(Δt) por batalla, más
   Σ (0.5 + fama/20000) · decaimiento(Δt) por asesinato crudo de /events.
   Decaimiento exponencial con vida media de 2 h. Umbrales orientativos. */
// El feed es parcial: un score bajo nunca demuestra que un mapa sea seguro.
const WM_DANGER_UNKNOWN = { max: 4, key: 'unknown', emoji: '⚪', label: 'No hay datus suficientes', cls: 'wm-dg-unknown' };
const WM_DANGER_LEVELS = [
  WM_DANGER_UNKNOWN,
  { max: 20, key: 'warm', emoji: '🟡', label: 'activo', cls: 'wm-dg-warm' },
  { max: Infinity, key: 'hot', emoji: '🔴', label: 'muy caliente', cls: 'wm-dg-hot' },
];
function wmDangerDecay(when, now = Date.now()){
  const t = when ? new Date(when).getTime() : NaN;
  if (!isFinite(t)) return 0;
  const h = Math.max(0, (now - t) / 36e5);
  return Math.pow(0.5, h / 2);
}
function wmBuildZoneDanger(){
  const now = Date.now();
  const map = {};
  const entry = zone => map[zone] || (map[zone] = { zone, score: 0, battles2h: 0, kills: 0, fame: 0, count: 0, lastAt: 0, evKills: 0, evFame: 0, lastKillAt: 0 });
  for (const b of WM.battles) {
    const zone = String(b.clusterName ?? b.ClusterName ?? '').toLowerCase();
    if (!zone) continue;
    const kills = b.totalKills ?? b.TotalKills ?? 0;
    const fame = b.totalFame ?? b.TotalFame ?? 0;
    const t = b.startTime ?? b.StartTime ?? null;
    const ts = t ? new Date(t).getTime() : 0;
    if (!Number.isFinite(ts) || ts <= 0 || ts > now) continue;
    const d = entry(zone);
    d.score += (kills + fame / 1000) * wmDangerDecay(t, now);
    d.kills += kills; d.fame += fame; d.count++;
    if (ts && now - ts < 2 * 36e5) d.battles2h++;
    if (ts > d.lastAt) d.lastAt = ts;
  }
  /* asesinatos crudos de /events: llenan el vacío de las batallas (kills
     sueltos, escaramuzas chicas) y anclan la actividad real a la zona */
  for (const k of WM.kills) {
    const zone = String(k.zone || '').toLowerCase();
    if (!zone) continue;
    const ts = k.ts ? new Date(k.ts).getTime() : 0;
    if (!Number.isFinite(ts) || ts <= 0 || ts > now) continue;
    const d = entry(zone);
    d.score += (0.5 + (k.f || 0) / 20000) * wmDangerDecay(k.ts, now);
    d.evKills++;
    d.evFame += k.f || 0;
    if (ts > d.lastKillAt) d.lastKillAt = ts;
    if (ts > d.lastAt) d.lastAt = ts;
  }
  WM.zoneDanger = map;
  return map;
}
function wmDangerLevel(score){
  if (!Number.isFinite(score) || score < 0) return WM_DANGER_UNKNOWN;
  return WM_DANGER_LEVELS.find(l => score <= l.max) || WM_DANGER_LEVELS[WM_DANGER_LEVELS.length - 1];
}
function wmZoneDanger(zone){
  return WM.zoneDanger[String(zone || '').toLowerCase()] || { zone: String(zone||'').toLowerCase(), score: 0, battles2h: 0, kills: 0, fame: 0, count: 0, lastAt: 0, evKills: 0, evFame: 0, lastKillAt: 0 };
}
// Solo se describe actividad si hay evidencia localizada en las últimas 2 h.
// Es una ventana de observación, no una garantía de cobertura ni seguridad.
function wmZoneDangerLevel(zone, now = Date.now()){
  const d = wmZoneDanger(zone);
  if (!Number.isFinite(d.lastAt) || d.lastAt <= 0 || d.lastAt > now || now - d.lastAt >= 2 * 36e5) return WM_DANGER_UNKNOWN;
  return wmDangerLevel(d.score);
}
function wmRouteDangerLevel(path){
  if (!path.length || path.some(z => wmZoneDangerLevel(z).key === 'unknown')) return WM_DANGER_UNKNOWN;
  return wmDangerLevel(wmRouteDanger(path) / Math.max(1, path.length - 1));
}
function wmDangerBadge(zone){
  const d = wmZoneDanger(zone);
  const lv = wmZoneDangerLevel(zone);
  return `<span class="wm-dg-badge ${lv.cls}" title="Peligro ${lv.label} · score ${d.score.toFixed(1)} · ${d.battles2h} batalla(s) en 2 h">${lv.emoji}</span>`;
}

/* ---- ranking de actividad por zona (ordenado por cantidad de kills) ----
   Es la respuesta a «¿dónde está más caliente cerca de mi mapa?»: kills de
   /events si el proveedor respondió, y si no, los kills agregados de las
   batallas (fuente degradada, menos fina). Desempate por fama. */
function wmZoneRanking(zones){
  const evOk = !!(WM.providers && WM.providers.events && WM.providers.events.ok);
  const rows = (zones || []).map(z => {
    const d = wmZoneDanger(z);
    const kills = evOk ? (d.evKills || 0) : (d.kills || 0);
    return {
      zone: z,
      kills,
      evKills: d.evKills || 0,
      battles: d.count || 0,
      battleKills: d.kills || 0,
      fame: evOk ? (d.evFame || 0) : (d.fame || 0),
      lastAt: Math.max(d.lastKillAt || 0, d.lastAt || 0),
      score: d.score,
      evOk,
    };
  });
  rows.sort((a, b) => b.kills - a.kills || b.fame - a.fame || b.battles - a.battles);
  return rows;
}

/* ---- panel de proveedores: qué respondió cada fuente y qué tan al día ---- */
function wmAgeMin(ts){
  if (!ts) return null;
  return Math.max(0, (Date.now() - ts) / 60e3);
}
function wmAgoText(ts){
  const m = wmAgeMin(ts);
  if (m == null) return 'sin datos';
  if (m < 1) return 'ahora mismo';
  if (m < 90) return 'hace ' + Math.round(m) + ' min';
  return 'hace ' + (m / 60).toFixed(1) + ' h';
}
function wmProviderRow(emoji, nameHTML, ok, detail, newestTs, title){
  const age = newestTs ? wmAgoText(newestTs) : null;
  const stale = newestTs && wmAgeMin(newestTs) > 15;
  return `<div class="wm-prov-row${ok ? '' : ' wm-prov-err'}" title="${title || ''}">
    <span class="wm-prov-name">${emoji} ${nameHTML}</span>
    <span class="muted micro">${ok ? detail : 'sin respuesta'}</span>
    <span class="wm-prov-age${stale ? ' wm-prov-stale' : ''}">${ok && age ? 'último dato: ' + age : '—'}</span>
  </div>`;
}
/* URLs oficiales de cada proveedor: el nombre de la fila es un link para que
   el usuario pueda contrastar el dato o explorar la fuente a gusto. */
const WM_PROVIDER_URLS = {
  battles: 'https://albiononline.com/killboard/battles',
  kills: 'https://albiononline.com/killboard/',
  murderledger: 'https://murderledger.albiononline2d.com/',
  ao2d: 'https://albiononline2d.com/',
};
function wmProvLink(url, text){
  return `<a href="${url}" target="_blank" rel="noopener" class="wm-prov-link" title="Abrir ${text} en una pestaña nueva ↗">${text}</a>`;
}
function wmProvidersHTML(){
  const p = WM.providers;
  if (!p) return '';
  const rows = [];
  rows.push(wmProviderRow('🏛', wmProvLink(WM_PROVIDER_URLS.battles, 'Killboard oficial · batallas'), p.battles.ok,
    p.battles.count + ' batallas (' + p.battles.pages + ' páginas)', p.battles.newest,
    'Batallas agregadas del killboard oficial (gameinfo /battles, paginado). Una «batalla» exige ≥3 kills.'));
  rows.push(wmProviderRow('💀', wmProvLink(WM_PROVIDER_URLS.kills, 'Killboard oficial · asesinatos'), p.events.ok,
    p.events.count + ' kills (' + p.events.pages + ' páginas)', p.events.newest,
    'Asesinatos crudos (gameinfo /events): incluyen kills en solitario y lo último de los últimos minutos.'));
  rows.push(wmProviderRow('🗡', wmProvLink(WM_PROVIDER_URLS.murderledger, 'Murderledger') + ' · ' + wmProvLink(WM_PROVIDER_URLS.ao2d, 'AlbionOnline2D'), p.murderledger.ok,
    p.murderledger.ok ? p.murderledger.count + ' kills destacadas' : 'sin respuesta',
    p.murderledger.newest || p.murderledger.lastUpdate,
    'Base propia de Murderledger (sincroniza cada ~5 min). Sirve de testigo: si tiene datos más frescos que el oficial, el API del juego está atrasada.'));
  /* veredicto de frescura global */
  const newest = Math.max(p.battles.newest || 0, p.events.newest || 0, p.murderledger.newest || 0);
  const offNewest = Math.max(p.battles.newest || 0, p.events.newest || 0);
  let verdict = '';
  if (!newest) {
    verdict = '<div class="wm-prov-verdict wm-prov-warn">⚠️ Ningún proveedor trajo datos con fecha. Reintentá en unos segundos.</div>';
  } else {
    const age = wmAgeMin(newest);
    if (age <= 10) verdict = `<div class="wm-prov-verdict">✅ Datos al día: lo último registrado fue ${wmAgoText(newest)}.</div>`;
    else if (age <= 30) verdict = `<div class="wm-prov-verdict wm-prov-warn">🟡 Datos algo demorados: lo último registrado fue ${wmAgoText(newest)}.</div>`;
    else verdict = `<div class="wm-prov-verdict wm-prov-bad">🔴 Proveedores con datos de ${wmAgoText(newest)}: la API del juego suele atrasarse en horas pico; los números son reales pero pueden faltar los kills más recientes.</div>`;
    /* testigo Murderledger: si su kill más nuevo es >5 min más fresco que todo
       lo oficial, el atraso es del API del juego y no de nuestra lectura */
    if (p.murderledger.ok && p.murderledger.newest && offNewest && p.murderledger.newest - offNewest > 5 * 60e3) {
      verdict += '<div class="wm-prov-verdict wm-prov-warn">↪ Murderledger ya registró kills más recientes que el killboard oficial: el feed oficial viene atrasado (se normaliza solo).</div>';
    }
  }
  return `
    <div class="wm-section wm-providers">
      <div class="cd-title"><svg class="title-ico"><use href="#i-bolt"/></svg> Fuentes de datos <span class="muted micro">(se consultan en paralelo y se cruzan)</span></div>
      ${rows.join('')}
      ${verdict}
    </div>`;
}

async function wmLoadTracker(force){
  if (!WM.selectedMap) return;
  /* el panel del tracker no está montado (p. ej. ?map= al arrancar): no gastar el killboard */
  if (!document.getElementById('wmTrackerContent')) return;
  if (WM.tracker.loading) return;
  if (!force && WM.tracker.lastUpdate && WM.tracker.filtered && WM.tracker.filtered.length) { wmRenderTracker(); return; }
  WM.tracker.loading = true;
  WM.tracker.error = null;
  const box = document.getElementById('wmTrackerContent');
  if (box) box.innerHTML = '<div class="loading-cell">Rastreando asesinatos en ' + sgEsc(WM.selectedMap) + ' + conexiones… (killboard oficial + Murderledger)</div>';
  const btn = document.getElementById('wmTrackerBtn');
  if (btn) btn.disabled = true;
  const zones = [WM.selectedMap, ...WM.selectedNeighbors];
  const zoneSet = new Set(zones.map(z=>String(z).toLowerCase()));
  try {
    /* FLUJO: conexiones del grafo → batallas (paginadas) + asesinatos crudos
       (/events) + testigo de frescura Murderledger, todo en paralelo; después
       se filtra por zona objetivo y se rankea la actividad por cantidad de
       kills (mapa elegido + conectados). */
    const battles = await wmFetchBattles(force ? 0 : 5 * 60e3);
    // 1 · batallas en las zonas objetivo
    const filtered = battles.filter(b=>{
      const cn = (b.clusterName || b.ClusterName || b.location || '').toString();
      if (!cn) return false;
      return zoneSet.has(cn.toLowerCase());
    });
    // 2 · asesinatos crudos en las zonas objetivo (incluye kills sueltos)
    const kills = WM.kills.filter(k=>zoneSet.has(String(k.zone || '').toLowerCase()));
    // Enriquecer con guilds participantes
    const guildStats = {};
    let totalFame = 0, totalKills = 0;
    for (const b of filtered){
      totalFame += b.totalFame || b.TotalFame || 0;
      totalKills += b.totalKills || b.TotalKills || b.kills || 0;
      // top guilds o guilds
      const gs = b.guilds || b.Guilds || {};
      // guilds puede ser objeto {guildId: {name, kills, deaths, ...}} o array
      if (Array.isArray(gs)){
        for (const g of gs){
          const gname = g.name || g.Name || g.guildName || '—';
          if (!guildStats[gname]) guildStats[gname] = { name:gname, battles:0, kills:0, deaths:0, fame:0, lastAt:null };
          guildStats[gname].battles++;
          guildStats[gname].kills += g.kills||g.Kills||0;
          guildStats[gname].deaths += g.deaths||g.Deaths||0;
          guildStats[gname].fame += g.fame||g.Fame||0;
          const t = b.startTime ? new Date(b.startTime) : null;
          if (t && (!guildStats[gname].lastAt || t>guildStats[gname].lastAt)) guildStats[gname].lastAt = t;
        }
      } else if (typeof gs === 'object'){
        for (const gid of Object.keys(gs)){
          const g = gs[gid];
          const gname = g.name || g.Name || gid;
          if (!guildStats[gname]) guildStats[gname] = { name:gname, battles:0, kills:0, deaths:0, fame:0, lastAt:null };
          guildStats[gname].battles++;
          guildStats[gname].kills += g.kills||g.Kills||0;
          guildStats[gname].deaths += g.deaths||g.Deaths||0;
          guildStats[gname].fame += g.fame||g.Fame||0;
        }
      }
    }
    const guildsSorted = Object.values(guildStats).sort((a,b)=>b.kills - a.kills || b.battles - a.battles);

    // También intentar cargar events recientes y filtrar por si el proxy agrega location?
    // events no tienen zona, pero mostramos los últimos events de los gremios enemigos detectados
    let events = [];
    try {
      const evRaw = await pfFetchRetry('/events?limit=51&offset=0').catch(()=>null);
      const evs = pfAsArray(evRaw);
      // filtrar events donde killer o victim guild está en guildsSorted (top 10)
      const topGuildNames = new Set(guildsSorted.slice(0,15).map(g=>g.name.toLowerCase()));
      if (topGuildNames.size){
        events = evs.filter(ev=>{
          const kg = (ev.Killer?.GuildName||'').toLowerCase();
          const vg = (ev.Victim?.GuildName||'').toLowerCase();
          return topGuildNames.has(kg) || topGuildNames.has(vg);
        }).slice(0,20);
      }
    } catch(e){}

    WM.tracker.battles = battles; // todos
    WM.tracker.filtered = filtered;
    WM.tracker.kills = kills; // asesinatos crudos en las zonas objetivo
    WM.tracker.killsTotal = WM.kills.length; // en todo el feed traído
    WM.tracker.guilds = guildsSorted;
    WM.tracker.events = events;
    WM.tracker.zones = zones;
    WM.tracker.totalFame = totalFame;
    WM.tracker.totalKills = totalKills;
    WM.tracker.lastUpdate = Date.now();
    WM.tracker.loading = false;
    if (btn) btn.disabled = false;
    wmRenderTracker();
    wmRenderMinimap(); // refrescar puntos rojos con datos nuevos
    wmRenderSelInfo(); // el peligro de la zona cambió con los datos frescos
  } catch(err){
    WM.tracker.loading = false;
    WM.tracker.error = err && err.message ? err.message : String(err);
    if (btn) btn.disabled = false;
    if (box){
      box.innerHTML = '<div class="loading-cell sg-err">No se pudo rastrear: ' + sgEsc(WM.tracker.error) + '</div>';
    }
  }
}

function wmRenderTracker(){
  const box = document.getElementById('wmTrackerContent');
  if (!box) return;
  if (!WM.selectedMap){
    box.innerHTML = '<div class="loading-cell">Elegí un mapa arriba para ver actividad PvP.</div>';
    return;
  }
  const t = WM.tracker;
  if (t.loading){
    box.innerHTML = '<div class="loading-cell">Cargando…</div>';
    return;
  }
  if (t.error){
    box.innerHTML = '<div class="loading-cell sg-err">Error: ' + sgEsc(t.error) + ' <button class="btn micro-btn" id="wmTrackerRetry">Reintentar</button></div>';
    const r = box.querySelector('#wmTrackerRetry');
    if (r) r.onclick = ()=>wmLoadTracker(true);
    return;
  }
  const zones = t.zones || [WM.selectedMap, ...WM.selectedNeighbors];
  const filtered = t.filtered || [];
  const kills = t.kills || [];
  const guilds = t.guilds || [];
  const updated = t.lastUpdate ? new Date(t.lastUpdate).toLocaleTimeString('es-AR') : '—';
  const selDanger = wmZoneDanger(WM.selectedMap);
  const selLv = wmZoneDangerLevel(WM.selectedMap);
  const evOk = !!(WM.providers && WM.providers.events && WM.providers.events.ok);
  const ranking = wmZoneRanking(zones);

  box.innerHTML = `
    <div class="stats wm-stats">
      <div class="stat"><div class="k">Zonas vigiladas</div><div class="v">${zones.length}</div><div class="s">${sgEsc(WM.selectedMap)} + ${WM.selectedNeighbors.length} conexiones</div></div>
      <div class="stat"><div class="k">Asesinatos en la zona</div><div class="v pos">${kills.length}</div><div class="s">de ${t.killsTotal ?? WM.kills.length ?? 0} en el feed · ${evOk ? '/events oficial' : 'feed de kills sin respuesta'}</div></div>
      <div class="stat"><div class="k">Batallas en la zona</div><div class="v pos">${filtered.length}</div><div class="s">de ${t.battles?.length||0} en el servidor</div></div>
      <div class="stat"><div class="k">Peligro de la zona</div><div class="v">${selLv.emoji}</div><div class="s">${selLv.label} · score ${selDanger.score.toFixed(1)} · ${selDanger.battles2h} en 2 h</div></div>
      <div class="stat"><div class="k">Actualizado</div><div class="v" style="font-size:1rem">${updated}</div><div class="s"><button class="btn micro-btn" id="wmTrackerBtnInner">↻ Actualizar</button> <button class="btn micro-btn" id="wmCsvBtn" title="Descargar las batallas filtradas en CSV">⬇ CSV</button> <button class="btn micro-btn" id="wmKillsCsvBtn" title="Descargar los asesinatos filtrados en CSV">⬇ Kills</button></div></div>
    </div>

    ${wmProvidersHTML()}

    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-shield"/></svg> Zonas objetivo</div>
      <div class="chip-group" style="padding:4px 0 8px; flex-wrap:wrap">
        ${zones.map(z=>`<span class="chip ${z===WM.selectedMap?'active':''}" data-wm-zone="${sgEsc(z)}" title="Kills: ${wmZoneDanger(z).evKills} · Batallas (2 h): ${wmZoneDanger(z).battles2h} · score ${wmZoneDanger(z).score.toFixed(1)}">${wmDangerBadge(z)} ${sgEsc(z)}${z===WM.selectedMap?' <b>(sel)</b>':''}</span>`).join('')}
      </div>
      <div class="micro muted">Conexiones según world.xml oficial (ao-bin-dumps). ${WM.selectedNeighbors.length ? 'Mapas fronterizos: ' + WM.selectedNeighbors.map(n=>sgEsc(n)).join(', ') : 'Este mapa no tiene conexiones registradas o es aislado.'}</div>
    </div>

    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-skull"/></svg> Actividad por zona <span class="muted micro">(ordenada por cantidad de asesinatos)</span></div>
      ${ranking.length ? `
      <div class="wm-rank">
        ${ranking.map((r, i)=>{
          const max = Math.max(1, ranking[0].kills);
          const lv = wmZoneDangerLevel(r.zone);
          const isSel = r.zone === WM.selectedMap;
          return `<div class="wm-rank-row${isSel ? ' wm-rank-sel' : ''}" data-wm-goto="${sgEsc(r.zone)}" title="${sgEsc(r.zone)}: ${r.evKills} kill(s) registrados · ${r.battles} batalla(s) · score ${r.score.toFixed(1)}">
            <span class="wm-rank-pos">${i + 1}</span>
            <span class="wm-rank-name">${lv.emoji} <b>${sgEsc(r.zone)}</b>${isSel ? ' <span class="muted micro">(sel)</span>' : ''}</span>
            <span class="wm-rank-bar"><i style="width:${r.kills ? Math.max(6, Math.round(r.kills / max * 100)) : 0}%"></i></span>
            <span class="wm-rank-kills num">${r.kills} kill${r.kills === 1 ? '' : 's'}</span>
            <span class="wm-rank-meta muted micro">${lv.label} · ${r.battles} batalla(s) · ${fmt(r.fame)} fama${r.lastAt ? ' · ' + wmAgoText(r.lastAt) : ''}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="micro muted">Kills = asesinatos registrados en ${evOk ? 'el feed de /events (incluye kills en solitario)' : 'las batallas (el feed de kills no respondió)'} dentro de la ventana traída. Tocá una zona para rastrearla.</div>` : '<div class="loading-cell">Sin zonas para rankear.</div>'}
    </div>

    ${kills.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-sword"/></svg> Asesinatos recientes en la zona (${kills.length})</div>
      <div class="table-wrap"><table class="ledger">
        <thead><tr><th>Hace</th><th>Mapa</th><th>Víctima</th><th>Asesino</th><th class="num">Fama</th><th class="num">IP</th><th></th></tr></thead>
        <tbody>${kills.slice(0,30).map(k=>wmKillRow(k)).join('')}</tbody>
      </table></div>
      <div class="micro muted" style="padding:4px 14px 0">Asesinatos crudos del killboard oficial${evOk ? '' : ' (ojo: el feed respondió a medias)'}. Cada kill trae enlaces a KillBoard#1, AlbionOnline2D y el killboard oficial para confirmar a mano que el dato es real.</div>
    </div>` : `
    <div class="wm-section"><div class="loading-cell">${evOk ? 'Sin asesinatos recientes en estas zonas. Probá otro mapa o tocá Actualizar.' : 'El feed de asesinatos (/events) no respondió: mostrando solo batallas.'}</div></div>`}

    ${filtered.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-sword"/></svg> Batallas en la zona (${filtered.length})</div>
      <div class="table-wrap"><table class="ledger">
        <thead><tr><th>Fecha</th><th>Mapa</th><th class="num">Kills</th><th class="num">Fama</th><th>Gremios</th></tr></thead>
        <tbody>${filtered.slice(0,25).map(b=>wmBattleRow(b)).join('')}</tbody>
      </table></div>
      <div class="micro muted" style="padding:4px 14px 0">Tocá una batalla para ver los participantes (equipo, IP, gremio).</div>
    </div>` : '<div class="wm-section"><div class="loading-cell">Sin batallas recientes en estas zonas (se trajeron ' + (t.battles?.length || 0) + ' batallas del servidor, paginadas). Probá otro mapa o tocá Actualizar.</div></div>'}

    ${guilds.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-skull"/></svg> Gremios activos en la zona (${guilds.length})</div>
      <div class="wm-enemy-list">${guilds.slice(0,15).map(g=>wmEnemyCard({name:g.name, kills:g.kills, deaths:g.deaths, fame:g.fame, gvg:g.battles, lastAt:g.lastAt})).join('')}</div>
      <div class="micro muted">Top por kills en las batallas filtradas, con ratio K/D para ver quién domina la zona. Usalo como tracker de enemigos en tu zona de farmeo/roaming.</div>
    </div>` : ''}

    ${t.events && t.events.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-bolt"/></svg> Kills recientes de esos gremios (${t.events.length})</div>
      <div class="wm-events-list">${t.events.map(e=>wmEventRow(e)).join('')}</div>
    </div>` : ''}

    <div class="micro muted pad">Fuentes cruzadas: killboard oficial (/battles paginado + /events con asesinatos crudos) y Murderledger/AlbionOnline2D como testigo de frescura; KillBoard#1 enlaza cada kill para verificación manual. Zonas objetivo = mapa seleccionado + vecinos según world.xml. El peligro decae a la mitad cada 2 h.</div>
  `;
  const innerBtn = box.querySelector('#wmTrackerBtnInner');
  if (innerBtn) innerBtn.onclick = ()=>wmLoadTracker(true);
  const csvBtn = box.querySelector('#wmCsvBtn');
  if (csvBtn) csvBtn.onclick = ()=>wmExportCSV();
  const killsCsvBtn = box.querySelector('#wmKillsCsvBtn');
  if (killsCsvBtn) killsCsvBtn.onclick = ()=>wmExportKillsCSV();
  // click en chip de zona para cambiar mapa rápido
  box.querySelectorAll('[data-wm-zone]').forEach(ch=>{
    ch.style.cursor='pointer';
    ch.onclick = ()=>{
      wmSelectMap(ch.dataset.wmZone);
    };
  });
}

/* ---- fila de asesinato crudo (feed /events), con enlaces de verificación ---- */
function wmKillLinks(k){
  const links = [];
  if (k.id) links.push(`<a href="https://killboard-1.com/us/event/${encodeURIComponent(k.id)}" target="_blank" rel="noopener" title="Ver en KillBoard#1 (sincroniza cada ~5 min)">KB#1</a>`);
  if (k.id) links.push(`<a href="https://albiononline2d.com/en/scoreboard/events/${encodeURIComponent(k.id)}" target="_blank" rel="noopener" title="Ver en AlbionOnline2D">AO2D</a>`);
  if (k.bid) links.push(`<a href="https://albiononline.com/killboard/battles/${encodeURIComponent(k.bid)}" target="_blank" rel="noopener" title="Ver la batalla en el killboard oficial">Oficial</a>`);
  return links.join(' ');
}
function wmKillRow(k){
  const when = k.ts ? new Date(k.ts) : null;
  return `<tr>
    <td class="muted micro" title="${when ? when.toLocaleString('es-AR') : ''}">${when ? wmTimeAgo(when) : '—'}</td>
    <td><b>${sgEsc(k.zone || '—')}</b></td>
    <td>${sgEsc(k.v || '?')}${k.vg ? ` <span class="muted micro">[${sgEsc(k.vg)}]</span>` : ''}</td>
    <td>${sgEsc(k.k || '?')}${k.kg ? ` <span class="muted micro">[${sgEsc(k.kg)}]</span>` : ''}</td>
    <td class="num pos">${fmt(k.f || 0)}</td>
    <td class="num">${k.ip ? fmt(k.ip) : '—'}</td>
    <td class="micro wm-kill-links">${wmKillLinks(k)}</td>
  </tr>`;
}

/* ---- exportar los asesinatos filtrados a CSV ---- */
function wmExportKillsCSV(){
  const rows = WM.tracker.kills || [];
  if (!rows.length) { waToast('⚠️ Sin datos', 'No hay asesinatos filtrados para exportar. Rastreá una zona primero.', 'err', ()=>wmOpenTrackerTab()); return; }
  const head = ['fecha', 'mapa', 'victima', 'gremio_victima', 'asesino', 'gremio_asesino', 'fama', 'ip_victima', 'id_evento', 'link'].join(';');
  const lines = rows.map(k => [
    k.ts ? new Date(k.ts).toISOString() : '',
    csvCell(k.zone || ''),
    csvCell(k.v || ''),
    csvCell(k.vg || ''),
    csvCell(k.k || ''),
    csvCell(k.kg || ''),
    k.f || 0,
    k.ip || 0,
    csvCell(String(k.id ?? '')),
    csvCell(k.id ? 'https://killboard-1.com/us/event/' + k.id : ''),
  ].join(';'));
  const csv = '\ufeff' + head + '\r\n' + lines.join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const slug = (WM.selectedMap || 'zona').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = 'kills-' + slug + '-' + new Date().toISOString().slice(0,16).replace(/[:T]/g,'') + '.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  waToast('⬇ CSV exportado', rows.length + ' asesinatos de «' + (WM.selectedMap || '') + '» (separador ;).', '', ()=>wmOpenTrackerTab());
}

/* ---- exportar las batallas filtradas a CSV ---- */
function wmExportCSV(){
  const rows = WM.tracker.filtered || [];
  if (!rows.length) { waToast('⚠️ Sin datos', 'No hay batallas filtradas para exportar. Rastreá una zona primero.', 'err', ()=>wmOpenTrackerTab()); return; }
  const head = ['fecha', 'mapa', 'kills', 'fama', 'jugadores', 'gremios', 'id_batalla', 'link'].join(';');
  const lines = rows.map(b => {
    const when = b.startTime ? new Date(b.startTime) : null;
    const guilds = b.guilds || b.Guilds || {};
    let glist = '';
    if (Array.isArray(guilds)) glist = guilds.map(g=>g.name||g.Name||'').filter(Boolean).join(' | ');
    else if (typeof guilds === 'object') glist = Object.values(guilds).map(g=>g.name||g.Name||'').filter(Boolean).join(' | ');
    const bid = b.id ?? b.Id ?? '';
    return [
      when ? when.toISOString() : '',
      csvCell(b.clusterName || b.ClusterName || ''),
      b.totalKills ?? b.TotalKills ?? 0,
      b.totalFame ?? b.TotalFame ?? 0,
      b.totalPlayers ?? b.TotalPlayers ?? 0,
      csvCell(glist),
      csvCell(String(bid)),
      csvCell(bid ? 'https://albiononline.com/killboard/battles/' + bid : ''),
    ].join(';');
  });
  const csv = '\ufeff' + head + '\r\n' + lines.join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const slug = (WM.selectedMap || 'zona').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = 'batallas-' + slug + '-' + new Date().toISOString().slice(0,16).replace(/[:T]/g,'') + '.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  waToast('⬇ CSV exportado', rows.length + ' batallas de «' + (WM.selectedMap || '') + '» (separador ;).', '', ()=>wmOpenTrackerTab());
}

function wmBattleRow(b){
  const when = b.startTime ? new Date(b.startTime) : (b.StartTime ? new Date(b.StartTime) : null);
  const cluster = b.clusterName || b.ClusterName || b.location || '—';
  const kills = b.totalKills || b.TotalKills || b.kills || 0;
  const fame = b.totalFame || b.TotalFame || b.fame || 0;
  const guilds = b.guilds || b.Guilds || {};
  let guildList = '';
  if (Array.isArray(guilds)){
    guildList = guilds.slice(0,4).map(g=>sgEsc(g.name||g.Name)).join(', ');
  } else if (typeof guilds === 'object'){
    guildList = Object.values(guilds).slice(0,4).map(g=>sgEsc(g.name||g.Name||'')).join(', ');
  }
  const bid = b.id || b.Id || b.BattleId;
  const isExpanded = WM.tracker.expandedBattle === String(bid);
  return `<tr class="clickable ${isExpanded?'expanded':''}" data-wm-battle="${bid}">
    <td class="muted micro">${when ? when.toLocaleString('es-AR') : '—'}</td>
    <td><b>${sgEsc(cluster)}</b> ${wmDangerBadge(cluster)}</td>
    <td class="num">${fmt(kills)}</td>
    <td class="num pos">${fmt(fame)}</td>
    <td class="muted micro">${guildList||'—'}</td>
  </tr>` + (isExpanded ? `<tr><td colspan="5">${wmBattleDetailHTML(bid)}</td></tr>` : '');
}

/* ---- detalle de batalla: /battles/{id} trae players[] con equipo, IP y gremio ---- */
async function wmLoadBattleDetail(bid){
  if (!bid || WM.detailCache[bid]) return;
  if (WM.detailLoading && WM.detailLoading[bid]) return;
  WM.detailLoading = WM.detailLoading || {};
  WM.detailLoading[bid] = true;
  try {
    const d = await pfFetchRetry('/battles/' + encodeURIComponent(bid));
    WM.detailCache[bid] = d || null;
  } catch(e){
    WM.detailCache[bid] = { __error: e && e.message ? e.message : String(e) };
  }
  delete WM.detailLoading[bid];
  // repintar solo si sigue expandida
  if (WM.tracker.expandedBattle === String(bid)) wmRenderTracker();
}

function wmWeaponLabel(p){
  const eq = p.Equipment || p.equipment || {};
  const mh = eq.MainHand || eq.mainHand || null;
  if (!mh || !mh.Type && !mh.type) return '—';
  const t = String(mh.Type || mh.type);
  const name = (typeof catalogName === 'function' && CATALOG) ? catalogName(t.split('@')[0]) : t;
  return name === t.split('@')[0] ? t : name; // si el catálogo no lo conoce, mostrar el código
}

function wmBattleDetailHTML(bid){
  const d = WM.detailCache[bid];
  if (!d) return '<div class="micro muted" style="padding:8px 6px">⏳ Cargando participantes de la batalla…</div>';
  if (d.__error) return `<div class="micro muted" style="padding:8px 6px">No se pudo traer el detalle (${sgEsc(d.__error)}). <a href="https://albiononline.com/killboard/battles/${sgEsc(bid)}" target="_blank" rel="noopener">Ver en el killboard oficial</a></div>`;
  let players = d.players || d.Players || [];
  if (!Array.isArray(players) && typeof players === 'object') players = Object.values(players);
  players = players.filter(p => p && (p.Name || p.name));
  players.sort((a,b)=>(b.KillFame||b.killFame||0)-(a.KillFame||a.killFame||0));
  if (!players.length){
    return `<div class="micro muted" style="padding:8px 6px">ID batalla: ${sgEsc(bid)} — el killboard no trajo participantes. <a href="https://albiononline.com/killboard/battles/${sgEsc(bid)}" target="_blank" rel="noopener">Ver en killboard oficial</a></div>`;
  }
  const max = WM.tracker.detailShowAll ? players.length : 40;
  const shown = players.slice(0, max);
  const rows = shown.map(p => {
    const name = p.Name || p.name || '?';
    const guild = p.GuildName || p.guildName || '';
    const ip = p.AverageItemPower || p.averageItemPower;
    const k = p.Kills ?? p.kills ?? 0;
    const dd = p.Deaths ?? p.deaths ?? 0;
    const fame = p.KillFame || p.killFame || 0;
    return `<tr>
      <td><b>${sgEsc(name)}</b></td>
      <td class="muted micro">${guild ? sgEsc(guild) : '—'}</td>
      <td class="num">${ip ? Math.round(ip).toLocaleString('es-AR') : '—'}</td>
      <td class="num">${k}</td>
      <td class="num">${dd}</td>
      <td class="num pos">${fmt(fame)}</td>
      <td class="muted micro">${sgEsc(wmWeaponLabel(p))}</td>
    </tr>`;
  }).join('');
  return `
    <div style="padding:6px 4px 8px">
      <div class="micro muted" style="margin-bottom:6px">
        ${players.length} participantes · IP = poder de equipo promedio · ordenados por fama de kills ·
        <a href="https://albiononline.com/killboard/battles/${sgEsc(bid)}" target="_blank" rel="noopener">abrir en el killboard oficial</a>
      </div>
      <div class="table-wrap"><table class="ledger wm-battle-detail">
        <thead><tr><th>Jugador</th><th>Gremio</th><th class="num">IP</th><th class="num">K</th><th class="num">D</th><th class="num">Fama</th><th>Arma</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${players.length > max ? `<button class="btn micro-btn" data-wm-battle-all="${sgEsc(bid)}" style="margin-top:6px">Ver los ${players.length} participantes</button>` : (WM.tracker.detailShowAll && players.length > 40 ? `<button class="btn micro-btn" data-wm-battle-all="${sgEsc(bid)}" style="margin-top:6px">Colapsar</button>` : '')}
    </div>`;
}

/* ---- panel del tracker: info del mapa, minimapa, rutas y vigilancia ---- */
function wmRenderSelInfo(){
  const box = document.getElementById('wmSelInfo');
  if (!box) return;
  if (!WM.selectedMap){
    box.innerHTML = '<div class="micro muted" style="margin-top:6px">Tip: probá con Martlock (conexiones: Blackthorn Quarry, Eldon Hill, Haytor, Mase Knoll), Caerleon, Thetford o un mapa de Zona Negra.</div>';
    return;
  }
  const m = WM.mapList.find(x=>x.mapName===WM.selectedMap);
  const d = wmZoneDanger(WM.selectedMap);
  const lv = wmZoneDangerLevel(WM.selectedMap);
  const watched = typeof wzHas === 'function' && wzHas(WM.selectedMap);
  box.innerHTML = `
    <div class="wm-sel-info">
      <div class="wm-sel-main">
        <div><b>${sgEsc(WM.selectedMap)}</b> ${wmDangerBadge(WM.selectedMap)}
          <span class="muted micro">${m ? sgEsc(WM_TYPE_ES[m.mapType] || m.mapType) + ' T' + (m.tier ?? '?') : ''}${WM.selectedMapID ? ' · ' + sgEsc(WM.selectedMapID) : ''}</span></div>
        <div class="micro muted">${lv.emoji} ${lv.label} · score ${d.score.toFixed(1)} · ${d.battles2h} batalla(s) en 2 h · ${WM.selectedNeighbors.length} conexiones</div>
        ${wmTerritoryInfoHTML()}
      </div>
      <div class="wm-sel-actions">
        <button class="btn micro-btn" id="wmClearMap">✕ Quitar</button>
        <button class="btn micro-btn primary" id="wmTrackerBtn">🎯 Rastrear</button>
        <button class="btn micro-btn${watched ? ' wm-watch-on' : ''}" id="wmWatchToggle">${watched ? '🔔 Vigilada' : '🔔 Vigilar'}</button>
        <button class="btn micro-btn" id="wmShareBtn" title="Copiar link para compartir esta zona">🔗 Link</button>
      </div>
    </div>`;
  const clearBtn = box.querySelector('#wmClearMap');
  if (clearBtn) clearBtn.onclick = ()=>{
    WM.selectedMap=null; WM.selectedNeighbors=[]; WM.selectedMapID=null;
    try{localStorage.removeItem('wmSelectedMap');}catch(e){}
    wmShareURL(null);
    const inp = document.getElementById('wmMapSearch'); if (inp) inp.value='';
    wmRenderContent(); wmRenderSelInfo(); wmRenderMinimap(); wmRenderTracker();
  };
  const trackBtn = box.querySelector('#wmTrackerBtn');
  if (trackBtn) trackBtn.onclick = ()=>wmLoadTracker(true);
  const watchBtn = box.querySelector('#wmWatchToggle');
  if (watchBtn) watchBtn.onclick = ()=>wzToggle(WM.selectedMap);
  const shareBtn = box.querySelector('#wmShareBtn');
  if (shareBtn) shareBtn.onclick = ()=>wmCopyShareLink();
}

function wmCopyShareLink(){
  if (!WM.selectedMap) return;
  const url = location.origin + location.pathname + '?map=' + encodeURIComponent(WM.selectedMap);
  const done = () => waToast('🔗 Link copiado', 'Compartilo: quien lo abra entra directo a la vigilancia de «' + WM.selectedMap + '».', '', ()=>wmOpenTrackerTab());
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(()=>wmFallbackCopy(url, done));
  } else wmFallbackCopy(url, done);
}
function wmFallbackCopy(text, done){
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  } catch(e){ waToast('🔗 Link de la zona', text, '', ()=>wmOpenTrackerTab()); }
}

/* ---- territorios SG: distancia en saltos desde el mapa seleccionado ---- */
function wmTerritoryDistances(){
  if (!WM.mapGraph || !WM.selectedMap || !WM.territories.length) return null;
  const targets = new Map();
  for (const t of WM.territories) {
    const key = String(t.name || '').toLowerCase();
    if (key && !targets.has(key)) targets.set(key, t);
  }
  if (!targets.size) return null;
  const dist = new Map([[WM.selectedMap, 0]]);
  const queue = [WM.selectedMap];
  let owned = null, rival = null;
  while (queue.length){
    const cur = queue.shift();
    const cd = dist.get(cur);
    if (cd > 14) break;
    const t = targets.get(String(cur).toLowerCase());
    if (t) {
      if (t.owned && !owned) owned = { name: t.name, dist: cd };
      if (!t.owned && !rival) rival = { name: t.name, dist: cd, opponent: t.opponent || '' };
      if (owned && rival) break;
    }
    for (const nb of (WM.mapGraph[cur] || [])) {
      if (!dist.has(nb)) { dist.set(nb, cd + 1); queue.push(nb); }
    }
  }
  return { owned, rival };
}
function wmTerritoryInfoHTML(){
  const r = wmTerritoryDistances();
  if (!r || (!r.owned && !r.rival)) return '';
  const parts = [];
  if (r.owned) parts.push(`🛡 Tu territorio más cercano: <button class="wm-linklike" data-wm-goto="${sgEsc(r.owned.name)}"><b>${sgEsc(r.owned.name)}</b></button> a ${r.owned.dist} salto${r.owned.dist === 1 ? '' : 's'}`);
  if (r.rival) parts.push(`⚔️ Rival más cercano: <button class="wm-linklike" data-wm-goto="${sgEsc(r.rival.name)}"><b>${sgEsc(r.rival.name)}</b></button> a ${r.rival.dist} salto${r.rival.dist === 1 ? '' : 's'}${r.rival.opponent ? ' (vs ' + sgEsc(r.rival.opponent) + ')' : ''}`);
  return `<div class="micro wm-terr-near">${parts.join('<br>')}</div>`;
}

/* ---- minimapa SVG (posiciones oficiales worldmapposition de world.xml) ---- */
const WM_CITY_LABELS = ['Martlock', 'Thetford', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Caerleon'];
function wmMinimapData(){
  if (WM.mmData) return WM.mmData;
  const nodes = [];
  const byKey = new Map();
  for (const m of WM.mapList) {
    if (typeof m.x === 'number' && typeof m.y === 'number') {
      nodes.push(m);
      byKey.set(m.mapName.toLowerCase(), m);
    }
  }
  const edges = [];
  const seen = new Set();
  for (const m of nodes) {
    for (const nbName of (WM.mapGraph[m.mapName] || [])) {
      const nb = byKey.get(String(nbName).toLowerCase());
      if (!nb) continue;
      const key = [m.mapName, nb.mapName].sort().join('||');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([m, nb]);
    }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of nodes) {
    if (m.x < minX) minX = m.x; if (m.x > maxX) maxX = m.x;
    if (m.y < minY) minY = m.y; if (m.y > maxY) maxY = m.y;
  }
  const pad = 16;
  const vb = { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  WM.mmData = { nodes, edges, byKey, vb };
  return WM.mmData;
}
function wmRenderMinimap(){
  const host = document.getElementById('wmMinimapWrap');
  if (!host) return;
  if (!WM.mapPos || !WM.mapPos.size || !WM.mapGraph) { host.innerHTML = ''; return; }
  const { nodes, edges, vb } = wmMinimapData();
  const selKey = WM.selectedMap ? WM.selectedMap.toLowerCase() : null;
  const nbSet = new Set(WM.selectedNeighbors.map(n=>String(n).toLowerCase()));
  const watchSet = (typeof WZ !== 'undefined' ? WZ.zones : []).map(z=>String(z).toLowerCase());
  const route = (WM.route && WM.route.safe) ? WM.route.safe : null;
  const routeSet = route ? new Set(route.map(s=>String(s).toLowerCase())) : null;
  const routeEdgeKeys = new Set();
  if (route) for (let i = 0; i + 1 < route.length; i++) {
    routeEdgeKeys.add([route[i], route[i+1]].sort().join('||').toLowerCase());
  }
  const ownedSet = new Set(WM.territories.filter(t=>t.owned).map(t=>String(t.name).toLowerCase()));

  // puntos rojos: zonas con batallas recientes (score de peligro)
  const battleDots = [];
  for (const zone of Object.keys(WM.zoneDanger)) {
    const d = WM.zoneDanger[zone];
    if (d.score <= 0.5) continue;
    const m = WM.mapPos.get(zone);
    if (m) battleDots.push({ m, d, zone });
  }
  battleDots.sort((a,b)=>b.d.score - a.d.score);

  const edgeHTML = edges.map(([a,b]) => {
    const ka = [a.mapName, b.mapName].sort().join('||').toLowerCase();
    const inRoute = routeEdgeKeys.has(ka);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="wm-mm-edge${inRoute ? ' wm-mm-edge-route' : ''}"/>`;
  }).join('');

  const nodeHTML = nodes.map(m => {
    const key = m.mapName.toLowerCase();
    const isSel = key === selKey;
    const isNb = !isSel && nbSet.has(key);
    const inRoute = routeSet && routeSet.has(key) && !isSel;
    const dim = WM.mapFilter !== 'all' && !wmMapMatches(m) && !isSel && !isNb;
    const cls = 'wm-mm-node' + (isSel ? ' wm-mm-sel' : isNb ? ' wm-mm-nb' : inRoute ? ' wm-mm-route' : '')
      + (dim ? ' wm-mm-dim' : '') + (watchSet.includes(key) ? ' wm-mm-watch' : '');
    return `<circle cx="${m.x}" cy="${m.y}" r="${isSel ? 5 : isNb ? 3.4 : inRoute ? 3.4 : 2.1}" class="${cls}" data-wm-node="${sgEsc(m.mapName)}" data-wm-tip="node"/>`;
  }).join('');

  const terrHTML = WM.territories.filter(t => t.owned).map(t => {
    const m = WM.mapPos.get(String(t.name).toLowerCase());
    if (!m) return '';
    return `<rect x="${m.x - 4.6}" y="${m.y - 4.6}" width="9.2" height="9.2" class="wm-mm-terr" data-wm-node="${sgEsc(t.name)}" data-wm-tip="terr"><title>Territorio SG: ${sgEsc(t.name)}</title></rect>`;
  }).join('');

  const dotHTML = battleDots.slice(0, 120).map(({m, d, zone}) => {
    const r = 2.6 + Math.min(9, Math.sqrt(d.score) * 1.35);
    return `<circle cx="${m.x}" cy="${m.y}" r="${r.toFixed(1)}" class="wm-mm-battle" data-wm-node="${sgEsc(m.mapName)}" data-wm-tip="battle" data-wm-zone="${sgEsc(zone)}"/>`;
  }).join('');

  const labelHTML = nodes.map(m => {
    const key = m.mapName.toLowerCase();
    const show = WM_CITY_LABELS.includes(m.mapName)
      || key === selKey
      || (routeSet && routeSet.has(key))
      || watchSet.includes(key);
    if (!show) return '';
    const cls = 'wm-mm-label' + (key === selKey ? ' wm-mm-label-sel' : '');
    return `<text x="${m.x}" y="${m.y - (WM_CITY_LABELS.includes(m.mapName) ? 7 : 6)}" class="${cls}" text-anchor="middle">${sgEsc(m.mapName)}</text>`;
  }).join('');

  const legend = `
    <div class="wm-mm-legend micro muted">
      <span><i class="wm-lg wm-lg-sel"></i>seleccionado</span>
      <span><i class="wm-lg wm-lg-nb"></i>vecino</span>
      <span><i class="wm-lg wm-lg-battle"></i>batallas</span>
      <span><i class="wm-lg wm-lg-terr"></i>territorio SG</span>
      <span><i class="wm-lg wm-lg-route"></i>ruta</span>
    </div>`;

  host.innerHTML = `
    <div class="cd-title"><svg class="title-ico"><use href="#i-globe"/></svg> Minimapa del mundo <span class="muted micro">(posiciones oficiales del cliente · ${nodes.length} zonas con posición; Caminos de Avalon y zonas interiores no tienen posición fija)</span></div>
    <div class="wm-mm-wrap">
      <svg id="wmMinimap" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Minimapa de Albion: zonas y batallas recientes">
        <g id="wmMMG" transform="translate(${WM.mm.tx} ${WM.mm.ty}) scale(${WM.mm.k})">
          ${edgeHTML}${nodeHTML}${terrHTML}${dotHTML}${labelHTML}
        </g>
      </svg>
      <div class="wm-mm-tip" id="wmMMTip" hidden></div>
      <div class="wm-mm-zoom">
        <button class="btn micro-btn" id="wmMMZin" title="Acercar">＋</button>
        <button class="btn micro-btn" id="wmMMZout" title="Alejar">−</button>
        <button class="btn micro-btn" id="wmMMReset" title="Ver todo">⤢</button>
      </div>
      ${legend}
    </div>`;
  wmMinimapWire(host, vb);
}
function wmMMScale(svg, vb){
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return { s: 1, ox: 0, oy: 0, r };
  const s = Math.min(r.width / vb.w, r.height / vb.h);
  return { s, ox: (r.width - vb.w * s) / 2, oy: (r.height - vb.h * s) / 2, r };
}
function wmMMPoint(svg, vb, e){
  const { s, ox, oy, r } = wmMMScale(svg, vb);
  return { x: vb.x + (e.clientX - r.left - ox) / s, y: vb.y + (e.clientY - r.top - oy) / s };
}
function wmMMApply(svg){
  const g = svg.querySelector('#wmMMG');
  if (g) g.setAttribute('transform', `translate(${WM.mm.tx} ${WM.mm.ty}) scale(${WM.mm.k})`);
}
function wmMMZoomAt(svg, vb, e, factor){
  const p = wmMMPoint(svg, vb, e);
  const k2 = Math.max(0.7, Math.min(14, WM.mm.k * factor));
  WM.mm.tx = p.x - (p.x - WM.mm.tx) * (k2 / WM.mm.k);
  WM.mm.ty = p.y - (p.y - WM.mm.ty) * (k2 / WM.mm.k);
  WM.mm.k = k2;
  wmMMApply(svg);
}
function wmMinimapWire(host, vb){
  const svg = host.querySelector('#wmMinimap');
  const tip = host.querySelector('#wmMMTip');
  if (!svg) return;

  svg.addEventListener('click', e => {
    const c = e.target.closest('[data-wm-node]');
    if (!c || WM.mm.dragged) return;
    wmSelectMap(c.dataset.wmNode);
  });

  /* pan: arrastrar con mouse/touch (con captura del puntero) */
  let pan = null;
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pan = { x: e.clientX, y: e.clientY, tx: WM.mm.tx, ty: WM.mm.ty };
    WM.mm.dragged = false;
    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
  });
  svg.addEventListener('pointermove', e => {
    if (pan) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.hypot(dx, dy) > 6) WM.mm.dragged = true;
      const { s } = wmMMScale(svg, vb);
      WM.mm.tx = pan.tx + dx / s;
      WM.mm.ty = pan.ty + dy / s;
      wmMMApply(svg);
    }
    if (tip && !tip.hidden) wmMMPlaceTip(host, tip, e);
  });
  const endPan = () => { pan = null; setTimeout(()=>{ WM.mm.dragged = false; }, 50); };
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);

  /* zoom con rueda, centrado en el puntero */
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    wmMMZoomAt(svg, vb, e, Math.pow(1.0015, -e.deltaY));
  }, { passive: false });

  const zin = host.querySelector('#wmMMZin');
  const zout = host.querySelector('#wmMMZout');
  const zreset = host.querySelector('#wmMMReset');
  if (zin) zin.onclick = () => wmMMZoomCenter(svg, vb, 1.35);
  if (zout) zout.onclick = () => wmMMZoomCenter(svg, vb, 1 / 1.35);
  if (zreset) zreset.onclick = () => { WM.mm = { k: 1, tx: 0, ty: 0 }; wmMMApply(svg); };

  /* tooltip */
  svg.addEventListener('pointerover', e => {
    const c = e.target.closest('[data-wm-tip]');
    if (!c || !tip) { if (tip) tip.hidden = true; return; }
    tip.innerHTML = wmMinimapTipHTML(c);
    tip.hidden = false;
    wmMMPlaceTip(host, tip, e);
  });
  svg.addEventListener('pointerout', e => {
    if (tip && !e.relatedTarget?.closest?.('[data-wm-tip]')) tip.hidden = true;
  });
}
function wmMMZoomCenter(svg, vb, factor){
  const { s, ox, oy, r } = wmMMScale(svg, vb);
  const cx = r.left + ox + vb.w * s / 2, cy = r.top + oy + vb.h * s / 2;
  wmMMZoomAt(svg, vb, { clientX: cx, clientY: cy }, factor);
}
function wmMMPlaceTip(host, tip, e){
  const hr = host.getBoundingClientRect();
  let x = e.clientX - hr.left + 14, y = e.clientY - hr.top + 14;
  const tw = tip.offsetWidth || 180, th = tip.offsetHeight || 60;
  if (x + tw > hr.width - 6) x = Math.max(6, e.clientX - hr.left - tw - 10);
  if (y + th > hr.height - 6) y = Math.max(6, e.clientY - hr.top - th - 10);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function wmMinimapTipHTML(el){
  const kind = el.dataset.wmTip;
  const name = el.dataset.wmNode || el.dataset.wmZone || '?';
  const m = WM.mapList.find(x=>x.mapName === name);
  const d = wmZoneDanger(name);
  const lv = wmZoneDangerLevel(name);
  if (kind === 'battle') {
    return `<b>${sgEsc(name)}</b> ${lv.emoji} ${lv.label}<br>${d.count} batalla(s) registrada(s) · ${d.battles2h} en 2 h<br>${fmt(d.kills)} kills · ${fmt(d.fame)} fama<br><span class="muted">clic = seleccionar zona</span>`;
  }
  if (kind === 'terr') {
    return `<b>${sgEsc(name)}</b> 🛡<br>Territorio de Spetsnaz Grail<br><span class="muted">clic = seleccionar zona</span>`;
  }
  const extra = m ? `<span class="muted">${sgEsc(WM_TYPE_ES[m.mapType] || m.mapType)} T${m.tier ?? '?'} · ${(WM.mapGraph[m.mapName] || []).length} conexiones</span><br>` : '';
  return `<b>${sgEsc(name)}</b> ${lv.emoji} ${lv.label}<br>${extra}${d.count} batalla(s) · score ${d.score.toFixed(1)} · ${d.battles2h} en 2 h<br><span class="muted">clic = seleccionar zona</span>`;
}

/* ---- rutas: BFS (más corta) + Dijkstra (más segura, penaliza peligro) ---- */
function wmMapTypeOf(name){
  if (!WM.mapTypeIdx) {
    WM.mapTypeIdx = new Map();
    for (const m of WM.mapList) WM.mapTypeIdx.set(m.mapName.toLowerCase(), m.mapType);
  }
  return WM.mapTypeIdx.get(String(name||'').toLowerCase());
}
function wmNeighbors(name){
  const nbs = (WM.mapGraph && WM.mapGraph[name]) || [];
  if (!WM.noRoads) return nbs;
  return nbs.filter(nb => wmMapTypeOf(nb) !== 'roads');
}
function wmResolveMapName(q){
  if (!q) return null;
  if (WM.mapGraph && WM.mapGraph[q]) return q;
  const low = q.toLowerCase();
  const m = WM.mapList.find(x=>x.mapName.toLowerCase() === low);
  if (m) return m.mapName;
  const partial = WM.mapList.find(x=>x.mapName.toLowerCase().includes(low));
  return partial ? partial.mapName : null;
}
function wmBFSRoute(from, to){
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length){
    const cur = q.shift();
    if (cur === to) break;
    for (const nb of wmNeighbors(cur)) {
      if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
  }
  if (!prev.has(to)) return null;
  const path = [];
  for (let c = to; c != null; c = prev.get(c)) path.unshift(c);
  return path;
}
function wmEnterCost(name){
  // coste de ENTRAR a una zona: 1 salto + peligro (cada 4 puntos de score
  // suman un salto equivalente, tope +12). Sin batallas → 1 (ruta corta).
  // Se aplica a cualquier tipo de zona: si el killboard reporta batallas
  // ahí, no es segura, aunque sea royal azul.
  const d = wmZoneDanger(name);
  return 1 + Math.min(12, d.score / 4);
}
function wmSafeRoute(from, to){
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const pq = [[0, from]];
  const done = new Set();
  while (pq.length){
    pq.sort((a,b)=>a[0]-b[0]);
    const [d, cur] = pq.shift();
    if (done.has(cur)) continue;
    done.add(cur);
    if (cur === to) break;
    for (const nb of wmNeighbors(cur)) {
      const nd = d + wmEnterCost(nb);
      if (nd < (dist.has(nb) ? dist.get(nb) : Infinity)) { dist.set(nb, nd); prev.set(nb, cur); pq.push([nd, nb]); }
    }
  }
  if (!dist.has(to)) return null;
  const path = [];
  for (let c = to; c != null; c = prev.get(c)) path.unshift(c);
  return path;
}
function wmRouteDanger(path){
  // peligro total de la ruta = suma del score de las zonas por las que PASÁS (sin el origen)
  let s = 0;
  for (let i = 1; i < path.length; i++) s += wmZoneDanger(path[i]).score;
  return s;
}
async function wmRouteCalc(){
  await wmLoadMapGraph();
  const fromRaw = (document.getElementById('wmRouteFrom')?.value || '').trim() || WM.selectedMap || '';
  const toRaw = (document.getElementById('wmRouteTo')?.value || '').trim();
  const from = wmResolveMapName(fromRaw);
  const to = wmResolveMapName(toRaw);
  if (!from || !to) {
    WM.route = null;
    wmRenderRoute();
    wmRenderMinimap();
    return;
  }
  // traer batallas (caché 5 min) para el scoring de peligro de cada salto
  wmFetchBattles(5 * 60e3).catch(()=>{}).then(()=>{ if (WM.route) { wmRenderRoute(); wmRenderMinimap(); } });
  const short = wmBFSRoute(from, to);
  const safe = wmSafeRoute(from, to);
  WM.route = short ? { from, to, short, safe: safe || short } : null;
  wmRenderRoute();
  wmRenderMinimap();
}
function wmRouteChips(path){
  return path.map((z, i) => {
    const d = wmZoneDanger(z);
    const lv = wmZoneDangerLevel(z);
    return `${i ? '<span class="wm-route-arrow">→</span>' : ''}<button class="chip wm-route-chip" data-wm-goto="${sgEsc(z)}" title="${lv.label} · ${d.battles2h} batalla(s) en 2 h · score ${d.score.toFixed(1)}">${lv.emoji} ${sgEsc(z)}${d.battles2h ? ` <b class="wm-route-b2h">${d.battles2h}</b>` : ''}</button>`;
  }).join(' ');
}
function wmRenderRoute(){
  const box = document.getElementById('wmRouteResult');
  if (!box) return;
  if (!WM.route){
    box.innerHTML = '<div class="micro muted">Elegí origen y destino: calculamos la ruta más corta (BFS sobre el grafo de conexiones) y una alternativa con menor actividad registrada. No hay datus suficientes para garantizar la seguridad de una ruta.</div>';
    return;
  }
  const { from, to, short, safe } = WM.route;
  const same = short.join('||') === safe.join('||');
  const shortD = wmRouteDanger(short);
  const safeD = wmRouteDanger(safe);
  const lvS = wmRouteDangerLevel(short);
  const lvSafe = wmRouteDangerLevel(safe);
  let html = '';
  if (same){
    html = `<div class="wm-route-res">
      <div class="wm-route-head">📍 ${sgEsc(from)} → ${sgEsc(to)}: <b>${short.length - 1} salto${short.length - 1 === 1 ? '' : 's'}</b> ${lvS.emoji} ${lvS.label} · score total ${shortD.toFixed(1)}</div>
      <div class="chip-group" style="flex-wrap:wrap">${wmRouteChips(short)}</div>
    </div>`;
  } else {
    html = `<div class="wm-route-res">
      <div class="wm-route-head">⚡ Más corta: <b>${short.length - 1} salto${short.length - 1 === 1 ? '' : 's'}</b> ${lvS.emoji} ${lvS.label} · score ${shortD.toFixed(1)}</div>
      <div class="chip-group" style="flex-wrap:wrap">${wmRouteChips(short)}</div>
    </div>
    <div class="wm-route-res">
      <div class="wm-route-head">🛡 Menor actividad registrada: <b>${safe.length - 1} salto${safe.length - 1 === 1 ? '' : 's'}</b> ${lvSafe.emoji} ${lvSafe.label} · score ${safeD.toFixed(1)} <span class="muted micro">(esquiva zonas calientes; penaliza cada punto de peligro)</span></div>
      <div class="chip-group" style="flex-wrap:wrap">${wmRouteChips(safe)}</div>
    </div>`;
  }
  html += '<div class="micro muted" style="margin-top:6px">La ausencia de registros no demuestra seguridad. ⚪ = No hay datus suficientes. Score por zona = batallas (kills + fama/1000) + asesinatos crudos, con decaimiento de 2 h, según las últimas ~150 batallas y ~250 kills del servidor. 🏵 = batallas en las últimas 2 h en esa zona. Tocá una zona para seleccionarla.</div>';
  box.innerHTML = html;
}

/* ── pestaña «Mapa de Guerra»: solo territorios / GvG / rivales de SG ─────
   El tracker por zona real vivió acá adentro; ahora tiene su propio botón
   («Tracker por Zona») y su propio mount: ver wmTrackerRender().          */
function wmRender() {
  const mount = document.getElementById('wmMount');
  if (!mount) return;
  mount.innerHTML = `
    <div class="panel wm-panel">
      <div class="cd-title wm-head">
        <span><svg class="title-ico"><use href="#i-shield"/></svg> Mapa de Guerra de SG</span>
        <div class="wm-head-actions">
          <button class="btn" id="wmGoTrackerBtn" title="Ver el tracker de actividad PvP por zona real"><svg class="btn-ico"><use href="#i-globe"/></svg> Tracker por Zona</button>
          <button class="btn" id="wmRefreshBtn" title="Volver a pedir GvG y eventos al killboard">
            <svg class="btn-ico"><use href="#i-refresh"/></svg> Actualizar SG
          </button>
        </div>
      </div>
      <div class="micro muted wm-intro">
        Territorios de SG reconstruidos desde los GvG del killboard: quién los tiene, cuáles están amenazados, los próximos ataques y los rivales del gremio.
        La actividad PvP de un mapa concreto (minimapa, rutas seguras, alertas por zona) vive en el botón <button class="wm-linklike" data-wm-open-tracker>Tracker por Zona</button>.
      </div>

      <div id="wmContent">
        <div class="loading-cell">Cargando territorios y eventos de SG…</div>
      </div>
    </div>`;
  document.getElementById('wmRefreshBtn').onclick = () => wmLoad(true);
  document.getElementById('wmGoTrackerBtn').onclick = () => wmOpenTrackerTab();

  // botones dentro de wmContent (delegación, una sola vez por elemento)
  if (!mount.dataset.wmWired) {
    mount.dataset.wmWired = '1';
    mount.addEventListener('click', e => {
      const tr = e.target.closest('[data-wm-open-tracker]');
      if (tr) { wmOpenTrackerTab(); return; }
      const g = e.target.closest('[data-wm-goto]');
      if (g) wmTrackZone(g.dataset.wmGoto);
    });
  }

  if (WM.loadedOnce && !WM.loading) wmRenderContent();
  else wmLoad(false);
}

/* ── pestaña «Tracker por Zona»: PvP por mapa real de Albion ──────────────
   Grafo oficial world.xml (815 zonas / 1356 conexiones) + /battles del
   killboard. Minimapa, peligro por zona, rutas seguras, vigilancia y detalle
   de batalla. No depende del Mapa de Guerra: abre directo y solo pide los
   territorios al fondo, para mostrar a cuántos saltos está cada uno.      */
function wmTrackerRender() {
  const mount = document.getElementById('wmTrackerMount');
  if (!mount) return;
  mount.innerHTML = `
    <div class="panel wm-panel wm-tracker-panel">
      <div class="cd-title wm-head">
        <span><svg class="title-ico"><use href="#i-globe"/></svg> Tracker por zona real</span>
        <div class="wm-head-actions">
          <button class="btn" id="wmGoWarBtn" title="Ver los territorios y GvG de Spetsnaz Grail"><svg class="btn-ico"><use href="#i-shield"/></svg> Mapa de Guerra</button>
          <button class="btn" id="wmTrackerRefreshBtn" title="Volver a pedir batallas, asesinatos y el testigo Murderledger (sin caché)">
            <svg class="btn-ico"><use href="#i-refresh"/></svg> Actualizar datos
          </button>
        </div>
      </div>
      <div class="micro muted wm-intro">
        Vigilá cualquier mapa real de Albion: cruzamos el killboard oficial (batallas paginadas + asesinatos crudos de /events) con Murderledger/AlbionOnline2D como testigo de frescura, filtrados por [mapa + vecinos] del grafo oficial (world.xml, ${(() => { try { return WM.mapList.length || 800; } catch(e){ return 800; } })()} zonas). Con minimapa, actividad por zona, ranking, rutas y alertas. Sin evidencia suficiente: No hay datus suficientes. La ausencia de registros no significa que un mapa sea seguro.
      </div>

      <div class="chip-group wm-type-chips" id="wmTypeChips">
        ${WM_MAP_FILTERS.map(f=>`<button class="chip ${WM.mapFilter === f.id ? 'active' : ''}" data-wm-type="${f.id}">${f.label}</button>`).join('')}
      </div>

      <div class="search-wrap wm-search">
        <input type="search" id="wmMapSearch" class="search big" placeholder="Buscar mapa… Ej: Martlock, Caerleon, Eldon Hill, Swamp Cross" value="${sgEsc(WM.selectedMap||'')}" autocomplete="off">
        <div id="wmMapResults" class="search-results"></div>
      </div>

      <div id="wmSelInfo"></div>
      <div id="wmMinimapWrap" class="wm-minimap"></div>

      <div class="wm-route-box">
        <div class="cd-title"><svg class="title-ico"><use href="#i-globe"/></svg> Rutas y actividad registrada</div>
        <div class="wm-route-form">
          <input type="search" id="wmRouteFrom" class="search" placeholder="Desde (vacío = mapa seleccionado)" value="${sgEsc(WM.route?.from || WM.selectedMap || '')}" autocomplete="off">
          <div class="search-wrap" style="position:relative; flex:1; min-width:150px">
            <input type="search" id="wmRouteTo" class="search" placeholder="Hasta… Ej: Thetford" value="${sgEsc(WM.route?.to || '')}" autocomplete="off">
            <div id="wmRouteToResults" class="search-results"></div>
          </div>
          <button class="btn primary" id="wmRouteGo">🧭 Calcular</button>
        </div>
        <label class="micro muted wm-noroads"><input type="checkbox" id="wmNoRoads" ${WM.noRoads ? 'checked' : ''}> Evitar Caminos de Avalon</label>
        <div id="wmRouteResult"></div>
      </div>

      <div id="wmWatchBox" class="wm-watch"></div>

      <div id="wmTrackerContent" style="margin-top:10px"></div>
    </div>`;

  document.getElementById('wmTrackerRefreshBtn').onclick = () => wmTrackerRefresh();

  if (!mount.dataset.wtWired) {
    mount.dataset.wtWired = '1';
    mount.addEventListener('click', e => {
      const g = e.target.closest('[data-wm-goto]');
      if (g) wmSelectMap(g.dataset.wmGoto);
    });
  }

  // chips de tipo de mapa
  const typeChips = document.getElementById('wmTypeChips');
  if (typeChips) typeChips.onclick = e => {
    const c = e.target.closest('[data-wm-type]'); if (!c) return;
    WM.mapFilter = c.dataset.wmType;
    try { localStorage.setItem('wmMapFilter', WM.mapFilter); } catch(err){}
    typeChips.querySelectorAll('.chip').forEach(x=>x.classList.toggle('active', x === c));
    const q = document.getElementById('wmMapSearch')?.value.trim();
    if (q) wmMapSearch(q); // re-filtra resultados abiertos
    wmRenderMinimap();
  };

  // buscador de mapas (con dropdown reutilizable)
  wmAttachMapInput('wmMapSearch', 'wmMapResults', name => {
    wmSelectMap(name);
    const inp = document.getElementById('wmMapSearch');
    if (inp) inp.value = name;
  });
  // destino de ruta con el mismo buscador
  wmAttachMapInput('wmRouteTo', 'wmRouteToResults', name => {
    const inp = document.getElementById('wmRouteTo');
    if (inp) inp.value = name;
    const res = document.getElementById('wmRouteToResults');
    if (res) res.classList.remove('open');
  });

  const routeGo = document.getElementById('wmRouteGo');
  if (routeGo) routeGo.onclick = () => wmRouteCalc();
  const noRoads = document.getElementById('wmNoRoads');
  if (noRoads) noRoads.onchange = () => {
    WM.noRoads = noRoads.checked;
    try { localStorage.setItem('wmNoRoads', WM.noRoads ? '1' : ''); } catch(e){}
    if (WM.route) wmRouteCalc();
  };

  // ir al Mapa de Guerra desde el propio tracker
  const goWar = document.getElementById('wmGoWarBtn');
  if (goWar) goWar.onclick = () => wmOpenWarTab();

  wmRenderSelInfo();
  wmRenderWatch();
  wmRenderRoute();
  wmRenderTracker();

  // cargar grafo de mapas en segundo plano
  wmLoadMapGraph().then(()=>{
    if (WM.selectedMap) wmLoadTracker(false);
    wmRenderSelInfo();
    wmRenderMinimap();
    wmRenderRoute();
    wmRenderTracker();
  });

  /* los territorios de SG no son necesarios para rastrear, pero sirven para
     el «territorio más cercano a N saltos»; se piden sin bloquear el tracker */
  if (!WM.loadedOnce) wmLoad(false);
}

/* actualizar lo del tracker sin depender del Mapa de Guerra: batallas frescas
   (caché de 5 min saltada) → peligro, minimapa, rutas y detalle de la zona */
function wmTrackerRefresh(){
  const btn = document.getElementById('wmTrackerRefreshBtn');
  if (btn) btn.disabled = true;
  const done = () => { if (btn) btn.disabled = false; };
  const repaint = () => {
    wmRenderSelInfo();
    wmRenderMinimap();
    wmRenderRoute();
    wmRenderTracker();
  };
  if (WM.selectedMap) {
    /* wmLoadTracker(true) ya pide /battles sin caché y repinta tracker + minimapa */
    wmLoadTracker(true).then(()=>{ wmRenderSelInfo(); wmRenderRoute(); done(); }, done);
    return;
  }
  wmFetchBattles(0).then(repaint, repaint).then(done, done);
}

/* atajo desde el Mapa de Guerra: elegir esa zona real y saltar al tracker */
function wmTrackZone(name){
  if (!name) { wmOpenTrackerTab(); return; }
  wmSelectMap(name);       // guarda vecinos, mapID y localStorage; actualiza el buscador si existe
  wmOpenTrackerTab();      // monta el tracker y fuerza el rastreo de la zona
}

/* buscador de mapas reutilizable (tracker + destino de ruta) */
function wmAttachMapInput(inputId, resultsId, onPick){
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results) return;
  let timer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q = input.value.trim();
    timer = setTimeout(async ()=>{
      if (!WM.mapGraph) await wmLoadMapGraph();
      const hits = wmMapSearch(q);
      if (!hits.length){ results.classList.remove('open'); results.innerHTML=''; return; }
      results.innerHTML = hits.map(m=>`<div class="sr-item" data-wm-pick="${sgEsc(m.mapName)}"><div><div class="n">${sgEsc(m.mapName)}</div><div class="m">${sgEsc(m.mapID)} · ${sgEsc(WM_TYPE_ES[m.mapType] || m.mapType)} T${m.tier||'?'} · ${(WM.mapGraph && WM.mapGraph[m.mapName] ? WM.mapGraph[m.mapName].length : '?')} conexiones</div></div></div>`).join('');
      results.classList.add('open');
    }, 250);
  });
  input.addEventListener('focus', ()=>{
    if (results.children.length) results.classList.add('open');
  });
  results.addEventListener('click', e=>{
    const it = e.target.closest('[data-wm-pick]');
    if (!it) return;
    results.classList.remove('open');
    onPick(it.dataset.wmPick);
  });
}
/* cerrar cualquier dropdown de búsqueda de mapas al clickear afuera (una sola delegación global) */
document.addEventListener('click', e=>{
  if (e.target.closest('.wm-search') || e.target.closest('.wm-route-form')) return;
  document.querySelectorAll('#wmMapResults.open, #wmRouteToResults.open').forEach(r=>r.classList.remove('open'));
});

async function wmLoad(force) {
  if (WM.loading) return;
  if (WM.loadedOnce && !force && (WM.territories.length || WM.past.length || WM.upcoming.length)) {
    wmRenderContent();
    return;
  }
  WM.loading = true;
  WM.error = null;
  const content = document.getElementById('wmContent');
  if (content) content.innerHTML = '<div class="loading-cell">Consultando GvG y eventos del gremio…</div>';
  const btn = document.getElementById('wmRefreshBtn');
  if (btn) btn.disabled = true;

  try {
    const gid = await sgResolveGuild();
    const qGid = encodeURIComponent(gid);
    const [pastRaw, nextRaw, topRaw, eventsRaw] = await Promise.all([
      pfFetchRetry('/guildmatches/past?limit=50&offset=0').catch(() => null),
      pfFetchRetry('/guildmatches/next?limit=50&offset=0').catch(() => null),
      pfFetchRetry('/guildmatches/top').catch(() => null),
      pfFetchRetry('/events?limit=51&offset=0&guildId=' + qGid).catch(() =>
        pfFetchRetry('/events?limit=51&offset=0').catch(() => null)),
    ]);

    const pastAll = pfAsArray(pastRaw);
    const nextAll = pfAsArray(nextRaw);
    const topAll = pfAsArray(topRaw);
    const eventsAll = pfAsArray(eventsRaw);

    WM.past = pastAll.filter(m => wmMatchInvolvesSG(m, gid));
    WM.upcoming = [
      ...nextAll.filter(m => wmMatchInvolvesSG(m, gid)),
      ...topAll.filter(m => wmMatchInvolvesSG(m, gid)
        && !nextAll.some(n => (n.id || n.MatchId) && (n.id || n.MatchId) === (m.id || m.MatchId))),
    ].sort((a, b) => (wmMatchTime(a)?.getTime() || 0) - (wmMatchTime(b)?.getTime() || 0));

    const sgNames = new Set((SG.room.members || []).map(m => m.Name));
    WM.events = eventsAll.filter(ev => {
      const k = (ev.Killer || {}).GuildName || '';
      const v = (ev.Victim || {}).GuildName || '';
      if (k === SG_GUILD_NAME || v === SG_GUILD_NAME) return true;
      if (sgNames.has((ev.Killer || {}).Name) || sgNames.has((ev.Victim || {}).Name)) return true;
      return false;
    });

    WM.territories = wmBuildTerritories(WM.past, WM.upcoming, gid);
    WM.enemies = wmProcessEnemies(WM.events, WM.past, gid);
    WM.lastUpdate = Date.now();
    WM.loadedOnce = true;
    WM.loading = false;
    if (btn) btn.disabled = false;
    wmRenderContent();
  } catch (err) {
    WM.loading = false;
    WM.error = err && err.message ? err.message : String(err);
    if (btn) btn.disabled = false;
    if (content) {
      content.innerHTML = `
        <div class="loading-cell sg-err">No se pudo cargar el mapa: ${sgEsc(WM.error)}</div>
        <div class="micro muted" style="padding:0 14px 14px">El killboard oficial suele saturar. Tocá «Actualizar» en unos segundos.</div>
        <div style="padding:0 14px 14px"><button class="btn" id="wmRetryBtn"><svg class="btn-ico"><use href="#i-refresh"/></svg> Reintentar</button></div>`;
      const r = document.getElementById('wmRetryBtn');
      if (r) r.onclick = () => wmLoad(true);
    }
  }
}

function wmRenderContent() {
  const content = document.getElementById('wmContent');
  if (!content) return;

  const owned = WM.territories.filter(t => t.owned);
  const threatened = WM.territories.filter(t => t.threatened);
  const updated = WM.lastUpdate
    ? new Date(WM.lastUpdate).toLocaleTimeString('es-AR')
    : '—';

  const filter = WM.filter;
  let shown = WM.territories;
  if (filter === 'owned') shown = owned;
  else if (filter === 'threatened') shown = threatened;
  else if (filter === 'upcoming') shown = [];

  const chips = `
    <div class="chip-group wm-filters" id="wmFilterChips">
      <button class="chip ${filter === 'all' ? 'active' : ''}" data-wm-filter="all">Todos (${WM.territories.length})</button>
      <button class="chip ${filter === 'owned' ? 'active' : ''}" data-wm-filter="owned">Nuestros (${owned.length})</button>
      <button class="chip ${filter === 'threatened' ? 'active' : ''}" data-wm-filter="threatened">Amenazados (${threatened.length})</button>
      <button class="chip ${filter === 'upcoming' ? 'active' : ''}" data-wm-filter="upcoming">Próximos GvG (${WM.upcoming.length})</button>
    </div>`;

  const stats = `
    <div class="stats wm-stats">
      <div class="stat"><div class="k">Territorios SG</div><div class="v pos">${owned.length}</div><div class="s">según último GvG ganado</div></div>
      <div class="stat"><div class="k">Amenazados</div><div class="v ${threatened.length ? 'neg' : ''}">${threatened.length}</div><div class="s">con ataque declarado</div></div>
      <div class="stat"><div class="k">Próximos GvG</div><div class="v">${WM.upcoming.length}</div><div class="s">en la cola del killboard</div></div>
      <div class="stat"><div class="k">Actualizado</div><div class="v" style="font-size:1rem">${updated}</div><div class="s">tocá Actualizar para refrescar</div></div>
    </div>`;

  let mainHTML = '';
  if (filter === 'upcoming') {
    mainHTML = WM.upcoming.length ? `
      <div class="wm-section">
        <div class="cd-title"><svg class="title-ico"><use href="#i-sword"/></svg> Próximos GvG de Spetsnaz Grail</div>
        <div class="wm-match-list">${WM.upcoming.map(m => wmMatchRow(m, true)).join('')}</div>
      </div>` : '<div class="loading-cell">No hay GvG próximos de SG en el killboard.</div>';
  } else {
    mainHTML = shown.length ? `
      <div class="wm-section">
        <div class="cd-title"><svg class="title-ico"><use href="#i-shield"/></svg> Territorios (${shown.length})</div>
        <div class="wm-terr-grid">${shown.map(t => wmTerritoryCard(t)).join('')}</div>
        <div class="micro muted" style="padding:4px 14px 0">Dueño = último ganador del GvG en ese territorio. Si el killboard no trae el ganador, se asume que el defensor retiene.</div>
      </div>` : (WM.territories.length
        ? '<div class="loading-cell">Ningún territorio con este filtro.</div>'
        : `<div class="wm-empty">
            <div class="loading-cell">Todavía no hay territorios reconstruibles para Spetsnaz Grail.</div>
            <div class="micro muted" style="padding:0 14px 12px">El killboard no publica un listado de dueños: hace falta al menos un GvG reciente (pasado o próximo) del gremio para inferir el territorio. Si SG tiene castillos tomados sin pelearse en la ventana del historial, no aparecen acá.</div>
          </div>`);
  }

  const upcomingPreview = filter !== 'upcoming' && WM.upcoming.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-bolt"/></svg> Próximos ataques (${WM.upcoming.length})</div>
      <div class="wm-match-list">${WM.upcoming.slice(0, 8).map(m => wmMatchRow(m, true)).join('')}</div>
    </div>` : '';

  const pastPreview = WM.past.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-sword"/></svg> Últimos GvG (${Math.min(WM.past.length, 12)})</div>
      <div class="wm-match-list">${WM.past.slice(0, 12).map(m => wmMatchRow(m, false)).join('')}</div>
    </div>` : '';

  const enemyHTML = WM.enemies.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-skull"/></svg> Rivales recientes SG (${WM.enemies.length})</div>
      <div class="wm-enemy-list">${WM.enemies.slice(0, 12).map(e => wmEnemyCard(e)).join('')}</div>
    </div>` : '<div class="wm-section"><div class="loading-cell">Sin rivales recientes SG en la ventana cargada.</div></div>';

  const eventsHTML = WM.events.length ? `
    <div class="wm-section">
      <div class="cd-title"><svg class="title-ico"><use href="#i-bolt"/></svg> Kills del gremio SG (${WM.events.length})</div>
      <div class="wm-events-list">${WM.events.slice(0, 25).map(e => wmEventRow(e)).join('')}</div>
    </div>` : '';

  // Si ya hay tracker renderizado, no lo pisar; wmContent es separado de tracker
  // Pero wmRenderContent pinta todo el contenido de wmContent, tracker está fuera, así que ok
  content.innerHTML = stats + chips + mainHTML + upcomingPreview + pastPreview + enemyHTML + eventsHTML;

  const chipsEl = document.getElementById('wmFilterChips');
  if (chipsEl) {
    chipsEl.onclick = e => {
      const c = e.target.closest('[data-wm-filter]'); if (!c) return;
      WM.filter = c.dataset.wmFilter;
      wmRenderContent();
    };
  }
  // delegar click en batallas del tracker si están dentro de wmContent? No, están en trackerContent
  // Pero también necesitamos click para battles del SG? No.

  // asegurar tracker pintado + refrescar distancias a territorios y minimapa
  wmRenderTracker();
  wmRenderSelInfo();
  wmRenderMinimap();
}

function wmTerritoryCard(t) {
  let status, cls;
  if (t.owned) {
    status = t.threatened
      ? '<span class="badge warn">⚔️ Amenazado</span>'
      : '<span class="badge" style="color:var(--green);border-color:rgba(20,185,138,.4)">🛡 Nuestro</span>';
    cls = t.threatened ? ' wm-threatened' : ' wm-owned';
  } else if (t.contested) {
    status = '<span class="badge warn">🎯 Ataque nuestro</span>';
    cls = ' wm-threatened';
  } else {
    status = '<span class="badge" style="color:var(--red, #ef4444);border-color:rgba(239,68,68,.4)">Perdido / rival</span>';
    cls = ' wm-lost';
  }
  const rivalLine = t.owned
    ? `<div class="muted">Rival del último GvG: <b>${sgEsc(t.opponent)}</b></div>`
    : t.contested
      ? `<div class="muted">Atacamos a <b>${sgEsc(t.opponent)}</b></div>`
      : `<div class="muted">Último dueño rival · vs ${sgEsc(t.opponent)}</div>`;
  return `
    <div class="wm-terr-card${cls}">
      <div class="wm-terr-name">${sgEsc(t.name)}
        <button class="btn micro-btn wm-terr-track" data-wm-goto="${sgEsc(t.name)}" title="Ver la actividad PvP de ${sgEsc(t.name)} en el Tracker por Zona">🎯 Rastrear</button>
      </div>
      <div class="wm-terr-meta">
        <div>
          ${rivalLine}
          ${t.lastAt ? `<div class="muted">Último GvG: ${wmTimeAgo(t.lastAt)}</div>` : ''}
          ${t.threatened && t.nextAt ? `<div class="neg">Próximo: ${wmFmtWhen(t.nextAt)} vs ${sgEsc(t.nextOpponent || '—')}</div>` : ''}
        </div>
        ${status}
      </div>
    </div>`;
}

function wmMatchRow(m, isNext) {
  const terr = wmTerritoryName(m) || 'GvG';
  const when = wmMatchTime(m);
  const { a, b } = wmMatchTeams(m);
  const aName = wmGuildNameOf(a) || '—';
  const bName = wmGuildNameOf(b) || '—';
  const winner = wmMatchWinner(m);
  const wName = wmGuildNameOf(winner);
  const gid = SG.room.guildId;
  const weWin = wName && wmIsSG(winner, gid);
  const weLose = wName && !weWin;
  return `
    <div class="wm-match-row${weWin ? ' wm-win' : weLose ? ' wm-lose' : ''}">
      <div class="wm-match-when">${when ? (isNext ? wmFmtWhen(when) : wmTimeAgo(when)) : '—'}</div>
      <div class="wm-match-body">
        <div class="wm-match-terr">${sgEsc(terr)}</div>
        <div class="wm-match-teams">
          <span>${sgEsc(aName)}</span>
          <span class="muted">vs</span>
          <span>${sgEsc(bName)}</span>
          ${wName ? `<span class="badge ${weWin ? '' : 'warn'}" style="${weWin ? 'color:var(--green);border-color:rgba(20,185,138,.4)' : ''}">${weWin ? 'Ganamos' : 'Ganó ' + sgEsc(wName)}</span>` : (isNext ? '<span class="badge">pendiente</span>' : '')}
        </div>
      </div>
    </div>`;
}

function wmEnemyCard(e) {
  const kd = (e.deaths != null) ? (e.kills / Math.max(1, e.deaths)).toFixed(1).replace('.', ',') : null;
  return `
    <div class="wm-enemy-card">
      <div class="wm-enemy-name">${sgEsc(e.name)}</div>
      <div class="wm-enemy-stats">
        <div><b>${e.kills}</b> kills${e.gvg != null ? ` · <b>${e.gvg}</b> GvG` : ''}${kd ? ` · K/D <b>${kd}</b>` : ''}${e.fame ? ` · ${fmt(e.fame)} fama` : ''}</div>
        <div class="muted">${e.lastAt ? 'Último: ' + wmTimeAgo(e.lastAt) : ''}</div>
      </div>
    </div>`;
}

function wmEventRow(e) {
  const victim = e.Victim || {};
  const killer = e.Killer || {};
  const isSgVictim = (victim.GuildName === SG_GUILD_NAME)
    || (SG.room.members || []).some(m => m.Name === victim.Name);
  const isSgKiller = (killer.GuildName === SG_GUILD_NAME)
    || (SG.room.members || []).some(m => m.Name === killer.Name);
  const when = e.TimeStamp ? new Date(e.TimeStamp) : null;
  return `
    <div class="wm-event-row${isSgVictim ? ' wm-sg-victim' : isSgKiller ? ' wm-sg-killer' : ''}">
      <div class="wm-event-time">${when ? when.toLocaleString('es-AR') : '—'}</div>
      <div class="wm-event-players">
        <span class="${isSgKiller ? 'pos' : ''}">${sgEsc(killer.Name || '?')}</span>
        ${killer.GuildName ? `<span class="muted">[${sgEsc(killer.GuildName)}]</span>` : ''}
        <span class="muted">→</span>
        <span class="${isSgVictim ? 'neg' : ''}">${sgEsc(victim.Name || '?')}</span>
        ${victim.GuildName ? `<span class="muted">[${sgEsc(victim.GuildName)}]</span>` : ''}
        ${e.TotalVictimKillFame ? `<span class="muted">· ${fmt(e.TotalVictimKillFame)} fama</span>` : ''}
      </div>
    </div>`;
}

function wmFmtWhen(date) {
  if (!date || isNaN(date.getTime())) return '—';
  const diff = date.getTime() - Date.now();
  if (diff < 0) return wmTimeAgo(date);
  const mins = Math.round(diff / 60e3);
  if (mins < 60) return `en ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `en ${hours} h · ${date.toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function wmTimeAgo(date) {
  if (!date || isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return wmFmtWhen(date);
  const mins = Math.floor(diff / 60e3);
  if (mins < 1) return 'hace instantes';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}


/* ---- arranque: hash de vuelta de Discord + config del Worker ---- */

/* ====================================================================
   🔔 ALERTAS POR ZONA — mismo espíritu que las alertas de precio (WA):
   cada N minutos (default 3) se consultan las últimas /battles del
   killboard a través de la caché compartida y, si aparece una batalla
   en una zona vigilada → toast + beep suave + notificación del navegador.
   Persiste en localStorage ('wmZoneAlerts' + 'wmZoneSeen'); sin service
   worker: si cerrás la pestaña, no hay alertas. El primer ciclo marca la
   línea de base (no dispara con batallas viejas); después avisa de las
   batallas nuevas con menos de 15 min de antigüedad.
   ==================================================================== */
const WZ = {
  zones: [],          // nombres de zonas vigiladas (máx 20)
  sound: true,
  browser: false,
  intervalMin: 3,
  seen: [],           // ids de batallas ya vistas (dedupe, tope 1000)
  primed: false,      // false hasta terminar el primer ciclo completo
  timer: null, running: false, fails: 0, lastError: null, lastCheck: null, nextAt: 0, firedTotal: 0,
};
try {
  const saved = JSON.parse(localStorage.getItem('wmZoneAlerts') || 'null');
  if (saved && Array.isArray(saved.zones)) {
    WZ.zones = saved.zones.filter(z=>typeof z === 'string').slice(0, 20);
    if (typeof saved.sound === 'boolean') WZ.sound = saved.sound;
    if (typeof saved.browser === 'boolean') WZ.browser = saved.browser;
    const iv = parseFloat(saved.intervalMin);
    if (iv >= 1 && iv <= 30) WZ.intervalMin = iv;
  }
  const seenSaved = JSON.parse(localStorage.getItem('wmZoneSeen') || '[]');
  if (Array.isArray(seenSaved)) WZ.seen = seenSaved.map(String).slice(-1000);
} catch(e){}
function wzSave(){
  try { localStorage.setItem('wmZoneAlerts', JSON.stringify({ zones: WZ.zones, sound: WZ.sound, browser: WZ.browser, intervalMin: WZ.intervalMin })); } catch(e){}
}
function wzSaveSeen(){
  try { localStorage.setItem('wmZoneSeen', JSON.stringify(WZ.seen.slice(-1000))); } catch(e){}
}
function wzIntervalMin(){ return Math.max(1, Math.min(30, parseFloat(WZ.intervalMin) || 3)); }
function wzIntervalMs(){ return wzIntervalMin() * 60e3; }
function wzHas(zone){ return WZ.zones.some(z => z.toLowerCase() === String(zone || '').toLowerCase()); }

function wzToggle(zone){
  if (!zone) return;
  if (wzHas(zone)) {
    WZ.zones = WZ.zones.filter(z => z.toLowerCase() !== zone.toLowerCase());
    waToast('🔕 Zona sin vigilar', `«${zone}» salió de tu lista.`, '', ()=>wmOpenTrackerTab());
  } else {
    if (WZ.zones.length >= 20) { waToast('⚠️ Límite alcanzado', 'Máximo 20 zonas vigiladas.', 'err', ()=>wmOpenTrackerTab()); return; }
    WZ.zones.push(zone);
    // marcar como vistas las batallas ya conocidas de esa zona (no disparar con historia vieja)
    const zl = zone.toLowerCase();
    const seen = new Set(WZ.seen);
    for (const b of WM.battles) {
      const id = String(b.id ?? b.Id ?? ''); if (!id) continue;
      if (String(b.clusterName ?? b.ClusterName ?? '').toLowerCase() === zl) seen.add(id);
    }
    WZ.seen = [...seen].slice(-1000);
    wzSaveSeen();
    waToast('🔔 Zona vigilada', `Te avisamos si aparece una batalla en «${zone}» (chequeo cada ${wzIntervalMin()} min).`, '', ()=>wmOpenTrackerTab());
  }
  wzSave();
  wzRestart();
  wmRenderWatch();
  wmRenderSelInfo();
  wmRenderMinimap();
}

function wzSchedule(ms){ clearTimeout(WZ.timer); WZ.timer = setTimeout(wzTick, ms); WZ.nextAt = Date.now() + ms; wzStatus(); }
function wzRestart(){
  clearTimeout(WZ.timer);
  if (WZ.zones.length) wzSchedule(1500); // primer chequeo rápido al prender
  else { WZ.nextAt = 0; WZ.primed = false; WZ.firedTotal = 0; wzStatus(); }
}

async function wzTick(){
  if (WZ.running) { wzSchedule(30000); return; }
  if (!WZ.zones.length) { WZ.nextAt = 0; wzStatus(); return; }
  WZ.running = true;
  wzStatus();
  try {
    // el ciclo de alertas fuerza datos frescos (ventana chica: solo deduplica
    // ticks seguidos por reinicios); la caché de 5 min queda para la UI.
    // light = 1 página de batallas + 1 de kills, sin Murderledger: el motor
    // corre cada pocos minutos y no debe martillar el killboard.
    const battles = await wmFetchBattles(45e3, { light: true });
    const seen = new Set(WZ.seen);
    const watch = new Set(WZ.zones.map(z=>z.toLowerCase()));
    const now = Date.now();
    let fired = 0;
    for (const b of battles) {
      const id = String(b.id ?? b.Id ?? '');
      if (!id || seen.has(id)) continue;
      const zone = String(b.clusterName ?? b.ClusterName ?? '').toLowerCase();
      const when = b.startTime ? new Date(b.startTime).getTime() : 0;
      const fresh = when && (now - when) < 15 * 60e3;
      if (WZ.primed && watch.has(zone) && fresh && fired < 5) {
        wzNotify(b);
        fired++; WZ.firedTotal++;
      }
      seen.add(id);
    }
    WZ.seen = [...seen].slice(-1000);
    wzSaveSeen();
    WZ.primed = true;
    WZ.fails = 0; WZ.lastError = null; WZ.lastCheck = Date.now();
    if (fired && document.getElementById('wmTrackerContent')) wmRenderTracker();
  } catch(e){
    WZ.fails++;
    WZ.lastError = e && e.message ? e.message : String(e);
    if (WZ.fails === 3) waToast('⚠️ Alertas de zona sin respuesta', 'El killboard falla hace 3 ciclos. Se reintenta solo en el próximo.', 'err', ()=>wmOpenTrackerTab());
  }
  WZ.running = false;
  if (WZ.zones.length) wzSchedule(wzIntervalMs());
  else WZ.nextAt = 0;
  wzStatus();
  wmRenderWatch();
  if (WZ.firedTotal && document.getElementById('wmMinimapWrap')) wmRenderMinimap();
}

function wzNotify(b){
  const zone = String(b.clusterName ?? b.ClusterName ?? '') || 'zona';
  const kills = b.totalKills ?? b.TotalKills ?? 0;
  const fame = b.totalFame ?? b.TotalFame ?? 0;
  const players = b.totalPlayers ?? b.TotalPlayers ?? 0;
  const when = b.startTime ? new Date(b.startTime) : null;
  const msg = `${kills} kills · ${fmt(fame)} fama${players ? ' · ' + players + ' jugadores' : ''}${when ? ' · ' + wmTimeAgo(when) : ''}`;
  waToast('⚔️ Batalla en ' + zone, msg, '', ()=>wmOpenTrackerTab());
  if (WZ.sound) waBeep();
  if (WZ.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification('Ayudante Albion — batalla en ' + zone, { body: msg, tag: 'wz-' + String(b.id ?? b.Id ?? '') });
      n.onclick = () => { window.focus(); wmOpenTrackerTab(); };
    } catch(e){}
  }
}

function wzStatus(){
  const el = document.getElementById('wzStatus');
  if (!el) return;
  if (!WZ.zones.length) { el.textContent = 'Sin zonas vigiladas: elegí un mapa y tocá «🔔 Vigilar».'; return; }
  if (WZ.running) { el.textContent = 'Verificando ' + WZ.zones.length + ' zona(s)…'; return; }
  let t = `${WZ.zones.length} zona(s) · cada ${wzIntervalMin()} min · próxima en ${waCd(WZ.nextAt - Date.now())}`;
  if (WZ.lastCheck) t += ' · última hace ' + Math.max(0, Math.round((Date.now() - WZ.lastCheck) / 6e4)) + ' min';
  if (WZ.firedTotal) t += ' · ' + WZ.firedTotal + ' aviso(s) en la sesión';
  if (WZ.lastError) t += ' · ⚠ ' + WZ.lastError + (WZ.fails > 1 ? ' (' + WZ.fails + ' fallos seguidos)' : '');
  el.textContent = t;
}
/* countdown vivo del estado mientras el Mapa de Guerra está a la vista */
setInterval(() => { if (document.getElementById('wzStatus')) wzStatus(); }, 1000);

function wmRenderWatch(){
  const box = document.getElementById('wmWatchBox');
  if (!box) return;
  box.innerHTML = `
    <div class="cd-title"><svg class="title-ico"><use href="#i-bolt"/></svg> Zonas vigiladas</div>
    <div class="micro muted" style="margin:4px 0 8px">Como las alertas de precio: miramos las últimas batallas del servidor y te avisamos (toast + beep + notificación) si hay actividad PvP en tus zonas. Solo mientras la app esté abierta.</div>
    ${WZ.zones.length ? `<div class="chip-group wm-watch-chips">
      ${WZ.zones.map(z=>`<span class="chip active wm-watch-chip">${wmDangerBadge(z)} ${sgEsc(z)} <button class="wm-chip-x" data-wz-del="${sgEsc(z)}" title="Dejar de vigilar «${sgEsc(z)}»">✕</button></span>`).join('')}
    </div>` : ''}
    <div class="wz-cfg">
      <label class="micro muted">chequeo cada
        <select id="wzInterval" class="wz-select">${[2,3,5,10,15].map(v=>`<option value="${v}" ${wzIntervalMin()===v?'selected':''}>${v} min</option>`).join('')}</select>
      </label>
      <label class="micro muted"><input type="checkbox" id="wzSound" ${WZ.sound?'checked':''}> beep</label>
      <label class="micro muted"><input type="checkbox" id="wzBrowser" ${WZ.browser?'checked':''}> notificaciones del navegador</label>
    </div>
    <div class="micro muted" id="wzStatus"></div>`;
  box.querySelectorAll('[data-wz-del]').forEach(b=>{
    b.onclick = e => { e.stopPropagation(); wzToggle(b.dataset.wzDel); };
  });
  const sel = box.querySelector('#wzInterval');
  if (sel) sel.onchange = () => {
    WZ.intervalMin = parseInt(sel.value, 10) || 3;
    wzSave(); wzRestart(); wmRenderWatch();
  };
  const snd = box.querySelector('#wzSound');
  if (snd) snd.onchange = () => { WZ.sound = snd.checked; wzSave(); };
  const brw = box.querySelector('#wzBrowser');
  if (brw) brw.onchange = async () => {
    WZ.browser = brw.checked;
    if (WZ.browser && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch(e){}
    }
    if (WZ.browser && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      waToast('🔕 Notificaciones bloqueadas', 'El navegador no dio permiso: habilitá las notificaciones del sitio en el candado de la dirección.', 'err', ()=>wmOpenTrackerTab());
      WZ.browser = false;
      brw.checked = false;
    }
    wzSave();
  };
  wzStatus();
}

/* delegación para expandir batallas del tracker (y traer participantes) */
document.addEventListener('click', e=>{
  const all = e.target.closest('[data-wm-battle-all]');
  if (all) {
    WM.tracker.detailShowAll = !WM.tracker.detailShowAll;
    wmRenderTracker();
    return;
  }
  const b = e.target.closest('[data-wm-battle]');
  if (!b) return;
  const id = b.dataset.wmBattle;
  if (!id) return;
  const opening = WM.tracker.expandedBattle !== String(id);
  WM.tracker.expandedBattle = opening ? String(id) : null;
  if (!opening) WM.tracker.detailShowAll = false;
  wmRenderTracker();
  if (opening) wmLoadBattleDetail(id);
});



function sgInit() {
  /* ¿volvimos del OAuth con una sesión o un error? (fragmento: no viaja al servidor) */
  const h = location.hash || '';
  let hashSession = null;
  if (h.includes('#aa_session=')) {
    let raw = '';
    try { raw = decodeURIComponent(h.split('#aa_session=')[1] || ''); } catch (e) { raw = ''; }
    hashSession = raw;
    /* el token sale de la URL antes de cualquier otra cosa */
    history.replaceState(null, '', location.pathname + location.search);
    gotoTab('sg', 'members');
    sgSaveSession(raw).then(res => {
      if (res === 'ok') {
        const s = SG.session;
        waToast(s.m ? '🔐 ¡Ingreso correcto!' : '🔐 Ingresaste con Discord',
          s.m ? `Hola ${s.u.n}: Salón de miembros desbloqueado.` : `Hola ${s.u.n}: no vimos Spetsnaz Grail entre tus servidores.`, s.m ? '' : 'err');
      } else if (res === 'unverified') {
        waToast('🔐 Ingreso con Discord', 'No pudimos confirmar la sesión con el servidor. Revisá la conexión y probá de nuevo.', 'err');
      } else if (res === 'invalid') {
        waToast('🔐 Ingreso con Discord', 'La sesión que llegó está vencida o es inválida. Probá de nuevo.', 'err');
      }
    });
  } else if (h.includes('#aa_error=')) {
    const code = (h.split('#aa_error=')[1] || '').trim();
    const msgs = {
      config: 'El acceso con Discord todavía no está activo en el servidor de la app.',
      discord: 'Discord rechazó el código de ingreso. Probá de nuevo.',
      gremio: 'No pudimos consultar tu membresía en el servidor SG. Probá en un rato.',
      cancelado: 'Cancelaste la autorización en Discord. Cuando quieras, volvé a tocar «Ingresar con Discord».',
    };
    waToast('🔐 Ingreso con Discord', msgs[code] || 'No se pudo completar el ingreso.', 'err');
    gotoTab('sg', 'members');
    history.replaceState(null, '', location.pathname + location.search);
  }

  /* sesión guardada: se vuelve a confirmar con el servidor en cada carga.
     Si el token no pasa el chequeo local se descarta directo. */
  if (hashSession === null) {
    try {
      const raw = localStorage.getItem(SG_KEYS.sess);
      if (raw) {
        if (sgDecodeSession(raw)) sgSaveSession(raw);
        else localStorage.removeItem(SG_KEYS.sess);
      }
    } catch (e) {}
  }

  /* ¿el acceso está activo? Primero el proxy local (server.py de desarrollo
     trae un simulador de Discord); si no, el Worker de producción */
  (async () => {
    const cfg = await sgFetchConfig();
    SG.configured = cfg.configured;
    SG.loginUrl = cfg.loginUrl;
    SG.configMissing = cfg.missing || [];
    sgPaintAccount();
    const p = document.getElementById('tab-sg');
    if (p && p.classList.contains('active')) sgRoomRender();
    if (!cfg.configured && cfg.missing && cfg.missing.length) {
      console.info('[Ayudante Albion] Acceso SG inactivo: al Worker le falta ' + cfg.missing.join(', '));
    }
  })();
  /* si el acceso no estaba activo, se vuelve a consultar al volver a la
     pestaña (típico: se cargan las variables en Cloudflare y se vuelve acá) */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !SG.configured) sgRefreshConfig();
  });
}

async function sgFetchConfig() {
  try {
    const r = await fetch('/discord/config', { cache: 'no-store' });
    if (r && r.ok) {
      const c = await r.json();
      if (c && c.configured) return { configured: true, loginUrl: c.loginUrl || '/discord/login', missing: [] };
    }
  } catch (e) {}
  if (WORKER_URL) {
    try {
      const r = await fetch(WORKER_URL + '/discord/config', { cache: 'no-store' });
      if (r && r.ok) {
        const c = await r.json();
        if (c && typeof c === 'object' && !Array.isArray(c)) {
          const missing = Array.isArray(c.missing) ? c.missing.map(String).slice(0, 8) : [];
          return { configured: !!c.configured, loginUrl: c.loginUrl || (WORKER_URL + '/discord/login'), missing };
        }
      }
    } catch (e) {}
  }
  return { configured: false, loginUrl: '', missing: [] };
}
sgInit();

/* ====================================================================
   🗺️ arranque del tracker: alertas de zona + enlace compartible ?map=
   ==================================================================== */
/* motor de alertas por zona: vive mientras la pestaña esté abierta,
   independientemente de la pestaña activa (como las alertas de precio) */
wzRestart();

/* ?map=NombreDeZona — compartir la vigilancia de una zona. Se valida al
   cargar el grafo (wmLoadMapGraph) y abre directo el Tracker por Zona. */
function wmApplySharedZone(){
  try {
    const map = (new URLSearchParams(location.search).get('map') || '').trim();
    if (!map) return false;
    /* wmSelectMap guarda vecinos/mapID/cachea la selección; si el grafo todavía
       no bajó, wmLoadMapGraph revalida y completa al terminar */
    wmSelectMap(map.slice(0, 60));
    /* si todavía no hay sesión, el Salón muestra la tarjeta de ingreso;
       preseleccionar la subpestaña hace que al entrar caiga directo al
       Tracker por Zona con la zona compartida ya elegida. */
    try { sgRoomTab = 'tracker'; } catch (e) {}
    wmOpenTrackerTab();
    return true;
  } catch(e){ return false; }
}
wmApplySharedZone();
