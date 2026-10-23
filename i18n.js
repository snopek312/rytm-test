// Rytm: the app in English (23.10.2026). The app is written in Polish; with "English" chosen in Ustawienia this file translates
// what is on the screen, as it appears (a MutationObserver): every text and the labels read aloud or shown on hover
// (aria-label, placeholder, title, the label of option groups). Nothing here runs while the app is in Polish.
// Lookup, in order:
//   1. the exact text in the dictionary (i18n-en.js);
//   2. the text as a template, where the user's own names, dates and numbers are holes "{}" — e.g. "Na jutro: {} · razem {}";
//      a template whose English needs another order uses "{0}", "{1}"…;  the holes are filled with: the user's names as typed
//      (or the dictionary's English for the app's own default names), the dates in English, the numbers as they are;
//   3. the parts of a longer text (split at " · ", " — ", ": ") one by one. A text not known at all stays as it is.
// The user's own names come from the app (setUserStrings): subjects, habits, goals, people, homework… — they stay as typed.
// Switching back to Polish puts back every text this file changed. Elements with translate="no" are left alone.
(function (g) {
  "use strict";
  const doc = g.document;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* ---------- dates: Polish words → English ---------- */
  const DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DATE_WORDS = {};
  const put = (list, en) => list.forEach((w, i) => { if (w) DATE_WORDS[w] = en[i]; });
  // weekdays: nominative, accusative (w środę), genitive (do piątku), short with and without the dot, two letters
  put(["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"], DAYS_EN);
  put(["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"], DAYS_EN);
  put([null, null, "środę", null, null, "sobotę", "niedzielę"], DAYS_EN);
  put(["poniedziałku", "wtorku", "środy", "czwartku", "piątku", "soboty", "niedzieli"], DAYS_EN);
  put(["poniedziałki", "wtorki", null, "czwartki", "piątki", null, "niedziele"], DAYS_EN.map(d => d + "s"));
  put(["pon.", "wt.", "śr.", "czw.", "pt.", "sob.", "niedz."], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  put(["Pon.", "Wt.", "Śr.", "Czw.", "Pt.", "Sob.", "Niedz."], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  put(["pon", "wt", "śr", "czw", "pt", "sob", "niedz"], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  put(["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"], ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
  // months: with a day (22 października), on their own (Październik 2026), "w październiku", short (22 paź)
  put(["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"], MONTHS_EN);
  put(["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"], MONTHS_EN);
  put(["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"], MONTHS_EN);
  put(["styczniu", "lutym", "marcu", "kwietniu", "maju", "czerwcu", "lipcu", "sierpniu", "wrześniu", "październiku", "listopadzie", "grudniu"], MONTHS_EN);
  put(["sty", "lut", "mar", "kwi", null, "cze", "lip", "sie", "wrz", "paź", "lis", "gru"], MONTHS_EN.map(m => m.slice(0, 3)));
  put(["Sty", "Lut", "Mar", "Kwi", null, "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"], MONTHS_EN.map(m => m.slice(0, 3)));
  // whole words only: a letter or a digit may not touch the match (written without look-behind, for older iPhones)
  const L = "\\p{L}\\d";
  const words = list => new RegExp(`(^|[^${L}])(${list.map(escRe).join("|")})(?![${L}])`, "gu");
  const dateRe = words(Object.keys(DATE_WORDS).sort((a, b) => b.length - a.length));
  const numRe = new RegExp(`(^|[^${L}])(\\d+(?:[.,:/–-]\\d+)*(?:[\\u00a0\\u202f ]\\d{3}(?!\\d))*(?:,\\d+)?)(?![${L}])`, "gu");
  // kept exactly as they are: the app's version, time zones (Europe/Warsaw), file names (kopia.json, B.zip)
  const codeRe = new RegExp(`(^|[^${L}])(\\d{4}\\.\\d{2}\\.\\d{2}-[\\w-]+|[A-Z][a-z]+/[A-Za-z_/-]+|[\\w-]+(?:\\.[\\w-]+)*\\.(?:zip|fit|FIT|json|csv|CSV|txt|bin))(?![${L}])`, "gu");
  const LETTER = /\p{L}/u;

  /* ---------- state ---------- */
  let lang = "pl", obs = null, harvest = null, userFn = null, userRe = null, userKey = "", userAt = -1, batch = 0;
  const cache = new Map();
  const D = () => g.RytmI18nEN || {};
  const collapse = s => s.replace(/\s+/g, " ").trim();

  // the user's own names (subjects, habits, goals…): looked up again once for each change of the screen that needs them
  function userRegex() {
    if (userFn && userAt !== batch) {
      userAt = batch;
      let list = [];
      try { list = userFn() || []; } catch (e) { list = []; }
      const set = [...new Set(list.filter(s => typeof s === "string").map(collapse).filter(s => s.length >= 2 && s.length <= 200 && LETTER.test(s)))].sort((a, b) => b.length - a.length);
      const key = set.join("\u0001");
      if (key !== userKey) { userKey = key; cache.clear(); userRe = set.length ? words(set) : null; }
    }
    return userRe;
  }
  // the text with holes: {key, args:[{t:"u"|"d"|"n", v, en}]}
  function holes(t, withUser) {
    const ms = [];
    const scan = (re, type, pri) => {
      if (!re) return; re.lastIndex = 0; let m;
      while ((m = re.exec(t))) { const s0 = m.index + m[1].length; ms.push({ s: s0, e: s0 + m[2].length, t: type, v: m[2], pri }); if (!m[0].length) re.lastIndex++; }
    };
    if (withUser) scan(userRegex(), "u", 0);
    scan(codeRe, "c", 0.5); scan(dateRe, "d", 1); scan(numRe, "n", 2);
    ms.sort((a, b) => a.s - b.s || a.pri - b.pri || b.e - a.e);
    let key = "", at = 0; const args = [];
    for (const m of ms) { if (m.s < at) continue; key += t.slice(at, m.s) + "{}"; args.push(m); at = m.e; }
    key += t.slice(at);
    return { key, args };
  }
  const exact = t => { const d = D(); return has(d, t) ? d[t] : null; };
  function argOut(a) {
    if (a.t === "d") return DATE_WORDS[a.v];
    if (a.t === "n") return /^\d+,\d$/.test(a.v) ? a.v.replace(",", ".") : a.v;
    if (a.t === "c") return a.v;
    const e = exact(a.v); return e != null ? e : a.v;
  }
  const fill = (tpl, vals) => { let i = 0; return tpl.replace(/\{(\d*)\}/g, (_, n) => { const v = vals[n === "" ? i++ : +n]; return v == null ? "" : v; }); };
  const lettersLeft = key => LETTER.test(key.replace(/\{\}/g, ""));
  // -> {out, ok}: ok = the whole text has an English version (not only the dates)
  function lookup(t, depth) {
    const e = exact(t); if (e != null) return { out: e, ok: true };
    if (cache.has(t)) return cache.get(t);
    let r = null;
    for (const withUser of [true, false]) {
      const h = holes(t, withUser); if (!h.args.length) continue;
      const d = D();
      if (has(d, h.key)) { r = { out: fill(d[h.key], h.args.map(argOut)), ok: true }; break; }
      if (!lettersLeft(h.key)) { r = { out: fill(h.key, h.args.map(argOut)), ok: true }; break; }
    }
    if (!r && depth < 4) {
      for (const sep of [" · ", " — ", ": ", "; "]) {
        const i = t.indexOf(sep); if (i <= 0) continue;
        const parts = t.split(sep).map(p => (p ? lookup(p, depth + 1) : { out: "", ok: true }));
        if (parts.some(p => p.ok)) { r = { out: parts.map(p => p.out).join(sep), ok: parts.every(p => p.ok) }; break; }
      }
    }
    // not known: left as it is (it may be the user's own text, which must not change)
    if (!r) r = { out: t, ok: false };
    if (cache.size > 5000) cache.clear();
    cache.set(t, r);
    return r;
  }
  // a text in English (the same text when there is nothing to translate)
  function t(s) {
    if (lang !== "en" || typeof s !== "string" || !LETTER.test(s)) return s;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/), c = collapse(m[2]);
    const r = lookup(c, 0);
    return r.out === c ? s : m[1] + r.out + m[3];
  }
  // what the harvest notes down: the text as a template (the user's names as holes) when it has no full English yet
  function note(s, where) {
    const c = collapse(s); if (!LETTER.test(c) || lookup(c, 0).ok) return;
    harvest(holes(c, true).key, c, where, holes(c, false).key);
  }

  /* ---------- the screen ---------- */
  const ATTRS = ["aria-label", "placeholder", "title", "label"];
  const SKIP = "script,style,textarea,[translate=\"no\"]", SKIP_ATTR = "script,style,[translate=\"no\"]";   // a text field's label and hint are translated, what is typed in it is not
  function skipEl(el) { return !el || (el.closest && el.closest(SKIP)); }
  function doText(n) {
    const v = n.nodeValue;
    if (!v || !LETTER.test(v) || (n.__en !== undefined && n.__en === v) || skipEl(n.parentElement)) return;
    if (harvest) { note(v, n.parentElement && n.parentElement.closest("[id]") ? n.parentElement.closest("[id]").id : ""); return; }
    const out = t(v);
    if (out !== v) { n.__pl = v; n.__en = out; n.nodeValue = out; }
  }
  function doAttr(el, name) {
    const v = el.getAttribute(name);
    if (!v || !LETTER.test(v) || !el.closest || el.closest(SKIP_ATTR)) return;
    const mem = el.__i18n || (el.__i18n = {});
    if (mem[name] && mem[name].en === v) return;
    if (harvest) { note(v, "@" + name); return; }
    const out = t(v);
    if (out !== v) { mem[name] = { pl: v, en: out }; el.setAttribute(name, out); }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.closest(SKIP_ATTR)) return;
    if (root.nodeType === 1) for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a);
    if (root.nodeType === 1 && root.matches("textarea")) return;
    const w = doc.createTreeWalker(root, 5 /* elements and texts */, { acceptNode: n => (n.nodeType === 1 && n.matches(SKIP_ATTR) ? 2 /* reject */ : 1) });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a); }
  }
  function onMutations(list) {
    batch++;
    for (const m of list) {
      if (m.type === "characterData") doText(m.target);
      else if (m.type === "attributes") doAttr(m.target, m.attributeName);
      else for (const n of m.addedNodes) walk(n);
    }
  }
  function start() {
    if (obs || !doc || typeof g.MutationObserver !== "function") return;
    obs = new g.MutationObserver(onMutations);
    obs.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    walk(doc.documentElement);
  }
  function stop() { if (obs) { obs.disconnect(); obs = null; } }
  // back to Polish: every text and label changed here gets its Polish back
  function restore() {
    if (!doc) return;
    const w = doc.createTreeWalker(doc.documentElement, 5);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (n.__pl !== undefined && n.nodeValue === n.__en) n.nodeValue = n.__pl; delete n.__pl; delete n.__en; }
      else if (n.__i18n) { for (const [a, x] of Object.entries(n.__i18n)) if (x && n.getAttribute(a) === x.en) n.setAttribute(a, x.pl); n.__i18n = null; }
    }
  }
  // the charts draw their words on a canvas, not in the page: their labels, titles and tooltips go through t() too
  let chartsHooked = false;
  function hookCharts() {
    const C = g.Chart; if (chartsHooked || !C || typeof C.register !== "function") return;
    const tx = v => (Array.isArray(v) ? v.map(tx) : typeof v === "string" ? t(v) : v);
    try {
      C.register({ id: "rytmI18n",
        beforeUpdate(chart) {
          if (lang !== "en") return;
          const d = chart.data || {};
          if (Array.isArray(d.labels)) d.labels = d.labels.map(tx);
          for (const ds of d.datasets || []) if (typeof ds.label === "string") ds.label = t(ds.label);
          const sc = (chart.options && chart.options.scales) || {};
          for (const k of Object.keys(sc)) if (sc[k] && sc[k].title && typeof sc[k].title.text === "string") sc[k].title.text = t(sc[k].title.text);
        },
        // the axis labels made by the app's own callbacks (e.g. "150 ud./min"): after the scales have them, before drawing
        afterUpdate(chart) {
          if (lang !== "en") return;
          for (const sc of Object.values(chart.scales || {})) {
            let changed = false;
            for (const tk of sc.ticks || []) { const v = tx(tk.label); if (v !== tk.label) { tk.label = v; changed = true; } }
            if (changed) sc._labelItems = null;
          }
        },
        beforeTooltipDraw(chart, args) {
          const tt = args && args.tooltip; if (lang !== "en" || !tt) return;
          if (Array.isArray(tt.title)) tt.title = tt.title.map(tx);
          for (const b of tt.body || []) { if (Array.isArray(b.lines)) b.lines = b.lines.map(tx); if (Array.isArray(b.before)) b.before = b.before.map(tx); if (Array.isArray(b.after)) b.after = b.after.map(tx); }
          if (Array.isArray(tt.footer)) tt.footer = tt.footer.map(tx);
        } });
      chartsHooked = true;
    } catch (e) {}
  }
  function setLang(l) {
    l = l === "en" ? "en" : "pl";
    if (l === lang && (l === "pl" || obs)) return;
    lang = l; cache.clear(); batch++;
    if (doc) doc.documentElement.lang = l;
    if (l === "en") { hookCharts(); stop(); start(); } else { stop(); restore(); if (harvest) start(); }
  }
  function setUserStrings(fn) { userFn = typeof fn === "function" ? fn : null; userAt = -1; }
  // tests only: note down every text that has no English yet (the app stays in Polish)
  function setHarvest(fn) { harvest = typeof fn === "function" ? fn : null; if (harvest && lang === "pl") start(); }

  const api = { setLang, setUserStrings, setHarvest, t, DATE_WORDS, holes: (s, u) => holes(collapse(s), u !== false), get lang() { return lang; } };
  g.RytmI18n = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (doc && typeof g.__rytmHarvest === "function") setHarvest(g.__rytmHarvest);
})(typeof window !== "undefined" ? window : globalThis);
