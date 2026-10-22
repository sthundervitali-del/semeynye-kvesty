/* Семейные квесты — интерфейс. */
import { firebaseBackend, demoBackend, uid } from "/backend.js";
const F = window.FQ;

/* ---------- утилиты ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; if (n > 10 && n < 20) return c; if (m > 1 && m < 5) return b; if (m === 1) return a; return c; };
const ptsW = n => n + " " + plural(n, "балл", "балла", "баллов");
const minW = n => n + " " + plural(n, "минута", "минуты", "минут");
const today = () => F.dayKey();
const fmtTime = ts => { const d = new Date(ts); return F.pad(d.getHours()) + ":" + F.pad(d.getMinutes()); };
const fmtDate = ts => { const d = new Date(ts); return F.pad(d.getDate()) + "." + F.pad(d.getMonth() + 1) + " " + fmtTime(ts); };
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_G = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DOW_LONG = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const humanDay = s => { const d = F.parseDay(s); return d.getDate() + " " + MONTHS_G[d.getMonth()] + ", " + DOW_LONG[F.isoDow(s) - 1]; };
const APP_VERSION = "2.13.1", APP_DATE = "22.10.2026";
const I18N = window.I18N, tr = s => I18N.tr(s);
const ic = (n, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const CATS = { home: { n: "Дом", ic: "home" }, study: { n: "Учёба", ic: "book" }, other: { n: "Полезное", ic: "star" } };
const FREQ = { day: "раз в день", week: "N раз в неделю", many: "сколько угодно", once: "один раз" };
const COLORS = { violet: "var(--study)", teal: "var(--home)", rose: "var(--other)", gold: "var(--gold)" };
const RANKS = ["Новичок", "Помощник", "Умелец", "Мастер дома", "Герой семьи", "Легенда", "Великий магистр"];
const appIcon = (s = 34) => `<img class="app-ic" width="${s}" height="${s}" src="${window.FQ_ICON || "/icon.svg"}" alt="">`;
const coin = (s = 18) => `<svg class="coin" width="${s}" height="${s}" aria-hidden="true"><use href="#coin"/></svg>`;
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };

/* ---------- состояние ---------- */
const S = {
  be: null, user: null, families: [], fid: null, cfg: null, members: [], kidlogs: [], plogs: [],
  data: { entries: [], gifts: [] }, me: null, loaded: false, tab: null, preview: null,
  calMonth: F.monthKey(), calKid: null, instant: new Set(), support: [], isAdmin: false, sel: null, selKind: null, sending: new Set(), drag: false, selDay: null, photos: {}, error: null, prevStatus: null, setPage: null,
};
const isParent = () => S.me?.role === "parent";
/** Аватар: фото участника, если загружено, иначе первая буква. */
const kidMember = k => k && S.members.find(m => m.role === "child" && m.kidId === k.id);
function avatar(name, img, cls = "", style = "", attrs = "", tag = "span") {
  return `<${tag} class="avatar ${cls} ${img ? "has-img" : ""}" style="${img ? "" : style}" ${attrs}>${img ? `<img src="${img}" alt="">` : esc(((name || "?")[0] || "?").toUpperCase())}</${tag}>`;
}
const kidsList = () => S.cfg?.kids || [];
const kidById = id => kidsList().find(k => k.id === id);
const viewingKid = () => isParent() ? S.preview : S.me?.kidId;
const kidColor = k => COLORS[k?.color] || COLORS.violet;

/* ---------- стартовый набор дел ---------- */
const ALL7 = [1, 2, 3, 4, 5, 6, 7];
const TASK_TEMPLATES = [
  { tpl: "school", title: "Выйти в школу", cat: "study", pts: 5, mandatory: true, bound: true, schedule: { mode: "workdays", days: [] }, time: "07:40", deadline: "strict", grace: 15, repeat: 5 },
  { tpl: "bed", title: "Застелить кровать", cat: "home", pts: 5, mandatory: true, bound: true, schedule: { mode: "days", days: ALL7 } },
  { tpl: "teeth", title: "Почистить зубы утром и вечером", cat: "other", pts: 5, mandatory: true, bound: true, schedule: { mode: "days", days: ALL7 } },
  { tpl: "homework", title: "Сделать уроки", cat: "study", pts: 20, mandatory: true, bound: true, schedule: { mode: "workdays", days: [] }, time: "18:00", deadline: "late", grace: 60, latePct: 50, repeat: 30, checklist: ["Все письменные задания сделаны", "Устные выучены", "Рюкзак собран на завтра"], photo: true },
  { tpl: "room", title: "Порядок в комнате", cat: "home", pts: 10, mandatory: true, bound: true, schedule: { mode: "days", days: ALL7 }, time: "20:30", deadline: "late", grace: 30, latePct: 50, checklist: ["Стол разобран", "Одежда в шкафу или в корзине", "На полу ничего не валяется"], photo: true },
  { tpl: "sleep", perKid: true, title: "Лечь спать", cat: "other", pts: 5, mandatory: true, bound: true, schedule: { mode: "days", days: ALL7 }, deadline: "strict", grace: 15, repeat: 10 },
  { tpl: "read", title: "Почитать книгу 20 минут", cat: "study", pts: 10, bound: true, schedule: { mode: "days", days: ALL7 } },
  { tpl: "cook", title: "Помочь с обедом или ужином", cat: "home", pts: 15, bound: true, schedule: { mode: "offdays", days: [] } },
  { tpl: "trash", title: "Вынести мусор", cat: "home", pts: 10, bound: true, schedule: { mode: "days", days: [2, 4, 6] } },
  { tpl: "clean", title: "Генеральная уборка комнаты", cat: "home", pts: 30, mandatory: true, freq: "week", times: 1, checklist: ["Вытерта пыль", "Пропылесосено", "Порядок в шкафу", "Мусор вынесен"], photo: true },
  { tpl: "vacuum", title: "Пропылесосить квартиру", cat: "home", pts: 25, mandatory: true, freq: "week", times: 1, photo: true },
  { tpl: "sport", title: "Зарядка или спорт 20 минут", cat: "other", pts: 10, freq: "week", times: 3 },
  { tpl: "flowers", title: "Полить цветы", cat: "home", pts: 5, freq: "week", times: 1 },
  { tpl: "dishes", title: "Помыть посуду за всеми", cat: "home", pts: 15, freq: "many" },
  { tpl: "grade", title: "Получить хорошую оценку", cat: "study", pts: 15, freq: "many", photo: true },
  { tpl: "exam", title: "Час подготовки к контрольной", cat: "study", pts: 25, freq: "many" },
  { tpl: "help", title: "Помочь родителям без просьбы", cat: "other", pts: 15, freq: "many" },
];
const WISH_TEMPLATES = [
  ["games30", "+30 минут игр на компьютере", 40], ["movie", "Выбрать фильм на семейный вечер", 50], ["late", "Лечь спать на час позже в пятницу", 60],
  ["food", "Любимая еда на ужин", 120], ["nochores", "День без домашних дел", 150], ["book", "Набор для творчества или книга на выбор", 200],
  ["cinema", "Кино с друзьями", 250], ["ingame", "Покупка в игре (по договорённости)", 300], ["trip", "Поездка или прогулка на выбор", 400], ["big", "Большое желание из списка", 600],
];
const defaultSettings = () => ({ creditTime: "21:00", autoAI: false, tz: "Europe/Minsk", photoDays: 14 });
/** Дело из шаблона (без id). Для «на каждого ребёнка» — отдельное дело с временем по возрасту. */
function tplTask(tp, kid) {
  const { perKid, tpl, ...rest } = tp;
  const t = { title: "", cat: "home", pts: 10, who: "all", mandatory: false, bound: false, schedule: { mode: "workdays", days: [] }, time: "", deadline: "none", grace: 30, latePct: 50, repeat: 0, freq: "many", times: 1, checklist: [], photo: false, active: true, del: false, ...JSON.parse(JSON.stringify(rest)) };
  t.tpl = perKid && kid ? tpl + "_" + kid.id : tpl;
  if (perKid && kid) { t.who = kid.id; if (tpl === "sleep") t.time = (kid.age || 12) <= 11 ? "21:30" : (kid.age || 12) <= 13 ? "22:30" : "23:00"; }
  if (t.bound) t.freq = "day";
  return t;
}
/** Полный набор — только для демо-режима. Новая семья начинает с пустого списка. */
function starterSet(kids) {
  let o = 0; const tasks = {}, wishes = {};
  TASK_TEMPLATES.forEach(tp => (tp.perKid ? kids : [null]).forEach(k => { const id = uid("t"); tasks[id] = { ...tplTask(tp, k), id, o: o++ }; }));
  WISH_TEMPLATES.slice(0, 8).forEach(([tpl, title, cost]) => { const id = uid("w"); wishes[id] = { id, o: o++, tpl, title, cost, who: "all", del: false }; });
  return { tasks, wishes, days: {}, settings: defaultSettings() };
}
/* ---------- демо-данные ---------- */
function demoSeed(store, user) {
  const kids = [{ id: "k1", name: "Дочка", age: 10, color: "violet" },
                { id: "k2", name: "Сын", age: 14, color: "teal" }];
  const set = starterSet(kids);
  store.family = { name: "Семья (демо)", createdBy: user.uid, createdAt: Date.now() - 20 * 864e5, kids, ...set };
  store.members = { [user.uid]: { role: "parent", name: user.displayName, email: user.email, tokens: [], seen: [] },
                    "demo-p2": { role: "parent", name: "Папа", email: "papa@example.com", tokens: [], seen: [] },
                    "demo-k1": { role: "child", kidId: "k1", name: "Дочка", email: "doch@example.com", tokens: [], seen: [] },
                    "demo-k2": { role: "child", kidId: "k2", name: "Сын", email: "syn@example.com", tokens: [], seen: [] } };
  const tasks = Object.values(set.tasks);
  const now = Date.now(), t0 = today();
  const put = (kid, e, dec) => {
    const doc = kid + "_" + e.day.slice(0, 7);
    store.kidlog[doc] = store.kidlog[doc] || { kid, e: {} }; store.kidlog[doc].e[e.id] = e;
    if (dec) { store.plog[doc] = store.plog[doc] || { d: {}, g: {} }; store.plog[doc].d = store.plog[doc].d || {}; store.plog[doc].d[e.id] = dec; }
  };
  for (let i = 16; i >= 1; i--) {
    const s = F.addDays(t0, -i);
    for (const k of kids) {
      tasks.filter(t => F.forKid(t, k.id) && F.applies(t, s, store.family)).forEach((t, j) => {
        if ((i * 7 + j * 3 + (k.id === "k2" ? 5 : 0)) % 6 === 0) return;           // иногда пропускает
        const at = F.atTime(s, "17:00") + j * 6e5, id = uid();
        put(k.id, { id, kid: k.id, type: "task", ref: t.id, title: t.title, pts: t.pts, day: s, at, checks: t.checklist, photos: [] }, { status: (i + j) % 11 === 0 ? "no" : "ok", decidedAt: at + 36e5, note: "" });
      });
    }
  }
  // сегодня: заявка с фото на проверке
  const room = tasks.find(t => t.title === "Порядок в комнате");
  const pid = "pdemo1";
  const c = document.createElement("canvas"); c.width = 480; c.height = 360; const g = c.getContext("2d");
  g.fillStyle = "#d9c7a8"; g.fillRect(0, 0, 480, 360); g.fillStyle = "#8a6a45"; g.fillRect(40, 200, 400, 30); g.fillStyle = "#5d7fbf"; g.fillRect(70, 120, 140, 80); g.fillStyle = "#f2efe8"; g.fillRect(260, 150, 120, 50);
  g.fillStyle = "#333"; g.font = "20px sans-serif"; g.fillText("фото комнаты (демо)", 140, 320);
  store.photos[pid] = { data: c.toDataURL("image/jpeg", .7), kid: "k1", at: now };
  put("k1", { id: "edemo1", kid: "k1", type: "task", ref: room.id, title: room.title, pts: room.pts, day: t0, at: now - 9e5, checks: room.checklist, photos: [pid] },
      { status: "" });
  const wish = Object.values(set.wishes)[1];
  put("k2", { id: "edemo2", kid: "k2", type: "wish", ref: wish.id, title: wish.title, pts: wish.cost, day: t0, at: now - 3e5 }, null);
  const doc = "k1_" + F.monthKey();
  store.plog[doc] = store.plog[doc] || { d: {}, g: {} };
  store.plog[doc].g = { gdemo: { id: "gdemo", kid: "k1", kind: "gift", pts: 30, msg: "Ты сегодня так здорово помогла с уборкой! Мы тобой гордимся ❤️", at: now - 6e4, day: t0 } };
  store.family.days[F.addDays(t0, 1)] = { x2: [tasks.find(t => t.title === "Сделать уроки").id] };
}

/* ---------- модалки, тосты, звук ---------- */
function modal(inner, onMount, cls = "") {
  const layer = document.getElementById("layer");
  layer.innerHTML = `<div class="scrim" data-act="closeModal"><div class="modal ${cls}" role="dialog" aria-modal="true">${inner}</div></div>`;
  I18N.apply(layer);
  onMount && onMount(layer.querySelector(".modal"));
}
function closeModal() { document.getElementById("layer").innerHTML = ""; }
let tTimer;
function toast(msg, alert) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div"); t.className = "toast" + (alert ? " alert" : ""); t.setAttribute("role", "status"); t.textContent = tr(msg);
  document.body.appendChild(t); clearTimeout(tTimer); tTimer = setTimeout(() => t.remove(), alert ? 5000 : 2600);
}
function ask(text, yes, onYes, danger) {
  modal(`<h2>${esc(text)}</h2><div class="btns"><button class="btn ghost" data-act="closeModal">Отмена</button><button class="btn ${danger ? "no" : "dark"}" id="ask-yes">${esc(yes)}</button></div>`,
    m => m.querySelector("#ask-yes").onclick = () => { closeModal(); onYes(); });
}
let actx = null;
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume();
    (kind === "good" ? [660, 880, 1175] : [880, 660]).forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; const t0 = actx.currentTime + i * .13;
      g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.25, t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + .12);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + .14);
    });
  } catch (_) {}
  try { navigator.vibrate && navigator.vibrate(kind === "good" ? [60, 40, 60] : [120, 60, 120]); } catch (_) {}
}
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("div"); c.className = "confetti";
  const cols = ["#F2B53A", "#6247D3", "#178174", "#B9456F", "#25804A"];
  for (let i = 0; i < 60; i++) { const p = document.createElement("i"); p.style.left = Math.random() * 100 + "%"; p.style.background = cols[i % cols.length]; p.style.animationDuration = (1.8 + Math.random() * 1.6) + "s"; p.style.animationDelay = Math.random() * .6 + "s"; c.appendChild(p); }
  document.body.appendChild(c); setTimeout(() => c.remove(), 4200);
}
const fail = e => { console.error(e); toast(e?.code === "permission-denied" ? "Нет прав на это действие." : "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз."); };

/* ---------- данные ---------- */
function recompute() {
  if (!S.cfg) return;
  S.data = F.merge(S.kidlogs, S.plogs, S.cfg);
  // уведомления внутри приложения о новых событиях
  const now = new Map(S.data.entries.map(e => [e.id, e.status + "|" + e.at]));
  if (S.prevStatus) {
    const kid = viewingKid();
    for (const e of S.data.entries) {
      const before = S.prevStatus.get(e.id), cur = now.get(e.id);
      if (before === cur) continue;
      const wasPending = before && before.startsWith("pending");
      if (isParent() && !S.preview && e.status === "pending" && e.type !== "game") {
        const k = kidById(e.kid)?.name || "";
        toast(e.type === "wish" ? `${k} хочет обменять: ${e.title}` : `На проверку: ${k} — ${e.title}`, true); beep("alert");
      } else if (!isParent() && e.kid === kid && wasPending) {
        if (e.type === "task" && e.status === "ok") { toast(`Проверка пройдена: +${e.value}. Баллы зачислятся вечером`, true); beep("good"); }
        else if (e.status === "redo") { toast("Проверка: нужна доработка", true); beep("alert"); }
        else if (e.type === "wish" && e.status === "ok") { setTimeout(maybeShowGift, 200); }
        else if (e.status === "no") toast(e.type === "wish" ? "Заявка на награду отклонена" : "Проверка: задание не засчитано", true);
      }
    }
  }
  S.prevStatus = now;
}
const acct = kid => F.account(kid, S.data, S.cfg);
const photoDays = () => +(S.cfg?.settings?.photoDays) || 14;
const pendingList = () => S.data.entries.filter(e => e.status === "pending" && e.type !== "game" && kidById(e.kid));
function level(kid) { const e = acct(kid).earnedTotal; const lv = Math.floor(e / 150) + 1; return { lv, rank: RANKS[Math.min(lv - 1, RANKS.length - 1)], cur: e % 150, e }; }
function streak(kid) {
  const days = new Set(S.data.entries.filter(e => e.kid === kid && e.type === "task" && e.status === "ok").map(e => e.day));
  let s = today(); if (!days.has(s)) s = F.addDays(s, -1); let n = 0; while (days.has(s)) { n++; s = F.addDays(s, -1); } return n;
}
const sundayLabel = () => `в воскресенье в ${F.creditTime(S.cfg)}`;

