/* Ayudante Albion — almacenamiento local compartido.
 *
 * Se mantiene como script clásico durante la migración: app.js puede consumir
 * window.AAStorage sin cambiar todavía a ES modules.
 */
(function (root) {
  'use strict';

  function read(key, fallback) {
    try {
      var raw = root.localStorage.getItem(key);
      return raw == null ? fallback : raw;
    } catch (e) {
      return fallback;
    }
  }

  function readJSON(key, fallback) {
    var raw = read(key, null);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      root.localStorage.setItem(key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function writeJSON(key, value) {
    try {
      return write(key, JSON.stringify(value));
    } catch (e) {
      return false;
    }
  }

  function remove(key) {
    try {
      root.localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  root.AAStorage = Object.freeze({ read: read, readJSON: readJSON, write: write,
    writeJSON: writeJSON, remove: remove });
}(window));
