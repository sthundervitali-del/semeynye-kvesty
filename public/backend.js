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
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  const { doc, collection, setDoc, getDoc, getDocs, onSnapshot, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, updateDoc } = F;
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
    createInvite: async () => code8(),
    enablePush: async () => { throw new Error("В демо-режиме уведомления не подключаются."); }, resumePush: async () => {},
  };
}