/* ====================== РЕНДЕР ====================== */
let renderPending = false;
function render() {
  renderPending = false;
  const app = document.getElementById("app");
  document.documentElement.lang = I18N.lang();
  const done = () => I18N.apply(app);
  setTimeout(done, 0);
  if (S.error) { app.innerHTML = errorScreen(); return; }
  if (!S.be || S.user === undefined) { app.innerHTML = `<div class="boot">Загрузка…</div>`; return; }
  if (!S.user) { app.innerHTML = loginScreen(); return; }
  if (!S.fid) { app.innerHTML = onboardingScreen(); return; }
  if (!S.loaded || !S.cfg) { app.innerHTML = `<div class="boot">Загружаю семью…</div>`; return; }
  if (!S.me) { app.innerHTML = noAccessScreen(); return; }
  const kidMode = !!viewingKid();
  const tabs = kidMode
    ? [["today", "check-circle", "Сегодня"], ["cal", "calendar", "Календарь"], ["shop", "gift", "Награды"], ["hist", "history", "История"]]
    : [["review", "inbox", "Проверка"], ["cal", "calendar", "Календарь"], ["tasks", "checklist", "Дела"], ["rewards", "gift", "Награды"], ["settings", "sliders", "Настройки"]];
  if (!tabs.some(t => t[0] === S.tab)) S.tab = tabs[0][0];
  const pend = pendingList().length;
  let html = `<nav class="nav" aria-label="Разделы"><div class="nav-in"><div class="nav-logo" aria-hidden="true">${appIcon(40)}</div>${tabs.map(([id, i, n]) => `<button data-act="tab" data-id="${id}" ${S.tab === id ? 'aria-current="page"' : ""}><span class="ico">${ic(i)}${id === "review" && pend ? `<span class="badge">${pend}</span>` : ""}${id === "settings" && supportBadge() ? `<span class="badge">${supportBadge()}</span>` : ""}</span><span class="lbl">${n}</span></button>`).join("")}</div></nav><div class="wrap" data-tab="${S.tab}">`;
  html += topBar();
  if (kidMode) {
    const k = kidById(viewingKid());
    if (!k) html += `<div class="empty">Профиль ребёнка не найден. Попросите родителей прислать новый код приглашения.</div>`;
    else html += ({ today: kidToday, cal: calendarView, shop: kidShop, hist: kidHistory })[S.tab](k);
  } else html += ({ review: parentReview, cal: calendarView, tasks: parentTasks, rewards: parentRewards, settings: parentSettings })[S.tab]();
  html += `</div>`;
  app.innerHTML = html;
  I18N.apply(app);
  deskLayout();
  if (kidMode) maybeShowGift();
}
/* Компьютер: карточки раскладываются по колонкам одинаковой высоты, последняя карточка в колонке тянется до низа. */
const DESK = matchMedia("(min-width: 1100px)"), WIDE = matchMedia("(min-width: 1700px)");
function deskLayout() {
  const wrap = document.querySelector("#app > .wrap"); if (!wrap) return;
  const old = wrap.querySelector(":scope > .cols");
  if (old) { for (const col of [...old.children]) old.before(...col.children); old.remove(); }
  if (!DESK.matches) return;
  const span = el => el.matches(".top,.banner,.sub-head,.version,.empty") || (wrap.dataset.tab === "tasks" && el.matches("section.card") && el === wrap.querySelector(":scope > section.card"));
  const items = [...wrap.children].filter(el => !span(el));
  if (items.filter(el => el.matches("section,.set-group,.profile")).length < 2) return;
  const n = WIDE.matches && ["tasks", "settings"].includes(wrap.dataset.tab) ? 3 : 2;
  const gap = 18, hs = items.map(el => el.getBoundingClientRect().height + gap), total = hs.reduce((a, b) => a + b, 0);
  const cols = document.createElement("div"); cols.className = "cols"; cols.style.setProperty("--n", n);
  const groups = Array.from({ length: n }, () => []);
  // Раскладываем по порядку, как газетные колонки: следующая колонка начинается, когда текущая набрала свою долю.
  let c = 0, acc = 0;
  items.forEach((el, i) => { if (c < n - 1 && acc > 0 && acc + hs[i] / 2 > total * (c + 1) / n) c++; groups[c].push(el); acc += hs[i]; });
  for (const g of groups) { if (!g.length) continue; const col = document.createElement("div"); col.className = "col"; col.append(...g); cols.append(col); }
  cols.style.setProperty("--n", cols.children.length);
  const first = wrap.querySelector(":scope > .version");
  first ? first.before(cols) : wrap.append(cols);
}
let deskT = 0;
const relayout = () => { clearTimeout(deskT); deskT = setTimeout(() => { if (!S.drag) deskLayout(); }, 120); };
DESK.addEventListener?.("change", relayout); WIDE.addEventListener?.("change", relayout);
function rerender() {
  const a = document.activeElement;
  if (S.drag || (a && a.closest && a.closest("#app") && a.matches("input,textarea,select"))) { renderPending = true; return; }
  render();
}
document.addEventListener("focusout", () => setTimeout(() => { if (renderPending) rerender(); }, 150));

function topBar() {
  const kid = viewingKid() && kidById(viewingKid());
  const who = kid ? kid.name : (S.me?.name || S.user.displayName || "Родитель");
  return `${S.be.demo ? `<div class="banner"><span>Демо-режим: данные не сохраняются</span><span class="btnrow">${["parent", "k1", "k2"].map(r => `<button class="btn sm ${demoRole() === r ? "dark" : ""}" data-act="demoRole" data-id="${r}">${r === "parent" ? "Родитель" : esc(kidById(r)?.name || r)}</button>`).join("")}</span></div>` : ""}
  ${isParent() && S.preview ? `<div class="banner"><span>Вы смотрите глазами ребёнка: ${esc(kid?.name || "")}</span><button class="btn sm dark" data-act="endPreview">Вернуться</button></div>` : ""}
  <header class="top"><div class="brand">${appIcon(36)}<div><h1>Family Quests</h1><small>${esc(S.cfg?.name || "")}</small></div></div>
  ${avatar(who, kid ? (isParent() ? kidMember(kid)?.avatar : S.me?.avatar) : S.me?.avatar, "", kid ? `background:${kidColor(kid)}` : "", `data-act="${viewingKid() && !isParent() ? "kidMenu" : "tab"}" data-id="settings" aria-label="${esc(who)}"`, "button")}</header>`;
}
function demoRole() { return S.me?.role === "parent" ? "parent" : S.me?.kidId; }

/* ---------- экраны входа ---------- */
const GLOGO = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
function loginScreen() {
  const join = new URLSearchParams(location.search).get("join");
  return `<div class="login"><div class="box"><div class="lang-switch">${["ru", "en"].map(c => `<button data-act="setLang" data-id="${c}" aria-pressed="${I18N.lang() === c}">${c.toUpperCase()}</button>`).join("")}</div><img class="logo" src="${window.FQ_ICON || "/icon.svg"}" alt=""><h1>Family Quests</h1>
    <p class="hint" style="font-size:15px">Дела по дому и учёба за баллы. Баллы копятся за неделю и обмениваются на награды.</p>
    ${join ? `<div class="banner">Вас пригласили в семью. Войдите, чтобы присоединиться.</div>` : ""}
    <button class="gbtn" data-act="signIn">${GLOGO} Войти через Google</button>
    <div class="feat"><div>${ic("checklist")}<span>Обязательные и дополнительные дела</span></div><div>${ic("bell")}<span>Напоминания на телефон</span></div><div>${ic("calendar")}<span>Календарь с выходными</span></div><div>${ic("gift")}<span>Награды и подарки</span></div></div>
    <p class="hint">Каждая семья видит только свои данные.</p></div></div>`;
}
function onboardingScreen() {
  const join = new URLSearchParams(location.search).get("join") || "";
  return `<div class="wrap" style="padding-bottom:40px"><header class="top"><div class="brand">${appIcon(36)}<div><h1>Добро пожаловать</h1><small>${esc(S.user.email || "")}</small></div></div><button class="btn sm ghost" data-act="signOut">Выйти</button></header>
    <section class="card"><h2>У меня есть код приглашения</h2><p class="hint">Код присылает родитель: «Настройки» → «Участники и приглашения». Подходит детям и второму родителю.</p>
      <form class="grid" data-form="join"><label>Код<input id="j-code" name="code" value="${esc(join)}" autocomplete="off" autocapitalize="characters" required placeholder="Например: K7M2QX9A"></label><div><button class="btn go big">Присоединиться</button></div></form></section>
    <section class="card"><h2>Создать новую семью</h2><p class="hint">Вы станете родителем-администратором. Список дел начнётся пустым: дела и награды выберете из шаблонов или создадите свои.</p>
      <form class="grid" data-form="create">
        <label class="full">Название семьи<input id="c-name" name="name" required placeholder="Например: Семья Ивановых"></label>
        <label>Ребёнок 1<input id="c-k1" name="k1" required placeholder="Имя"></label><label>Возраст<input id="c-a1" name="a1" type="number" inputmode="numeric" min="3" max="18" value="10"></label>
        <label>Ребёнок 2<input id="c-k2" name="k2" placeholder="Имя (необязательно)"></label><label>Возраст<input id="c-a2" name="a2" type="number" inputmode="numeric" min="3" max="18" value="14"></label>
        <label>Ребёнок 3<input id="c-k3" name="k3" placeholder="Имя (необязательно)"></label><label>Возраст<input id="c-a3" name="a3" type="number" inputmode="numeric" min="3" max="18"></label>
        <div class="full"><button class="btn dark big">Создать семью</button></div></form></section></div>`;
}
const noAccessScreen = () => `<div class="login"><div class="box"><img class="logo" src="${window.FQ_ICON || "/icon.svg"}" alt=""><h1>Вас нет в этой семье</h1><p class="hint">Похоже, родители удалили ваш профиль или всю семью. Попросите их прислать новое приглашение и введите код.</p><button class="btn go big" data-act="leaveFamily">Ввести код приглашения</button><button class="btn ghost" data-act="signOut">Выйти из аккаунта</button></div></div>`;
const errorScreen = () => `<div class="login"><div class="box"><img class="logo" src="${window.FQ_ICON || "/icon.svg"}" alt=""><h1>Приложение не настроено</h1><p class="hint">${esc(S.error)}</p><a class="btn dark" href="?demo">Открыть демо-режим</a></div></div>`;

/* ====================== РЕБЁНОК ====================== */
function hero(k) {
  const a = acct(k.id), L = level(k.id), st = streak(k.id);
  return `<section class="hero">
    <div><div class="who">${esc(k.name)} · уровень ${L.lv}</div><div class="rank">${L.rank}</div></div>
    <div class="bal"><div class="v num">${a.available}</div><div class="l">можно потратить</div></div>
    <div class="xp"><div class="bar"><i style="width:${Math.round(L.cur / 1.5)}%"></i></div><div class="row num"><span>До уровня ${L.lv + 1}: ещё ${150 - L.cur}</span><span class="streak">${ic("flame", "xs")} ${st} ${plural(st, "день", "дня", "дней")} подряд</span></div></div>
    <div class="stats num">
      <span class="stat"><b>+${a.today}</b>сегодня${a.tonight ? `, зачислится в ${F.creditTime(S.cfg)}` : ""}</span>
      <span class="stat"><b>${a.locked}</b>копится за неделю, откроется ${sundayLabel()}</span>
      ${a.reserved ? `<span class="stat"><b>${a.reserved}</b>в заявках на награды</span>` : ""}
    </div></section>`;
}
function taskRow(t, k, s, st) {
  const x = F.mult(S.cfg, s, t.id);
  const dl = s === today() ? F.deadline(t, s, S.cfg) : null;
  const latePts = dl && dl.phase === "late" ? Math.round(t.pts * x * dl.pct / 100) : null;
  let side;
  if (st.free && dl && dl.phase === "closed") side = `<span class="pill no">Время вышло</span>`;
  else if (st.free && latePts != null) side = `<span class="pts num">+${latePts}</span><button class="btn" data-act="done" data-id="${t.id}">Сделал с опозданием</button>`;
  else if (st.free) side = `<span class="pts num">+${t.pts * x}</span>${st.pending ? `<span class="pill wait">проверяется: ${st.pending}</span>` : ""}<button class="btn go" data-act="done" data-id="${t.id}">Готово!</button>`;
  else if (st.status === "pending") side = `<span class="pts num">+${t.pts * x}</span><span class="pill wait">Проверяется…</span>${canWithdraw(st.entry) ? `<button class="btn sm ghost" data-act="withdraw" data-id="${st.entry.id}">Отменить</button>` : ""}`;
  else if (st.status === "redo") side = `<span class="pts num">+${t.pts * x}</span><button class="btn go" data-act="done" data-id="${t.id}" data-entry="${st.entry.id}">Исправил!</button>`;
  else side = `<span class="pill ok">${ic("check", "xs")} Принято</span>`;
  const sub = [];
  if (t.bound && t.time) sub.push(`<span class="time">${ic("clock", "xs")} ${esc(t.time)}</span>`);
  if (dl && st.free) sub.push(dl.phase === "open" ? (dl.left < 3600e3 ? `<b class="warn">осталось ${Math.max(1, Math.ceil(dl.left / 60000))} мин</b>` : `сдать до ${fmtTime(dl.deadline)}`) : dl.phase === "late" ? `<b class="warn">опоздание: ${dl.pct}% баллов</b>` : "");
  sub.push(CATS[t.cat]?.n || "");
  if (!t.bound && t.freq === "week" && st.need) sub.push(`${st.count || 0} из ${st.need} на неделе`);
  if (!t.bound && t.freq === "many") sub.push("сколько угодно раз");
  const tags = [t.checklist?.length ? `${ic("check-square", "xs")} ${t.checklist.length}` : "", t.photo ? `${ic("camera", "xs")} фото` : ""].filter(Boolean).map(v => `<span class="tag">${v}</span>`).join("");
  const done = (!st.free && st.status !== "redo") || (st.free && dl && dl.phase === "closed");
  return `<div class="task ${t.mandatory && !done ? "must" : ""} ${done ? "done" : ""}"><span class="ic cat-${t.cat}">${ic(CATS[t.cat]?.ic || "star")}</span>
    <div class="t"><b>${esc(t.title)}${x > 1 ? `<span class="x2">×2</span>` : ""}</b><small>${sub.filter(Boolean).join(" · ")}</small>${tags ? `<div class="tags">${tags}</div>` : ""}</div><div class="side">${side}</div>
    ${st.status === "redo" ? `<div class="note"><b>Нужна доработка.</b> ${esc(st.entry.dec?.note || "Проверка не прошла. Посмотри ещё раз и пришли новое фото.")}</div>` : ""}</div>`;
}
function kidToday(k) {
  const s = today(), info = F.dayInfo(s, S.cfg);
  const tasks = F.live(S.cfg.tasks).filter(t => t.active !== false && F.forKid(t, k.id));
  const groups = { mb: [], ob: [], mu: [], ou: [] };
  tasks.forEach(t => { if (t.bound && !F.applies(t, s, S.cfg)) return; groups[F.category(t)].push(t); });
  let out = hero(k);
  if (info.type === "off" && info.reason !== "weekend") out += `<span class="daychip">${ic("sparkle", "xs")} Сегодня выходной${info.name ? ": " + esc(info.name) : ""}</span>`;
  else if (info.reason === "transfer" || info.reason === "parent") out += `<span class="daychip">${ic("pencil", "xs")} ${esc(info.name)}</span>`;
  const titles = { mb: ["Обязательно сегодня", "Сделай всё до вечера"], ob: ["Можно сегодня", "За это дополнительные баллы"], mu: ["Обязательно на этой неделе", "Успей до воскресенья"], ou: ["В любое время", "Дополнительные баллы"] };
  let any = false;
  for (const c of ["mb", "mu", "ob", "ou"]) {
    const list = groups[c]; if (!list.length) continue; any = true;
    const active = st => (st.free && !st.closed) || st.status === "redo";
    const rows = list.map(t => { const st = F.taskState(t, k.id, s, S.data); const dl = F.deadline(t, s, S.cfg); if (st.free && dl && dl.phase === "closed") st.closed = true; return [t, st]; });
    rows.sort((a, b) => active(b[1]) - active(a[1]));
    const left = rows.filter(r => active(r[1])).length;
    out += `<section class="card"><div class="group-h"><h2>${titles[c][0]}</h2><span class="hint">${c[0] === "m" ? (left ? `осталось ${left}` : "всё сделано") : titles[c][1]}</span></div><div class="group">${rows.map(([t, st]) => taskRow(t, k, s, st)).join("")}</div></section>`;
  }
  if (!any) out += F.live(S.cfg.tasks).some(t => t.active !== false && F.forKid(t, k.id))
    ? `<div class="empty big">${ic("sparkle")}<b>На сегодня дел нет</b><span>Отдыхай!</span></div>`
    : `<div class="empty big">${ic("checklist")}<b>Дел пока нет</b><span>Родители скоро добавят задания — за них ты будешь получать баллы.</span></div>`;
  return out;
}
function kidShop(k) {
  const a = acct(k.id);
  let out = `<section class="card"><div class="card-head"><h2>${ic("coins", "h")} Мои баллы</h2></div><div class="kids-sum"><div class="ks"><span>Можно потратить</span><span class="v num">${a.available}</span></div><div class="ks"><span>Копится за неделю</span><span class="v num">${a.locked}</span><small class="hint">откроется ${sundayLabel()}</small></div></div></section>`;
  const wishes = F.live(S.cfg.wishes).filter(w => F.forKid(w, k.id));
  out += `<section class="card"><div class="card-head"><h2>${ic("gift", "h")} Магазин желаний</h2><span class="hint">Обменяй баллы на награду</span></div>`;
  out += wishes.length ? `<div class="shop">${wishes.map(w => { const can = a.available >= w.cost, p = Math.max(0, Math.min(100, Math.round(a.available / w.cost * 100)));
    return `<div class="wish"><b>${esc(w.title)}</b><div class="cost num">${coin(16)} ${w.cost}</div>${can ? "" : `<div class="mini"><i style="width:${p}%"></i></div><div class="need num">Ещё ${ptsW(w.cost - a.available)}</div>`}
      <button class="btn ${can ? "dark" : ""}" data-act="wish" data-id="${w.id}" ${can ? "" : "disabled"}>${can ? "Обменять" : "Копим"}</button></div>`; }).join("")}</div>` : `<div class="empty">${ic("gift")}Родители ещё не добавили награды.</div>`;
  return out + `</section>`;
}
function histRow(e) {
  if (e.kind) { // подарок / бонус
    const plus = e.pts >= 0;
    return `<div class="it"><span>${e.kind === "gift" ? `${ic("gift", "xs gold")} Подарок от родителей` : plus ? `${ic("medal", "xs")} Бонус` : `${ic("minus-circle", "xs")} Списание`}${e.msg ? `<br><small>${esc(e.msg)}</small>` : ""}<br><small>${fmtDate(e.at)}</small></span><span class="pill ok">${plus ? "получено" : "списано"}</span><span class="delta num ${plus ? "plus" : "minus"}">${plus ? "+" : "−"}${Math.abs(e.pts)}</span></div>`;
  }
  const minus = e.type !== "task";
  const sign = (minus ? "−" : "+") + e.value;
  const label = e.type === "game" ? `Игровое время +${e.minutes} мин` : e.type === "wish" ? `${ic("gift", "xs gold")} ${esc(e.title)}` : esc(e.title);
  const pill = e.status === "pending" ? `<span class="pill wait">${e.type === "wish" ? "ждёт" : "проверяется"}</span>` : e.status === "redo" ? `<span class="pill wait">доработка</span>` : e.status === "ok" ? `<span class="pill ok">${e.type === "task" ? "принято" : e.type === "wish" ? "одобрено" : "куплено"}</span>` : `<span class="pill no">${e.type === "wish" ? "отклонено" : "не засчитано"}</span>`;
  const note = (e.dec?.note && e.status !== "pending" ? `<br><small>${e.type === "wish" ? "Родители" : "Проверка"}: ${esc(e.dec.note)}</small>` : "") + (e.type === "task" && e.status === "ok" && e.dec?.instant ? `<br><small class="gold-t">${ic("coins", "xs")} сразу в банк</small>` : "");
  return `<div class="it"><span>${label}<br><small>${fmtDate(e.at)}</small>${note}${canWithdraw(e) ? `<br><button class="btn sm ghost wd" data-act="withdraw" data-id="${e.id}">Отменить</button>` : ""}</span>${pill}<span class="delta num ${e.status === "no" || e.status === "redo" || e.status === "pending" ? "" : minus ? "minus" : "plus"}">${sign}</span></div>`;
}
function kidHistory(k) {
  const items = [...S.data.entries.filter(e => e.kid === k.id), ...S.data.gifts.filter(g => g.kid === k.id)].sort((a, b) => b.at - a.at).slice(0, 60);
  return `<section class="card"><h2>${ic("history", "h")} История</h2>${items.length ? `<div class="list">${items.map(histRow).join("")}</div>` : `<div class="empty">${ic("history")}Тут появятся выполненные дела и награды.</div>`}</section>`;
}
function maybeShowGift() {
  if (document.querySelector(".scrim")) return;
  const kid = viewingKid(); if (!kid || isParent()) return;
  const seen = new Set(S.me?.seen || []);
  const markSeen = id => { S.me.seen = [...(S.me.seen || []), id]; S.be.updateMember(S.user.uid, { seen: S.me.seen }).catch(fail); };
  const w = S.data.entries.find(e => e.kid === kid && e.type === "wish" && e.status === "ok" && !seen.has(e.id));
  if (w) {
    modal(`<div class="gift-ic">${ic("sparkle")}</div><h2>Желание исполняется!</h2><div class="amt" style="font-size:26px;line-height:1.25">${esc(w.title)}</div>${w.dec?.note ? `<div class="msg">${esc(w.dec.note)}</div>` : ""}<p class="hint">Родители одобрили твою заявку. Списано ${ptsW(w.value)}.</p><div class="btns" style="justify-content:center"><button class="btn go big" id="gift-ok">Ура!</button></div>`,
      m => { confetti(); beep("good"); m.querySelector("#gift-ok").onclick = () => { closeModal(); markSeen(w.id); setTimeout(maybeShowGift, 300); }; }, "gift");
    return;
  }
  const g = S.data.gifts.find(x => x.kid === kid && x.kind === "gift" && !seen.has(x.id));
  if (!g) return;
  modal(`<div class="gift-ic">${ic("gift")}</div><h2>Подарок от родителей!</h2><div class="amt num">+${ptsW(g.pts)}</div>${g.msg ? `<div class="msg">${esc(g.msg)}</div>` : ""}<p class="hint">Баллы уже на счету — их можно тратить.</p><div class="btns" style="justify-content:center"><button class="btn go big" id="gift-ok">Спасибо!</button></div>`,
    m => { confetti(); beep("good"); m.querySelector("#gift-ok").onclick = () => { closeModal(); S.me.seen = [...(S.me.seen || []), g.id]; S.be.updateMember(S.user.uid, { seen: S.me.seen }).catch(fail); setTimeout(maybeShowGift, 300); }; }, "gift");
}

