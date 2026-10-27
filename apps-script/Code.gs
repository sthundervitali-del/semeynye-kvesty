/* Файл собран автоматически: core.js + server.gs + deploy.gs. Вставьте его целиком в Code.gs. */
/** Нажмите «Выполнить», чтобы опубликовать свежую версию приложения с GitHub. */
function publishApp() { checkMail(); deploy(); }

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

/* ===== Семейные квесты — серверная часть (Google Apps Script) =====
   Каждые 5 минут: напоминания об обязательных делах, вечернее зачисление,
   уведомления родителям о заявках, подарки.
   Свойства скрипта: PROJECT_ID (обязательно), APP_URL, SUPPORT_EMAIL, ADMIN_EMAIL (или ADMIN_UID). */

var P = PropertiesService.getScriptProperties();
function prop(k, d) { return P.getProperty(k) || d; }

/** Запустите один раз: создаёт таймер на каждые 5 минут и делает пробный прогон. */
function setup() {
  if (!prop("PROJECT_ID")) throw new Error("Укажите свойство PROJECT_ID в настройках проекта (Параметры проекта → Свойства скрипта).");
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tick").timeBased().everyMinutes(5).create();
  var fams = fsList("families");
  console.log("Готово. Найдено семей: " + fams.length + ". Таймер на каждые 5 минут создан.");
  tick();
}

function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    fsList("families").forEach(function (f) {
      try { processFamily(f); } catch (e) { console.error("Семья " + f.id + ": " + (e && e.stack || e)); }
    });
    try { processSupport(); } catch (e) { console.error("Поддержка: " + (e && e.stack || e)); }
  } finally { lock.releaseLock(); }
}

/* ---------- Поддержка ----------
   Переписка идёт внутри приложения (коллекция support). Сервер:
   — назначает администратора поддержки по свойству ADMIN_UID (документ admins/{uid});
   — пишет на SUPPORT_EMAIL короткое уведомление о новом сообщении пользователя (адрес пользователям не виден);
   — присылает родителю пуш, когда поддержка ответила. */
function processSupport() {
  var adminUid = prop("ADMIN_UID");
  if (!adminUid && prop("ADMIN_EMAIL")) { // находим аккаунт администратора по почте среди родителей
    var want = prop("ADMIN_EMAIL").toLowerCase().trim();
    fsList("families").some(function (f) {
      return fsList("families/" + f.id + "/members").some(function (m) { if (String(m.email || "").toLowerCase() === want) { adminUid = m.id; return true; } });
    });
    if (adminUid) P.setProperty("ADMIN_UID", adminUid);
  }
  if (adminUid && prop("ADMIN_DONE") !== adminUid) { if (fsPatch("admins/" + adminUid, { at: Date.now() }, ["at"])) P.setProperty("ADMIN_DONE", adminUid); }
  var to = prop("SUPPORT_EMAIL"), sent = 0;
  fsList("support").forEach(function (r) {
    var th = r.thread || [{ from: "user", text: r.text || "", at: r.at }];
    var last = th[th.length - 1] || {};
    var lastUser = th.filter(function (x) { return x.from === "user"; }).slice(-1)[0];
    if (lastUser && to && lastUser.at > (r.mailedAt || 0) && sent < 10) { // письмо о каждом новом сообщении пользователя, даже если вы уже ответили в приложении
      last = lastUser;
      var body = (th.length > 1 ? "Новое сообщение в запросе" : "Новый запрос") + " от " + (r.name || "") + " <" + (r.email || "") + ">, семья «" + (r.family || "") + "».\n\n" +
        last.text + "\n\n— — —\nОтветить можно в приложении: Настройки → Администрирование → Запросы пользователей.\n" + (prop("APP_URL", "") || "");
      try {
        MailApp.sendEmail(to, "FamilyQuests: " + String(r.subject).slice(0, 120) + (th.length > 1 ? " (новое сообщение)" : ""), body, { name: "Family Quests" });
        fsPatch("support/" + r.id, { mailedAt: Date.now() }, ["mailedAt"]); sent++;
      } catch (e) { console.error("Письмо в поддержку не отправлено: " + e); sent = 99; } // без права на почту — не мешаем пушам
    }
    last = th[th.length - 1] || {};
    if (last.from === "support" && last.at > (r.notifiedAt || 0)) {
      var m = r.fid && r.uid ? fsGet("families/" + r.fid + "/members/" + r.uid) : null;
      if (m) push(m, r.fid, isEn(m) ? "💬 Support replied" : "💬 Ответ поддержки", String(r.subject).slice(0, 80));
      fsPatch("support/" + r.id, { notifiedAt: Date.now() }, ["notifiedAt"]);
    }
  });
}

