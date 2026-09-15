/* Ayudante Albion — integración de la barra de ventana de Wails.
 * En la web este módulo no hace nada: la barra solo aparece si el binding
 * nativo App está presente, evitando imitar controles que no funcionarían.
 */
(function (root) {
  'use strict';

  function bridge() {
    return root.go && root.go.main && root.go.main.App;
  }

  function call(method) {
    var app = bridge();
    if (!app || typeof app[method] !== 'function') return;
    try {
      var result = app[method]();
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          if (root.console && console.error) console.error('window.' + method, err);
        });
      }
    } catch (err) {
      if (root.console && console.error) console.error('window.' + method, err);
    }
  }

  function init() {
    if (!bridge()) return;
    document.body.classList.add('desktop-app');

    var minimise = document.getElementById('desktopMinimise');
    var maximise = document.getElementById('desktopMaximise');
    var close = document.getElementById('desktopClose');
    var drag = document.getElementById('desktopTitlebarDrag');

    if (minimise) minimise.addEventListener('click', function () { call('Minimise'); });
    if (maximise) maximise.addEventListener('click', function () { call('ToggleMaximise'); });
    if (close) close.addEventListener('click', function () { call('Close'); });
    if (drag) drag.addEventListener('dblclick', function () { call('ToggleMaximise'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