/* ====================== КАЛЕНДАРЬ ====================== */
function calendarView(kParam) {
  const parentMode = !viewingKid();
  const kids = kidsList();
  if (!S.calKid || !kidById(S.calKid)) S.calKid = viewingKid() || kids[0]?.id;
  const kid = viewingKid() || S.calKid;
  const [y, m] = S.calMonth.split("-").map(Number);
  const first = F.dayKey(new Date(y, m - 1, 1)), start = F.weekStart(first);
  const t0 = today();
  if (!S.selDay) S.selDay = t0;
  let cells = `<div class="dh">${DOW.join('</div><div class="dh">')}</div><div class="dh">Нед.</div>`;
  let s = start;
  for (let w = 0; w < 6; w++) {
    if (w > 0 && +s.slice(5, 7) !== m && s > first) break;
    let weekPts = 0;
    for (let i = 0; i < 7; i++) {
      const sum = F.daySummary(kid, s, S.data, S.cfg, t0);
      weekPts += sum.pts;
      const other = +s.slice(5, 7) !== m;
      const x2 = (S.cfg.days?.[s]?.x2 || []).length;
      const ov = S.cfg.days?.[s]?.type && S.cfg.days[s].type !== "auto";
      cells += `<button class="cell ${sum.info.type === "off" ? "off" : ""} ${other ? "other" : ""} ${s === t0 ? "today" : ""} ${s === S.selDay ? "sel" : ""}" data-act="selDay" data-id="${s}" aria-label="${humanDay(s)}">
        ${x2 ? `<span class="flag x">×2</span>` : ov ? `<span class="flag">${ic("pencil")}</span>` : sum.info.reason === "holiday" ? `<span class="flag">${ic("sparkle")}</span>` : ""}
        <span class="d">${+s.slice(8)}</span>${sum.pts ? `<span class="p num">+${sum.pts}</span>` : ""}${sum.missed.length ? `<span class="m">−${sum.missed.length}</span>` : ""}${s > t0 && sum.planned.length ? `<span class="f">${sum.planned.length} дел</span>` : ""}</button>`;
      s = F.addDays(s, 1);
    }
    cells += `<div class="wk num" title="Баллы за неделю">${weekPts ? "+" + weekPts : "·"}</div>`;
  }
  let out = `<section class="card">${parentMode && kids.length > 1 ? `<div class="chips">${kids.map(k => `<button class="chip" data-act="calKid" data-id="${k.id}" aria-pressed="${k.id === kid}">${esc(k.name)}</button>`).join("")}</div>` : ""}
    <div class="cal-head"><button class="btn sm ghost icon" data-act="calPrev" aria-label="Предыдущий месяц">${ic("chev-l")}</button><b>${MONTHS[m - 1]} ${y}</b><button class="btn sm ghost icon" data-act="calNext" aria-label="Следующий месяц">${ic("chev-r")}</button></div>
    <div class="cal">${cells}</div>
    <div class="legend"><span><i style="background:var(--off)"></i>выходной</span><span>${ic("pencil", "xs")} изменено родителями</span><span><b class="x2 sm">×2</b> двойные баллы</span><span class="bad"><b>−N</b> пропущено</span></div></section>`;
  out += dayPanel(kid, S.selDay, parentMode);
  return out;
}
function dayPanel(kid, s, parentMode) {
  const t0 = today(), sum = F.daySummary(kid, s, S.data, S.cfg, t0), k = kidById(kid);
  const ws = F.weekStart(s), we = F.weekEnd(s);
  let weekPts = 0; for (let d = ws; d <= we; d = F.addDays(d, 1)) weekPts += F.daySummary(kid, d, S.data, S.cfg, t0).pts;
  const activeAt = F.atTime(we, F.creditTime(S.cfg));
  const info = sum.info;
  let out = `<section class="card"><div class="card-head"><h2>${humanDay(s)}</h2><span class="pill ${info.type === "off" ? "ok" : "wait"}">${info.type === "off" ? "выходной" : "рабочий день"}</span></div>
    ${info.name ? `<p class="hint">${esc(info.name)}</p>` : ""}
    ${k ? "" : `<p class="hint">Добавьте детей в «Настройки → Дети» — здесь появятся их баллы и пропуски.</p>`}<div class="kids-sum" ${k ? "" : "hidden"}><div class="ks"><span>За день</span><span class="v num">+${sum.pts}</span></div><div class="ks"><span>За неделю ${+ws.slice(8)}–${+we.slice(8)}</span><span class="v num">+${weekPts}</span><small class="hint">${Date.now() >= activeAt ? "уже доступны для трат" : `станут доступны ${+we.slice(8)} ${MONTHS_G[+we.slice(5, 7) - 1]} в ${F.creditTime(S.cfg)}`}</small></div></div>`;
  const rows = [];
  sum.done.forEach(e => rows.push(`<div class="it"><span>${esc(e.title)}${F.mult(S.cfg, s, e.ref) > 1 ? `<span class="x2">×2</span>` : ""}<br><small>${fmtTime(e.at)}</small></span>${e.status === "ok" ? `<span class="pill ok">принято</span>` : e.status === "no" ? `<span class="pill no">не засчитано</span>` : e.status === "redo" ? `<span class="pill wait">доработка</span>` : `<span class="pill wait">проверяется</span>`}<span class="delta num ${e.status === "ok" ? "plus" : ""}">+${e.value}</span></div>`));
  sum.missed.forEach(t => rows.push(`<div class="it"><span>${esc(t.title)}<br><small>обязательное дело${t.time ? " · " + esc(t.time) : ""}</small></span><span class="pill no">пропущено</span>${parentMode ? `<button class="btn sm ghost" data-act="credit" data-id="${t.id}" data-kid="${kid}">Засчитать</button>` : `<span class="delta">0</span>`}</div>`));
  sum.gifts.forEach(g => rows.push(`<div class="it"><span>${g.kind === "gift" ? `${ic("gift", "xs gold")} Подарок от родителей` : g.pts >= 0 ? `${ic("medal", "xs")} Бонус` : `${ic("minus-circle", "xs")} Списание`}${g.msg ? `<br><small>${esc(g.msg)}</small>` : ""}</span><span></span><span class="delta num ${g.pts >= 0 ? "plus" : "minus"}">${g.pts >= 0 ? "+" : "−"}${Math.abs(g.pts)}</span></div>`));
  if (s >= t0) {
    const doneIds = new Set(sum.done.map(e => e.ref));
    sum.planned.filter(t => !doneIds.has(t.id)).sort((a, b) => (a.time || "99").localeCompare(b.time || "99")).forEach(t => rows.push(`<div class="it"><span>${t.time ? `<b>${esc(t.time)}</b> ` : ""}${esc(t.title)}${F.mult(S.cfg, s, t.id) > 1 ? `<span class="x2">×2</span>` : ""}<br><small>${t.mandatory ? "обязательно" : "по желанию"}</small></span><span class="pill wait">запланировано</span><span class="delta num">+${t.pts * F.mult(S.cfg, s, t.id)}</span></div>`));
  }
  if (k) out += rows.length ? `<div class="list">${rows.join("")}</div>` : `<div class="empty">${s > t0 ? "Дел по расписанию нет." : "В этот день ничего не отмечено."}</div>`;
  if (parentMode) {
    const ov = S.cfg.days?.[s] || {};
    const tasks = F.live(S.cfg.tasks).filter(t => t.active !== false && F.forKid(t, kid) && (!t.bound || F.applies(t, s, S.cfg)));
    if (s < t0) out += `<h3>Настроить день (для всех детей)</h3><p class="hint">${ic("clock", "xs")} День уже прошёл — его тип и двойные баллы менять нельзя, чтобы не изменились начисленные баллы и пропуски. Пропущенное дело можно засчитать кнопкой «Засчитать».</p>`;
    else out += `<h3>Настроить день (для всех детей)</h3>
      <div class="seg" role="group" aria-label="Тип дня">${[["auto", "Как обычно"], ["off", "Выходной"], ["work", "Рабочий"]].map(([v, n]) => `<button data-act="dayType" data-id="${v}" aria-pressed="${(ov.type || "auto") === v}">${n}</button>`).join("")}</div>
      <p class="hint">Двойные баллы в этот день:</p>
      <div class="chips">${tasks.map(t => `<button class="chip" data-act="dayX2" data-id="${t.id}" aria-pressed="${(ov.x2 || []).includes(t.id)}">×2 ${esc(t.title)}</button>`).join("") || `<span class="hint">Нет дел на этот день.</span>`}</div>`;
  }
  return out + `</section>`;
}

