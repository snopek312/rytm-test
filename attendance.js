// Rytm: attendance ("Frekwencja") — a month calendar filled in from the swimming trainings (Garmin CSV and FIT).
// Training days are Monday to Saturday by default (changeable). A day with a swim counts as present, morning
// (before 12:00) or afternoon; a training day without one counts as absent. A day can be marked by hand:
//   Zawody            — counts as a training attended (shining gold); also on a day off (then as an extra training)
//   Trening odwołany  — the training did not take place: not counted at all (neither an absence nor a skip)
//   Choroba, Wyjazd   — skipped: not counted in the attendance, shown as "pominięte"
//   Nie byłem         — an absence marked by hand (also on a day not known yet, or a swim that was not the training)
//   Byłem (bez zegarka) — a training attended without the watch (no swim in the data): counts as present (18.10.2026)
// A day marked by hand wins over a swim the watch recorded that day: the swim is listed, but not counted.
// Days after the newest data from Garmin are "not known yet" instead of absent, until a newer export is loaded.
// The big number is the attendance of the period of the month on screen: the school year (September – June)
// or the summer holidays (July – August); a new school year starts from zero.
// Saved state: {days:[1..7] (Monday = 1), from:"YYYY-MM-DD"|null (null = from the first swim),
//               cancelled:{day: reason} (marked days, see above), absent:{day: ""} (marked absent by hand),
//               present:{day: ""} (marked present by hand: a training without the watch)}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];
  const MORNING_BEFORE = 12;                 // a training that starts before 12:00 is a morning one
  const REASONS = ["Trening odwołany", "Zawody", "Choroba", "Wyjazd"];      // the saved values
  const MARK_ORDER = ["Zawody", "Trening odwołany", "Choroba", "Wyjazd"];  // the order of the buttons
  // each mark: status of the day, css class and the short label in the calendar
  const KINDS = { "Trening odwołany": { cls: "odw", label: "odw.", s: "odwolany" }, "Zawody": { cls: "zaw", label: "zaw.", s: "zawody" },
    "Choroba": { cls: "chor", label: "chor.", s: "pominiety" }, "Wyjazd": { cls: "wyj", label: "wyj.", s: "pominiety" } };
  const kindOf = reason => KINDS[reason] || { cls: "inne", label: "pom.", s: "pominiety" };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };   // noon: safe across DST
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const isoDow = k => { const w = parseDay(k).getDay(); return w === 0 ? 7 : w; };
  const slotOf = date => (date.getHours() < MORNING_BEFORE ? "rano" : "popoludnie");

  // the period a day belongs to: the school year (1 September – 30 June) or the summer holidays (1 July – 31 August)
  function periodOf(k) {
    const d = parseDay(k), y = d.getFullYear(), m = d.getMonth() + 1;
    if (m === 7 || m === 8) return { kind: "wakacje", start: `${y}-07-01`, end: `${y}-08-31`, label: `Wakacje ${y}` };
    const y0 = m >= 9 ? y : y - 1;
    return { kind: "rok", start: `${y0}-09-01`, end: `${y0 + 1}-06-30`, label: `Rok ${y0}/${String(y0 + 1).slice(2)}` };
  }

  function normalize(s) {
    const o = s && typeof s === "object" ? s : {};
    const days = Array.isArray(o.days) ? [...new Set(o.days.filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) : DEFAULT_DAYS.slice();
    const from = typeof o.from === "string" && DAY.test(o.from) ? o.from : null;
    const map = m => { const out = {}; if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) if (DAY.test(k)) out[k] = typeof v === "string" ? v : ""; return out; };
    const cancelled = map(o.cancelled), absent = map(o.absent), present = map(o.present);
    for (const k of Object.keys(absent)) delete cancelled[k];          // one mark per day: "nie byłem" wins
    for (const k of Object.keys(present)) if (has(absent, k) || has(cancelled, k)) delete present[k];
    return { days, from, cancelled, absent, present };
  }

  // trainings (Trainings.list()) -> swims by day, the first swim day, the newest day with any activity
  function index(list) {
    const byDay = new Map(); let first = null, last = null;
    for (const t of list || []) {
      if (!(t && t.date instanceof Date) || isNaN(t.date)) continue;
      const k = dayKey(t.date);
      if (!last || k > last) last = k;
      if (!t.swim) continue;
      if (!first || k < first) first = k;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push({ id: t.id, date: t.date, slot: slotOf(t.date), dist: t.dist == null ? null : t.dist, type: t.type || "" });
    }
    for (const a of byDay.values()) a.sort((x, y) => x.date - y.date);
    return { byDay, firstSwim: first, lastData: last };
  }
  // everything a day's status depends on
  // (with no swims in the data at all, the first day marked "byłem" by hand starts the counting)
  function context(idx, cfg, today) {
    const firstMark = Object.keys(cfg.present || {}).filter(k => k <= today).sort()[0] || null;
    return { idx, cfg, today, from: cfg.from || idx.firstSwim || firstMark, until: idx.lastData };
  }
  // przed | opuszczony | zawody | odwolany | pominiety | obecny | wolne | plan | dzis | nieznany | nieobecny
  function status(k, C) {
    const tr = C.idx.byDay.get(k) || [], sched = C.cfg.days.includes(isoDow(k)), canc = has(C.cfg.cancelled, k);
    const K = canc ? kindOf(C.cfg.cancelled[k]) : null;
    const manual = has(C.cfg.present || {}, k) && k <= C.today;
    const st = s => ({ k, s, tr, sched, extra: (s === "obecny" || s === "zawody") && !sched, reason: canc ? C.cfg.cancelled[k] : null, kind: K ? K.cls : null, manual: s === "obecny" && manual && !tr.length });
    if (!C.from || k < C.from) return st("przed");
    // marked by hand wins over a swim recorded that day (that swim was not the training)
    if (has(C.cfg.absent || {}, k) && sched && k <= C.today) return st("opuszczony");    // "nie byłem": an absence
    if (K && K.s === "zawody") return st("zawody");                                    // competitions: also on a day off
    if (K && sched) return st(K.s);                                                    // odwolany | pominiety
    if (tr.length || manual) return st("obecny");                                      // a swim, or "byłem" (without the watch)
    if (!sched) return st("wolne");
    if (k > C.today) return st("plan");
    if (k === C.today) return st("dzis");
    if (!C.until || k > C.until) return st("nieznany");
    return st("nieobecny");
  }
  // counts for the days a..b. Attendance only up to today; the marks (zawody, odwołane, pominięte) in the whole range,
  // so a day marked ahead (a trip next week) shows up at once.
  function tally(a, b, C) {
    const r = { planned: 0, present: 0, absent: 0, marked: 0, skipped: 0, callOff: 0, comps: 0, kinds: {}, unknown: 0, extra: 0, rano: 0, popoludnie: 0, pct: null };
    if (!C.from) return r;
    for (let k = a < C.from ? C.from : a; k <= b; k = addDays(k, 1)) {
      const s = status(k, C);
      if (s.s === "zawody" || s.s === "odwolany" || s.s === "pominiety") {
        r.kinds[s.kind] = (r.kinds[s.kind] || 0) + 1;
        if (s.s === "pominiety") r.skipped++; else if (s.s === "odwolany") r.callOff++; else r.comps++;
      }
      if (k > C.today) continue;
      if (s.s === "obecny") { if (s.extra) r.extra++; else { r.planned++; r.present++; } for (const t of s.tr) r[t.slot]++; }
      else if (s.s === "zawody") { if (s.extra) r.extra++; else { r.planned++; r.present++; } }
      else if (s.s === "nieobecny") { r.planned++; r.absent++; }
      else if (s.s === "opuszczony") { r.planned++; r.absent++; r.marked++; }
      else if (s.s === "nieznany") r.unknown++;
    }
    r.pct = r.planned ? Math.round(100 * r.present / r.planned) : null;
    return r;
  }
  // training days attended one after another, back from today (competitions count; skipped and cancelled days,
  // days off and today without a swim yet do not break it; an absence does)
  function streak(C) {
    let n = 0;
    if (!C.from) return 0;
    for (let k = C.today; k >= C.from; k = addDays(k, -1)) {
      const s = status(k, C);
      if (s.s === "nieobecny" || s.s === "opuszczony") break;
      if ((s.s === "obecny" || s.s === "zawody") && !s.extra) n++;
    }
    return n;
  }
  // the weeks (Monday first) that cover month m (0-11) of year y
  function monthGrid(y, m, C) {
    const first = dayKey(new Date(y, m, 1, 12)), last = dayKey(new Date(y, m + 1, 0, 12));
    const out = [];
    for (let k = addDays(first, 1 - isoDow(first)), end = addDays(last, 7 - isoDow(last)); k <= end; k = addDays(k, 1))
      out.push(Object.assign(status(k, C), { inMonth: k >= first && k <= last }));
    return out;
  }
  const core = { DAY, DEFAULT_DAYS, MORNING_BEFORE, REASONS, MARK_ORDER, KINDS, kindOf, periodOf, dayKey, parseDay, addDays, isoDow, slotOf, normalize, index, context, status, tally, streak, monthGrid };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmAttendance = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DOW = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];
  const DOW_LONG = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];
  const fmtMonth = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
  const fmtDay = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });
  const fmtLong = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hhmm = d => d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const SLOT = { rano: "rano", popoludnie: "po południu" };
  const LABEL = { obecny: "obecny", nieobecny: "nieobecny, brak treningu w danych", opuszczony: "nie byłem na treningu", zawody: "zawody, liczą się jak trening",
    odwolany: "trening odwołany, nie liczy się", pominiety: "pominięty", nieznany: "jeszcze nie wiadomo", dzis: "dziś", plan: "dzień treningowy", wolne: "wolne", przed: "przed początkiem liczenia" };

  let A = normalize(null), trainings = [], P = null, now = () => new Date();
  let shown = null, sel = null, setOpen = false;   // shown month {y, m}; selected day key; settings unfolded
  const today = () => dayKey(now());
  const ctx = () => context(index(trainings), A, today());
  const canWrite = () => !!(P && P.writable && P.writable());

  function attach(persist) {
    P = persist || null;
    A = normalize(P && P.load ? P.load() : null);
    render();
  }
  function setTrainings(list) { trainings = list || []; render(); }
  function exportState() { return { days: A.days.slice(), from: A.from, cancelled: Object.assign({}, A.cancelled), absent: Object.assign({}, A.absent), present: Object.assign({}, A.present) }; }
  // writes the whole state; the screen shows it at once, a message comes only after the store confirmed it.
  // If writing is off, the screen goes back to what is stored.
  function save(next, okText, undoTo) {
    if (!P || !P.save) return;
    const prev = A;
    A = normalize(next);
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { A = normalize(P.load ? P.load() : prev); render(); return; }
    render();
    if (okText && P.whenSaved) P.whenSaved(res, () => g.Rytm && g.Rytm.notify.info(okText, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
  }

  function cellLabel(c) {
    if (c.s === "obecny") return c.manual ? "ręcz." : c.tr.length > 1 ? `${c.tr.length}×` : c.tr[0].slot === "rano" ? "rano" : "popoł.";
    if (c.s === "zawody" || c.s === "odwolany" || c.s === "pominiety") return kindOf(c.reason).label;
    if (c.s === "nieobecny") return "brak";
    if (c.s === "opuszczony") return "nieob.";
    if (c.s === "nieznany") return "?";
    if (c.s === "dzis") return "dziś";
    return "";
  }
  function cellAria(c) {
    const d = parseDay(c.k);
    let s = `${fmtDay.format(d)}: ${LABEL[c.s]}`;
    if (c.s === "obecny") s += (c.manual ? ", zaznaczone ręcznie (bez zegarka)" : ", " + c.tr.map(t => SLOT[t.slot]).join(" i ")) + (c.extra ? ", dodatkowy" : "");
    if (c.s === "pominiety" && c.reason) s += `: ${c.reason}`;
    if (c.s === "zawody" && c.extra) s += " (dzień poza planem, trening dodatkowy)";
    return s;
  }
  function tile(k, v, s, cls) { return `<div class="tile${cls ? " " + cls : ""}"><span class="k">${k}</span><span class="v">${v}</span>${s ? `<span class="d">${s}</span>` : ""}</div>`; }
  // the line under "Nieobecne / pominięte": what was marked in the month
  const marksText = r => [r.kinds.chor && `choroba ${r.kinds.chor}`, r.kinds.wyj && `wyjazd ${r.kinds.wyj}`, r.kinds.inne && `inne ${r.kinds.inne}`,
    r.callOff && `odwołane ${r.callOff}`].filter(Boolean).join(" · ");
  const pctText = r => (r.pct == null ? "–" : r.pct + "%");
  // the big number in a round pool: the water level is the attendance, with waves on top (still when the phone asks
  // for less motion)
  function pool(pct) {
    const p = pct == null ? 0 : Math.max(0, Math.min(100, pct)), R = 56, level = 64 - R + 2 * R * (1 - p / 100);
    const wave = amp => { let d = `M-128,${level.toFixed(1)}`; for (let x = -128; x < 256; x += 64) d += ` q16,${-amp} 32,0 t32,0`; return d + " V140 H-128 Z"; };
    return `<span class="fr-pool${pct == null ? " empty" : ""}">
      <svg viewBox="0 0 128 128" aria-hidden="true" focusable="false">
        <defs><clipPath id="frPoolClip"><circle cx="64" cy="64" r="${R}"/></clipPath></defs>
        <circle cx="64" cy="64" r="${R}" class="fr-pool-bg"/>
        <g clip-path="url(#frPoolClip)"><path class="fr-wave fr-wave2" d="${wave(4)}"/><path class="fr-wave fr-wave1" d="${wave(5)}"/></g>
        <circle cx="64" cy="64" r="${R + 4}" class="fr-rope fr-rope1"/><circle cx="64" cy="64" r="${R + 4}" class="fr-rope fr-rope2"/>
      </svg><span class="fr-pct">${pct == null ? "–" : pct + "%"}</span></span>`;
  }

  function render() {
    const root = $("frRoot"); if (!root) return;
    const C = ctx(), T = C.today;
    if (!C.from) {
      root.innerHTML = `<section class="panel"><h2>Kalendarz uzupełni się sam</h2>
        <p class="hint">Wczytaj listę treningów (CSV) albo pliki FIT z Garmina przyciskiem „+ Dodaj dane”. Każdy dzień z treningiem pływackim zaznaczę jako obecność.</p></section>`;
      return;
    }
    if (!shown) { const d = parseDay(T); shown = { y: d.getFullYear(), m: d.getMonth() }; }
    if (!sel) sel = T;
    const mFirst = dayKey(new Date(shown.y, shown.m, 1, 12)), mLast = dayKey(new Date(shown.y, shown.m + 1, 0, 12));
    const per = periodOf(mFirst), PER = tally(per.start, per.end, C), M = tally(mFirst, mLast, C), run = streak(C);
    const monthName = fmtMonth.format(parseDay(mFirst)), monthCap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    const perFrom = C.from > per.start ? C.from : per.start;
    const minMonth = C.from.slice(0, 7), maxD = parseDay(T); maxD.setMonth(maxD.getMonth() + 3);
    const canPrev = mFirst.slice(0, 7) > minMonth, canNext = mFirst.slice(0, 7) < dayKey(maxD).slice(0, 7);
    const stale = C.until && C.until < addDays(T, -1) && tally(addDays(C.until, 1), addDays(T, -1), C).unknown > 0;
    const cells = monthGrid(shown.y, shown.m, C);

    root.innerHTML = `
      <section class="panel fr-head" aria-label="Frekwencja">
        <div class="fr-big">${pool(PER.pct)}
          <span class="fr-of"><strong id="frPeriod">${esc(per.label)}</strong><br>${PER.planned ? `${PER.present} z ${PER.planned} ${plural(PER.planned, "treningu", "treningów", "treningów")}` : "jeszcze bez treningów do policzenia"}
            <br><span class="fr-range">${perFrom > per.end ? "" : `${esc(fmtDay.format(parseDay(perFrom)))} – ${esc(fmtDay.format(parseDay(per.end)))}`}</span></span></div>
        <div class="tiles fr-tiles">
          ${tile(esc(monthCap), pctText(M), (M.planned ? `${M.present} z ${M.planned}` : "w tym miesiącu") + (M.comps ? ` · zawody ${M.comps}` : ""))}
          ${tile("Seria", run, plural(run, "trening z rzędu", "treningi z rzędu", "treningów z rzędu"))}
          ${tile("Pora treningu", `${M.rano} / ${M.popoludnie}`, "rano / po południu")}
          ${tile("Nieobecne / pominięte", `${M.absent} / ${M.skipped}`, marksText(M) || "w tym miesiącu")}
        </div>
      </section>
      ${stale ? `<p class="note warn" id="frStale">Najnowsze dane z Garmina są z ${esc(fmtDay.format(parseDay(C.until)))}. Dni po nich oznaczam „?”, dopóki nie wczytasz nowego eksportu przyciskiem „+ Dodaj dane”.</p>` : ""}
      <section class="panel">
        <div class="fr-nav">
          <button class="icon-btn fr-arrow" type="button" data-fract="prev" aria-label="Poprzedni miesiąc" ${canPrev ? "" : "disabled"}>‹</button>
          <h2 id="frMonth">${esc(monthName)}</h2>
          <button class="icon-btn fr-arrow" type="button" data-fract="next" aria-label="Następny miesiąc" ${canNext ? "" : "disabled"}>›</button>
        </div>
        <div class="fr-grid" role="grid" aria-labelledby="frMonth">
          ${DOW.map(d => `<span class="fr-dow" role="columnheader">${d}</span>`).join("")}
          ${cells.map(c => `<button type="button" class="fr-cell s-${c.s}${c.kind ? " r-" + c.kind : ""}${c.inMonth ? "" : " out"}${c.extra ? " extra" : ""}${c.k === T ? " today" : ""}${c.k === sel ? " sel" : ""}${c.s === "przed" && c.tr.length ? " had" : ""}"
            data-day="${c.k}" aria-label="${esc(cellAria(c))}" aria-pressed="${c.k === sel}"><b>${parseDay(c.k).getDate()}</b><small>${cellLabel(c)}</small></button>`).join("")}
        </div>
        <div class="fr-legend" aria-hidden="true">
          <span><i class="s-obecny"></i>obecny</span><span><i class="s-nieobecny"></i>nieobecny</span>
          <span><i class="s-zawody r-zaw"></i>zawody</span><span><i class="s-odwolany r-odw"></i>odwołany</span><span><i class="s-pominiety r-chor"></i>choroba</span><span><i class="s-pominiety r-wyj"></i>wyjazd</span>
          <span><i class="s-nieznany"></i>jeszcze nie wiadomo</span><span><i class="s-wolne"></i>wolne</span>
        </div>
      </section>
      ${dayPanel(status(sel, C), C)}
      <details class="panel fr-set" id="frSet"${setOpen ? " open" : ""}>
        <summary><h2>Ustawienia frekwencji</h2></summary>
        <div class="fr-field"><span class="k">Dni treningów</span>
          <div class="fr-days" role="group" aria-label="Dni treningów">${DOW.map((d, i) => `<button type="button" class="chip" data-fract="dow" data-dow="${i + 1}" aria-pressed="${A.days.includes(i + 1)}" aria-label="${DOW_LONG[i]}" ${canWrite() ? "" : "disabled"}>${d}</button>`).join("")}</div></div>
        <label class="fr-field"><span class="k">Liczę od</span>
          <span class="fr-from"><input type="date" id="frFrom" value="${esc(C.from)}" max="${esc(T)}" ${canWrite() ? "" : "disabled"}>
          ${A.from ? `<button type="button" class="btn link" data-fract="fromReset" ${canWrite() ? "" : "disabled"}>od pierwszego treningu</button>` : `<span class="meta">od pierwszego treningu w danych</span>`}</span></label>
        <p class="note">Trening przed ${MORNING_BEFORE}:00 liczę jako poranny, późniejszy jako popołudniowy. Liczą się treningi pływackie, inne aktywności nie.</p>
      </details>
      <p class="note">Kalendarz uzupełnia się sam z treningów pływackich z Garmina (lista CSV i pliki FIT). Trening bez zegarka zaznaczysz w dniu: „Byłem na treningu”. Dzień treningowy bez treningu to nieobecność. Zawody liczą się jak trening. Odwołany trening nie liczy się wcale. Choroba i wyjazd to pominięte dni, które nie liczą się do frekwencji. „Nie byłem na treningu” liczy się jako nieobecność. Duża liczba to cały rok szkolny (wrzesień – czerwiec) albo wakacje (lipiec – sierpień); nowy rok szkolny liczy się od zera.</p>`;
  }

  function dayPanel(s, C) {
    const d = parseDay(s.k), title = fmtLong.format(d);
    let body = "";
    const dis = canWrite() ? "" : "disabled";
    const swims = s.tr.length ? `<ul class="fr-trs">${s.tr.map(t => `<li><button type="button" class="btn link" data-fract="open" data-id="${esc(t.id)}">${esc(hhmm(t.date))} · ${SLOT[t.slot]}${t.dist ? ` · ${Math.round(t.dist)} m` : ""}</button> <span class="meta">${esc(t.type)}</span></li>`).join("")}</ul>` : "";
    const missBtn = (label, cls) => `<button type="button" class="${cls}" data-fract="absent" ${dis}>${label}</button>`;
    // "byłem": a training without the watch — for a day that is over or today
    const hereBtn = s.k <= C.today ? `<div class="actions fr-here"><button type="button" class="btn primary" data-fract="present" ${dis}>Byłem na treningu (bez zegarka)</button><span class="meta">liczy się jako obecność</span></div>` : "";
    const markBtn = r => `<button type="button" class="chip fr-r r-${kindOf(r).cls}" data-fract="skip" data-r="${esc(r)}" ${dis}>${esc(r)}</button>`;
    const skipBox = `<div class="fr-skip"><span class="meta">Oznacz ten dzień:</span>
        <div class="actions">${MARK_ORDER.map(markBtn).join("")}</div>
        <p class="note">Zawody liczą się jak trening. Odwołany trening nie liczy się wcale. Choroba i wyjazd to dni pominięte (nie liczą się do frekwencji).</p></div>`;
    // on a day off only competitions make sense (they count as an extra training)
    const zawBox = `<div class="fr-skip"><span class="meta">Zawody w ten dzień?</span><div class="actions">${markBtn("Zawody")}</div></div>`;
    const undoMark = `<div class="actions"><button type="button" class="btn" data-fract="unskip" ${dis}>Cofnij oznaczenie</button></div>`;
    const swimNote = s.tr.length ? " Zegarek zapisał tego dnia pływanie (poniżej), ale nie liczę go osobno." : "";
    if (s.s === "obecny" && s.manual) {
      body = `<p><strong class="fr-ok">Obecny</strong> — zaznaczone ręcznie (trening bez zegarka)${s.extra ? ", dzień poza planem, więc jako trening dodatkowy" : ""}.</p>
        <div class="actions"><button type="button" class="btn" data-fract="unpresent" ${dis}>Cofnij zaznaczenie</button></div>${s.sched ? skipBox : zawBox}`;
    } else if (s.s === "obecny") {
      // a swim is not always the training: competitions (races are recorded too), swimming alone on a cancelled day
      body = `<p><strong class="fr-ok">Obecny</strong>${s.extra ? " — dzień poza planem, liczę jako trening dodatkowy." : ""}</p>${swims}
        ${s.sched ? `<p class="meta">To nie był trening? ${missBtn("Nie byłem na treningu", "btn link danger-link")}</p>${skipBox}` : zawBox}`;
    } else if (s.s === "opuszczony") {
      body = `<p><strong class="fr-bad">Nie byłeś na treningu</strong> — zaznaczone przez ciebie. Liczy się jako nieobecność.${s.tr.length ? " Pływanie z tego dnia nie liczy się jako obecność:" : ""}</p>${swims}
        <div class="actions"><button type="button" class="btn" data-fract="unabsent" ${dis}>Cofnij zaznaczenie</button></div>${s.tr.length ? "" : hereBtn}${skipBox}`;
    } else if (s.s === "zawody") {
      body = `<p><strong class="fr-kind r-zaw">Zawody</strong> — liczą się jak trening${s.extra ? " (dzień poza planem, więc jako trening dodatkowy)" : ""}.${swimNote}</p>${swims}${undoMark}`;
    } else if (s.s === "odwolany") {
      body = `<p><strong class="fr-kind r-odw">Trening odwołany</strong> — ten dzień nie liczy się do frekwencji: to nie jest nieobecność ani pominięcie.${swimNote}</p>${swims}${undoMark}`;
    } else if (s.s === "pominiety") {
      body = `<p><strong class="fr-kind r-${s.kind}">Pominięty: ${esc(s.reason || "bez powodu")}</strong>. Ten dzień nie liczy się do frekwencji.${swimNote}</p>${swims}${undoMark}`;
    } else if (s.s === "przed") {
      body = `<p class="meta">Przed początkiem liczenia (${esc(fmtDay.format(parseDay(C.from)))}).${s.tr.length ? " Był trening, ale nie liczy się do frekwencji." : ""} Początek zmienisz w ustawieniach poniżej.</p>`;
    } else if (s.s === "wolne") {
      body = `<p class="meta">Dzień bez treningu według ustawień.</p>${hereBtn ? hereBtn.replace("Byłem na treningu (bez zegarka)", "Byłem na treningu (dodatkowy, bez zegarka)") : ""}${zawBox}`;
    } else {
      const why = {
        nieobecny: `<p><strong class="fr-bad">Nieobecny</strong> — w danych z Garmina nie ma treningu pływackiego z tego dnia.</p>`,
        nieznany: C.until ? `<p><strong>Jeszcze nie wiadomo</strong> — najnowsze dane z Garmina są z ${esc(fmtDay.format(parseDay(C.until)))}. Wczytaj nowy eksport, żeby uzupełnić ten dzień.</p>`
          : `<p><strong>Jeszcze nie wiadomo</strong> — nie ma jeszcze danych z Garmina. Wczytaj eksport przyciskiem „+ Dodaj dane”, żeby uzupełnić ten dzień.</p>`,
        dzis: `<p><strong>Dziś</strong> — trening pojawi się po wczytaniu danych z Garmina.</p>`,
        plan: `<p class="meta">Dzień treningowy. Zawody, odwołany trening albo wyjazd możesz oznaczyć już teraz.</p>`,
      }[s.s];
      // "nie byłem": for a day that is over or today; not ahead of time, and not needed when the data already says so
      const canMiss = s.s === "nieznany" || s.s === "dzis";
      body = why + (s.s === "plan" ? "" : hereBtn) + (canMiss ? `<div class="actions">${missBtn("Nie byłem na treningu", "btn danger")}<span class="meta">liczy się jako nieobecność</span></div>` : "") + skipBox;
    }
    const ro = canWrite() ? "" : `<p class="note warn">Zapis jest wyłączony, więc teraz nie da się niczego zmienić.</p>`;
    return `<section class="panel fr-day" id="frDay" aria-live="polite"><h3>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h3>${body}${ro}</section>`;
  }

  function onClick(e) {
    const cell = e.target.closest("[data-day]");
    if (cell) { sel = cell.dataset.day; render(); const p = $("frDay"); if (p && p.scrollIntoView) p.scrollIntoView({ block: "nearest" }); return; }
    const b = e.target.closest("[data-fract]"); if (!b || b.disabled) return;
    const a = b.dataset.fract, prev = exportState();
    if (a === "prev" || a === "next") {
      const d = new Date(shown.y, shown.m + (a === "next" ? 1 : -1), 1, 12); shown = { y: d.getFullYear(), m: d.getMonth() };
      sel = sel && sel.slice(0, 7) === dayKey(d).slice(0, 7) ? sel : (today().slice(0, 7) === dayKey(d).slice(0, 7) ? today() : dayKey(d));
      render();
    } else if (a === "present") {
      const next = exportState(); next.present[sel] = ""; delete next.absent[sel]; delete next.cancelled[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: byłem na treningu — zapisano obecność (bez zegarka).`, prev);
    } else if (a === "unpresent") {
      const next = exportState(); delete next.present[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: zaznaczenie obecności cofnięte.`, prev);
    } else if (a === "absent") {
      const next = exportState(); next.absent[sel] = ""; delete next.cancelled[sel]; delete next.present[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: nie byłem na treningu — zapisano nieobecność.`, prev);
    } else if (a === "unabsent") {
      const next = exportState(); delete next.absent[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: zaznaczenie nieobecności cofnięte.`, prev);
    } else if (a === "skip") {
      const r = b.dataset.r || REASONS[0], next = exportState(); next.cancelled[sel] = r; delete next.absent[sel]; delete next.present[sel];
      const what = { zawody: "zawody — liczą się jak trening.", odwolany: "trening odwołany — nie liczy się do frekwencji." }[kindOf(r).s] || `${r.toLowerCase()} — dzień pominięty.`;
      save(next, `${fmtDay.format(parseDay(sel))}: ${what}`, prev);
    } else if (a === "unskip") {
      const next = exportState(); delete next.cancelled[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: oznaczenie cofnięte.`, prev);
    } else if (a === "dow") {
      const n = +b.dataset.dow, next = exportState();
      next.days = next.days.includes(n) ? next.days.filter(x => x !== n) : next.days.concat(n);
      setOpen = true;
      save(next, "Zapisano dni treningów.", prev);
    } else if (a === "fromReset") {
      const next = exportState(); next.from = null; setOpen = true;
      save(next, "Liczę od pierwszego treningu w danych.", prev);
    } else if (a === "open" && P && P.openTraining) P.openTraining(b.dataset.id);
  }
  function onChange(e) {
    if (e.target.id !== "frFrom") return;
    const v = e.target.value;
    if (!DAY.test(v)) return;
    const prev = exportState(), next = exportState(); next.from = v; setOpen = true;
    save(next, `Liczę od ${fmtDay.format(parseDay(v))}.`, prev);
  }
  function onToggle(e) { if (e.target.id === "frSet") setOpen = e.target.open; }
  function mount() {
    const root = $("frRoot"); if (!root) return;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("toggle", onToggle, true);
  }
  // tests only: a fixed "now"
  function setClock(fn) { now = fn || (() => new Date()); shown = null; sel = null; }

  const api = Object.assign({}, core, { attach, setTrainings, exportState, render, mount, setClock });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });   // live (Object.assign would copy the value once)
  g.RytmAttendance = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
