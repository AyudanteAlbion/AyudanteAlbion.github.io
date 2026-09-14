/* Ayudante Albion — migración y analítica del registro de operaciones. */
(function (root) {
  'use strict';

  var VERSION = 2;
  var DAY = 24 * 60 * 60 * 1000;

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function uidFor(row, index) {
    if (row && row.uid) return String(row.uid);
    var ts = row && row.ts != null ? String(row.ts) : '0';
    var id = row && row.id ? String(row.id) : 'item';
    return 'll_' + ts.replace(/\W/g, '') + '_' + id.replace(/\W/g, '').slice(0, 24) + '_' + index;
  }

  function migrateRows(rows) {
    var changed = false;
    var list = Array.isArray(rows) ? rows : [];
    var migrated = list.map(function (row, index) {
      var r = Object.assign({}, row || {});
      if (r.v !== VERSION) { r.v = VERSION; changed = true; }
      if (!r.uid) { r.uid = uidFor(r, index); changed = true; }
      if (r.fee == null) {
        r.fee = r.commission != null ? r.commission : (r.tax != null ? r.tax : 0);
        changed = true;
      }
      if (r.craftCost == null) { r.craftCost = 0; changed = true; }
      if (r.note == null) { r.note = ''; changed = true; }
      if (r.city == null) { r.city = ''; changed = true; }
      return r;
    });
    return { rows: migrated, changed: changed, version: VERSION };
  }

  function gross(row) { return num(row.qty) * num(row.price); }
  function fee(row) { return Math.max(0, num(row.fee)); }
  function craftCost(row) { return row.type === 'craft' ? Math.max(0, num(row.craftCost)) : 0; }
  function netIncome(row) { return row.type === 'sell' ? gross(row) - fee(row) : 0; }
  function investment(row) { return row.type === 'sell' ? 0 : gross(row) + fee(row) + craftCost(row); }
  function operationNet(row) { return row.type === 'sell' ? netIncome(row) : -investment(row); }

  function emptyGroup(key, label) {
    return { key: key, label: label || key, rows: 0, buyQty: 0, craftQty: 0, sellQty: 0,
      grossSales: 0, netIncome: 0, investment: 0, fees: 0, craftCost: 0,
      profit: 0, roi: null, profitPerSold: null };
  }

  function addToGroup(group, row) {
    group.rows += 1;
    var qty = num(row.qty);
    var g = gross(row);
    var f = fee(row);
    group.fees += f;
    if (row.type === 'sell') {
      group.sellQty += qty;
      group.grossSales += g;
      group.netIncome += g - f;
    } else {
      if (row.type === 'craft') group.craftQty += qty;
      else group.buyQty += qty;
      group.craftCost += craftCost(row);
      group.investment += g + f + craftCost(row);
    }
    group.profit = group.netIncome - group.investment;
    group.roi = group.investment > 0 ? group.profit / group.investment : null;
    group.profitPerSold = group.sellQty > 0 ? group.profit / group.sellQty : null;
    return group;
  }

  function metrics(rows) {
    var g = emptyGroup('total', 'Total');
    (rows || []).forEach(function (row) { addToGroup(g, row); });
    return g;
  }

  function groupBy(rows, keyFn, labelFn) {
    var map = new Map();
    (rows || []).forEach(function (row) {
      var key = keyFn(row);
      var label = labelFn ? labelFn(row, key) : key;
      var group = map.get(key);
      if (!group) { group = emptyGroup(key, label); map.set(key, group); }
      if (row.id && !group.id) group.id = row.id;
      addToGroup(group, row);
    });
    return Array.from(map.values());
  }

  function itemGroups(rows, nameOf) {
    return groupBy(rows, function (row) { return row.id || '—'; }, function (row) {
      return row.name || (nameOf ? nameOf(row.id) : row.id) || row.id || '—';
    });
  }

  function cityGroups(rows) {
    return groupBy(rows, function (row) { return row.city || '—'; }, function (row) { return row.city || 'Sin ciudad'; });
  }

  function dateKey(ts) {
    var d = new Date(num(ts));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function weekKey(ts) {
    var d = new Date(num(ts));
    d.setHours(0, 0, 0, 0);
    var day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.getFullYear() + '-S' + String(Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / DAY) + 1) / 7)).padStart(2, '0');
  }

  function dailyGroups(rows) {
    return groupBy(rows, function (row) { return dateKey(row.ts); }).sort(function (a, b) { return a.key.localeCompare(b.key); });
  }

  function weeklyGroups(rows) {
    return groupBy(rows, function (row) { return weekKey(row.ts); }).sort(function (a, b) { return a.key.localeCompare(b.key); });
  }

  function hourGroups(rows) {
    var groups = [];
    for (var h = 0; h < 24; h++) groups.push(emptyGroup(String(h).padStart(2, '0'), String(h).padStart(2, '0') + ':00'));
    (rows || []).forEach(function (row) {
      var d = new Date(num(row.ts));
      addToGroup(groups[d.getHours()], row);
    });
    return groups;
  }

  function filterRows(rows, options) {
    options = options || {};
    var now = options.now || Date.now();
    var period = options.period || 'all';
    var city = options.city || '';
    var type = options.type || '';
    var minTs = 0;
    if (period !== 'all') minTs = now - Math.max(1, Number(period) || 1) * DAY;
    return (rows || []).filter(function (row) {
      if (type && row.type !== type) return false;
      if (city && (row.city || '') !== city) return false;
      if (minTs && num(row.ts) < minTs) return false;
      return true;
    });
  }

  root.AALedger = Object.freeze({
    VERSION: VERSION,
    migrateRows: migrateRows,
    gross: gross,
    fee: fee,
    craftCost: craftCost,
    netIncome: netIncome,
    investment: investment,
    operationNet: operationNet,
    metrics: metrics,
    itemGroups: itemGroups,
    cityGroups: cityGroups,
    dailyGroups: dailyGroups,
    weeklyGroups: weeklyGroups,
    hourGroups: hourGroups,
    filterRows: filterRows
  });
}(window));
