/* Family Quests — перевод интерфейса (русский → английский).
   Интерфейс пишется по-русски; при выборе English тексты на экране
   заменяются по словарю EN и шаблонам PATTERNS. Пользовательские данные
   (названия дел, имена) переводятся, только если это стандартные шаблоны. */
(function () {
  "use strict";
  var KEY = "fq-lang";
  function detect() {
    try { var v = localStorage.getItem(KEY); if (v === "ru" || v === "en") return v; } catch (_) {}
    var n = (navigator.language || "ru").toLowerCase();
    return /^(ru|be|uk|kk)/.test(n) ? "ru" : "en";
  }
  var cur = detect();
  var CYR = /[А-Яа-яЁё]/;

  var EN = window.FQ_EN || {};
  var PATTERNS = window.FQ_PATTERNS || [];
  var cache = {};

  function exact(s) { return Object.prototype.hasOwnProperty.call(EN, s) ? EN[s] : null; }
  function pattern(s) {
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i][0].exec(s);
      if (m) return PATTERNS[i][1].apply(null, m.slice(1).map(function (x) { return x == null ? "" : x; }));
    }
    return null;
  }
  function one(s) {
    var r = exact(s); if (r != null) return r;
    r = pattern(s); if (r != null) return r;
    return null;
  }
  function tr(str) {
    if (cur !== "en" || str == null) return str;
    str = String(str);
    if (!CYR.test(str)) return str;
    if (cache[str] != null) return cache[str];
    var lead = str.match(/^\s*/)[0], trail = str.match(/\s*$/)[0];
    var core = str.trim(), out = one(core);
    if (out == null && core.indexOf(" · ") >= 0) {
      var parts = core.split(" · "), ok = true;
      out = parts.map(function (p) { var t = one(p); if (t == null) { if (CYR.test(p)) ok = false; return p; } return t; }).join(" · ");
      if (!ok && out === core) out = null;
    }
    if (out == null) {
      // концевые знаки препинания: «Текст:» / «Текст.»
      var mm = /^(.*?)([:.,!?…]+)$/.exec(core);
      if (mm && mm[1]) { var t2 = one(mm[1]); if (t2 != null) out = t2 + mm[2]; }
    }
    if (out == null) { out = core; if (window.FQ_I18N_DEBUG) (window.FQ_MISSES = window.FQ_MISSES || {})[core] = 1; }
    return (cache[str] = lead + out + trail);
  }
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];
  function apply(root) {
    if (cur !== "en" || !root) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentElement && n.parentElement.closest("[data-noi18n],script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var n, list = [];
    while ((n = w.nextNode())) if (CYR.test(n.nodeValue)) list.push(n);
    list.forEach(function (t) { var v = tr(t.nodeValue); if (v !== t.nodeValue) t.nodeValue = v; });
    var els = root.querySelectorAll ? root.querySelectorAll("[placeholder],[aria-label],[title],[alt]") : [];
    for (var i = 0; i < els.length; i++) {
      for (var j = 0; j < ATTRS.length; j++) {
        var a = els[i].getAttribute(ATTRS[j]);
        if (a && CYR.test(a)) els[i].setAttribute(ATTRS[j], tr(a));
      }
    }
  }
  window.I18N = {
    lang: function () { return cur; },
    setLang: function (l) { cur = l === "en" ? "en" : "ru"; cache = {}; try { localStorage.setItem(KEY, cur); } catch (_) {} document.documentElement.lang = cur; },
    tr: tr, apply: apply,
  };
  document.documentElement.lang = cur;
})();
