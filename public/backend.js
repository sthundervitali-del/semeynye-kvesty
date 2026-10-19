/* Слой данных. Firebase (Google) в рабочем режиме, память браузера в демо-режиме (?demo). */
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";

export function uid(prefix = "e") { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function code8() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(8)); for (const x of r) s += a[x % a.length]; return s; }

/* ====================== Firebase ====================== */
export async function firebaseBackend() {
  const cfgRes = await fetch("/__/firebase/init.json");
  if (!cfgRes.ok) throw new Error("no-firebase-config");
  const config = await cfgRes.json();
  const [{ initializeApp }, A, F, M] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"),
    import(SDK + "firebase-firestore.js"), import(SDK + "firebase-messaging.js"),
  ]);
  const app = initializeApp(config);
  // Вход сохраняется на устройстве: после закрытия приложения пароль не нужен, пока не нажат «Выйти».
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence], popupRedirectResolver: A.browserPopupRedirectResolver });
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  const { doc, collection, setDoc, getDoc, getDocs, onSnapshot, deleteDoc, arrayUnion, arrayRemove, writeBatch, query, where } = F;
  let fid = null, me = null;
  const fam = (...p) => doc(db, "families", fid, ...p);

  return {
    demo: false,
    onAuth(cb) {
      A.getRedirectResult(auth).catch(() => {});
      return A.onAuthStateChanged(auth, cb);
    },
    async signIn() {
      const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
      try { await A.signInWithPopup(auth, p); }
      catch (e) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) await A.signInWithRedirect(auth, p);
        else if (e.code !== "auth/popup-closed-by-user") throw e;
      }
    },
    signOut: () => A.signOut(auth),
    async myFamilies(user) { me = user; const s = await getDoc(doc(db, "users", user.uid)); return (s.exists() && s.data().families) || []; },
    async createFamily(user, name, kids, seed) {
      const id = uid("f");
      await setDoc(doc(db, "families", id), { name, createdBy: user.uid, createdAt: Date.now(), kids, ...seed });
      await setDoc(doc(db, "families", id, "members", user.uid), { role: "parent", name: user.displayName || "", email: user.email || "", photo: user.photoURL || "", joinedAt: Date.now(), tokens: [], seen: [] });
      await setDoc(doc(db, "users", user.uid), { families: arrayUnion(id) }, { merge: true });
      return id;
    },
    async readInvite(code) { const s = await getDoc(doc(db, "invites", code)); return s.exists() ? s.data() : null; },
    async join(user, code) {
      const inv = await this.readInvite(code);
      if (!inv) throw new Error("Код не найден. Проверьте, что он введён без ошибок.");
      if (inv.exp < Date.now()) throw new Error("Срок действия кода истёк. Попросите новый.");
      await setDoc(doc(db, "families", inv.fid, "members", user.uid), { role: inv.role, kidId: inv.kidId || null, code, name: user.displayName || "", email: user.email || "", photo: user.photoURL || "", joinedAt: Date.now(), tokens: [], seen: [] });
      await setDoc(doc(db, "users", user.uid), { families: arrayUnion(inv.fid) }, { merge: true });
      return inv.fid;
    },
    async leaveFamilyRef(user, id) { await setDoc(doc(db, "users", user.uid), { families: arrayRemove(id) }, { merge: true }); },
    use(id) { fid = id; },
    watch(h) {
      const offs = [
        onSnapshot(doc(db, "families", fid), s => h.family(s.exists() ? s.data() : null), h.error),
        onSnapshot(collection(db, "families", fid, "members"), s => h.members(s.docs.map(d => ({ uid: d.id, ...d.data() }))), h.error),
        onSnapshot(collection(db, "families", fid, "kidlog"), s => h.kidlog(s.docs.map(d => ({ id: d.id, ...d.data() })), s.docChanges().length), h.error),
        onSnapshot(collection(db, "families", fid, "plog"), s => h.plog(s.docs.map(d => ({ id: d.id, ...d.data() }))), h.error),
      ];
      return () => offs.forEach(f => f());
    },
    setFamily: patch => setDoc(fam(), patch, { merge: true }),
    putEntry: (kid, month, entry) => setDoc(fam("kidlog", kid + "_" + month), { kid, e: { [entry.id]: entry } }, { merge: true }),
    putTimer: (kid, month, t) => setDoc(fam("kidlog", kid + "_" + month), { kid, t }, { merge: true }),
    putDecision: (docId, id, dec) => setDoc(fam("plog", docId), { d: { [id]: dec } }, { merge: true }),
    putGift: (docId, g) => setDoc(fam("plog", docId), { g: { [g.id]: g } }, { merge: true }),
    putPhoto: (id, data) => setDoc(fam("photos", id), data),
    async getPhoto(id) { const s = await getDoc(fam("photos", id)); return s.exists() ? s.data().data : null; },
    delPhoto: id => deleteDoc(fam("photos", id)).catch(() => {}),
    async oldPhotos(before) { const s = await getDocs(collection(db, "families", fid, "photos")); return s.docs.filter(d => (d.data().at || 0) < before).map(d => d.id); },
    updateMember: (u, patch) => setDoc(fam("members", u), patch, { merge: true }),
    removeMember: u => deleteDoc(fam("members", u)),
    isAdmin: async user => { try { return (await getDoc(doc(db, "admins", user.uid))).exists(); } catch (_) { return false; } },
    watchSupport: (user, admin, cb) => onSnapshot(admin ? collection(db, "support") : query(collection(db, "support"), where("uid", "==", user.uid)),
      s => cb(s.docs.map(d => d.data())), e => console.warn("support", e)),
    sendSupport: (user, req) => { const id = uid("s"), at = Date.now();
      return setDoc(doc(db, "support", id), { id, uid: user.uid, email: user.email || "", name: user.displayName || "", fid, family: req.family || "", subject: req.subject,
        lang: req.lang || "ru", app: req.app || "", status: "open", thread: [{ from: "user", text: req.text, at }], at, updatedAt: at, userSeenAt: at }); },
    supportMsg: (id, from, text) => { const at = Date.now();
      return setDoc(doc(db, "support", id), { thread: arrayUnion({ from, text, at }), status: from === "user" ? "open" : "answered", updatedAt: at, [from === "user" ? "userSeenAt" : "adminSeenAt"]: at,
        [from === "user" ? "adminDeleted" : "userDeleted"]: false }, { merge: true }); },
    /** Удалить запрос у себя. Документ удаляется совсем, когда его удалили обе стороны (или это свой запрос администратора). */
    supportDelete: (r, admin, me) => { const other = admin ? r.userDeleted || r.uid === me : r.adminDeleted;
      return other ? deleteDoc(doc(db, "support", r.id)) : setDoc(doc(db, "support", r.id), { [admin ? "adminDeleted" : "userDeleted"]: true }, { merge: true }); },
    supportSeen: (id, admin) => setDoc(doc(db, "support", id), { [admin ? "adminSeenAt" : "userSeenAt"]: Date.now() }, { merge: true }),
    /** Полное удаление семьи: все записи, фото, участники и сама семья. */
    async deleteFamily(user) {
      const wipe = async refs => {
        for (let i = 0; i < refs.length; i += 400) {
          const b = writeBatch(db); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit();
        }
      };
      for (const sub of ["kidlog", "plog", "photos", "sent"]) {
        const snap = await getDocs(collection(db, "families", fid, sub));
        await wipe(snap.docs.map(d => d.ref));
      }
      const mem = await getDocs(collection(db, "families", fid, "members"));
      await wipe(mem.docs.filter(d => d.id !== user.uid).map(d => d.ref));
      await deleteDoc(doc(db, "families", fid));
      await deleteDoc(doc(db, "families", fid, "members", user.uid));
      await setDoc(doc(db, "users", user.uid), { families: arrayRemove(fid) }, { merge: true });
    },
    async createInvite(user, role, kidId) {
      const code = code8();
      await setDoc(doc(db, "invites", code), { fid, role, kidId: kidId || null, createdBy: user.uid, exp: Date.now() + 7 * 864e5 });
      return code;
    },
    async enablePush(user) {
      if (!(await M.isSupported())) throw new Error("Этот браузер не поддерживает уведомления. На iPhone сначала добавьте приложение на экран «Домой».");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Уведомления запрещены в настройках браузера.");
      const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      const messaging = M.getMessaging(app);
      const token = await M.getToken(messaging, { serviceWorkerRegistration: reg });
      await setDoc(fam("members", user.uid), { tokens: arrayUnion(token) }, { merge: true });
      M.onMessage(messaging, p => window.dispatchEvent(new CustomEvent("fq-push", { detail: p.notification || {} })));
      try { localStorage.setItem("fq-push", "1"); } catch (_) {}
      return token;
    },
    async disablePush(user) {
      try {
        if (await M.isSupported()) {
          const messaging = M.getMessaging(app);
          const reg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
          const token = reg ? await M.getToken(messaging, { serviceWorkerRegistration: reg }).catch(() => null) : null;
          if (token) { await setDoc(fam("members", user.uid), { tokens: arrayRemove(token) }, { merge: true }); await M.deleteToken(messaging).catch(() => {}); }
        }
      } finally { try { localStorage.setItem("fq-push", "0"); } catch (_) {} }
    },
    async resumePush() {
      try {
        if (localStorage.getItem("fq-push") !== "1" || !(await M.isSupported()) || Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        const messaging = M.getMessaging(app);
        await M.getToken(messaging, { serviceWorkerRegistration: reg });
        M.onMessage(messaging, p => window.dispatchEvent(new CustomEvent("fq-push", { detail: p.notification || {} })));
      } catch (_) {}
    },
  };
}

