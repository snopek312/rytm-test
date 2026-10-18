// Rytm: daily habits.
// Kinds of habit:
//   count  – "3 razy dziennie", you tick how many times you did it
//   bool   – "tak / nie", did you manage or not
//   amount – a number with a goal: at least (sleep 7 h) or at most (screen 2 h)
//   time   – minutes with a goal, e.g. training at least 20 min; has a stopwatch
// Options: days of the week, an icon, pausing, a note for each day.
// Data: {habits:[...], log:{"YYYY-MM-DD":{habitId:value}}, notes:{"YYYY-MM-DD":"text"}}
// Saved through the app's data store (IndexedDB, see store.js and bridge.js) and, inside Claude, also in your
// private db space. This file does not read or write localStorage.
(function (g) {
  "use strict";

  /* ================= core logic (no DOM) ================= */
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const todayKey = () => dayKey(new Date());
  const dowOf = k => (fromKey(k).getDay() + 6) % 7;          // 0 = Monday

  // 0..1 how well the habit went; null = nothing marked
  function score(h, v) {
    if (v === undefined || v === null || v === "") return null;
    if (h.type === "count") return Math.max(0, Math.min(1, v / h.target));
    if (h.type === "bool") return v ? 1 : 0;
    if (h.type === "amount" || h.type === "time") {
      if (h.dir === "max") return v <= h.goal ? 1 : (v <= 0 ? 1 : h.goal / v);
      return h.goal <= 0 ? 1 : Math.max(0, Math.min(1, v / h.goal));
    }
    return null;
  }
  const isDone = (h, v) => score(h, v) === 1;
  const val = (S, k, h) => (S.log[k] || {})[h.id];

  // Is the habit planned on this day? (days of the week, pauses)
  function scheduled(h, k) {
    if (Array.isArray(h.days) && h.days.length && h.days.length < 7 && !h.days.includes(dowOf(k))) return false;
    if (h.paused && k >= h.paused) return false;
    if (Array.isArray(h.breaks)) for (const [a, b] of h.breaks) if (k >= a && k <= b) return false;
    return true;
  }

  // first day the habit counts from: created date or first entry, whichever is earlier
  function since(S, h) {
    let first = h.created || todayKey();
    for (const k of Object.keys(S.log)) if (k < first && S.log[k][h.id] !== undefined) first = k;
    return first;
  }
  // a skipped day (illness, trip…) does not count anywhere: not in stats, not in streaks
  const isSkipped = (S, k) => !!S.skips && Object.prototype.hasOwnProperty.call(S.skips, k);
  const active = (S, h, k) => k >= since(S, h) && scheduled(h, k) && !isSkipped(S, k);

  function daySummary(S, k) {
    if (isSkipped(S, k)) return { total: 0, done: 0, frac: 0, marked: 0, skipped: true };
    const hs = S.habits.filter(h => active(S, h, k));
    if (!hs.length) return { total: 0, done: 0, frac: 0, marked: 0 };
    let sum = 0, done = 0, marked = 0;
    for (const h of hs) { const v = val(S, k, h), s = score(h, v); if (s !== null) marked++; sum += s || 0; if (s === 1) done++; }
    return { total: hs.length, done, frac: sum / hs.length, marked };
  }

  // Current streak in planned days. Today counts once done; days off neither break nor add.
  function streak(S, h, today = todayKey()) {
    const start = since(S, h); let n = 0, k = today;
    if (active(S, h, k) && !isDone(h, val(S, k, h))) k = addDays(k, -1);
    for (; k >= start; k = addDays(k, -1)) {
      if (!scheduled(h, k) || isSkipped(S, k)) continue;
      if (isDone(h, val(S, k, h))) n++; else break;
    }
    return n;
  }
  function bestStreak(S, h, today = todayKey()) {
    let best = 0, cur = 0;
    for (let k = since(S, h); k <= today; k = addDays(k, 1)) {
      if (!scheduled(h, k) || isSkipped(S, k)) continue;
      if (isDone(h, val(S, k, h))) { cur++; best = Math.max(best, cur); } else if (k !== today) cur = 0;
    }
    return best;
  }
  // share of planned days done within the last n calendar days (today only counts once done)
  function rate(S, h, n, today = todayKey()) {
    let days = 0, done = 0;
    for (let i = 0; i < n; i++) {
      const k = addDays(today, -i);
      if (!active(S, h, k)) continue;
      const d = isDone(h, val(S, k, h));
      if (k === today && !d) continue;
      days++; if (d) done++;
    }
    return days ? done / days : null;
  }

  // Everything the "all habits" statistics view needs, for the last n days (n = 0: whole history).
  // Days without any entry count as 0%. Skipped days are left out.
  function overall(S, n, today = todayKey()) {
    const first = firstDay(S);
    if (!n) n = spanDays(S, today);
    const days = [], all = []; let skipped = 0;
    for (let i = n - 1; i >= 0; i--) {
      const k = addDays(today, -i);
      if (k < first) continue;
      if (isSkipped(S, k)) { skipped++; all.push({ k, skip: true }); continue; }
      const s = daySummary(S, k);
      if (!s.total) continue;
      if (k === today && !s.marked) continue;        // today counts once you start marking
      days.push({ k, ...s }); all.push({ k, ...s });
    }
    const avg = days.length ? days.reduce((a, d) => a + d.frac, 0) / days.length : null;
    const full = days.filter(d => d.done === d.total).length;
    const unfilled = days.filter(d => d.marked === 0).length;
    const dow = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    days.forEach(d => { const w = dow[dowOf(d.k)]; w.sum += d.frac; w.n++; });
    const dowAvg = dow.map(w => w.n ? w.sum / w.n : null);
    let bestDow = null;
    dowAvg.forEach((v, i) => { if (v !== null && dow[i].n >= 2 && (bestDow === null || v > dowAvg[bestDow])) bestDow = i; });
    // streak of complete days, ending today (if complete) or yesterday
    let fullStreak = 0, k = today;
    const s0 = daySummary(S, k);
    if (!(s0.total && s0.done === s0.total)) k = addDays(k, -1);
    for (let guard = 0; guard < 3650; guard++, k = addDays(k, -1)) {
      if (k < first) break;
      const s = daySummary(S, k);
      if (!s.total) continue;
      if (s.done === s.total) fullStreak++; else break;
    }
    return { days, all, avg, full, unfilled, skipped, dowAvg, bestDow, fullStreak, n };
  }
  function firstDay(S) {
    let f = todayKey();
    for (const h of S.habits) { const s = since(S, h); if (s < f) f = s; }
    return f;
  }
  // number of calendar days from the first habit day until today
  function spanDays(S, today = todayKey()) {
    return Math.max(1, Math.round((fromKey(today) - fromKey(firstDay(S))) / 864e5) + 1);
  }

  const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString("pl-PL");
  // 75 -> "1 h 15 min", 20 -> "20 min"
  function fmtMin(m) {
    m = Math.round(m);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  // "20", "20 min", "1:30", "1h30", "1 h 30 min", "1,5 h", "90m" -> minutes (NaN if unreadable)
  function parseMinutes(str) {
    const s = String(str).toLowerCase().replace(",", ".").replace(/\s+/g, " ").trim();
    if (!s) return NaN;
    let m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = s.match(/^(\d+(?:\.\d+)?) ?(?:h|godz\.?|g)(?: ?(\d+) ?(?:min|m)?)?$/);
    if (m) return Math.round(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0));
    m = s.match(/^(\d+(?:\.\d+)?) ?(?:min|m)?$/);
    if (m) return Math.round(Number(m[1]));
    return NaN;
  }
  const DOW_SHORT = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
  function describe(h) {
    let s = h.type === "count" ? (h.target === 1 ? "raz dziennie" : `${h.target}× dziennie`)
      : h.type === "bool" ? "tak / nie"
      : h.type === "time" ? `${h.dir === "max" ? "najwyżej" : "co najmniej"} ${fmtMin(h.goal)}`
      : `${h.dir === "max" ? "najwyżej" : "co najmniej"} ${fmtNum(h.goal)} ${h.unit || ""}`.trim();
    if (Array.isArray(h.days) && h.days.length && h.days.length < 7) s += " · " + [...h.days].sort().map(d => DOW_SHORT[d]).join(", ");
    return s;
  }

  const core = { dayKey, fromKey, addDays, todayKey, dowOf, score, isDone, scheduled, isSkipped, since, daySummary, streak, bestStreak, rate, overall, firstDay, spanDays, describe, fmtMin, parseMinutes };

  /* ================= storage (stage 2B: only through the data store; this file never touches localStorage) ================= */
  const COLORS = 6;
  function defaults() {
    const t = todayKey();
    return {
      habits: [
        { id: "h-zeby", name: "Mycie zębów", type: "count", target: 3, color: 0, created: t },
        { id: "h-cukier", name: "Ograniczenie cukru", type: "bool", color: 4, created: t },
        { id: "h-sen", name: "Sen", type: "amount", dir: "min", goal: 7, unit: "godz.", step: 0.5, color: 5, created: t },
      ],
      log: {}, notes: {}, skips: {},
    };
  }
  const say = (g.Rytm && g.Rytm.notify) || { info: () => {}, error: () => {} };
  // persist = {load, save, loadTimer, saveTimer, readOnly, statusText, whenSaved}, given by the app (attach).
  // Without it nothing is saved (pure logic tests).
  let persist = null;
  function loadLocal() {
    const s = persist ? persist.load() : null;
    if (s && Array.isArray(s.habits)) return { habits: s.habits, log: s.log || {}, notes: s.notes || {}, skips: s.skips || {} };
    return null;
  }
  const settled = e => { const r = Promise.reject(e); r.catch(() => {}); return r; };
  // returns {ok, saved}: ok=false when the change was refused (writing is off) — the screen goes back to the stored data
  function saveLocal() {
    if (!persist) return { ok: true, saved: Promise.resolve() };
    try { return { ok: true, saved: persist.save(S) }; }
    catch (e) { S = loadLocal() || defaults(); setTimeout(() => render(), 0); return { ok: false, saved: settled(e) }; }
  }
  const clone = v => JSON.parse(JSON.stringify(v));

  /* account sync (only inside Claude): one doc for the habit list, one doc per month for entries and notes */
  const sync = { col: null, dirty: new Set(), ver: {}, timers: {}, chain: {}, status: "local", migrated: false, serverDocs: new Set() };
  const monthOf = k => "log-" + k.slice(0, 7);
  const allMonths = () => new Set([...Object.keys(S.log), ...Object.keys(S.notes), ...Object.keys(S.skips)].map(monthOf));

  function queueWrite(docId) {
    if (!sync.col) return;
    sync.dirty.add(docId);
    sync.ver[docId] = (sync.ver[docId] || 0) + 1;
    clearTimeout(sync.timers[docId]);
    sync.timers[docId] = setTimeout(() => flush(docId), 500);
  }
  function bodyOf(docId) {
    if (docId === "habits") return { v: 2, habits: S.habits };
    const m = docId.slice(4), days = {}, notes = {}, skips = {};
    for (const [k, v] of Object.entries(S.log)) if (k.startsWith(m) && Object.keys(v).length) days[k] = v;
    for (const [k, v] of Object.entries(S.notes)) if (k.startsWith(m) && v) notes[k] = v;
    for (const [k, v] of Object.entries(S.skips)) if (k.startsWith(m)) skips[k] = v || "";
    return { days, notes, skips };
  }
  function flush(docId, retry = 0) {
    const sent = sync.ver[docId];
    sync.chain[docId] = (sync.chain[docId] || Promise.resolve()).then(async () => {
      try {
        await sync.col.doc(docId).set(JSON.parse(JSON.stringify(bodyOf(docId))));
        if (sync.ver[docId] === sent) sync.dirty.delete(docId);
        setStatus("account");
      } catch (e) {
        setStatus("error");
        if (retry < 2 && (!e || e.code === "unavailable" || e.code === "resource_exhausted")) setTimeout(() => flush(docId, retry + 1), 2000 + Math.random() * 2000);
        else say.error("Nie udało się zapisać nawyków na koncie", [`Na tym urządzeniu: ${deviceText() || "stan nieznany"}. Na koncie spróbuję ponownie przy następnej zmianie.`, String(e && (e.code || e.message) || e)], { key: "sync-habits" });
      }
    });
  }
  function applySnapshot(snap) {
    const docs = {}; snap.docs.forEach(d => { if (d.exists) docs[d.id] = d.data(); });
    const fresh = !snap.metadata.fromCache;
    sync.serverDocs = new Set(Object.keys(docs));
    if (!Object.keys(docs).length) {
      if (fresh && !sync.migrated) { sync.migrated = true; queueWrite("habits"); allMonths().forEach(queueWrite); }
      return;
    }
    sync.migrated = true;
    if (docs.habits && !sync.dirty.has("habits") && Array.isArray(docs.habits.habits)) S.habits = JSON.parse(JSON.stringify(docs.habits.habits));
    else if (!docs.habits && fresh) queueWrite("habits");
    const serverMonths = new Set(Object.keys(docs).filter(id => id.startsWith("log-")));
    const keep = m => !serverMonths.has(m) || sync.dirty.has(m);  // months not on the server yet, or with unsaved edits
    const newLog = {}, newNotes = {}, newSkips = {};
    for (const [k, v] of Object.entries(S.log)) if (keep(monthOf(k))) newLog[k] = v;
    for (const [k, v] of Object.entries(S.notes)) if (keep(monthOf(k))) newNotes[k] = v;
    for (const [k, v] of Object.entries(S.skips)) if (keep(monthOf(k))) newSkips[k] = v;
    for (const m of serverMonths) {
      if (sync.dirty.has(m)) continue;
      for (const [k, v] of Object.entries((docs[m] && docs[m].days) || {})) newLog[k] = JSON.parse(JSON.stringify(v));
      for (const [k, v] of Object.entries((docs[m] && docs[m].notes) || {})) newNotes[k] = String(v);
      for (const [k, v] of Object.entries((docs[m] && docs[m].skips) || {})) newSkips[k] = String(v || "");
    }
    if (fresh) allMonths().forEach(m => { if (!serverMonths.has(m)) queueWrite(m); });
    S.log = newLog; S.notes = newNotes; S.skips = newSkips;
    saveLocal();
    setStatus("account");
    if (!isTyping()) render();
  }
  async function connect() {
    try {
      if (!g.claude || typeof g.claude.use !== "function") return;
      const [db, user] = await Promise.all([g.claude.use("db"), g.claude.use("user")]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      sync.col = db.collection("data/users/" + uid);
      sync.col.onSnapshot(applySnapshot, () => { sync.col = null; setStatus("local"); });
    } catch (e) { sync.col = null; }
  }
  const deviceText = () => (persist && persist.statusText ? persist.statusText() : "");
  // device part comes from the data store (only "Zapisano…" when the store confirmed it); account part from Claude
  function setStatus(s) {
    sync.status = s;
    const el = document.getElementById("hSync");
    const acc = s === "account" ? "zapisane na twoim koncie" : s === "error" ? "nie udało się zapisać na koncie, próbuję ponownie" : "";
    if (el) el.textContent = [deviceText(), acc].filter(Boolean).join(" · ");
  }
  const isTyping = () => { const a = document.activeElement; return a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type === "text")); };

  /* ================= stopwatch (kept on this device, survives closing the app) ================= */
  let timer = null;
  function saveTimer() {
    if (!persist) return { ok: true, saved: Promise.resolve() };
    try { return { ok: true, saved: persist.saveTimer(timer) }; }
    catch (e) { timer = persist.loadTimer(); setTimeout(() => render(), 0); return { ok: false, saved: settled(e) }; }
  }
  // success messages only after the store confirmed the save
  function afterSave(results, fn) {
    if (results.some(r => !r.ok)) return;
    if (persist && persist.whenSaved) persist.whenSaved({ ok: true, saved: Promise.all(results.map(r => r.saved)) }, fn);
    else fn();
  }
  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(x);
  }
  function startTimer(h) {
    if (timer) stopTimer(true, true);
    timer = { hid: h.id, start: Date.now() }; saveTimer(); render();
  }
  // save=true adds the minutes to the day the stopwatch was started
  function stopTimer(save, quiet) {
    if (!timer) return;
    const h = findH(timer.hid), ms = Date.now() - timer.start, k = dayKey(new Date(timer.start));
    const mins = Math.round(ms / 60000);
    timer = null; const tr = saveTimer();
    if (save && h && mins > 0) {
      const vr = setVal(h, k, Math.round(((val(S, k, h) || 0) + mins) * 100) / 100);
      afterSave([tr, vr], () => toast(`Dopisano ${fmtMin(mins)} do: ${h.name}`));
    } else {
      render();
      if (save && !quiet) toast("Stoper działał krócej niż pół minuty, nic nie dopisano.");
    }
  }
  function tick() {
    if (!timer) return;
    const t = clock(Date.now() - timer.start);
    document.querySelectorAll("[data-timer]").forEach(el => { el.textContent = t; });
  }
  function toast(text) {
    if (g.Rytm && g.Rytm.notify) return g.Rytm.notify.info(text);
    const el = document.createElement("div");
    el.className = "h-toast"; el.setAttribute("role", "status"); el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ================= UI ================= */
  let S = defaults();               // replaced by the stored habits in attach()
  let selDay = todayKey();
  let weekOffset = 0;              // 0 = this week
  let tab = "day";                 // day | stats
  let statsRange = 30;              // 7 | 30 | 90 | 0 = whole history
  let skipAsk = false;
  const SKIP_REASONS = ["Choroba", "Wyjazd", "Odpoczynek", "Inny powód"];
  let mode = { view: "list" };     // list | manage | detail | form
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const longDate = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  const dayMonth = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
  const DOW_NAMES = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const pct = r => r === null || r === undefined ? "–" : Math.round(r * 100) + "%";
  const findH = id => S.habits.find(x => x.id === id);

  const TEMPLATES = [
    { name: "Trening", type: "time", dir: "min", goal: 20, step: 5, icon: "💪" },
    { name: "Woda", type: "count", target: 8, icon: "💧" },
    { name: "Czytanie", type: "time", dir: "min", goal: 20, step: 5, icon: "📖" },
    { name: "Angielski", type: "time", dir: "min", goal: 15, step: 5, icon: "🇬🇧" },
    { name: "Rozciąganie", type: "time", dir: "min", goal: 10, step: 5, icon: "🧘" },
    { name: "Telefon", type: "time", dir: "max", goal: 120, step: 15, icon: "📱" },
    { name: "Bez ekranu przed snem", type: "bool", icon: "🌙" },
  ];

  function setVal(h, k, v, soft) {
    const day = S.log[k] || (S.log[k] = {});
    if (v === null || v === undefined) delete day[h.id]; else day[h.id] = v;
    if (!Object.keys(day).length) delete S.log[k];
    const r = saveLocal(); if (r.ok) queueWrite(monthOf(k));
    // after typing, re-render a moment later so a tap on another button is not lost
    if (soft) setTimeout(() => { if (!isTyping()) render(); }, 250); else render();
    return r;
  }
  function saveHabits() { const r = saveLocal(); if (r.ok) queueWrite("habits"); return r; }

  function ring(frac, size, stroke, colorVar, inner = "", dashed = false) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${dashed ? "var(--muted)" : "var(--ring-track)"}" stroke-width="${dashed ? Math.max(1.5, stroke / 3) : stroke}"${dashed ? ` stroke-dasharray="${(c / 24).toFixed(2)} ${(c / 24).toFixed(2)}"` : ""}/>
      ${f > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${colorVar}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ""}${inner}</svg>`;
  }
  const flame = `<svg class="flame" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8.6 1c.3 2.2-1 3.4-2.1 4.6C5.4 6.8 4.5 8 4.5 9.8A3.6 3.6 0 0 0 8 13.5a3.6 3.6 0 0 0 3.5-3.7c0-1.5-.6-2.6-1.3-3.4.1 1-.3 1.8-1 2.1.3-2.6-.2-5.6-.6-7.5Z"/></svg>`;
  // ring with the habit's icon (or a check when done) in the middle
  function habitRing(h, s, size, stroke) {
    const col = `var(--h${h.color % COLORS})`, c = size / 2;
    const inner = h.icon
      ? `<text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" class="h-ico" style="font-size:${Math.round(size * 0.42)}px">${esc(h.icon)}</text>`
      : s === 1 ? `<path d="M${c - 7} ${c + 0.5}l5 5 9-10" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    return ring(s || 0, size, stroke, col, inner);
  }
  const cellClass = sc => sc === -1 ? "pre" : sc === -2 ? "off" : sc === -3 ? "skip" : sc === null ? "none" : sc === 1 ? "full" : sc > 0 ? "part" : "miss";
  const cellStyle = sc => `--o:${sc > 0 && sc < 1 ? (0.25 + sc * 0.5).toFixed(2) : 1}`;
  const dayCell = (h, k) => k < since(S, h) ? -1 : isSkipped(S, k) ? -3 : !scheduled(h, k) ? -2 : score(h, val(S, k, h));

  function weekDays() {
    const t = fromKey(todayKey()); const dow = (t.getDay() + 6) % 7;
    const mon = new Date(t); mon.setDate(t.getDate() - dow + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return dayKey(d); });
  }

  function render() {
    const root = $("habitsRoot"); if (!root) return;
    const today = todayKey();
    if (selDay > today) selDay = today;
    if (mode.view === "detail" && !findH(mode.id)) mode = { view: "list" };
    let html;
    if (mode.view === "form") html = formView();
    else if (mode.view === "detail") html = detailView();
    else if (mode.view === "manage") html = manageView();
    else html = segmented() + (tab === "stats" ? statsView() : dayView());
    root.innerHTML = html;
    setStatus(sync.status);
  }

  function segmented() {
    return `<div class="seg" role="tablist" aria-label="Widok nawyków">
      <button role="tab" class="seg-b" data-act="tab" data-t="day" aria-selected="${tab === "day"}">Dzień</button>
      <button role="tab" class="seg-b" data-act="tab" data-t="stats" aria-selected="${tab === "stats"}">Statystyki</button></div>`;
  }

  /* ----- day view ----- */
  function dayView() {
    const today = todayKey(), sum = daySummary(S, selDay);
    const allDone = sum.total > 0 && sum.done === sum.total;
    const days = weekDays(), isToday = selDay === today;
    const label = isToday ? "Dziś" : selDay === addDays(today, -1) ? "Wczoraj" : DOW_NAMES[dowOf(selDay)];
    const shown = S.habits.filter(h => !h.paused && scheduled(h, selDay));
    const off = S.habits.filter(h => !h.paused && !scheduled(h, selDay));
    const paused = S.habits.filter(h => h.paused);
    const skipped = isSkipped(S, selDay), reason = skipped ? S.skips[selDay] : "";
    let html = `
    <div class="h-hero${allDone ? " all" : ""}${skipped ? " skipped" : ""}">
      <div class="h-dayring">${skipped ? ring(0, 132, 12, "var(--muted)", "", true) : ring(sum.frac, 132, 12, allDone ? "var(--rope)" : "var(--accent)")}
        <div class="h-dayring-in">${skipped
          ? `<span class="h-frac">–</span><span class="h-lbl">pominięty</span>`
          : `<span class="h-frac">${sum.done}<small>/${sum.total}</small></span><span class="h-lbl">${allDone ? "komplet" : "zrobione"}</span>`}</div></div>
      <div class="h-hero-text">
        <p class="h-eyebrow">${esc(label)}</p>
        <h2 class="h-date">${esc(longDate.format(fromKey(selDay)))}</h2>
        <p class="h-msg">${skipped ? "Ten dzień nie liczy się do statystyk ani serii." : heroMsg(sum, isToday)}</p>
      </div>
    </div>
    <div class="h-week" role="group" aria-label="Wybierz dzień">
      <button class="h-wnav" data-act="week" data-d="-1" aria-label="Poprzedni tydzień">‹</button>
      ${days.map((k, i) => {
        const fut = k > today, s = fut ? null : daySummary(S, k), sk = !fut && s.skipped;
        return `<button class="h-wd${k === selDay ? " sel" : ""}${k === today ? " today" : ""}${sk ? " skip" : ""}" data-act="day" data-k="${k}" ${fut ? "disabled" : ""} aria-pressed="${k === selDay}" aria-label="${esc(longDate.format(fromKey(k)))}${sk ? ", pominięty" : ""}">
          <span class="h-dow">${DOW_SHORT[i]}</span>${ring(s ? s.frac : 0, 34, 4, s && s.total && s.done === s.total ? "var(--rope)" : "var(--accent)", `<text x="17" y="17" text-anchor="middle" dominant-baseline="central" class="h-wnum">${fromKey(k).getDate()}</text>`, sk)}</button>`;
      }).join("")}
      <button class="h-wnav" data-act="week" data-d="1" aria-label="Następny tydzień" ${weekOffset >= 0 ? "disabled" : ""}>›</button>
    </div>
    <div class="h-list">`;
    if (skipped) {
      html += `<div class="h-skipped"><strong>Dzień pominięty${reason ? `: ${esc(reason.toLowerCase())}` : ""}</strong>
        <p class="meta">Odhaczenia z tego dnia są ukryte i nie liczą się do statystyk. Serie się nie przerywają.</p>
        <div class="actions"><button class="btn" data-act="unskip">Przywróć ten dzień</button></div></div></div>`;
    } else {
      if (!S.habits.length) html += `<div class="h-empty"><p>Nie masz jeszcze żadnego nawyku.</p><p class="meta">Dodaj pierwszy, np. czytanie 20 minut albo 8 szklanek wody.</p></div>`;
      for (const hb of shown) html += card(hb);
      html += `</div>`;
      html += skipAsk
        ? `<div class="h-skipask"><strong>Dlaczego pomijasz ten dzień?</strong><p class="meta">Pominięty dzień nie liczy się do statystyk ani serii. Możesz go później przywrócić.</p>
            <div class="h-tpl">${SKIP_REASONS.map(r => `<button class="chip" data-act="skipSet" data-r="${esc(r)}">${esc(r)}</button>`).join("")}<button class="btn link" data-act="skipNo">Anuluj</button></div></div>`
        : S.habits.length ? `<div class="h-skiprow"><button class="btn link" data-act="skipAsk">Pomiń ten dzień</button><span class="meta">choroba, wyjazd albo inny wyjątkowy dzień</span></div>` : "";
    }
    if (!skipped && (off.length || paused.length)) html += `<p class="h-off meta">${off.length ? `Wolne ${isToday ? "dziś" : "tego dnia"}: ${off.map(h => esc(h.name)).join(", ")}.` : ""}${off.length && paused.length ? " " : ""}${paused.length ? `Wstrzymane: ${paused.map(h => esc(h.name)).join(", ")}.` : ""}</p>`;
    html += `<label class="h-note"><span>Notatka dnia</span>
      <textarea id="hNote" data-act="note" rows="2" maxlength="500" placeholder="Co dziś poszło dobrze? Co jutro zrobisz inaczej?">${esc(S.notes[selDay] || "")}</textarea></label>
    <div class="h-foot">
      <div class="actions"><button class="btn primary" data-act="add">+ Dodaj nawyk</button>${S.habits.length ? `<button class="btn" data-act="manage">Edytuj listę</button>` : ""}</div>
      <span class="meta" id="hSync"></span></div>`;
    return html;
  }
  function heroMsg(sum, isToday) {
    if (!sum.total) return S.habits.length ? "Na ten dzień nie masz zaplanowanych nawyków." : "Dodaj nawyk, żeby zacząć.";
    if (sum.done === sum.total) return isToday ? "Wszystko odhaczone. Dobra robota." : "Ten dzień był kompletny.";
    const left = sum.total - sum.done;
    if (!isToday && !sum.marked) return `Ten dzień nie ma żadnych wpisów, więc liczy się jako niezrobiony. Uzupełnij go albo pomiń.`;
    return isToday ? `Zostało ${left} ${plural(left, "zadanie", "zadania", "zadań")}. Odhacz wieczorem, co się udało.` : `Brakowało ${left} z ${sum.total}. Możesz jeszcze uzupełnić ten dzień.`;
  }

  function card(h) {
    const v = val(S, selDay, h), s = score(h, v), done = s === 1, st = streak(S, h);
    const col = `var(--h${h.color % COLORS})`;
    let ctl = "";
    if (h.type === "count") {
      ctl = `<div class="h-pills${h.target > 6 ? " many" : ""}" role="group" aria-label="Ile razy">${Array.from({ length: h.target }, (_, i) =>
        `<button class="h-pill${(v || 0) > i ? " on" : ""}" data-act="count" data-h="${h.id}" data-n="${i + 1}" aria-pressed="${(v || 0) > i}" aria-label="${i + 1} z ${h.target}">${i + 1}</button>`).join("")}</div>`;
    } else if (h.type === "bool") {
      ctl = `<div class="h-yn" role="group" aria-label="Czy się udało">
        <button class="h-yes${v === true ? " on" : ""}" data-act="bool" data-h="${h.id}" data-v="1" aria-pressed="${v === true}">✓ Udało się</button>
        <button class="h-no${v === false ? " on" : ""}" data-act="bool" data-h="${h.id}" data-v="0" aria-pressed="${v === false}">✕ Nie</button></div>`;
    } else if (h.type === "time") {
      const run = timer && timer.hid === h.id ? timer : null;
      const canTime = selDay === todayKey();
      ctl = `<div class="h-amt">
        <button class="h-step" data-act="amt" data-h="${h.id}" data-d="-1" aria-label="Mniej o ${h.step || 5} min">−</button>
        <label class="h-amt-box"><input type="text" inputmode="numeric" autocomplete="off" id="amt-${h.id}" data-act="amtin" data-h="${h.id}" value="${v == null ? "" : Math.round(v)}" placeholder="0" aria-label="${esc(h.name)}, minuty"><span>min</span></label>
        <button class="h-step" data-act="amt" data-h="${h.id}" data-d="1" aria-label="Więcej o ${h.step || 5} min">+</button></div>
      <p class="h-tprog meta">${v == null ? `Cel: ${fmtMin(h.goal)}. Pierwszy plus wpisuje cały cel.` : h.dir === "max"
        ? (v <= h.goal ? `Zostało ${fmtMin(h.goal - v)} do limitu` : `Limit przekroczony o ${fmtMin(v - h.goal)}`)
        : (v >= h.goal ? `Cel zrobiony${v > h.goal ? `, ${fmtMin(v - h.goal)} ponad plan` : ""}` : `Brakuje ${fmtMin(h.goal - v)} do celu`)}</p>
      ${canTime ? (run
        ? `<div class="h-timer running"><button class="h-tbtn" data-act="tstop" data-h="${h.id}"><span class="h-dot" aria-hidden="true"></span>Zatrzymaj i dopisz <span class="h-tclock" data-timer>${clock(Date.now() - run.start)}</span></button><button class="btn link" data-act="tdrop">Odrzuć</button></div>`
        : `<div class="h-timer"><button class="h-tbtn" data-act="tstart" data-h="${h.id}">▶ Włącz stoper</button></div>`) : ""}`;
    } else {
      ctl = `<div class="h-amt">
        <button class="h-step" data-act="amt" data-h="${h.id}" data-d="-1" aria-label="Mniej">−</button>
        <label class="h-amt-box"><input type="text" inputmode="decimal" autocomplete="off" id="amt-${h.id}" data-act="amtin" data-h="${h.id}" value="${v == null ? "" : fmtNum(v)}" placeholder="–" aria-label="${esc(h.name)}, wartość"><span>${esc(h.unit || "")}</span></label>
        <button class="h-step" data-act="amt" data-h="${h.id}" data-d="1" aria-label="Więcej">+</button></div>`;
    }
    const strip = Array.from({ length: 14 }, (_, i) => { const sc = dayCell(h, addDays(selDay, i - 13)); return `<i class="${cellClass(sc)}" style="${cellStyle(sc)}"></i>`; }).join("");
    return `<article class="h-card${done ? " done" : ""}" style="--hc:${col}">
      <button class="h-head" data-act="detail" data-h="${h.id}" aria-label="${esc(h.name)}: szczegóły">
        ${habitRing(h, s, 44, 5)}
        <span class="h-title"><strong>${esc(h.name)}</strong><span class="meta">${esc(describe(h))}</span></span>
        <span class="h-streak${st ? "" : " zero"}" title="Seria dni z rzędu">${flame}${st}</span>
      </button>
      ${ctl}
      <div class="h-strip" aria-hidden="true">${strip}</div>
    </article>`;
  }

  /* ----- manage list: reorder, pause, delete ----- */
  function manageView() {
    const confirmId = mode.confirm;
    return `<div class="h-manage">
      <div class="row"><h2 class="h-sub">Edytuj listę</h2><button class="btn primary" data-act="done">Gotowe</button></div>
      <p class="meta">Zmieniaj kolejność strzałkami. Wstrzymany nawyk znika z dnia, ale jego historia zostaje i nie psuje serii.</p>
      <div class="h-mlist">${S.habits.map((h, i) => {
        const col = `var(--h${h.color % COLORS})`;
        if (confirmId === h.id) return `<div class="h-mrow confirm" style="--hc:${col}">
          <span class="h-mname"><strong>Usunąć „${esc(h.name)}”?</strong><span class="meta">Zniknie też cała jego historia.</span></span>
          <span class="h-mbtns"><button class="btn danger" data-act="delYes" data-h="${h.id}">Usuń</button><button class="btn" data-act="delNo">Anuluj</button></span></div>`;
        return `<div class="h-mrow${h.paused ? " paused" : ""}" style="--hc:${col}">
          <span class="h-mmove">
            <button class="icon-btn" data-act="up" data-h="${h.id}" ${i === 0 ? "disabled" : ""} aria-label="Przesuń w górę">↑</button>
            <button class="icon-btn" data-act="down" data-h="${h.id}" ${i === S.habits.length - 1 ? "disabled" : ""} aria-label="Przesuń w dół">↓</button></span>
          ${habitRing(h, 0, 36, 4)}
          <span class="h-mname"><strong>${esc(h.name)}</strong><span class="meta">${h.paused ? `wstrzymany od ${esc(dayMonth.format(fromKey(h.paused)))}` : esc(describe(h))}</span></span>
          <span class="h-mbtns">
            <button class="btn" data-act="edit" data-h="${h.id}">Edytuj</button>
            <button class="btn" data-act="${h.paused ? "resume" : "pause"}" data-h="${h.id}">${h.paused ? "Wznów" : "Wstrzymaj"}</button>
            <button class="btn danger" data-act="delAsk" data-h="${h.id}">Usuń</button></span></div>`;
      }).join("")}</div>
      <div class="actions"><button class="btn" data-act="add">+ Dodaj nawyk</button></div>
    </div>`;
  }

  /* ----- one habit ----- */
  function detailView() {
    const h = findH(mode.id), col = `var(--h${h.color % COLORS})`;
    const today = todayKey(), st = streak(S, h), best = bestStreak(S, h), r7 = rate(S, h, 7), r30 = rate(S, h, 30);
    const confirm = mode.confirm === h.id;
    return `<div class="h-detail" style="--hc:${col}">
      <div class="row"><button class="btn link" data-act="back">‹ Wróć</button><button class="btn" data-act="edit" data-h="${h.id}">Edytuj</button></div>
      <div class="h-dhead">${habitRing(h, score(h, val(S, today, h)), 64, 7)}<div><h2>${esc(h.name)}</h2><p class="meta">${esc(describe(h))} · od ${esc(new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" }).format(fromKey(since(S, h))))}${h.paused ? " · wstrzymany" : ""}</p></div></div>
      <div class="h-stats">
        <div><span class="k">Seria teraz</span><span class="v">${st}<small> ${plural(st, "dzień", "dni", "dni")}</small></span></div>
        <div><span class="k">Najdłuższa seria</span><span class="v">${best}<small> ${plural(best, "dzień", "dni", "dni")}</small></span></div>
        <div><span class="k">Ostatnie 7 dni</span><span class="v">${pct(r7)}</span></div>
        <div><span class="k">Ostatnie 30 dni</span><span class="v">${pct(r30)}</span></div>
      </div>
      <section class="panel"><h3>Ostatnie 12 tygodni</h3>${calendar(k => dayCell(h, k))}${legend(true)}</section>
      ${h.type === "amount" || h.type === "time" ? amountChart(h) : ""}
      <div class="actions">${confirm
        ? `<button class="btn danger" data-act="delYes" data-h="${h.id}">Usuń nawyk i całą jego historię</button><button class="btn" data-act="delNo">Anuluj</button>`
        : `<button class="btn" data-act="${h.paused ? "resume" : "pause"}" data-h="${h.id}">${h.paused ? "Wznów nawyk" : "Wstrzymaj nawyk"}</button><button class="btn danger" data-act="delAsk" data-h="${h.id}">Usuń nawyk</button>`}</div>
    </div>`;
  }

  // 12-week calendar, rows Monday→Sunday; cellFn(k) -> score / -1 before start / -2 day off
  function calendar(cellFn, opts = {}) {
    const today = todayKey(), start = addDays(today, -dowOf(today) - 7 * 11);
    let cells = "";
    for (let w = 0; w < 12; w++) for (let d = 0; d < 7; d++) {
      const k = addDays(start, w * 7 + d), pos = `grid-column:${w + 1};grid-row:${d + 1}`;
      if (k > today) { cells += `<i class="fut" style="${pos}"></i>`; continue; }
      const sc = cellFn(k);
      cells += `<i class="${cellClass(sc)}${k === today ? " now" : ""}" style="${pos};${cellStyle(sc)}" title="${esc(dayMonth.format(fromKey(k)))}${sc >= 0 && sc !== null ? ": " + pct(sc) : ""}"></i>`;
    }
    return `<div class="h-cal-wrap${opts.cls ? " " + opts.cls : ""}"><div class="h-cal-dows">${DOW_SHORT.map(d => `<span>${d}</span>`).join("")}</div><div class="h-cal">${cells}</div></div>`;
  }
  function legend(withOff) {
    return `<div class="h-legend"><span><i class="full"></i>zrobione</span><span><i class="part" style="--o:.5"></i>częściowo</span><span><i class="miss"></i>nie udało się</span><span><i class="none"></i>nie zaznaczone</span>${withOff ? `<span><i class="off"></i>wolne</span>` : ""}<span><i class="skip"></i>pominięty</span></div>`;
  }

  function amountChart(h) {
    const unitTxt = v => h.type === "time" ? fmtMin(v) : `${fmtNum(v)} ${h.unit || ""}`.trim();
    const today = todayKey(), n = 30, W = 320, H = 150, L = 30, B = 22, T = 14;
    const vals = Array.from({ length: n }, (_, i) => { const k = addDays(today, i - n + 1); return { k, v: val(S, k, h) }; });
    const maxV = Math.max(h.goal * 1.25, ...vals.map(x => x.v || 0));
    const nice = maxV <= 5 ? Math.ceil(maxV) : maxV <= 12 ? Math.ceil(maxV / 2) * 2 : Math.ceil(maxV / 5) * 5;
    const y = v => T + (H - T - B) * (1 - v / nice), bw = (W - L) / n;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="h-chart" role="img" aria-label="${esc(h.name)}: ostatnie 30 dni">`;
    for (const tk of [0, nice / 2, nice]) s += `<line x1="${L}" x2="${W}" y1="${y(tk)}" y2="${y(tk)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(tk) + 4}" text-anchor="end" class="h-axis">${fmtNum(tk)}</text>`;
    vals.forEach((x, i) => {
      if (x.v == null) return;
      const ok = isDone(h, x.v), top = y(x.v), x0 = L + i * bw + 1;
      s += `<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0, y(0) - top).toFixed(1)}" rx="2" fill="var(--hc)" opacity="${ok ? 1 : 0.4}"><title>${esc(dayMonth.format(fromKey(x.k)))}: ${esc(unitTxt(x.v))}</title></rect>`;
    });
    s += `<line x1="${L}" x2="${W}" y1="${y(h.goal)}" y2="${y(h.goal)}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    s += `<text x="${W}" y="${y(h.goal) - 5}" text-anchor="end" class="h-axis strong">${h.dir === "max" ? "limit" : "cel"} ${esc(unitTxt(h.goal))}</text>`;
    s += `<text x="${L}" y="${H - 5}" class="h-axis">30 dni temu</text><text x="${W}" y="${H - 5}" text-anchor="end" class="h-axis">dziś</text></svg>`;
    return `<section class="panel"><h3>Ostatnie 30 dni</h3><p class="meta">Pełny kolor: cel osiągnięty. Jaśniejszy: nie.</p>${s}</section>`;
  }

  /* ----- all habits ----- */
  function statsView() {
    const today = todayKey(), O = overall(S, statsRange, today), n = O.n;
    if (!S.habits.length) return `<div class="h-empty"><p>Dodaj nawyk, żeby zobaczyć statystyki.</p></div>`;
    const rows = S.habits.map(h => ({ h, r: rate(S, h, n, today), st: streak(S, h, today), best: bestStreak(S, h, today) }))
      .sort((a, b) => (b.r ?? -1) - (a.r ?? -1));
    const empty = !O.days.length;
    const period = statsRange ? `ostatnich ${statsRange} dniach` : `całej historii (${n} ${plural(n, "dzień", "dni", "dni")})`;
    return `
    <div class="row"><h2 class="h-sub">Wszystkie nawyki</h2>
      <div class="seg small" role="group" aria-label="Okres">${[[7, "7 dni"], [30, "30 dni"], [90, "90 dni"], [0, "Wszystko"]].map(([v, l]) => `<button class="seg-b" data-act="range" data-n="${v}" aria-pressed="${statsRange === v}">${l}</button>`).join("")}</div></div>
    ${empty ? `<div class="h-empty"><p>Jeszcze nie ma czego liczyć.</p><p class="meta">Odhacz nawyki przez kilka dni, a tu pojawią się średnie, wykresy i ranking.</p></div>` : ""}
    <div class="h-stats six">
      <div><span class="k">Średnio</span><span class="v">${pct(O.avg)}</span><span class="meta">wykonania dziennie</span></div>
      <div><span class="k">Pełne dni</span><span class="v">${O.full}<small> z ${O.days.length}</small></span><span class="meta">wszystko odhaczone</span></div>
      <div><span class="k">Seria pełnych dni</span><span class="v">${O.fullStreak}</span><span class="meta">${plural(O.fullStreak, "dzień", "dni", "dni")} z rzędu</span></div>
      <div><span class="k">Najlepszy dzień</span><span class="v small-v">${O.bestDow === null ? "–" : DOW_NAMES[O.bestDow]}</span><span class="meta">${O.bestDow === null ? "za mało danych" : pct(O.dowAvg[O.bestDow]) + " średnio"}</span></div>
      <div><span class="k">Bez wpisu</span><span class="v">${O.unfilled}<small> ${plural(O.unfilled, "dzień", "dni", "dni")}</small></span><span class="meta">liczą się jako 0%</span></div>
      <div><span class="k">Pominięte</span><span class="v">${O.skipped}<small> ${plural(O.skipped, "dzień", "dni", "dni")}</small></span><span class="meta">nie liczą się wcale</span></div>
    </div>
    <p class="note">Statystyki biorą pod uwagę każdy dzień w ${period}, także te bez żadnego wpisu. Jeśli jakiś dzień był wyjątkowy, np. choroba, otwórz go w widoku Dzień i wybierz „Pomiń ten dzień”.</p>
    ${empty ? "" : `<section class="panel"><h3>Wykonanie dzień po dniu</h3><p class="meta">Złote słupki: wszystko odhaczone. Kreska przy osi: dzień bez wpisu. Kratka: dzień pominięty.</p>${dailyChart(O)}</section>`}
    <section class="panel"><h3>Ranking nawyków</h3><p class="meta">Procent zaplanowanych dni z wykonanym nawykiem w ${period}.</p>
      <div class="h-rank">${rows.map(({ h, r, st, best }) => `
        <button class="h-rrow" data-act="detail" data-h="${h.id}" style="--hc:var(--h${h.color % COLORS})">
          <span class="h-rname">${h.icon ? `<span class="h-ricon">${esc(h.icon)}</span>` : `<span class="h-rdot"></span>`}<strong>${esc(h.name)}</strong>${h.paused ? `<span class="meta"> · wstrzymany</span>` : ""}</span>
          <span class="h-rbar"><span style="width:${r === null ? 0 : Math.round(r * 100)}%"></span></span>
          <span class="h-rpct">${pct(r)}</span>
          <span class="h-rmeta meta">${flame}${st} · rekord ${best}</span>
        </button>`).join("")}</div></section>
    ${empty ? "" : `<section class="panel"><h3>Dni tygodnia</h3><p class="meta">Średnie wykonanie w każdy dzień tygodnia.</p>${dowChart(O)}</section>`}
    <section class="panel"><h3>Ostatnie 12 tygodni</h3><p class="meta">Im mocniejszy kolor, tym więcej zrobionych nawyków tego dnia.</p>
      ${calendar(k => { if (isSkipped(S, k)) return k < firstDay(S) ? -1 : -3; const s = daySummary(S, k); if (!s.total) return -1; if (k === today && !s.marked) return null; return s.frac; }, { cls: "overall" })}
      <div class="h-legend"><span><i class="full"></i>wszystko</span><span><i class="part" style="--o:.5"></i>część</span><span><i class="miss"></i>nic albo brak wpisu</span><span><i class="skip"></i>pominięty</span></div></section>
    ${notesList()}`;
  }

  // one slot per calendar day in the range: bar (done share), tick (no entry), hatch (skipped)
  function dailyChart(O) {
    const W = 320, H = 150, L = 34, B = 22, T = 10, list = O.all, n = list.length;
    const y = v => T + (H - T - B) * (1 - v), bw = (W - L) / Math.max(n, 7), thin = bw <= 6;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="h-chart" role="img" aria-label="Wykonanie nawyków dzień po dniu">
      <defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" fill="var(--muted)" opacity=".55"/></pattern></defs>`;
    for (const tk of [0, 0.5, 1]) s += `<line x1="${L}" x2="${W}" y1="${y(tk)}" y2="${y(tk)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(tk) + 4}" text-anchor="end" class="h-axis">${tk * 100}%</text>`;
    list.forEach((d, i) => {
      const x0 = L + i * bw + (thin ? 0.5 : 1), w = Math.max(1, bw - (thin ? 1 : 2)), tip = esc(dayMonth.format(fromKey(d.k)));
      if (d.skip) { s += `<rect x="${x0.toFixed(1)}" y="${y(1).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(0) - y(1)).toFixed(1)}" fill="url(#hatch)"><title>${tip}: pominięty</title></rect>`; return; }
      if (!d.marked) { s += `<rect x="${x0.toFixed(1)}" y="${(y(0) - 4).toFixed(1)}" width="${w.toFixed(1)}" height="4" rx="1" fill="var(--muted)" opacity=".6"><title>${tip}: brak wpisu (0%)</title></rect>`; return; }
      const full = d.done === d.total, top = y(d.frac);
      s += `<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(d.frac > 0 ? 1.5 : 0, y(0) - top).toFixed(1)}" rx="${thin ? 0.5 : 2}" fill="${full ? "var(--rope)" : "var(--accent)"}"><title>${tip}: ${d.done}/${d.total} (${pct(d.frac)})</title></rect>`;
    });
    s += `<text x="${L}" y="${H - 5}" class="h-axis">${esc(dayMonth.format(fromKey(list[0].k)))}</text><text x="${W}" y="${H - 5}" text-anchor="end" class="h-axis">${esc(dayMonth.format(fromKey(list[n - 1].k)))}</text></svg>`;
    return s;
  }
  function dowChart(O) {
    const W = 320, H = 130, L = 34, B = 20, T = 10, bw = (W - L) / 7;
    const y = v => T + (H - T - B) * (1 - v);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="h-chart" role="img" aria-label="Średnie wykonanie w dni tygodnia">`;
    for (const tk of [0, 0.5, 1]) s += `<line x1="${L}" x2="${W}" y1="${y(tk)}" y2="${y(tk)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(tk) + 4}" text-anchor="end" class="h-axis">${tk * 100}%</text>`;
    O.dowAvg.forEach((v, i) => {
      const x0 = L + i * bw + 6, w = bw - 12;
      s += `<text x="${(x0 + w / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" class="h-axis${i === O.bestDow ? " strong" : ""}">${DOW_SHORT[i]}</text>`;
      if (v === null) return;
      const top = y(v);
      s += `<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(v > 0 ? 1.5 : 0, y(0) - top).toFixed(1)}" rx="4" fill="var(--accent)" opacity="${i === O.bestDow ? 1 : 0.55}"><title>${DOW_NAMES[i]}: ${pct(v)}</title></rect>`;
    });
    return s + `</svg>`;
  }
  function notesList() {
    const ks = Object.keys(S.notes).filter(k => S.notes[k]).sort().reverse().slice(0, 6);
    if (!ks.length) return "";
    return `<section class="panel"><h3>Ostatnie notatki</h3><ul class="h-notes">${ks.map(k => `<li><span class="meta">${esc(longDate.format(fromKey(k)))}</span><p>${esc(S.notes[k])}</p></li>`).join("")}</ul></section>`;
  }

  /* ----- add / edit form ----- */
  function formView() {
    const old = mode.id ? findH(mode.id) : null;
    const f = mode.draft || old || { name: "", type: "count", target: 2, dir: "min", goal: 1, unit: "", step: 1, color: S.habits.length % COLORS, icon: "", days: [0, 1, 2, 3, 4, 5, 6] };
    const t = f.type, days = Array.isArray(f.days) && f.days.length ? f.days : [0, 1, 2, 3, 4, 5, 6];
    const confirm = mode.confirm === (old && old.id);
    return `<form class="h-form" id="hForm" novalidate>
      <div class="row"><button type="button" class="btn link" data-act="cancel">‹ Anuluj</button></div>
      <h2>${old ? "Edytuj nawyk" : "Nowy nawyk"}</h2>
      ${old ? "" : `<div class="fld"><span>Szybki wybór</span><div class="h-tpl">${TEMPLATES.map((tp, i) => `<button type="button" class="chip" data-act="tpl" data-i="${i}">${esc(tp.icon)} ${esc(tp.name)}</button>`).join("")}</div></div>`}
      <div class="fld-row name-row">
        <label class="fld"><span>Nazwa</span><input id="hfName" maxlength="40" value="${esc(f.name)}" placeholder="np. Czytanie" required></label>
        <label class="fld icon-fld"><span>Ikonka</span><input id="hfIcon" maxlength="4" value="${esc(f.icon || "")}" placeholder="📚" aria-describedby="hfIconHint"></label>
      </div>
      <p class="meta" id="hfIconHint">Ikonka jest opcjonalna. Wpisz emoji z klawiatury albo zostaw puste.</p>
      <fieldset class="fld"><legend>Jak go odhaczasz</legend>
        <div class="h-types">
          ${[["count", "Ile razy", "np. 3 razy mycie zębów"], ["bool", "Tak / nie", "np. bez słodyczy"], ["time", "Czas", "np. trening 20 min, ze stoperem"], ["amount", "Liczba z celem", "np. 7 godz. snu"]].map(([id, nm, ex]) =>
            `<label class="h-type"><input type="radio" name="hfType" id="hfType-${id}" value="${id}" ${t === id ? "checked" : ""}><span><strong>${nm}</strong><span class="meta">${ex}</span></span></label>`).join("")}
        </div></fieldset>
      <div class="fld-row" ${t === "count" ? "" : "hidden"} id="hfCount"><label class="fld"><span>Ile razy dziennie</span><input id="hfTarget" type="number" inputmode="numeric" min="1" max="12" value="${f.target || 2}"></label></div>
      <div class="fld-row" ${t === "time" ? "" : "hidden"} id="hfTime">
        <label class="fld"><span>Cel</span><select id="hfTDir"><option value="min" ${!(t === "time" && f.dir === "max") ? "selected" : ""}>co najmniej</option><option value="max" ${t === "time" && f.dir === "max" ? "selected" : ""}>najwyżej</option></select></label>
        <label class="fld"><span>Czas</span><input id="hfTGoal" inputmode="text" autocomplete="off" value="${t === "time" && Number.isFinite(f.goal) ? esc(fmtMin(f.goal)) : "20 min"}" placeholder="20 min, 1 h 30 min" aria-describedby="hfTHint"></label>
        <label class="fld"><span>Krok + / −</span><select id="hfTStep">${[1, 5, 10, 15, 30].map(n => `<option value="${n}" ${(t === "time" ? (f.step || 5) : 5) === n ? "selected" : ""}>${n} min</option>`).join("")}</select></label>
        <p class="meta" id="hfTHint">Możesz wpisać np. 20, 45 min, 1:30 albo 1 h 15 min.</p>
      </div>
      <div class="fld-row" ${t === "amount" ? "" : "hidden"} id="hfAmount">
        <label class="fld"><span>Cel</span><select id="hfDir"><option value="min" ${f.dir !== "max" ? "selected" : ""}>co najmniej</option><option value="max" ${f.dir === "max" ? "selected" : ""}>najwyżej</option></select></label>
        <label class="fld"><span>Wartość</span><input id="hfGoal" inputmode="decimal" value="${t === "amount" && Number.isFinite(f.goal) ? fmtNum(f.goal) : t === "amount" ? "" : "1"}"></label>
        <label class="fld"><span>Jednostka</span><input id="hfUnit" maxlength="12" value="${esc(f.unit || "")}" placeholder="godz., min, szkl."></label>
        <label class="fld"><span>Krok + / −</span><input id="hfStep" inputmode="decimal" value="${fmtNum(Number.isFinite(f.step) && f.step > 0 ? f.step : 1)}"></label>
      </div>
      <fieldset class="fld"><legend>W które dni</legend>
        <div class="h-days">${DOW_SHORT.map((d, i) => `<label class="h-day"><input type="checkbox" name="hfDay" id="hfDay-${i}" value="${i}" ${days.includes(i) ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
        <p class="meta">W pozostałe dni nawyk ma wolne i nie przerywa serii.</p></fieldset>
      <fieldset class="fld"><legend>Kolor</legend><div class="h-colors">
        ${Array.from({ length: COLORS }, (_, i) => `<label class="h-sw" style="--c:var(--h${i})"><input type="radio" name="hfColor" id="hfColor-${i}" value="${i}" ${f.color % COLORS === i ? "checked" : ""}><span aria-label="kolor ${i + 1}"></span></label>`).join("")}
      </div></fieldset>
      <p class="msg" id="hfErr" hidden></p>
      <div class="actions"><button type="submit" class="btn primary">${old ? "Zapisz zmiany" : "Dodaj nawyk"}</button>
        ${old ? (confirm
          ? `<button type="button" class="btn danger" data-act="delYes" data-h="${old.id}">Na pewno usuń</button><button type="button" class="btn" data-act="delNo">Nie usuwaj</button>`
          : `<button type="button" class="btn danger" data-act="delAsk" data-h="${old.id}">Usuń nawyk</button>`) : ""}</div>
    </form>`;
  }
  // read the form into a plain object (used for saving and for keeping input across re-renders)
  function readForm() {
    const num = id => { const x = Number(String($(id).value).replace(",", ".").trim()); return isFinite(x) ? x : NaN; };
    return {
      name: $("hfName").value.trim(), icon: $("hfIcon").value.trim(),
      type: document.querySelector('input[name="hfType"]:checked').value,
      color: Number(document.querySelector('input[name="hfColor"]:checked').value),
      target: Math.round(num("hfTarget")), dir: $("hfDir").value, goal: num("hfGoal"), unit: $("hfUnit").value.trim(), step: num("hfStep"),
      tdir: $("hfTDir").value, tgoal: parseMinutes($("hfTGoal").value), tstep: Number($("hfTStep").value),
      days: [...document.querySelectorAll('input[name="hfDay"]:checked')].map(x => Number(x.value)),
    };
  }
  // form values in the same shape as a saved habit, so the form can be re-drawn with them
  function draftOf(f) {
    return f.type === "time" ? { ...f, dir: f.tdir, goal: f.tgoal, step: f.tstep } : f;
  }
  function submitForm() {
    const f = readForm();
    const err = m => { $("hfErr").textContent = m; $("hfErr").hidden = false; };
    if (!f.name) return err("Wpisz nazwę nawyku.");
    if (!f.days.length) return err("Zaznacz przynajmniej jeden dzień tygodnia.");
    const old = mode.id ? findH(mode.id) : null;
    const h = { id: old ? old.id : "h-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: f.name, type: f.type, color: f.color, created: old ? old.created : todayKey() };
    if (f.icon) h.icon = [...f.icon].slice(0, 2).join("");
    if (f.days.length < 7) h.days = f.days.sort();
    if (old && old.paused) h.paused = old.paused;
    if (old && old.breaks) h.breaks = old.breaks;
    if (f.type === "count") {
      if (!(f.target >= 1 && f.target <= 12)) return err("Ile razy dziennie: wpisz liczbę od 1 do 12.");
      h.target = f.target;
    } else if (f.type === "time") {
      if (!(f.tgoal > 0)) return err("Wpisz czas, np. 20 min albo 1 h 30 min.");
      if (f.tgoal > 24 * 60) return err("Cel nie może być dłuższy niż doba.");
      h.dir = f.tdir; h.goal = f.tgoal; h.step = f.tstep > 0 ? f.tstep : 5;
    } else if (f.type === "amount") {
      if (!(f.goal > 0)) return err("Wpisz cel większy od zera, np. 7.");
      h.dir = f.dir; h.goal = f.goal; h.unit = f.unit; h.step = f.step > 0 ? f.step : 1;
    }
    if (old) {
      // changing the kind of habit makes old entries meaningless, so they are cleared
      if (old.type !== f.type) for (const k of Object.keys(S.log)) { if (S.log[k][old.id] !== undefined) { delete S.log[k][old.id]; queueWrite(monthOf(k)); } }
      S.habits = S.habits.map(x => x.id === old.id ? h : x);
      mode = mode.from === "manage" ? { view: "manage" } : { view: "detail", id: h.id };
    } else { S.habits.push(h); mode = { view: "list" }; tab = "day"; }
    saveHabits(); render();
  }

  function deleteHabit(id) {
    S.habits = S.habits.filter(x => x.id !== id);
    for (const k of Object.keys(S.log)) if (S.log[k][id] !== undefined) { delete S.log[k][id]; if (!Object.keys(S.log[k]).length) delete S.log[k]; queueWrite(monthOf(k)); }
    saveHabits();
  }
  function pauseHabit(h) { h.paused = todayKey(); saveHabits(); }
  function resumeHabit(h) {
    const today = todayKey();
    if (h.paused && h.paused < today) (h.breaks = h.breaks || []).push([h.paused, addDays(today, -1)]);
    delete h.paused; saveHabits();
  }

  function onClick(e) {
    const b = e.target.closest("[data-act]"); if (!b || b.tagName === "INPUT" || b.tagName === "TEXTAREA") return;
    const act = b.dataset.act, h = b.dataset.h && findH(b.dataset.h);
    switch (act) {
      case "tab": tab = b.dataset.t; render(); break;
      case "range": statsRange = Number(b.dataset.n); render(); break;
      case "day": selDay = b.dataset.k; skipAsk = false; render(); break;
      case "week": weekOffset = Math.min(0, weekOffset + Number(b.dataset.d)); { const d = weekDays(); selDay = d.includes(todayKey()) ? todayKey() : d[6]; } skipAsk = false; render(); break;
      case "skipAsk": skipAsk = true; render(); break;
      case "skipNo": skipAsk = false; render(); break;
      case "skipSet": { S.skips[selDay] = b.dataset.r || ""; skipAsk = false; const r = saveLocal(); if (r.ok) queueWrite(monthOf(selDay)); render(); break; }
      case "unskip": { delete S.skips[selDay]; const r = saveLocal(); if (r.ok) queueWrite(monthOf(selDay)); render(); break; }
      case "count": { const n = Number(b.dataset.n), cur = val(S, selDay, h) || 0; setVal(h, selDay, cur === n ? n - 1 : n); break; }
      case "bool": { const v = b.dataset.v === "1", cur = val(S, selDay, h); setVal(h, selDay, cur === v ? null : v); break; }
      case "tstart": startTimer(h); break;
      case "tstop": stopTimer(true); break;
      case "tdrop": stopTimer(false); break;
      case "amt": {
        // "+" adds one step (water 2 l with a step of 0,2 → 0,2 · 0,4 …); with nothing written yet "−" has nothing to take away
        const cur = val(S, selDay, h), step = h.step || (h.type === "time" ? 5 : 1), d = Number(b.dataset.d);
        if (cur == null && d < 0) break;
        setVal(h, selDay, Math.max(0, Math.round(((cur || 0) + d * step) * 100) / 100)); break;
      }
      case "detail": mode = { view: "detail", id: h.id }; render(); scrollTop(); break;
      case "back": mode = { view: "list" }; render(); break;
      case "cancel": mode = mode.id ? (mode.from === "manage" ? { view: "manage" } : { view: "detail", id: mode.id }) : { view: "list" }; render(); break;
      case "add": mode = { view: "form" }; render(); scrollTop(); break;
      case "tpl": { const tp = TEMPLATES[Number(b.dataset.i)], cur = draftOf(readForm()); mode.draft = { ...cur, ...tp, icon: tp.icon, days: tp.days || [0, 1, 2, 3, 4, 5, 6], color: cur.color }; render(); break; }
      case "edit": mode = { view: "form", id: h.id, from: mode.view === "manage" ? "manage" : "detail" }; render(); scrollTop(); break;
      case "manage": mode = { view: "manage" }; render(); scrollTop(); break;
      case "done": mode = { view: "list" }; render(); break;
      case "up": case "down": {
        const i = S.habits.indexOf(h), j = act === "up" ? i - 1 : i + 1;
        if (j >= 0 && j < S.habits.length) { [S.habits[i], S.habits[j]] = [S.habits[j], S.habits[i]]; saveHabits(); render(); }
        break;
      }
      case "pause": pauseHabit(h); render(); break;
      case "resume": resumeHabit(h); render(); break;
      case "delAsk":
        if (mode.view === "form") { mode.draft = draftOf(readForm()); }
        mode.confirm = h.id; render(); break;
      case "delNo": mode.confirm = null; render(); break;
      case "delYes": {
        deleteHabit(h.id);
        mode = mode.view === "manage" || mode.from === "manage" ? { view: "manage" } : { view: "list" };
        render(); break;
      }
    }
  }
  function scrollTop() { try { window.scrollTo({ top: 0 }); } catch (e) {} }
  function onChange(e) {
    const t = e.target;
    if (t.dataset && t.dataset.act === "amtin") {
      const h = findH(t.dataset.h);
      if (h.type === "time") {
        const m = parseMinutes(t.value);
        if (String(t.value).trim() === "") setVal(h, selDay, null, true);
        else if (isFinite(m)) setVal(h, selDay, Math.max(0, m), true);
        else render();
        return;
      }
      const raw = String(t.value).replace(",", ".").replace(/[^\d.]/g, "");
      const n = Number(raw);
      if (raw === "") setVal(h, selDay, null, true);
      else if (isFinite(n)) setVal(h, selDay, Math.max(0, Math.round(n * 100) / 100), true);
      else render();
    }
    if (t.dataset && t.dataset.act === "note") {
      const txt = t.value.trim();
      if (txt) S.notes[selDay] = txt; else delete S.notes[selDay];
      const r = saveLocal(); if (r.ok) queueWrite(monthOf(selDay));
    }
    if (t.name === "hfType") { $("hfCount").hidden = t.value !== "count"; $("hfAmount").hidden = t.value !== "amount"; $("hfTime").hidden = t.value !== "time"; }
  }

  function mount() {
    const root = $("habitsRoot"); if (!root) return;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("submit", e => { e.preventDefault(); submitForm(); });
    root.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.act === "amtin") e.target.blur(); });
    // a new day may start while the app is open
    document.addEventListener("visibilitychange", () => { if (!document.hidden && mode.view === "list" && !isTyping()) render(); });
    setInterval(tick, 1000);
    mounted = true;
    render();
    if (!(persist && persist.readOnly)) connect();
  }
  let mounted = false;
  // the app gives the data source; called again after migration, import or a change of mode
  function attach(p) {
    persist = p;
    S = loadLocal() || defaults();
    timer = persist.loadTimer ? persist.loadTimer() : null;
    if (timer && !findH(timer.hid)) timer = null;
    mode = { view: "list" }; skipAsk = false;
    if (mounted) { render(); if (!persist.readOnly && !sync.col) connect(); }
  }
  const currentTimer = () => (timer ? clone(timer) : null);

  // ---- backup ----
  function exportState() { return clone(S); }
  // Replaces all habit data on this device (and on the account inside Claude). Returns false if the device write failed.
  function importState(ns) {
    S = { habits: clone(ns.habits || []), log: clone(ns.log || {}), notes: clone(ns.notes || {}), skips: clone(ns.skips || {}) };
    mode = { view: "list" }; tab = "day"; selDay = todayKey(); weekOffset = 0; skipAsk = false;
    if (timer && !findH(timer.hid)) { timer = null; saveTimer(); }
    const ok = saveLocal().ok;
    if (sync.col) {
      const keep = new Set(["habits", ...allMonths()]);
      for (const id of sync.serverDocs) if (!keep.has(id)) {
        sync.dirty.add(id);
        sync.col.doc(id).delete().then(() => sync.dirty.delete(id)).catch(e => { setStatus("error"); say.error("Nie udało się usunąć starych nawyków z konta", [String(e && (e.code || e.message) || e)], { key: "sync-del" }); });
      }
      queueWrite("habits"); allMonths().forEach(queueWrite);
    }
    render();
    return ok;
  }

  g.Habits = { core, mount, attach, render, exportState, importState, currentTimer, refreshStatus: () => setStatus(sync.status), _state: () => S, _setState: s => { S = s; } };
  if (typeof module !== "undefined" && module.exports) module.exports = g.Habits;
})(typeof window !== "undefined" ? window : globalThis);
