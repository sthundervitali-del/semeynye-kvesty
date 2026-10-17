/* ===== Семейные квесты — серверная часть (Google Apps Script) =====
   Каждые 5 минут: напоминания об обязательных делах, вечернее зачисление,
   уведомления родителям о заявках, подарки,
   ИИ-проверка фото через Gemini.
   Свойства скрипта: PROJECT_ID (обязательно), APP_URL, GEMINI_KEY, GEMINI_MODEL. */

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
  } finally { lock.releaseLock(); }
}

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

/* ---------- Gemini ---------- */
function aiCheck(e, task, kid, photos) {
  var key = prop("GEMINI_KEY"); if (!key || !photos.length) return null;
  var prompt = "Ты помогаешь родителям проверять фото-отчёты детей о домашних делах и учёбе.\n" +
    "Ребёнку " + (kid && kid.age || "") + " лет. Задание: «" + e.title + "».\n" +
    (e.checks && e.checks.length ? "Пункты, которые ребёнок отметил как выполненные:\n- " + e.checks.join("\n- ") + "\n" : "") +
    "Посмотри на фото и оцени, видно ли, что задание выполнено. Будь доброжелательным, но честным: если на фото беспорядок, нет результата или фото не относится к заданию, это \"redo\". Если по фото понять нельзя, это \"unsure\".\n" +
    "Ответь только JSON: {\"verdict\":\"ok\"|\"redo\"|\"unsure\",\"comment\":\"1–2 коротких предложения для ребёнка на русском: что видно и что исправить\"}";
  var parts = [{ text: prompt }];
  photos.forEach(function (d) { var m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(d || ""); if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } }); });
  var model = prop("GEMINI_MODEL", "gemini-3.5-flash-lite");
  var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key), {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ role: "user", parts: parts }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }) });
  if (r.getResponseCode() !== 200) { console.error("Gemini " + r.getResponseCode() + " " + r.getContentText().slice(0, 300)); return null; }
  try {
    var txt = JSON.parse(r.getContentText()).candidates[0].content.parts[0].text;
    var res = JSON.parse(txt.replace(/^```json|```$/g, "").trim());
    var v = ["ok", "redo", "unsure"].indexOf(res.verdict) >= 0 ? res.verdict : "unsure";
    return { verdict: v, comment: String(res.comment || "").slice(0, 300) };
  } catch (err) { console.error("Gemini parse " + err); return null; }
}