/* ====================== Демо ====================== */
function deepMerge(a, b) {
  for (const k in b) {
    const v = b[k];
    if (v && typeof v === "object" && !Array.isArray(v)) { a[k] = deepMerge(a[k] && typeof a[k] === "object" ? a[k] : {}, v); }
    else a[k] = v;
  }
  return a;
}
export function demoBackend(seedFn) {
  const store = { family: null, members: {}, kidlog: {}, plog: {}, photos: {} };
  let handlers = null;
  const emit = () => {
    if (!handlers) return;
    const c = x => JSON.parse(JSON.stringify(x));
    handlers.family(c(store.family));
    handlers.members(Object.entries(store.members).map(([u, m]) => ({ uid: u, ...c(m) })));
    handlers.kidlog(Object.entries(store.kidlog).map(([id, d]) => ({ id, ...c(d) })), 1);
    handlers.plog(Object.entries(store.plog).map(([id, d]) => ({ id, ...c(d) })));
  };
  const later = () => setTimeout(emit, 30);
  const user = { uid: "demo-parent", displayName: "Мама (демо)", email: "demo@example.com" };
  seedFn(store, user);
  return {
    demo: true, store,
    onAuth(cb) { setTimeout(() => cb(user), 10); return () => {}; },
    signIn: async () => {}, signOut: async () => location.reload(),
    myFamilies: async () => ["demo"],
    createFamily: async () => "demo", readInvite: async () => null, join: async () => "demo", leaveFamilyRef: async () => {},
    use() {}, watch(h) { handlers = h; later(); return () => { handlers = null; }; },
    setFamily: async p => { deepMerge(store.family, p); later(); },
    putEntry: async (kid, m, e) => { const id = kid + "_" + m; store.kidlog[id] = deepMerge(store.kidlog[id] || { kid }, { e: { [e.id]: e } }); later(); },
    putTimer: async (kid, m, t) => { const id = kid + "_" + m; store.kidlog[id] = deepMerge(store.kidlog[id] || { kid }, { t }); later(); },
    putDecision: async (doc, id, d) => { store.plog[doc] = deepMerge(store.plog[doc] || {}, { d: { [id]: d } }); later(); },
    putGift: async (doc, g) => { store.plog[doc] = deepMerge(store.plog[doc] || {}, { g: { [g.id]: g } }); later(); },
    putPhoto: async (id, d) => { store.photos[id] = d; }, getPhoto: async id => store.photos[id]?.data || null, delPhoto: async () => {}, oldPhotos: async () => [],
    updateMember: async (u, p) => { store.members[u] = deepMerge(store.members[u] || {}, p); later(); },
    removeMember: async u => { delete store.members[u]; later(); },
    isAdmin: async () => true,
    watchSupport: (user, admin, cb) => { const fire = () => cb((store.support || []).map(r => ({ ...r, thread: r.thread.slice() }))); store.supportCb = fire; fire(); return () => { store.supportCb = null; }; },
    sendSupport: async (user, req) => { const at = Date.now(); (store.support = store.support || []).unshift({ id: uid("s"), uid: user.uid, email: user.email, name: user.displayName, family: req.family, subject: req.subject, status: "open", thread: [{ from: "user", text: req.text, at }], at, updatedAt: at, userSeenAt: at }); store.supportCb?.(); },
    supportMsg: async (id, from, text) => { const r = (store.support || []).find(x => x.id === id); if (!r) return; const at = Date.now(); r.thread.push({ from, text, at }); r.status = from === "user" ? "open" : "answered"; r.updatedAt = at; r[from === "user" ? "userSeenAt" : "adminSeenAt"] = at; store.supportCb?.(); },
    supportDelete: async (r) => { store.support = (store.support || []).filter(x => x.id !== r.id); store.supportCb?.(); },
    supportSeen: async (id, admin) => { const r = (store.support || []).find(x => x.id === id); if (r) { r[admin ? "adminSeenAt" : "userSeenAt"] = Date.now(); store.supportCb?.(); } },
    createInvite: async () => code8(),
    deleteFamily: async () => { throw new Error("В демо-режиме семью удалить нельзя."); },
    enablePush: async () => { throw new Error("В демо-режиме уведомления не подключаются."); }, disablePush: async () => { try { localStorage.setItem("fq-push", "0"); } catch (_) {} }, resumePush: async () => {},
  };
}