/** Проверка права на отправку писем: выберите checkMail и нажмите «Выполнить» (письмо не отправляется). */
function checkMail() { console.log("Право на почту есть. Писем на сегодня осталось: " + MailApp.getRemainingDailyQuota() + ". Адрес поддержки: " + (prop("SUPPORT_EMAIL") ? "задан" : "НЕ задан")); }

/* ---------- Firestore REST ---------- */
function base() { return "https://firestore.googleapis.com/v1/projects/" + prop("PROJECT_ID") + "/databases/(default)/documents/"; }
function call(method, url, body) {
  var opt = { method: method, muteHttpExceptions: true, contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Goog-User-Project": prop("PROJECT_ID") } };
  if (body) opt.payload = JSON.stringify(body);
  var r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode(), txt = r.getContentText();
  return { code: code, json: txt ? JSON.parse(txt) : {} };
}
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  var f = {}; for (var k in v) f[k] = toFs(v[k]); return { mapValue: { fields: f } };
}
function fromFs(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return new Date(v.timestampValue).getTime();
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFs);
  if ("mapValue" in v) { var o = {}, f = v.mapValue.fields || {}; for (var k in f) o[k] = fromFs(f[k]); return o; }
  return null;
}
function docOf(d) { var o = fromFs({ mapValue: { fields: d.fields || {} } }); o.id = d.name.split("/").pop(); return o; }
function fsGet(path) { var r = call("get", base() + path); return r.code === 200 ? docOf(r.json) : null; }
function fsList(path) {
  var out = [], token = "";
  do {
    var r = call("get", base() + path + "?pageSize=300" + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
    if (r.code !== 200) throw new Error("Firestore " + r.code + ": " + JSON.stringify(r.json));
    (r.json.documents || []).forEach(function (d) { out.push(docOf(d)); });
    token = r.json.nextPageToken || "";
  } while (token);
  return out;
}
function fsDelete(path) { var r = call("delete", base() + path); return r.code === 200; }
function fsListMeta(path) { // только служебные поля, без содержимого (фото не скачиваются)
  var out = [], token = "";
  do {
    var r = call("get", base() + path + "?pageSize=300&mask.fieldPaths=at" + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
    if (r.code !== 200) throw new Error("Firestore " + r.code);
    (r.json.documents || []).forEach(function (d) { out.push(docOf(d)); });
    token = r.json.nextPageToken || "";
  } while (token);
  return out;
}
function fsBatchGet(paths) {
  if (!paths.length) return [];
  var root = "projects/" + prop("PROJECT_ID") + "/databases/(default)/documents/";
  var r = call("post", "https://firestore.googleapis.com/v1/" + root + ":batchGet", { documents: paths.map(function (p) { return root + p; }) });
  if (r.code !== 200) throw new Error("batchGet " + r.code);
  return (r.json || []).filter(function (x) { return x.found; }).map(function (x) { return docOf(x.found); });
}
/* Частичная запись: data — объект, mask — список путей полей (a.b.c). */
function fsPatch(path, data, mask) {
  var q = mask.map(function (m) { return "updateMask.fieldPaths=" + encodeURIComponent(m); }).join("&");
  var r = call("patch", base() + path + "?" + q, { fields: toFs(data).mapValue.fields });
  if (r.code !== 200) console.error("patch " + path + " " + r.code + " " + JSON.stringify(r.json));
  return r.code === 200;
}

/* ---------- Push (Firebase Cloud Messaging) ---------- */
function push(member, fid, title, body) {
  var tokens = (member && member.tokens) || [];
  var dead = [];
  tokens.forEach(function (tk) {
    var r = call("post", "https://fcm.googleapis.com/v1/projects/" + prop("PROJECT_ID") + "/messages:send", { message: {
      token: tk, notification: { title: title, body: body || "" },
      webpush: { notification: { icon: "/icon-192.png", badge: "/icon-192.png" }, fcm_options: { link: prop("APP_URL", "/") } } } });
    if (r.code === 404 || (r.code === 400 && JSON.stringify(r.json).indexOf("not a valid FCM registration token") >= 0)) dead.push(tk);
    else if (r.code !== 200) console.error("FCM " + r.code + " " + JSON.stringify(r.json));
  });
  if (dead.length) fsPatch("families/" + fid + "/members/" + member.id, { tokens: tokens.filter(function (t) { return dead.indexOf(t) < 0; }) }, ["tokens"]);
}

/* ---------- язык уведомлений ---------- */
var TPL_EN = { school: "Leave for school", bed: "Make the bed", teeth: "Brush teeth morning and evening", homework: "Do homework", room: "Tidy room", sleep: "Go to bed",
  read: "Read a book for 20 minutes", cook: "Help with lunch or dinner", trash: "Take out the trash", clean: "Deep-clean the room", vacuum: "Vacuum the flat",
  sport: "Exercise or sport for 20 minutes", flowers: "Water the plants", dishes: "Wash everyone's dishes", grade: "Get a good grade", exam: "An hour of test prep", help: "Help parents without being asked" };
var WISH_EN = { games30: "+30 minutes of computer games", movie: "Choose the family movie", late: "Go to bed an hour later on Friday", food: "Favourite dinner",
  nochores: "A day without chores", book: "A craft kit or a book of your choice", cinema: "Movies with friends", ingame: "In-game purchase (as agreed)",
  trip: "A trip or outing of your choice", big: "A big wish from the list" };
function isEn(m) { return m && m.lang === "en"; }
/** Название дела/награды на языке участника (свои названия не переводятся). */
function titleFor(m, title, item) {
  if (!isEn(m) || !item || !item.tpl) return title;
  var key = String(item.tpl).split("_")[0];
  var en = TPL_EN[key] || WISH_EN[key];
  return en && (item.title === title || !item.title) ? en : title;
}

/* ---------- Обработка семьи ---------- */
function minutes(hhmm) { var p = String(hhmm || "").split(":"); return +p[0] * 60 + +p[1]; }
function processFamily(fam) {
  var fid = fam.id, cfg = fam, now = Date.now(), nowD = new Date();
  var todayS = FQ.dayKey(nowD), nowMin = nowD.getHours() * 60 + nowD.getMinutes();
  var kids = cfg.kids || [];
  if (!kids.length) return;
  var members = fsList("families/" + fid + "/members");
  var parents = members.filter(function (m) { return m.role === "parent"; });
  var kidMembers = function (k) { return members.filter(function (m) { return m.role === "child" && m.kidId === k; }); };
  var kidName = function (k) { var x = kids.filter(function (y) { return y.id === k; })[0]; return x ? x.name : ""; };

  var months = [FQ.monthKey(nowD)];
  if (nowD.getDate() <= 7) months.push(FQ.monthKey(new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)));
  var kpaths = [], ppaths = [];
  kids.forEach(function (k) { months.forEach(function (m) { kpaths.push("families/" + fid + "/kidlog/" + k.id + "_" + m); ppaths.push("families/" + fid + "/plog/" + k.id + "_" + m); }); });
  var kidlogs = fsBatchGet(kpaths), plogs = fsBatchGet(ppaths);
  var data = FQ.merge(kidlogs, plogs, cfg);
  var sentDoc = fsGet("families/" + fid + "/sent/" + todayS) || {};
  var sent = sentDoc.k || {}, mark = {};
  var once = function (key) { if (sent[key] || mark[key]) return false; mark[key] = true; return true; };
  var tasks = FQ.live(cfg.tasks);

  // 1. Напоминания об обязательных делах (за 5 минут до времени).
  kids.forEach(function (k) {
    tasks.forEach(function (t) {
      if (!t.mandatory || !t.bound || !t.time || !FQ.forKid(t, k.id) || !FQ.applies(t, todayS, cfg)) return;
      var tm = minutes(t.time);
      if (nowMin < tm - 5) return;
      var st = FQ.taskState(t, k.id, todayS, data);
      if (!st.free && st.status !== "redo") return;          // уже отмечено — молчим
      var dl = FQ.deadline(t, todayS, cfg, now);
      if (dl && dl.phase === "closed") return;               // строгий срок прошёл
      var pts = t.pts * FQ.mult(cfg, todayS, t.id);
      if (dl && dl.phase === "late") pts = Math.round(pts * dl.pct / 100);
      var x2 = FQ.mult(cfg, todayS, t.id) > 1, first = nowMin <= tm + 5, left = dl && dl.phase === "open" ? Math.max(1, Math.ceil(dl.left / 60000)) : 0;
      if (first) { if (!once("r_" + t.id + "_" + k.id)) return; }
      else {                                                  // повторы, пока не отмечено
        var every = +t.repeat || 0; if (every <= 0) return;
        var slot = Math.floor((nowMin - tm) / every); if (slot < 1) return;
        if (!once("r_" + t.id + "_" + k.id + "_" + slot)) return;
      }
      kidMembers(k.id).forEach(function (m) {
        var en = isEn(m), name = titleFor(m, t.title, t), title, body;
        if (first) { title = "⏰ " + t.time + " — " + name; body = en ? "Don't forget! +" + pts + (x2 ? " (×2 today)" : "") : "Не забудь! За это +" + pts + (x2 ? " (сегодня ×2)" : ""); }
        else {
          title = (en ? "🔔 Not done yet: " : "🔔 Ещё не отмечено: ") + name;
          body = (dl && dl.phase === "late") ? (en ? "The deadline has passed, but you can still hand it in for +" + pts + ". Tap Done!." : "Срок прошёл, но ещё можно сдать за +" + pts + ". Нажми «Готово!».")
            : (left ? (en ? left + " min left. " : "Осталось " + left + " мин. ") : "") + (en ? "Tap Done! when you finish." : "Нажми «Готово!», когда сделаешь.");
        }
        push(m, fid, title, body);
      });
    });
  });

  // 2. Вечернее зачисление и воскресное открытие баллов.
  var ct = FQ.creditTime(cfg), ctm = minutes(ct);
  if (nowMin >= ctm && nowMin < ctm + 15) {
    kids.forEach(function (k) {
      if (!once("c_" + k.id)) return;
      var acc = FQ.account(k.id, data, cfg, now + 60000);
      var sun = FQ.isoDow(todayS) === 7;
      kidMembers(k.id).forEach(function (m) {
        var en = isEn(m);
        var body = acc.today ? (en ? "Credited today: +" + acc.today + "." : "Сегодня зачислено +" + acc.today + ".") : (en ? "No points today, you'll get them tomorrow!" : "Сегодня баллов нет — завтра получится!");
        if (sun) body += en ? " This week's points are unlocked: you can spend " + acc.available + "." : " Баллы за неделю открыты: можно тратить " + acc.available + ".";
        push(m, fid, sun ? (en ? "🎉 This week's points are available!" : "🎉 Баллы за неделю доступны!") : (en ? "⭐ Today's results" : "⭐ Итоги дня"), body);
      });
    });
  }

  // 3. Уведомления родителям о новых заявках.
  var pending = data.entries.filter(function (e) { return e.status === "pending" && e.type !== "game"; });
  var fresh = pending.filter(function (e) { return now - e.at < 3 * 3600e3 && once("p_" + e.id + "_" + e.at); });
  if (fresh.length) {
    parents.forEach(function (m) {
      var en = isEn(m);
      var lines = fresh.slice(0, 4).map(function (e) { var item = e.type === "wish" ? (cfg.wishes || {})[e.ref] : (cfg.tasks || {})[e.ref], nm = titleFor(m, e.title, item);
        return kidName(e.kid) + ": " + (e.type === "wish" ? (en ? "wants “" + nm + "”" : "хочет «" + nm + "»") : nm); });
      push(m, fid, (en ? "🔔 To review: " : "🔔 На проверку: ") + fresh.length, lines.join("; ") + (fresh.length > 4 ? "…" : ""));
    });
  }

  // 4. Подарки.
  data.gifts.forEach(function (g) {
    if (g.kind !== "gift" || now - g.at > 3 * 3600e3 || !once("g_" + g.id)) return;
    kidMembers(g.kid).forEach(function (m) { var en = isEn(m); push(m, fid, (en ? "🎁 A gift from your parents: +" : "🎁 Подарок от родителей: +") + g.pts, g.msg || (en ? "Open the app!" : "Открой приложение!")); });
  });
  // 4а. Одобренные желания.
  data.entries.forEach(function (e) {
    if (e.type !== "wish" || e.status !== "ok" || !e.dec || now - (e.dec.decidedAt || 0) > 3 * 3600e3 || !once("w_" + e.id)) return;
    kidMembers(e.kid).forEach(function (m) { var en = isEn(m); push(m, fid, (en ? "🎉 Your wish is coming true: " : "🎉 Желание исполняется: ") + titleFor(m, e.title, (cfg.wishes || {})[e.ref]), e.dec.note || (en ? "Your parents approved your request. Open the app!" : "Родители одобрили твою заявку. Открой приложение!")); });
  });

  // Удаление старых фото-отчётов раз в сутки (срок — в настройках семьи, по умолчанию 14 дней).
  if (nowMin >= 3 * 60 && once("ph_clean")) {
    var days = +(cfg.settings && cfg.settings.photoDays) || 14;
    var keep = {};
    pending.forEach(function (e) { (e.photos || []).forEach(function (p) { keep[p] = true; }); });
    var removed = 0;
    fsListMeta("families/" + fid + "/photos").forEach(function (ph) {
      if (keep[ph.id] || !ph.at || now - ph.at < days * 864e5) return;
      if (fsDelete("families/" + fid + "/photos/" + ph.id)) removed++;
    });
    if (removed) console.log("Семья " + fid + ": удалено старых фото " + removed);
  }

  var keys = Object.keys(mark);
  if (keys.length) fsPatch("families/" + fid + "/sent/" + todayS, { k: mark }, keys.map(function (k) { return "k." + k; }));
}

/* ===== Публикация приложения на Firebase (без установки программ) =====
   Берёт файлы из GitHub-репозитория (свойство GITHUB_REPO, например "user/semeynye-kvesty")
   и выкладывает папку public/ на Firebase Hosting, а firestore.rules — в правила базы.
   Запуск: функция deploy() в редакторе Apps Script. */

function api(method, url, body, raw) {
  var opt = { method: method, muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Goog-User-Project": prop("PROJECT_ID") } };
  if (raw) { opt.payload = raw; opt.contentType = "application/octet-stream"; }
  else if (body !== undefined) { opt.payload = JSON.stringify(body); opt.contentType = "application/json"; }
  var r = UrlFetchApp.fetch(url, opt), txt = r.getContentText();
  var json = {}; try { json = txt ? JSON.parse(txt) : {}; } catch (e) { json = { raw: txt }; }
  return { code: r.getResponseCode(), json: json };
}
function must(r, what) { if (r.code >= 300) throw new Error(what + ": " + r.code + " " + JSON.stringify(r.json).slice(0, 500)); return r.json; }
function waitOp(name, host, ver) {
  for (var i = 0; i < 30; i++) {
    var r = must(api("get", host + "/" + (ver || "v1") + "/" + name), "операция");
    if (r.done) { if (r.error) throw new Error(JSON.stringify(r.error)); return r.response || {}; }
    Utilities.sleep(2000);
  }
  throw new Error("Операция " + name + " не завершилась вовремя");
}

/** Файлы репозитория: [{path, bytes}] из папки prefix (список — в deploy-files.json, без GitHub API). */
function repoFiles(prefix) {
  var repo = prop("GITHUB_REPO"), branch = prop("GITHUB_BRANCH", "main");
  if (!repo) throw new Error("Укажите свойство GITHUB_REPO, например user/semeynye-kvesty");
  // Берём файлы по номеру последнего коммита: ссылки на ветку GitHub кэширует до 5 минут, и выкладка могла получить старую версию.
  var ref = branch;
  try {
    var refs = UrlFetchApp.fetch("https://github.com/" + repo + ".git/info/refs?service=git-upload-pack", { muteHttpExceptions: true }).getContentText();
    var m = new RegExp("([0-9a-f]{40}) refs/heads/" + branch + "\\b").exec(refs);
    if (m) ref = m[1];
  } catch (e) { console.warn("Не удалось узнать последний коммит: " + e); }
  console.log("Версия с GitHub: " + (ref === branch ? branch : ref.slice(0, 7)));
  var raw = "https://raw.githubusercontent.com/" + repo + "/" + ref + "/";
  var list = JSON.parse(UrlFetchApp.fetch(raw + "deploy-files.json?t=" + Date.now()).getContentText());
  return list.filter(function (p) { return p.indexOf(prefix) === 0; }).map(function (p) {
    return { path: p, bytes: UrlFetchApp.fetch(raw + p + "?t=" + Date.now()).getContent() };
  });
}
function hex(bytes) { return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, "0"); }).join(""); }

