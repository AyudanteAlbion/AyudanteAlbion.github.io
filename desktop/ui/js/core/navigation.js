/* Ayudante Albion — estado visual común de navegación. */
(function (root) {
  'use strict';

  function activateTab(key) {
    document.querySelectorAll('.tab[data-tab]').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === key);
    });
    document.querySelectorAll('.dd-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.tab === key);
    });
    document.querySelectorAll('.top-action').forEach(function (button) {
      button.classList.toggle('active', button.dataset.tab === key);
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'tab-' + key);
    });
  }

  // Recolección y Mazmorras forman parte de la sesión: solo intercambian la
  // vista interna sin abandonar #tab-tracker ni reiniciar sus datos locales.
  function activateSessionView(key, focus) {
    var valid = { tracker: true, gathering: true, dungeons: true };
    if (!valid[key]) return;
    document.querySelectorAll('[data-session-view]').forEach(function (tab) {
      var active = tab.dataset.sessionView === key;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    document.querySelectorAll('.session-view').forEach(function (view) {
      var active = view.id === 'sessionView' + key.charAt(0).toUpperCase() + key.slice(1);
      view.classList.toggle('active', active);
      view.hidden = !active;
    });

    // Los módulos mantienen su propio estado en memoria/localStorage. Forzar
    // un render al mostrarlos permite ver enseguida los eventos acumulados
    // mientras su vista estaba cerrada.
    if (key === 'gathering' && root.AAGathering) root.AAGathering.render();
    if (key === 'dungeons' && root.AADungeons) root.AADungeons.render();
  }

  document.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-session-view]');
    if (tab) activateSessionView(tab.dataset.sessionView);
  });

  document.addEventListener('keydown', function (event) {
    var tab = event.target.closest('[data-session-view]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-session-view]'));
    var index = tabs.indexOf(tab);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activateSessionView(tabs[index].dataset.sessionView, true);
  });

  root.AANavigation = Object.freeze({ activateTab: activateTab, activateSessionView: activateSessionView });
}(window));
