/* Ayudante Albion — historial y análisis de mercado. */
(function (root) {
  'use strict';

  function saveSnapshot(history, id, data, now) {
    var rows = (data || []).map(function (r) {
      return { city: r.city, quality: r.quality, sell: r.sell_price_min || 0,
        buy: r.buy_price_max || 0, sellDate: r.sell_price_min_date || null,
        buyDate: r.buy_price_max_date || null };
    });
    return [{ id: id, ts: now, rows: rows }].concat(
      history.filter(function (s) { return !(s.id === id && now - s.ts < 2 * 60 * 1000); })
    ).slice(0, 120);
  }

  function trend(history, id, quality, blackMarket) {
    var points = [];
    history.filter(function (s) { return s.id === id; }).forEach(function (s) {
      var row = s.rows.find(function (r) {
        return r.quality === quality && r.city !== blackMarket && r.sell > 0;
      });
      if (row) points.push({ ts: s.ts, value: row.sell });
    });
    points.sort(function (a, b) { return a.ts - b.ts; });
    if (points.length < 2) return null;
    var first = points[0].value, last = points[points.length - 1].value;
    return { points: points, change: first ? (last - first) / first : 0, last: last };
  }

  function opportunities(grid, cities, blackMarket) {
    var result = [];
    cities.filter(function (c) { return c !== blackMarket; }).forEach(function (from) {
      cities.forEach(function (to) {
        if (from === to) return;
        var buy = grid[from] && grid[from][1] ? grid[from][1].sell || 0 : 0;
        var sale = grid[to] && grid[to][1] ? grid[to][1].buy || 0 : 0;
        if (!buy || !sale) return;
        var net = sale * (1 - (to === blackMarket ? 0.04 : 0.065));
        var profit = net - buy;
        if (profit > 0) result.push({ from: from, to: to, buy: buy, sale: sale,
          profit: profit, margin: profit / buy });
      });
    });
    return result.sort(function (a, b) { return b.profit - a.profit; });
  }

  root.AAMarketHistory = Object.freeze({ saveSnapshot: saveSnapshot, trend: trend,
    opportunities: opportunities });
}(window));
