/* Ayudante Albion — interfaz de la pestaña Sesión (edición de escritorio).
 *
 * Dibuja el estado de la sesión y el medidor de daño con los datos que llegan
 * del ejecutable. Si la app corre en la web, el módulo pinta el aviso de
 * «solo escritorio» y no hace nada más.
 */
(function (root) {
  'use strict';

  var EXE_URL = 'https://github.com/AyudanteAlbion/AyudanteAlbion.github.io/releases/latest';
  var mounted = false;
  var latest = null;
  var dirty = false;
  var diagOn = false;
  var diagTimer = null;
  var detectingCharacter = false;

  function el(id) { return document.getElementById(id); }

  function num(value) {
    if (root.AAFormat && typeof AAFormat.silver === 'function') return AAFormat.silver(value);
    return new Intl.NumberFormat('es-AR').format(Math.round(value || 0));
  }

  function clock(seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(r);
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Photon envía el ID interno del cluster (por ejemplo, 0006); el índice
  // oficial local lo traduce al texto real que ve el personaje en el mapa.
  function mapName(value) {
    if (root.AATrackerMaps && typeof root.AATrackerMaps.display === 'function') {
      return root.AATrackerMaps.display(value);
    }
    return value || 'Ubicación no detectada';
  }

  /* Cartel para la web pública: la pestaña Sesión está en desarrollo en la
     aplicación de escritorio y no ofrece funciones desde el navegador. */
  function renderWebNotice(panel, info) {
    panel.innerHTML = '' +
      '<div class="card trk-card trk-wip">' +
      '  <div class="trk-wip-badge">🚧 En desarrollo en App de Escritorio</div>' +
      '  <h2>Sesión en vivo</h2>' +
      '  <p class="muted">Esta sección está <strong>en desarrollo en la App de Escritorio</strong> ' +
      '  y no está disponible desde el navegador.</p>' +
      '  <p>El <strong>medidor de daño</strong>, el historial de mapas, la fama y la plata por hora ' +
      '  y el registro de botín necesitan leer el tráfico del juego en tu PC. ' +
      '  El navegador no puede hacerlo, así que estas funciones viven en la ' +
      '  <strong>App de Escritorio</strong>.</p>' +
      '  <p><a class="btn" href="' + EXE_URL + '" target="_blank" rel="noopener">Descargar la App de Escritorio</a></p>' +
      '  <p class="muted small">Solo monitorea el tráfico de red: no modifica el cliente del juego, ' +
      '  no dibuja nada encima y no ve jugadores fuera de tu campo de visión.</p>' +
      '</div>';
  }

  /* Interfaz completa de la edición Tracker. */
  function renderShell(panel) {
    panel.innerHTML = '' +
      '<div class="trk-dashboard-head">' +
      '  <div><span class="trk-eyebrow">CAPTURA DE RED · UDP 5055, 5056 Y 5058</span><h1>Seguimiento en tiempo real</h1><p class="muted">Estado del cliente de Albion Online y métricas de la sesión actual.</p></div>' +
      '  <button class="btn ghost" id="trkOpenSetup" type="button">Guía de configuración</button>' +
      '</div>' +
      '<div class="card trk-card trk-state-card">' +
      '  <div class="trk-head"><div><span class="trk-eyebrow">ESTADO</span><h2>Conexión con el juego</h2></div><span class="trk-live-badge" id="trkLiveBadge"><i></i> En espera</span></div>' +
      '  <div class="trk-state-grid" id="trkStateGrid"></div>' +
      '</div>' +
      '<div class="card trk-card">' +
      '  <div class="trk-head">' +
      '    <div><span class="trk-eyebrow">SESIÓN</span><h2>Sesión en vivo</h2></div>' +
      '    <div class="trk-actions">' +
      '      <button class="btn primary" id="trkToggle" type="button">Activar tracking</button>' +
      '      <button class="btn ghost" id="trkRefreshCharacter" type="button" title="Vuelve a leer el personaje sin cortar la captura de red. Si todavía no hay personaje, cerrá sesión en Albion y volvé a entrar.">↻ Detectar de nuevo</button>' +
      '      <button class="btn ghost" id="trkReset" type="button" title="Pone en cero los contadores de la sesión (fama, plata, daño y botín). No toca la captura ni el personaje.">Reiniciar sesión</button>' +
      '      <button class="btn ghost" id="trkCopy" type="button">Copiar ranking</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="trk-status" id="trkStatus" role="status">Tracking detenido.</div>' +
      '  <p class="trk-note"><b>Detectar de nuevo</b> vuelve a leer el personaje sin cortar la captura. <b>Reiniciar sesión</b> pone en cero los contadores. Si el personaje todavía no aparece, cerrá sesión en Albion y volvé a entrar: el JoinResponse es la única fuente de identidad.</p>' +
      '  <div class="trk-kpis" id="trkKpis"></div>' +
      '</div>' +
      '<div class="trk-split trk-config-split">' +
      ' <div class="card trk-card trk-config-card">' +
      '  <div class="trk-head"><div><span class="trk-eyebrow">SEGUIMIENTO</span><h3>Configuración de red</h3></div><label class="trk-switch"><input id="trkTrackingSwitch" type="checkbox"><span></span></label></div>' +
      '  <p class="trk-switch-label" id="trkSwitchLabel">El rastreo está inactivo</p>' +
      '  <div class="trk-form-grid">' +
      '   <label>Proveedor de paquetes<select id="trkProvider"><option value="npcap">Npcap (tracking real recomendado)</option><option value="socket">Socket (tracking real · requiere administrador)</option><option value="demo">Demo explícita (NO es tracking real)</option></select><small>Nunca se cambia a demo automáticamente si falla una captura real.</small></label>' +
      '   <label>Adaptador de red<select id="trkAdapter"><option value="">Automático · escuchar todos</option></select><small>Dejá Automático si no sabés qué interfaz usa el juego.</small></label>' +
      '   <label class="trk-full">Filtro de personaje<input id="trkCharacterName" type="text" maxlength="32" placeholder="Todos los personajes detectados"><small>Filtro real del backend: si el JoinResponse detecta otro personaje, no se acepta ninguna métrica.</small></label>' +
      '  </div>' +
      '  <button class="btn" id="trkRestartNetwork" type="button">↻ Reiniciar seguimiento de red</button>' +
      '  <p class="trk-note">Npcap usa un controlador de bajo nivel. Socket no necesita Npcap, pero exige ejecutar la herramienta como administrador.</p>' +
      ' </div>' +
      ' <div class="card trk-card trk-config-card">' +
      '  <div><span class="trk-eyebrow">AJUSTES GENERALES</span><h3>Aplicación</h3></div>' +
      '  <div class="trk-form-grid">' +
      '   <label>Idioma<select id="trkLanguage"><option value="es-ES">Spanish (Spain) · 100,00%</option></select><small>Requiere reiniciar la herramienta.</small></label>' +
      '   <label>Visibilidad de navegación<select id="trkNavVisibility"><option value="all">Mostrar todas las pestañas</option><option value="compact">Vista compacta</option></select></label>' +
      '   <label>Notificaciones<select id="trkNotifications"><option value="important">Solo importantes</option><option value="all">Todas</option><option value="none">Desactivadas</option></select></label>' +
      '   <label>Proxy<input id="trkProxy" type="text" placeholder="http://servidor:puerto"></label>' +
      '   <label class="trk-full">Ruta de la carpeta del juego<div class="trk-path-row"><input id="trkGamePath" type="text" placeholder="C:\\AlbionOnline"><button class="btn" id="trkBrowseGame" type="button">Examinar…</button></div></label>' +
      '   <label class="trk-full">Ruta de otra aplicación para iniciar<input id="trkCompanionPath" type="text" placeholder="Opcional"></label>' +
      '  </div>' +
      '  <label class="trk-danger-check"><input id="trkPrerelease" type="checkbox"> Recibir actualizaciones de pre-lanzamiento <strong>¡ATENCIÓN! Estas versiones están aún siendo probadas.</strong></label>' +
      '  <div class="trk-actions trk-quick-actions"><button class="btn ghost" id="trkOpenTool" type="button">Abrir directorio de la herramienta</button><button class="btn ghost" id="trkOpenData" type="button">Abrir userData</button><button class="btn ghost" id="trkShortcut" type="button">Crear acceso directo</button></div>' +
      ' </div>' +
      '</div>' +
      '<div class="card trk-card">' +
      '  <div class="trk-head"><h3>Medidor de daño</h3></div>' +
      '  <div id="trkMeter" class="trk-meter"><p class="muted">Sin datos de combate todavía.</p></div>' +
      '</div>' +
      '<div class="trk-split">' +
      '  <div class="card trk-card"><h3>Historial de mapas</h3><div id="trkMaps"><p class="muted">Sin mapas registrados.</p></div></div>' +
      '  <div class="card trk-card"><h3>Botín reciente</h3><div id="trkLoot"><p class="muted">Sin botín registrado.</p></div></div>' +
      '</div>' +
      '<details class="card trk-card trk-diagnostics"><summary>Diagnóstico avanzado y códigos Photon</summary>' +
      '  <div class="trk-head"><div><h3>Tabla de códigos Photon</h3><div id="trkCodes" class="trk-codes"></div></div><div class="trk-actions"><button class="btn ghost" id="trkCodesToggle" type="button">Ver códigos cargados</button><button class="btn ghost" id="trkReload" type="button">Recargar códigos</button><button class="btn ghost" id="trkDiag" type="button">Modo diagnóstico</button></div></div>' +
      '  <div id="trkCodesList" class="trk-codes-list"></div>' +
      '  <div id="trkDiagOut"></div>' +
      '</details>' +
      '<div id="trkSetupModal" class="trk-setup-modal" hidden></div>';

    el('trkToggle').addEventListener('click', onToggle);
    el('trkTrackingSwitch').addEventListener('change', onSwitchTracking);
    el('trkRefreshCharacter').addEventListener('click', onRefreshCharacter);
    el('trkReset').addEventListener('click', onReset);
    el('trkCopy').addEventListener('click', onCopy);
    el('trkCodesToggle').addEventListener('click', onToggleCodesList);
    el('trkReload').addEventListener('click', onReloadCodes);
    el('trkDiag').addEventListener('click', onToggleDiagnostic);
    el('trkRestartNetwork').addEventListener('click', onRestartNetwork);
    el('trkOpenSetup').addEventListener('click', function () { openSetup(0); });
    wireSettings();
    paintState(latest || {});
  }

  var SETTINGS_KEY = 'aaTrackerSettingsV1';
  var SETUP_KEY = 'aaTrackerSetupV1';
  var setupStep = 0;

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function providerLabel(provider) {
    return provider === 'demo' ? 'Demo (NO real)' : (provider === 'socket' ? 'Socket real' : 'NPCap real');
  }
  function setArmed(armed) {
    var settings = readSettings(); settings.armed = !!armed;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function saveSettings() {
    var data = {
      provider: el('trkProvider').value, adapter: el('trkAdapter').value,
      character: el('trkCharacterName').value.trim(),
      language: el('trkLanguage').value, nav: el('trkNavVisibility').value,
      notifications: el('trkNotifications').value, proxy: el('trkProxy').value.trim(),
      gamePath: el('trkGamePath').value.trim(), companionPath: el('trkCompanionPath').value.trim(),
      prerelease: el('trkPrerelease').checked,
      armed: !!readSettings().armed
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (e) {}
    return data;
  }
  function wireSettings() {
    var s = readSettings();
    ['Provider','Adapter','CharacterName','Language','NavVisibility','Notifications','Proxy','GamePath','CompanionPath'].forEach(function (name) {
      var node = el('trk' + name); if (!node) return;
      var key = {Provider:'provider',Adapter:'adapter',CharacterName:'character',Language:'language',NavVisibility:'nav',Notifications:'notifications',Proxy:'proxy',GamePath:'gamePath',CompanionPath:'companionPath'}[name];
      if (s[key] !== undefined) node.value = s[key];
      node.addEventListener('change', saveSettings);
    });
    el('trkPrerelease').checked = !!s.prerelease;
    el('trkPrerelease').addEventListener('change', saveSettings);
    el('trkBrowseGame').addEventListener('click', chooseGameFolder);
    el('trkOpenTool').addEventListener('click', function () { nativeCall('OpenToolDirectory'); });
    el('trkOpenData').addEventListener('click', function () { nativeCall('OpenUserDataDirectory'); });
    el('trkShortcut').addEventListener('click', function () { nativeCall('CreateDesktopShortcut'); });
    loadAdapters();
  }
  function nativeCall(method) {
    var app = root.go && root.go.main && root.go.main.App;
    if (!app || typeof app[method] !== 'function') { setStatus('Esta acción solo está disponible en la aplicación de escritorio.'); return Promise.resolve(''); }
    return app[method]().catch(function (e) { setStatus('No se pudo completar la acción: ' + e); return ''; });
  }
  async function chooseGameFolder() {
    var path = await nativeCall('SelectGameDirectory');
    if (path) { el('trkGamePath').value = path; saveSettings(); }
  }
  async function loadAdapters() {
    try {
      var list = await AATracker.devices();
      var select = el('trkAdapter'); if (!select || !Array.isArray(list.devices)) return;
      list.devices.forEach(function (d) { var o = document.createElement('option'); o.value = d.name; o.textContent = d.description || d.name; select.appendChild(o); });
      var saved = readSettings().adapter; if (saved) select.value = saved;
    } catch (e) { /* Npcap ausente: Automático queda como única opción */ }
  }
  async function onSwitchTracking(e) {
    var want = e.target.checked;
    try {
      if (want) {
        var cfg = readSettings();
        await AATracker.restart(cfg.provider || 'npcap', cfg.adapter || '', cfg.character || '');
        setArmed(true);
      } else { await AATracker.stop(); setArmed(false); }
    }
    catch (err) { setStatus('No se pudo cambiar el rastreo: ' + err.message); }
    paintControls();
  }
  async function onRestartNetwork() {
    var btn = el('trkRestartNetwork'); btn.disabled = true;
    var cfg = saveSettings();
    try {
      await AATracker.restart(cfg.provider, cfg.adapter, cfg.character || '');
      setArmed(true);
      setStatus(cfg.provider === 'demo' ? 'Demo iniciada: no es tracking real.' : 'Seguimiento de red real reiniciado.');
    } catch (e) { setStatus('No se pudo reiniciar: ' + e.message); }
    btn.disabled = false; paintControls();
  }

  function statusItem(ok, title, waiting, value, hint) {
    var detail = ok ? value : (hint || '');
    return '<div class="trk-state-item ' + (ok ? 'ok' : 'waiting') + '"><i></i><div><strong>' + esc(ok ? title : waiting) + '</strong>' + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</div></div>';
  }
  function paintState(snap) {
    var node = el('trkStateGrid'); if (!node) return;
    var capture = snap.capture || { phase: snap.capturing ? 'preparing' : 'off' };
    var identity = snap.identity || {};
    var phase = capture.phase || 'off';
    var order = { off:0, preparing:1, capturing_network:2, photon_detected:3, server_confirmed:4, waiting_join:5, character_detected:6 };
    var rank = order[phase] || 0;
    // Detección parcial: el Join trajo el nombre pero no el GUID. Se muestra
    // el personaje, pero las métricas siguen cerradas hasta un Join completo.
    var isPartial = identity.detection === 'partial';
    var isDemo = phase === 'demo' || !!snap.simulated;
    var steps = [
      [phase === 'off', 'Apagado', 'Apagado', capture.error || ''],
      [rank >= 1, 'Preparando captura', 'Preparando captura', capture.provider || ''],
      [rank >= 2, 'Capturando red', 'Capturando red', (capture.openSources || 0) + ' fuente(s) · ' + (capture.adapter || 'adaptador automático')],
      [rank >= 3, 'Photon detectado', 'Photon detectado', (capture.photonPackets || 0) + ' Photon · ' + (capture.packetsReceived || 0) + ' UDP'],
      [!!capture.serverConfirmed, 'Servidor Albion confirmado', 'Servidor Albion confirmado', capture.server || ''],
      [rank >= 5, 'Esperando JoinResponse', 'Esperando JoinResponse', (identity.valid || isPartial) ? 'JoinResponse recibido' : 'Cerrá sesión en Albion y volvé a entrar.'],
      [!!identity.valid, 'Personaje detectado', 'Personaje detectado', identity.valid ? identity.name : (isPartial ? identity.name + ' · sin GUID, faltan métricas' : 'JoinResponse es la única fuente de identidad')]
    ];
    if (isDemo) {
      node.innerHTML = '<div class="trk-demo-warning"><strong>MODO DEMO · NO ES TRACKING REAL</strong><small>Todos los datos son ficticios y no vienen de Albion.</small></div>';
    } else {
      node.innerHTML = steps.map(function (step) { return statusItem(step[0], step[1], step[2], step[3]); }).join('');
    }
    var badge = el('trkLiveBadge');
    if (badge) {
      badge.classList.toggle('active', phase === 'character_detected');
      badge.classList.toggle('demo', isDemo);
      var labels = {off:'Apagado',preparing:'Preparando captura',capturing_network:'Capturando red',photon_detected:'Photon detectado',server_confirmed:'Servidor confirmado',waiting_join:'Esperando JoinResponse',character_detected:'Personaje detectado',demo:'Demo · no real'};
      badge.innerHTML = '<i></i> ' + (labels[phase] || 'En espera');
    }
  }

  function setupContent(step) {
    var s = readSettings();
    var pages = [
      '<span class="trk-setup-icon">✦</span><h2>Bienvenido a Ayudante Albion</h2><p>Vamos a preparar el seguimiento en vivo. La configuración toma menos de dos minutos y podés cambiarla después.</p>',
      '<span class="trk-setup-icon">▣</span><h2>Seleccioná la carpeta del juego</h2><p>Elegí la carpeta raíz de Albion Online, no la subcarpeta <code>game</code>.</p><div class="trk-launcher-grid"><div><b>Launcher independiente</b><code>C:\\AlbionOnline</code><small>Debe contener game, launcher, staging, EasyAntiCheat_Setup.exe y uninstall.exe.</small></div><div><b>Launcher de Steam</b><code>D:\\SteamLibrary\\steamapps\\common\\Albion Online</code><small>Normalmente está dentro de steamapps\\common.</small></div></div><div class="trk-path-row"><input id="trkSetupPath" type="text" value="' + esc(s.gamePath || '') + '" placeholder="C:\\AlbionOnline"><button class="btn" id="trkSetupBrowse" type="button">Examinar…</button></div>',
      '<span class="trk-setup-icon">✓</span><h2>Antes de continuar</h2><p>Albion Online debe estar instalado y poder iniciarse normalmente. El asistente no modifica los archivos del juego.</p><div class="trk-setup-callout">La captura es de solo lectura y se limita al tráfico UDP de Albion en los puertos <b>5055, 5056 y 5058</b>.</div>',
      '<span class="trk-setup-icon">⌁</span><h2>Elegí el modo de seguimiento</h2><p>Los proveedores reales nunca caen silenciosamente al simulador.</p><div class="trk-provider-grid"><button data-provider="npcap" class="trk-provider-card ' + ((s.provider || 'npcap') === 'npcap' ? 'selected' : '') + '"><span>RECOMENDADO</span><b>NPCap · real</b><small>Controlador de red de bajo nivel. Requiere instalar NPCap por separado.</small><a href="https://npcap.com/#download" target="_blank" rel="noopener">Descargar NPCap ↗</a></button><button data-provider="socket" class="trk-provider-card ' + (s.provider === 'socket' ? 'selected' : '') + '"><b>Socket · real</b><small>Usa SIO_RCVALL en IPv4/IPv6. Requiere ejecutar la app como administrador.</small></button><button data-provider="demo" class="trk-provider-card trk-provider-demo ' + (s.provider === 'demo' ? 'selected' : '') + '"><span>NO REAL</span><b>Demo explícita</b><small>Genera datos ficticios para probar la interfaz. Nunca se presenta como captura de Albion.</small></button></div>',
      '<span class="trk-setup-icon">◎</span><h2>Personaje a rastrear</h2><p>La detección es automática al entrar al juego. Si indicás un nombre, solo se acumularán estadísticas cuando el Join detectado coincida con ese personaje.</p><input id="trkSetupCharacter" class="trk-setup-input" type="text" maxlength="32" value="' + esc(s.character || '') + '" placeholder="Nombre del personaje (opcional)">',
      '<span class="trk-setup-icon">✓</span><h2>Todo listo</h2><p>Cuando actives el rastreo por primera vez, quedará armado para iniciarse antes del próximo JoinResponse en aperturas futuras. Podés apagarlo cuando quieras.</p><div class="trk-setup-summary"><span>Carpeta <b>' + esc(s.gamePath || 'Sin seleccionar') + '</b></span><span>Proveedor <b>' + esc(providerLabel(s.provider || 'npcap')) + '</b></span></div>'
    ];
    return pages[step];
  }
  function openSetup(step) {
    setupStep = Math.max(0, Math.min(5, step));
    var modal = el('trkSetupModal'); if (!modal) return;
    modal.hidden = false;
    modal.innerHTML = '<div class="trk-setup-box"><div class="trk-setup-top"><div><b>CONFIGURACIÓN INICIAL</b><span>Paso ' + (setupStep + 1) + ' de 6</span></div><button id="trkSetupClose" aria-label="Cerrar">×</button></div><div class="trk-progress"><i style="width:' + (((setupStep + 1) / 6) * 100) + '%"></i></div><div class="trk-setup-body">' + setupContent(setupStep) + '</div><div class="trk-setup-foot"><button class="btn ghost" id="trkSetupPrev" ' + (setupStep === 0 ? 'disabled' : '') + '>Atrás</button><button class="btn primary" id="trkSetupNext">' + (setupStep === 5 ? 'Finalizar configuración' : 'Continuar') + '</button></div></div>';
    el('trkSetupClose').onclick = function () { modal.hidden = true; };
    el('trkSetupPrev').onclick = function () { captureSetup(); openSetup(setupStep - 1); };
    el('trkSetupNext').onclick = function () { captureSetup(); if (setupStep === 5) { try { localStorage.setItem(SETUP_KEY, '1'); } catch (e) {} modal.hidden = true; } else openSetup(setupStep + 1); };
    var browse = el('trkSetupBrowse'); if (browse) browse.onclick = async function () { var path = await nativeCall('SelectGameDirectory'); if (path) el('trkSetupPath').value = path; };
    modal.querySelectorAll('[data-provider]').forEach(function (card) { card.onclick = function (e) { if (e.target.tagName === 'A') return; modal.querySelectorAll('[data-provider]').forEach(function (x) { x.classList.remove('selected'); }); card.classList.add('selected'); }; });
  }
  function captureSetup() {
    var path = el('trkSetupPath'); if (path) el('trkGamePath').value = path.value.trim();
    var char = el('trkSetupCharacter'); if (char) el('trkCharacterName').value = char.value.trim();
    var provider = document.querySelector('#trkSetupModal .trk-provider-card.selected'); if (provider) el('trkProvider').value = provider.dataset.provider;
    saveSettings();
  }

  /* Recarga photon_codes.json sin cerrar la app: es la forma de arreglar el
     tracker después de un patch de Albion. */
  async function onReloadCodes() {
    var btn = el('trkReload');
    btn.disabled = true;
    try {
      var data = await AATracker.reloadCodes();
      if (data && data.ok) {
        setStatus('Tabla de códigos recargada' + (data.restarted ? ' y captura reiniciada.' : '.'));
        paintCodes();
      } else {
        setStatus('No se pudo recargar: ' + ((data && data.reason) || 'error desconocido'));
      }
    } catch (e) {
      setStatus('No se pudo recargar la tabla: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function onToggleDiagnostic() {
    diagOn = !diagOn;
    var btn = el('trkDiag');
    btn.classList.toggle('active', diagOn);
    try {
      var data = await AATracker.diagnostic(diagOn);
      paintDiagnostic(data);
      if (diagOn) {
        // Refrescar mientras esté encendido: los códigos aparecen a medida
        // que el juego los manda.
        diagTimer = setInterval(async function () {
          try { paintDiagnostic(await AATracker.diagnostic()); } catch (e) { /* ignorar */ }
        }, 2000);
      } else if (diagTimer) {
        clearInterval(diagTimer);
        diagTimer = null;
      }
    } catch (e) {
      setStatus('Diagnóstico no disponible: ' + e.message);
    }
  }

  var codesListOpen = false;

  /* Tabla código→nombre de lo que trae cargado photon_codes.json ahora mismo
     (no lo que llegó por red: eso es el modo diagnóstico, más abajo). Sirve
     para confirmar de un vistazo qué significa cada uno de los «48 eventos»
     o «7 operaciones» que reporta el resumen. */
  function codeTable(title, rows) {
    if (!rows || !rows.length) return '<p class="muted small">' + esc(title) + ': sin entradas.</p>';
    return '<p class="small"><strong>' + esc(title) + ' (' + rows.length + ')</strong></p>' +
      '<table class="trk-table"><thead><tr><th>Código</th><th>Nombre</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(String(r.code)) + '</td><td>' + esc(r.name || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function paintCodesList() {
    var node = el('trkCodesList');
    if (!node) return;
    if (!codesListOpen) { node.innerHTML = ''; return; }
    var info = AATracker.state();
    var c = info.codes;
    if (!c || (!c.eventList && !c.operationList)) {
      node.innerHTML = '<p class="muted small">Todavía no hay una tabla de códigos cargada.</p>';
      return;
    }
    node.innerHTML =
      '<p class="muted small">Todo lo que <code>photon_codes.json</code> tiene cargado ahora mismo, ' +
      'con su nombre lógico. Esto no depende de que el juego esté enviando tráfico: es la tabla tal ' +
      'como quedó después de la última carga o recarga.</p>' +
      codeTable('Operaciones cargadas', c.operationList) +
      codeTable('Eventos cargados', c.eventList);
  }

  function onToggleCodesList() {
    codesListOpen = !codesListOpen;
    var btn = el('trkCodesToggle');
    if (btn) {
      btn.classList.toggle('active', codesListOpen);
      btn.textContent = codesListOpen ? 'Ocultar códigos cargados' : 'Ver códigos cargados';
    }
    paintCodesList();
  }

  function paintCodes() {
    var node = el('trkCodes');
    if (!node) return;
    var info = AATracker.state();
    var c = info.codes;
    if (!c) {
      node.innerHTML = '<p class="muted">Sin información de la tabla de códigos.</p>';
      return;
    }
    var warn = info.codesWarning
      ? '<p class="trk-warn">' + esc(info.codesWarning) + '</p>'
      : '';
    node.innerHTML = warn +
      '<p class="muted small">Versión <strong>' + esc(c.version || '—') + '</strong> · ' +
      esc(String(c.events || 0)) + ' eventos · ' + esc(String(c.operations || 0)) + ' operaciones<br>' +
      'Origen: ' + esc(c.loadedFrom || '—') + '</p>' +
      '<p class="muted small">Los códigos de Albion cambian con cada parche. ' +
      'Editá <code>photon_codes.json</code> y tocá <strong>Recargar códigos</strong>: ' +
      'no hace falta reinstalar ni recompilar nada.</p>';
    paintCodesList();
  }

  function paintDiagnostic(data) {
    var node = el('trkDiagOut');
    if (!node) return;
    if (!data || !data.enabled) {
      node.innerHTML = '';
      return;
    }
    function table(title, rows, withName) {
      if (!rows || !rows.length) return '<p class="muted small">' + title + ': sin datos aún.</p>';
      rows.sort(function (a, b) { return b.count - a.count; });
      return '<p class="small"><strong>' + title + '</strong></p>' +
        '<table class="trk-table"><thead><tr><th>Código</th>' +
        (withName ? '<th>Nombre</th>' : '') + '<th>Veces</th></tr></thead><tbody>' +
        rows.slice(0, 25).map(function (r) {
          return '<tr><td>' + r.code + '</td>' +
            (withName ? '<td>' + esc(r.name || '') + '</td>' : '') +
            '<td>' + r.count + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    var operations = data.operations || {};
    var envelope = data.envelope || {};
    var capture = (latest && latest.capture) || {};
    // Pista de arranque: con todo en cero, el primer contador que se mueve
    // dice dónde se corta la cadena. Sin tramas el problema es el driver o el
    // adaptador; con tramas pero sin UDP, el tipo de enlace o los puertos.
    var frames = capture.framesCaptured || 0;
    var hint = '';
    if (!frames) {
      hint = '<p class="muted small"><strong>No llegó ninguna trama de red.</strong> Revisá que NPCap esté instalado (y que no quede WinPcap viejo), que el adaptador elegido sea el que usa el juego y que la app tenga permisos.</p>';
    } else if (!(capture.packetsReceived || 0)) {
      hint = '<p class="muted small"><strong>Llegan tramas pero ningún datagrama de Albion.</strong> ' + esc(String(capture.framesUnparsed || 0)) + ' sin interpretar' + (capture.linkType ? ' · tipo de enlace ' + esc(String(capture.linkType)) : '') + '. Suele ser un adaptador virtual (VPN) distinto al del juego.</p>';
    }
    node.innerHTML =
      '<p class="muted small"><strong>Contadores seguros:</strong> tramas ' + esc(String(frames)) +
      ' · UDP ' + esc(String(capture.packetsReceived || 0)) +
      ' · Photon ' + esc(String(capture.photonPackets || 0)) + ' · decodificados ' + esc(String(capture.decodedMessages || 0)) +
      ' · cifrados descartados ' + esc(String(capture.encryptedDropped || 0)) + ' · inválidos ' + esc(String(capture.malformedDropped || 0)) + '.</p>' +
      hint +
      '<p class="muted small">El código se toma del parámetro 252 (eventos) o 253 (operaciones) cuando el mensaje lo trae; si no, del byte del envelope, que solo alcanza para códigos bajos. Mensajes con 252/253 presente pero inválido: ' + esc(String(data.missingAuthoritativeCode || 0)) + '.</p>' +
      table('Eventos desconocidos', data.unknown, false) +
      table('Eventos reconocidos', data.known, true) +
      table('Operaciones desconocidas', operations.unknown, false) +
      table('Operaciones reconocidas', operations.known, true) +
      table('Bytes de envelope · eventos (respaldo y diagnóstico)', envelope.events, false) +
      table('Bytes de envelope · operaciones (respaldo y diagnóstico)', envelope.operations, false) +
      '<p class="muted small">Este diagnóstico nunca expone nombres, GUIDs ni contenido de paquetes.</p>';
  }

  async function onToggle() {
    var btn = el('trkToggle');
    if (!btn) return;
    btn.disabled = true;
    try {
      var info = AATracker.state();
      if (info.capturing) {
        await AATracker.stop();
        setArmed(false);
      } else {
        var cfg = readSettings();
        await AATracker.restart(cfg.provider || 'npcap', cfg.adapter || '', cfg.character || '');
        setArmed(true);
      }
    } catch (e) {
      setStatus('No se pudo cambiar el estado del tracking: ' + e.message);
    } finally {
      btn.disabled = false;
      paintControls();
    }
  }

  /* «Detectar de nuevo» NO reinicia la captura: pide al backend que vuelva a
     publicar la identidad. Si ya hay personaje detectado, simplemente se
     repinta; si no lo hay, queda esperando el próximo JoinResponse. */
  async function onRefreshCharacter() {
    var btn = el('trkRefreshCharacter');
    if (!btn) return;
    btn.disabled = true;
    try {
      var data = await AATracker.refreshCharacter();
      if (data && data.snapshot) {
        latest = data.snapshot;
        dirty = true;
      }
      if (data && data.detected) {
        // La identidad ya estaba fijada: no se descartó nada.
        detectingCharacter = false;
        var name = (data.snapshot && data.snapshot.identity && data.snapshot.identity.name) || '';
        setStatus('Personaje ya detectado' + (name ? ': ' + name : '') + '. La captura sigue activa, no se reinició nada.');
      } else {
        detectingCharacter = true;
        setStatus('Esperando JoinResponse: cerrá sesión en Albion y volvé a entrar. La captura de red sigue activa.');
      }
    } catch (e) {
      detectingCharacter = false;
      setStatus('No se pudo refrescar el personaje: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function onReset() {
    try {
      var snap = await AATracker.reset();
      latest = snap;
      dirty = true;
    } catch (e) {
      setStatus('No se pudo reiniciar: ' + e.message);
    }
  }

  function onCopy() {
    if (!latest || !latest.combatants || !latest.combatants.length) return;
    var lines = latest.combatants.slice(0, 10).map(function (c, i) {
      return (i + 1) + '. ' + c.name + ' — ' + num(c.damage) + ' daño (' +
        (c.shareDamage || 0).toFixed(1) + '%)';
    });
    var text = 'Ayudante Albion — ' + clock(latest.seconds) + '\n' + lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus('Ranking copiado al portapapeles.');
      });
    }
  }

  function setStatus(text) {
    var node = el('trkStatus');
    if (node) node.textContent = text;
  }

  function paintControls() {
    var info = AATracker.state();
    var btn = el('trkToggle');
    if (btn) btn.textContent = info.capturing ? 'Detener tracking' : 'Activar tracking';
    var sw = el('trkTrackingSwitch'); if (sw) sw.checked = !!info.capturing;
    var sl = el('trkSwitchLabel'); if (sl) sl.textContent = info.capturing ? 'El rastreo está activo' : 'El rastreo está inactivo';
    if (!info.available) {
      setStatus(info.reason || 'Motor de captura no disponible.');
    } else if (info.runError) {
      setStatus('La captura se detuvo: ' + info.runError);
    } else if (detectingCharacter) {
      setStatus('Para detectar de nuevo tu personaje, cerrá sesión en Albion y volvé a entrar. Cambiar de zona no alcanza.');
    } else if (info.capture && info.capture.phase === 'demo') {
      setStatus('MODO DEMO · NO ES TRACKING REAL · datos ficticios.');
    } else if (info.identityValid && !info.filterMatched) {
      setStatus('Personaje detectado, pero no coincide con el filtro del backend. No se acepta ninguna métrica.');
    } else if (info.identityDetection === 'partial') {
      setStatus('Personaje detectado sin GUID: se muestra el nombre, pero no se acepta ninguna métrica hasta un JoinResponse completo.');
    } else if (info.capturing) {
      setStatus('Tracking real · ' + ((info.capture && info.capture.phase) || 'preparando') + ' · fuente: ' + (info.source || 'desconocida'));
    } else {
      setStatus('Tracking detenido. Activalo para empezar a medir.');
    }
  }

  function paintKpis(snap) {
    var node = el('trkKpis');
    if (!node) return;
    var identity = snap.identity || {};
    var cards = [
      ['Personaje', esc(identity.name || snap.character || '—')],
      ['GUID interno', esc(identity.guid || '—')],
      ['Object ID', identity.objectId ? esc(String(identity.objectId)) : '—'],
      ['Gremio / alianza', esc((identity.guild || '—') + ' / ' + (identity.alliance || '—'))],
      ['Mapa actual', esc(mapName(snap.zone))],
      ['Tiempo', clock(snap.seconds)],
      ['Fama', num(snap.fame)],
      ['Fama / h', num(snap.famePerHour)],
      ['Plata', num(snap.silver)],
      ['Plata / h', num(snap.silverPerHour)],
      ['Party', String((snap.party || []).length)]
    ];
    node.innerHTML = cards.map(function (c) {
      return '<div class="trk-kpi"><span class="trk-kpi-label">' + c[0] +
        '</span><span class="trk-kpi-value">' + c[1] + '</span></div>';
    }).join('');
  }

  function paintMeter(snap) {
    var node = el('trkMeter');
    if (!node) return;
    var rows = (snap.combatants || []).filter(function (c) {
      return c.damage > 0 || c.healing > 0;
    });
    if (!rows.length) {
      node.innerHTML = '<p class="muted">Sin datos de combate todavía.</p>';
      return;
    }
    node.innerHTML = '<table class="trk-table"><thead><tr>' +
      '<th>#</th><th>Jugador</th><th>Daño</th><th>DPS</th><th>%</th>' +
      '<th>Curación</th><th>HPS</th><th>Recibido</th><th>Máx.</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (c, i) {
        return '<tr class="' + (c.self ? 'trk-self' : '') + '">' +
          '<td>' + (i + 1) + '</td>' +
          '<td><span class="trk-bar" style="width:' + Math.max(2, c.shareDamage || 0) + '%"></span>' +
          esc(c.name) + '</td>' +
          '<td>' + num(c.damage) + '</td>' +
          '<td>' + num(c.dps) + '</td>' +
          '<td>' + (c.shareDamage || 0).toFixed(1) + '%</td>' +
          '<td>' + num(c.healing) + '</td>' +
          '<td>' + num(c.hps) + '</td>' +
          '<td>' + num(c.taken) + '</td>' +
          '<td>' + num(c.biggestHit) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function paintMaps(snap) {
    var node = el('trkMaps');
    if (!node) return;
    var maps = snap.maps || [];
    if (!maps.length) {
      node.innerHTML = '<p class="muted">Sin mapas registrados.</p>';
      return;
    }
    node.innerHTML = '<ul class="trk-list">' + maps.slice(0, 20).map(function (m) {
      return '<li><strong>' + esc(mapName(m.name)) + '</strong><span class="muted"> · ' +
        clock(m.seconds) + '</span></li>';
    }).join('') + '</ul>';
  }

  function paintLoot(snap) {
    var node = el('trkLoot');
    if (!node) return;
    var loot = snap.loot || [];
    if (!loot.length) {
      node.innerHTML = '<p class="muted">Sin botín registrado.</p>';
      return;
    }
    node.innerHTML = '<ul class="trk-list">' + loot.slice(0, 20).map(function (l) {
      return '<li><strong>' + esc(l.itemId) + '</strong> ×' + (l.quantity || 1) +
        '<span class="muted"> · ' + esc(l.player) + '</span></li>';
    }).join('') + '</ul>';
  }

  function paint() {
    if (!dirty || !latest) return;
    dirty = false;
    paintState(latest);
    paintKpis(latest);
    paintMeter(latest);
    paintMaps(latest);
    paintLoot(latest);
  }

  /* Monta la pestaña. Se llama una sola vez, desde init(). */
  function mount(info) {
    // El contenedor es una vista interna de Sesión: Recolección y Mazmorras
    // comparten el panel padre sin que renderShell destruya sus montajes.
    var panel = el('trackerMount') || el('tab-tracker');
    if (!panel || mounted) return;
    mounted = true;
    if (!info.hasTracking) {
      renderWebNotice(panel, info);
      return;
    }
    renderShell(panel);
    if (root.AATrackerMaps && root.AATrackerMaps.ready) {
      root.AATrackerMaps.ready.then(function () { dirty = true; });
    }
    paintControls();
    paintCodes();
    try { if (!localStorage.getItem(SETUP_KEY)) openSetup(0); } catch (e) {}

    AATracker.on(function (type, payload) {
      if (type === 'snapshot' || type === 'status') {
        latest = payload;
        dirty = true;
        if (payload && payload.character) detectingCharacter = false;
        paintControls();
      } else if (type === 'warning' && payload && payload.message) {
        setStatus(String(payload.message));
      }
    });

    // Un solo repintado por frame: los eventos de daño llegan muy seguidos y
    // redibujar por cada uno trabaría la pestaña.
    setInterval(paint, 500);

    AATracker.connect();
    var armed = readSettings();
    if (armed.armed && !info.capturing) {
      AATracker.restart(armed.provider || 'npcap', armed.adapter || '', armed.character || '').catch(function (error) {
        setStatus('El tracking estaba armado, pero no pudo prepararse: ' + error.message);
      });
    }
    AATracker.session().then(function (snap) {
      latest = snap;
      dirty = true;
    }).catch(function () { /* el stream va a traerlo igual */ });
  }

  /* La pestaña Sesión es visible siempre: en la web pública muestra el cartel
     "En desarrollo en App de Escritorio"; en el ejecutable, la sesión completa. */
  function applyVisibility(info) {
    var tab = document.querySelector('.tab[data-tab="tracker"]');
    if (tab) tab.hidden = false;
  }

  async function init() {
    if (!root.AATracker) return;
    var info = await AATracker.detect();
    applyVisibility(info);
    mount(info);
  }

  root.AATrackerUI = Object.freeze({ init: init });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
