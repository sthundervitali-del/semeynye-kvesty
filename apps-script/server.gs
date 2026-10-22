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
