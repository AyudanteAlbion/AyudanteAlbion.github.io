/* Ayudante Albion — modelo de sesiones manuales e importador CSV.
 * Lógica pura sin dependencias de DOM ni red.
 */
(function (root) {
  'use strict';

  var VERSION = 1;
  var ACTIVITIES = {
    transport: 'Transporte',
    farming: 'Farmeo',
    crafting: 'Crafteo',
    flipping: 'Flipping',
    pve: 'PvE / Dungeons',
    pvp: 'PvP / Ganking',
    other: 'Otro'
  };

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function parseTs(value) {
    if (value == null) return null;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    var text = String(value).trim();
    if (!text || text.indexOf('0001-') === 0) return null;
    if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z';
    var ms = Date.parse(text);
    if (isFinite(ms)) return ms;
    // Fallback: DD/MM/YYYY or DD-MM-YYYY HH:mm:ss
    var m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (m) {
      var day = parseInt(m[1], 10), month = parseInt(m[2], 10) - 1, year = parseInt(m[3], 10);
      var hour = m[4] ? parseInt(m[4], 10) : 0, min = m[5] ? parseInt(m[5], 10) : 0, sec = m[6] ? parseInt(m[6], 10) : 0;
      var d = new Date(year, month, day, hour, min, sec);
      return isFinite(d.getTime()) ? d.getTime() : null;
    }
    return null;
  }

  function cleanFormula(str) {
    var text = String(str == null ? '' : str).trim();
    if (/^'?[=+\-@\t\r]/.test(text)) {
      text = text.replace(/^'?[=+\-@\t\r]+/, '');
    }
    return text;
  }

  function createId() {
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function matchActivityKey(raw) {
    var text = String(raw || '').trim().toLowerCase();
    if (!text) return 'other';
    if (ACTIVITIES[text]) return text;
    for (var k in ACTIVITIES) {
      if (ACTIVITIES[k].toLowerCase() === text) return k;
    }
    if (text.includes('trans')) return 'transport';
    if (text.includes('farm') || text.includes('granja') || text.includes('cultiv')) return 'farming';
    if (text.includes('craf') || text.includes('fabric')) return 'crafting';
    if (text.includes('flip') || text.includes('comerc')) return 'flipping';
    if (text.includes('pve') || text.includes('dung') || text.includes('fama')) return 'pve';
    if (text.includes('pvp') || text.includes('gank') || text.includes('mat')) return 'pvp';
    return 'other';
  }

  function normalizeSession(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var startTs = parseTs(raw.startTs != null ? raw.startTs : (raw.start != null ? raw.start : (raw.fecha_inicio != null ? raw.fecha_inicio : raw.ts)));
    if (!startTs) startTs = Date.now();
    var endRaw = raw.endTs != null ? raw.endTs : (raw.end != null ? raw.end : raw.fecha_fin);
    var endTs = (endRaw != null && endRaw !== '') ? parseTs(endRaw) : null;
    if (endTs && endTs < startTs) endTs = startTs;

    var id = raw.id ? cleanFormula(String(raw.id)).trim() : ('sess_' + startTs + '_' + (index || 0));
    var rawTitle = raw.title != null ? raw.title : (raw.titulo != null ? raw.titulo : (raw.name != null ? raw.name : ''));
    var title = cleanFormula(String(rawTitle || '')).trim().slice(0, 80) || 'Sesión';
    var actKey = matchActivityKey(raw.activity || raw.actividad || raw.tipo);
    var expenses = Math.max(0, num(raw.expenses != null ? raw.expenses : (raw.gastos != null ? raw.gastos : (raw.cost != null ? raw.cost : 0))));
    var note = cleanFormula(String(raw.note != null ? raw.note : (raw.nota != null ? raw.nota : ''))).trim().slice(0, 200);
    var tags = Array.isArray(raw.tags) ? raw.tags.map(function (t) { return cleanFormula(String(t)).trim(); }).filter(Boolean) : [];

    return {
      v: VERSION,
      id: id,
      title: title,
      activity: actKey,
      startTs: startTs,
      endTs: endTs,
      expenses: expenses,
      note: note,
      tags: tags
    };
  }

  function migrateSessions(list) {
    var rawList = Array.isArray(list) ? list : [];
    var changed = false;
    var out = [];
    rawList.forEach(function (item, idx) {
      var norm = normalizeSession(item, idx);
      if (norm) {
        if (!item || item.v !== VERSION || item.id !== norm.id) changed = true;
        out.push(norm);
      } else {
        changed = true;
      }
    });
    return { sessions: out, changed: changed, version: VERSION };
  }

  function sessionRows(session, allRows) {
    if (!session || !Array.isArray(allRows)) return [];
    var sid = session.id;
    var start = num(session.startTs);
    var end = session.endTs != null ? num(session.endTs) : null;

    return allRows.filter(function (r) {
      if (!r) return false;
      if (r.sessionId && r.sessionId === sid) return true;
      if (!r.sessionId && r.ts != null) {
        var t = num(r.ts);
        if (t >= start && (end == null || t <= end)) return true;
      }
      return false;
    });
  }

  function sessionDurationMs(session, now) {
    if (!session || !session.startTs) return 0;
    var start = num(session.startTs);
    var end = session.endTs != null ? num(session.endTs) : (now ? num(now) : Date.now());
    return Math.max(0, end - start);
  }

  function sessionMetrics(session, allRows, options) {
    options = options || {};
    var s = normalizeSession(session) || { id: '', title: '', activity: 'other', startTs: Date.now(), endTs: null, expenses: 0 };
    var rows = sessionRows(s, allRows);
    var durationMs = sessionDurationMs(s, options.now);
    var durationHours = durationMs / (3600 * 1000);

    var buyQty = 0, craftQty = 0, sellQty = 0;
    var grossSales = 0, netIncome = 0, operationInvestment = 0, fees = 0, craftCosts = 0;

    rows.forEach(function (r) {
      var q = num(r.qty);
      var p = num(r.price);
      var g = q * p;
      var f = Math.max(0, num(r.fee));
      fees += f;
      if (r.type === 'sell') {
        sellQty += q;
        grossSales += g;
        netIncome += (g - f);
      } else {
        var cCost = r.type === 'craft' ? Math.max(0, num(r.craftCost)) : 0;
        craftCosts += cCost;
        if (r.type === 'craft') craftQty += q;
        else buyQty += q;
        operationInvestment += (g + f + cCost);
      }
    });

    var expenses = Math.max(0, num(s.expenses));
    var totalInvestment = operationInvestment + expenses;
    var profit = netIncome - totalInvestment;
    var roi = totalInvestment > 0 ? profit / totalInvestment : null;
    var silverPerHour = durationHours >= (1 / 3600) ? Math.round(profit / durationHours) : (profit > 0 ? profit : 0);

    return {
      sessionId: s.id,
      title: s.title,
      activity: s.activity,
      activityLabel: ACTIVITIES[s.activity] || 'Otro',
      isActive: s.endTs == null,
      startTs: s.startTs,
      endTs: s.endTs,
      rowsCount: rows.length,
      buyQty: buyQty,
      craftQty: craftQty,
      sellQty: sellQty,
      totalQty: buyQty + craftQty + sellQty,
      grossSales: grossSales,
      netIncome: netIncome,
      fees: fees,
      craftCosts: craftCosts,
      operationInvestment: operationInvestment,
      expenses: expenses,
      totalInvestment: totalInvestment,
      profit: profit,
      roi: roi,
      durationMs: durationMs,
      durationHours: durationHours,
      silverPerHour: silverPerHour
    };
  }

  function sessionsSummary(sessions, allRows, options) {
    options = options || {};
    var list = Array.isArray(sessions) ? sessions : [];
    var totalSessions = list.length;
    var activeCount = 0;
    var totalDurationMs = 0;
    var totalExpenses = 0;
    var totalInvestment = 0;
    var totalNetIncome = 0;
    var totalProfit = 0;
    var totalRowsCount = 0;
    var bestSession = null;

    var metricsList = list.map(function (s) {
      var m = sessionMetrics(s, allRows, options);
      if (m.isActive) activeCount += 1;
      totalDurationMs += m.durationMs;
      totalExpenses += m.expenses;
      totalInvestment += m.totalInvestment;
      totalNetIncome += m.netIncome;
      totalProfit += m.profit;
      totalRowsCount += m.rowsCount;
      if (!bestSession || m.profit > bestSession.profit) {
        bestSession = m;
      }
      return m;
    });

    var totalHours = totalDurationMs / (3600 * 1000);
    var overallSilverPerHour = totalHours >= (1 / 3600) ? Math.round(totalProfit / totalHours) : 0;
    var overallRoi = totalInvestment > 0 ? totalProfit / totalInvestment : null;

    return {
      totalSessions: totalSessions,
      activeCount: activeCount,
      totalDurationMs: totalDurationMs,
      totalDurationHours: totalHours,
      totalExpenses: totalExpenses,
      totalInvestment: totalInvestment,
      totalNetIncome: totalNetIncome,
      totalProfit: totalProfit,
      totalRowsCount: totalRowsCount,
      overallRoi: overallRoi,
      overallSilverPerHour: overallSilverPerHour,
      bestSession: bestSession,
      metricsList: metricsList
    };
  }

  function activityGroups(sessions, allRows, options) {
    var summary = sessionsSummary(sessions, allRows, options);
    var groups = new Map();
    summary.metricsList.forEach(function (m) {
      var key = m.activity || 'other';
      var g = groups.get(key);
      if (!g) {
        g = {
          activity: key,
          activityLabel: m.activityLabel,
          sessionsCount: 0,
          totalDurationMs: 0,
          totalInvestment: 0,
          totalNetIncome: 0,
          totalProfit: 0,
          totalRowsCount: 0
        };
        groups.set(key, g);
      }
      g.sessionsCount += 1;
      g.totalDurationMs += m.durationMs;
      g.totalInvestment += m.totalInvestment;
      g.totalNetIncome += m.netIncome;
      g.totalProfit += m.profit;
      g.totalRowsCount += m.rowsCount;
    });

    return Array.from(groups.values()).map(function (g) {
      var hours = g.totalDurationMs / (3600 * 1000);
      return Object.assign({}, g, {
        totalDurationHours: hours,
        roi: g.totalInvestment > 0 ? g.totalProfit / g.totalInvestment : null,
        silverPerHour: hours >= (1 / 3600) ? Math.round(g.totalProfit / hours) : 0
      });
    }).sort(function (a, b) { return b.totalProfit - a.totalProfit; });
  }

  /* ---- Sanitización Anti CSV Injection ---- */
  function sanitizeCell(v) {
    var t = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }

  /* ---- RFC-4180 CSV Parser ---- */
  function parseCSV(text, options) {
    options = options || {};
    if (!text || typeof text !== 'string') return { headers: [], rows: [], rawRows: [] };

    var cleanText = text.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!cleanText.trim()) return { headers: [], rows: [], rawRows: [] };

    var firstLine = cleanText.split('\n')[0] || '';
    var delimiter = options.delimiter;
    if (!delimiter) {
      var commaCount = (firstLine.match(/,/g) || []).length;
      var semiCount = (firstLine.match(/;/g) || []).length;
      var tabCount = (firstLine.match(/\t/g) || []).length;
      if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
      else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
      else delimiter = ',';
    }

    var rawRows = [];
    var currentRow = [];
    var currentField = '';
    var inQuotes = false;
    var i = 0;
    var len = cleanText.length;

    while (i < len) {
      var ch = cleanText[i];
      var nextCh = i + 1 < len ? cleanText[i + 1] : '';

      if (inQuotes) {
        if (ch === '"') {
          if (nextCh === '"') {
            currentField += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i++;
            continue;
          }
        } else {
          currentField += ch;
          i++;
          continue;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
          continue;
        } else if (ch === delimiter) {
          currentRow.push(currentField);
          currentField = '';
          i++;
          continue;
        } else if (ch === '\n') {
          currentRow.push(currentField);
          currentField = '';
          if (currentRow.some(function (f) { return f.trim() !== ''; })) {
            rawRows.push(currentRow);
          }
          currentRow = [];
          i++;
          continue;
        } else {
          currentField += ch;
          i++;
          continue;
        }
      }
    }
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      if (currentRow.some(function (f) { return f.trim() !== ''; })) {
        rawRows.push(currentRow);
      }
    }

    if (!rawRows.length) return { headers: [], rows: [], rawRows: [] };

    var cleanRawRows = rawRows.map(function (r) {
      return r.map(function (cell) {
        var val = String(cell == null ? '' : cell).trim();
        return cleanFormula(val);
      });
    });

    var headers = cleanRawRows[0].map(function (h) {
      return String(h || '').trim().toLowerCase().replace(/[\s\-_]+/g, '_');
    });

    var rows = [];
    for (var rIdx = 1; rIdx < cleanRawRows.length; rIdx++) {
      var rowArray = cleanRawRows[rIdx];
      var rowObj = {};
      for (var hIdx = 0; hIdx < headers.length; hIdx++) {
        var hKey = headers[hIdx];
        if (hKey) rowObj[hKey] = rowArray[hIdx] != null ? rowArray[hIdx] : '';
      }
      rows.push(rowObj);
    }

    return { headers: headers, rows: rows, rawRows: cleanRawRows, delimiter: delimiter };
  }

  function parseTradeLogCSV(csvText, catalogLookup) {
    var parsed = parseCSV(csvText);
    var valid = [];
    var errors = [];
    var grossSales = 0, netIncome = 0, investment = 0;

    parsed.rows.forEach(function (obj, idx) {
      var lineNum = idx + 2;

      var rawDate = obj.fecha || obj.date || obj.timestamp || obj.ts || obj.time || obj.datetime;
      var ts = parseTs(rawDate);
      if (!ts) ts = Date.now();

      var rawId = obj.id || obj.item_id || obj.itemid || obj.unique_name || obj.item;
      var rawName = obj.name || obj.nombre || obj.item_name || obj.item;

      var rawType = String(obj.tipo || obj.type || '').trim().toLowerCase();
      var type = 'buy';
      if (rawType === 'venta' || rawType === 'sell' || rawType === 'sale' || rawType === 'v') type = 'sell';
      else if (rawType === 'crafteo' || rawType === 'craft' || rawType === 'c') type = 'craft';
      else if (rawType === 'compra' || rawType === 'buy' || rawType === 'b') type = 'buy';
      else if (!rawType) {
        errors.push({ line: lineNum, error: 'Tipo de operación no especificado' });
        return;
      }

      var rawQty = obj.cantidad || obj.cant || obj.qty || obj.count || obj.amount || obj.unidades;
      var qty = Math.max(1, parseInt(rawQty, 10) || 1);

      var rawPrice = obj.precio_unitario || obj.precio || obj.price || obj.unit_price || obj.costo || obj.cost;
      var price = num(rawPrice, -1);
      if (price < 0) {
        errors.push({ line: lineNum, error: 'Precio inválido o ausente: ' + rawPrice });
        return;
      }

      var rawFee = obj.comision_impuesto || obj.comision || obj.impuesto || obj.tax || obj.fee || 0;
      var fee = Math.max(0, num(rawFee, 0));

      var rawCraftCost = obj.coste_extra_crafteo || obj.coste_crafteo || obj.craft_cost || obj.craftcost || 0;
      var craftCost = type === 'craft' ? Math.max(0, num(rawCraftCost, 0)) : 0;

      var city = cleanFormula(String(obj.ciudad || obj.city || obj.location || '')).trim();
      var note = cleanFormula(String(obj.nota || obj.note || obj.notes || obj.notas || '')).trim().slice(0, 100);
      var sessionId = cleanFormula(String(obj.sesion || obj.session || obj.session_id || obj.sesion_id || '')).trim();

      var itemId = rawId ? cleanFormula(String(rawId)).trim() : '';
      var itemName = rawName ? cleanFormula(String(rawName)).trim() : '';

      if (!itemId && itemName && catalogLookup && typeof catalogLookup.findIdByName === 'function') {
        itemId = catalogLookup.findIdByName(itemName) || itemName;
      } else if (!itemId && itemName) {
        itemId = itemName;
      }

      if (!itemId) {
        errors.push({ line: lineNum, error: 'Identificador de ítem ausente' });
        return;
      }

      if (!itemName && catalogLookup && typeof catalogLookup.nameOf === 'function') {
        itemName = catalogLookup.nameOf(itemId) || itemId;
      } else if (!itemName) {
        itemName = itemId;
      }

      var rowUid = obj.uid ? String(obj.uid).trim() : ('ll_' + ts + '_' + itemId.replace(/\W/g, '').slice(0, 20) + '_' + idx);

      var validRow = {
        v: 2,
        uid: rowUid,
        ts: ts,
        id: itemId,
        name: itemName,
        type: type,
        qty: qty,
        price: price,
        fee: fee,
        craftCost: craftCost,
        city: city,
        note: note
      };
      if (sessionId) validRow.sessionId = sessionId;

      var g = qty * price;
      if (type === 'sell') {
        grossSales += g;
        netIncome += (g - fee);
      } else {
        investment += (g + fee + craftCost);
      }

      valid.push(validRow);
    });

    return {
      valid: valid,
      errors: errors,
      summary: {
        totalParsed: parsed.rows.length,
        validCount: valid.length,
        invalidCount: errors.length,
        grossSales: grossSales,
        netIncome: netIncome,
        investment: investment,
        estimatedProfit: netIncome - investment
      }
    };
  }

  function mergeTradeRows(existingRows, incomingRows, mode) {
    mode = mode === 'replace' ? 'replace' : 'append';
    var ex = Array.isArray(existingRows) ? existingRows : [];
    var inc = Array.isArray(incomingRows) ? incomingRows : [];

    if (mode === 'replace') {
      return {
        rows: inc.slice(),
        added: inc.length,
        skipped: 0,
        mode: 'replace'
      };
    }

    var existingUids = new Set(ex.map(function (r) { return r.uid; }).filter(Boolean));
    var signatureSet = new Set(ex.map(function (r) {
      return [r.ts, r.id, r.type, r.qty, r.price, r.city || ''].join('|');
    }));

    var merged = ex.slice();
    var added = 0;
    var skipped = 0;

    inc.forEach(function (r) {
      if (!r) return;
      var sig = [r.ts, r.id, r.type, r.qty, r.price, r.city || ''].join('|');
      if ((r.uid && existingUids.has(r.uid)) || signatureSet.has(sig)) {
        skipped += 1;
        return;
      }
      if (r.uid) existingUids.add(r.uid);
      signatureSet.add(sig);
      merged.push(r);
      added += 1;
    });

    return {
      rows: merged,
      added: added,
      skipped: skipped,
      mode: 'append'
    };
  }

  function exportTradeLogCSV(rows) {
    var head = 'version,fecha,item,id,tipo,cantidad,precio_unitario,bruto,comision_impuesto,coste_extra_crafteo,ingreso_neto,inversion,neto_operacion,ciudad,nota,sesion\n';
    var TYPE_ES = { buy: 'Compra', sell: 'Venta', craft: 'Crafteo' };
    var lines = (rows || []).map(function (r) {
      var grossVal = num(r.qty) * num(r.price);
      var feeVal = Math.max(0, num(r.fee));
      var craftCostVal = r.type === 'craft' ? Math.max(0, num(r.craftCost)) : 0;
      var netIncomeVal = r.type === 'sell' ? (grossVal - feeVal) : 0;
      var investmentVal = r.type === 'sell' ? 0 : (grossVal + feeVal + craftCostVal);
      var netOp = r.type === 'sell' ? netIncomeVal : -investmentVal;
      var d = new Date(num(r.ts));
      var dateStr = isFinite(d.getTime()) ? d.toISOString() : '';

      return [
        2,
        dateStr,
        sanitizeCell(r.name || r.id),
        sanitizeCell(r.id),
        TYPE_ES[r.type] || r.type,
        r.qty,
        r.price,
        grossVal,
        feeVal,
        craftCostVal,
        netIncomeVal,
        investmentVal,
        netOp,
        sanitizeCell(r.city || ''),
        sanitizeCell(r.note || ''),
        sanitizeCell(r.sessionId || '')
      ].join(',');
    });
    return '\ufeff' + head + lines.join('\n');
  }

  function exportSessionsCSV(sessions, allRows, options) {
    var head = 'id,titulo,actividad,estado,fecha_inicio,fecha_fin,duracion_minutos,gastos_operativos,inversion_total,ingreso_neto,beneficio_neto,roi_pct,silver_hora,operaciones,nota\n';
    var lines = (sessions || []).map(function (s) {
      var m = sessionMetrics(s, allRows, options);
      var startIso = new Date(num(s.startTs)).toISOString();
      var endIso = s.endTs ? new Date(num(s.endTs)).toISOString() : '';
      var durMin = Math.round(m.durationMs / 60000);
      var roiTxt = m.roi != null ? (m.roi * 100).toFixed(2) + '%' : '';

      return [
        sanitizeCell(s.id),
        sanitizeCell(s.title),
        sanitizeCell(m.activityLabel),
        m.isActive ? 'Activa' : 'Cerrada',
        startIso,
        endIso,
        durMin,
        m.expenses,
        m.totalInvestment,
        m.netIncome,
        m.profit,
        roiTxt,
        m.silverPerHour,
        m.rowsCount,
        sanitizeCell(s.note || '')
      ].join(',');
    });
    return '\ufeff' + head + lines.join('\n');
  }

  root.AASessions = Object.freeze({
    VERSION: VERSION,
    ACTIVITIES: ACTIVITIES,
    createId: createId,
    normalizeSession: normalizeSession,
    migrateSessions: migrateSessions,
    sessionRows: sessionRows,
    sessionDurationMs: sessionDurationMs,
    sessionMetrics: sessionMetrics,
    sessionsSummary: sessionsSummary,
    activityGroups: activityGroups,
    sanitizeCell: sanitizeCell,
    parseCSV: parseCSV,
    parseTradeLogCSV: parseTradeLogCSV,
    mergeTradeRows: mergeTradeRows,
    exportTradeLogCSV: exportTradeLogCSV,
    exportSessionsCSV: exportSessionsCSV
  });
}(window));