/* ====================== РОДИТЕЛЬ ====================== */
function startCard() {
  const hasTasks = F.live(S.cfg.tasks).some(t => t.active !== false);
  const hasWishes = F.live(S.cfg.wishes).length > 0;
  const hasKids = kidsList().length > 0 && S.members.some(m => m.role === "child");
  if (hasTasks && hasWishes && hasKids) return "";
  const step = (done, title, sub, act, id, btn) => `<li class="${done ? "done" : ""}"><span class="dot">${done ? ic("check") : ""}</span><span class="t"><b>${title}</b><small>${sub}</small></span>${done ? "" : `<button class="btn sm go" data-act="${act}" data-id="${id}">${btn}</button>`}</li>`;
  return `<section class="card start"><div class="card-head"><h2>С чего начать</h2><span class="hint">${[hasTasks, hasWishes, hasKids].filter(Boolean).length} из 3</span></div><ol class="steps">
    ${step(hasTasks, "Добавьте дела", "Готовые шаблоны или свои: обязательные и дополнительные", "tplTasks", "", "Шаблоны")}
    ${step(hasWishes, "Заполните магазин желаний", "На что дети будут тратить баллы", "tplWishes", "", "Шаблоны")}
    ${kidsList().length ? step(hasKids, "Пригласите детей", "Каждому ребёнку — свой код для входа", "inviteWho", "child", "Пригласить") : step(false, "Добавьте детей", "Имя, возраст и цвет — потом пригласите каждого", "goSet", "kids", "Добавить")}
  </ol></section>`;
}
function parentReview() {
  const pend = pendingList().sort((a, b) => a.at - b.at);
  let out = startCard() + `<section class="card"><h2>${ic("coins", "h")} Счета детей</h2>${kidsList().length ? "" : `<div class="empty">Детей пока нет.<button class="btn sm go" data-act="goSet" data-id="kids">${ic("plus")} Добавить ребёнка</button></div>`}<div class="kids-sum">${kidsList().map(k => { const a = acct(k.id); return `<div class="ks"><span>${esc(k.name)}</span><span class="v num">${a.available}</span><small class="hint num">копится ${a.locked} · сегодня +${a.today} · ${ic("flame", "xs")} ${streak(k.id)}</small></div>`; }).join("")}</div></section>`;
  out += `<section class="card"><h2>${ic("inbox", "h")} Ждут проверки${pend.length ? " · " + pend.length : ""}</h2>`;
  if (!pend.length) out += `<div class="empty">${ic("check-circle")}Всё проверено. Новых заявок нет.</div>`;
  else out += pend.map(e => {
    const k = kidById(e.kid);
    const photos = e.photos?.length ? `<div class="photos">${e.photos.map(p => S.photos[p] ? `<button class="ph" data-act="zoom" data-id="${p}" aria-label="Открыть фото"><img src="${S.photos[p]}" alt=""></button>` : `<span class="ph" data-photo="${p}">загрузка…</span>`).join("")}</div>` : "";
    const btns = e.type === "wish" ? `<button class="btn ok sm" data-act="approve" data-id="${e.id}">Выдать</button><button class="btn no sm" data-act="reject" data-id="${e.id}">Отказать</button>`
      : `<button class="btn ok sm" data-act="approve" data-id="${e.id}">Принять</button><button class="btn sm ghost" data-act="redo" data-id="${e.id}">На доработку</button><button class="btn no sm" data-act="reject" data-id="${e.id}">Не засчитать</button>`;
    return `<div class="req"><div><b>${e.type === "wish" ? `${ic("gift", "xs gold")} Хочет обменять: ` : ""}${esc(e.title)}</b><br><small class="hint">${esc(k?.name || "")} · ${humanDay(e.day)}, ${fmtTime(e.at)} · <span class="num">${e.type === "wish" ? "−" : "+"}${e.value}</span>${F.mult(S.cfg, e.day, e.ref) > 1 && e.type === "task" ? " (×2)" : ""}${e.late ? " · с опозданием" : ""}${e.manual ? " · засчитано родителем" : ""}</small></div>
      ${e.checks?.length ? `<ul class="checks-ro">${e.checks.map(c => `<li>${ic("check", "xs")} ${esc(c)}</li>`).join("")}</ul>` : ""}${photos}${e.resent ? `<small class="hint">Прислано повторно после доработки</small>` : ""}
      ${e.type === "task" ? `<label class="inline instant"><input type="checkbox" data-instant="${e.id}" ${S.instant.has(e.id) ? "checked" : ""}> Сразу в банк — баллы можно потратить сейчас, не дожидаясь воскресенья</label>` : ""}
      <div class="act">${btns}</div></div>`;
  }).join("");
  out += `<p class="hint">Дети видят решения как итог автоматической проверки. Комментарий «на доработку» они увидят с пометкой «Проверка».</p></section>`;
  const recent = S.data.entries.filter(e => e.dec?.status && e.type !== "game").sort((a, b) => (b.dec.decidedAt || 0) - (a.dec.decidedAt || 0)).slice(0, 8);
  if (recent.length) out += `<section class="card"><h2>${ic("history", "h")} Недавние решения</h2><div class="list">${recent.map(e => `<div class="it"><span>${esc(kidById(e.kid)?.name || "")}: ${esc(e.title)}<br><small>${fmtDate(e.dec.decidedAt || e.at)}</small></span><span class="pill ${e.status === "ok" ? "ok" : e.status === "no" ? "no" : "wait"}">${{ ok: "принято", no: "отклонено", redo: "доработка", pending: "повторно" }[e.status]}</span><button class="btn sm ghost" data-act="undo" data-id="${e.id}">Отменить</button></div>`).join("")}</div></section>`;
  setTimeout(loadPhotos, 0);
  return out;
}
async function loadPhotos() {
  for (const el of document.querySelectorAll("[data-photo]")) {
    const id = el.dataset.photo; if (S.photos[id]) continue;
    try { const d = await S.be.getPhoto(id); S.photos[id] = d || ""; } catch (_) { S.photos[id] = ""; }
    if (S.photos[id]) el.outerHTML = `<button class="ph" data-act="zoom" data-id="${id}" aria-label="${tr("Открыть фото")}"><img src="${S.photos[id]}" alt=""></button>`;
    else el.textContent = tr("фото удалено");
  }
}
function taskMeta(t) {
  const parts = [`+${t.pts}`, CATS[t.cat]?.n];
  if (t.bound) {
    const sc = t.schedule || {};
    parts.push(sc.mode === "workdays" ? "рабочие дни" : sc.mode === "offdays" ? "выходные" : ((sc.days || []).length === 7 ? (sc.skipOff ? "каждый будний день" : "каждый день") : (sc.days || []).map(d => DOW[d - 1]).join(" ") + (sc.skipOff ? ", кроме выходных" : "")));
    if (t.time) parts.push(`${ic("clock", "xs")} ${t.time}${t.deadline === "strict" ? ` строго +${t.grace ?? 30} мин` : t.deadline === "late" ? ` позже ${t.latePct ?? 50}%` : ""}${t.repeat ? ` ${ic("repeat", "xs")} ${t.repeat} мин` : ""}`);
  } else parts.push(t.freq === "week" ? `${t.times || 1} р. в неделю` : FREQ[t.freq]);
  if (t.who && t.who !== "all") parts.push(esc(kidById(t.who)?.name || ""));
  if (t.checklist?.length) parts.push(`${ic("check-square", "xs")} ${t.checklist.length}`);
  if (t.photo) parts.push(`${ic("camera", "xs")} фото`);
  return parts.join(" · ");
}
function parentTasks() {
  const all = F.live(S.cfg.tasks);
  const on = all.filter(t => t.active !== false).length;
  const sel = S.selKind === "tasks" ? S.sel : null;
  if (sel) for (const id of [...sel]) if (!S.cfg.tasks[id] || S.cfg.tasks[id].del) sel.delete(id);
  let out = sel
    ? `<section class="card"><div class="card-head"><h2>${ic("check-square", "h")} Выбор дел</h2><span class="hint">выбрано ${sel.size}</span></div>
      <p class="hint">Нажимайте на дела, которые нужно удалить. В каждом разделе есть кнопка «Все».</p></section>`
    : `<section class="card"><div class="card-head"><h2>${ic("checklist", "h")} Дела</h2><span class="hint">${all.length ? `включено ${on} из ${all.length}` : "список пуст"}</span></div>
    <div class="btnrow"><button class="btn go" data-act="tplTasks">${ic("layers")} Из шаблонов</button><button class="btn" data-act="taskForm" data-cat="mb">${ic("plus")} Своё дело</button>${all.length ? `<button class="btn ghost" data-act="selMode" data-id="tasks">${ic("check-square")} Выбрать</button>` : ""}${on ? `<button class="btn ghost" data-act="allOff">Выключить все</button>` : ""}</div>
    <p class="hint">Порядок меняется перетаскиванием за ${ic("grip", "xs")} — в таком же порядке дела увидят дети. Удалить дело — смахните его влево. Выключенные дела остаются на своём месте, дети их не видят, напоминания по ним не приходят.</p></section>`;
  if (!all.length) return out + `<div class="empty big">${ic("checklist")}<b>Список дел пуст</b><span>Выберите готовые дела из шаблонов или создайте свои.</span><button class="btn go" data-act="tplTasks">${ic("layers")} Открыть шаблоны</button></div>`;
  const hints = { mb: "Привязаны к дням. По ним приходят напоминания, пропуски видны в календаре.", ob: "Привязаны к дням, но по желанию.", mu: "Нужно сделать N раз за неделю в любой день.", ou: "Можно делать когда угодно ради баллов." };
  out += ["mb", "mu", "ob", "ou"].map(c => {
    const list = all.filter(t => F.category(t) === c);
    const allSel = sel && list.length && list.every(t => sel.has(t.id));
    const headBtn = sel
      ? (list.length ? `<button class="btn sm ghost" data-act="selAll" data-cat="${c}">${allSel ? "Снять" : "Все"}</button>` : "")
      : `<button class="btn sm ghost icon" data-act="taskForm" data-cat="${c}" aria-label="Добавить дело">${ic("plus")}</button>`;
    const row = t => {
      const icon = `<span class="ic cat-${t.cat}">${ic(CATS[t.cat]?.ic || "star")}</span>`, text = `<div class="t"><b>${esc(t.title)}</b><small>${taskMeta(t)}</small></div>`;
      if (sel) { const on = sel.has(t.id); return `<div class="row-edit trow pick ${on ? "on" : ""} ${t.active === false ? "off" : ""}" data-act="selTask" data-id="${t.id}" role="checkbox" aria-checked="${on}" tabindex="0"><span class="pbox">${ic("check")}</span>${icon}${text}</div>`; }
      return `<div class="srow" data-id="${t.id}"><button class="swipe-del" data-act="swipeDel" data-kind="tasks" data-id="${t.id}" tabindex="-1">${ic("trash")}<span>Удалить</span></button><div class="row-edit trow ${t.active === false ? "off" : ""}"><button class="grip" data-drag aria-label="Перетащить: ${esc(t.title)}">${ic("grip")}</button>${icon}${text}
        <button class="sw" role="switch" aria-checked="${t.active !== false}" data-act="taskToggle" data-id="${t.id}" aria-label="${t.active !== false ? "Выключить" : "Включить"}: ${esc(t.title)}"></button>
        <button class="btn sm ghost icon" data-act="taskForm" data-id="${t.id}" aria-label="Изменить: ${esc(t.title)}">${ic("pencil")}</button></div></div>`;
    };
    return `<section class="card"><div class="card-head"><h2>${F.CATEGORY_NAMES[c]}</h2>${headBtn}</div>
      <p class="hint">${hints[c]}</p>
      ${list.length ? `<div class="sortable" data-cat="${c}">${list.map(row).join("")}</div>` : `<div class="empty slim">Пока пусто</div>`}</section>`;
  }).join("");
  if (sel) out += selBar(sel);
  return out;
}
/* ---------- поддержка: переписка внутри приложения ---------- */
const thr = r => r.thread || [{ from: "user", text: r.text || "", at: r.at }];
const lastOf = r => { const t = thr(r); return t[t.length - 1] || {}; };
const userUnread = r => lastOf(r).from === "support" && lastOf(r).at > (r.userSeenAt || 0);
const adminUnread = r => lastOf(r).from === "user" && lastOf(r).at > (r.adminSeenAt || 0);
const mySupport = () => (S.support || []).filter(r => r.uid === S.user?.uid && !r.userDeleted).sort((a, b) => (b.updatedAt || b.at) - (a.updatedAt || a.at));
const adminList = () => (S.support || []).filter(r => !r.adminDeleted);
const supportBadge = () => isParent() ? mySupport().filter(userUnread).length + (S.isAdmin ? adminList().filter(r => r.uid !== S.user.uid && adminUnread(r)).length : 0) : 0;
let stopSupport = () => {};
window.__fqState = () => ({ parent: isParent(), admin: S.isAdmin, support: (S.support || []).length, loaded: S.loaded, started: !!S._supStarted, err: S._supErr || null });
function startSupport() {
  S._supStarted = Date.now(); stopSupport(); S.support = []; S.isAdmin = false;
  if (!isParent() || !S.be.watchSupport) return;
  S.be.isAdmin(S.user).then(a => { S.isAdmin = a; rerender(); stopSupport = S.be.watchSupport(S.user, a, list => { S.support = list; rerender(); }); }).catch(e => { S._supErr = String(e && e.message || e); });
}
function supStatus(r, admin) {
  if (admin ? adminUnread(r) : userUnread(r)) return `<span class="pill no">${admin ? "ждёт ответа" : "новый ответ"}</span>`;
  return lastOf(r).from === "support" ? `<span class="pill ok">есть ответ</span>` : `<span class="pill wait">${admin ? "ждёт ответа" : "ждёт ответа поддержки"}</span>`;
}
function supRow(r, admin) {
  return `<div class="srow sup" data-id="${r.id}"><button class="swipe-del" data-act="supDel" data-id="${r.id}" data-admin="${admin ? 1 : ""}" tabindex="-1">${ic("trash")}<span>Удалить</span></button><div class="row-edit sup-in"><button class="set-row" data-act="setPage" data-id="${admin ? "adm:" : "sup:"}${r.id}"><span class="tile ${(admin ? adminUnread(r) : userUnread(r)) ? "c-gold" : "c-gray"}">${ic("inbox")}</span>
    <span class="t"><b>${esc(r.subject)}</b><small>${admin ? esc((r.name || r.email || "") + " · " + (r.family || "")) + " · " : ""}${fmtDate(r.updatedAt || r.at)}</small><span class="st">${supStatus(r, admin)}</span></span>${ic("chev-r", "chev")}</button></div></div>`;
}
function supThread(r, admin) {
  const msgs = thr(r).map(m => { const mine = admin ? m.from === "support" : m.from === "user";
    return `<div class="msg ${mine ? "me" : ""}"><small class="who">${m.from === "support" ? "Поддержка Family Quests" : admin ? esc(r.name || r.email || "Пользователь") : "Вы"} · ${fmtDate(m.at)}</small><div class="txt">${esc(m.text).replace(/\n/g, "<br>")}</div></div>`; }).join("");
  if (admin ? adminUnread(r) : userUnread(r)) setTimeout(() => S.be.supportSeen(r.id, admin).catch(() => {}), 600);
  return `<section class="card"><div class="card-head"><h2>${esc(r.subject)}</h2>${supStatus(r, admin)}<button class="btn sm ghost icon danger" data-act="supDel" data-id="${r.id}" data-admin="${admin ? 1 : ""}" aria-label="Удалить запрос">${ic("trash")}</button></div>
    ${admin ? `<p class="hint">${esc(r.name || "")} · ${esc(r.email || "")} · семья «${esc(r.family || "")}» · версия ${esc(r.app || "?")} · язык ${esc(r.lang || "ru")}</p>` : ""}
    <div class="msgs">${msgs}</div>
    <form class="grid" data-form="sup-reply" data-sid="${r.id}" data-admin="${admin ? 1 : ""}"><label class="full">${admin ? "Ответ пользователю" : "Дописать в запрос"}<textarea id="sr-text" name="text" maxlength="4000" required rows="4" placeholder="${admin ? "Ваш ответ увидит только автор запроса." : "Уточнение или новый вопрос по этой теме."}"></textarea></label>
    <div class="full"><button class="btn go">${ic("inbox")} Отправить</button></div></form></section>`;
}
function selBar(sel) { return `<div class="selbar"><button class="btn ghost" data-act="selMode">Отмена</button><button class="btn no" data-act="selDel" ${sel.size ? "" : "disabled"}>${ic("trash")} Удалить (${sel.size})</button></div><div class="selbar-pad"></div>`; }
/* Свайп влево по делу — кнопка «Удалить», как в iPhone. */
let swOpen = null;
function closeSwipe(except) { if (swOpen && swOpen !== except) { swOpen.querySelector(".row-edit").style.transform = ""; swOpen.classList.remove("open"); swOpen = null; } }
document.addEventListener("pointerdown", e => {
  const row = e.target.closest(".srow > .row-edit");
  if (!row) { if (swOpen && !e.target.closest(".swipe-del")) closeSwipe(); return; }
  { const blk = e.target.closest("[data-drag],button,input,select,a"); if (blk && !blk.matches(".srow.sup .set-row") && !(swOpen && swOpen === row.parentElement)) { closeSwipe(); return; } }
  const wrap = row.parentElement, W = 92, x0 = e.clientX, y0 = e.clientY, base = wrap === swOpen ? -W : 0;
  let mode = null, dx = base;
  closeSwipe(wrap);
  const move = ev => {
    const mx = ev.clientX - x0, my = ev.clientY - y0;
    if (!mode) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; mode = Math.abs(mx) > Math.abs(my) ? "x" : "y"; if (mode === "x") { row.style.transition = "none"; try { row.setPointerCapture(ev.pointerId); } catch (_) {} } }
    if (mode !== "x") return;
    dx = Math.min(0, base + mx); if (dx < -W) dx = -W - (-W - dx) * .3;
    row.style.transform = `translateX(${dx}px)`;
  };
  const up = () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
    row.style.transition = "";
    if (mode === "x") {
      const open = dx < -W / 2;
      row.style.transform = open ? `translateX(${-W}px)` : ""; wrap.classList.toggle("open", open); swOpen = open ? wrap : null;
      const block = ev => { ev.stopPropagation(); ev.preventDefault(); }; row.addEventListener("click", block, { capture: true, once: true }); setTimeout(() => row.removeEventListener("click", block, { capture: true }), 50);
    } else if (!mode && base) { row.style.transform = ""; wrap.classList.remove("open"); swOpen = null; }
  };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
});
/* Перетаскивание дел внутри раздела (мышь и палец). */
document.addEventListener("pointerdown", e => {
  const h = e.target.closest("[data-drag]"); if (!h || e.button > 0) return;
  closeSwipe(); const row = h.closest(".srow"), list = row.parentElement;
  e.preventDefault();
  try { h.setPointerCapture(e.pointerId); } catch (_) {}
  S.drag = true;
  const before = [...list.children].map(r => r.dataset.id);
  const grab = e.clientY - row.getBoundingClientRect().top;
  let curT = 0, lastY = e.clientY, raf = 0;
  row.classList.add("dragging"); list.classList.add("sorting");
  const place = () => {
    const y = lastY - grab, mid = y + row.offsetHeight / 2;
    // Двигаем соседей, а не саму строку: перенос перетаскиваемого узла в DOM сбрасывает захват указателя.
    for (let k = 0; k < 50; k++) {
      const prev = row.previousElementSibling;
      if (!prev) break; const r = prev.getBoundingClientRect(); if (mid >= r.top + r.height / 2) break;
      list.insertBefore(prev, row.nextElementSibling);
    }
    for (let k = 0; k < 50; k++) {
      const next = row.nextElementSibling;
      if (!next) break; const r = next.getBoundingClientRect(); if (mid <= r.top + r.height / 2) break;
      list.insertBefore(next, row);
    }
    const lt = row.getBoundingClientRect().top - curT;
    const lr = list.getBoundingClientRect();
    curT = Math.max(lr.top - lt - 6, Math.min(lr.bottom - lt - row.offsetHeight + 6, y - lt));
    row.style.transform = `translateY(${curT}px)`;
  };
  const scroller = () => {
    if (!S.drag) return;
    const edge = 90, vh = window.innerHeight;
    if (lastY < edge) { window.scrollBy(0, -Math.ceil((edge - lastY) / 6)); place(); }
    else if (lastY > vh - edge - 70) { window.scrollBy(0, Math.ceil((lastY - (vh - edge - 70)) / 6)); place(); }
    raf = requestAnimationFrame(scroller);
  };
  raf = requestAnimationFrame(scroller);
  const move = ev => { lastY = ev.clientY; place(); };
  const up = () => {
    if (!S.drag) return;
    h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up);
    document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
    cancelAnimationFrame(raf);
    row.style.transform = ""; row.classList.remove("dragging"); list.classList.remove("sorting");
    const ids = [...list.children].map(r => r.dataset.id);
    S.drag = false;
    if (ids.join() !== before.join()) {
      const coll = list.dataset.kind === "wishes" ? "wishes" : "tasks";
      let os = ids.map(id => S.cfg[coll][id]?.o || 0).sort((a, b) => a - b);
      if (new Set(os).size !== os.length) os = ids.map((_, i) => (os[0] || Date.now()) + i);
      const map = {};
      ids.forEach((id, i) => { if ((S.cfg[coll][id]?.o || 0) !== os[i]) { map[id] = { o: os[i] }; S.cfg[coll][id].o = os[i]; } });
      if (Object.keys(map).length) S.be.setFamily({ [coll]: map }).catch(fail);
    }
    if (renderPending) rerender();
  };
  h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
  document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
});
/* Просмотр фото: на весь экран, листание, увеличение щипком, двойным касанием, колёсиком и кнопками. */
function openViewer(srcs, start = 0) {
  if (!srcs.length) return;
  document.querySelector(".viewer")?.remove();
  let idx = Math.min(start, srcs.length - 1), sc = 1, tx = 0, ty = 0;
  const v = document.createElement("div"); v.className = "viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true"); v.setAttribute("aria-label", tr("Фото-отчёт"));
  const many = srcs.length > 1, desk = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const fsOk = desk && !!(document.fullscreenEnabled && v.requestFullscreen);
  v.innerHTML = `<div class="vw-stage"><img class="vw-img" alt="${tr("Фото-отчёт")}" draggable="false"></div>
    <div class="vw-top"><span class="vw-count num"></span><span class="vw-tr">${fsOk ? `<button class="vw-btn" data-v="fs" aria-label="${tr("Во весь экран")}" title="${tr("Во весь экран")}">${ic("expand")}</button>` : ""}<button class="vw-btn" data-v="close" aria-label="${tr("Закрыть")}">${ic("x")}</button></span></div>
    ${many ? `<button class="vw-btn vw-nav prev" data-v="prev" aria-label="${tr("Предыдущее фото")}">${ic("chev-l")}</button><button class="vw-btn vw-nav next" data-v="next" aria-label="${tr("Следующее фото")}">${ic("chev-r")}</button>` : ""}
    <div class="vw-bar"><button class="vw-btn" data-v="out" aria-label="${tr("Уменьшить")}">${ic("minus")}</button><button class="vw-btn vw-pct num" data-v="reset" aria-label="${tr("Исходный размер")}">100%</button><button class="vw-btn" data-v="in" aria-label="${tr("Увеличить")}">${ic("plus")}</button></div>`;
  const stage = v.querySelector(".vw-stage"), img = v.querySelector(".vw-img"), cnt = v.querySelector(".vw-count"), pct = v.querySelector(".vw-pct");
  const clamp = () => {
    if (sc <= 1) { sc = 1; tx = 0; ty = 0; return; }
    const r = stage.getBoundingClientRect(), w = img.offsetWidth * sc, h = img.offsetHeight * sc;
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
    tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
  };
  const apply = (anim) => { clamp(); img.style.transition = anim ? "transform .2s ease" : "none"; img.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; pct.textContent = Math.round(sc * 100) + "%"; v.classList.toggle("zoomed", sc > 1); };
  // Увеличение вокруг точки (cx, cy) в координатах экрана.
  const zoomAt = (ns, cx, cy, anim) => {
    ns = Math.max(1, Math.min(6, ns));
    const r = stage.getBoundingClientRect(), ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
    tx = ox - (ox - tx) * ns / sc; ty = oy - (oy - ty) * ns / sc; sc = ns; apply(anim);
  };
  // Вписываем фото в окно целиком (маленькие снимки растягиваются), на компьютере — почти на весь экран.
  const fit = () => {
    const nw = img.naturalWidth, nh = img.naturalHeight; if (!nw || !nh) return;
    const W = stage.clientWidth - (desk ? (many ? 136 : 32) : 24), H = stage.clientHeight - (desk ? 120 : 140);
    const k = Math.max(0.05, Math.min(W / nw, H / nh));
    img.style.width = Math.round(nw * k) + "px"; img.style.height = Math.round(nh * k) + "px"; apply(false);
  };
  img.addEventListener("load", fit);
  v.addEventListener("fullscreenchange", () => { const b = v.querySelector("[data-v=fs]"); if (b) { const on = document.fullscreenElement === v; b.innerHTML = ic(on ? "collapse" : "expand"); b.setAttribute("aria-label", tr(on ? "Выйти из полноэкранного режима" : "Во весь экран")); b.title = b.getAttribute("aria-label"); } });
  const onResize = () => fit();
  window.addEventListener("resize", onResize);
  const center = () => { const r = stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const show = i => { idx = (i + srcs.length) % srcs.length; sc = 1; tx = ty = 0; img.src = srcs[idx]; cnt.textContent = many ? `${idx + 1} / ${srcs.length}` : ""; apply(false); };
  const close = () => { if (document.fullscreenElement === v) document.exitFullscreen?.().catch(() => {}); v.remove(); document.removeEventListener("keydown", key, true); window.removeEventListener("resize", onResize); };
  const key = e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!document.fullscreenElement) close(); }
    else if (e.key === "ArrowRight" && many) show(idx + 1);
    else if (e.key === "ArrowLeft" && many) show(idx - 1);
    else if (e.key === "+" || e.key === "=") zoomAt(sc * 1.5, ...center(), true);
    else if (e.key === "-") zoomAt(sc / 1.5, ...center(), true);
    else if ((e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") && fsOk) v.querySelector("[data-v=fs]").click();
  };
  document.addEventListener("keydown", key, true);
  v.addEventListener("click", e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    const a = b.dataset.v;
    if (a === "fs") { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else v.requestFullscreen().catch(() => {}); return; }
    if (a === "close") close(); else if (a === "prev") show(idx - 1); else if (a === "next") show(idx + 1);
    else if (a === "in") zoomAt(sc * 1.5, ...center(), true); else if (a === "out") zoomAt(sc / 1.5, ...center(), true); else if (a === "reset") zoomAt(1, ...center(), true);
  });
  stage.addEventListener("wheel", e => { e.preventDefault(); zoomAt(sc * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY, false); }, { passive: false });
  // Указатели: один палец/мышь — сдвиг или листание, два пальца — щипок.
  const pts = new Map(); let start0 = null, pinch = null, lastTap = 0, moved = false;
  stage.addEventListener("pointerdown", e => {
    if (e.target.closest("[data-v]")) return;
    stage.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { start0 = { x: e.clientX, y: e.clientY, tx, ty }; moved = false; }
    if (pts.size === 2) { const [p1, p2] = [...pts.values()]; pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), sc, cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2, tx, ty }; start0 = null; moved = true; }
  });
  stage.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [p1, p2] = [...pts.values()], d = Math.hypot(p1.x - p2.x, p1.y - p2.y), cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      sc = pinch.sc; tx = pinch.tx + (cx - pinch.cx); ty = pinch.ty + (cy - pinch.cy);
      zoomAt(pinch.sc * d / pinch.d, cx, cy, false); return;
    }
    if (!start0) return;
    const dx = e.clientX - start0.x, dy = e.clientY - start0.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    if (sc > 1) { tx = start0.tx + dx; ty = start0.ty + dy; apply(false); }
    else if (many) { img.style.transition = "none"; img.style.transform = `translateX(${dx}px)`; }
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) { pinch = null; const rest = [...pts.values()].at(0); start0 = rest ? { x: rest.x, y: rest.y, tx, ty } : null; if (sc < 1.05) zoomAt(1, ...center(), true); } return; }
    if (!start0) return;
    const dx = e.clientX - start0.x, dy = e.clientY - start0.y; start0 = null;
    if (sc <= 1 && many && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { show(idx + (dx < 0 ? 1 : -1)); return; }
    if (sc <= 1 && Math.abs(dy) > 120 && Math.abs(dy) > Math.abs(dx)) { close(); return; }
    if (sc <= 1) apply(true);
    if (moved || e.type === "pointercancel") return;
    const now = Date.now();
    if (now - lastTap < 300) { lastTap = 0; zoomAt(sc > 1 ? 1 : 2.5, e.clientX, e.clientY, true); return; }
    lastTap = now;
    // Одно касание по фону (не по фото) закрывает просмотр.
    const r = img.getBoundingClientRect(), inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    setTimeout(() => { if (lastTap === now && sc <= 1 && !inside) close(); }, 300);
  };
  stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
  stage.addEventListener("dblclick", e => e.preventDefault());
  v.tabIndex = -1; document.body.appendChild(v); show(idx); v.focus({ preventScroll: true });
}
function templatePicker({ title, hint, groups, used, onAdd }) {
  const rows = [];
  modal(`<div class="sub-head"><h2>${ic("layers", "h")} ${title}</h2></div><p class="hint">${hint}</p>
    ${groups.map(g => `<h3>${g.title}</h3><div class="tpls">${g.items.map(it => { rows.push(it); const done = used.has(it.key); return `<label class="tpl ${done ? "done" : ""}"><input type="checkbox" data-tpl="${it.key}" ${done ? "disabled checked" : ""}>${it.icon}<span class="t"><b>${esc(it.title)}</b><small>${it.meta}${done ? " · уже добавлено" : ""}</small></span><span class="pts num">${it.pts}</span></label>`; }).join("")}</div>`).join("")}
    <div class="btns sticky"><button class="btn ghost" data-act="closeModal">Отмена</button><button class="btn go" id="tpl-add" disabled>Выберите шаблоны</button></div>`,
  m => {
    const btn = m.querySelector("#tpl-add");
    const picked = () => [...m.querySelectorAll("input[data-tpl]:checked:not(:disabled)")].map(i => i.dataset.tpl);
    m.addEventListener("change", () => { const n = picked().length; btn.disabled = !n; btn.textContent = tr(n ? `Добавить (${n})` : "Выберите шаблоны"); });
    btn.onclick = () => { const keys = picked(); onAdd(keys.map(k => rows.find(r => r.key === k))); closeModal(); };
  }, "wide");
}
function taskTemplates() {
  const used = new Set(F.live(S.cfg.tasks).map(t => t.tpl).filter(Boolean));
  const items = [];
  TASK_TEMPLATES.forEach(tp => (tp.perKid ? kidsList() : [null]).forEach(k => {
    const t = tplTask(tp, k);
    items.push({ key: t.tpl, cat: F.category(t), t, title: t.title + (k ? ` · ${k.name}` : ""), meta: taskMeta(t).replace(/^\+\d+ · /, ""), pts: "+" + t.pts, icon: `<span class="ic cat-${t.cat}">${ic(CATS[t.cat].ic)}</span>` });
  }));
  const groups = ["mb", "mu", "ob", "ou"].map(c => ({ title: F.CATEGORY_NAMES[c], items: items.filter(i => i.cat === c) })).filter(g => g.items.length);
  templatePicker({ title: "Шаблоны дел", hint: "Отметьте подходящие дела. После добавления любое можно изменить: баллы, время, для кого.", groups, used,
    onAdd: list => { let o = Date.now(); const map = {}; list.forEach(it => { const id = uid("t"); map[id] = { ...it.t, id, o: o++, since: today() }; });
      S.be.setFamily({ tasks: map }).then(() => toast(`Добавлено дел: ${list.length}`)).catch(fail); } });
}
function wishTemplates() {
  const used = new Set(F.live(S.cfg.wishes).map(w => w.tpl).filter(Boolean));
  const items = WISH_TEMPLATES.map(([tpl, title, cost]) => ({ key: tpl, title, cost, meta: "для всех детей", pts: `${coin(14)} ${cost}`, icon: `<span class="ic cat-gold">${ic("gift")}</span>` }));
  templatePicker({ title: "Шаблоны наград", hint: "Отметьте награды для магазина желаний. Цену и название можно поменять позже.", groups: [{ title: "Награды", items }], used,
    onAdd: list => { let o = Date.now(); const map = {}; list.forEach(it => { const id = uid("w"); map[id] = { id, o: o++, tpl: it.key, title: it.title, cost: it.cost, who: "all", del: false }; });
      S.be.setFamily({ wishes: map }).then(() => toast(`Добавлено наград: ${list.length}`)).catch(fail); } });
}
function parentRewards() {
  const kids = kidsList();
  const giftCard = !kids.length || (S.sel && S.selKind === "wishes") ? "" : `<section class="card"><h2>${ic("coins", "h")} Подарить баллы</h2><p class="hint">Ребёнок увидит радостное сообщение с вашими словами. Баллы сразу можно тратить.</p>
    <form class="grid" data-form="gift"><label>Кому<select id="g-kid" name="kid">${kids.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></label>
    <label>Сколько баллов<input id="g-pts" name="pts" type="number" inputmode="numeric" min="1" value="20" required></label>
    <label class="full">Сообщение<input id="g-msg" name="msg" placeholder="Например: Спасибо, что помог бабушке!" maxlength="200"></label>
    <div><button class="btn go">Подарить</button></div></form>
    <details><summary>Бонус или списание без поздравления</summary><form class="grid" data-form="bonus"><label>Кому<select id="b-kid" name="kid">${kids.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></label>
    <label>Баллы (минус — списать)<input id="b-pts" name="pts" type="number" inputmode="numeric" value="-10" required></label><label class="full">Причина<input id="b-why" name="why" required></label><div><button class="btn dark">Применить</button></div></form></details></section>`;
  let out = giftCard;
  const wishes = F.live(S.cfg.wishes);
  const wsel = S.selKind === "wishes" ? S.sel : null;
  if (wsel) for (const id of [...wsel]) if (!S.cfg.wishes[id] || S.cfg.wishes[id].del) wsel.delete(id);
  const wrow = w => {
    const icon = `<span class="ic cat-gold">${ic("gift")}</span>`, text = `<div class="t"><b>${esc(w.title)}</b><small class="num">${coin(13)} ${w.cost} · ${w.who === "all" ? "всем" : esc(kidById(w.who)?.name || "")}</small></div>`;
    if (wsel) { const on = wsel.has(w.id); return `<div class="row-edit trow pick ${on ? "on" : ""}" data-act="selTask" data-id="${w.id}" role="checkbox" aria-checked="${on}" tabindex="0"><span class="pbox">${ic("check")}</span>${icon}${text}</div>`; }
    return `<div class="srow" data-id="${w.id}"><button class="swipe-del" data-act="swipeDel" data-kind="wishes" data-id="${w.id}" tabindex="-1">${ic("trash")}<span>Удалить</span></button><div class="row-edit trow w">${wishes.length > 1 ? `<button class="grip" data-drag aria-label="Перетащить: ${esc(w.title)}">${ic("grip")}</button>` : "<span></span>"}${icon}${text}<button class="btn sm ghost icon" data-act="wishForm" data-id="${w.id}" aria-label="Изменить: ${esc(w.title)}">${ic("pencil")}</button></div></div>`;
  };
  if (wsel) out = `<section class="card"><div class="card-head"><h2>${ic("check-square", "h")} Выбор наград</h2><span class="hint">выбрано ${wsel.size}</span></div>
      <p class="hint">Нажимайте на награды, которые нужно удалить. Кнопка «Все» выбирает весь магазин.</p></section>`;
  if (!wsel) out += `<section class="card"><div class="card-head"><h2>${ic("gift", "h")} Магазин желаний</h2><span class="hint">${wishes.length ? `наград: ${wishes.length}` : "список пуст"}</span></div>
    <div class="btnrow"><button class="btn go" data-act="tplWishes">${ic("layers")} Из шаблонов</button><button class="btn" data-act="wishForm">${ic("plus")} Своя награда</button>${wishes.length ? `<button class="btn ghost" data-act="selMode" data-id="wishes">${ic("check-square")} Выбрать</button>` : ""}${wishes.length > 1 ? `<button class="btn ghost" data-act="sortWishes">${ic("coins")} По цене</button>` : ""}</div>
    <p class="hint">Порядок меняется перетаскиванием за ${ic("grip", "xs")} — в таком же порядке награды увидят дети. Удалить награду — смахните её влево.</p></section>`;
  if (!wishes.length) return out + `<div class="empty big">${ic("gift")}<b>Магазин пуст</b><span>Выберите готовые награды из шаблонов или создайте свои.</span><button class="btn go" data-act="tplWishes">${ic("layers")} Открыть шаблоны</button></div>`;
  out += `<section class="card"><div class="card-head"><h2>Награды</h2>${wsel ? `<button class="btn sm ghost" data-act="selAllW">${wishes.every(w => wsel.has(w.id)) ? "Снять" : "Все"}</button>` : ""}</div>
    <p class="hint">Дети обменивают на них баллы. Цена — в баллах.</p>
    <div class="sortable" data-kind="wishes">${wishes.map(wrow).join("")}</div></section>`;
  if (wsel) out += selBar(wsel);
  return out;
}
function photoLabel(d) { return { 7: "1 неделя", 14: "2 недели", 30: "1 месяц", 90: "3 месяца" }[d] || `${d} ${plural(d, "день", "дня", "дней")}`; }
function langOptions() {
  return `<div class="lang-opts">${[["ru", "RU", "Русский"], ["en", "EN", "English"]].map(([c, f, n]) => `<button class="lang-opt" data-act="setLang" data-id="${c}" aria-pressed="${I18N.lang() === c}"><span class="flag">${f}</span><span data-noi18n>${n}</span>${I18N.lang() === c ? ic("check") : ""}</button>`).join("")}</div>`;
}
const pushOn = () => { try { return "Notification" in window && Notification.permission === "granted" && lsGet("fq-push") === "1"; } catch (_) { return false; } };
function pushState() { try { if (!("Notification" in window)) return "Не поддерживаются этим браузером"; if (Notification.permission === "denied") return "Запрещены в настройках браузера"; return pushOn() ? "Включены на этом устройстве" : "Выключены"; } catch (_) { return "Выключены"; } }
function parentSettings() {
  if (S.setPage) return settingsPage(S.setPage);
  const st = S.cfg.settings || {};
  const row = (page, icn, color, title, sub, danger) => `<button class="set-row ${danger ? "danger" : ""}" data-act="setPage" data-id="${page}"><span class="tile c-${color}">${ic(icn)}</span><span class="t"><b>${title}</b><small>${sub}</small></span>${ic("chev-r", "chev")}</button>`;
  const kidNames = kidsList().map(k => k.name).join(", ") || "Не добавлены";
  const n = S.members.length;
  const me = S.me?.name || S.user.displayName || "Родитель";
  return `<section class="profile">${avatar(me, S.me?.avatar, "lg edit", "", `data-act="avatarEdit" aria-label="Фото профиля"`, "button")}<span class="t"><b>${esc(me)}</b><small>${esc(S.user.email || "")}</small><small>Семья «${esc(S.cfg.name || "")}» · родитель</small></span></section>
    <div class="set-group"><h3>Семья</h3><div class="set-list">
      ${row("members", "users", "blue", "Участники и приглашения", `${n} ${plural(n, "участник", "участника", "участников")} · пригласить по коду`)}
      ${row("kids", "smile", "violet", "Дети", esc(kidNames))}
    </div></div>
    <div class="set-group"><h3>Правила</h3><div class="set-list">
      ${row("points", "trophy", "gold", "Баллы", `Зачисление в ${esc(F.creditTime(S.cfg))}, трата после воскресенья`)}
      ${row("check", "camera", "rose", "Проверка и фото", `Фото хранятся ${photoLabel(photoDays())}`)}
    </div></div>
    <div class="set-group"><h3>Это устройство</h3><div class="set-list">
      ${row("notify", "bell", "green", "Уведомления", pushState())}
      ${row("lang", "globe", "blue", "Язык", I18N.lang() === "en" ? "English" : "Русский")}
    </div></div>
    <div class="set-group"><h3>Помощь</h3><div class="set-list">
      ${row("support", "inbox", "green", "Поддержка", mySupport().some(userUnread) ? "Есть новый ответ" : "Вопрос, ошибка или идея — ответим здесь, в приложении")}
    </div></div>
    ${S.isAdmin ? `<div class="set-group"><h3>Администрирование</h3><div class="set-list">
      ${row("admin-support", "inbox", "gold", "Запросы пользователей", (() => { const n = adminList().filter(adminUnread).length; return n ? `ждут ответа: ${n}` : "новых нет"; })())}
    </div></div>` : ""}
    <div class="set-group"><h3>Аккаунт</h3><div class="set-list">
      ${S.families.length > 1 ? `<button class="set-row" data-act="switchFamily"><span class="tile c-gray">${ic("users")}</span><span class="t"><b>Сменить семью</b><small>У вас ${S.families.length} ${plural(S.families.length, "семья", "семьи", "семей")}</small></span>${ic("chev-r", "chev")}</button>` : ""}
      <button class="set-row" data-act="signOut"><span class="tile c-gray">${ic("logout")}</span><span class="t"><b>Выйти из аккаунта</b><small>${esc(S.user.email || "")}</small></span></button>
    </div></div>
    <div class="set-group"><h3>Опасная зона</h3><div class="set-list">
      ${row("danger", "trash", "red", "Удалить семью", "Все дела, баллы, история и участники", true)}
    </div></div>
    <p class="version">${appIcon(20)} Family Quests · версия ${APP_VERSION} от ${APP_DATE}</p>`;
}
function settingsPage(p) {
  const st = S.cfg.settings || {};
  const head = title => `<div class="sub-head"><button class="btn ghost icon" data-act="setPage" data-id="" aria-label="Назад к настройкам">${ic("chev-l")}</button><h2>${title}</h2></div>`;
  if (p === "members") {
    const members = S.members.slice().sort((a, b) => (a.role === "parent" ? 0 : 1) - (b.role === "parent" ? 0 : 1));
    return head("Участники и приглашения") + `<section class="card"><h2>${ic("users", "h")} Участники</h2><div>${members.map(m => `<div class="row-edit w">${avatar(m.name || m.email, m.avatar, "sm", m.role === "child" ? `background:${kidColor(kidById(m.kidId))}` : "")}<div class="t"><b>${esc(m.name || m.email || "Без имени")}${m.uid === S.user.uid ? " (вы)" : ""}</b><small>${m.role === "parent" ? "родитель" : "ребёнок: " + esc(kidById(m.kidId)?.name || "?")} · ${esc(m.email || "")}</small><small>${(m.tokens || []).length ? `${ic("bell", "xs")} уведомления включены` : "без уведомлений"}</small></div>
      ${m.uid !== S.user.uid ? `<button class="btn sm ghost icon danger" data-act="removeMember" data-id="${m.uid}" aria-label="Удалить ${esc(m.name || "")}">${ic("trash")}</button>` : "<span></span>"}</div>`).join("")}</div></section>
      <section class="card"><h2>${ic("plus", "h")} Пригласить</h2><div class="btnrow"><button class="btn go" data-act="inviteWho">${ic("plus")} Пригласить в семью</button></div>
      <p class="hint">Код действует 7 дней. Ребёнку нужен свой Google-аккаунт (для детей до 13 лет — через Google Family Link).</p></section>`;
  }
  if (p === "kids") return head("Дети") + `<section class="card"><form class="grid" data-form="kids">${kidsList().map(k => `
      <div class="full kid-head">${avatar(k.name, kidMember(k)?.avatar, "sm", `background:${kidColor(k)}`)}<b>${esc(k.name)}</b><button type="button" class="btn sm ghost" data-act="preview" data-id="${k.id}">Глазами ребёнка</button><button type="button" class="btn sm ghost icon danger" data-act="delKid" data-id="${k.id}" aria-label="Удалить ребёнка: ${esc(k.name)}">${ic("trash")}</button></div>
      <label>Имя<input id="kn-${k.id}" name="n-${k.id}" value="${esc(k.name)}" required></label>
      <label>Возраст<input id="ka-${k.id}" name="a-${k.id}" type="number" inputmode="numeric" min="3" max="18" value="${k.age || ""}"></label>
      <label>Цвет<select id="kc-${k.id}" name="c-${k.id}">${Object.keys(COLORS).map(c => `<option value="${c}" ${k.color === c ? "selected" : ""}>${{ violet: "Фиолетовый", teal: "Бирюзовый", rose: "Розовый", gold: "Золотой" }[c]}</option>`).join("")}</select></label>`).join("")}
      <div class="full btnrow"><button class="btn go">Сохранить</button><button type="button" class="btn ghost" data-act="addKid">${ic("plus")} Добавить ребёнка</button></div></form></section>`;
  if (p === "points") return head("Баллы") + `<section class="card"><form class="grid" data-form="set-points">
      <label>Время вечернего начисления<input id="s-ct" name="ct" type="time" value="${esc(st.creditTime || "21:00")}"></label>
      <div><button class="btn go">Сохранить</button></div></form>
      <ul class="facts"><li>${ic("check", "xs")} Баллы за принятые дела зачисляются каждый вечер в это время.</li><li>${ic("check", "xs")} Тратить их можно после воскресенья в это же время.</li><li>${ic("check", "xs")} Подарки и бонусы доступны сразу.</li><li>${ic("check", "xs")} Двойные баллы на конкретный день включаются в «Календаре».</li></ul></section>`;
  if (p === "check") return head("Проверка и фото") + `<section class="card"><form class="grid" data-form="set-check">
      <label>Хранить фото-отчёты<select id="s-ph" name="ph">${[[7, "1 неделю"], [14, "2 недели"], [30, "1 месяц"], [90, "3 месяца"], [0, "Свой срок…"]].map(([d, n]) => `<option value="${d}" ${(d === photoDays() && [7, 14, 30, 90].includes(d)) || (d === 0 && ![7, 14, 30, 90].includes(photoDays())) ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label id="s-phd-l" ${[7, 14, 30, 90].includes(photoDays()) ? "hidden" : ""}>Свой срок, дней<input id="s-phd" name="phd" type="number" inputmode="numeric" min="1" max="365" value="${photoDays()}"></label>
      <div class="full"><button class="btn go">Сохранить</button></div></form>
      <p class="hint">Фото старше выбранного срока удаляются автоматически раз в сутки. Фото заявок, которые ещё ждут проверки, не удаляются. Записи о делах и баллы остаются навсегда.</p></section>`;
  if (p === "notify") return head("Уведомления") + `<section class="card"><div class="state">${ic("bell", "h")} <b>${pushState()}</b></div>
      <p class="hint">Родителям приходят заявки на проверку, детям — напоминания об обязательных делах, подарки и одобренные желания. Уведомления включаются на каждом устройстве отдельно.</p>
      <p class="hint">На iPhone сначала добавьте приложение на экран «Домой»: «Поделиться» → «На экран „Домой“».</p>
      <div class="btnrow">${pushOn() ? `<button class="btn ghost" data-act="push">${ic("bell")} Выключить уведомления</button>` : `<button class="btn go" data-act="push">${ic("bell")} Включить уведомления</button>`}<button class="btn ghost" data-act="beep">Проверить звук</button></div></section>`;
  if (p === "lang") return head("Язык") + `<section class="card">${langOptions()}<p class="hint">Язык меняется только на этом устройстве. Уведомления на телефон тоже придут на выбранном языке.</p></section>`;
  const sub = (title, back) => `<div class="sub-head"><button class="btn ghost icon" data-act="setPage" data-id="${back}" aria-label="Назад">${ic("chev-l")}</button><h2>${title}</h2></div>`;
  if (p === "support") {
    const mine = mySupport();
    return head("Поддержка") + `<section class="card"><h2>${ic("plus", "h")} Новый запрос</h2><form class="grid" data-form="support">
      <label class="full">Тема<input id="sp-subj" name="subj" maxlength="120" required placeholder="Например: не приходят уведомления"></label>
      <label class="full">Описание<textarea id="sp-text" name="text" maxlength="4000" required rows="5" placeholder="Опишите, что произошло: что вы делали, что ожидали и что получилось. Укажите телефон и браузер, если это ошибка."></textarea></label>
      <div class="full"><button class="btn go">${ic("inbox")} Отправить</button></div></form>
      <p class="hint">Ответ появится здесь, в приложении, и придёт уведомлением на телефон.</p></section>
      <div class="set-group"><h3>Мои запросы</h3>${mine.length ? `<div class="set-list sup-list">${mine.map(r => supRow(r, false)).join("")}</div><p class="hint">Чтобы удалить запрос, смахните его влево.</p>` : `<div class="empty slim">Вы ещё не писали в поддержку.</div>`}</div>`;
  }
  if (p.startsWith("sup:")) { const r = mySupport().find(x => x.id === p.slice(4)); return sub("Запрос в поддержку", "support") + (r ? supThread(r, false) : `<div class="empty">Загрузка…</div>`); }
  if (p === "admin-support" && S.isAdmin) {
    const all = adminList().slice().sort((a, b) => (adminUnread(b) - adminUnread(a)) || ((b.updatedAt || b.at) - (a.updatedAt || a.at)));
    return head("Запросы пользователей") + `<p class="hint">Вы видите запросы всех семей как администратор поддержки. Пользователи видят ответы от имени «Поддержка Family Quests» — ваш адрес им не показывается.</p>
      ${all.length ? `<div class="set-list sup-list">${all.map(r => supRow(r, true)).join("")}</div><p class="hint">Чтобы удалить запрос из списка, смахните его влево. У пользователя он останется, пока он сам его не удалит.</p>` : `<div class="empty">Запросов пока нет.</div>`}`;
  }
  if (p.startsWith("adm:") && S.isAdmin) { const r = adminList().find(x => x.id === p.slice(4)); return sub("Запрос пользователя", "admin-support") + (r ? supThread(r, true) : `<div class="empty">Загрузка…</div>`); }
  if (p === "danger") return head("Удалить семью") + `<section class="card danger-card"><div class="state">${ic("trash", "h")} <b>Это действие нельзя отменить</b></div>
      <p>Будут удалены все дела, награды, баллы, история, фото и участники семьи «${esc(S.cfg.name || "")}». У второго родителя и детей семья тоже пропадёт.</p>
      <form class="grid" data-form="delFamily"><label class="full">Чтобы подтвердить, введите название семьи<input id="del-name" name="name" autocomplete="off" placeholder="${esc(S.cfg.name || "")}"></label>
      <div class="full"><button class="btn no big" id="del-btn">${ic("trash")} Удалить семью навсегда</button></div></form><p class="err" id="del-err"></p></section>`;
  S.setPage = null; return parentSettings();
}
/* ---------- формы родителя ---------- */
const whoOpts = sel => `<option value="all" ${sel === "all" ? "selected" : ""}>Всем детям</option>` + kidsList().map(k => `<option value="${k.id}" ${sel === k.id ? "selected" : ""}>${esc(k.name)}</option>`).join("");
function taskForm(id, cat) {
  const base = { title: "", cat: "home", pts: 10, who: "all", mandatory: cat ? cat[0] === "m" : true, bound: cat ? cat[1] === "b" : true, schedule: { mode: "workdays", days: [] }, time: "", deadline: "none", grace: 30, latePct: 50, repeat: 0, freq: "week", times: 1, checklist: [], photo: false, active: true };
  const t = JSON.parse(JSON.stringify(S.cfg.tasks[id] || base));
  t.schedule = t.schedule || { mode: "workdays", days: [] };
  modal(`<h2>${id ? "Изменить дело" : "Новое дело"}</h2><form class="grid" id="tf">
    <label class="full">Что сделать<input id="tf-title" name="title" required value="${esc(t.title)}"></label>
    <div class="full seg" role="group" aria-label="Обязательность"><button type="button" data-k="mandatory" data-v="1" aria-pressed="${!!t.mandatory}">Обязательное</button><button type="button" data-k="mandatory" data-v="0" aria-pressed="${!t.mandatory}">Дополнительное</button></div>
    <div class="full seg" role="group" aria-label="Привязка"><button type="button" data-k="bound" data-v="1" aria-pressed="${!!t.bound}">По дням недели</button><button type="button" data-k="bound" data-v="0" aria-pressed="${!t.bound}">Без привязки к дню</button></div>
    <div class="full grid" id="tf-bound">
      <label class="full">Когда<select id="tf-mode" name="mode"><option value="workdays">В рабочие (учебные) дни</option><option value="offdays">В выходные дни</option><option value="days">В выбранные дни недели</option></select></label>
      <div class="full dows" id="tf-dows">${DOW.map((d, i) => `<button type="button" data-dow="${i + 1}" aria-pressed="${t.schedule.days.includes(i + 1)}">${d}</button>`).join("")}</div>
      <label class="inline full" id="tf-skip-l"><input type="checkbox" id="tf-skip" name="skip" ${t.schedule.skipOff ? "checked" : ""}> Не показывать в выходные (суббота, воскресенье и дни, которые вы сделали выходными в «Календаре»)</label>
      <label>Время (напоминание)<input id="tf-time" name="time" type="time" value="${esc(t.time || "")}"></label>
      <label id="tf-rep-l">Повторять напоминание<select id="tf-rep" name="rep"><option value="0">Не повторять</option><option value="5">каждые 5 мин</option><option value="10">каждые 10 мин</option><option value="15">каждые 15 мин</option><option value="20">каждые 20 мин</option><option value="30">каждые 30 мин</option><option value="60">каждый час</option></select></label>
      <label>Если не успел ко времени<select id="tf-dl" name="dl"><option value="none">Можно сделать до конца дня</option><option value="strict">Строгий срок: потом нельзя</option><option value="late">Можно позже за часть баллов</option></select></label>
      <label id="tf-grace-l">Запас после времени, мин<input id="tf-grace" name="grace" type="number" inputmode="numeric" min="0" max="600" value="${t.grace ?? 30}"></label>
      <label id="tf-pct-l">Баллы за опоздание, %<input id="tf-pct" name="pct" type="number" inputmode="numeric" min="0" max="100" value="${t.latePct ?? 50}"></label>
      <p class="hint full">Напоминание придёт на телефон ребёнка за 5 минут до указанного времени (для обязательных дел). Повтор приходит, пока ребёнок не нажмёт «Готово!», но не после строгого срока и не после полуночи. Срок = время + запас; после него кнопка «Готово!» исчезает или меняется на «Сделал с опозданием».</p></div>
    <div class="full grid" id="tf-unbound">
      <label>Как часто<select id="tf-freq" name="freq"><option value="day">раз в день</option><option value="week">N раз в неделю</option><option value="many">сколько угодно</option><option value="once">один раз</option></select></label>
      <label>Сколько раз в неделю<input id="tf-times" name="times" type="number" inputmode="numeric" min="1" max="14" value="${t.times || 1}"></label></div>
    <label>Раздел<select id="tf-cat" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${t.cat === k ? "selected" : ""}>${v.n}</option>`).join("")}</select></label>
    <label>Баллы<input id="tf-pts" name="pts" type="number" inputmode="numeric" min="1" required value="${t.pts}"></label>
    <label>Для кого<select id="tf-who" name="who">${whoOpts(t.who)}</select></label>
    <label class="full">Чек-лист (каждый пункт с новой строки)<textarea id="tf-check" name="checklist" placeholder="Стол разобран&#10;Вещи в шкафу">${esc((t.checklist || []).join("\n"))}</textarea></label>
    <label class="inline full"><input id="tf-photo" name="photo" type="checkbox" ${t.photo ? "checked" : ""}> Нужен фото-отчёт</label>
    <label class="inline full"><input id="tf-active" name="active" type="checkbox" ${t.active !== false ? "checked" : ""}> Дело включено</label>
  </form><p class="err" id="tf-err"></p>
  <div class="btns">${id ? `<button class="btn no" id="tf-del">Удалить</button>` : ""}<button class="btn ghost" data-act="closeModal">Отмена</button><button class="btn dark" id="tf-save">Сохранить</button></div>`,
  m => {
    const f = m.querySelector("#tf"); f.mode.value = t.schedule.mode || "workdays"; f.freq.value = t.freq || "week"; f.dl.value = t.deadline || "none"; f.rep.value = String(t.repeat || 0);
    const sync = () => {
      m.querySelector("#tf-bound").hidden = !t.bound; m.querySelector("#tf-unbound").hidden = t.bound;
      m.querySelector("#tf-dows").hidden = f.mode.value !== "days"; m.querySelector("#tf-skip-l").hidden = f.mode.value !== "days";
      f.times.parentElement.hidden = f.freq.value !== "week";
      const hasT = !!f.time.value; f.dl.parentElement.hidden = !hasT; m.querySelector("#tf-rep-l").hidden = !hasT || !t.mandatory;
      m.querySelector("#tf-grace-l").hidden = !hasT || f.dl.value === "none"; m.querySelector("#tf-pct-l").hidden = !hasT || f.dl.value !== "late";
      m.querySelectorAll("[data-k]").forEach(b => b.setAttribute("aria-pressed", String(!!t[b.dataset.k] === (b.dataset.v === "1"))));
    };
    m.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { t[b.dataset.k] = b.dataset.v === "1"; sync(); });
    m.querySelectorAll("[data-dow]").forEach(b => b.onclick = () => { const d = +b.dataset.dow; const i = t.schedule.days.indexOf(d); i >= 0 ? t.schedule.days.splice(i, 1) : t.schedule.days.push(d); b.setAttribute("aria-pressed", String(i < 0)); });
    f.mode.onchange = sync; f.freq.onchange = sync; f.dl.onchange = sync; f.time.oninput = sync; sync();
    const save = () => {
      if (!f.reportValidity()) return;
      if (t.bound && f.mode.value === "days" && !t.schedule.days.length) { m.querySelector("#tf-err").textContent = tr("Выберите хотя бы один день недели."); return; }
      const tid = id || uid("t");
      const prev = S.cfg.tasks[id];
      const task = { id: tid, o: prev?.o ?? Date.now(), del: false, tpl: prev?.tpl || "", since: !prev || (prev.active === false && f.active.checked) ? today() : (prev.since || ""), title: f.title.value.trim(), cat: f.cat.value, pts: Math.max(1, parseInt(f.pts.value) || 1), who: f.who.value,
        mandatory: !!t.mandatory, bound: !!t.bound, schedule: { mode: f.mode.value, days: t.schedule.days.slice().sort(), skipOff: f.mode.value === "days" && f.skip.checked }, time: t.bound ? f.time.value : "", deadline: t.bound && f.time.value ? f.dl.value : "none", grace: Math.max(0, parseInt(f.grace.value) || 0), repeat: t.mandatory && f.time.value ? parseInt(f.rep.value) || 0 : 0, latePct: Math.min(100, Math.max(0, parseInt(f.pct.value) || 0)),
        freq: t.bound ? "day" : f.freq.value, times: Math.max(1, parseInt(f.times.value) || 1),
        checklist: f.checklist.value.split("\n").map(x => x.trim()).filter(Boolean), photo: f.photo.checked, active: f.active.checked };
      S.be.setFamily({ tasks: { [tid]: task } }).then(() => toast("Дело сохранено")).catch(fail); closeModal();
    };
    m.querySelector("#tf-save").onclick = save; f.onsubmit = e => { e.preventDefault(); save(); };
    const del = m.querySelector("#tf-del"); if (del) del.onclick = () => ask(`Удалить «${t.title}»?`, "Удалить", () => S.be.setFamily({ tasks: { [id]: { ...S.cfg.tasks[id], del: true } } }).then(() => toast("Дело удалено")).catch(fail), true);
  });
}
function wishForm(id) {
  const w = S.cfg.wishes[id] || { title: "", cost: 100, who: "all" };
  modal(`<h2>${id ? "Изменить желание" : "Новое желание"}</h2><form class="grid" id="wf">
    <label class="full">Награда<input id="wf-title" name="title" required value="${esc(w.title)}"></label>
    <label>Цена в баллах<input id="wf-cost" name="cost" type="number" inputmode="numeric" min="1" required value="${w.cost}"></label>
    <label>Для кого<select id="wf-who" name="who">${whoOpts(w.who)}</select></label></form>
    <div class="btns">${id ? `<button class="btn no" id="wf-del">Удалить</button>` : ""}<button class="btn ghost" data-act="closeModal">Отмена</button><button class="btn dark" id="wf-save">Сохранить</button></div>`,
  m => {
    const f = m.querySelector("#wf");
    const save = () => { if (!f.reportValidity()) return; const wid = id || uid("w");
      S.be.setFamily({ wishes: { [wid]: { id: wid, o: w.o ?? Date.now(), del: false, title: f.title.value.trim(), cost: Math.max(1, parseInt(f.cost.value) || 1), who: f.who.value } } }).then(() => toast("Желание сохранено")).catch(fail); closeModal(); };
    m.querySelector("#wf-save").onclick = save; f.onsubmit = e => { e.preventDefault(); save(); };
    const del = m.querySelector("#wf-del"); if (del) del.onclick = () => ask(`Удалить «${w.title}»?`, "Удалить", () => S.be.setFamily({ wishes: { [id]: { ...w, del: true } } }).catch(fail), true);
  });
}
function wishApprove(e) {
  const k = kidById(e.kid);
  modal(`<h2>Выдать награду</h2><p class="hint">${esc(k?.name || "")} получит «${esc(e.title)}». Спишется ${ptsW(e.value)}. Ребёнок увидит праздничное сообщение.</p>
    <label>Сообщение ребёнку (необязательно)<textarea id="wish-note" placeholder="Например: В субботу идём в кино!"></textarea></label>
    <div class="btns"><button class="btn ghost" data-act="closeModal">Отмена</button><button class="btn ok" id="wish-ok">Выдать</button></div>`,
  m => { m.querySelector("#wish-ok").onclick = () => { decide(e, "ok", m.querySelector("#wish-note").value.trim()); closeModal(); }; });
}
function redoForm(e) {
  const pre = "";
  modal(`<h2>На доработку</h2><p class="hint">«${esc(e.title)}». Ребёнок увидит текст как замечание проверки.</p>
    <label>Что исправить<textarea id="redo-note" placeholder="Например: на столе ещё лежат тетради.">${esc(pre)}</textarea></label>
    <div class="btns"><button class="btn ghost" data-act="closeModal">Отмена</button><button class="btn go" id="redo-ok">Отправить на доработку</button></div>`,
  m => { const ta = m.querySelector("#redo-note"); ta.focus();
    m.querySelector("#redo-ok").onclick = () => { decide(e, "redo", ta.value.trim()); closeModal(); }; });
}
function decide(e, status, note, instant) {
  const dec = { status, note: note ?? "", decidedAt: Date.now(), instant: !!(instant && status === "ok") };
  S.instant.delete(e.id);
  S.be.putDecision(e.doc, e.id, dec).then(() => toast(status === "ok" ? (e.type === "wish" ? "Награда выдана" : dec.instant ? `Принято: +${e.value}, сразу в банк` : `Принято: +${e.value}`) : status === "redo" ? "Отправлено на доработку" : e.type === "wish" ? "Отказано, баллы вернулись" : "Не засчитано")).catch(fail);
}
function inviteWho(start) {
  const kids = kidsList();
  const page = who => who === "child"
    ? `<div class="sub-head"><button class="btn sm ghost icon" id="iw-back" aria-label="Назад">${ic("chev-l")}</button><h2>Какого ребёнка?</h2></div>
      ${kids.length ? `<div class="set-list">${kids.map(k => `<button class="set-row" data-act="invite" data-id="${k.id}">${avatar(k.name, kidMember(k)?.avatar, "sm", `background:${kidColor(k)}`)}<span class="t"><b>${esc(k.name)}</b><small>${S.members.some(m => m.kidId === k.id) ? "уже вошёл — можно пригласить на другое устройство" : "ещё не вошёл"}</small></span>${ic("chev-r", "chev")}</button>`).join("")}</div>`
        : `<div class="empty">Сначала добавьте ребёнка.<button class="btn sm go" data-act="goSet" data-id="kids">${ic("plus")} Добавить ребёнка</button></div>`}`
    : `<h2>Кого приглашаем?</h2><div class="set-list">
      <button class="set-row" data-act="invite" data-id="parent"><span class="tile c-blue">${ic("users")}</span><span class="t"><b>Родителя</b><small>Полный доступ: дела, проверка, награды, настройки</small></span>${ic("chev-r", "chev")}</button>
      <button class="set-row" id="iw-child"><span class="tile c-violet">${ic("smile")}</span><span class="t"><b>Ребёнка</b><small>Видит только свои дела, баллы и награды</small></span>${ic("chev-r", "chev")}</button></div>`;
  modal(`<div id="iw" class="iw">${page(start === "child" ? "child" : "")}</div><div class="btns"><button class="btn ghost" data-act="closeModal">Отмена</button></div>`, m => {
    const box = m.querySelector("#iw");
    const bind = () => { const c = box.querySelector("#iw-child"); if (c) c.onclick = () => { box.innerHTML = page("child"); I18N.apply(box); bind(); };
      const b = box.querySelector("#iw-back"); if (b) b.onclick = () => { box.innerHTML = page(""); I18N.apply(box); bind(); }; };
    bind();
  });
}
function showInvite(role, kidId) {
  modal(`<h2>Код приглашения</h2><p class="hint">Создаю код…</p>`, async m => {
    try {
      const code = await S.be.createInvite(S.user, role === "parent" ? "parent" : "child", role === "parent" ? null : kidId);
      const link = location.origin + "/?join=" + code;
      const who = role === "parent" ? "второго родителя" : kidById(kidId)?.name;
      m.innerHTML = `<h2>Приглашение для: ${esc(who)}</h2><div class="code">${code}</div>
        <p class="hint">Откройте ссылку на устройстве ${role === "parent" ? "второго родителя" : "ребёнка"} и войдите через Google. Или войдите и введите код вручную. Код действует 7 дней.</p>
        <input id="inv-link" readonly value="${esc(link)}"><div class="btns"><button class="btn ghost" data-act="closeModal">Закрыть</button><button class="btn dark" id="inv-copy">Скопировать ссылку</button></div>`;
      I18N.apply(m);
      m.querySelector("#inv-copy").onclick = () => { const i = m.querySelector("#inv-link"); navigator.clipboard?.writeText(link).then(() => toast("Ссылка скопирована"), () => { i.select(); toast("Выделено — скопируйте"); }); };
    } catch (e) { fail(e); closeModal(); }
  });
}

