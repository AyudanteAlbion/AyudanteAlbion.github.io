/* Ayudante Albion — normalizador de ítems observados en pérdidas públicas. */
(function (root) {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var WINDOW_DAYS = 7;
  var MAX_EVENTS = 600;
  var MAX_BYTES = 768 * 1024;

  var EQUIPMENT_SLOTS = {
    MainHand: 'Mano principal', OffHand: 'Mano secundaria', Head: 'Cabeza', Armor: 'Armadura',
    Shoes: 'Calzado', Bag: 'Bolsa', Cape: 'Capa', Mount: 'Montura', Potion: 'Poción', Food: 'Comida'
  };

  function parseTs(value) {
    if (value == null) return null;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    var text = String(value).trim();
    if (!text || text.indexOf('0001-') === 0) return null;
    if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z';
    var ms = Date.parse(text);
    return isFinite(ms) ? ms : null;
  }

  function stableHash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function eventId(event) {
    var id = event.EventId || event.eventId || event.ID || event.id || event.KillEventId;
    if (id != null && String(id).trim()) return String(id);
    return 'ev_' + stableHash(JSON.stringify({ t: event.TimeStamp || event.timestamp, k: event.Killer && event.Killer.Id, v: event.Victim && event.Victim.Id }));
  }

  function normalizeItem(raw, slot) {
    if (!raw || typeof raw !== 'object') return null;
    var id = raw.Type || raw.type || raw.ItemTypeId || raw.item_id || raw.id;
    if (!id) return null;
    var rawQty = raw.Count != null ? raw.Count : (raw.count != null ? raw.count : (raw.Quantity != null ? raw.Quantity : raw.quantity));
    var qty = rawQty == null ? 1 : Number(rawQty);
    if (!isFinite(qty) || qty <= 0) return null;
    var quality = Number(raw.Quality != null ? raw.Quality : raw.quality);
    if (!isFinite(quality) || quality <= 0) quality = 1;
    return { id: String(id), quality: Math.max(1, Math.min(5, Math.round(quality))), qty: qty, slot: slot || '' };
  }

  function collectEquipment(victim) {
    var out = [];
    var equipment = victim && (victim.Equipment || victim.equipment) || {};
    Object.keys(EQUIPMENT_SLOTS).forEach(function (slot) {
      var item = normalizeItem(equipment[slot] || equipment[slot.toLowerCase()], EQUIPMENT_SLOTS[slot]);
      if (item) out.push(item);
    });
    return out;
  }

  function collectInventory(victim) {
    var inventory = victim && (victim.Inventory || victim.inventory) || [];
    if (!Array.isArray(inventory)) return [];
    return inventory.map(function (item) { return normalizeItem(item, 'Inventario'); }).filter(Boolean);
  }

  function normalizeEvent(event) {
    if (!event || typeof event !== 'object') return null;
    var ts = parseTs(event.TimeStamp || event.timestamp || event.date || event.Date);
    if (ts == null) return null;
    var victim = event.Victim || event.victim || {};
    return { id: eventId(event), ts: ts, equipment: collectEquipment(victim), inventory: collectInventory(victim) };
  }

  function emptyCache() { return { v: 1, updated: 0, events: [], processed: {} }; }

  function prune(cache, now, options) {
    options = options || {};
    var ref = now || Date.now();
    var windowDays = options.windowDays || WINDOW_DAYS;
    var maxEvents = options.maxEvents || MAX_EVENTS;
    var maxBytes = options.maxBytes || MAX_BYTES;
    var minTs = ref - windowDays * DAY;
    var c = cache && typeof cache === 'object' ? cache : emptyCache();
    var events = Array.isArray(c.events) ? c.events.filter(function (ev) { return ev && ev.ts >= minTs; }) : [];
    events.sort(function (a, b) { return b.ts - a.ts; });
    if (events.length > maxEvents) events = events.slice(0, maxEvents);
    var out = { v: 1, updated: c.updated || 0, events: events, processed: {} };
    events.forEach(function (ev) { out.processed[ev.id] = ev.ts; });
    while (events.length > 50 && JSON.stringify(out).length > maxBytes) {
      events.pop();
      out = { v: 1, updated: c.updated || 0, events: events, processed: {} };
      events.forEach(function (ev) { out.processed[ev.id] = ev.ts; });
    }
    return out;
  }

  function merge(cache, rawEvents, now, options) {
    options = options || {};
    var ref = now || Date.now();
    var minTs = ref - (options.windowDays || WINDOW_DAYS) * DAY;
    var c = prune(cache, ref, options);
    var added = 0;
    (Array.isArray(rawEvents) ? rawEvents : []).forEach(function (raw) {
      var ev = normalizeEvent(raw);
      if (!ev || ev.ts < minTs || c.processed[ev.id]) return;
      c.events.push(ev);
      c.processed[ev.id] = ev.ts;
      added += 1;
    });
    c.updated = ref;
    c = prune(c, ref, options);
    return { cache: c, added: added };
  }

  function aggregate(events, options) {
    options = options || {};
    var groups = new Map();
    function add(item, kind, ev) {
      if (options.kind && options.kind !== 'all' && options.kind !== kind) return;
      if (options.quality && options.quality !== 'all' && Number(options.quality) !== item.quality) return;
      var category = options.categoryOf ? options.categoryOf(item.id) : '';
      if (options.category && options.category !== 'all' && category !== options.category) return;
      if (options.ingredientsOnly && options.isIngredient && !options.isIngredient(item.id, category)) return;
      var value = options.valueOf ? options.valueOf(item.id, item.quality) : null;
      if (options.minValue != null && options.minValue !== '' && (!(value >= Number(options.minValue)))) return;
      if (options.maxValue != null && options.maxValue !== '' && (!(value <= Number(options.maxValue)))) return;
      var key = item.id + '|' + item.quality;
      var group = groups.get(key);
      if (!group) {
        group = { id: item.id, quality: item.quality, category: category || '', totalQty: 0,
          equipmentQty: 0, inventoryQty: 0, events: new Set(), value: value };
        groups.set(key, group);
      }
      group.totalQty += item.qty;
      if (kind === 'equipment') group.equipmentQty += item.qty;
      else group.inventoryQty += item.qty;
      group.events.add(ev.id);
      if (value != null) group.value = value;
    }
    (events || []).forEach(function (ev) {
      (ev.equipment || []).forEach(function (item) { add(item, 'equipment', ev); });
      (ev.inventory || []).forEach(function (item) { add(item, 'inventory', ev); });
    });
    return Array.from(groups.values()).map(function (g) {
      return Object.assign({}, g, { eventCount: g.events.size, events: undefined,
        avgDaily: g.totalQty / WINDOW_DAYS, totalValue: g.value == null ? null : g.value * g.totalQty });
    }).sort(function (a, b) { return b.totalQty - a.totalQty || b.eventCount - a.eventCount; });
  }

  root.AAPublicLosses = Object.freeze({
    WINDOW_DAYS: WINDOW_DAYS,
    MAX_EVENTS: MAX_EVENTS,
    MAX_BYTES: MAX_BYTES,
    normalizeEvent: normalizeEvent,
    emptyCache: emptyCache,
    prune: prune,
    merge: merge,
    aggregate: aggregate
  });
}(window));
