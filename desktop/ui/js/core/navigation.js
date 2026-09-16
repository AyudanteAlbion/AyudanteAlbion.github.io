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

  root.AANavigation = Object.freeze({ activateTab: activateTab });
}(window));
