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
      '      <button class="btn ghost" id="trkRefreshCharacter" type="button" title="Volver a detectar tu personaje desde el juego">↻ Refrescar personaje</button>' +
      '      <button class="btn ghost" id="trkReset" type="button">Reiniciar sesión</button>' +
      '      <button class="btn ghost" id="trkCopy" type="button">Copiar ranking</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="trk-status" id="trkStatus" role="status">Tracking detenido.</div>' +
      '  <div class="trk-kpis" id="trkKpis"></div>' +
      '</div>' +
      '<div class="trk-split trk-config-split">' +
      ' <div class="card trk-card trk-config-card">' +
      '  <div class="trk-head"><div><span class="trk-eyebrow">SEGUIMIENTO</span><h3>Configuración de red</h3></div><label class="trk-switch"><input id="trkTrackingSwitch" type="checkbox"><span></span></label></div>' +
      '  <p class="trk-switch-label" id="trkSwitchLabel">El rastreo está inactivo</p>' +
      '  <div class="trk-form-grid">' +
      '   <label>Proveedor de paquetes<select id="trkProvider"><option value="npcap">Npcap (recomendado)</option><option value="socket">Socket (requiere administrador)</option></select><small>Los cambios del proveedor requieren reiniciar la herramienta.</small></label>' +
      '   <label>Adaptador de red<select id="trkAdapter"><option value="">Automático · escuchar todos</option></select><small>Dejá Automático si no sabés qué interfaz usa el juego.</small></label>' +
      '   <label class="trk-full">Nombre de personaje a rastrear<input id="trkCharacterName" type="text" maxlength="32" placeholder="Detección automática"></label>' +
      '   <label>Jugador con mismo nombre en la base local<div class="trk-inline-field"><input id="trkCharacterIndex" type="number" min="0" value="0"><button class="btn ghost" id="trkCharacterReset" type="button">Reiniciar</button></div></label>' +
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
  function saveSettings() {
    var data = {
      provider: el('trkProvider').value, adapter: el('trkAdapter').value,
      character: el('trkCharacterName').value.trim(), characterIndex: +(el('trkCharacterIndex').value || 0),
      language: el('trkLanguage').value, nav: el('trkNavVisibility').value,
      notifications: el('trkNotifications').value, proxy: el('trkProxy').value.trim(),
      gamePath: el('trkGamePath').value.trim(), companionPath: el('trkCompanionPath').value.trim(),
      prerelease: el('trkPrerelease').checked
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (e) {}
    return data;
  }
  function wireSettings() {
    var s = readSettings();
    ['Provider','Adapter','CharacterName','CharacterIndex','Language','NavVisibility','Notifications','Proxy','GamePath','CompanionPath'].forEach(function (name) {
      var node = el('trk' + name); if (!node) return;
      var key = {Provider:'provider',Adapter:'adapter',CharacterName:'character',CharacterIndex:'characterIndex',Language:'language',NavVisibility:'nav',Notifications:'notifications',Proxy:'proxy',GamePath:'gamePath',CompanionPath:'companionPath'}[name];
      if (s[key] !== undefined) node.value = s[key];
      node.addEventListener('change', saveSettings);
    });
    el('trkPrerelease').checked = !!s.prerelease;
    el('trkPrerelease').addEventListener('change', saveSettings);
    el('trkCharacterReset').addEventListener('click', function () { el('trkCharacterIndex').value = 0; saveSettings(); });
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
        await AATracker.restart(cfg.provider || 'npcap', cfg.adapter || '');
      } else await AATracker.stop();
    }
    catch (err) { setStatus('No se pudo cambiar el rastreo: ' + err.message); }
    paintControls();
  }
  async function onRestartNetwork() {
    var btn = el('trkRestartNetwork'); btn.disabled = true;
    var cfg = saveSettings();
    try {
      await AATracker.restart(cfg.provider, cfg.adapter);
      setStatus('Seguimiento de red reiniciado.');
    } catch (e) { setStatus('No se pudo reiniciar: ' + e.message); }
    btn.disabled = false; paintControls();
  }

  function statusItem(ok, title, waiting, value, hint) {
    var detail = ok ? value : (hint || '');
    return '<div class="trk-state-item ' + (ok ? 'ok' : 'waiting') + '"><i></i><div><strong>' + esc(ok ? title : waiting) + '</strong>' + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</div></div>';
  }
  function paintState(snap) {
    var node = el('trkStateGrid'); if (!node) return;
    var hasData = !!(snap.packets || snap.character || snap.zone || snap.fame || snap.silver || (snap.combatants && snap.combatants.length));
    // La identidad y la zona llegan en la respuesta a Join y en ChangeCluster:
    // si el tracking arrancó con la sesión ya abierta, hay que provocar uno de
    // los dos. Cambiar de mapa es lo más rápido y no obliga a salir del juego.
    var joinHint = hasData ? 'Cambiá de zona en Albion para que el juego lo reenvíe' : '';
    node.innerHTML = statusItem(hasData, 'Datos del juego recibidos', 'Esperando datos del juego', '') +
      statusItem(hasData, 'Servidor detectado', 'Servidor no detectado', hasData ? 'Albion Online · UDP' : '') +
      statusItem(!!snap.character, 'Personaje detectado', 'Personaje no detectado', snap.character, joinHint) +
      statusItem(!!snap.zone, 'Ubicación detectada', 'Ubicación no detectada', snap.zone, joinHint);
    var badge = el('trkLiveBadge');
    if (badge) { badge.classList.toggle('active', hasData); badge.innerHTML = '<i></i> ' + (hasData ? 'Recibiendo datos' : 'En espera'); }
  }

  function setupContent(step) {
    var s = readSettings();
    var pages = [
      '<span class="trk-setup-icon">✦</span><h2>Bienvenido a Ayudante Albion</h2><p>Vamos a preparar el seguimiento en vivo. La configuración toma menos de dos minutos y podés cambiarla después.</p>',
      '<span class="trk-setup-icon">▣</span><h2>Seleccioná la carpeta del juego</h2><p>Elegí la carpeta raíz de Albion Online, no la subcarpeta <code>game</code>.</p><div class="trk-launcher-grid"><div><b>Launcher independiente</b><code>C:\\AlbionOnline</code><small>Debe contener game, launcher, staging, EasyAntiCheat_Setup.exe y uninstall.exe.</small></div><div><b>Launcher de Steam</b><code>D:\\SteamLibrary\\steamapps\\common\\Albion Online</code><small>Normalmente está dentro de steamapps\\common.</small></div></div><div class="trk-path-row"><input id="trkSetupPath" type="text" value="' + esc(s.gamePath || '') + '" placeholder="C:\\AlbionOnline"><button class="btn" id="trkSetupBrowse" type="button">Examinar…</button></div>',
      '<span class="trk-setup-icon">✓</span><h2>Antes de continuar</h2><p>Albion Online debe estar instalado y poder iniciarse normalmente. El asistente no modifica los archivos del juego.</p><div class="trk-setup-callout">La captura es de solo lectura y se limita al tráfico UDP de Albion en los puertos <b>5055, 5056 y 5058</b>.</div>',
      '<span class="trk-setup-icon">⌁</span><h2>Elegí el modo de seguimiento</h2><p>Podés cambiar el proveedor más adelante; hacerlo requiere reiniciar la herramienta.</p><div class="trk-provider-grid"><button data-provider="npcap" class="trk-provider-card ' + ((s.provider || 'npcap') === 'npcap' ? 'selected' : '') + '"><span>RECOMENDADO</span><b>NPCap</b><small>Controlador de red de bajo nivel. Requiere instalar NPCap por separado.</small><a href="https://npcap.com/#download" target="_blank" rel="noopener">Descargar NPCap ↗</a></button><button data-provider="socket" class="trk-provider-card ' + (s.provider === 'socket' ? 'selected' : '') + '"><b>Socket</b><small>Usa sockets sin procesar de Windows. No requiere NPCap, pero la app debe ejecutarse como administrador.</small></button></div>',
      '<span class="trk-setup-icon">◎</span><h2>Personaje a rastrear</h2><p>La detección es automática al entrar al juego. Si querés, podés indicar un nombre para filtrar la sesión.</p><input id="trkSetupCharacter" class="trk-setup-input" type="text" maxlength="32" value="' + esc(s.character || '') + '" placeholder="Nombre del personaje (opcional)">',
      '<span class="trk-setup-icon">✓</span><h2>Todo listo</h2><p>Al activar el rastreo, el panel de Estado se actualizará cuando Albion empiece a enviar paquetes. Si no aparecen datos, revisá el adaptador de red y los permisos.</p><div class="trk-setup-summary"><span>Carpeta <b>' + esc(s.gamePath || 'Sin seleccionar') + '</b></span><span>Proveedor <b>' + esc((s.provider || 'npcap') === 'npcap' ? 'NPCap' : 'Socket') + '</b></span></div>'
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
    node.innerHTML =
      '<p class="muted small">Códigos que está mandando el juego ahora mismo. ' +
      'Los <em>desconocidos</em> son los que hay que agregar o corregir en la tabla.</p>' +
      table('Eventos desconocidos', data.unknown, false) +
      table('Eventos reconocidos', data.known, true) +
      '<p class="muted small">La identidad llega en la respuesta de la operación <code>Join</code>. ' +
      'Estas tablas registran solo código y frecuencia; no exponen nombres, GUIDs ni otros parámetros.</p>' +
      table('Operaciones desconocidas', operations.unknown, false) +
      table('Operaciones reconocidas', operations.known, true);
  }

  async function onToggle() {
    var btn = el('trkToggle');
    if (!btn) return;
    btn.disabled = true;
    try {
      var info = AATracker.state();
      if (info.capturing) {
        await AATracker.stop();
      } else {
        var cfg = readSettings();
        await AATracker.restart(cfg.provider || 'npcap', cfg.adapter || '');
      }
    } catch (e) {
      setStatus('No se pudo cambiar el estado del tracking: ' + e.message);
    } finally {
      btn.disabled = false;
      paintControls();
    }
  }

  async function onRefreshCharacter() {
    var btn = el('trkRefreshCharacter');
    if (!btn) return;
    btn.disabled = true;
    detectingCharacter = true;
    setStatus('Reiniciando la detección del personaje…');
    try {
      var data = await AATracker.refreshCharacter();
      if (data && data.snapshot) {
        latest = data.snapshot;
        dirty = true;
      }
      paintControls();
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
    } else if (detectingCharacter) {
      setStatus('Buscando tu personaje… Cambiá de zona en Albion (o volvé a entrar) para que el juego reenvíe tus datos.');
    } else if (info.capturing) {
      setStatus('Tracking activo · fuente: ' + (info.source || 'desconocida'));
    } else {
      setStatus('Tracking detenido. Activalo para empezar a medir.');
    }
  }

  function paintKpis(snap) {
    var node = el('trkKpis');
    if (!node) return;
    var cards = [
      ['Personaje', esc(snap.character || '—')],
      ['Zona', esc(snap.zone || '—')],
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
      return '<li><strong>' + esc(m.name) + '</strong><span class="muted"> · ' +
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
    var panel = el('tab-tracker');
    if (!panel || mounted) return;
    mounted = true;
    if (!info.hasTracking) {
      renderWebNotice(panel, info);
      return;
    }
    renderShell(panel);
    paintControls();
    paintCodes();
    try { if (!localStorage.getItem(SETUP_KEY)) openSetup(0); } catch (e) {}

    AATracker.on(function (type, payload) {
      if (type === 'snapshot' || type === 'status') {
        latest = payload;
        dirty = true;
        if (payload && payload.character) detectingCharacter = false;
        paintControls();
      }
    });

    // Un solo repintado por frame: los eventos de daño llegan muy seguidos y
    // redibujar por cada uno trabaría la pestaña.
    setInterval(paint, 500);

    AATracker.connect();
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