/* ---------- ребёнок: отправка дела ---------- */
/** Квадратное фото профиля 256×256. */
async function squareAvatar(file) {
  let img;
  try { img = await createImageBitmap(file); }
  catch (_) { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const side = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = 256;
  c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
  return c.toDataURL("image/jpeg", .82);
}
function avatarEditor() {
  const name = S.me?.name || S.user.displayName || "", cur = S.me?.avatar;
  modal(`<h2>Фото профиля</h2><div class="av-preview">${avatar(name, cur, "xl", viewingKid() && !isParent() ? `background:${kidColor(kidById(viewingKid()))}` : "")}</div>
    <p class="hint">Фото видят участники вашей семьи вместо буквы в кружке.</p>
    <div class="btns"><label class="btn go">${ic("camera")} ${cur ? "Заменить фото" : "Загрузить фото"}<input type="file" id="av-in" accept="image/*" hidden></label>
    ${cur ? `<button class="btn no" id="av-del">${ic("trash")} Удалить фото</button>` : ""}<button class="btn ghost" data-act="closeModal">Закрыть</button></div>`,
  m => {
    m.querySelector("#av-in").onchange = async ev => { const f = ev.target.files[0]; if (!f || !f.type.startsWith("image/")) return;
      try { const data = await squareAvatar(f); await S.be.updateMember(S.user.uid, { avatar: data }); closeModal(); toast("Фото обновлено"); } catch (e) { fail(e); } };
    const del = m.querySelector("#av-del"); if (del) del.onclick = () => S.be.updateMember(S.user.uid, { avatar: null }).then(() => { closeModal(); toast("Фото удалено"); }).catch(fail);
  });
}
async function shrink(file, max, q) {
  let img;
  try { img = await createImageBitmap(file); }
  catch (_) { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  let data = c.toDataURL("image/jpeg", q);
  while (data.length > 600000 && q > .35) { q -= .1; data = c.toDataURL("image/jpeg", q); }
  return data;
}
// Ребёнок может забрать заявку, пока её не проверили (кроме повторной отправки после доработки).
const canWithdraw = e => !!e && e.status === "pending" && !e.dec?.status && !e.resent && !isParent() && e.kid === viewingKid();
function submitTask(t, entryId) {
  const kid = viewingKid(), s = today();
  const old = entryId && S.data.entries.find(e => e.id === entryId);
  const dl = F.deadline(t, s, S.cfg);
  if (!old && dl && dl.phase === "closed") { toast("Время для этого дела вышло"); return; }
  const lateInfo = !old && dl && dl.phase === "late" ? { late: true, latePct: dl.pct } : {};
  const mk = extra => ({ id: uid(), kid, type: "task", ref: t.id, title: t.title, pts: t.pts, day: s, at: Date.now(), checks: [], photos: [], resent: false, ...lateInfo, ...extra });
  const save = entry => S.be.putEntry(kid, entry.day.slice(0, 7), entry);
  if (!t.checklist?.length && !t.photo && !old) {
    if (S.sending.has(t.id)) return; S.sending.add(t.id);
    save(mk({})).then(() => toast("Отправлено на проверку")).catch(fail).finally(() => setTimeout(() => S.sending.delete(t.id), 800)); return; }
  const picked = [];
  modal(`<h2>${esc(t.title)}</h2>
    ${t.checklist?.length ? `<p class="hint">Отметь всё, что сделано:</p><div class="checks">${t.checklist.map((c, i) => `<label class="chk"><input type="checkbox" id="ck-${i}" data-c="${i}"> ${esc(c)}</label>`).join("")}</div>` : ""}
    <p class="hint">${t.photo ? "Сфотографируй результат — родитель посмотрит фото. До 3 снимков." : "Фото можно добавить по желанию."}</p><div class="photos" id="phs"></div>
    <p class="err" id="sub-err"></p><div class="btns"><button class="btn ghost" data-act="closeModal">Отмена</button><button class="btn go" id="sub-ok">Отправить на проверку</button></div>`,
  m => {
    const box = m.querySelector("#phs");
    const draw = () => {
      box.innerHTML = picked.map((p, i) => `<div class="ph"><img src="${p.url}" alt="" data-view="${i}"><button class="x" data-rm="${i}" aria-label="Убрать фото">×</button></div>`).join("") + (picked.length < 3 ? `<label class="addph">${ic("camera")}<span>Добавить фото</span><input type="file" id="ph-in" accept="image/*" multiple></label>` : "");
      const inp = box.querySelector("#ph-in"); if (inp) inp.onchange = () => { for (const f of inp.files) if (picked.length < 3 && f.type.startsWith("image/")) picked.push({ file: f, url: URL.createObjectURL(f) }); draw(); };
      box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { picked.splice(+b.dataset.rm, 1); draw(); });
      box.querySelectorAll("[data-view]").forEach(im => im.onclick = () => openViewer(picked.map(x => x.url), +im.dataset.view));
    };
    draw();
    const ok = m.querySelector("#sub-ok"), err = m.querySelector("#sub-err");
    ok.onclick = async () => {
      if ([...m.querySelectorAll("[data-c]")].some(b => !b.checked)) { err.textContent = tr("Сначала выполни и отметь все пункты списка."); return; }
      if (t.photo && !picked.length) { err.textContent = tr("Добавь хотя бы одно фото — без него проверка не пройдёт."); return; }
      ok.disabled = true; ok.textContent = tr("Отправляю…"); err.textContent = "";
      try {
        const photos = [];
        for (const p of picked) { const id = uid("p"); await S.be.putPhoto(id, { data: await shrink(p.file, 1024, .72), kid, at: Date.now() }); photos.push(id); }
        const entry = old ? { ...stripEntry(old), at: Date.now(), checks: t.checklist || [], photos, resent: true } : mk({ checks: t.checklist || [], photos });
        await save(entry); closeModal(); toast("Отправлено на проверку");
      } catch (e) { ok.disabled = false; ok.textContent = tr("Отправить на проверку"); err.textContent = tr("Не получилось отправить. Проверь интернет и попробуй ещё раз."); console.error(e); }
    };
  });
}
const stripEntry = e => { const { status, dec, value, doc, ...rest } = e; return rest; };

setInterval(() => { if (viewingKid() && S.tab === "today" && !document.querySelector(".scrim")) rerender(); }, 60000);

/* ====================== СОБЫТИЯ ====================== */
document.addEventListener("change", e => { const c = e.target.closest?.("[data-instant]"); if (!c) return; c.checked ? S.instant.add(c.dataset.instant) : S.instant.delete(c.dataset.instant); c.blur(); });
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "closeModal") { if (e.target === el) closeModal(); return; }
  if (act === "tab") { S.tab = id; S.setPage = null; S.sel = null; S.selKind = null; window.scrollTo(0, 0); render(); return; }
  if (act === "setLang") {
    I18N.setLang(id);
    if (S.user && S.me && S.be && !S.be.demo) S.be.updateMember(S.user.uid, { lang: id }).catch(() => {});
    if (document.querySelector(".scrim")) closeModal();
    render(); return;
  }
  if (act === "setPage") { S.setPage = id || null; window.scrollTo(0, 0); render(); return; }
  if (act === "goSet") { if (document.querySelector(".scrim")) closeModal(); S.tab = "settings"; S.setPage = id || null; window.scrollTo(0, 0); render(); return; }
  if (act === "tplTasks") return taskTemplates();
  if (act === "tplWishes") return wishTemplates();
  if (act === "supDel") { const r = (S.support || []).find(x => x.id === id); if (!r) return; const admin = !!el.dataset.admin;
    ask(`Удалить запрос «${r.subject}»?` + (admin && r.uid !== S.user.uid ? " У пользователя он останется." : ""), "Удалить", () => { swOpen = null;
      S.be.supportDelete(r, admin, S.user.uid).then(() => { toast("Запрос удалён"); if (S.setPage && S.setPage.endsWith(r.id)) { S.setPage = admin ? "admin-support" : "support"; render(); } }).catch(fail); }, true); return; }
  if (act === "swipeDel") { const kind = el.dataset.kind === "wishes" ? "wishes" : "tasks", t = S.cfg[kind]?.[id]; if (!t) return;
    ask(`Удалить «${t.title}»?`, "Удалить", () => { swOpen = null; S.be.setFamily({ [kind]: { [id]: { del: true } } }).then(() => toast(kind === "wishes" ? "Награда удалена" : "Дело удалено")).catch(fail); }, true); return; }
  if (act === "delKid") { const k = kidById(id); if (!k) return;
    ask(`Удалить ребёнка «${k.name}»? Пропадут его личные дела и награды, а его аккаунт отключится от семьи. Общие дела останутся.`, "Удалить", async () => {
      try {
        const tasks = {}, wishes = {};
        F.live(S.cfg.tasks).forEach(t => { if (t.who === k.id) tasks[t.id] = { del: true }; });
        F.live(S.cfg.wishes).forEach(w => { if (w.who === k.id) wishes[w.id] = { del: true }; });
        const patch = { kids: kidsList().filter(x => x.id !== k.id) };
        if (Object.keys(tasks).length) patch.tasks = tasks; if (Object.keys(wishes).length) patch.wishes = wishes;
        await S.be.setFamily(patch);
        await Promise.all(S.members.filter(m => m.role !== "parent" && m.kidId === k.id).map(m => S.be.removeMember(m.uid || m.id)));
        if (S.preview === k.id) S.preview = null;
        toast(`${k.name}: удалено`);
      } catch (e) { fail(e); }
    }, true); return; }
  if (act === "selMode") { if (S.sel || !id) { S.sel = null; S.selKind = null; } else { S.sel = new Set(); S.selKind = id; } render(); return; }
  if (act === "selTask") { if (!S.sel) return; S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); render(); return; }
  if (act === "sortWishes") { const list = F.live(S.cfg.wishes); if (list.length < 2) return;
    ask("Отсортировать награды по цене — от дешёвых к дорогим?", "Отсортировать", () => {
      const sorted = list.slice().sort((a, b) => a.cost - b.cost || (a.o || 0) - (b.o || 0));
      let os = list.map(w => w.o || 0).sort((a, b) => a - b); if (new Set(os).size !== os.length) os = sorted.map((_, i) => (os[0] || Date.now()) + i);
      const map = {}; sorted.forEach((w, i) => { if ((w.o || 0) !== os[i]) map[w.id] = { o: os[i] }; });
      if (!Object.keys(map).length) return toast("Награды отсортированы по цене");
      S.be.setFamily({ wishes: map }).then(() => toast("Награды отсортированы по цене")).catch(fail);
    }); return; }
  if (act === "selAllW") { if (!S.sel) return; const list = F.live(S.cfg.wishes); const all = list.every(w => S.sel.has(w.id)); list.forEach(w => all ? S.sel.delete(w.id) : S.sel.add(w.id)); render(); return; }
  if (act === "selAll") { if (!S.sel) return; const list = F.live(S.cfg.tasks).filter(t => F.category(t) === el.dataset.cat); const all = list.every(t => S.sel.has(t.id)); list.forEach(t => all ? S.sel.delete(t.id) : S.sel.add(t.id)); render(); return; }
  if (act === "selDel") { const ids = [...(S.sel || [])]; if (!ids.length) return;
    const kind = S.selKind === "wishes" ? "wishes" : "tasks", what = kind === "wishes" ? "награды" : "дела";
    ask(`Удалить выбранные ${what} (${ids.length})?`, "Удалить", () => { const map = {}; ids.forEach(i => { map[i] = { del: true }; }); S.sel = null; S.selKind = null;
      S.be.setFamily({ [kind]: map }).then(() => toast(kind === "wishes" ? `Удалено наград: ${ids.length}` : `Удалено дел: ${ids.length}`)).catch(fail); }, true); return; }
  if (act === "taskToggle") { const t = S.cfg.tasks[id]; if (!t) return; const on = t.active === false;
    S.be.setFamily({ tasks: { [id]: { ...t, active: on, ...(on ? { since: today() } : {}) } } }).then(() => toast(on ? "Дело включено" : "Дело выключено")).catch(fail); return; }
  if (act === "allOff") { ask("Выключить все дела?", "Выключить", () => { const map = {}; F.live(S.cfg.tasks).forEach(t => { if (t.active !== false) map[t.id] = { ...t, active: false }; });
    S.be.setFamily({ tasks: map }).then(() => toast("Все дела выключены")).catch(fail); }, true); return; }
  if (act === "signIn") return S.be.signIn().catch(err => toast("Не удалось войти: " + (err.message || err.code)));
  if (act === "signOut") return S.be.signOut();
  if (act === "demoRole") { const uidMap = { parent: "demo-parent", k1: "demo-k1", k2: "demo-k2" }; S.user = { ...S.user, uid: uidMap[id] }; S.me = S.members.find(m => m.uid === S.user.uid); S.preview = null; S.tab = null; S.prevStatus = null; recompute(); render(); return; }
  if (act === "preview") { S.preview = id; S.tab = "today"; window.scrollTo(0, 0); render(); return; }
  if (act === "endPreview") { S.preview = null; S.tab = "settings"; S.setPage = "kids"; render(); return; }
  if (act === "avatarEdit") { avatarEditor(); return; }
  if (act === "kidMenu") { modal(`<section class="profile">${avatar(S.user.displayName, S.me?.avatar, "lg edit", `background:${kidColor(kidById(viewingKid()))}`, `data-act="avatarEdit" aria-label="Фото профиля"`, "button")}<span class="t"><b>${esc(S.user.displayName || "")}</b><small>${esc(S.user.email || "")}</small></span></section>
    <div class="set-list"><button class="set-row" data-act="push"><span class="tile c-green">${ic("bell")}</span><span class="t"><b>Уведомления</b><small>${pushState()}</small></span></button><button class="set-row" data-act="setLang" data-id="${I18N.lang() === "en" ? "ru" : "en"}"><span class="tile c-blue">${ic("globe")}</span><span class="t"><b>Язык</b><small data-noi18n>${I18N.lang() === "en" ? "English → Русский" : "Русский → English"}</small></span></button><button class="set-row" data-act="signOut"><span class="tile c-gray">${ic("logout")}</span><span class="t"><b>Выйти</b><small>${esc(S.user.email || "")}</small></span></button></div>
    <p class="version">${appIcon(20)} Family Quests · версия ${APP_VERSION}</p>`); return; }
  if (act === "withdraw") { const en = S.data.entries.find(x => x.id === id); if (!canWithdraw(en)) return;
    ask(en.type === "wish" ? `Отменить заявку на «${en.title}»?` : `Отменить «${en.title}»? Дело снова станет невыполненным.`, "Отменить", () => {
      const { status, dec, value, doc, ...raw } = en;
      S.be.putEntry(en.kid, doc.slice(en.kid.length + 1), { ...raw, withdrawn: true, withdrawnAt: Date.now() }).then(() => toast("Заявка отменена")).catch(fail);
    }); return; }
  if (act === "done") { const t = S.cfg.tasks[id]; if (t) submitTask(t, el.dataset.entry); return; }
  if (act === "wish") {
    const w = S.cfg.wishes[id], kid = viewingKid(); if (!w) return;
    ask(`Обменять ${ptsW(w.cost)} на «${w.title}»?`, "Обменять", () => {
      if (acct(kid).available < w.cost) return toast("Не хватает баллов");
      S.be.putEntry(kid, F.monthKey(), { id: uid(), kid, type: "wish", ref: w.id, title: w.title, pts: w.cost, day: today(), at: Date.now() }).then(() => toast("Заявка отправлена родителям")).catch(fail);
    }); return;
  }
  if (act === "approve" || act === "reject") { const en = S.data.entries.find(x => x.id === id); if (!en) return; if (act === "approve" && en.type === "wish") return wishApprove(en); decide(en, act === "approve" ? "ok" : "no", undefined, act === "approve" && S.instant.has(id)); return; }
  if (act === "redo") { const en = S.data.entries.find(x => x.id === id); if (en) redoForm(en); return; }
  if (act === "undo") { const en = S.data.entries.find(x => x.id === id); if (en) S.be.putDecision(en.doc, en.id, { status: "", note: "", decidedAt: Date.now() }).then(() => toast("Решение отменено — заявка снова на проверке")).catch(fail); return; }
  if (act === "zoom") { const ids = [...(el.closest(".photos")?.querySelectorAll("[data-act=zoom]") || [el])].map(b => b.dataset.id); openViewer(ids.map(x => S.photos[x]).filter(Boolean), Math.max(0, ids.indexOf(id))); return; }
  if (act === "taskForm") return taskForm(id, el.dataset.cat);
  if (act === "wishForm") return wishForm(id);
  if (act === "credit") {
    const t = S.cfg.tasks[id], kid = el.dataset.kid, s = S.selDay; if (!t) return;
    ask(`Засчитать «${t.title}» за ${humanDay(s)}?`, "Засчитать", async () => {
      const e2 = { id: uid(), kid, type: "task", ref: t.id, title: t.title, pts: t.pts, day: s, at: Date.now(), checks: [], photos: [], resent: false, manual: true };
      try { await S.be.putEntry(kid, s.slice(0, 7), e2); await S.be.putDecision(kid + "_" + s.slice(0, 7), e2.id, { status: "ok", note: "", decidedAt: Date.now() }); toast(`Засчитано: +${t.pts * F.mult(S.cfg, s, t.id)}`); } catch (err) { fail(err); }
    }); return;
  }
  if (act === "selDay") { S.selDay = id; render(); return; }
  if (act === "calKid") { S.calKid = id; render(); return; }
  if (act === "calPrev" || act === "calNext") { const [y, m] = S.calMonth.split("-").map(Number); S.calMonth = F.monthKey(new Date(y, m - 1 + (act === "calNext" ? 1 : -1), 1)); render(); return; }
  if ((act === "dayType" || act === "dayX2") && S.selDay < today()) return toast("Прошедший день менять нельзя");
  if (act === "dayType") { S.be.setFamily({ days: { [S.selDay]: { type: id } } }).then(() => toast(id === "auto" ? "День как обычно" : id === "off" ? "День сделан выходным" : "День сделан рабочим")).catch(fail); return; }
  if (act === "dayX2") { const cur = (S.cfg.days?.[S.selDay]?.x2 || []).slice(); const i = cur.indexOf(id); i >= 0 ? cur.splice(i, 1) : cur.push(id); S.be.setFamily({ days: { [S.selDay]: { x2: cur } } }).then(() => toast(i >= 0 ? "Двойные баллы сняты" : "В этот день баллы ×2")).catch(fail); return; }
  if (act === "inviteWho") return inviteWho(id);
  if (act === "invite") return showInvite(id === "parent" ? "parent" : "child", id);
  if (act === "removeMember") { const mm = S.members.find(x => x.uid === id); ask(`Удалить ${mm?.name || mm?.email || "участника"} из семьи?`, "Удалить", () => S.be.removeMember(id).then(() => toast("Участник удалён")).catch(fail), true); return; }
  if (act === "push") {
    if (pushOn()) { ask("Выключить уведомления на этом устройстве?", "Выключить", () => S.be.disablePush(S.user).then(() => { toast("Уведомления выключены"); if (document.querySelector(".scrim")) closeModal(); render(); }).catch(fail)); return; }
    S.be.enablePush(S.user).then(() => { toast("Уведомления включены"); beep("good"); if (document.querySelector(".scrim")) closeModal(); render(); }, err => toast(err.message || "Не удалось включить уведомления")); return; }
  if (act === "beep") return beep("alert");
  if (act === "addKid") { const n = kidsList().length + 1; const k = { id: "k" + Date.now().toString(36), since: today(), name: "Ребёнок " + n, age: 10, color: ["violet", "teal", "rose", "gold"][n % 4] }; S.be.setFamily({ kids: [...kidsList(), k] }).then(() => toast("Ребёнок добавлен — укажите имя")).catch(fail); return; }
  if (act === "switchFamily" || act === "leaveFamily") {
    if (act === "leaveFamily" && S.fid && !S.be.demo) { S.be.leaveFamilyRef(S.user, S.fid).catch(() => {}); S.families = S.families.filter(x => x !== S.fid); }
    lsSet("fq-fid", null); S.fid = null; S.loaded = false; S.setPage = null; stopWatch(); boot2(true); return; }
});
document.addEventListener("submit", e => {
  const f = e.target; if (!f.dataset.form) return; e.preventDefault();
  const kind = f.dataset.form;
  if (kind === "join") { const code = f.code.value.trim().toUpperCase(); S.be.join(S.user, code).then(fid => { history.replaceState(null, "", "/"); openFamily(fid); }, err => toast(err.message || "Не удалось присоединиться", true)); return; }
  if (kind === "create") {
    const kids = [1, 2, 3].map(i => ({ n: f["k" + i].value.trim(), a: parseInt(f["a" + i].value) || 10 })).filter(x => x.n)
      .map((x, i) => ({ id: "k" + (i + 1), name: x.n, age: x.a, color: ["violet", "teal", "rose"][i] }));
    S.be.createFamily(S.user, f.name.value.trim(), kids, { tasks: {}, wishes: {}, days: {}, settings: defaultSettings() }).then(openFamily).catch(fail); return;
  }
  if (kind === "gift" || kind === "bonus") {
    const kid = f.kid.value, pts = parseInt(f.pts.value) || 0; if (!pts) return toast("Укажите баллы");
    const g = { id: uid("g"), kid, kind, pts: kind === "gift" ? Math.abs(pts) : pts, msg: (kind === "gift" ? f.msg.value : f.why.value).trim(), at: Date.now(), day: today() };
    S.be.putGift(kid + "_" + F.monthKey(), g).then(() => { toast(kind === "gift" ? `Подарок отправлен: +${g.pts}` : "Готово"); f.reset(); }).catch(fail); return;
  }
  if (kind === "kids") {
    const kids = kidsList().map(k => ({ ...k, name: f["n-" + k.id].value.trim() || k.name, age: parseInt(f["a-" + k.id].value) || k.age, color: f["c-" + k.id].value }));
    S.be.setFamily({ kids }).then(() => toast("Сохранено")).catch(fail); return;
  }
  const saved = () => toast("Сохранено");
  if (kind === "support") {
    const subject = f.subj.value.trim().slice(0, 120), text = f.text.value.trim().slice(0, 4000);
    if (!subject || !text) return toast("Заполните тему и описание");
    const last = +lsGet("fq-sp-last") || 0; if (Date.now() - last < 60e3) return toast("Подождите минуту перед следующим запросом");
    const btn = f.querySelector("button"); btn.disabled = true;
    S.be.sendSupport(S.user, { subject, text, family: S.cfg?.name || "", lang: I18N.lang(), app: APP_VERSION })
      .then(() => { lsSet("fq-sp-last", String(Date.now())); f.reset(); toast("Запрос отправлен в поддержку"); })
      .catch(fail).finally(() => { btn.disabled = false; });
    return;
  }
  if (kind === "sup-reply") {
    const text = f.text.value.trim().slice(0, 4000); if (!text) return;
    const btn = f.querySelector("button"); btn.disabled = true;
    S.be.supportMsg(f.dataset.sid, f.dataset.admin ? "support" : "user", text).then(() => { f.reset(); toast(f.dataset.admin ? "Ответ отправлен" : "Сообщение отправлено"); }).catch(fail).finally(() => { btn.disabled = false; });
    return;
  }
  if (kind === "set-points") S.be.setFamily({ settings: { creditTime: f.ct.value || "21:00" } }).then(saved).catch(fail);
  if (kind === "set-check") { const ph = +f.ph.value || Math.min(365, Math.max(1, parseInt(f.phd.value) || 14)); S.be.setFamily({ settings: { autoAI: false, photoDays: ph } }).then(saved).catch(fail); }
  if (kind === "delFamily") {
    const err = document.getElementById("del-err");
    if (f.name.value.trim().toLowerCase() !== String(S.cfg.name || "").trim().toLowerCase()) { err.textContent = tr("Название не совпадает. Введите его точно так же, как в настройках."); return; }
    const btn = document.getElementById("del-btn"); btn.disabled = true; btn.textContent = tr("Удаляю…"); err.textContent = "";
    const fid = S.fid; stopWatch();
    S.be.deleteFamily(S.user).then(() => {
      S.families = S.families.filter(x => x !== fid); lsSet("fq-fid", null); S.fid = null; S.cfg = null; S.loaded = false; S.setPage = null; S.tab = null;
      toast("Семья удалена"); boot2(true);
    }, e2 => { console.error(e2); btn.disabled = false; btn.textContent = tr("Удалить семью навсегда"); err.textContent = tr(e2.message && !e2.code ? e2.message : "Не получилось удалить. Проверьте интернет и попробуйте ещё раз."); openFamily(fid); });
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "s-ph") { const l = document.getElementById("s-phd-l"); if (l) l.hidden = e.target.value !== "0"; }
});
document.addEventListener("keydown", e => { if (document.querySelector(".viewer")) return; if (e.key === "Escape") closeModal(); });
window.addEventListener("fq-push", e => { toast((e.detail.title || "") + (e.detail.body ? ": " + e.detail.body : ""), true); beep("alert"); });

