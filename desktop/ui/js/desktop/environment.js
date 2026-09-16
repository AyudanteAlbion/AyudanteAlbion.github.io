/* Ayudante Albion — detección única del entorno de ejecución.
 *
 * Todo el frontend consulta AAEnvironment en lugar de inferir por separado si
 * está en Wails. En la web y en el ejecutable clásico las capacidades nativas
 * quedan apagadas; dentro de Wails se habilitan la barra propia y su bridge.
 */
(function (root) {
  'use strict';

  function bridge() {
    return root.go && root.go.main && root.go.main.App;
  }

  var hostname = String(root.location && root.location.hostname || '').toLowerCase();
  var protocol = String(root.location && root.location.protocol || '').toLowerCase();
  var isWails = !!bridge() || hostname === 'wails' || protocol === 'wails:';
  var isLegacyLocalExecutable = !isWails && (hostname === '127.0.0.1' || hostname === 'localhost');

  var capabilities = Object.freeze({
    nativeWindowControls: isWails,
    antiPause: !isWails,
    legacyHeartbeat: isLegacyLocalExecutable
  });

  function callWindow(method) {
    var app = bridge();
    if (!app || typeof app[method] !== 'function') return Promise.resolve(false);
    try {
      return Promise.resolve(app[method]()).then(function () { return true; });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function reportWindowError(method, err) {
    if (root.console && console.error) console.error('window.' + method, err);
  }

  function bindWindowControl(id, method) {
    var button = document.getElementById(id);
    if (!button) return;
    button.addEventListener('click', function () {
      callWindow(method).catch(function (err) { reportWindowError(method, err); });
    });
  }

  // El heartbeat pertenece únicamente al ejecutable clásico que abre una
  // pestaña en localhost. Wails se cierra por ciclo de vida nativo y jamás
  // inicia este temporizador.
  function startLegacyHeartbeat() {
    if (!capabilities.legacyHeartbeat) return null;
    return root.setInterval(function () {
      root.fetch('/alive', { method: 'POST', cache: 'no-store' }).catch(function () {});
    }, 3000);
  }

  function init() {
    if (!isWails) return;
    document.body.classList.add('desktop-app');

    // En WebView2 no existen congelamiento ni descarte de pestañas. Ocultar el
    // control evita pedir Web Locks/Wake Locks sin aportar ningún beneficio.
    var antiPause = document.getElementById('kaBtn');
    if (antiPause) {
      antiPause.hidden = true;
      antiPause.disabled = true;
      antiPause.setAttribute('aria-hidden', 'true');
    }

    bindWindowControl('desktopMinimise', 'Minimise');
    bindWindowControl('desktopMaximise', 'ToggleMaximise');
    bindWindowControl('desktopClose', 'Close');

    var drag = document.getElementById('desktopTitlebarDrag');
    if (drag) {
      drag.addEventListener('dblclick', function () {
        callWindow('ToggleMaximise').catch(function (err) {
          reportWindowError('ToggleMaximise', err);
        });
      });
    }
  }

  root.AAEnvironment = Object.freeze({
    isDesktop: isWails,
    isWails: isWails,
    capabilities: capabilities,
    callWindow: callWindow,
    startLegacyHeartbeat: startLegacyHeartbeat
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