/** Проверка ключа Gemini: выберите testAI и нажмите «Выполнить». */
function testAI() {
  if (!prop("GEMINI_KEY")) { console.log("Нет свойства GEMINI_KEY"); return; }
  var img = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABAAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD06iiiuU2CisXxF4i/sD7P/on2jz93/LTbtxj2PrWL/wALE/6hX/kx/wDY1108FXqxU4Run5oylVhF2bO0ori/+Fif9Qr/AMmP/saP+Fif9Qr/AMmP/sa0/s7Ffy/iv8yfb0+52lFZnh/Wv7dsXuvs/kbJTHt37s4AOc4HrWnXHOEqcnGW6NU1JXQUUUVBQUUUUAFFFZ134h0qxuXtrm62SpjcvlscZGeoHoaG0twSb2Oc+In/ADDv+2v/ALJXFV1PjTVbLVfsX2KYzeV5m/5GGM7cdR7GuX2N/dP5V9Rl9WCw0U5Lr+bPOrwl7R6CUUuxv7p/KjY390/lXd7Wn/MvvMeSXY9B8Af8gKb/AK+W/wDQVrp64nwfrWn6ZpMsF5ceVI05cLsY8bVHYexrf/4SzRP+f3/yE/8AhXyWMnF4idn1PUpRlyLQ16KyP+Es0T/n9/8AIT/4Uf8ACWaJ/wA/v/kJ/wDCuXmXc05X2NeisuHxNo9xNHDFebpJGCqPLcZJOB2rUppp7Caa3CvOPFn/ACMt3/wD/wBAWvR6848Wf8jLd/8AAP8A0Bazq7GlL4jHooornOgKKKKACiiigAooooAuaP8A8hqx/wCvmP8A9CFep15Zo/8AyGrH/r5j/wDQhXqdb0tjCrugrzjxZ/yMt3/wD/0Ba9HrF1DwpYalfSXk0twskmMhGUDgAdx7VU4trQmElF6nnVFd5/wg2mf897v/AL7X/wCJo/4QbTP+e93/AN9r/wDE1l7ORr7SJwdFd5/wg2mf897v/vtf/iaP+EG0z/nvd/8Afa//ABNHs5B7SJwdFd5/wg2mf897v/vtf/iaP+EG0z/nvd/99r/8TR7OQe0icHRXef8ACDaZ/wA97v8A77X/AOJo/wCEG0z/AJ73f/fa/wDxNHs5B7SJx+j/APIasf8Ar5j/APQhXqdYFt4N061uorhJrkvE4dQzLgkHPPy1v1rCLS1MpyUnof/Z";
  var r = aiCheck({ title: "Убрать на столе", checks: ["Стол разобран"] }, null, { age: 10 }, [img]);
  console.log(r ? "Gemini отвечает (" + prop("GEMINI_MODEL", "gemini-3.5-flash-lite") + "): " + JSON.stringify(r) : "Gemini не ответил — см. ошибку выше");
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
      var title, body;
      if (nowMin <= tm + 5) {                                 // первое напоминание
        if (!once("r_" + t.id + "_" + k.id)) return;
        title = "⏰ " + t.time + " — " + t.title; body = "Не забудь! За это +" + pts + (FQ.mult(cfg, todayS, t.id) > 1 ? " (сегодня ×2)" : "");
      } else {                                                // повторы, пока не отмечено
        var every = +t.repeat || 0; if (every <= 0) return;
        var slot = Math.floor((nowMin - tm) / every); if (slot < 1) return;
        if (!once("r_" + t.id + "_" + k.id + "_" + slot)) return;
        title = "🔔 Ещё не отмечено: " + t.title;
        body = (dl && dl.phase === "late") ? "Срок прошёл, но ещё можно сдать за +" + pts + ". Нажми «Готово!»." : (dl && dl.phase === "open" ? "Осталось " + Math.max(1, Math.ceil(dl.left / 60000)) + " мин. " : "") + "Нажми «Готово!», когда сделаешь.";
      }
      kidMembers(k.id).forEach(function (m) { push(m, fid, title, body); });
    });
  });

  // 2. Вечернее зачисление и воскресное открытие баллов.
  var ct = FQ.creditTime(cfg), ctm = minutes(ct);
  if (nowMin >= ctm && nowMin < ctm + 15) {
    kids.forEach(function (k) {
      if (!once("c_" + k.id)) return;
      var acc = FQ.account(k.id, data, cfg, now + 60000);
      var body = acc.today ? "Сегодня зачислено +" + acc.today + "." : "Сегодня баллов нет — завтра получится!";
      if (FQ.isoDow(todayS) === 7) body += " Баллы за неделю открыты: можно тратить " + acc.available + ".";
      kidMembers(k.id).forEach(function (m) { push(m, fid, FQ.isoDow(todayS) === 7 ? "🎉 Баллы за неделю доступны!" : "⭐ Итоги дня", body); });
    });
  }

  // 3. ИИ-проверка фото и уведомления родителям о новых заявках.
  var pending = data.entries.filter(function (e) { return e.status === "pending" && e.type !== "game"; });
  var fresh = pending.filter(function (e) { return now - e.at < 3 * 3600e3 && once("p_" + e.id + "_" + e.at); });
  var aiDone = 0;
  pending.forEach(function (e) {
    if (e.type !== "task" || !e.photos || !e.photos.length || aiDone >= 3) return;
    if (e.dec && e.dec.ai && e.dec.ai.forAt === e.at) return;
    if (!prop("GEMINI_KEY") || !once("a_" + e.id + "_" + e.at)) return;
    aiDone++;
    var pics = fsBatchGet(e.photos.map(function (p) { return "families/" + fid + "/photos/" + p; })).map(function (x) { return x.data; });
    var task = (cfg.tasks || {})[e.ref] || {}, kid = kids.filter(function (k) { return k.id === e.kid; })[0];
    var ai = aiCheck(e, task, kid, pics); if (!ai) return;
    ai.forAt = e.at;
    var d = {}; d[e.id] = { ai: ai }; var mask = ["d." + e.id + ".ai"];
    if (cfg.settings && cfg.settings.autoAI && ai.verdict === "ok") {
      d[e.id].status = "ok"; d[e.id].note = ai.comment; d[e.id].decidedAt = Date.now();
      mask.push("d." + e.id + ".status", "d." + e.id + ".note", "d." + e.id + ".decidedAt");
      fresh = fresh.filter(function (x) { return x.id !== e.id; });
    }
    fsPatch("families/" + fid + "/plog/" + e.doc, { d: d }, mask);
  });
  if (fresh.length) {
    var lines = fresh.slice(0, 4).map(function (e) { return kidName(e.kid) + ": " + (e.type === "wish" ? "хочет «" + e.title + "»" : e.title); });
    parents.forEach(function (m) { push(m, fid, "🔔 На проверку: " + fresh.length, lines.join("; ") + (fresh.length > 4 ? "…" : "")); });
  }

  // 4. Подарки.
  data.gifts.forEach(function (g) {
    if (g.kind !== "gift" || now - g.at > 3 * 3600e3 || !once("g_" + g.id)) return;
    kidMembers(g.kid).forEach(function (m) { push(m, fid, "🎁 Подарок от родителей: +" + g.pts, g.msg || "Открой приложение!"); });
  });
  // 4а. Одобренные желания.
  data.entries.forEach(function (e) {
    if (e.type !== "wish" || e.status !== "ok" || !e.dec || now - (e.dec.decidedAt || 0) > 3 * 3600e3 || !once("w_" + e.id)) return;
    kidMembers(e.kid).forEach(function (m) { push(m, fid, "🎉 Желание исполняется: " + e.title, e.dec.note || "Родители одобрили твою заявку. Открой приложение!"); });
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
