/* Control de calidad profundo: ejercita cada módulo con precios simulados */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const appjs = fs.readFileSync('app.js', 'utf8');
const errors = [], warns = [], oks = [];

const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const PRICE = 1000; // precio simulado para todo

window.fetch = (url) => {
  const u = String(url);
  let data = [];
  try {
    if (u.includes('/discord/config')) {
      // worker: acceso de miembros SG configurado
      data = { configured: true, loginUrl: 'http://worker.test/discord/login' };
    } else if (u.includes('/discord/verify')) {
      // worker: solo confirma los tokens firmados con '.sig' (los de esta QA);
      // cualquier otro (p. ej. forjado) se rechaza como haría el HMAC real
      const raw = decodeURIComponent(u.split('s=')[1] || '');
      const [pl, sig] = raw.split('.');
      data = { valid: false };
      if (sig === 'sig') {
        try {
          const p = JSON.parse(Buffer.from(pl.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
          if (p.e > Date.now()) data = { valid: true, member: p.m === true, user: p.u, e: p.e };
        } catch (e) {}
      }
    } else if (u.includes('.json') && !u.includes('albion-online-data')) {
      const f = u.match(/data\/[a-z_]+\.json/)[0];
      data = JSON.parse(fs.readFileSync(f, 'utf8'));
    } else if (u.includes('/prices/')) {
      // API simulada: extraer ids y ciudades de la URL y devolver precios
      const ids = decodeURIComponent(u.split('/prices/')[1].split('.json')[0]).split(',');
      const locs = (u.match(/locations=([^&]+)/) || [,''])[1].split('%2C').join(',').split(',').filter(Boolean);
      data = [];
      for (const id of ids) for (const loc of (locs.length ? locs : ['Caerleon'])) {
        for (const q of (u.includes('qualities=1') ? [1] : [1,2,3])) {
          data.push({ item_id: id, city: decodeURIComponent(loc), quality: q,
            sell_price_min: PRICE, sell_price_min_date: new Date().toISOString().slice(0,19),
            buy_price_max: PRICE * 0.9, buy_price_max_date: new Date().toISOString().slice(0,19) });
        }
      }
    } else if (u.includes('/gold')) {
      data = [{ price: 4000, timestamp: new Date().toISOString() }];
    } else if (u.includes('/gameinfo/search')) {
      // búsqueda dependiente de la consulta: TestPlayer (Perfil), GammaSG (vínculo SG)
      // y el gremio Spetsnaz Grail para resolver el ID de la Sala de miembros
      const q = decodeURIComponent(u.split('q=')[1] || '').toLowerCase();
      const players = [];
      if (q.includes('testplayer')) players.push({ Id: 'qa1', Name: 'TestPlayer', GuildName: 'QA Guild', AllianceName: '' });
      if (q.includes('gamma')) players.push({ Id: 'sgm3', Name: 'GammaSG', GuildName: 'Spetsnaz Grail', AllianceName: '' });
      data = { players, guilds: [{ Id: 'sgg9', Name: 'Spetsnaz Grail', AllianceName: '' }] };
    } else if (u.includes('/gameinfo/players/qa1/topkills')) {
      data = [{ EventId: 71, TimeStamp: '2026-09-01T10:00:00Z', TotalVictimKillFame: 999999, numberOfParticipants: 5,
        Killer: { Name: 'TestPlayer', GuildName: 'QA Guild', AverageItemPower: 1500 },
        Victim: { Name: 'TopVictim', GuildName: 'Otros', AverageItemPower: 1450, Equipment: { MainHand: { Type: 'T8_MAIN_SWORD' } } } }];
    } else if (u.includes('/gameinfo/players/qa1/solokills')) {
      data = [{ EventId: 72, TimeStamp: '2026-09-02T10:00:00Z', TotalVictimKillFame: 55555, numberOfParticipants: 1,
        Killer: { Name: 'TestPlayer', GuildName: 'QA Guild', AverageItemPower: 1500 },
        Victim: { Name: 'SoloVictim', GuildName: 'Otros', AverageItemPower: 1200, Equipment: { MainHand: { Type: 'T6_MAIN_DAGGER' } } } }];
    } else if (u.includes('/gameinfo/players/qa1/kills') || u.includes('/gameinfo/players/qa1/deaths')) {
      data = [{ EventId: 1, TimeStamp: '2026-09-07T12:00:00Z', TotalVictimKillFame: 12345, numberOfParticipants: 2,
        Killer: { Name: 'TestPlayer', GuildName: 'QA Guild', AverageItemPower: 1400 },
        Victim: { Name: 'Rival', GuildName: 'Otros', AverageItemPower: 1300, Equipment: { MainHand: { Type: 'T4_MAIN_SWORD' } } } }];
    } else if (u.includes('/gameinfo/players/qa1')) {
      data = { Name: 'TestPlayer', Id: 'qa1', GuildName: 'QA Guild', GuildId: 'g9', AllianceName: '', AllianceTag: '',
        KillFame: 1000000, DeathFame: 500000, FameRatio: 2,
        LifetimeStatistics: { PvE: { Total: 99999 }, Gathering: { All: { Total: 5555 } }, Crafting: { Total: 7777 }, FishingFame: 1, FarmingFame: 2 } };
    } else if (u.includes('/gameinfo/guilds/sgg9/members')) {
      data = [
        { Id: 'sgm1', Name: 'AlphaSG', GuildId: 'sgg9', GuildName: 'Spetsnaz Grail', KillFame: 900000, DeathFame: 100000 },
        { Id: 'sgm2', Name: 'BetaSG', GuildId: 'sgg9', GuildName: 'Spetsnaz Grail', KillFame: 500000, DeathFame: 500000 },
        { Id: 'sgm3', Name: 'GammaSG', GuildId: 'sgg9', GuildName: 'Spetsnaz Grail', KillFame: 200000, DeathFame: 400000 },
      ];
    } else if (u.includes('/gameinfo/guilds/sgg9/top')) {
      data = [{ EventId: 91, TimeStamp: '2026-09-06T10:00:00Z', TotalVictimKillFame: 888888,
        Killer: { Name: 'AlphaSG', GuildName: 'Spetsnaz Grail' },
        Victim: { Name: 'EnemigoZvZ', GuildName: 'Otros' } }];
    } else if (u.includes('/gameinfo/guilds/sgg9')) {
      data = { Name: 'Spetsnaz Grail', MemberCount: 60, killFame: 9999999, DeathFame: 5555555, FounderName: 'J4ackSp4rr0w', Founded: '2020-05-01T00:00:00Z', AllianceName: '' };
    } else if (u.includes('/gameinfo/guilds/g9/top')) {
      data = [{ EventId: 81, TimeStamp: '2026-09-05T10:00:00Z', TotalVictimKillFame: 777777,
        Killer: { Name: 'GuildStar', GuildName: 'QA Guild' },
        Victim: { Name: 'GuildVictim', GuildName: 'Otros' } }];
    } else if (u.includes('/gameinfo/guilds/g9')) {
      data = { Name: 'QA Guild', MemberCount: 42, killFame: 123, DeathFame: 456, FounderName: 'Fundador', Founded: '2024-01-01T00:00:00Z', AllianceName: '' };
    } else if (u.includes('/gameinfo/guildmatches/past')) {
      /* GvG históricos: SG defiende y gana Astolot; pierde Dewleaf ante Rival GvG */
      const sg = { Id: 'sgg9', Name: 'Spetsnaz Grail' };
      const rival = { Id: 'riv1', Name: 'Rival GvG' };
      const other = { Id: 'oth1', Name: 'Otros' };
      data = [
        { MatchId: 'm1', StartTime: '2026-09-08T18:00:00Z', Territory: 'Astolot',
          Attacker: rival, Defender: sg, Winner: sg },
        { MatchId: 'm2', StartTime: '2026-09-07T12:00:00Z', Territory: 'Dewleaf',
          Attacker: sg, Defender: other, Winner: other },
        { MatchId: 'm3', StartTime: '2026-09-05T09:00:00Z', Territory: 'Astolot',
          Attacker: other, Defender: sg, Winner: sg },
        { MatchId: 'mx', StartTime: '2026-09-04T09:00:00Z', Territory: 'Unrelated',
          Attacker: rival, Defender: other, Winner: rival },
        /* territorio propio en una zona REAL y posicionada (mapa de guerra:
           distancia en saltos + marca en el minimapa) */
        { MatchId: 'm4', StartTime: '2026-09-06T15:00:00Z', Territory: 'Kindlegrass Steppe',
          Attacker: rival, Defender: sg, Winner: sg },
      ];
    } else if (u.includes('/gameinfo/guildmatches/next')) {
      const sg = { Id: 'sgg9', Name: 'Spetsnaz Grail' };
      const rival = { Id: 'riv1', Name: 'Rival GvG' };
      data = [
        { MatchId: 'n1', StartTime: new Date(Date.now() + 6 * 3600e3).toISOString(),
          Territory: 'Astolot', Attacker: rival, Defender: sg },
        { MatchId: 'n2', StartTime: new Date(Date.now() + 30 * 3600e3).toISOString(),
          Territory: 'Driftwood Hollow', Attacker: sg, Defender: rival },
      ];
    } else if (u.includes('/gameinfo/guildmatches/top')) {
      data = [];
    } else if (u.includes('/gameinfo/events')) {
      /* asesinatos crudos con Victim.ZoneName: 3 en Astolat, 1 en Kindlegrass
         Steppe (el ranking de actividad debe ordenar Astolat primero) */
      const tMin = m => new Date(Date.now() - m * 60e3).toISOString();
      data = [
        { EventId: 201, TimeStamp: tMin(4), TotalVictimKillFame: 44000, BattleId: 9001,
          Killer: { Name: 'EnemyPvP', GuildName: 'Rival GvG', AverageItemPower: 1210 },
          Victim: { Name: 'AlphaSG', GuildName: 'Spetsnaz Grail', ZoneName: 'Astolat', AverageItemPower: 990 } },
        { EventId: 202, TimeStamp: tMin(9), TotalVictimKillFame: 22000, BattleId: 9001,
          Killer: { Name: 'BetaSG', GuildName: 'Spetsnaz Grail', AverageItemPower: 1100 },
          Victim: { Name: 'Foe', GuildName: 'Otros', ZoneName: 'Astolat', AverageItemPower: 1050 } },
        { EventId: 203, TimeStamp: tMin(16), TotalVictimKillFame: 1000, BattleId: 0,
          Killer: { Name: 'X', GuildName: 'Ajenos', AverageItemPower: 800 },
          Victim: { Name: 'Y', GuildName: 'Ajenos', ZoneName: 'Astolat', AverageItemPower: 700 } },
        { EventId: 204, TimeStamp: tMin(50), TotalVictimKillFame: 60000, BattleId: 9002,
          Killer: { Name: 'EnemyPvP', GuildName: 'Rival GvG', AverageItemPower: 1210 },
          Victim: { Name: 'Z', GuildName: 'Errantes', ZoneName: 'Kindlegrass Steppe', AverageItemPower: 980 } },
      ];
    } else if (u.includes('/murderledger/home')) {
      /* testigo de frescura: Murderledger/AlbionOnline2D sincroniza aparte */
      data = {
        last_update: new Date(Date.now() - 3 * 60e3).toISOString(),
        juicy_kills: [
          { time: Math.floor((Date.now() - 6 * 60e3) / 1000), id: 555, total_kill_fame: 900000,
            killer: { name: 'EnemyPvP', guild_name: 'Rival GvG' },
            victim: { name: 'Alguien', guild_name: 'Otros' } },
        ],
        high_rank_cds: [], streamed_fights: [],
      };
    } else if (u.includes('/gameinfo/battles/')) {
      /* detalle de batalla: participantes con IP, gremio y arma (tracker por zona) */
      data = {
        id: 'qb1', clusterName: 'Astolat',
        players: {
          p1: { Name: 'ScoutUno', GuildName: 'Rival GvG', AverageItemPower: 1511.6, Kills: 3, Deaths: 0, KillFame: 45000, Equipment: { MainHand: { Type: 'T8_MAIN_SWORD' } } },
          p2: { Name: 'ScoutDos', GuildName: 'Otros', AverageItemPower: 1384.2, Kills: 1, Deaths: 2, KillFame: 8000, Equipment: { MainHand: { Type: 'T4_2H_BOW' } } },
        },
      };
    } else if (u.includes('/gameinfo/battles')) {
      /* últimas batallas del servidor (tracker por zona: clusterName ∈ mapa + vecinos) */
      data = [
        { id: 'qb1', startTime: new Date(Date.now() - 10 * 60e3).toISOString(), clusterName: 'Astolat',
          totalKills: 7, totalFame: 30000, totalPlayers: 12,
          guilds: { r1: { name: 'Rival GvG', kills: 6, deaths: 1, fame: 25000 }, o1: { name: 'Otros', kills: 1, deaths: 6, fame: 5000 } } },
        { id: 'qb2', startTime: new Date(Date.now() - 90 * 60e3).toISOString(), clusterName: 'Kindlegrass Steppe',
          totalKills: 2, totalFame: 6000, totalPlayers: 4,
          guilds: { r1: { name: 'Rival GvG', kills: 2, deaths: 0, fame: 6000 } } },
        { id: 'qb3', startTime: new Date(Date.now() - 5 * 60e3).toISOString(), clusterName: 'Thetford',
          totalKills: 40, totalFame: 2000000, totalPlayers: 120,
          guilds: { z1: { name: 'ZvZ Ajena', kills: 40, deaths: 40, fame: 2000000 } } },
      ];
    }
  } catch (e) { /* vacío */ }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
};
window.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
window.alert = () => {}; window.confirm = () => true; window.scrollTo = () => {};
window.localStorage.clear();
window.onerror = (m, s, l) => errors.push(`window.onerror: ${m} @${l}`);
window.HTMLElement.prototype.scrollIntoView = function(){};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => window.document.getElementById(id);
const bodyOf = id => ($(id) ? $(id).innerHTML : '(no existe)');
const rowsIn = id => $(id) ? $(id).querySelectorAll('tr').length : -1;
const check = (cond, okMsg, errMsg) => cond ? oks.push(okMsg) : errors.push(errMsg);

(async () => {
  try { window.eval(appjs); oks.push('app.js cargó'); }
  catch (e) { errors.push('CRASH al cargar app.js: ' + e.message); return finish(); }
  await sleep(800); // init: catálogo + datos locales

  // ── COCINA ──
  window.eval(`gotoTab('food')`); await sleep(600);
  check(rowsIn('foodBody') > 5, `Cocina: ${rowsIn('foodBody')} filas`, 'Cocina: tabla vacía → ' + bodyOf('foodBody').slice(0,120));
  // expandir primera fila
  try {
    const tr = $('foodBody').querySelector('tr.clickable');
    if (tr) { tr.click(); await sleep(200);
      check($('foodBody').querySelector('.craft-detail') !== null, 'Cocina: detalle expandido OK', 'Cocina: no se expandió el detalle');
      const regBtns = $('foodBody').querySelectorAll('.craft-detail [data-ll-id]');
      check(regBtns.length >= 2, `Cocina: ${regBtns.length} botones «Registrar» en el detalle`, 'Cocina: faltan botones Registrar en el detalle');
      // favoritos: marcar ★, verificar guardado con nombre en español y panel en Inicio
      const star = $('foodBody').querySelector('.fav-btn');
      if (!star) errors.push('Cocina: falta botón ☆ Favorito');
      else {
        star.click(); await sleep(150);
        const favs = JSON.parse(window.localStorage.getItem('favorites') || '[]');
        check(favs.length === 1 && favs[0].tab === 'food' && !/^T\d_/.test(favs[0].name),
          `Favoritos: guardado con nombre español («${(favs[0] || {}).name}»)`, 'Favoritos: no se guardó o quedó el ID → ' + JSON.stringify(favs));
        window.eval(`gotoTab('home')`); await sleep(150);
        check($('homeFavs').style.display !== 'none' && $('homeFavList').querySelectorAll('.fav-row').length === 1,
          'Favoritos: panel visible en Inicio con 1 fila', 'Favoritos: panel de Inicio no renderiza');
        $('homeFavList').querySelector('.fav-del').click(); await sleep(150);
        check(JSON.parse(window.localStorage.getItem('favorites') || '[]').length === 0 && $('homeFavs').style.display === 'none',
          'Favoritos: quitar desde Inicio oculta el panel', 'Favoritos: no se quitó desde Inicio');
        window.eval(`gotoTab('food')`); await sleep(200);
      } }
  } catch (e) { errors.push('Cocina expandir: ' + e.message); }

  // ── ALQUIMIA ──
  window.eval(`gotoTab('alch')`); await sleep(600);
  check(rowsIn('alchBody') > 5, `Alquimia: ${rowsIn('alchBody')} filas`, 'Alquimia: tabla vacía → ' + bodyOf('alchBody').slice(0,120));

  // ── REFINAMIENTO ──
  window.eval(`gotoTab('refine')`); await sleep(600);
  check(rowsIn('refineBody') > 5, `Refinamiento: ${rowsIn('refineBody')} filas`, 'Refinamiento: vacío → ' + bodyOf('refineBody').slice(0,120));

  // ── CRAFTEO DE EQUIPO ──
  window.eval(`gotoTab('gear')`); await sleep(300);
  try {
    const fam = window.document.querySelector('#gearFamChips .chip[data-fam]');
    if (fam) { fam.click(); await sleep(700);
      check(rowsIn('gearBody') > 2, `Crafteo: rama «${fam.textContent.trim()}» → ${rowsIn('gearBody')} filas`, 'Crafteo: tabla vacía tras elegir rama'); }
    else errors.push('Crafteo: no hay chips de rama');
  } catch (e) { errors.push('Crafteo: ' + e.message); }

  // ── ENCANTADO ──
  window.eval(`gotoTab('enchant')`); await sleep(300);
  try {
    $('enSearch').value = 'arco';
    $('enSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(150);
    const hit = window.document.querySelector('#enResults .sr-item');
    if (!hit) { errors.push('Encantado: búsqueda «arco» sin resultados'); }
    else {
      hit.click(); await sleep(700);
      const res = bodyOf('enResult');
      check(res.includes('nivel') || res.includes('Nivel') || res.length > 300,
        'Encantado: comparación renderizada tras elegir ítem',
        'Encantado: resultado vacío → ' + res.slice(0,150));
      const enReg = $('enResult').querySelectorAll('[data-ll-id]');
      check(enReg.length >= 2, `Encantado: ${enReg.length} botones «Registrar» en el planificador`, 'Encantado: faltan botones Registrar');
    }
  } catch (e) { errors.push('Encantado: ' + e.message); }

  // ── GRANJA ──
  window.eval(`gotoTab('farm')`); await sleep(800);
  check(rowsIn('fmBody') > 5, `Granja: ${rowsIn('fmBody')} filas`, 'Granja: tabla vacía → ' + bodyOf('fmBody').slice(0,150));
  check(($('fmStats')?.textContent || '').length > 10, 'Granja: stats renderizadas', 'Granja: stats vacías');
  try {
    const ftr = $('fmBody').querySelector('tr.clickable');
    if (ftr) { ftr.click(); await sleep(250);
      const fReg = $('fmBody').querySelectorAll('[data-ll-id]');
      check(fReg.length === 2, 'Granja: detalle con 2 botones «Registrar»', `Granja: ${fReg.length} botones Registrar (esperaba 2)`); }
  } catch (e) { errors.push('Granja expandir: ' + e.message); }

  // ── FLIPPING ──
  window.eval(`gotoTab('flip')`); await sleep(300);
  try { window.eval(`document.getElementById('flipRefresh')?.click()`); } catch (e) {}
  await sleep(900);
  check(rowsIn('flipBody') > 5, `Flipping: ${rowsIn('flipBody')} filas`, 'Flipping: vacío → ' + bodyOf('flipBody').slice(0,120));
  // detalle + botones registrar
  try {
    const tr = $('flipBody').querySelector('tr[data-id]');
    if (tr) { tr.click(); await sleep(200);
      const det = bodyOf('flipDetail');
      check(det.includes('Registrar'), 'Flipping: detalle con botones «Registrar»', 'Flipping: detalle sin botones Registrar'); }
  } catch (e) { errors.push('Flipping detalle: ' + e.message); }
  // ruta fija: fijar origen y verificar que la columna «Comprar en» lo respeta
  try {
    check($('flipFrom') && $('flipFrom').options.length === 8 && $('flipTo').options.length === 9,
      'Flipping: 7 orígenes y 8 destinos (incluye Black Market) + automático', 'Flipping: selects de ruta mal poblados');
    $('flipFrom').value = 'Lymhurst';
    $('flipFrom').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(300);
    const r = $('flipBody').querySelector('tr.clickable');
    const buyTd = r ? r.querySelectorAll('td')[2].textContent : '';
    check(buyTd.includes('Lymhurst'), 'Flipping: origen fijo respetado (compra en Lymhurst)', 'Flipping: origen fijo ignorado → ' + buyTd);
    $('flipTo').value = 'Lymhurst';
    $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
    check($('flipFrom').value === '', 'Flipping: colisión origen=destino resetea el otro select', 'Flipping: colisión de ruta no manejada');
    $('flipTo').value = ''; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(200);
    // persistencia de la ruta elegida (flipPrefs)
    $('flipTo').value = 'Brecilien'; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
    const prefs = JSON.parse(window.localStorage.getItem('flipPrefs') || 'null');
    check(prefs && prefs.to === 'Brecilien', 'Flipping: ruta elegida persiste en localStorage', 'Flipping: flipPrefs no guarda la ruta → ' + JSON.stringify(prefs));
    $('flipTo').value = ''; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
  } catch (e) { errors.push('Flipping ruta: ' + e.message); }

  // ── FLIPPING: destino fijo + origen auto → no puede elegir la misma ciudad (regresión) ──
  try {
    const saveFetch = window.fetch;
    window.fetch = (u) => {
      const url = String(u);
      if (url.includes('T4_BAG') && url.includes('prices/')) {
        // Caerleon (el destino fijado) es la MÁS BARATA para comprar: antes del fix
        // el origen auto la tomaba, colisionaba y la fila quedaba en "—"
        const rows = [
          { item_id: 'T4_BAG', city: 'Caerleon', quality: 1, sell_price_min: 450, sell_price_min_date: '2026-09-07T12:00:00', buy_price_max: 400, buy_price_max_date: null },
          { item_id: 'T4_BAG', city: 'Thetford', quality: 1, sell_price_min: 500, sell_price_min_date: null, buy_price_max: 460, buy_price_max_date: null },
          { item_id: 'T4_BAG', city: 'Lymhurst', quality: 1, sell_price_min: 900, sell_price_min_date: null, buy_price_max: 850, buy_price_max_date: null },
        ];
        return Promise.resolve({ ok: true, json: () => Promise.resolve(rows) });
      }
      return saveFetch(u);
    };
    $('flipTo').value = 'Caerleon'; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true }));
    $('flipFrom').value = ''; $('flipFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
    window.eval(`loadFlipPrices(['T4_BAG'])`); await sleep(500);
    const f = window.eval(`flipCalc('T4_BAG')`);
    const expect = Math.round((450 * 0.935 - 500) * 100) / 100; // destino fijo → compra en la siguiente más barata
    check(f.bestBuy && f.bestBuy.city === 'Thetford' && Math.abs(f.profit - expect) < 0.01,
      'Flipping: destino fijo + origen auto descarta el destino (Thetford→Caerleon)',
      'Flipping: colisión destino/origen sin resolver → bestBuy=' + (f.bestBuy && f.bestBuy.city) + ' profit=' + f.profit);
    window.fetch = saveFetch;
    $('flipTo').value = ''; $('flipTo').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
  } catch (e) { errors.push('Flipping destino-fijo: ' + e.message); }

  // ── FLIPPING: filtros de rama/encantamiento sobre los ítems monitoreados (no el buscador) ──
  try {
    window.eval(`gotoTab('flip')`); await sleep(200);
    const rows = () => [...$('flipBody').querySelectorAll('tr[data-id]')].map(tr => tr.dataset.id);
    // catalogRow queda global (function declaration) y cierra sobre CATALOG
    const catOf = id => { const r = window.eval(`catalogRow('${id.split('@')[0]}')`); return r ? r[5] : undefined; };
    const fullCount = rows().length;
    // rama: la tabla queda solo con armas
    $('flipBranch').value = 'weapons';
    $('flipBranch').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
    let ids = rows();
    check(ids.length > 0 && ids.every(id => catOf(id) === 'weapons'),
      `Flipping: filtro Armas deja solo armas en el monitoreo (${ids.length} filas)`,
      'Flipping: el filtro de rama dejó pasar otras ramas → ' + ids.filter(id => catOf(id) !== 'weapons').slice(0, 3).join(', '));
    // rama + encantamiento: solo armas .1
    $('flipEnch').value = '1';
    $('flipEnch').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
    ids = rows();
    check(ids.length > 0 && ids.length < fullCount && ids.every(id => id.endsWith('@1') && catOf(id) === 'weapons'),
      `Flipping: filtro Armas + .1 muestra solo armas .1 (${ids.length} de ${fullCount})`,
      'Flipping: el filtro de encantamiento no acota la tabla → ' + ids.slice(0, 3).join(', '));
    check($('flipStats').textContent.includes('filtro'),
      'Flipping: las stats reflejan el filtro activo',
      'Flipping: stats sin mención del filtro → ' + $('flipStats').textContent.slice(0, 80));
    const prefs = JSON.parse(window.localStorage.getItem('flipPrefs') || 'null');
    check(prefs && prefs.branch === 'weapons' && prefs.ench === '1',
      'Flipping: el filtro persiste en localStorage',
      'Flipping: flipPrefs no guarda el filtro → ' + JSON.stringify(prefs));
    // el buscador NO se filtra: con Armas + .1 activo, «bolsa» igual aparece
    $('flipSearch').value = 'bolsa';
    $('flipSearch').dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(150);
    const srBag = $('flipResults').querySelector('.sr-item[data-id="T4_BAG"]');
    check(!!srBag, 'Flipping: el buscador ignora el filtro (encuentra Bolsa con Armas + .1 activo)',
      'Flipping: el buscador quedó atado al filtro de rama/encantamiento');
    // agregar un ítem que el filtro oculta → toast con atajo para quitarlo
    if (srBag) {
      srBag.click(); await sleep(150);
      const toast = $('waToasts') && $('waToasts').lastElementChild;
      check(!!toast && toast.textContent.includes('filtro'),
        'Flipping: aviso cuando el filtro oculta el ítem recién agregado',
        'Flipping: sin aviso de ítem oculto por el filtro');
      if (toast) { toast.click(); await sleep(150); }
    }
    check($('flipBranch').value === '' && $('flipEnch').value === 'all' && rows().includes('T4_BAG'),
      'Flipping: quitar el filtro restaura la tabla y muestra el ítem agregado',
      'Flipping: el filtro no se quitó o el ítem agregado no aparece');
    // rama sin ítems monitoreados → mensaje claro en vez de tabla muda
    $('flipBranch').value = 'furniture';
    $('flipBranch').dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(150);
    check($('flipBody').textContent.includes('Ningún ítem monitoreado coincide'),
      'Flipping: mensaje claro cuando el filtro no coincide con nada',
      'Flipping: filtro sin resultados no avisa → ' + bodyOf('flipBody').slice(0, 80));
    // botón «Quitar filtro» (el de la fila de aviso) restaura la vista completa
    const clearBtn = $('flipBody').querySelector('[data-clear-filter]');
    (clearBtn || $('flipFilterReset')).click(); await sleep(150);
    check($('flipBranch').value === '' && $('flipEnch').value === 'all' && rows().length > 0,
      'Flipping: quitar el filtro desde la tabla restaura la vista completa',
      'Flipping: el botón de quitar filtro no restaura la tabla');
  } catch (e) { errors.push('Flipping filtros: ' + e.message); }

  // ── ALERTAS DE PRECIO: alta, disparo, re-arma ──
  try {
    window.eval(`gotoTab('alerts')`); await sleep(200);
    check(!!$('waBody') && !!$('waAdd'), 'Alertas: pestaña renderizada', 'Alertas: faltan controles de la pestaña');
    // acceso rápido desde Flipping (prefill por fila)
    window.eval(`waPrefillFlip('T4_BAG')`); await sleep(150);
    check($('waItemInput').value.length > 0, 'Alertas: prefill desde Flipping carga el ítem', 'Alertas: prefill no cargó el ítem');
    $('waMetric').value = 'sell'; $('waMetric').dispatchEvent(new window.Event('change', { bubbles: true }));
    $('waThreshold').value = '100000'; // mock: toda venta vale 1000 → la condición se cumple apenas se chequea
    $('waAdd').click(); await sleep(200);
    let saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
    check(saved.length === 1 && saved[0].metric === 'sell' && saved[0].threshold === 100000 && saved[0].on === true,
      'Alertas: creación persistida en localStorage', 'Alertas: creación falla → ' + JSON.stringify(saved));
    window.eval(`waTick()`); await sleep(700); // verificación forzada
    saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
    check(saved[0].fired === true && saved[0].on === false && saved[0].price === 1000,
      'Alertas: se dispara al cumplirse y se apaga (modo "una vez")', 'Alertas: estado tras check → ' + JSON.stringify(saved[0]));
    check(!!window.document.querySelector('.wa-toast'), 'Alertas: toast visible al disparar', 'Alertas: no se mostró el toast');
    // re-arma al reactivarla
    const btn = window.document.querySelector('[data-wa-on]');
    if (btn) { btn.click(); await sleep(300);
      saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
      check(saved[0].on === true && saved[0].fired === false, 'Alertas: ▶ reactiva y re-arma', 'Alertas: reactivación no re-arma → ' + JSON.stringify(saved[0]));
      const del = window.document.querySelector('[data-wa-del]');
      if (del) { del.click(); await sleep(150);
        saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
        check(saved.length === 0, 'Alertas: eliminación limpia la lista', 'Alertas: no se eliminó la alerta');
      } }
  } catch (e) { errors.push('Alertas: ' + e.message); }

  // ── TWITCH: indicador EN VIVO / OFFLINE en creadores de SG ──
  try {
    check(window.document.querySelectorAll('.sg-creator[data-twitch]').length === 3,
      'Twitch: 3 tarjetas de creador con canal declarado', 'Twitch: cantidad de canales ≠ 3');
    const saveFetch = window.fetch;
    window.fetch = (u) => {
      const url = String(u);
      if (url.includes('/twitch/uptime/j4acksp4rr0w')) return Promise.resolve({ ok: true, text: () => Promise.resolve('2 hours, 5 minutes') });
      if (url.includes('/twitch/uptime/santiagosigma')) return Promise.resolve({ ok: true, text: () => Promise.resolve('santiagosigma is offline') });
      if (url.includes('/twitch/uptime/fraxuzve')) return Promise.resolve({ ok: true, text: () => Promise.resolve('Channel is offline') });
      return saveFetch(u);
    };
    window.eval(`gotoTab('sg')`); await sleep(1600); // 3 checks escalonados (350 ms c/u)
    const badge = chan => window.document.querySelector(`.sg-creator[data-twitch="${chan}"] .sg-live`);
    check(badge('j4acksp4rr0w').classList.contains('live') && badge('j4acksp4rr0w').textContent.includes('EN VIVO')
        && badge('j4acksp4rr0w').textContent.includes('2 h 5 min'),
      'Twitch: badge EN VIVO con tiempo al aire en es-AR', 'Twitch: badge live → ' + badge('j4acksp4rr0w').textContent);
    check(badge('santiagosigma').classList.contains('off') && badge('santiagosigma').textContent.includes('OFFLINE'),
      'Twitch: badge OFFLINE', 'Twitch: badge offline → ' + badge('santiagosigma').textContent);
    check(window.document.querySelector('.sg-creator[data-twitch="j4acksp4rr0w"]').classList.contains('sg-live-on')
        && !window.document.querySelector('.sg-creator[data-twitch="santiagosigma"]').classList.contains('sg-live-on'),
      'Twitch: glow morado solo en la tarjeta en vivo', 'Twitch: glow de tarjeta mal asignado');
    const card = JSON.parse(window.sessionStorage.getItem('twitchLive') || '{}');
    check(card.j4acksp4rr0w && card.j4acksp4rr0w.live === true && card.santiagosigma && card.santiagosigma.live === false,
      'Twitch: estado cacheado en sessionStorage (no parpadea al cambiar de pestaña)', 'Twitch: cache → ' + JSON.stringify(card));
    window.fetch = saveFetch;
  } catch (e) { errors.push('Twitch: ' + e.message); }

  // ── ⚡ ANTI-PAUSA: nunca congelar la app mientras la pestaña está abierta ──
  try {
    check(!!$('kaBtn') && $('kaBtn').classList.contains('ka-on'),
      'Anti-pausa: botón en la barra, activo por defecto', 'Anti-pausa: botón ausente o estado inicial apagado');
    check(window.eval('typeof kaRunDue') === 'function' && window.eval('typeof kaLock') === 'function'
        && window.eval('typeof kaWake') === 'function' && window.eval('typeof kaHush') === 'undefined',
      'Anti-pausa: lock + wake presentes y cero audio (el loop silencioso fue eliminado)', 'Anti-pausa: funciones inesperadas o quedó audio');
    // toggle off → persiste; toggle on → vuelve (verificable por DOM + localStorage)
    $('kaBtn').click(); await sleep(80);
    check(window.localStorage.getItem('kaOn') === '0' && !$('kaBtn').classList.contains('ka-on')
        && $('kaBtn').getAttribute('aria-pressed') === 'false',
      'Anti-pausa: clic lo apaga y persiste en localStorage', 'Anti-pausa: toggle off no aplicó → ' + window.localStorage.getItem('kaOn'));
    $('kaBtn').click(); await sleep(80);
    check(window.localStorage.getItem('kaOn') === '1' && $('kaBtn').classList.contains('ka-on'),
      'Anti-pausa: clic lo reactiva', 'Anti-pausa: toggle on no aplicó');
    // catch-up: con una alerta activa y el tick vencido, kaRunDue dispara waTick YA.
    // se crea la alerta por la UI real y se espían waTick/waSchedule (globales reasignables)
    window.eval('window.__origTick = waTick; window.__origSch = waSchedule; waSchedule = function(){}; waTick = async () => { window.__kaSpy = (window.__kaSpy||0) + 1; };');
    window.eval(`waPrefillFlip('T4_BAG')`); await sleep(120);
    $('waThreshold').value = '100000';
    $('waAdd').click(); await sleep(120);
    const kaAlerts = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
    check(kaAlerts.length === 1 && kaAlerts[0].on === true, 'Anti-pausa: alerta creada por la UI queda activa', 'Anti-pausa: setup de alerta falló → ' + JSON.stringify(kaAlerts));
    window.dispatchEvent(new window.Event('focus')); await sleep(150);
    check(window.eval('window.__kaSpy') === 1, 'Anti-pausa: catch-up dispara el tick vencido al volver', 'Anti-pausa: kaRunDue no re-disparó waTick → spy=' + window.eval('window.__kaSpy'));
    const delBtn = window.document.querySelector('[data-wa-del]');
    if (delBtn) delBtn.click(); await sleep(80);
    window.eval('waTick = window.__origTick; waSchedule = window.__origSch;');
    check(JSON.parse(window.localStorage.getItem('priceAlerts') || '[]').length === 0,
      'Anti-pausa: limpieza del test', 'Anti-pausa: quedó una alerta de test');
  } catch (e) { errors.push('Anti-pausa: ' + e.message); }

  // ── TRANSMUTACIÓN ──
  window.eval(`gotoTab('transmute')`); await sleep(900);
  const trB = window.document.querySelector('#tab-transmute tbody');
  check(trB && trB.querySelectorAll('tr').length > 3, 'Transmutación: tabla poblada', 'Transmutación: tabla vacía');
  try {
    const ttr = trB && trB.querySelector('tr.clickable');
    if (ttr) { ttr.click(); await sleep(250);
      const tReg = trB.querySelectorAll('[data-ll-id]');
      check(tReg.length === 2, 'Transmutación: detalle con 2 botones «Registrar»', `Transmutación: ${tReg.length} botones Registrar (esperaba 2)`); }
  } catch (e) { errors.push('Transmutación expandir: ' + e.message); }

  // ── ARTEFACTOS ──
  window.eval(`gotoTab('meld')`); await sleep(1200);
  const meldB = window.document.querySelector('#tab-meld tbody');
  check(meldB && meldB.querySelectorAll('tr').length > 3, 'Artefactos: tabla poblada', 'Artefactos: tabla vacía');

  // ── BUSCADOR ──
  window.eval(`gotoTab('search')`); await sleep(200);
  try {
    $('psSearch').value = 'espada';
    $('psSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(150);
    const hit = window.document.querySelector('#psResults .sr-item');
    if (!hit) errors.push('Buscador: «espada» sin resultados');
    else {
      hit.click(); await sleep(700);
      const res = bodyOf('psResult');
      check(res.includes('Caerleon') || res.includes('Martlock'), 'Buscador: matriz de ciudades renderizada', 'Buscador: sin matriz → ' + res.slice(0,150));
      const psReg = $('psResult').querySelectorAll('[data-ll-id]');
      check(psReg.length === 0, 'Buscador: sin botones «Registrar» (solo consulta, por pedido del usuario)', `Buscador: ${psReg.length} botones Registrar (esperaba 0)`);
      const hist = JSON.parse(window.localStorage.getItem('psHistory') || '[]');
      check(hist.length === 1, 'Buscador: historial guardado', 'Buscador: historial no se guardó');
    }
  } catch (e) { errors.push('Buscador: ' + e.message); }

  // ── REGISTRO ──
  window.eval(`gotoTab('ledgerlog')`); await sleep(200);
  try {
    window.eval(`llPrefill('T4_BAG','buy',5000,'Martlock')`);
    $('llQty').value = '10';
    $('llAdd').click(); await sleep(100);
    window.eval(`llPrefill('T4_BAG','sell',7000,'Caerleon')`);
    $('llQty').value = '10';
    $('llAdd').click(); await sleep(100);
    const rows = JSON.parse(window.localStorage.getItem('tradeLog') || '[]');
    check(rows.length === 2, 'Registro: 2 operaciones guardadas', `Registro: ${rows.length} filas (esperaba 2)`);
    const stats = $('llStats').textContent;
    check(stats.includes('20.000') || stats.includes('20,000') || stats.includes('20 000'),
      'Registro: P&L = +20.000 correcto (70.000−50.000)', 'Registro: P&L no muestra 20.000 → ' + stats.slice(0,200));
    // CSV (con una nota que parece fórmula: no debe salir ejecutable)
    $('llNoteTxt').value = '=HYPERLINK("http://evil","x")';
    $('llQty').value = 1; $('llPrice').value = 1; $('llAdd').click(); await sleep(100);
    let csvBlob = null;
    window.URL.createObjectURL = (b) => { csvBlob = b; return 'blob:x'; };
    window.URL.revokeObjectURL = () => {};
    $('llExport').click(); await sleep(100);
    check(!!csvBlob, 'Registro: exportación CSV dispara descarga', 'Registro: CSV no generó blob');
    if (csvBlob) {
      const csvTxt = await csvBlob.text();
      check(csvTxt.includes(`"'=HYPERLINK(""http://evil"",""x"")"`) && !csvTxt.includes(',"=HYPERLINK'),
        'Registro: CSV neutraliza celdas que empiezan con fórmula', 'Registro: CSV exporta fórmula ejecutable');
    }
    // quitar la fila de prueba para no alterar los totales de abajo
    const hostileRow = [...$('llBody').querySelectorAll('tr')].find(tr => tr.textContent.includes('HYPERLINK'));
    if (hostileRow) { window.confirm = () => true; hostileRow.querySelector('[data-del]').click(); await sleep(100); }
    check(JSON.parse(window.localStorage.getItem('tradeLog') || '[]').length === 2, 'Registro: fila de prueba CSV eliminada', 'Registro: no pude eliminar la fila de prueba');
    // Respaldo completo
    let bkBlob = null;
    window.URL.createObjectURL = (b) => { bkBlob = b; return 'blob:x'; };
    $('bkExport').click(); await sleep(150);
    if (!bkBlob) errors.push('Registro: respaldo completo no generó archivo');
    else {
      const bkTxt = await bkBlob.text();
      const bk = JSON.parse(bkTxt);
      check(bk.app === 'AyudanteAlbion' && bk.data && bk.data.tradeLog,
        'Registro: respaldo completo incluye tradeLog con formato válido', 'Registro: respaldo malformado');
    }
    check($('bkImport') && $('bkFile'), 'Registro: botón e input de importar respaldo presentes', 'Registro: falta importar respaldo');
    if (bkBlob) {
      const bk = JSON.parse(await bkBlob.text());
      check(!('aaDiscordSession' in bk.data) && !('aaProxy' in bk.data),
        'Registro: el respaldo no incluye sesión de Discord ni URL del proxy', 'Registro: respaldo filtra sesión/proxy');
    }
    // Importar un respaldo hostil: solo entran claves conocidas con JSON válido
    window.confirm = () => true;
    const hostile = { app: 'AyudanteAlbion', version: 1, data: {
      aaDiscordSession: 'eyJ9.falsa', aaProxy: 'https://evil.example', claveAjena: '1',
      favorites: 'no es json', pfSpecs: JSON.stringify({ qaMarca: 1 }),
    } };
    const origReload = window.location.reload;
    let reloaded = false;
    try { Object.defineProperty(window.location, 'reload', { value: () => { reloaded = true; }, configurable: true }); } catch (e) {}
    const evt = new window.Event('change');
    Object.defineProperty(evt, 'target', { value: { files: [new window.File([JSON.stringify(hostile)], 'r.json', { type: 'application/json' })], value: '' } });
    $('bkFile').dispatchEvent(evt); await sleep(300);
    check(!window.localStorage.getItem('aaDiscordSession') && !window.localStorage.getItem('aaProxy') && !window.localStorage.getItem('claveAjena'),
      'Registro: importar respaldo ignora sesión, proxy y claves ajenas', 'Registro: respaldo hostil plantó claves');
    check(window.localStorage.getItem('favorites') !== 'no es json' && !(window.localStorage.getItem('pfSpecs') || '').includes('qaMarca'),
      'Registro: respaldo con un valor que no es JSON se rechaza entero', 'Registro: aplicó un respaldo con valores inválidos');
    // Resumen por ítem: 1 grupo (T4_BAG), P&L +20.000, +2.000/unidad vendida
    window.document.querySelector('#llFilter [data-f="byitem"]').click(); await sleep(150);
    const gRows = $('llBody').querySelectorAll('tr');
    const gTxt = $('llBody').textContent;
    check(gRows.length === 1 && gTxt.includes('+20.000') && gTxt.includes('+2.000'),
      'Registro: resumen por ítem agrupa y calcula P&L +20.000 (+2.000/u)',
      `Registro: resumen por ítem mal → ${gRows.length} filas, ${gTxt.slice(0,150)}`);
    window.document.querySelector('#llFilter [data-f="all"]').click(); await sleep(150);
    check(window.document.querySelector('#llTable thead').textContent.includes('Fecha') && $('llBody').querySelectorAll('tr').length === 2,
      'Registro: vuelta del resumen a la vista cronológica', 'Registro: no restaura la vista normal tras el resumen');
  } catch (e) { errors.push('Registro: ' + e.message); }

  // ── PERFIL ──
  window.eval(`gotoTab('profile')`); await sleep(200);
  try {
    $('pfSearch').value = 'TestPlayer';
    $('pfSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(700);
    const hit = window.document.querySelector('#pfResults .sr-item[data-id]');
    if (!hit) errors.push('Perfil: búsqueda sin resultados');
    else {
      hit.click(); await sleep(900);
      const t = bodyOf('pfResult');
      check(t.includes('1.000.000') || t.includes('1,000,000'), 'Perfil: fama de asesinatos renderizada', 'Perfil: falta killfame');
      check(t.includes('QA Guild') && t.includes('42'), 'Perfil: panel de gremio', 'Perfil: falta gremio');
      check(t.includes('Rival'), 'Perfil: tablas de kills/muertes', 'Perfil: faltan eventos');
      // chips de modo de kills: Mejores (topkills) y En solitario (solokills)
      const chipTop = window.document.querySelector('#pfKillChips [data-kmode="top"]');
      if (!chipTop) errors.push('Perfil: faltan chips de modo de kills');
      else {
        chipTop.click(); await sleep(500);
        check(bodyOf('pfResult').includes('TopVictim'), 'Perfil: chip «Mejores» carga topkills', 'Perfil: topkills no cargó');
        const chipSolo = window.document.querySelector('#pfKillChips [data-kmode="solo"]');
        chipSolo.click(); await sleep(500);
        check(bodyOf('pfResult').includes('SoloVictim'), 'Perfil: chip «En solitario» carga solokills', 'Perfil: solokills no cargó');
        window.document.querySelector('#pfKillChips [data-kmode="recent"]').click(); await sleep(300);
        check(bodyOf('pfResult').includes('Rival'), 'Perfil: vuelta a «Recientes» desde caché', 'Perfil: no volvió a recientes');
      }
      // top semanal del gremio
      const gbtn = $('pfGuildTopBtn');
      if (!gbtn) errors.push('Perfil: falta botón de top semanal del gremio');
      else {
        gbtn.click(); await sleep(500);
        const gbox = $('pfGuildTopBox');
        check(gbox && gbox.style.display !== 'none' && gbox.textContent.includes('GuildVictim'),
          'Perfil: top semanal del gremio renderizado', 'Perfil: top del gremio vacío → ' + (gbox ? gbox.textContent.slice(0,120) : 'sin caja'));
      }
    }
    // especializaciones → FCE y aplicación a Cocina
    const sp = window.document.querySelector('[data-spec="food"]');
    sp.value = '100'; sp.dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(100);
    const ma = window.document.querySelector('[data-mast="food"]');
    ma.value = '100'; ma.dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(200);
    const specTxt = window.document.getElementById('pfSpecList').textContent;
    check(specTxt.includes('28.000'), 'Perfil: FCE 28.000 calculado', 'Perfil: FCE incorrecto');
    const foodSpec = $('foodSpec');
    check(foodSpec && foodSpec.value === '100', 'Perfil: spec aplicada a Cocina', 'Perfil: spec no llegó a Cocina');
  } catch (e) { errors.push('Perfil: ' + e.message); }

  // ── VALIDACIÓN NUMÉRICA independiente: Granja T4 zanahoria ──
  try {
    const farm = JSON.parse(fs.readFileSync('data/farm_data.json', 'utf8'));
    const carrot = farm.find(f => f.id === 'T4_FARM_TURNIP_SEED');
    if (carrot) {
      check(carrot.grow === 79200 && carrot.product && carrot.seedBack > 0,
        `Datos granja: nabo T4 OK (grow 22h, seedBack ${carrot.seedBack})`,
        'Datos granja: nabo T4 inconsistente: ' + JSON.stringify(carrot));
    } else errors.push('Datos granja: no hay T4_FARM_TURNIP_SEED');
    const ench = JSON.parse(fs.readFileSync('data/enchant_data.json', 'utf8'));
    const bow = ench.find(e => e.id === 'T4_2H_BOW');
    check(bow && bow.u.length === 3 && bow.u[0][2] === 384,
      'Datos encantado: arco T4 = 384 fragmentos ✓', 'Datos encantado: arco T4 mal: ' + JSON.stringify(bow));
  } catch (e) { errors.push('Validación de datos: ' + e.message); }


  // ── PRECIO MANUAL: editar un precio en Cocina y verificar recálculo ──
  try {
    window.eval(`gotoTab('food')`); await sleep(300);
    // el detalle debe estar expandido para ver los inputs: asegurarlo
    if (!window.document.querySelector('#foodBody .price-edit')) {
      const crow = window.document.querySelector('#foodBody tr.craft-row');
      if (crow) { crow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(200); }
    }
    const inp = window.document.querySelector('#foodBody .price-edit');
    if (inp) {
      inp.value = '99999';
      inp.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(200);
      const mp = JSON.parse(window.localStorage.getItem('manualPrices') || '{}');
      check(Object.keys(mp).length > 0, 'Precios manuales: override guardado en localStorage', 'Precios manuales: no se guardó el override');
      // el botón ↺ debe borrar el override (regresión: estaba muerto por el guard de .price-edit-wrap)
      const rb = window.document.querySelector('#foodBody .reset-price');
      if (rb) {
        rb.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(250);
        const mp2 = JSON.parse(window.localStorage.getItem('manualPrices') || '{}');
        check(Object.values(mp2).every(v => v !== 99999),
          'Precios manuales: botón ↺ restaura el precio de la API', 'Precios manuales: ↺ no borró el override → ' + JSON.stringify(mp2));
      } else errors.push('Precios manuales: no apareció el botón ↺ tras editar');
    } else warns.push('Precios manuales: no encontré input editable en Cocina (¿detalle no expandido?)');
  } catch (e) { errors.push('Precio manual: ' + e.message); }

  // ── FÓRMULA RRR: verificación numérica independiente ──
  try {
    const rrr = b => b / (1 + b);
    const cases = [[0.18, 0.1525], [0.33, 0.2481], [0.92, 0.4792], [0.77, 0.4350]];
    const bad = cases.filter(([b, exp]) => Math.abs(rrr(b) - exp) > 0.001);
    check(bad.length === 0, 'Fórmula RRR: 4 casos de referencia OK', 'Fórmula RRR: desvíos ' + JSON.stringify(bad));
  } catch (e) { errors.push('RRR: ' + e.message); }

  // ── BOTONES GLOBALES de la barra ──
  try {
    const btns = window.document.querySelectorAll('.top-action[data-tab]');
    check(btns.length === 2, 'Barra superior: 2 botones de navegación', `Barra: ${btns.length} botones (esperaba 2)`);
    btns[0].click(); await sleep(100);
    const active = window.document.querySelector('.tab-panel.active');
    check(active && (active.id === 'tab-search' || active.id === 'tab-ledgerlog'),
      'Barra: botón global navega a su pestaña', 'Barra: botón no navegó, activa=' + (active ? active.id : 'ninguna'));
  } catch (e) { errors.push('Barra: ' + e.message); }

  // ── DATOS: todos los enchant tienen 3 niveles bien formados ──
  try {
    const ench = JSON.parse(fs.readFileSync('data/enchant_data.json', 'utf8'));
    const mal = ench.filter(e => !e.u || e.u.length !== 3 || e.u.some(x => x.length !== 3 || x[2] <= 0));
    check(mal.length === 0, `Datos encantado: ${ench.length} ítems con 3 niveles válidos`, `Datos encantado: ${mal.length} ítems malformados`);
    const farm = JSON.parse(fs.readFileSync('data/farm_data.json', 'utf8'));
    const kinds = {};
    for (const f of farm) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    check(farm.length === 109, `Datos granja: 109 farmables (${JSON.stringify(kinds)})`, `Datos granja: ${farm.length} (esperaba 109)`);
  } catch (e) { errors.push('Datos: ' + e.message); }

  // ── ACCESO DE MIEMBROS SG (Discord) ──
  try {
    await sleep(400); // sgInit: dar tiempo a que /discord/config se resuelva
    check($('sgLoginBtn') && !$('sgLoginBtn').hidden, 'SG: botón «Ingresar con Discord» visible', 'SG: botón de Discord no apareció (¿config sin resolver?)');
    check($('sgRoomBody') !== null, 'SG: Sala de miembros presente en la pestaña SG', 'SG: falta #sgRoomBody');

    // sin sesión → candado en la Sala + gateo del ranking en Perfil
    window.eval(`gotoTab('sg')`); await sleep(200);
    check(!$('sgPanelGuild').hidden && $('sgPanelMembers').hidden,
      'SG: abre por defecto Spetsnaz Grail', 'SG: no abre la información pública por defecto');
    check($('sgPanelGuild').contains(window.document.querySelector('.sg-hero'))
      && $('sgPanelGuild').contains(window.document.querySelector('.sg-creators'))
      && !$('sgPanelGuild').contains($('sgRoom')),
      'SG: información, enlaces y creadores separados del Salón', 'SG: contenido mezclado entre subpestañas');
    check($('sgPanelGuild').querySelectorAll('.sg-links a').length === 2,
      'SG: conserva los enlaces a web y Discord', 'SG: faltan enlaces públicos');
    $('sgTabMembers').click();
    check($('sgPanelGuild').hidden && !$('sgPanelMembers').hidden
      && $('sgTabMembers').getAttribute('aria-selected') === 'true'
      && $('sgTabGuild').tabIndex === -1,
      'SG: clic abre el Salón y actualiza la selección accesible', 'SG: selección del Salón incorrecta');
    const key = (id, key) => $(id).dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    key('sgTabMembers', 'ArrowRight');
    check(!$('sgPanelGuild').hidden && window.document.activeElement === $('sgTabGuild'),
      'SG: flechas cambian de subpestaña y mueven el foco', 'SG: navegación por flechas rota');
    key('sgTabGuild', 'End');
    check(!$('sgPanelMembers').hidden, 'SG: End abre la última subpestaña', 'SG: End no funciona');
    key('sgTabMembers', 'Home');
    check(!$('sgPanelGuild').hidden, 'SG: Home abre la primera subpestaña', 'SG: Home no funciona');
    key('sgTabGuild', 'ArrowLeft');
    window.eval(`gotoTab('home'); gotoTab('sg')`);
    check(!$('sgPanelMembers').hidden, 'SG: recuerda la subpestaña al volver', 'SG: pierde la subpestaña elegida');
    const configuredFetch = window.fetch;
    window.fetch = url => String(url).includes('/discord/config')
      ? Promise.resolve({ ok: true, json: async () => ({ configured: false }) }) : configuredFetch(url);
    window.eval(`sgInit()`); await sleep(100);
    check(bodyOf('sgRoomBody').includes('se está configurando')
      && !$('sgRoomBody').querySelector('[data-sg-login]')
      && bodyOf('sgRoomBody').includes('Exportación'),
      'SG: sin configurar muestra beneficios y aviso, sin login roto', 'SG: estado sin configurar incorrecto');
    window.fetch = configuredFetch;
    window.eval(`sgInit()`); await sleep(100);
    let room = bodyOf('sgRoomBody');
    check(room.includes('Herramientas exclusivas') && room.includes('Ingresar con Discord'),
      'SG: sin sesión muestra el candado con CTA de Discord', 'SG: candado ausente → ' + room.slice(0, 100));
    try {
      window.eval(`gotoTab('profile')`);
      const mb = $('pfMembersBtn');
      if (mb) { mb.click(); await sleep(150);
        check(bodyOf('pfMembersBox').includes('Exclusivo para miembros SG'),
          'SG: ranking de Perfil gateado sin sesión', 'SG: Perfil no gatea el ranking de miembros');
      } else warns.push('SG: no encontré el botón de miembros en Perfil (¿perfil sin gremio cargado?)');
    } catch (e) { errors.push('SG gate Perfil: ' + e.message); }

    // sesión de NO miembro → tarjeta para unirse
    const tokNo = btoa(JSON.stringify({ u: { i: '7', n: 'NoSocio', a: '' }, m: false, t: Date.now(), e: Date.now() + 86400000 })) + '.sig';
    // sesión FORJADA (firma inválida) → el Worker la rechaza y no se activa nada
    const tokFake = btoa(JSON.stringify({ u: { i: '666', n: 'Impostor', a: '' }, m: true, t: Date.now(), e: Date.now() + 86400000 })) + '.firma-falsa';
    const fakeRes = await window.eval(`sgSaveSession('${tokFake}')`);
    check(fakeRes === 'invalid' && !window.eval('sgIsMember()') && $('sgAccount').hidden
      && !window.localStorage.getItem('aaDiscordSession'),
      'SG: sesión forjada sin firma válida es rechazada', 'SG: sesión forjada aceptada → ' + fakeRes);
    // sesión con nombre malicioso: el toast no debe interpretar HTML
    window.eval(`waToast('t', '<img src=x onerror="window.__PWNED=1">')`);
    const toast = window.document.querySelector('.wa-toast:last-child');
    check(toast && !toast.querySelector('img') && toast.textContent.includes('<img'),
      'SG: los toasts muestran el texto tal cual (sin HTML)', 'SG: toast interpreta HTML (XSS)');
    // token en el hash con firma falsa: se limpia la URL y no entra
    window.history.replaceState(null, '', '/#aa_session=' + encodeURIComponent(tokFake));
    window.eval(`sgInit()`); await sleep(150);
    check(!window.location.hash && !window.eval('sgIsMember()'),
      'SG: retorno con token forjado limpia el hash y no abre la Sala', 'SG: token forjado en el hash aceptado');

    await window.eval(`sgSaveSession('${tokNo}')`); await sleep(200);
    room = bodyOf('sgRoomBody');
    check(room.includes('NoSocio') && room.includes('No encontramos'),
      'SG: no-miembro → tarjeta para unirse al Discord', 'SG: tarjeta de no-miembro mal → ' + room.slice(0, 100));
    check($('sgAccount') && !$('sgAccount').hidden, 'SG: chip de cuenta visible con sesión activa', 'SG: chip de cuenta no apareció');

    // El retorno de Discord debe abrir el Salón, incluso para no-miembros.
    window.eval(`gotoTab('sg', 'guild')`);
    window.history.replaceState(null, '', '/#aa_session=' + encodeURIComponent(tokNo));
    window.eval(`sgInit()`); await sleep(200);
    check(!$('sgPanelMembers').hidden && $('tab-sg').classList.contains('active') && !window.location.hash,
      'SG: retorno OAuth de no-miembro abre el Salón y limpia el hash', 'SG: retorno OAuth no abre el Salón');

    // sesión de miembro → Sala completa
    const tokSi = btoa(JSON.stringify({ u: { i: '42', n: 'QAMiembro', a: '' }, m: true, t: Date.now(), e: Date.now() + 86400000 })) + '.sig';
    await window.eval(`sgSaveSession('${tokSi}')`); await sleep(1600);
    room = bodyOf('sgRoomBody');
    check(room.includes('QAMiembro') && room.includes('Ranking de miembros'),
      'SG: miembro verificado entra a la Sala', 'SG: Sala no cargó → ' + room.slice(0, 120));
    check(room.includes('AlphaSG') && room.includes('GammaSG'),
      'SG: ranking con los miembros del gremio', 'SG: ranking sin miembros → ' + room.slice(0, 150));
    check(room.includes('9999999') || room.includes('9.999.999') || room.includes('9,999,999'),
      'SG: stats del gremio (fama)', 'SG: stats del gremio ausentes');
    check(room.includes('EnemigoZvZ'), 'SG: mejores asesinatos de la semana', 'SG: top semanal ausente');
    check(rowsIn('sgRankTable') >= 4, `SG: ${rowsIn('sgRankTable')} filas en el ranking (3 miembros + encabezado)`, 'SG: tabla del ranking sin filas');

    // ── MAPA DE GUERRA ──
    // Antes pedía /guilds/:id/territories (no existe) y el worker lo bloqueaba:
    // siempre decía «sin territorios». Ahora reconstruye dueños desde GvG.
    try {
      const warTab = window.document.querySelector('[data-room-tab="war"]');
      check(!!warTab, 'SG: existe la subpestaña Mapa de Guerra', 'SG: falta data-room-tab=war');
      if (warTab) {
        warTab.click(); await sleep(900);
        const wm = bodyOf('wmContent') || bodyOf('wmMount') || '';
        check(wm.includes('Astolot'),
          'WM: registra el territorio Astolot (GvG ganado por SG)',
          'WM: no aparece Astolot → ' + wm.slice(0, 180));
        check(wm.includes('Dewleaf'),
          'WM: registra Dewleaf (GvG perdido, visible como rival)',
          'WM: no aparece Dewleaf → ' + wm.slice(0, 120));
        check(wm.includes('Driftwood Hollow') || wm.includes('Próxim'),
          'WM: muestra próximos GvG / territorios amenazados',
          'WM: sin próximos GvG → ' + wm.slice(0, 120));
        check(wm.includes('Rival GvG'),
          'WM: tracker de rivales desde kills/GvG',
          'WM: sin rivales → ' + wm.slice(0, 120));
        check(wm.includes('EnemyPvP') || wm.includes('AlphaSG'),
          'WM: lista kills del gremio',
          'WM: sin eventos PvP → ' + wm.slice(0, 120));
        check(!wm.includes('no tiene territorios registrados'),
          'WM: ya no muestra el falso «sin territorios»',
          'WM: sigue el mensaje viejo de sin territorios');
        // filtro «Nuestros»: la grilla de tarjetas solo muestra SG;
        // el historial GvG debajo puede seguir nombrando rivales/Dewleaf.
        const ownedChip = window.document.querySelector('[data-wm-filter="owned"]');
        if (ownedChip) {
          ownedChip.click(); await sleep(120);
          const cards = [...window.document.querySelectorAll('#wmContent .wm-terr-card')]
            .map(c => c.textContent);
          check(cards.length === 2 && cards.some(c => c.includes('Astolot')) && cards.some(c => c.includes('Kindlegrass')) && !cards.some(c => c.includes('Dewleaf')),
            'WM: filtro «Nuestros» deja solo las tarjetas propias (Astolot + Kindlegrass)',
            'WM: filtro owned incorrecto → ' + cards.join(' | ').slice(0, 160));
          const ownedStat = window.document.querySelector('#wmContent .wm-stats .stat .v.pos');
          check(ownedStat && ownedStat.textContent.trim() === '2',
            'WM: stats cuentan 2 territorios propios (Astolot + Kindlegrass)',
            'WM: conteo de propios incorrecto → ' + (ownedStat ? ownedStat.textContent : 'sin stat'));
        } else errors.push('WM: faltan chips de filtro');
        // filtro próximos
        const upChip = window.document.querySelector('[data-wm-filter="upcoming"]');
        if (upChip) {
          upChip.click(); await sleep(120);
          const up = bodyOf('wmContent');
          check(up.includes('Astolot') || up.includes('Driftwood'),
            'WM: filtro «Próximos GvG» lista partidas pendientes',
            'WM: filtro upcoming vacío → ' + up.slice(0, 120));
        }
        // el mapa de guerra quedó solo con lo de SG: el tracker se fue de acá
        check(!bodyOf('wmMount').includes('wmMinimapWrap') && !window.document.getElementById('wmMapSearch'),
          'WM: el Mapa de Guerra ya no incluye el tracker por zona (botones separados)',
          'WM: el tracker sigue adentro del Mapa de Guerra');
        const trackTabBtn = window.document.querySelector('[data-room-tab="tracker"]');
        check(!!trackTabBtn && /Tracker/i.test(trackTabBtn.textContent),
          'SG: existe el botón «Tracker por Zona» junto al de Mapa de Guerra',
          'SG: falta data-room-tab=tracker');

        // ── TRACKER POR ZONA (pestaña propia): minimapa, peligro, rutas, vigilancia, detalle ──
        try {
          const allChip = window.document.querySelector('[data-wm-filter="all"]');
          if (allChip) { allChip.click(); await sleep(120); }
          // atajo desde una tarjeta de territorio → selecciona la zona y saltea al tracker
          const trackBtn = window.document.querySelector('#wmContent [data-wm-goto="Astolot"]');
          check(!!trackBtn, 'WM: cada territorio tiene su atajo 🎯 Rastrear', 'WM: falta el atajo al tracker desde el territorio');
          if (trackTabBtn) { trackTabBtn.click(); await sleep(400); }
          check(!!$('wmTrackerMount') && !$('sgRoomTracker').hidden
              && !!$('wmMinimapWrap') && !!$('wmRouteFrom') && !!$('wmWatchBox'),
            'WZ: panel propio del tracker con buscador, minimapa, rutas y zonas vigiladas',
            'WZ: falta estructura del tracker por zona');
          check(!!window.document.getElementById('wmMapSearch') && !!window.document.getElementById('wmTrackerRefreshBtn'),
            'WZ: buscador de mapas y botón «Actualizar batallas» en su propia pestaña',
            'WZ: faltan controles del tracker');
          await sleep(600); // grafo de mapas
          const svg = $('wmMinimap');
          check(!!svg && svg.querySelectorAll('circle[data-wm-node]').length > 300,
            `WM: minimapa SVG con ${svg ? svg.querySelectorAll('circle[data-wm-node]').length : 0} zonas (worldmapposition)`,
            'WM: minimapa sin nodos');
          check(!!window.document.querySelector('[data-wm-type="outlands78"]'),
            'WM: chips de filtro por tipo de mapa (Outlands T7/T8, Avalon…)',
            'WM: faltan chips de tipo de mapa');
          // seleccionar Astolat vía el buscador
          $('wmMapSearch').value = 'astolat';
          $('wmMapSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
          await sleep(500);
          const pick = window.document.querySelector('#wmMapResults [data-wm-pick]');
          check(!!pick && pick.dataset.wmPick === 'Astolat',
            'WM: buscador de mapas encuentra Astolat', 'WM: buscador sin resultados → ' + bodyOf('wmMapResults').slice(0, 80));
          if (pick) { pick.click(); await sleep(900); }
          const sel = bodyOf('wmSelInfo');
          check(sel.includes('Astolat') && sel.includes('Kindlegrass Steppe') && sel.includes('salto'),
            'WM: info de la zona + territorio SG más cercano en saltos',
            'WM: selInfo sin territorio cercano → ' + sel.slice(0, 140));
          const svg2 = $('wmMinimap'); // el minimapa se repinta al cargar batallas
          check(!!svg2 && svg2.querySelectorAll('.wm-mm-battle').length >= 2,
            'WM: puntos rojos de batallas recientes en el minimapa',
            'WM: sin puntos de batalla en el minimapa');

          const trk = bodyOf('wmTrackerContent');
          check(trk.includes('Batallas en la zona') && trk.includes('Astolat'),
            'WM: tracker lista batallas de la zona seleccionada',
            'WM: tracker vacío → ' + trk.slice(0, 120));
          check(!!$('wmTrackerContent').querySelector('[data-wm-battle]'),
            'WM: filas de batalla expandibles (participantes)', 'WM: sin filas de batalla');
          check(!!$('wmCsvBtn'), 'WM: exportación CSV de batallas filtradas', 'WM: falta botón CSV');
          check(trk.includes('K/D'), 'WM: gremios activos con ratio K/D', 'WM: sin K/D en gremios activos');
          // ── proveedores cruzados: killboard oficial (batallas + asesinatos) + Murderledger ──
          check(trk.includes('Fuentes de datos') && trk.includes('Murderledger'),
            'WM: panel de fuentes de datos con Murderledger/AlbionOnline2D',
            'WM: falta el panel de proveedores → ' + trk.slice(0, 160));
          check(trk.includes('Killboard oficial · asesinatos'),
            'WM: el feed de asesinatos crudos (/events) figura como fuente',
            'WM: falta la fuente de asesinatos');
          check(trk.includes('Datos al día') || trk.includes('demorados'),
            'WM: veredicto de frescura de los proveedores',
            'WM: sin veredicto de frescura → ' + trk.slice(0, 160));
          // ranking de actividad por zona, ordenado por cantidad de kills
          check(trk.includes('Actividad por zona'),
            'WM: ranking de actividad por zona (ordenado por asesinatos)',
            'WM: falta el ranking de actividad');
          const rankRows = $('wmTrackerContent').querySelectorAll('.wm-rank-row');
          check(rankRows.length >= 2 && rankRows[0].dataset.wmGoto === 'Astolat',
            'WM: el ranking ordena por kills (Astolat 3 > vecinos)',
            'WM: ranking mal ordenado → ' + (rankRows.length ? [...rankRows].map(r => r.dataset.wmGoto).join(',') : 'sin filas'));
          // feed de asesinatos crudos con enlaces de verificación externa
          check(trk.includes('Asesinatos recientes en la zona') && trk.includes('AlphaSG') && trk.includes('killboard-1.com'),
            'WM: asesinatos recientes con verificación en KillBoard#1',
            'WM: falta el feed de asesinatos o el enlace a KillBoard#1 → ' + trk.slice(0, 200));
          check(trk.includes('albiononline2d.com'),
            'WM: verificación cruzada con enlace a AlbionOnline2D',
            'WM: falta el enlace a AlbionOnline2D');
          check(!!$('wmKillsCsvBtn'), 'WM: exportación CSV de asesinatos filtrados', 'WM: falta botón CSV de kills');
          // el tracker ya no necesita al Mapa de Guerra: su botón refresca batallas
          $('wmTrackerRefreshBtn').click(); await sleep(900);
          check(bodyOf('wmTrackerContent').includes('Batallas en la zona') && !$('wmTrackerRefreshBtn').disabled,
            'WZ: «Actualizar batallas» refresca desde la propia pestaña',
            'WZ: el refresco propio falló → ' + bodyOf('wmTrackerContent').slice(0, 100));
          // detalle de batalla: /battles/:id con players[]
          const brow = $('wmTrackerContent').querySelector('[data-wm-battle]');
          if (brow) { brow.click(); await sleep(800); }
          const detail = window.document.querySelector('.wm-battle-detail');
          check(!!detail && detail.textContent.includes('ScoutUno') && detail.textContent.includes('Rival GvG'),
            'WM: participantes de la batalla con gremio',
            'WM: detalle de batalla sin participantes → ' + (detail ? detail.textContent.slice(0, 80) : 'sin tabla'));
          check(!!detail && (detail.textContent.includes('1512') || detail.textContent.includes('1.512')),
            'WM: IP de equipo en la tabla de participantes', 'WM: sin IP en el detalle');
          // rutas: Astolat → Martlock
          $('wmRouteFrom').value = 'Astolat';
          $('wmRouteTo').value = 'Martlock';
          $('wmRouteGo').click();
          await sleep(700);
          const route = bodyOf('wmRouteResult');
          check(route.includes('salto') && route.includes('Astolat') && route.includes('Martlock'),
            'WM: ruta calculada con origen y destino',
            'WM: ruta sin calcular → ' + route.slice(0, 120));
          // vigilancia de zona (motor de alertas)
          const watchBtn = $('wmWatchToggle');
          check(!!watchBtn, 'WM: botón «Vigilar» la zona seleccionada', 'WM: falta botón Vigilar');
          if (watchBtn) { watchBtn.click(); await sleep(300); }
          const watch = bodyOf('wmWatchBox');
          check(watch.includes('Astolat') && !!$('wzStatus') && !!$('wzInterval'),
            'WM: zona vigilada con estado y configuración del motor',
            'WM: zona no quedó vigilada → ' + watch.slice(0, 120));
          check(JSON.parse(window.localStorage.getItem('wmZoneAlerts') || 'null').zones.includes('Astolat'),
            'WM: vigilancia persistida en localStorage', 'WM: wmZoneAlerts no se guardó');
          // quitar la vigilancia para no dejar el motor encendido en la suite
          const wzDel = window.document.querySelector('[data-wz-del]');
          if (wzDel) { wzDel.click(); await sleep(200); }
          check(!JSON.parse(window.localStorage.getItem('wmZoneAlerts') || '{"zones":[]}').zones.length,
            'WM: limpieza de la vigilancia de prueba', 'WM: quedó una zona vigilada del test');
          // el minimapa marca la selección y a los vecinos
          const svg3 = $('wmMinimap');
          check(!!svg3 && !!svg3.querySelector('.wm-mm-sel') && svg3.querySelector('.wm-mm-sel').dataset.wmNode === 'Astolat',
            'WM: nodo seleccionado en verde', 'WM: sin nodo seleccionado en el minimapa');
          check(!!svg3 && svg3.querySelectorAll('.wm-mm-nb').length >= 2,
            'WM: vecinos en amarillo', 'WM: sin vecinos marcados');
          // ?map=Nombre → cae directo en el Tracker por Zona, no en el Mapa de Guerra
          const prevZone = $('wmMapSearch') ? $('wmMapSearch').value : '';
          window.history.replaceState(null, '', '/?map=Martlock');
          window.document.querySelector('[data-room-tab="summary"]').click(); await sleep(150);
          check(window.eval('wmApplySharedZone()') === true,
            'WZ: el enlace con ?map= se reconoce y se aplica', 'WZ: ?map= no se aplicó');
          const activeBtn = window.document.querySelector('.sg-room-tab.active');
          const deepPanel = $('sgRoomTracker');
          check(!!activeBtn && activeBtn.dataset.roomTab === 'tracker'
              && !!deepPanel && !deepPanel.hidden && $('sgRoomWar').hidden,
            'WZ: ?map= abre la pestaña del tracker (no el Mapa de Guerra)',
            'WZ: ?map= abrió otra pestaña → ' + (activeBtn ? activeBtn.dataset.roomTab : 'sin tab activo'));
          check(!!$('wmMapSearch') && $('wmMapSearch').value === 'Martlock'
              && window.location.search.includes('map=Martlock'),
            'WZ: el enlace compartido deja la zona cargada en el buscador',
            'WZ: la zona del enlace no llegó al buscador');
          window.history.replaceState(null, '', '/');
          if (prevZone) { window.eval('wmSelectMap(' + JSON.stringify(prevZone) + ')'); await sleep(300); }
        } catch (e) { errors.push('WM tracker por zona: ' + e.message); }
        // volver a Resumen para no romper el resto de la suite
        const sumTab = window.document.querySelector('[data-room-tab="summary"]');
        if (sumTab) { sumTab.click(); await sleep(200); }
      }
    } catch (e) { errors.push('WM mapa de guerra: ' + e.message); }

    // ── COMPOSITOR DE BUILDS: ítems planos y encantados .1–.4 ──
    try {
      const bdTab = window.document.querySelector('[data-room-tab="builds"]');
      check(!!bdTab, 'BD: existe la subpestaña Builds en el Salón', 'BD: falta data-room-tab=builds');
      if (bdTab) {
        bdTab.click(); await sleep(150);
        check(!!$('bdMount'), 'BD: panel de builds montado', 'BD: falta #bdMount');
        $('bdNewBtn').click(); await sleep(120);
        check(!!$('bdNameInput') && !!window.document.querySelector('[data-bd-pick="mainHand"]'),
          'BD: el editor abre con los 8 slots', 'BD: editor sin slots');
        // selector del arma: debe ofrecer plano y .1 a .4
        window.document.querySelector('[data-bd-pick="mainHand"]').click(); await sleep(120);
        const ms = $('bdModalSearch');
        check(!!ms && !!$('bdModalList'), 'BD: modal del selector de ítems', 'BD: no abre el modal del selector');
        if (ms) {
          ms.value = 'T6_MAIN_SWORD';
          ms.dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(120);
          const opts = [...window.document.querySelectorAll('#bdModalList [data-bd-select]')].map(el => el.dataset.bdSelect);
          check(opts.includes('T6_MAIN_SWORD') && opts.includes('T6_MAIN_SWORD@1')
              && opts.includes('T6_MAIN_SWORD@2') && opts.includes('T6_MAIN_SWORD@3')
              && opts.includes('T6_MAIN_SWORD@4'),
            'BD: el selector ofrece el ítem plano y .1–.4',
            'BD: faltan variantes de encantamiento → ' + opts.slice(0, 8).join(', '));
          check(bodyOf('bdModalList').includes('.2') && bodyOf('bdModalList').includes('T6.2'),
            'BD: las variantes muestran sufijo .N y tier T6.N', 'BD: meta de variantes sin .N');
          // elegir la .2 → el slot debe mostrar nombre e id encantados
          const opt2 = window.document.querySelector('#bdModalList [data-bd-select="T6_MAIN_SWORD@2"]');
          check(!!opt2, 'BD: se puede elegir la variante .2', 'BD: no existe la opción .2');
          if (opt2) { opt2.click(); await sleep(120); }
          const editor = bodyOf('bdMount');
          check(editor.includes('Espada ancha del maestro .2') && editor.includes('T6_MAIN_SWORD@2'),
            'BD: el slot muestra el ítem encantado (nombre .2 + id @2)',
            'BD: slot sin encantamiento → ' + editor.slice(0, 160));
          // el costo consulta la variante exacta y la alerta vigila ese id
          $('bdCalcBtn').click(); await sleep(700);
          const cost = bodyOf('bdCostBox');
          check(cost.includes('Espada ancha del maestro .2') && /1[.,]000/.test(cost),
            'BD: el costo total se calcula sobre la variante encantada',
            'BD: costo sin calcular → ' + cost.slice(0, 140));
          const ab = $('bdAlertBtn');
          check(!!ab, 'BD: botón de alerta de precio de la build', 'BD: falta el botón de alerta');
          if (ab) {
            ab.click(); await sleep(120);
            // WA es léxico al eval de app.js: el estado se lee del localStorage (como la sección de Alertas)
            const saved = JSON.parse(window.localStorage.getItem('priceAlerts') || '[]');
            check(saved.some(a => a.id === 'T6_MAIN_SWORD@2'),
              'BD: la alerta vigila el id encantado @2', 'BD: la alerta no quedó sobre el id @2 → ' + JSON.stringify(saved.map(a => a.id)));
            // limpieza para no dejar la alerta de la build en la suite
            window.localStorage.setItem('priceAlerts',
              JSON.stringify(saved.filter(a => !String(a.id).startsWith('T6_MAIN_SWORD'))));
          }
        }
        // volver a Resumen para no romper el resto de la suite
        const sumTab2 = window.document.querySelector('[data-room-tab="summary"]');
        if (sumTab2) { sumTab2.click(); await sleep(150); }
      }
    } catch (e) { errors.push('BD builds encantadas: ' + e.message); }

    // filtro por nombre
    const rs = $('sgRankSearch');
    if (rs) {
      rs.value = 'alpha'; rs.dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(150);
      const flt = bodyOf('sgRankTable');
      check(flt.includes('AlphaSG') && !flt.includes('BetaSG'), 'SG: filtro del ranking funciona', 'SG: filtro no filtró');
      rs.value = ''; rs.dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(150);
    } else errors.push('SG: falta el buscador del ranking');

    // orden por columna
    const thName = window.document.querySelector('[data-sg-sort="name"]');
    if (thName) { thName.click(); await sleep(150);
      const first = window.document.querySelector('#sgRankTable tbody tr td:nth-child(2)');
      check(first && first.textContent.includes('AlphaSG'), 'SG: orden alfabético al tocar la columna', 'SG: sort por nombre no ordena');
    } else errors.push('SG: falta columna ordenable «Jugador»');

    // El acceso desde la cuenta apunta al Salón, no al contenido público.
    $('sgTabGuild').click();
    $('sgAccountBtn').click();
    window.document.querySelector('[data-sg-goto-room]').click();
    check(!$('sgPanelMembers').hidden && $('sgAccountMenu').hidden,
      'SG: acceso de la cuenta abre el Salón y cierra el menú', 'SG: acceso desde la cuenta incorrecto');
    window.eval(`gotoTab('home')`);
    window.document.querySelector('.sg-credit').click();
    check(!$('sgPanelGuild').hidden && $('sgPanelMembers').hidden,
      'SG: enlace del inicio abre la información del gremio', 'SG: enlace del inicio no abre Spetsnaz Grail');
    window.history.replaceState(null, '', '/#aa_session=' + encodeURIComponent(tokSi));
    window.eval(`sgInit()`); await sleep(200);
    check(!$('sgPanelMembers').hidden && bodyOf('sgRoomBody').includes('Ranking de miembros'),
      'SG: retorno OAuth de miembro abre sus herramientas', 'SG: retorno de miembro incorrecto');

    // vínculo de personaje: rechaza a un jugador de otro gremio y acepta a uno de SG
    const ci = $('sgCharInput');
    if (ci) {
      ci.value = 'TestPlayer';
      window.eval(`document.getElementById('sgCharBtn').click()`); await sleep(800);
      check(bodyOf('sgCharBox').includes('no en Spetsnaz Grail'),
        'SG: vínculo rechaza personajes de otro gremio', 'SG: vínculo aceptó a un jugador ajeno → ' + bodyOf('sgCharBox').slice(0, 90));
      const ci2 = $('sgCharInput');
      if (ci2) {
        ci2.value = 'Gamma';
        window.eval(`document.getElementById('sgCharBtn').click()`); await sleep(800);
        const linked = bodyOf('sgRoomBody');
        check(linked.includes('GammaSG') && linked.includes('(vos)'),
          'SG: personaje vinculado queda marcado «(vos)»', 'SG: vínculo no marcó la fila → ' + linked.slice(0, 100));
        check(window.document.querySelector('#sgRankTable tr.sg-me') !== null, 'SG: fila del personaje vinculado destacada', 'SG: fila sg-me ausente');
      }
    } else errors.push('SG: falta el formulario de vínculo de personaje');

    // CSV del ranking
    const csv = String(window.eval('sgMembersCSV()'));
    check(csv.startsWith('puesto,jugador') && csv.includes('AlphaSG'), 'SG: CSV del ranking bien formado', 'SG: CSV mal → ' + csv.slice(0, 60));

    // menú de cuenta + cierre de sesión
    window.eval(`document.getElementById('sgAccountBtn').click()`); await sleep(150);
    check(!$('sgAccountMenu').hidden && bodyOf('sgAccountMenu').includes('Cerrar sesión'),
      'SG: menú de cuenta con cierre de sesión', 'SG: menú de cuenta no abre');
    window.eval(`sgLogout()`); await sleep(200);
    check(!$('sgLoginBtn').hidden && bodyOf('sgRoomBody').includes('Herramientas exclusivas'),
      'SG: al cerrar sesión vuelve el candado', 'SG: logout no restauró el candado');

    // el botón de la barra tiene que dispara el ingreso (antes no tenía handler)
    try {
      window.eval(`window.__dcHits = 0; sgLogin = function () { window.__dcHits++; }`);
      $('sgLoginBtn').click(); await sleep(60);
      check(window.__dcHits === 1, 'SG: el botón «Ingresar con Discord» de la barra dispara el ingreso',
        'SG: el botón de la barra no hizo nada (falta data-sg-login en #sgLoginBtn)');
      const cta = window.document.querySelector('.sg-lock-card [data-sg-login]');
      check(!!cta, 'SG: la tarjeta de candado mantiene su CTA de Discord', 'SG: sin CTA en sgLockCard');
    } catch (e) { errors.push('SG botón de barra: ' + e.message); }
    window.eval(`gotoTab('sg', 'guild')`);
    window.history.replaceState(null, '', '/#aa_error=discord');
    window.eval(`sgInit()`); await sleep(100);
    check(!$('sgPanelMembers').hidden && !window.location.hash
      && bodyOf('sgRoomBody').includes('Ingresar con Discord'),
      'SG: error OAuth vuelve al Salón para reintentar', 'SG: error OAuth deja al usuario fuera del Salón');
  } catch (e) { errors.push('Acceso SG: ' + e.message); }

  /* ——— íconos: que ningún <use> quede colgado y que los SVG tengan estilo ——— */
  try {
    const broken = window.eval(`(() => {
      const miss = [...document.querySelectorAll('use')]
        .map(u => u.getAttribute('href') || '')
        .filter(h => h.startsWith('#') && !document.getElementById(h.slice(1)));
      return [...new Set(miss)].join(' ');
    })()`);
    check(!broken, 'Íconos: cada <use href="#…"> tiene su <symbol> definido', 'Íconos colgados → ' + broken);

    const tabIcons = window.eval(`document.querySelectorAll('.tab .tab-ico').length`);
    check(tabIcons >= 6, `Íconos: ${tabIcons} pestañas de la barra con ícono`, 'Íconos: las pestañas de la barra van sin ícono');

    const chips = window.eval(`document.querySelectorAll('.chip-ico svg, .sg-lock-ico svg').length`);
    check(chips >= 12, `Íconos: ${chips} fichas de ícono SVG pintadas`, 'Íconos: hay menos fichas de las esperadas');

    // un <svg> de línea sin class pierde el stroke y sale negro sobre fondo oscuro
    const sueltos = window.eval(`[...document.querySelectorAll('svg')].filter(s =>
      s.querySelector('use') && !s.getAttribute('class') && !s.closest('.chip-ico')
      && !s.closest('.sg-lock-ico') && !s.closest('.top-action') && !s.closest('.sg-dc-svg')).length`);
    check(sueltos === 0, 'Íconos: ningún svg de línea sin clase de estilo', 'Íconos invisibles: ' + sueltos + ' svg sin class');
  } catch (e) { errors.push('Íconos: ' + e.message); }

  /* ——— creadores de SG: el indicador va debajo de la foto ——— */
  try {
    // .sg-live cambia a «sg-live live|off» cuando el badge se pinta: se compara la clase base
    const orden = window.eval(`[...document.querySelector('.sg-creator[data-twitch]').children].map(e => e.className.split(' ')[0]).join('>')`);
    check(orden === 'sg-creator-pic>sg-live>sg-creator-name>sg-creator-title>sg-creator-handle',
      'Creadores: indicador EN VIVO/OFFLINE debajo de la foto', 'Creadores: orden de la tarjeta → ' + orden);
    const sinBadge = window.eval(`[...document.querySelectorAll('.sg-creator:not([data-twitch]) .sg-live')].length`);
    check(sinBadge === 0, 'Creadores: «Próximamente» no lleva indicador de directo', 'Creadores: badge sobrante en la tarjeta bloqueada');
  } catch (e) { errors.push('Creadores: ' + e.message); }

  // Inicio: dos slides manuales con los mismos grupos que la navegación.
  try {
    window.eval(`gotoTab('home')`);
    check(window.document.querySelectorAll('.home-slide').length === 2
      && !$('homeCraftSlide').hidden && $('homeFlipSlide').hidden,
      'Inicio: dos slides y Crafteo visible por defecto', 'Inicio: slides o estado inicial incorrectos');
    const tools = id => [...$(id).querySelectorAll('[data-goto]')].map(b => b.dataset.goto).join(',');
    check(tools('homeCraftSlide') === 'gear,refine,alch,food,enchant,farm'
      && tools('homeFlipSlide') === 'flip,transmute,meld,alerts',
      'Inicio: herramientas agrupadas como en el menú superior', 'Inicio: herramientas mal agrupadas');
    $('homeSlideNext').click();
    check($('homeCraftSlide').hidden && !$('homeFlipSlide').hidden
      && $('homeFlipTab').getAttribute('aria-selected') === 'true'
      && $('homeCraftTab').tabIndex === -1 && $('homeSlideCount').textContent === '2 de 2',
      'Inicio: siguiente muestra Flipping y actualiza controles accesibles', 'Inicio: siguiente no actualiza el slide');
    $('homeSlideNext').click();
    check(!$('homeCraftSlide').hidden, 'Inicio: siguiente vuelve al primer slide', 'Inicio: navegación circular rota');
    $('homeSlidePrev').click();
    check(!$('homeFlipSlide').hidden, 'Inicio: anterior vuelve al último slide', 'Inicio: anterior no funciona');
    $('homeCraftTab').click();
    check(!$('homeCraftSlide').hidden, 'Inicio: selector abre Crafteo directamente', 'Inicio: selector no funciona');
    const key = (id, key) => $(id).dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    key('homeCraftTab', 'ArrowRight');
    check(!$('homeFlipSlide').hidden && window.document.activeElement === $('homeFlipTab'),
      'Inicio: flechas del teclado cambian slide y foco', 'Inicio: navegación con teclado rota');
    key('homeFlipTab', 'Home');
    check(!$('homeCraftSlide').hidden, 'Inicio: Home abre el primer slide', 'Inicio: Home no funciona');
    key('homeCraftTab', 'End');
    check(!$('homeFlipSlide').hidden, 'Inicio: End abre el último slide', 'Inicio: End no funciona');
    key('homeFlipTab', 'ArrowLeft');
    check(!$('homeCraftSlide').hidden, 'Inicio: flecha izquierda abre Crafteo', 'Inicio: flecha izquierda no funciona');
    for (const [tab, slide] of [['homeCraftTab', 'homeCraftSlide'], ['homeFlipTab', 'homeFlipSlide']]) {
      $(tab).click();
      for (const button of $(slide).querySelectorAll('[data-goto]')) {
        button.querySelector('.home-tool-name').click();
        check($('tab-' + button.dataset.goto).classList.contains('active'),
          'Inicio: acceso a ' + button.dataset.goto, 'Inicio: no abre ' + button.dataset.goto);
        window.eval(`gotoTab('home')`);
        check(!$(slide).hidden, 'Inicio: conserva el slide al volver de ' + button.dataset.goto,
          'Inicio: pierde el slide al volver de ' + button.dataset.goto);
      }
    }
    const shortcuts = window.document.querySelectorAll('.home-shortcuts [data-goto]');
    check(shortcuts.length === 4, 'Inicio: cuatro accesos rápidos, sin fichas adicionales', 'Inicio: faltan accesos rápidos');
    for (const button of shortcuts) {
      button.click();
      check($('tab-' + button.dataset.goto).classList.contains('active'),
        'Inicio: acceso rápido a ' + button.dataset.goto, 'Inicio: acceso rápido roto a ' + button.dataset.goto);
      window.eval(`gotoTab('home')`);
    }
    // CTA de la comunidad: lleva al Discord de la app (no al del gremio) y se apila bajo el crédito.
    const community = window.document.querySelector('.home-community');
    const credit = window.document.querySelector('.sg-credit');
    const heroLinks = window.document.querySelector('.home-hero-links');
    check(!!community && community.href === 'https://discord.gg/FH3RzqMPA4'
      && community.target === '_blank' && community.rel.includes('noopener')
      && community.textContent.includes('Comunidad de') && !!community.querySelector('.discord-logo'),
      'Inicio: la pastilla de Discord apunta al server de Ayudante Albion',
      'Inicio: falta la pastilla de Discord o apunta a otro server');
    check(!!community && community.parentElement === heroLinks && credit.parentElement === heroLinks
      && credit !== community && (credit.compareDocumentPosition(community) & 4) === 4,
      'Inicio: la pastilla queda debajo del crédito del gremio',
      'Inicio: la pastilla de Discord no está apilada bajo el crédito del gremio');
    $('homeCraftTab').click();
  } catch (e) { errors.push('Inicio slides: ' + e.message); }

  // Reporte de bugs: enlace público, voluntario y sin datos de sesión.
  try {
    const report = $('homeReportBug');
    const url = new URL(report.href);
    const template = fs.readFileSync('../.github/ISSUE_TEMPLATE/bug_report.md', 'utf8').split('---\n\n')[1];
    check($('tab-home').lastElementChild.contains(report),
      'Reportes: botón al final de Inicio', 'Reportes: botón fuera del pie de Inicio');
    check(url.origin === 'https://github.com' && url.pathname === '/AyudanteAlbion/AyudanteAlbion.github.io/issues/new',
      'Reportes: abre un issue del repositorio correcto', 'Reportes: destino incorrecto');
    check(url.searchParams.get('title') === '[Bug] ' && url.searchParams.get('body') === template,
      'Reportes: título y plantilla en español precargados', 'Reportes: contenido distinto de la plantilla');
    check(report.target === '_blank' && report.rel.includes('noopener') && report.rel.includes('noreferrer'),
      'Reportes: nueva pestaña sin acceso a la app ni referrer', 'Reportes: enlace externo sin protección');
    check([...url.searchParams.keys()].join(',') === 'title,body'
      && $('homeReportNote').textContent.includes('público') && template.includes('No incluyas contraseñas'),
      'Reportes: aviso de privacidad y sin diagnóstico automático', 'Reportes: falta aviso o se agregaron parámetros');
  } catch (e) { errors.push('Reportes: ' + e.message); }

  // Limpieza de textos y terminología de crafteo.
  const removedCopy = [
    'Exclusivo para miembros verificados del Discord de SG',
    'Se abre Discord, autorizás',
    'El registro se guarda en este navegador (localStorage).',
    'Bonos de crafteo por ciudad (+15% además del +18% base)',
    'Cada parcela aloja 9 unidades.',
  ];
  check(removedCopy.every(text => !window.document.body.textContent.includes(text)),
    'Textos: se eliminaron las cinco explicaciones solicitadas', 'Textos: queda alguna explicación eliminada');
  check($('gearFamSearch').placeholder.startsWith('Buscar rama')
    && $('gearScan').textContent.includes('todas las ramas')
    && !/familia/i.test($('tab-gear').textContent),
    'Crafteo: buscador, escaneo y ayudas usan rama/ramas', 'Crafteo: terminología de rama incompleta');

  finish();

  function finish() {
    console.log('\n════════ RESULTADO QA ════════');
    for (const o of oks) console.log('  ✓', o);
    for (const w of warns) console.log('  ⚠', w);
    if (errors.length) { console.log('\n  ── ERRORES ──'); for (const e of errors) console.log('  ✗', e); }
    console.log(`\n${oks.length} OK · ${warns.length} avisos · ${errors.length} errores`);
    process.exit(errors.length ? 1 : 0);
  }
})();
