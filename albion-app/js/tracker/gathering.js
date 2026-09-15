/* Ayudante Albion — análisis local de recolección. */
(function (root) {
  'use strict';

  var KEY = 'gatheringLog';
  var SESSION_KEY = 'gatheringSessions';
  var TYPES = {
    all: { label: 'En general', color: '#5b9cff' },
    wood: { label: 'Madera', color: '#e59b45' },
    fiber: { label: 'Fibra', color: '#61a7ed' },
    ore: { label: 'Mineral', color: '#e45c68' },
    hide: { label: 'Piel', color: '#54bd83' },
    stone: { label: 'Piedra', color: '#9988c8' },
    fishing: { label: 'Pesca', color: '#477cc4' }
  };
  var RANGES = [[10, '10 Minutos'], [30, '30 Minutos'], [60, '1 Hora'], [180, '3 Horas'], [720, '12 Horas'], [1440, '24 Horas'], [4320, '3 Días'], [10080, '7 Días'], [43200, '30 Días'], [525600, '365 Días']];
  var state = { rows: [], sessions: [], type: 'all', range: 1440, session: 'all', metric: 'quantity', enabledTypes: new Set(Object.keys(TYPES).filter(function (x) { return x !== 'all'; })) };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function num(v) { return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0)); }
  function money(v) { return num(v) + ' plata'; }
  function uid() { return 'gat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); }
  function read(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state.rows.slice(-10000))); localStorage.setItem(SESSION_KEY, JSON.stringify(state.sessions.slice(-250))); } catch (e) {} }

  function normalizeType(value, itemId) {
    var raw = String(value || '').toLowerCase();
    var id = String(itemId || '').toUpperCase();
    if (TYPES[raw] && raw !== 'all') return raw;
    if (/WOOD|LOG/.test(id)) return 'wood';
    if (/FIBER|CLOTH/.test(id)) return 'fiber';
    if (/ORE|METAL/.test(id)) return 'ore';
    if (/HIDE|LEATHER/.test(id)) return 'hide';
    if (/ROCK|STONE/.test(id)) return 'stone';
    if (/FISH|SEAWEED/.test(id)) return 'fishing';
    return '';
  }
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = String(raw.itemId || raw.id || '');
    var type = normalizeType(raw.type || raw.resourceType, id);
    if (!type) return null;
    var tier = +(raw.tier || ((id.match(/^T([1-8])_/) || [])[1]) || 0);
    var qty = Math.max(1, +(raw.quantity || raw.qty || 1));
    var unitValue = Math.max(0, +(raw.unitValue || raw.price || 0));
    var value = Math.max(0, +(raw.value != null ? raw.value : unitValue * qty));
    return { uid: String(raw.uid || uid()), ts: +(raw.ts || Date.now()), itemId: id, name: String(raw.name || raw.itemName || id || TYPES[type].label), type: type, tier: tier, qty: qty, value: value, map: String(raw.map || raw.zone || 'Sin ubicación'), sessionId: String(raw.sessionId || currentSession().id) };
  }
  function currentSession() {
    var active = state.sessions.find(function (s) { return !s.end; });
    if (active) return active;
    active = { id: 'gats_' + Date.now().toString(36), start: Date.now(), end: 0, label: 'Sesión ' + new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) };
    state.sessions.push(active); save(); return active;
  }
  function add(raw) {
    var row = normalize(raw); if (!row) return false;
    if (state.rows.some(function (x) { return x.uid === row.uid; })) return false;
    state.rows.push(row); save(); render(); return true;
  }

  function filtered() {
    var min = Date.now() - state.range * 60000;
    return state.rows.filter(function (r) {
      return r.ts >= min && (state.type === 'all' || r.type === state.type) && (state.session === 'all' || r.sessionId === state.session);
    });
  }
  function group(rows, key) {
    var out = {};
    rows.forEach(function (r) {
      var k = typeof key === 'function' ? key(r) : r[key];
      var g = out[k] || (out[k] = { key:k, qty:0, value:0, count:0, types:new Set(), resources:{} });
      g.qty += r.qty; g.value += r.value; g.count++; g.types.add(r.type); g.resources[r.name] = (g.resources[r.name] || 0) + r.qty;
    });
    return Object.values(out);
  }
  function top(list, prop) { return list.length ? list.slice().sort(function (a,b) { return b[prop] - a[prop]; })[0] : null; }
  function durationHours(rows) {
    if (!rows.length) return 0;
    var first = Math.min.apply(null, rows.map(function (r) { return r.ts; }));
    var last = Math.max(Date.now(), Math.max.apply(null, rows.map(function (r) { return r.ts; })));
    return Math.max((last - first) / 36e5, 1 / 60);
  }

  function shell() {
    var mount = document.getElementById('gatheringMount'); if (!mount) return;
    mount.innerHTML = '<div class="gat-shell">' +
      '<div class="panel gat-toolbar"><div class="gat-toolbar-title"><span class="gat-eyebrow">ANALYTICS · GATHERING</span><h1>Seguimiento de recolección</h1></div>' +
      '<label class="gat-track" id="gatTrack"><input type="checkbox" id="gatTracking"><i></i><span id="gatTrackText">El rastreo no está activo</span></label>' +
      '<label class="gat-control"><span>Rango de tiempo</span><select id="gatRange">' + RANGES.map(function (r) { return '<option value="'+r[0]+'" '+(r[0]===state.range?'selected':'')+'>'+r[1]+'</option>'; }).join('') + '</select></label>' +
      '<label class="gat-control"><span>Sesión</span><select id="gatSession"></select></label>' +
      '<button class="btn" id="gatReset">↻ Reiniciar sesión</button></div>' +
      '<div class="gat-tabs" id="gatTabs">' + Object.keys(TYPES).map(function (k) { return '<button class="gat-tab '+(k===state.type?'active':'')+'" data-type="'+k+'">'+TYPES[k].label+'</button>'; }).join('') + '</div>' +
      '<div class="gat-kpis" id="gatKpis"></div><div class="gat-summary-grid" id="gatSummary"></div>' +
      '<div class="gat-charts"><div class="panel gat-card gat-chart"><div class="gat-chart-head"><h2>Valor de recursos por tipo</h2></div><div id="gatValueChart"></div></div>' +
      '<div class="panel gat-card gat-chart"><div class="gat-chart-head"><h2>Actividad de recolección a lo largo del tiempo</h2><select id="gatMetric"><option value="quantity">Cantidad de recursos recolectados</option><option value="value">Valor de los recursos</option><option value="processes">Procesos de recolección</option></select></div><div class="gat-legend" id="gatLegend"></div><div id="gatTimeChart"></div></div>' +
      '<div class="panel gat-card gat-chart gat-location-chart"><div class="gat-chart-head"><h2>Actividad de recolección por ubicación</h2></div><div id="gatLocationChart"></div></div></div>' +
      '<div class="gat-tables"><div class="panel gat-card"><h2>Tipos de recursos recolectados</h2><div class="table-wrap"><table class="ledger"><thead><tr><th>Tipo</th><th class="num">Cantidad</th><th class="num">Valor</th><th class="num">% del total</th></tr></thead><tbody id="gatTypesBody"></tbody></table></div></div>' +
      '<div class="panel gat-card"><h2>Recursos más recolectados</h2><ol class="gat-rank" id="gatRank"></ol></div>' +
      '<div class="panel gat-card gat-recent"><h2>Recolecciones recientes</h2><div class="table-wrap"><table class="ledger"><thead><tr><th>Recurso</th><th>Nivel</th><th class="num">Cantidad</th><th class="num">Valor</th><th>Mapa</th><th>Hora</th></tr></thead><tbody id="gatRecent"></tbody></table></div></div></div>' +
      '</div>';
    wire(); refreshSessions(); paintTracking(); render();
  }

  function wire() {
    document.getElementById('gatRange').onchange = function (e) { state.range = +e.target.value; render(); };
    document.getElementById('gatSession').onchange = function (e) { state.session = e.target.value; render(); };
    document.getElementById('gatTabs').onclick = function (e) { var b=e.target.closest('[data-type]'); if(!b)return; state.type=b.dataset.type; document.querySelectorAll('.gat-tab').forEach(function(x){x.classList.toggle('active',x===b);}); render(); };
    document.getElementById('gatReset').onclick = function () {
      var active = state.sessions.find(function (s) { return !s.end; }); if (active) active.end = Date.now();
      var next = currentSession(); state.session = next.id; save(); refreshSessions(); render();
    };
    document.getElementById('gatTracking').onchange = async function (e) {
      if (!root.AATracker) return;
      e.target.disabled = true;
      try { if (e.target.checked) await AATracker.start(); else await AATracker.stop(); }
      catch (err) { console.warn('gathering tracking', err); }
      e.target.disabled = false; paintTracking();
    };
    document.getElementById('gatMetric').onchange = function (e) { state.metric=e.target.value; renderTime(filtered()); };
  }
  function refreshSessions() {
    currentSession();
    var sel=document.getElementById('gatSession'); if(!sel)return;
    sel.innerHTML='<option value="all">Todas las sesiones</option>'+state.sessions.slice().reverse().map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.label)+(s.end?'':' · activa')+'</option>';}).join('');
    sel.value=state.sessions.some(function(s){return s.id===state.session;})?state.session:'all';
  }
  function paintTracking() {
    var on=!!(root.AATracker&&AATracker.state().capturing), box=document.getElementById('gatTrack');
    if(!box)return; box.classList.toggle('on',on); var toggle=document.getElementById('gatTracking'); toggle.checked=on; toggle.disabled=!!(root.AATracker&&!AATracker.state().available); document.getElementById('gatTrackText').textContent=on?'El rastreo está activo':'El rastreo no está activo';
  }

  function render() {
    if(!document.getElementById('gatKpis'))return;
    var rows=filtered(), byResource=group(rows,'name'), byMap=group(rows,'map');
    var totalQty=rows.reduce(function(s,r){return s+r.qty;},0), totalValue=rows.reduce(function(s,r){return s+r.value;},0), hours=durationHours(rows);
    var bestResource=top(byResource,'value'), mostResource=top(byResource,'qty'), bestMap=top(byMap,'value'), bestSingle=top(rows,'value');
    document.getElementById('gatKpis').innerHTML=kpi('◉','Valor del recurso',money(totalValue),'Por hora: '+money(hours?totalValue/hours:0)+'/h')+kpi('⌁','Total de recursos',num(totalQty),byResource.length+' tipos de recursos únicos')+kpi('⚒','Procesos de recolección',num(rows.length),'Total de procesos de recolección')+kpi('★','Mejor recurso',bestResource?bestResource.key:'—',bestResource?'Valor: '+money(bestResource.value):'Valor: —')+kpi('⌖','Mejor mapa',bestMap?bestMap.key:'—',bestMap?'Valor: '+money(bestMap.value):'Valor: —');
    document.getElementById('gatSummary').innerHTML=summaryCard('Resumen general','', [['Total de recursos recolectados',num(totalQty)],['Total de procesos de recolección',num(rows.length)],['Tipos de recursos únicos',num(byResource.length)],['Valor promedio de los recursos',money(totalQty?totalValue/totalQty:0)],['Mejor recolección individual',money(bestSingle?bestSingle.value:0)]])+summaryCard('Recurso más recolectado',mostResource?mostResource.key:'—', [['Veces recolectado',num(mostResource?mostResource.count:0)],['Cantidad total',num(mostResource?mostResource.qty:0)],['Valor total',money(mostResource?mostResource.value:0)],['Valor promedio por recolección',money(mostResource?mostResource.value/mostResource.count:0)]])+summaryCard('Mejor mapa de recolección',bestMap?bestMap.key:'—', [['Veces recolectado',num(bestMap?bestMap.count:0)],['Valor total',money(bestMap?bestMap.value:0)],['Tipos de recursos únicos',num(bestMap?bestMap.types.size:0)],['Recurso más recolectado',bestMap?top(Object.keys(bestMap.resources).map(function(k){return{key:k,qty:bestMap.resources[k]};}),'qty').key:'—']]);
    renderValue(rows); renderTime(rows); renderLocations(byMap); renderTables(rows,totalValue);
  }
  function kpi(icon,label,value,sub){return '<div class="gat-kpi"><div class="gat-kpi-head"><span class="gat-kpi-icon">'+icon+'</span>'+esc(label)+'</div><span class="gat-kpi-value">'+esc(value)+'</span><span class="gat-kpi-sub">'+esc(sub)+'</span></div>';}
  function summaryCard(title,highlight,items){return '<div class="panel gat-card"><h2>'+esc(title)+'</h2>'+(highlight?'<div class="gat-highlight">'+esc(highlight)+'</div>':'')+'<div class="gat-detail-list">'+items.map(function(x){return '<div><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>';}).join('')+'</div></div>';}
  function bars(groups,max,format){if(!groups.length)return '<div class="gat-empty">Sin datos en el rango seleccionado.</div>';return '<div class="gat-bar-list">'+groups.map(function(g){return '<div class="gat-bar-row" style="--gat-color:'+esc(g.color||'#5b9cff')+'"><span>'+esc(g.label||g.key)+'</span><span class="gat-bar-track"><i style="width:'+Math.max(1,g.value/max*100)+'%"></i></span><b>'+esc(format(g.value))+'</b></div>';}).join('')+'</div>';}
  function renderValue(rows){var gs=group(rows,'type').map(function(g){return{key:g.key,label:TYPES[g.key].label,color:TYPES[g.key].color,value:g.value};}).sort(function(a,b){return b.value-a.value;}),max=Math.max(1,...gs.map(function(g){return g.value;}));document.getElementById('gatValueChart').innerHTML=bars(gs,max,money);}
  function renderLocations(groups){var gs=groups.slice().sort(function(a,b){return b.value-a.value;}).slice(0,10).map(function(g){return{key:g.key,label:g.key,value:g.value,color:'#54bd83'};}),max=Math.max(1,...gs.map(function(g){return g.value;}));document.getElementById('gatLocationChart').innerHTML=bars(gs,max,money);}

  function renderTime(rows) {
    var legend=document.getElementById('gatLegend');
    legend.innerHTML=Object.keys(TYPES).filter(function(k){return k!=='all';}).map(function(k){return '<label style="--gat-color:'+TYPES[k].color+'"><input type="checkbox" data-gat-kind="'+k+'" '+(state.enabledTypes.has(k)?'checked':'')+'> '+TYPES[k].label+'</label>';}).join('');
    legend.querySelectorAll('[data-gat-kind]').forEach(function(c){c.onchange=function(){c.checked?state.enabledTypes.add(c.dataset.gatKind):state.enabledTypes.delete(c.dataset.gatKind);renderTime(filtered());};});
    var box=document.getElementById('gatTimeChart'), now=Date.now(), start=now-state.range*60000, buckets=10, step=(now-start)/buckets, vals=new Array(buckets).fill(0);
    rows.filter(function(r){return state.enabledTypes.has(r.type);}).forEach(function(r){var i=Math.min(buckets-1,Math.max(0,Math.floor((r.ts-start)/step)));vals[i]+=state.metric==='value'?r.value:state.metric==='processes'?1:r.qty;});
    var max=Math.max(1,...vals), w=620,h=175,pad=28,pts=vals.map(function(v,i){return [pad+i*(w-pad*2)/(buckets-1),h-pad-v/max*(h-pad*2)];});
    var grid=[0,.25,.5,.75,1].map(function(n){var y=h-pad-n*(h-pad*2);return '<line class="gat-grid-line" x1="'+pad+'" y1="'+y+'" x2="'+(w-pad)+'" y2="'+y+'"/><text class="gat-axis-label" x="2" y="'+(y+3)+'">'+num(max*n)+'</text>';}).join('');
    var labels=[0,3,6,9].map(function(i){var d=new Date(start+i*step);return '<text class="gat-axis-label" text-anchor="middle" x="'+pts[i][0]+'" y="'+(h-5)+'">'+d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})+'</text>';}).join('');
    box.innerHTML='<svg class="gat-line-svg" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+grid+'<polyline class="gat-line" points="'+pts.map(function(p){return p.join(',');}).join(' ')+'"/>'+pts.map(function(p,i){return '<circle class="gat-point" cx="'+p[0]+'" cy="'+p[1]+'" r="3"><title>'+num(vals[i])+'</title></circle>';}).join('')+labels+'</svg>';
  }
  function renderTables(rows,totalValue){
    var typeGroups=group(rows,'type').sort(function(a,b){return b.value-a.value;});
    document.getElementById('gatTypesBody').innerHTML=typeGroups.length?typeGroups.map(function(g){return '<tr><td><span class="gat-resource" style="--gat-color:'+TYPES[g.key].color+'"><i class="gat-resource-dot"></i>'+TYPES[g.key].label+'</span></td><td class="num">'+num(g.qty)+'</td><td class="num">'+money(g.value)+'</td><td class="num">'+(totalValue?((g.value/totalValue)*100).toFixed(1).replace('.',','):'0,0')+'%</td></tr>';}).join(''):'<tr><td colspan="4" class="loading-cell">Sin recursos recolectados.</td></tr>';
    var rank=group(rows,'name').sort(function(a,b){return b.qty-a.qty;}).slice(0,8);
    document.getElementById('gatRank').innerHTML=rank.length?rank.map(function(g,i){return '<li><b>'+(i+1)+'</b><span>'+esc(g.key)+'</span><b>'+num(g.qty)+' · '+money(g.value)+'</b></li>';}).join(''):'<li class="gat-empty">Sin recursos para clasificar.</li>';
    var recent=rows.slice().sort(function(a,b){return b.ts-a.ts;}).slice(0,50);
    document.getElementById('gatRecent').innerHTML=recent.length?recent.map(function(r){return '<tr><td><span class="gat-resource" style="--gat-color:'+TYPES[r.type].color+'"><i class="gat-resource-dot"></i>'+esc(r.name)+'</span></td><td><span class="badge">T'+(r.tier||'—')+'</span></td><td class="num">'+num(r.qty)+'</td><td class="num">'+money(r.value)+'</td><td>'+esc(r.map)+'</td><td class="muted">'+new Date(r.ts).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</td></tr>';}).join(''):'<tr><td colspan="6" class="loading-cell">Todavía no se registraron recolecciones.</td></tr>';
  }

  function init() {
    state.sessions=read(SESSION_KEY,[]).filter(function(s){return s&&s.id;});
    state.rows=read(KEY,[]).map(normalize).filter(Boolean);
    currentSession(); shell();
    if(root.AATracker){
      AATracker.on(function(type,payload){paintTracking();if(type==='gathering')add(payload);if(type==='loot'&&payload)add(payload);});
      AATracker.detect().then(paintTracking);
    }
  }
  root.AAGathering=Object.freeze({add:add,render:render,rows:function(){return state.rows.slice();}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
}(window));
