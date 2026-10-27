/* Семейные квесты — общая логика (браузер и Apps Script).
   Чистые функции без зависимостей: даты, производственный календарь Беларуси,
   расписания дел, статусы и подсчёт баллов. */
var FQ = (function () {
  "use strict";

  /* ---------- даты ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function monthKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function parseDay(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseDay(s); d.setDate(d.getDate() + n); return dayKey(d); }
  function isoDow(s) { var w = parseDay(s).getDay(); return w === 0 ? 7 : w; } // 1=пн … 7=вс
  function weekStart(s) { return addDays(s, 1 - isoDow(s)); }                  // понедельник
  function weekEnd(s) { return addDays(weekStart(s), 6); }                     // воскресенье
  function atTime(s, hhmm) { var d = parseDay(s); var t = (hhmm || "21:00").split(":"); d.setHours(+t[0], +t[1], 0, 0); return d.getTime(); }

  /* ---------- производственный календарь Беларуси ---------- */
  var FIXED = {
    "01-01": "Новый год", "01-02": "Новый год", "01-07": "Рождество Христово (православное)",
    "03-08": "День женщин", "05-01": "Праздник труда", "05-09": "День Победы",
    "07-03": "День Независимости", "11-07": "День Октябрьской революции", "12-25": "Рождество Христово (католическое)"
  };
  // Официальные переносы (постановления Совмина). 2027 — переносов нет.
  var TRANSFERS = {
    "2025-01-06": "off", "2025-01-11": "work",
    "2025-04-28": "off", "2025-04-26": "work",
    "2025-07-04": "off", "2025-07-12": "work",
    "2025-12-26": "off", "2025-12-20": "work",
    "2026-04-20": "off", "2026-04-25": "work"
  };
  function orthodoxEaster(y) {           // алгоритм Гаусса для юлианской Пасхи + 13 дней
    var a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
    var m = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
    var j = new Date(y, m - 1, day); j.setDate(j.getDate() + 13); return dayKey(j);
  }
  function radunitsa(y) { return addDays(orthodoxEaster(y), 9); }

  /* Тип дня: work | off, с причиной. overrides — {date:{type}} от родителей. */
  function dayInfo(s, cfg) {
    var ov = cfg && cfg.days && cfg.days[s];
    var useBY = false; // государственные праздники больше не подставляются: выходные дни отмечают родители в «Календаре»
    var dow = isoDow(s);
    var base = { type: dow >= 6 ? "off" : "work", reason: dow >= 6 ? "weekend" : "", name: "" };
    if (useBY) {
      var y = +s.slice(0, 4), md = s.slice(5);
      if (FIXED[md]) base = { type: "off", reason: "holiday", name: FIXED[md] };
      else if (s === radunitsa(y)) base = { type: "off", reason: "holiday", name: "Радуница" };
      else if (TRANSFERS[s] === "off") base = { type: "off", reason: "transfer", name: "Перенос выходного" };
      else if (TRANSFERS[s] === "work") base = { type: "work", reason: "transfer", name: "Рабочая суббота (перенос)" };
    }
    if (ov && (ov.type === "off" || ov.type === "work")) {
      return { type: ov.type, reason: "parent", name: ov.type === "off" ? "Выходной (решение родителей)" : "Рабочий день (решение родителей)", base: base };
    }
    return base;
  }

  /* ---------- дела ---------- */
  // Категории: mandatory × bound.
  function category(t) { return (t.mandatory ? "m" : "o") + (t.bound ? "b" : "u"); }
  var CATEGORY_NAMES = {
    mb: "Обязательные по расписанию", ob: "Дополнительные по расписанию",
    mu: "Обязательные на неделе", ou: "Дополнительные в любое время"
  };
  function forKid(t, kid) { return !t.who || t.who === "all" || t.who === kid; }
  function live(map) { var out = []; for (var k in (map || {})) { var x = map[k]; if (x && !x.del) out.push(x); } return out.sort(function (a, b) { return (a.o || 0) - (b.o || 0); }); }

  // Применяется ли дело с привязкой к конкретной дате.
  function applies(t, s, cfg) {
    if (!t.bound || t.active === false || t.del) return false;
    var sch = t.schedule || { mode: "workdays" };
    var info = dayInfo(s, cfg);
    if (sch.mode === "workdays") return info.type === "work";
    if (sch.mode === "offdays") return info.type === "off";
    if (sch.mode === "days") return (sch.days || []).indexOf(isoDow(s)) >= 0 && !(sch.skipOff && info.type === "off"); // «не показывать в выходные»
    return info.type === "work";
  }
  /* Срок дела со временем: none — без срока; strict — после срока закрыто; late — можно сдать позже за часть баллов.
     Возвращает null, если срока нет, иначе {phase: open|closed|late, deadline, left}. */
  function deadline(t, s, cfg, now) {
    if (!t.bound || !t.time || !t.deadline || t.deadline === "none") return null;
    now = now || Date.now();
    var end = atTime(s, t.time) + (t.grace == null ? 30 : t.grace) * 60000;
    if (now <= end) return { phase: "open", deadline: end, left: end - now };
    return { phase: t.deadline === "strict" ? "closed" : "late", deadline: end, left: 0, pct: t.latePct == null ? 50 : t.latePct };
  }
  function mult(cfg, s, taskId) { var d = cfg && cfg.days && cfg.days[s]; return d && d.x2 && d.x2.indexOf(taskId) >= 0 ? 2 : 1; }

  /* Записи ребёнка приходят из базы, куда он пишет сам, поэтому каждое поле проверяется:
     в приложение попадают только ожидаемые типы (защита от подмены и внедрения кода). */
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/, DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function num(v, lo, hi) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function strList(v, max, re) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string" && (!re || re.test(x)); }).slice(0, max).map(function (x) { return x.slice(0, 300); }) : []; }
  function cleanEntry(x, kid) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id)) return null;
    var type = x.type === "wish" || x.type === "game" ? x.type : x.type === "task" ? "task" : null;
    if (!type || typeof x.day !== "string" || !DAY_RE.test(x.day)) return null;
    return {
      id: x.id, kid: kid, type: type, day: x.day, at: num(x.at, 0, 1e13),
      ref: typeof x.ref === "string" && ID_RE.test(x.ref) ? x.ref : "",
      title: str(x.title, 200), pts: num(x.pts, 0, 100000),
      checks: strList(x.checks, 30), photos: strList(x.photos, 3, ID_RE),
      late: x.late === true, latePct: x.latePct == null ? null : num(x.latePct, 0, 100),
      resent: x.resent === true, manual: x.manual === true, withdrawn: x.withdrawn === true,
      cancelled: x.cancelled === true, minutes: num(x.minutes, 0, 1440)
    };
  }
  // Сколько стоит запись: дело — не дороже, чем назначили родители; награда — не дешевле её цены.
  function entryValue(x, cfg) {
    var pts = x.pts;
    if (x.type === "task") {
      var t = cfg && cfg.tasks && cfg.tasks[x.ref];
      if (t && isFinite(+t.pts)) pts = Math.min(pts, +t.pts);
      pts = pts * mult(cfg, x.day, x.ref);
      if (x.late) pts = Math.round(pts * (x.latePct == null ? 50 : x.latePct) / 100);
    } else if (x.type === "wish") {
      var w = cfg && cfg.wishes && cfg.wishes[x.ref];
      if (w && isFinite(+w.cost)) pts = Math.max(pts, +w.cost);
    }
    return pts;
  }
  // Снимок записи в решении родителя: после проверки сумма и суть записи берутся отсюда,
  // и изменить или удалить их со стороны ребёнка уже нельзя.
  function snapshot(e) { return { type: e.type, ref: e.ref, title: e.title, day: e.day, at: e.at, value: e.value }; }
  function kidOfDoc(id) { var i = String(id).lastIndexOf("_"); return i > 0 ? String(id).slice(0, i) : ""; }

  /* ---------- записи и решения ----------
     kidlog/{kid_YYYY-MM}.e[id]  — что сделал ребёнок (task | wish | game)
     plog/{kid_YYYY-MM}.d[id]    — решение проверки {status, note, decidedAt, instant, snap}
     plog/{kid_YYYY-MM}.g[id]    — подарки и бонусы родителей */
  function merge(kidlogs, plogs, cfg) {
    var entries = [], gifts = [];
    var pmap = {}, seen = {};
    (plogs || []).forEach(function (p) { pmap[p.id] = p; (function (g) { for (var k in g) gifts.push(g[k]); })(p.g || {}); });
    (kidlogs || []).forEach(function (doc) {
      var p = pmap[doc.id] || {}, kid = kidOfDoc(doc.id);
      var e = doc.e || {};
      for (var k in e) {
        var x = cleanEntry(e[k], kid); if (!x) continue;
        var dec = (p.d || {})[x.id] || null;
        var snap = dec && dec.status && dec.snap && typeof dec.snap === "object" ? dec.snap : null;
        var resubmitted = dec && dec.status === "redo" && x.at > (dec.decidedAt || 0);
        if (x.withdrawn && !(dec && dec.status && !resubmitted)) continue; // ребёнок отменил заявку до проверки
        seen[doc.id + "/" + x.id] = true;
        var status;
        if (x.type === "game") status = x.cancelled ? "no" : "ok";
        else if (!dec || !dec.status) status = "pending";
        else if (resubmitted) status = "pending";
        else status = dec.status;
        var value = entryValue(x, cfg);
        if (snap && !resubmitted) { x = applySnap(x, snap); value = num(snap.value, 0, 1e6); }
        entries.push(Object.assign(x, { status: status, dec: dec, value: value, doc: doc.id }));
      }
    });
    // Проверенные записи, которые ребёнок удалил у себя, восстанавливаются из снимка в решении.
    (plogs || []).forEach(function (p) {
      var d = p.d || {}, kid = kidOfDoc(p.id);
      for (var id in d) {
        var dec = d[id];
        if (seen[p.id + "/" + id] || !dec || !dec.status || !dec.snap || !ID_RE.test(id)) continue;
        var x = cleanEntry({ id: id, type: dec.snap.type, day: dec.snap.day, at: dec.snap.at, ref: dec.snap.ref, title: dec.snap.title, pts: dec.snap.value }, kid);
        if (!x) continue;
        entries.push(Object.assign(x, { status: dec.status, dec: dec, value: num(dec.snap.value, 0, 1e6), doc: p.id }));
      }
    });
    entries.sort(function (a, b) { return a.at - b.at; });
    gifts.sort(function (a, b) { return a.at - b.at; });
    return { entries: entries, gifts: gifts };
  }
  function applySnap(x, sn) {
    var y = cleanEntry({ id: x.id, type: sn.type, day: sn.day, at: sn.at, ref: sn.ref, title: sn.title, pts: sn.value }, x.kid);
    if (!y) return x;
    y.checks = x.checks; y.photos = x.photos; y.resent = x.resent; y.manual = x.manual; y.late = x.late; y.latePct = x.latePct; y.minutes = x.minutes;
    return y;
  }

  function creditTime(cfg) { return (cfg && cfg.settings && cfg.settings.creditTime) || "21:00"; }
  // dec.instant — родитель отметил «сразу в банк»: баллы доступны с момента решения.
  function creditAt(e, cfg) { if (e.dec && e.dec.instant) return e.dec.decidedAt || 0; return Math.max(atTime(e.day, creditTime(cfg)), (e.dec && e.dec.decidedAt) || 0); }
  function activeAt(e, cfg) { if (e.dec && e.dec.instant) return e.dec.decidedAt || 0; return Math.max(atTime(weekEnd(e.day), creditTime(cfg)), (e.dec && e.dec.decidedAt) || 0); }

  /* Счёт ребёнка на момент now. */
  function account(kid, data, cfg, now) {
    now = now || Date.now();
    var r = { available: 0, locked: 0, tonight: 0, reserved: 0, earnedTotal: 0, gifts: 0, today: 0, week: 0 };
    var today = dayKey(new Date(now)), ws = weekStart(today);
    data.entries.forEach(function (e) {
      if (e.kid !== kid) return;
      if (e.type === "task" && e.status === "ok") {
        r.earnedTotal += e.value;
        if (e.day === today) r.today += e.value;
        if (e.day >= ws) r.week += e.value;
        if (activeAt(e, cfg) <= now) r.available += e.value;
        else { r.locked += e.value; if (creditAt(e, cfg) > now) r.tonight += e.value; }
      }
      if (e.type === "wish" && e.status !== "no") { r.available -= e.value; if (e.status === "pending") r.reserved += e.value; }
    });
    data.gifts.forEach(function (g) { if (g.kid === kid && g.at <= now) { r.available += g.pts; if (g.pts > 0) r.gifts += g.pts; } });
    return r;
  }

  /* Состояние дела для ребёнка на дату s (обычно сегодня). */
  function taskState(t, kid, s, data) {
    var mine = data.entries.filter(function (e) { return e.type === "task" && e.ref === t.id && e.kid === kid && e.status !== "no"; });
    var rel, freq = t.bound ? "day" : (t.freq || "week");
    if (freq === "day") rel = mine.filter(function (e) { return e.day === s; });
    else if (freq === "week") {
      var ws = weekStart(s), we = weekEnd(s);
      rel = mine.filter(function (e) { return e.day >= ws && e.day <= we; });
      var need = Math.max(1, t.times || 1);
      var redoW = rel.filter(function (e) { return e.status === "redo"; })[0];
      if (redoW) return { free: false, status: "redo", entry: redoW, count: rel.length, need: need };
      var okN = rel.filter(function (e) { return e.status === "ok"; }).length, pend = rel.filter(function (e) { return e.status === "pending"; }).length;
      if (rel.length < need) return { free: true, count: okN, pending: pend, need: need };
      return { free: false, status: pend ? "pending" : "ok", count: okN, need: need, entry: rel.filter(function (e) { return e.status === "pending"; }).slice(-1)[0] };
    }
    else if (freq === "once") rel = mine;
    else { // many
      var r2 = mine.filter(function (e) { return e.status === "redo"; })[0];
      if (r2) return { free: false, status: "redo", entry: r2 };
      return { free: true, pending: mine.filter(function (e) { return e.status === "pending"; }).length };
    }
    if (!rel.length) return { free: true };
    var redo = rel.filter(function (e) { return e.status === "redo"; })[0];
    if (redo) return { free: false, status: "redo", entry: redo };
    var pe = rel.filter(function (e) { return e.status === "pending"; }).slice(-1)[0];
    return { free: false, status: pe ? "pending" : "ok", entry: pe };
  }

  /* Сводка дня для календаря. */
  function daySummary(kid, s, data, cfg, todayS, now) {
    // Нет ребёнка — нет ни дел, ни пропусков.
    var kidObj = (cfg.kids || []).filter(function (k) { return k.id === kid; })[0];
    var tasks = kid && kidObj ? live(cfg.tasks).filter(function (t) { return forKid(t, kid); }) : [];
    var done = data.entries.filter(function (e) { return e.kid === kid && e.day === s && e.type === "task"; });
    var pts = 0; done.forEach(function (e) { if (e.status === "ok") pts += e.value; });
    var planned = tasks.filter(function (t) { return applies(t, s, cfg); });
    var missed = [];
    // Пропуски считаются только с даты создания семьи и с даты включения дела.
    var startDay = cfg.createdAt ? dayKey(new Date(cfg.createdAt)) : "";
    if (kidObj && kidObj.since && kidObj.since > startDay) startDay = kidObj.since; // ребёнок добавлен позже
    if (s <= todayS) {
      planned.forEach(function (t) {
        if (!t.mandatory) return;
        var from = t.since && t.since > startDay ? t.since : startDay;
        if (from && s < from) return;
        if (s === todayS) { var dl = deadline(t, s, cfg, now); if (!dl || dl.phase !== "closed") return; }
        var ok = done.some(function (e) { return e.ref === t.id && e.status !== "no"; });
        if (!ok) missed.push(t);
      });
    }
    var gifts = data.gifts.filter(function (g) { return g.kid === kid && g.day === s; });
    return { day: s, info: dayInfo(s, cfg), pts: pts, done: done, planned: planned, missed: missed, gifts: gifts };
  }

  return {
    snapshot: snapshot, cleanEntry: cleanEntry,
    pad: pad, dayKey: dayKey, monthKey: monthKey, parseDay: parseDay, addDays: addDays, isoDow: isoDow,
    weekStart: weekStart, weekEnd: weekEnd, atTime: atTime, orthodoxEaster: orthodoxEaster, radunitsa: radunitsa,
    dayInfo: dayInfo, category: category, CATEGORY_NAMES: CATEGORY_NAMES, forKid: forKid, live: live, applies: applies,
    mult: mult, deadline: deadline, merge: merge, creditAt: creditAt, activeAt: activeAt, creditTime: creditTime, account: account,
    taskState: taskState, daySummary: daySummary
  };
})();
if (typeof module !== "undefined") module.exports = FQ;
