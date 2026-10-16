// Rytm: attendance ("Frekwencja") — a month calendar filled in from the swimming trainings (Garmin CSV and FIT).
// Training days are Monday to Saturday by default (changeable). A day with a swim counts as present, morning
// (before 12:00) or afternoon; a training day without one counts as absent. A day can be skipped (the training was
// cancelled, competitions, illness, a trip): it is then not counted at all, and each reason has its own look.
// "Nie byłem na treningu" marks an absence by hand (counted as an absence), also on a day that is not known yet or
// on a day with a swim that was not the training. Days after the newest data from Garmin are shown as
// "not known yet" instead of absent, until a newer export is loaded.
// Saved state: {days:[1..7] (Monday = 1), from:"YYYY-MM-DD"|null (null = from the first swim),
//               cancelled:{day: reason} (skipped, not counted), absent:{day: ""} (marked absent by hand, counted)}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];
  const MORNING_BEFORE = 12;                 // a training that starts before 12:00 is a morning one
  const REASONS = ["Trening odwołany", "Zawody", "Choroba", "Wyjazd"];
  // each reason for skipping a day has its own look: css class and the short label in the calendar
  const KINDS = { "Trening odwołany": { cls: "odw", label: "odw." }, "Zawody": { cls: "zaw", label: "zaw." },
    "Choroba": { cls: "chor", label: "chor." }, "Wyjazd": { cls: "wyj", label: "wyj." } };
  const kindOf = reason => KINDS[reason] || { cls: "inne", label: "pom." };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };   // noon: safe across DST
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const isoDow = k => { const w = parseDay(k).getDay(); return w === 0 ? 7 : w; };
  const slotOf = date => (date.getHours() < MORNING_BEFORE ? "rano" : "popoludnie");

  function normalize(s) {
    const o = s && typeof s === "object" ? s : {};
    const days = Array.isArray(o.days) ? [...new Set(o.days.filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) : DEFAULT_DAYS.slice();
    const from = typeof o.from === "string" && DAY.test(o.from) ? o.from : null;
    const map = m => { const out = {}; if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) if (DAY.test(k)) out[k] = typeof v === "string" ? v : ""; return out; };
    const cancelled = map(o.cancelled), absent = map(o.absent);
    for (const k of Object.keys(absent)) delete cancelled[k];          // one mark per day: "nie byłem" wins
    return { days, from, cancelled, absent };
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
  function context(idx, cfg, today) {
    return { idx, cfg, today, from: cfg.from || idx.firstSwim, until: idx.lastData };
  }
  // przed | opuszczony | obecny | wolne | odwolany | plan | dzis | nieznany | nieobecny
  function status(k, C) {
    const tr = C.idx.byDay.get(k) || [], sched = C.cfg.days.includes(isoDow(k)), canc = has(C.cfg.cancelled, k);
    const st = s => ({ k, s, tr, sched, extra: s === "obecny" && !sched, reason: canc ? C.cfg.cancelled[k] : null, kind: canc ? kindOf(C.cfg.cancelled[k]).cls : null });
    if (!C.from || k < C.from) return st("przed");
    // marked by hand "nie byłem": an absence, even if the watch recorded a swim that day (not the training)
    if (has(C.cfg.absent || {}, k) && sched && k <= C.today) return st("opuszczony");
    if (tr.length) return st("obecny");
    if (!sched) return st("wolne");
    if (canc) return st("odwolany");
    if (k > C.today) return st("plan");
    if (k === C.today) return st("dzis");
    if (!C.until || k > C.until) return st("nieznany");
    return st("nieobecny");
  }
  // counts for the days a..b (only up to today)
  function tally(a, b, C) {
    const r = { planned: 0, present: 0, absent: 0, marked: 0, cancelled: 0, kinds: {}, unknown: 0, extra: 0, rano: 0, popoludnie: 0, pct: null };
    if (!C.from) return r;
    const end = b < C.today ? b : C.today;
    for (let k = a < C.from ? C.from : a; k <= end; k = addDays(k, 1)) {
      const s = status(k, C);
      if (s.s === "obecny") { if (s.extra) r.extra++; else { r.planned++; r.present++; } for (const t of s.tr) r[t.slot]++; }
      else if (s.s === "nieobecny") { r.planned++; r.absent++; }
      else if (s.s === "opuszczony") { r.planned++; r.absent++; r.marked++; }
      else if (s.s === "odwolany") { r.cancelled++; r.kinds[s.kind] = (r.kinds[s.kind] || 0) + 1; }
      else if (s.s === "nieznany") r.unknown++;
    }
    r.pct = r.planned ? Math.round(100 * r.present / r.planned) : null;
    return r;
  }
  // training days attended one after another, back from today (skipped days, days off and today without a swim yet
  // do not break it; an absence does)
  function streak(C) {
    let n = 0;
    if (!C.from) return 0;
    for (let k = C.today; k >= C.from; k = addDays(k, -1)) {
      const s = status(k, C);
      if (s.s === "nieobecny" || s.s === "opuszczony") break;
      if (s.s === "obecny" && !s.extra) n++;
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
  const core = { DAY, DEFAULT_DAYS, MORNING_BEFORE, REASONS, KINDS, kindOf, dayKey, parseDay, addDays, isoDow, slotOf, normalize, index, context, status, tally, streak, monthGrid };

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
  const LABEL = { obecny: "obecny", nieobecny: "nieobecny, brak treningu w danych", opuszczony: "nie byłem na treningu", odwolany: "pominięty", nieznany: "jeszcze nie wiadomo", dzis: "dziś", plan: "dzień treningowy", wolne: "wolne", przed: "przed początkiem liczenia" };

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
  function exportState() { return { days: A.days.slice(), from: A.from, cancelled: Object.assign({}, A.cancelled), absent: Object.assign({}, A.absent) }; }
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
    if (c.s === "obecny") return c.tr.length > 1 ? `${c.tr.length}×` : c.tr[0].slot === "rano" ? "rano" : "popoł.";
    if (c.s === "odwolany") return kindOf(c.reason).label;
    if (c.s === "nieobecny") return "brak";
    if (c.s === "opuszczony") return "nieob.";
    if (c.s === "nieznany") return "?";
    if (c.s === "dzis") return "dziś";
    return "";
  }
  function cellAria(c) {
    const d = parseDay(c.k);
    let s = `${fmtDay.format(d)}: ${LABEL[c.s]}`;
    if (c.s === "obecny") s += ", " + c.tr.map(t => SLOT[t.slot]).join(" i ") + (c.extra ? ", dodatkowy" : "");
    if (c.s === "odwolany" && c.reason) s += `: ${c.reason}`;
    return s;
  }
  function tile(k, v, s, cls) { return `<div class="tile${cls ? " " + cls : ""}"><span class="k">${k}</span><span class="v">${v}</span>${s ? `<span class="d">${s}</span>` : ""}</div>`; }
  // a skip reason chip / legend item with its own colour
  const KIND_ORDER = ["odw", "chor", "wyj", "zaw"];
  const kindsText = kinds => KIND_ORDER.concat("inne").filter(k => kinds[k]).map(k => `${(Object.values(KINDS).find(x => x.cls === k) || { label: "pom." }).label} ${kinds[k]}`).join(" · ");
  const pctText = r => (r.pct == null ? "–" : r.pct + "%");

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
    const M = tally(mFirst, mLast, C), ALL = tally(C.from, T, C), run = streak(C);
    const monthName = fmtMonth.format(parseDay(mFirst));
    const minMonth = C.from.slice(0, 7), maxD = parseDay(T); maxD.setMonth(maxD.getMonth() + 3);
    const canPrev = mFirst.slice(0, 7) > minMonth, canNext = mFirst.slice(0, 7) < dayKey(maxD).slice(0, 7);
    const stale = C.until && C.until < addDays(T, -1) && tally(addDays(C.until, 1), addDays(T, -1), C).unknown > 0;
    const cells = monthGrid(shown.y, shown.m, C);

    root.innerHTML = `
      <section class="panel fr-head" aria-label="Frekwencja">
        <div class="fr-big"><span class="fr-wreath"><span class="fr-pct">${pctText(M)}</span></span>
          <span class="fr-of"><strong>${esc(monthName)}</strong><br>${M.planned ? `${M.present} z ${M.planned} ${plural(M.planned, "treningu", "treningów", "treningów")}` : "jeszcze bez treningów do policzenia"}</span></div>
        <div class="tiles fr-tiles">
          ${tile(`Od ${esc(fmtDay.format(parseDay(C.from)))}`, pctText(ALL), ALL.planned ? `${ALL.present} z ${ALL.planned}` : "")}
          ${tile("Seria", run, plural(run, "trening z rzędu", "treningi z rzędu", "treningów z rzędu"), run > 0 ? "fr-gold" : "")}
          ${tile("Pora treningu", `${M.rano} / ${M.popoludnie}`, "rano / po południu")}
          ${tile("Nieobecne / pominięte", `${M.absent} / ${M.cancelled}`, M.cancelled ? kindsText(M.kinds) : (M.extra ? `dodatkowe: ${M.extra}` : "w tym miesiącu"))}
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
          <span><i class="s-obecny"></i>obecny</span><span><i class="s-nieobecny"></i>brak w danych</span><span><i class="s-opuszczony"></i>nie byłem</span>
          <span><i class="s-odwolany r-odw"></i>odwołany</span><span><i class="s-odwolany r-chor"></i>choroba</span><span><i class="s-odwolany r-wyj"></i>wyjazd</span><span><i class="s-odwolany r-zaw"></i>zawody</span>
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
      <p class="note">Kalendarz uzupełnia się sam z treningów pływackich z Garmina (lista CSV i pliki FIT). Dzień treningowy bez treningu to nieobecność, chyba że go pominiesz. Pominięte dni (odwołany, choroba, wyjazd, zawody) nie liczą się do frekwencji. „Nie byłem na treningu” liczy się jako nieobecność.</p>`;
  }

  function dayPanel(s, C) {
    const d = parseDay(s.k), title = fmtLong.format(d);
    let body = "";
    const dis = canWrite() ? "" : "disabled";
    const swims = s.tr.length ? `<ul class="fr-trs">${s.tr.map(t => `<li><button type="button" class="btn link" data-fract="open" data-id="${esc(t.id)}">${esc(hhmm(t.date))} · ${SLOT[t.slot]}${t.dist ? ` · ${Math.round(t.dist)} m` : ""}</button> <span class="meta">${esc(t.type)}</span></li>`).join("")}</ul>` : "";
    const missBtn = (label, cls) => `<button type="button" class="${cls}" data-fract="absent" ${dis}>${label}</button>`;
    const skipBox = `<div class="fr-skip"><span class="meta">Pomiń ten dzień (nie liczy się do frekwencji):</span>
        <div class="actions">${REASONS.map(r => `<button type="button" class="chip fr-r r-${kindOf(r).cls}" data-fract="skip" data-r="${esc(r)}" ${dis}>${esc(r)}</button>`).join("")}</div></div>`;
    if (s.s === "obecny") {
      body = `<p><strong class="fr-ok">Obecny</strong>${s.extra ? " — dzień poza planem, liczę jako trening dodatkowy." : ""}</p>${swims}
        ${s.sched && s.k <= C.today ? `<p class="meta">To nie był trening? ${missBtn("Nie byłem na treningu", "btn link danger-link")}</p>` : ""}`;
    } else if (s.s === "opuszczony") {
      body = `<p><strong class="fr-bad">Nie byłeś na treningu</strong> — zaznaczone przez ciebie. Liczy się jako nieobecność.${s.tr.length ? " Pływanie z tego dnia nie liczy się jako obecność:" : ""}</p>${swims}
        <div class="actions"><button type="button" class="btn" data-fract="unabsent" ${dis}>Cofnij zaznaczenie</button></div>${skipBox}`;
    } else if (s.s === "odwolany") {
      body = `<p><strong class="fr-kind r-${s.kind}">Pominięty: ${esc(s.reason || "bez powodu")}</strong>. Ten dzień nie liczy się do frekwencji.</p>
        <div class="actions"><button type="button" class="btn" data-fract="unskip" ${canWrite() ? "" : "disabled"}>Cofnij pominięcie</button></div>`;
    } else if (s.s === "przed") {
      body = `<p class="meta">Przed początkiem liczenia (${esc(fmtDay.format(parseDay(C.from)))}).${s.tr.length ? " Był trening, ale nie liczy się do frekwencji." : ""} Początek zmienisz w ustawieniach poniżej.</p>`;
    } else if (s.s === "wolne") {
      body = `<p class="meta">Dzień bez treningu według ustawień.</p>`;
    } else {
      const why = {
        nieobecny: `<p><strong class="fr-bad">Nieobecny</strong> — w danych z Garmina nie ma treningu pływackiego z tego dnia.</p>`,
        nieznany: `<p><strong>Jeszcze nie wiadomo</strong> — najnowsze dane z Garmina są z ${esc(fmtDay.format(parseDay(C.until)))}. Wczytaj nowy eksport, żeby uzupełnić ten dzień.</p>`,
        dzis: `<p><strong>Dziś</strong> — trening pojawi się po wczytaniu danych z Garmina.</p>`,
        plan: `<p class="meta">Dzień treningowy. Jeśli wiesz, że trening jest odwołany, możesz go pominąć już teraz.</p>`,
      }[s.s];
      // "nie byłem": for a day that is over or today; not ahead of time, and not needed when the data already says so
      const canMiss = s.s === "nieznany" || s.s === "dzis";
      body = why + (canMiss ? `<div class="actions">${missBtn("Nie byłem na treningu", "btn danger")}<span class="meta">liczy się jako nieobecność</span></div>` : "") + skipBox;
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
    } else if (a === "absent") {
      const next = exportState(); next.absent[sel] = ""; delete next.cancelled[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: nie byłem na treningu — zapisano nieobecność.`, prev);
    } else if (a === "unabsent") {
      const next = exportState(); delete next.absent[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: zaznaczenie nieobecności cofnięte.`, prev);
    } else if (a === "skip") {
      const next = exportState(); next.cancelled[sel] = b.dataset.r || REASONS[0]; delete next.absent[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: ${next.cancelled[sel].toLowerCase()} — dzień pominięty.`, prev);
    } else if (a === "unskip") {
      const next = exportState(); delete next.cancelled[sel];
      save(next, `${fmtDay.format(parseDay(sel))}: pominięcie cofnięte.`, prev);
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
