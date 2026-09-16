/* Ayudante Albion — barra lateral plegable de la edición de escritorio. */
(function (root) {
  'use strict';

  var KEY = 'aaSidebarOpenV1';
  var desktopQuery = root.matchMedia ? root.matchMedia('(min-width: 901px)') : null;

  function toggleButton(open) {
    var button = document.getElementById('sidebarToggle');
    var label = document.getElementById('sidebarToggleLabel');
    if (!button) return;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Ocultar menú de navegación' : 'Mostrar menú de navegación');
    button.title = open ? 'Ocultar menú' : 'Mostrar menú';
    if (label) label.textContent = open ? 'Ocultar menú' : 'Menú';
  }

  function isOpen() { return !document.body.classList.contains('sidebar-collapsed'); }

  function setOpen(open, save) {
    document.body.classList.toggle('sidebar-collapsed', !open);
    toggleButton(open);
    if (save !== false) {
      try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) { /* almacenamiento no disponible */ }
    }
  }

  function toggle() { setOpen(!isOpen()); }

  // Al elegir una pantalla desde el drawer móvil se recupera inmediatamente
  // el ancho completo. En escritorio se conserva la elección del usuario.
  function closeOnNavigation() {
    if (desktopQuery && desktopQuery.matches) return;
    setOpen(false, false);
  }

  function init() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* almacenamiento no disponible */ }
    setOpen(saved === '1', false);
    var button = document.getElementById('sidebarToggle');
    if (button) button.addEventListener('click', toggle);
  }

  root.AASidebar = Object.freeze({ isOpen: isOpen, setOpen: setOpen, toggle: toggle, closeOnNavigation: closeOnNavigation });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}(window));
