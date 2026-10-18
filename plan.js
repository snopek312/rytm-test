// Rytm: the day (Dziś) — one place for everything: today's lessons (from the timetable), habits, announced tests
// (Szkoła — added here or there, it is the same list), competitions (Frekwencja), steps of goals (Cele) and the user's
// own events in his own categories (a name, a colour, in the legend or not); the next 7 days; a month calendar; the
// timetable editor with the bell times, and a timetable code that can be pasted in (and copied out).
// Trainings are not shown here on purpose: they have their own place (Pływanie).
// Saved state (one record in meta "plan"):
//   {v:1, bells:[{n, from, to}], lessons:{"1":[{n, subject, room}], ..., "5":[...]}, events:[{id, title, date, time, cat, note}],
//    cats:[{id, name, color, legend, builtin}]}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/, CAT_ID = /^[a-z0-9-]{1,24}$/;
  // colours = theme tokens, so they also work in the dark theme
  const COLORS = [["accent", "morski"], ["h0", "niebieski"], ["h5", "fioletowy"], ["h4", "różowy"], ["bad", "czerwony"], ["h1", "pomarańczowy"],
    ["h3", "bursztynowy"], ["rope", "złoty"], ["good", "zielony"], ["h2", "miętowy"], ["muted", "szary"]].map(([k, name]) => ({ k, name }));
  // the categories of what is added by itself (from Szkoła, Frekwencja, Cele): the colour and the legend can change, they cannot be deleted
  const BUILTIN = [{ id: "test", name: "Testy", color: "h0" }, { id: "zaw", name: "Zawody", color: "rope" }, { id: "cel", name: "Kroki celów", color: "h5" }];
  const DEFAULT_CATS = [{ id: "szkola", name: "Szkoła", color: "h1" }, { id: "sport", name: "Sport", color: "h2" }, { id: "wymiana", name: "Wymiana", color: "h4" },
    { id: "rodzina", name: "Rodzina i znajomi", color: "bad" }, { id: "inne", name: "Inne", color: "accent" }];
  // the kinds of tests that can be added from the calendar (ids of Szkoła's categories)
  const TEST_KINDS = ["pk", "spr", "kart", "odp", "prez", "proj", "inne"];
  const BELLS = [["07:10", "07:55"], ["08:00", "08:45"], ["08:55", "09:40"], ["09:50", "10:35"], ["10:55", "11:40"], ["11:50", "12:35"], ["12:45", "13:30"],
    ["13:35", "14:20"], ["14:25", "15:10"], ["15:15", "16:00"], ["16:05", "16:50"]];
  const MAXN = BELLS.length - 1;
  const EXTRA_SUBJECTS = ["Religia", "Etyka", "Godzina z wychowawcą", "Zajęcia dodatkowe", "Okienko"];
  const KIND_ORDER = ["zawody", "test", "cel", "wydarzenie"];
  const CODE_DOW = ["PN", "WT", "SR", "CZ", "PT", "SO", "ND"];
  const DOW_OF = { PN: 1, PON: 1, WT: 2, SR: 3, "ŚR": 3, CZ: 4, CZW: 4, PT: 5, SO: 6, SB: 6, ND: 7, NDZ: 7 };
  const DOW = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
  const pad = n => String(n).padStart(2, "0");
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const isoDow = k => { const w = parseDay(k).getDay(); return w === 0 ? 7 : w; };
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function defaultCats() { return BUILTIN.concat(DEFAULT_CATS).map(c => ({ id: c.id, name: c.name, color: c.color, legend: true, builtin: BUILTIN.some(b => b.id === c.id) })); }
  function normCats(list) {
    if (!Array.isArray(list)) return defaultCats();
    const ids = new Set(), names = new Set(), out = [];
    for (const c of list) {
      if (!c || typeof c.id !== "string" || !CAT_ID.test(c.id) || ids.has(c.id)) continue;
      const b = BUILTIN.find(x => x.id === c.id), name = str(c.name, 24) || (b ? b.name : "");
      if (!name || names.has(name.toLowerCase())) continue;
      ids.add(c.id); names.add(name.toLowerCase());
      out.push({ id: c.id, name, color: COLORS.some(x => x.k === c.color) ? c.color : b ? b.color : "accent", legend: c.legend !== false, builtin: !!b });
    }
    BUILTIN.forEach((b, i) => { if (!ids.has(b.id)) out.splice(Math.min(i, out.length), 0, { id: b.id, name: b.name, color: b.color, legend: true, builtin: true }); });
    return out;
  }
  function defaults() { return { v: 1, bells: BELLS.map(([from, to], n) => ({ n, from, to })), lessons: {}, events: [], cats: defaultCats() }; }
  function normLessons(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter(l => l && Number.isInteger(l.n) && l.n >= 0 && l.n <= MAXN && str(l.subject, 40) && !seen.has(l.n) && seen.add(l.n))
      .map(l => ({ n: l.n, subject: str(l.subject, 40), room: str(l.room, 12) })).sort((a, b) => a.n - b.n);
  }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const D = defaults();
    const bells = D.bells.map(b => { const x = Array.isArray(o.bells) ? o.bells.find(y => y && y.n === b.n) : null; return x && HM.test(x.from || "") && HM.test(x.to || "") && x.to > x.from ? { n: b.n, from: x.from, to: x.to } : b; });
    const lessons = {};
    for (let d = 1; d <= 7; d++) { const ok = normLessons(o.lessons && o.lessons[d]); if (ok.length) lessons[d] = ok; }
    const ids = new Set();
    // an event keeps its category id even when that category was deleted (then it shows as "bez kategorii"; undo brings it back)
    const events = (Array.isArray(o.events) ? o.events : []).filter(e => e && typeof e.id === "string" && e.id && !ids.has(e.id) && str(e.title, 80) && DAY.test(e.date || "") && ids.add(e.id))
      .map(e => ({ id: e.id, title: str(e.title, 80), date: e.date, time: HM.test(e.time || "") ? e.time : null, cat: typeof e.cat === "string" && CAT_ID.test(e.cat) ? e.cat : "inne", note: str(e.note, 200) }));
    return { v: 1, bells, lessons, events, cats: normCats(o.cats) };
  }
  const NO_CAT = { id: "", name: "Bez kategorii", color: "muted", legend: false, builtin: false, missing: true };
  const catOf = (state, id) => state.cats.find(c => c.id === id) || NO_CAT;
  // today's lessons with their bell times
  function lessonsOn(state, k) {
    return (state.lessons[isoDow(k)] || []).map(l => { const b = state.bells.find(x => x.n === l.n); return { n: l.n, subject: l.subject, room: l.room, from: b.from, to: b.to }; });
  }
  // the lesson going on at hh:mm, and the next one
  function nowLesson(list, hm) { return { current: list.find(l => l.from <= hm && hm < l.to) || null, next: list.find(l => l.from > hm) || null }; }

  // everything on day k except the lessons, in a fixed order (timed events first, by their time)
  // src: {school:{tests, subjects}, schoolCats, attendance:{cancelled}, goalsDue(from, to)}
  function agenda(state, src, k) {
    const out = [], s = src || {}, att = s.attendance;
    if (att && has(att.cancelled, k) && att.cancelled[k] === "Zawody") out.push({ kind: "zawody", title: "Zawody", cat: "zaw" });
    const sc = s.school, subj = id => ((sc && sc.subjects) || []).find(x => x.id === id), kindName = id => ((s.schoolCats || []).find(c => c.id === id) || { name: "Test" }).name;
    for (const t of (sc && sc.tests) || []) if (t.date === k)
      out.push({ kind: "test", title: `${subj(t.sid) ? subj(t.sid).name : "?"}${t.retake ? " (poprawa)" : ""}`, sub: t.topic || "", tag: kindName(t.cat).toLowerCase(), cat: "test", tid: t.id, done: !!t.gid });
    for (const x of (s.goalsDue ? s.goalsDue(k, k) : [])) out.push({ kind: "cel", title: x.step.title, sub: x.goal.title, cat: "cel", gid: x.goal.id });
    for (const e of state.events) if (e.date === k) out.push({ kind: "wydarzenie", title: e.title, sub: e.note, time: e.time, cat: e.cat, id: e.id });
    return out.sort((a, b) => (a.time && b.time ? (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) : a.time ? -1 : b.time ? 1 : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)));
  }
  // the days of a month view: whole weeks from Monday; each with the categories on it (for the dots)
  function monthGrid(state, src, y, m) {
    const first = `${y}-${pad(m + 1)}-01`, last = dayKey(new Date(y, m + 1, 0, 12)), out = [];
    for (let k = addDays(first, 1 - isoDow(first)), end = addDays(last, 7 - isoDow(last)); k <= end; k = addDays(k, 1)) {
      const items = agenda(state, src, k);
      out.push({ k, inMonth: k >= first && k <= last, lessons: lessonsOn(state, k).length, cats: [...new Set(items.map(i => i.cat))], count: items.length });
    }
    return out;
  }

  // the timetable as text: one line for the bells, one per day ("PN 1 Fizyka @36 | 2 Język angielski @24")
  function codeOf(state) {
    const lines = ["RYTM PLAN LEKCJI", "DZWONKI " + state.bells.map(b => `${b.n} ${b.from}-${b.to}`).join(" | ")];
    for (let d = 1; d <= 7; d++) { const l = state.lessons[d]; if (l && l.length) lines.push(`${CODE_DOW[d - 1]} ` + l.map(x => `${x.n} ${x.subject}${x.room ? " @" + x.room : ""}`).join(" | ")); }
    return lines.join("\n");
  }
  const hhmm = (h, m) => `${pad(+h)}:${m}`;
  // the code back: {bells: [{n, from, to}] | null, lessons: {dow: [...]}, days, count, errors: [text]}
  function parseCode(text) {
    const res = { bells: null, lessons: {}, days: 0, count: 0, errors: [] };
    const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((line, li) => {
      const m = /^([^\s:]+):?\s*(.*)$/.exec(line), head = m[1].toUpperCase(), parts = m[2].split("|").map(x => x.trim()).filter(Boolean);
      if (head === "RYTM") return;
      if (head === "DZWONKI") {
        const bells = [], seen = new Set();
        for (const p of parts) {
          const b = /^(\d{1,2})[.)]?\s+(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)$/.exec(p);
          const from = b && hhmm(b[2], b[3]), to = b && hhmm(b[4], b[5]);
          if (!b || +b[1] > MAXN || seen.has(+b[1]) || !HM.test(from) || !HM.test(to) || to <= from) { res.errors.push(`Dzwonki: nie rozumiem „${p}”.`); continue; }
          seen.add(+b[1]); bells.push({ n: +b[1], from, to });
        }
        res.bells = bells;
        return;
      }
      const d = DOW_OF[head];
      if (!d) { res.errors.push(`Linia ${li + 1}: nie wiem, co znaczy „${m[1]}” (na początku linii ma być dzień: PN, WT, SR, CZ, PT).`); return; }
      const list = [], seen = new Set();
      for (const p of parts) {
        const x = /^(\d{1,2})[.)]?\s+([^@]+?)(?:\s*@\s*(.+))?$/.exec(p);
        if (!x || +x[1] > MAXN || seen.has(+x[1])) { res.errors.push(`${DOW[d - 1]}: nie rozumiem „${p}”.`); continue; }
        seen.add(+x[1]); list.push({ n: +x[1], subject: x[2].trim().slice(0, 40), room: (x[3] || "").trim().slice(0, 12) });
      }
      if (!has(res.lessons, d)) res.days++;
      res.lessons[d] = list.sort((a, b) => a.n - b.n);
    });
    res.count = Object.values(res.lessons).reduce((a, l) => a + l.length, 0);
    return res;
  }
  // a parsed code put into the state: the bells it has and the days it has (the other days stay)
  function applyCode(state, code) {
    const next = JSON.parse(JSON.stringify(state));
    for (const b of code.bells || []) { const x = next.bells.find(y => y.n === b.n); if (x) { x.from = b.from; x.to = b.to; } }
    for (const d of Object.keys(code.lessons)) next.lessons[d] = code.lessons[d].map(l => Object.assign({}, l));
    return normalize(next);
  }

  const core = { COLORS, BUILTIN, DEFAULT_CATS, TEST_KINDS, BELLS, EXTRA_SUBJECTS, defaults, normalize, catOf, lessonsOn, nowLesson, agenda, monthGrid, codeOf, parseCode, applyCode, isoDow, dayKey, parseDay, addDays, daysBetween };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmPlan = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDay = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  const fmtShortDay = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
  const fmtMonth = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const when = n => (n === 0 ? "dziś" : n === 1 ? "jutro" : n === 2 ? "pojutrze" : n > 0 ? `za ${n} ${plural(n, "dzień", "dni", "dni")}` : n === -1 ? "wczoraj" : `${-n} ${plural(-n, "dzień", "dni", "dni")} temu`);
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };
  const dot = (color, extra) => `<i class="pl-dot${extra ? " " + extra : ""}" style="--c:var(--${esc(color)})" aria-hidden="true"></i>`;

  let S = defaults(), P = null, now = () => new Date();
  const ui = { tab: "dzis", y: null, m: null, sel: null, dow: 1, sheet: null, copy: false, code: null };
  const today = () => dayKey(now());
  const hm = () => { const d = now(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const canWrite = () => !!(P && P.writable && P.writable());
  const src = () => { try { return P && P.sources ? P.sources() : {}; } catch (e) { return {}; } };
  // tests go to Szkoła's list (the same one as "Sprawdziany" there)
  const testsOk = s => !!(P && P.saveTest && s.school && (s.school.subjects || []).length);
  const userCats = () => S.cats.filter(c => !c.builtin);

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; ui.code = null; render(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  // quiet: typing in the timetable — the screen is not redrawn, so the cursor can move on to the next field
  function save(next, okText, undoTo, quiet) {
    if (!P || !P.save) return false;
    const prev = S;
    S = normalize(next);
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { S = normalize(P.load ? P.load() : prev); render(); return false; }
    if (!quiet) render();
    if (okText && P.whenSaved) P.whenSaved(res, () => say().info(okText, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
    return true;
  }

  const item = i => {
    const c = catOf(S, i.cat);
    const tag = i.kind === "test" ? i.tag : i.kind === "zawody" ? "zawody" : i.kind === "cel" ? "krok celu" : c.name.toLowerCase();
    const inner = `${dot(c.color, i.late ? "late" : "")}<span class="pl-it">${i.time ? `<b class="pl-time">${esc(i.time)}</b> ` : ""}${esc(i.title)}${i.done ? " ✓" : ""}${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span><span class="pl-k">${esc(tag)}</span>`;
    const dis = canWrite() ? "" : "disabled";
    if (i.kind === "wydarzenie") return `<li><button type="button" class="pl-item" data-plact="editEv" data-id="${esc(i.id)}" ${dis}>${inner}</button></li>`;
    if (i.kind === "test") return `<li><button type="button" class="pl-item" data-plact="editTest" data-id="${esc(i.tid)}" ${dis}>${inner}</button></li>`;
    if (i.kind === "cel") return `<li><button type="button" class="pl-item" data-plact="go" data-v="goals" data-arg="${esc(i.gid)}">${inner}</button></li>`;
    if (i.kind === "zawody") return `<li><button type="button" class="pl-item" data-plact="go" data-v="swim">${inner}</button></li>`;
    return `<li><div class="pl-item">${inner}</div></li>`;
  };
  const addButtons = (k, s, label) => `<div class="actions"><button type="button" class="btn primary" data-plact="addEv" data-v="${esc(k)}" ${canWrite() ? "" : "disabled"}>+ ${label}</button>${testsOk(s) ? `<button type="button" class="btn" data-plact="addTest" data-v="${esc(k)}" ${canWrite() ? "" : "disabled"}>+ Test</button>` : ""}</div>`;
  function lessonsBlock(k, isToday) {
    const list = lessonsOn(S, k);
    if (!list.length) return isoDow(k) <= 5 ? `<p class="meta">Brak planu lekcji na ten dzień. <button type="button" class="btn link" data-plact="tab" data-v="lekcje">Ułóż plan lekcji</button></p>` : "";
    const t = hm(), nl = isToday ? nowLesson(list, t) : { current: null, next: null };
    return `${isToday && (nl.current || nl.next) ? `<p class="pl-now">${nl.current ? `Teraz: <b>${esc(nl.current.subject)}</b> do ${esc(nl.current.to)}${nl.next ? ` · potem ${esc(nl.next.subject)} (${esc(nl.next.from)})` : " · ostatnia lekcja"}` : `Następna lekcja: <b>${esc(nl.next.subject)}</b> o ${esc(nl.next.from)}`}</p>` : ""}
      <ol class="pl-lessons">${list.map(l => `<li class="${isToday && t >= l.to ? "past" : ""}${nl.current && nl.current.n === l.n ? " now" : ""}"><span class="pl-t">${esc(l.from)}</span><span class="pl-n">${l.n}.</span><span>${esc(l.subject)}</span><span class="meta">${l.room ? "s. " + esc(l.room) : ""}</span></li>`).join("")}</ol>
      <p class="meta">${list.length} ${plural(list.length, "lekcja", "lekcje", "lekcji")}, ${esc(list[0].from)}–${esc(list[list.length - 1].to)}</p>`;
  }

  function todayView() {
    const T = today(), s = src(), items = agenda(S, s, T);
    const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
    const hab = safe(() => (s.habitsOn ? s.habitsOn(T) : null), null);
    const late = safe(() => (s.goalsOverdue ? s.goalsOverdue() : []), []);
    const rev = safe(() => (s.reviewDue ? s.reviewDue() : 0), 0);
    const days = [];
    for (let i = 1; i <= 7; i++) { const k = addDays(T, i), it = agenda(S, s, k); if (it.length) days.push({ k, it }); }
    const tests = days.reduce((a, d) => a + d.it.filter(x => x.kind === "test").length, 0);
    const chips = [hab && hab.total ? `<button type="button" class="chip" data-plact="go" data-v="habits">Nawyki: ${hab.done} z ${hab.total}${hab.done === hab.total ? " ✓" : ""}</button>` : "",
      rev ? `<button type="button" class="chip" data-plact="go" data-v="study">Do powtórki: ${rev}</button>` : "",
      tests ? `<button type="button" class="chip" data-plact="tab" data-v="kalendarz">${tests} ${plural(tests, "test", "testy", "testów")} w 7 dni</button>` : ""].join("");
    return `<section class="panel pl-today">
        <h2>${esc(cap(fmtDay.format(parseDay(T))))}</h2>
        ${chips ? `<div class="lf-chips">${chips}</div>` : ""}
        ${lessonsBlock(T, true)}
        <h3>Dziś</h3>
        ${items.length ? `<ul class="pl-items">${items.map(item).join("")}</ul>` : `<p class="meta">Nic więcej na dziś.</p>`}
        ${addButtons(T, s, "Wydarzenie")}
      </section>
      ${late.length ? `<section class="panel gl-late"><h2>Zaległe kroki celów</h2><ul class="pl-items">${late.slice(0, 6).map(x => item({ kind: "cel", title: x.step.title, sub: `${x.goal.title} · ${when(daysBetween(T, x.step.date))}`, cat: "cel", late: true, gid: x.goal.id })).join("")}</ul></section>` : ""}
      <section class="panel"><h2>Najbliższe 7 dni</h2>
        ${days.length ? days.map(d => `<div class="pl-day"><p class="pl-dh">${esc(cap(fmtShortDay.format(parseDay(d.k))))} <span class="meta">· ${esc(when(daysBetween(T, d.k)))}</span></p><ul class="pl-items">${d.it.map(item).join("")}</ul></div>`).join("")
          : `<p class="meta">W tym tygodniu nie ma testów, zawodów, kroków celów ani wydarzeń.</p>`}
      </section>`;
  }

  function legend() {
    const shown = S.cats.filter(c => c.legend);
    return `<div class="pl-legend">${shown.map(c => `<span>${dot(c.color)}${esc(c.name)}</span>`).join("")}${shown.length ? "" : `<span class="meta">Legenda jest pusta.</span>`}
      <button type="button" class="btn link" data-plact="cats" ${canWrite() ? "" : "disabled"}>Kategorie i legenda</button></div>`;
  }
  function calendarView() {
    const T = today();
    if (ui.y == null) { const d = parseDay(T); ui.y = d.getFullYear(); ui.m = d.getMonth(); }
    if (!ui.sel) ui.sel = T;
    const s = src(), grid = monthGrid(S, s, ui.y, ui.m), sel = ui.sel, items = agenda(S, s, sel);
    return `<section class="panel pl-cal">
        <div class="row pl-mhead"><button type="button" class="icon-btn" data-plact="month" data-v="-1" aria-label="Poprzedni miesiąc">‹</button><h2>${esc(cap(fmtMonth.format(new Date(ui.y, ui.m, 1))))}</h2><button type="button" class="icon-btn" data-plact="month" data-v="1" aria-label="Następny miesiąc">›</button></div>
        <div class="pl-grid" role="grid">${DOW.map(d => `<span class="pl-dow" role="columnheader">${d}</span>`).join("")}
          ${grid.map(c => `<button type="button" class="pl-cell${c.inMonth ? "" : " out"}${c.k === T ? " today" : ""}${c.k === sel ? " sel" : ""}" data-plact="sel" data-v="${c.k}" aria-pressed="${c.k === sel}" aria-label="${esc(fmtShortDay.format(parseDay(c.k)))}${c.count ? `: ${c.count} ${plural(c.count, "wpis", "wpisy", "wpisów")}` : ""}">
            <span>${parseDay(c.k).getDate()}</span><span class="pl-dots">${c.cats.slice(0, 4).map(id => dot(catOf(S, id).color)).join("")}</span></button>`).join("")}</div>
        ${legend()}
      </section>
      <section class="panel"><h2>${esc(cap(fmtDay.format(parseDay(sel))))}</h2>
        ${lessonsBlock(sel, sel === T)}
        ${items.length ? `<ul class="pl-items">${items.map(item).join("")}</ul>` : `<p class="meta">Nic nie jest zaplanowane.</p>`}
        ${addButtons(sel, s, "Wydarzenie w tym dniu")}
      </section>`;
  }

  function codeBlock(dis) {
    const c = ui.code, r = c && c.parsed;
    return `<details class="panel pl-code"${c ? " open" : ""}><summary><h2>Wklej plan z kodu</h2></summary>
        <p class="hint">Cały plan naraz: jedna linia na dzień, lekcje rozdzielone „|”, sala po „@”. Na przykład:<br><code>PN 1 Fizyka @36 | 2 Język angielski @24</code><br>Linia „DZWONKI 0 07:10-07:55 | 1 08:00-08:45 …” zmienia godziny lekcji. Dni, których nie ma w kodzie, zostają bez zmian.</p>
        <textarea class="pl-codein" rows="6" spellcheck="false" autocomplete="off" aria-label="Kod planu lekcji" placeholder="RYTM PLAN LEKCJI&#10;PN 1 Fizyka @36 | 2 Język angielski @24&#10;WT …" ${dis}>${esc(c ? c.text : "")}</textarea>
        <div class="actions"><button type="button" class="btn" data-plact="codeCheck" ${dis}>Sprawdź</button><button type="button" class="btn link" data-plact="codeMine">Pokaż kod mojego planu</button></div>
        ${r ? `<div class="pl-codeprev">
          ${r.count || (r.bells && r.bells.length) ? `<p><b>${r.days} ${plural(r.days, "dzień", "dni", "dni")}, ${r.count} ${plural(r.count, "lekcja", "lekcje", "lekcji")}</b>${r.bells && r.bells.length ? ` i ${r.bells.length} ${plural(r.bells.length, "dzwonek", "dzwonki", "dzwonków")}` : ""}:</p>
            <ul class="pl-codedays">${Object.keys(r.lessons).map(d => `<li><b>${DOW[d - 1]}</b> ${r.lessons[d].map(l => `${l.n}. ${esc(l.subject)}`).join(", ") || "—"}</li>`).join("")}</ul>` : `<p class="meta">Nie ma tu żadnej lekcji.</p>`}
          ${r.errors.length ? `<ul class="sc-err pl-codeerr">${r.errors.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
          ${r.count || (r.bells && r.bells.length) ? `<div class="actions"><button type="button" class="btn primary" data-plact="codeApply" ${dis}>Zastąp plan${r.days ? ` (${r.days} ${plural(r.days, "dzień", "dni", "dni")})` : ""}</button></div>` : ""}</div>` : ""}
      </details>`;
  }
  function lessonsView() {
    const dis = canWrite() ? "" : "disabled", s = src();
    const subjects = [...new Set([...(((s.school && s.school.subjects) || []).map(x => x.name)), ...EXTRA_SUBJECTS])];
    const day = S.lessons[ui.dow] || [];
    return `<section class="panel">
        <h2>Plan lekcji</h2>
        <p class="hint">Wybierz dzień i wpisz przedmioty przy numerach lekcji. Plan pokaże się na ekranie Dziś i w kalendarzu. Zapisuje się od razu.</p>
        <div class="seg small pl-dows" role="group" aria-label="Dzień">${DOW.slice(0, 5).map((d, i) => `<button type="button" class="seg-b" data-plact="dow" data-v="${i + 1}" aria-pressed="${ui.dow === i + 1}">${d}${(S.lessons[i + 1] || []).length ? ` <small>${S.lessons[i + 1].length}</small>` : ""}</button>`).join("")}</div>
        <datalist id="plSubj">${subjects.map(x => `<option value="${esc(x)}"></option>`).join("")}</datalist>
        <ol class="pl-edit">${S.bells.map(b => { const l = day.find(x => x.n === b.n) || { subject: "", room: "" };
          return `<li><span class="pl-n">${b.n}.</span><span class="pl-t" title="${esc(b.from)}–${esc(b.to)}">${esc(b.from)}</span>
            <input type="text" list="plSubj" maxlength="40" placeholder="—" value="${esc(l.subject)}" data-plles="${b.n}" aria-label="Lekcja ${b.n}: przedmiot" ${dis}>
            <input type="text" maxlength="12" placeholder="sala" value="${esc(l.room)}" data-plroom="${b.n}" aria-label="Lekcja ${b.n}: sala" class="pl-room" ${dis}></li>`; }).join("")}</ol>
        <div class="actions"><button type="button" class="btn" data-plact="copyDay" ${dis}>Skopiuj ten dzień na…</button>${ui.copy ? DOW.slice(0, 5).map((d, i) => i + 1 === ui.dow ? "" : `<button type="button" class="chip" data-plact="copyTo" data-v="${i + 1}" ${dis}>${d}</button>`).join("") : ""}</div>
      </section>
      ${codeBlock(dis)}
      <details class="panel pl-bells"><summary><h2>Dzwonki</h2></summary>
        <p class="hint">Godziny lekcji w twojej szkole. Zmień, jeśli są inne.</p>
        <ol class="pl-edit">${S.bells.map(b => `<li><span class="pl-n">${b.n}.</span><input type="time" value="${esc(b.from)}" data-plbell="${b.n}" data-e="from" aria-label="Lekcja ${b.n}: początek" ${dis}><span>–</span><input type="time" value="${esc(b.to)}" data-plbell="${b.n}" data-e="to" aria-label="Lekcja ${b.n}: koniec" ${dis}></li>`).join("")}</ol>
      </details>`;
  }

  function render() {
    const root = $("plRoot"); if (!root) return;
    for (const t of ["dzis", "kalendarz", "lekcje"]) { const b = $("plt-" + t); if (b) b.setAttribute("aria-selected", String(ui.tab === t)); }
    root.innerHTML = ui.tab === "kalendarz" ? calendarView() : ui.tab === "lekcje" ? lessonsView() : todayView();
    renderSheet();
  }

  /* ---------- the sheet: an event, a test, the categories ---------- */
  // ui.sheet = {mode: "ev" | "test" | "cats" | "cat", ev, test, cat, back}; back = where "Gotowe" in the categories goes
  function evForm(d) {
    const cats = userCats();
    return `<label class="sc-field"><span class="k">Co</span><input name="title" type="text" maxlength="80" placeholder="np. Urodziny, dentysta, termin zgłoszenia" value="${esc(d.title)}"></label>
      <div class="lf-2col"><label class="sc-field"><span class="k">Dzień</span><input name="date" type="date" value="${esc(d.date)}"></label>
        <label class="sc-field"><span class="k">Godzina (opcjonalnie)</span><input name="time" type="time" value="${esc(d.time || "")}"></label></div>
      <div class="sc-field"><span class="k">Kategoria</span><div class="sc-cats">${cats.map(c => `<button type="button" class="chip pl-catchip" data-plform="cat" data-v="${esc(c.id)}" aria-pressed="${d.cat === c.id}">${dot(c.color)}${esc(c.name)}</button>`).join("")}
        <button type="button" class="chip" data-plform="cats">✎ Kategorie</button></div></div>
      <label class="sc-field"><span class="k">Notatka</span><input name="note" type="text" maxlength="200" value="${esc(d.note)}"></label>`;
  }
  function testForm(d, s) {
    const subs = (s.school && s.school.subjects) || [], names = s.schoolCats || [];
    const kinds = TEST_KINDS.concat(d.kind && !TEST_KINDS.includes(d.kind) ? [d.kind] : []).filter(id => names.some(c => c.id === id));
    return `<label class="sc-field"><span class="k">Przedmiot</span><select name="sid">${subs.map(x => `<option value="${esc(x.id)}"${x.id === d.sid ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <div class="sc-field"><span class="k">Rodzaj</span><div class="sc-cats">${kinds.map(id => `<button type="button" class="chip" data-plform="kind" data-v="${esc(id)}" aria-pressed="${d.kind === id}">${esc(names.find(c => c.id === id).name)}</button>`).join("")}</div></div>
      <label class="sc-field"><span class="k">Dzień</span><input name="date" type="date" value="${esc(d.date)}"></label>
      <label class="sc-field"><span class="k">Temat</span><input name="topic" type="text" maxlength="200" placeholder="np. Kinematyka" value="${esc(d.topic)}"></label>
      <div class="sc-field"><span class="k">Poprawa?</span><div class="sc-cats"><button type="button" class="chip" data-plform="retake" aria-pressed="${!!d.retake}">To poprawa</button></div></div>
      <p class="meta">Test zapisze się też w Szkole, w „Sprawdzianach”.</p>`;
  }
  function renderSheet() {
    const el = $("plSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const s = src();
    let title, body, actions;
    if (sh.mode === "ev" || sh.mode === "test") {
      const isNew = sh.mode === "ev" ? !sh.ev.id : !sh.test.tid;
      title = sh.mode === "ev" ? (isNew ? "Nowe wydarzenie" : "Edytuj wydarzenie") : (isNew ? "Nowy test" : "Edytuj test");
      const seg = isNew && testsOk(s) ? `<div class="seg small pl-mode" role="group" aria-label="Co dodajesz"><button type="button" class="seg-b" data-plform="mode" data-v="ev" aria-pressed="${sh.mode === "ev"}">Wydarzenie</button><button type="button" class="seg-b" data-plform="mode" data-v="test" aria-pressed="${sh.mode === "test"}">Test</button></div>` : "";
      body = seg + (sh.mode === "ev" ? evForm(sh.ev) : testForm(sh.test, s));
      actions = `<button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-plform="close">Anuluj</button>${isNew ? "" : `<button type="button" class="btn danger" data-plform="del">Usuń</button>`}`;
    } else if (sh.mode === "cats") {
      title = "Kategorie i legenda";
      const used = id => S.events.filter(e => e.cat === id).length;
      body = `<p class="hint">Kolory wpisów w kalendarzu. „W legendzie” — czy kategoria jest opisana pod kalendarzem. Testy, zawody i kroki celów dodają się same: możesz zmienić ich nazwę, kolor i legendę.</p>
        <ul class="pl-cats">${S.cats.map(c => { const n = used(c.id); return `<li>${dot(c.color)}<span class="pl-cn">${esc(c.name)}<small>${c.builtin ? "dodaje się sama" : n ? `${n} ${plural(n, "wydarzenie", "wydarzenia", "wydarzeń")}` : "bez wydarzeń"}</small></span>
          <button type="button" class="chip" data-plform="legend" data-v="${esc(c.id)}" aria-pressed="${c.legend}">W legendzie</button>
          <button type="button" class="icon-btn" data-plform="editCat" data-v="${esc(c.id)}" aria-label="Edytuj kategorię: ${esc(c.name)}">✎</button></li>`; }).join("")}</ul>
        <div class="actions"><button type="button" class="btn" data-plform="newCat">+ Nowa kategoria</button></div>`;
      actions = `<button type="submit" class="btn primary">Gotowe</button>`;
    } else {
      const d = sh.cat, c = d.id ? S.cats.find(x => x.id === d.id) : null;
      title = d.id ? "Edytuj kategorię" : "Nowa kategoria";
      body = `<label class="sc-field"><span class="k">Nazwa</span><input name="name" type="text" maxlength="24" placeholder="np. Basen, Korepetycje, Urodziny" value="${esc(d.name)}"></label>
        <div class="sc-field"><span class="k">Kolor</span><div class="pl-swatches" role="group" aria-label="Kolor">${COLORS.map(x => `<button type="button" class="pl-sw" data-plform="color" data-v="${x.k}" style="--c:var(--${x.k})" aria-pressed="${d.color === x.k}" aria-label="${x.name}" title="${x.name}"></button>`).join("")}</div></div>
        <div class="sc-field"><span class="k">Legenda</span><div class="sc-cats"><button type="button" class="chip" data-plform="catLegend" aria-pressed="${d.legend}">Pokazuj w legendzie</button></div></div>
        <p class="pl-catprev">${dot(d.color)}<b>${esc(d.name || "Nazwa")}</b></p>`;
      actions = `<button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-plform="back">Wróć</button>${c && !c.builtin ? `<button type="button" class="btn danger" data-plform="delCat">Usuń kategorię</button>` : ""}`;
    }
    el.innerHTML = `<div class="sc-backdrop" data-plform="close"></div><form class="panel sc-form" id="plForm" role="dialog" aria-modal="true" aria-labelledby="plTitle" novalidate>
      <h2 id="plTitle">${title}</h2>${body}
      <p class="sc-err" id="plErr" role="alert"></p>
      <div class="actions">${actions}</div></form>`;
  }
  function openSheet(mode, k, extra) {
    const date = k || today(), first = userCats().find(c => c.id === "inne") || userCats()[0];
    const s = src(), subs = (s.school && s.school.subjects) || [];
    ui.sheet = Object.assign({ mode, back: null,
      ev: { id: null, title: "", date, time: "", cat: first ? first.id : "inne", note: "" },
      test: { tid: null, sid: subs[0] ? subs[0].id : "", date, kind: "kart", topic: "", retake: false },
      cat: null }, extra || {});
    renderSheet();
    const f = doc.querySelector('#plForm input[name="title"], #plForm input[name="topic"], #plForm input[name="name"]'); if (f && f.focus) try { f.focus(); } catch (e) {}
  }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function readForm() {
    const f = $("plForm"), sh = ui.sheet; if (!f || !sh) return sh;
    const d = sh.mode === "ev" ? sh.ev : sh.mode === "test" ? sh.test : sh.mode === "cat" ? sh.cat : null;
    if (d) for (const n of ["title", "date", "time", "note", "sid", "topic", "name"]) { const el = f.querySelector(`[name="${n}"]`); if (el) d[n] = el.value; }
    return sh;
  }
  const err = m => { const e = $("plErr"); if (e) e.textContent = m; return false; };
  function submitSheet() {
    const sh = readForm(); if (!sh) return false;
    if (sh.mode === "ev") {
      const d = sh.ev, title = (d.title || "").trim();
      if (!title) return err("Wpisz, co to za wydarzenie.");
      if (!DAY.test(d.date || "")) return err("Wybierz dzień.");
      if (d.time && !HM.test(d.time)) return err("Godzina w formacie gg:mm.");
      const prev = exportState(), next = exportState();
      const rec = { id: d.id || newId("e"), title, date: d.date, time: d.time || null, cat: d.cat || "inne", note: (d.note || "").trim() };
      const old = d.id && next.events.find(x => x.id === d.id);
      if (old) Object.assign(old, rec); else next.events.push(rec);
      closeSheet();
      return save(next, `${old ? "Zapisano" : "Dodano"}: ${title}, ${fmtShortDay.format(parseDay(rec.date))}${rec.time ? " " + rec.time : ""}.`, prev);
    }
    if (sh.mode === "test") {
      const d = sh.test;
      if (!d.sid) return err("Wybierz przedmiot.");
      if (!d.kind) return err("Wybierz rodzaj testu.");
      if (!DAY.test(d.date || "")) return err("Wybierz dzień.");
      const ok = P && P.saveTest ? P.saveTest({ id: d.tid || undefined, sid: d.sid, date: d.date, cat: d.kind, topic: (d.topic || "").trim(), retake: !!d.retake }) : false;
      if (!ok) return err("Nie udało się zapisać testu. Spróbuj jeszcze raz.");
      closeSheet(); render();
      return true;
    }
    if (sh.mode === "cats") { if (sh.back) { sh.mode = sh.back; sh.back = null; renderSheet(); } else closeSheet(); return true; }
    const d = sh.cat, name = (d.name || "").trim();
    if (!name) return err("Wpisz nazwę kategorii.");
    if (S.cats.some(c => c.id !== d.id && c.name.toLowerCase() === name.toLowerCase())) return err("Jest już kategoria o tej nazwie.");
    const prev = exportState(), next = exportState(), old = d.id && next.cats.find(c => c.id === d.id);
    const id = old ? old.id : newId("k");
    if (old) Object.assign(old, { name, color: d.color, legend: !!d.legend }); else next.cats.push({ id, name, color: d.color, legend: !!d.legend });
    if (!old && sh.ev && sh.back === "ev") sh.ev.cat = id;     // a category made while adding an event: chosen for it
    sh.mode = "cats"; sh.cat = null;
    return save(next, `${old ? "Zapisano" : "Dodano"} kategorię: ${name}.`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-plform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.plform, sh = readForm(), v = b.dataset.v;
    if (a === "close") closeSheet();
    else if (a === "mode") { const from = sh.mode === "ev" ? sh.ev : sh.test, to = v === "ev" ? sh.ev : sh.test; to.date = from.date; sh.mode = v === "test" ? "test" : "ev"; renderSheet(); }
    else if (a === "cat") { sh.ev.cat = v; renderSheet(); }
    else if (a === "kind") { sh.test.kind = v; renderSheet(); }
    else if (a === "retake") { sh.test.retake = !sh.test.retake; renderSheet(); }
    else if (a === "cats") { sh.back = sh.mode === "ev" || sh.mode === "test" ? sh.mode : sh.back; sh.mode = "cats"; renderSheet(); }
    else if (a === "newCat") { sh.cat = { id: null, name: "", color: COLORS[(S.cats.length + 3) % COLORS.length].k, legend: true }; sh.mode = "cat"; renderSheet(); const f = doc.querySelector('#plForm input[name="name"]'); if (f && f.focus) try { f.focus(); } catch (x) {} }
    else if (a === "editCat") { const c = S.cats.find(x => x.id === v); if (c) { sh.cat = { id: c.id, name: c.name, color: c.color, legend: c.legend }; sh.mode = "cat"; renderSheet(); } }
    else if (a === "color") { sh.cat.color = v; renderSheet(); }
    else if (a === "catLegend") { sh.cat.legend = !sh.cat.legend; renderSheet(); }
    else if (a === "back") { sh.mode = "cats"; sh.cat = null; renderSheet(); }
    else if (a === "legend") {
      const next = exportState(), c = next.cats.find(x => x.id === v); if (!c) return;
      c.legend = !c.legend;
      save(next);
    }
    else if (a === "delCat") {
      const c = S.cats.find(x => x.id === sh.cat.id); if (!c || c.builtin) return;
      const prev = exportState(), next = exportState(), n = S.events.filter(x => x.cat === c.id).length;
      next.cats = next.cats.filter(x => x.id !== c.id);
      if (sh.ev && sh.ev.cat === c.id) { const f = next.cats.find(x => !x.builtin); sh.ev.cat = f ? f.id : "inne"; }
      sh.mode = "cats"; sh.cat = null;
      save(next, `Usunięto kategorię: ${c.name}.${n ? ` ${n} ${plural(n, "wydarzenie zostaje", "wydarzenia zostają", "wydarzeń zostaje")} bez kategorii.` : ""}`, prev);
    }
    else if (a === "del") {
      if (sh.mode === "test") { const ok = P && P.deleteTest ? P.deleteTest(sh.test.tid) : false; if (!ok) return err("Nie udało się usunąć testu."); closeSheet(); render(); return; }
      const prev = exportState(), next = exportState(), x = next.events.find(y => y.id === sh.ev.id);
      next.events = next.events.filter(y => y.id !== sh.ev.id); closeSheet(); save(next, `Usunięto: ${x ? x.title : ""}.`, prev);
    }
  }

  /* ---------- events on the screen ---------- */
  function onClick(e) {
    const b = e.target.closest("[data-plact]"); if (!b || b.disabled) return;
    const a = b.dataset.plact;
    if (a === "go") { if (P && P.go) P.go(b.dataset.v, b.dataset.arg); }
    else if (a === "tab") showTab(b.dataset.v);
    else if (a === "month") { ui.m += +b.dataset.v; if (ui.m < 0) { ui.m = 11; ui.y--; } if (ui.m > 11) { ui.m = 0; ui.y++; } render(); }
    else if (a === "sel") { ui.sel = b.dataset.v; const d = parseDay(ui.sel); if (d.getMonth() !== ui.m) { ui.y = d.getFullYear(); ui.m = d.getMonth(); } render(); }
    else if (a === "dow") { ui.dow = +b.dataset.v; ui.copy = false; render(); }
    else if (a === "copyDay") { ui.copy = !ui.copy; render(); }
    else if (a === "copyTo") {
      if (!canWrite()) return;
      const prev = exportState(), next = exportState(), to = +b.dataset.v;
      next.lessons[to] = JSON.parse(JSON.stringify(next.lessons[ui.dow] || []));
      ui.copy = false;
      save(next, `Skopiowano plan z ${DOW[ui.dow - 1]} na ${DOW[to - 1]}.`, prev);
    }
    else if (a === "addEv") { if (canWrite()) openSheet("ev", b.dataset.v); }
    else if (a === "addTest") { if (canWrite()) openSheet("test", b.dataset.v); }
    else if (a === "cats") { if (canWrite()) openSheet("cats", today()); }
    else if (a === "editEv") { const x = S.events.find(y => y.id === b.dataset.id); if (x && canWrite()) { openSheet("ev", x.date); ui.sheet.ev = Object.assign({}, x, { time: x.time || "" }); renderSheet(); } }
    else if (a === "editTest") {
      const s = src(), t = ((s.school && s.school.tests) || []).find(y => y.id === b.dataset.id);
      if (t && canWrite()) { openSheet("test", t.date); ui.sheet.test = { tid: t.id, sid: t.sid, date: t.date, kind: t.cat, topic: t.topic || "", retake: !!t.retake }; renderSheet(); }
    }
    else if (a === "codeCheck" || a === "codeMine") {
      const ta = doc.querySelector("#plRoot .pl-codein"), text = a === "codeMine" ? codeOf(S) : ta ? ta.value : "";
      ui.code = { text, parsed: a === "codeMine" ? null : parseCode(text) };
      render();
      const t2 = doc.querySelector("#plRoot .pl-codein"); if (a === "codeMine" && t2 && t2.select) try { t2.focus(); t2.select(); } catch (x) {}
    }
    else if (a === "codeApply") {
      const r = ui.code && ui.code.parsed; if (!r || !canWrite()) return;
      const prev = exportState(), next = applyCode(S, r);
      ui.code = null;
      save(next, `Wczytano plan: ${r.days} ${plural(r.days, "dzień", "dni", "dni")}, ${r.count} ${plural(r.count, "lekcja", "lekcje", "lekcji")}${r.bells && r.bells.length ? `, ${r.bells.length} ${plural(r.bells.length, "dzwonek", "dzwonki", "dzwonków")}` : ""}.`, prev);
    }
  }
  function onChange(e) {
    const el = e.target; if (!canWrite()) return;
    if (el.dataset.plles != null || el.dataset.plroom != null) {
      const n = +(el.dataset.plles != null ? el.dataset.plles : el.dataset.plroom), next = exportState();
      const list = (next.lessons[ui.dow] || []).filter(x => x.n !== n), cur = (S.lessons[ui.dow] || []).find(x => x.n === n) || { subject: "", room: "" };
      const subject = el.dataset.plles != null ? el.value.trim() : cur.subject, room = el.dataset.plroom != null ? el.value.trim() : cur.room;
      if (subject) list.push({ n, subject, room });
      next.lessons[ui.dow] = list;
      save(next, null, null, true);
    } else if (el.dataset.plbell != null) {
      const n = +el.dataset.plbell, next = exportState(), b = next.bells.find(x => x.n === n);
      if (!b || !HM.test(el.value)) { render(); return; }
      b[el.dataset.e] = el.value;
      if (b.to <= b.from) { say().info("Koniec lekcji musi być po jej początku."); render(); return; }
      save(next, null, null, true);
    }
  }
  function showTab(t) { ui.tab = ["dzis", "kalendarz", "lekcje"].includes(t) ? t : "dzis"; ui.copy = false; render(); }
  function mount() {
    const root = $("plRoot"); if (root) { root.addEventListener("click", onClick); root.addEventListener("change", onChange); }
    for (const t of ["dzis", "kalendarz", "lekcje"]) { const b = $("plt-" + t); if (b) b.addEventListener("click", () => showTab(t)); }
    const sh = $("plSheet"); if (sh) { sh.addEventListener("click", onSheetClick); sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); }); }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
  }
  function setClock(fn) { now = fn || (() => new Date()); ui.y = null; ui.sel = null; }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, showTab, ui, canWrite });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmPlan = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