/** Подготовка проекта: база данных и веб-приложение (если их ещё нет). */
function prepareProject() {
  var p = prop("PROJECT_ID");
  var services = ["firestore.googleapis.com", "firebasehosting.googleapis.com", "firebaserules.googleapis.com",
    "fcm.googleapis.com", "firebase.googleapis.com", "identitytoolkit.googleapis.com"];
  var en = api("post", "https://serviceusage.googleapis.com/v1/projects/" + p + "/services:batchEnable", { serviceIds: services });
  if (en.code < 300) {
    if (en.json.name && !en.json.done) waitOp(en.json.name, "https://serviceusage.googleapis.com");
    console.log("Службы Google включены: " + services.length);
    Utilities.sleep(5000);
  } else console.warn("Не удалось включить службы: " + en.code + " " + JSON.stringify(en.json).slice(0, 300));
  var db = api("get", "https://firestore.googleapis.com/v1/projects/" + p + "/databases/(default)");
  if (db.code === 404) {
    var op = must(api("post", "https://firestore.googleapis.com/v1/projects/" + p + "/databases?databaseId=(default)", { locationId: "eur3", type: "FIRESTORE_NATIVE" }), "создание базы");
    if (op.name) waitOp(op.name, "https://firestore.googleapis.com");
    console.log("База данных Firestore создана (eur3).");
  } else must(db, "проверка базы");
  var apps = must(api("get", "https://firebase.googleapis.com/v1beta1/projects/" + p + "/webApps"), "список веб-приложений");
  if (!apps.apps || !apps.apps.length) {
    var op2 = must(api("post", "https://firebase.googleapis.com/v1beta1/projects/" + p + "/webApps", { displayName: "Семейные квесты" }), "регистрация веб-приложения");
    if (op2.name) waitOp(op2.name, "https://firebase.googleapis.com", "v1beta1");
    console.log("Веб-приложение зарегистрировано.");
  }
}

