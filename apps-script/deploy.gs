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
  var raw = "https://raw.githubusercontent.com/" + repo + "/" + branch + "/";
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