/* ====================== ЗАПУСК ====================== */
let stopWatch = () => {};
function openFamily(fid) {
  stopWatch(); S.fid = fid; S.loaded = false; S.prevStatus = null; S.preview = null; S.tab = null; lsSet("fq-fid", fid);
  if (!S.families.includes(fid)) S.families.push(fid);
  S.be.use(fid); render();
  let got = { family: false, members: false, kidlog: false, plog: false };
  const ready = () => { if (Object.values(got).every(Boolean) && !S.loaded) { S.loaded = true; recompute(); rerender(); startSupport(); } };
  stopWatch = S.be.watch({
    family: d => { S.cfg = d; got.family = true; if (got.kidlog) recompute(); ready(); if (S.loaded) rerender(); },
    members: list => { S.members = list; S.me = list.find(m => m.uid === S.user.uid) || null; got.members = true;
      if (S.me && !S.be.demo && S.me.lang !== I18N.lang()) S.be.updateMember(S.user.uid, { lang: I18N.lang() }).catch(() => {}); ready(); if (S.loaded) rerender(); },
    kidlog: list => { S.kidlogs = list; got.kidlog = true; if (S.loaded) { recompute(); rerender(); } else ready(); },
    plog: list => { S.plogs = list; got.plog = true; if (S.loaded) { recompute(); rerender(); } else ready(); },
    error: err => { console.error(err); if (err.code === "permission-denied") { S.me = null; S.loaded = true; render(); } },
  });
  S.be.resumePush?.();
  // родители раз в сессию чистят фото старше срока из настроек (основная чистка — на сервере раз в сутки)
  setTimeout(async () => {
    if (!isParent() || S.be.demo) return;
    try {
      const keep = new Set(pendingList().flatMap(e => e.photos || []));
      for (const id of await S.be.oldPhotos(Date.now() - photoDays() * 864e5)) if (!keep.has(id)) await S.be.delPhoto(id);
    } catch (_) {}
  }, 15000);
}
async function boot2(chooser) {
  try {
    S.families = await S.be.myFamilies(S.user);
    const join = new URLSearchParams(location.search).get("join");
    if (join && !chooser) { render(); return; } // покажем форму с кодом
    const saved = lsGet("fq-fid");
    const fid = !chooser && (S.families.includes(saved) ? saved : S.families[0]);
    if (fid) openFamily(fid); else render();
  } catch (e) { console.error(e); toast("Не удалось загрузить данные. Проверьте интернет.", true); render(); }
}
(async function boot() {
  const demo = new URLSearchParams(location.search).has("demo");
  try { S.be = demo ? demoBackend(demoSeed) : await firebaseBackend(); }
  catch (e) { S.error = "Не найдена конфигурация Firebase. Откройте приложение по адресу, выданному Firebase Hosting."; S.be = {}; render(); return; }
  S.user = undefined; render();
  S.be.onAuth(async u => {
    S.user = u || null;
    if (!u) { stopWatch(); S.fid = null; render(); return; }
    if (S.be.demo) { S.families = ["demo"]; openFamily("demo"); return; }
    boot2(false);
  });
  if ("serviceWorker" in navigator && !demo) navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(() => {});
})();

/* Автообновление: если на сайте вышла новая версия, тихо перезагружаемся. */
async function checkUpdate() {
  if (location.protocol === "file:" || S.be?.demo) return;
  try {
    const html = await fetch("/index.html?u=" + Date.now(), { cache: "no-store" }).then(r => r.text());
    const v = (/name="app-version" content="([^"]+)"/.exec(html) || [])[1];
    if (!v || v === APP_VERSION) return;
    const key = "fq-upd-" + v; if (sessionStorage.getItem(key)) return; // не зацикливаемся
    if (document.querySelector(".scrim") || (document.activeElement && document.activeElement.matches("input,textarea,select"))) return;
    sessionStorage.setItem(key, "1"); location.reload();
  } catch (_) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(); });
setTimeout(checkUpdate, 4000);