/** Публикация правил Firestore. */
function deployRules() {
  var p = prop("PROJECT_ID");
  var src = repoFiles("firestore.rules")[0];
  var rs = must(api("post", "https://firebaserules.googleapis.com/v1/projects/" + p + "/rulesets",
    { source: { files: [{ name: "firestore.rules", content: Utilities.newBlob(src.bytes).getDataAsString("UTF-8") }] } }), "правила");
  var relName = "projects/" + p + "/releases/cloud.firestore";
  var up = api("patch", "https://firebaserules.googleapis.com/v1/" + relName, { release: { name: relName, rulesetName: rs.name } });
  if (up.code === 404) must(api("post", "https://firebaserules.googleapis.com/v1/projects/" + p + "/releases", { name: relName, rulesetName: rs.name }), "выпуск правил");
  else must(up, "обновление правил");
  console.log("Правила доступа опубликованы.");
}

/** Публикация сайта на Firebase Hosting. */
function deployHosting() {
  var p = prop("PROJECT_ID"), H = "https://firebasehosting.googleapis.com/v1beta1/";
  var sites = must(api("get", H + "projects/" + p + "/sites"), "сайты").sites || [];
  var site = sites.length ? sites[0].name.split("/").pop() : p;
  var files = repoFiles("public/");
  var map = {}, byHash = {};
  files.forEach(function (f) {
    var gz = Utilities.gzip(Utilities.newBlob(f.bytes)).getBytes();
    var h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, gz));
    map["/" + f.path.slice("public/".length)] = h; byHash[h] = gz;
  });
  var ver = must(api("post", H + "sites/" + site + "/versions", { config: { headers: [
    { glob: "**/*.@(js|css|html|webmanifest)", headers: { "Cache-Control": "no-cache" } } ] } }), "новая версия");
  var pop = must(api("post", H + ver.name + ":populateFiles", { files: map }), "список файлов");
  (pop.uploadRequiredHashes || []).forEach(function (h) { must(api("post", pop.uploadUrl + "/" + h, undefined, byHash[h]), "загрузка файла"); });
  must(api("patch", H + ver.name + "?update_mask=status", { status: "FINALIZED" }), "завершение версии");
  must(api("post", H + "sites/" + site + "/releases?versionName=" + encodeURIComponent(ver.name), {}), "выпуск");
  var url = "https://" + site + ".web.app";
  P.setProperty("APP_URL", url);
  console.log("Опубликовано файлов: " + files.length + ". Адрес приложения: " + url);
  return url;
}

/** Всё сразу: подготовка проекта, правила, сайт, таймер напоминаний. */
function deploy() {
  if (!prop("PROJECT_ID")) throw new Error("Укажите свойство PROJECT_ID (идентификатор проекта Firebase).");
  prepareProject();
  deployRules();
  var url = deployHosting();
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "tick"; })) {
    ScriptApp.newTrigger("tick").timeBased().everyMinutes(5).create();
    console.log("Таймер напоминаний (каждые 5 минут) создан.");
  }
  console.log("Готово! Откройте " + url);
}
