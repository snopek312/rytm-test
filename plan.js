// Rytm: the day (Dziś) — one place for everything: today's lessons (from the timetable), the training (from Frekwencja),
// habits, announced tests (Szkoła), steps of goals (Cele), test days and the matura (Nauka) and the user's own events;
// the next 7 days; a month calendar; the timetable editor with the bell times.
// Saved state (one record in meta "plan"):
//   {v:1, bells:[{n, from, to}], lessons:{"1":[{n, subject, room}], ..., "5":[...]}, events:[{id, title, date, time, cat, note}]}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const CATS = [{ id: "szkola", name: "Szkoła" }, { id: "sport", name: "Sport" }, { id: "wymiana", name: "Wymiana" }, { id: "rodzina", name: "Rodzina i znajomi" }, { id: "inne", name: "Inne" }];
  const BELLS = [["07:10", "07:55"], ["08:00", "08:45"], ["08:55", "09:40"], ["09:50", "10:35"], ["10:45", "11:30"], ["11:50", "12:35"], ["12:45", "13:30"], ["13:40", "14:25"], ["14:35", "15:20"], ["15:25", "16:10"]];
  const EXTRA_SUBJECTS = ["Religia", "Etyka", "Godzina z wychowawcą", "Zajęcia dodatkowe", "Okienko"];
  const KIND_ORDER = ["matura", "zawody", "sprawdzian", "test", "trening", "trening-off", "cel", "wydarzenie"];
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const isoDow = k => { const w = parseDay(k).getDay(); return w === 0 ? 7 : w; };
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function defaults() { return { v: 1, bells: BELLS.map(([from, to], n) => ({ n, from, to })), lessons: {}, events: [] }; }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const D = defaults();
    const bells = D.bells.map(b => { const x = Array.isArray(o.bells) ? o.bells.find(y => y && y.n === b.n) : null; return x && HM.test(x.from || "") && HM.test(x.to || "") && x.to > x.from ? { n: b.n, from: x.from, to: x.to } : b; });
    const lessons = {};
    for (let d = 1; d <= 7; d++) {
      const list = o.lessons && Array.isArray(o.lessons[d]) ? o.lessons[d] : [];
      const seen = new Set();
      const ok = list.filter(l => l && Number.isInteger(l.n) && l.n >= 0 && l.n <= 9 && str(l.subject, 40) && !seen.has(l.n) && seen.add(l.n)).map(l => ({ n: l.n, subject: str(l.subject, 40), room: str(l.room, 12) })).sort((a, b) => a.n - b.n);
      if (ok.length) lessons[d] = ok;
    }
    const ids = new Set();
    const events = (Array.isArray(o.events) ? o.events : []).filter(e => e && typeof e.id === "string" && e.id && !ids.has(e.id) && str(e.title, 80) && DAY.test(e.date || "") && ids.add(e.id))
      .map(e => ({ id: e.id, title: str(e.title, 80), date: e.date, time: HM.test(e.time || "") ? e.time : null, cat: CATS.some(c => c.id === e.cat) ? e.cat : "inne", note: str(e.note, 200) }));
    return { v: 1, bells, lessons, events };
  }
  // today's lessons with their bell times
  function lessonsOn(state, k) {
    return (state.lessons[isoDow(k)] || []).map(l => { const b = state.bells.find(x => x.n === l.n); return { n: l.n, subject: l.subject, room: l.room, from: b.from, to: b.to }; });
  }
  // the lesson going on at hh:mm, and the next one
  function nowLesson(list, hm) { return { current: list.find(l => l.from <= hm && hm < l.to) || null, next: list.find(l => l.from > hm) || null }; }

  // everything on day k except the lessons, in a fixed order (timed events by their time)
  // src: {school:{tests, subjects}, schoolCats, attendance:{days, cancelled, absent}, trainings:[{date, swim}], goalsDue(from, to), studyDates(from, to)}
  function agenda(state, src, k) {
    const out = [], s = src || {}, att = s.attendance;
    const swam = (s.trainings || []).some(t => t && t.swim && t.date instanceof Date && dayKey(t.date) === k);
    if (att) {
      const reason = att.cancelled && Object.prototype.hasOwnProperty.call(att.cancelled, k) ? att.cancelled[k] : null;
      const absent = att.absent && Object.prototype.hasOwnProperty.call(att.absent, k);
      if (reason === "Zawody") out.push({ kind: "zawody", title: "Zawody", cls: "zaw" });
      else if (reason) out.push({ kind: "trening-off", title: `Bez treningu: ${String(reason).toLowerCase()}`, cls: "off" });
      else if (absent) out.push({ kind: "trening-off", title: "Trening — nie byłem", cls: "off" });
      else if ((att.days || []).includes(isoDow(k)) || swam) out.push({ kind: "trening", title: swam ? "Trening — zrobiony" : "Trening", done: swam, cls: "sport" });
    }
    const sc = s.school, subj = id => ((sc && sc.subjects) || []).find(x => x.id === id), catName = id => ((s.schoolCats || []).find(c => c.id === id) || { name: "Sprawdzian" }).name;
    for (const t of (sc && sc.tests) || []) if (t.date === k && !t.gid) out.push({ kind: "sprawdzian", title: `${catName(t.cat)}: ${subj(t.sid) ? subj(t.sid).name : "?"}`, sub: t.topic || "", cls: "school" });
    for (const x of (s.goalsDue ? s.goalsDue(k, k) : [])) out.push({ kind: "cel", title: x.step.title, sub: x.goal.title, cls: "goal", gid: x.goal.id });
    for (const x of (s.studyDates ? s.studyDates(k, k) : [])) out.push({ kind: x.kind, title: x.title, cls: "study" });
    for (const e of state.events) if (e.date === k) out.push({ kind: "wydarzenie", title: e.title, sub: e.note, time: e.time, cls: "ev-" + e.cat, id: e.id });
    return out.sort((a, b) => (a.time && b.time ? (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) : a.time ? -1 : b.time ? 1 : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)));
  }
  // the days of a month view: whole weeks from Monday; each with what is on it (for the dots)
  function monthGrid(state, src, y, m) {
    const first = `${y}-${pad(m + 1)}-01`, last = dayKey(new Date(y, m + 1, 0, 12)), out = [];
    for (let k = addDays(first, 1 - isoDow(first)), end = addDays(last, 7 - isoDow(last)); k <= end; k = addDays(k, 1)) {
      const items = agenda(state, src, k);
      out.push({ k, inMonth: k >= first && k <= last, lessons: lessonsOn(state, k).length, kinds: [...new Set(items.filter(i => !(i.kind === "trening" && !i.done)).map(i => i.cls))] });
    }
    return out;
  }

  const core = { CATS, BELLS, EXTRA_SUBJECTS, defaults, normalize, lessonsOn, nowLesson, agenda, monthGrid, isoDow, dayKey, parseDay, addDays, daysBetween };

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
  const DOW = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, now = () => new Date();
  const ui = { tab: "dzis", y: null, m: null, sel: null, dow: 1, sheet: null };
  const today = () => dayKey(now());
  const hm = () => { const d = now(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const canWrite = () => !!(P && P.writable && P.writable());
  const src = () => { try { return P && P.sources ? P.sources() : {}; } catch (e) { return {}; } };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; render(); }
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
    const tag = { zawody: "zawody", sprawdzian: "sprawdzian", cel: "krok celu", test: "test", matura: "matura", trening: "trening", "trening-off": "trening", wydarzenie: (CATS.find(c => "ev-" + c.id === i.cls) || CATS[4]).name.toLowerCase() }[i.kind];
    const inner = `<span class="pl-dot ${esc(i.cls)}" aria-hidden="true"></span><span class="pl-it">${i.time ? `<b class="pl-time">${esc(i.time)}</b> ` : ""}${esc(i.title)}${i.done ? " ✓" : ""}${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span><span class="pl-k">${esc(tag)}</span>`;
    if (i.kind === "wydarzenie") return `<li><button type="button" class="pl-item" data-plact="editEv" data-id="${esc(i.id)}" ${canWrite() ? "" : "disabled"}>${inner}</button></li>`;
    if (i.kind === "cel") return `<li><button type="button" class="pl-item" data-plact="go" data-v="goals" data-arg="${esc(i.gid)}">${inner}</button></li>`;
    if (i.kind === "sprawdzian") return `<li><button type="button" class="pl-item" data-plact="go" data-v="school">${inner}</button></li>`;
    if (i.kind === "trening" || i.kind === "trening-off" || i.kind === "zawody") return `<li><button type="button" class="pl-item" data-plact="go" data-v="swim">${inner}</button></li>`;
    if (i.kind === "test" || i.kind === "matura") return `<li><button type="button" class="pl-item" data-plact="go" data-v="study">${inner}</button></li>`;
    return `<li><div class="pl-item">${inner}</div></li>`;
  };
  function lessonsBlock(k, isToday) {
    const list = lessonsOn(S, k);
    if (!list.length) return isoDow(k) <= 5 ? `<p class="meta">Brak planu lekcji na ten dzień. <button type="button" class="btn link" data-plact="tab" data-v="lekcje">Ułóż plan lekcji</button></p>` : "";
    const t = hm(), nl = isToday ? nowLesson(list, t) : { current: null, next: null };
    return `${isToday && (nl.current || nl.next) ? `<p class="pl-now">${nl.current ? `Teraz: <b>${esc(nl.current.subject)}</b> do ${esc(nl.current.to)}${nl.next ? ` · potem ${esc(nl.next.subject)} (${esc(nl.next.from)})` : " · ostatnia lekcja"}` : `Następna lekcja: <b>${esc(nl.next.subject)}</b> o ${esc(nl.next.from)}`}</p>` : ""}
      <ol class="pl-lessons">${list.map(l => `<li class="${isToday && t >= l.to ? "past" : ""}${nl.current && nl.current.n === l.n ? " now" : ""}"><span class="pl-t">${esc(l.from)}</span><span class="pl-n">${l.n}.</span><span>${esc(l.subject)}</span><span class="meta">${l.room ? "s. " + esc(l.room) : ""}</span></li>`).join("")}</ol>
      <p class="meta">${list.length} ${plural(list.length, "lekcja", "lekcje", "lekcji")}, ${esc(list[0].from)}–${esc(list[list.length - 1].to)}</p>`;
  }

  function todayView() {
    const T = today(), s = src(), items = agenda(S, s, T), dis = canWrite() ? "" : "disabled";
    const hab = (() => { try { return s.habitsOn ? s.habitsOn(T) : null; } catch (e) { return null; } })();
    const late = (() => { try { return s.goalsOverdue ? s.goalsOverdue() : []; } catch (e) { return []; } })();
    const days = [];
    for (let i = 1; i <= 7; i++) { const k = addDays(T, i), it = agenda(S, s, k).filter(x => x.kind !== "trening"); if (it.length) days.push({ k, it }); }
    const mat = s.maturaDate ? daysBetween(T, s.maturaDate) : null;
    return `<section class="panel pl-today">
        <h2>${esc(cap(fmtDay.format(parseDay(T))))}</h2>
        <div class="lf-chips">${hab && hab.total ? `<button type="button" class="chip" data-plact="go" data-v="habits">Nawyki: ${hab.done} z ${hab.total}${hab.done === hab.total ? " ✓" : ""}</button>` : ""}${mat != null && mat >= 0 ? `<button type="button" class="chip" data-plact="go" data-v="study">Do matury: ${mat} ${plural(mat, "dzień", "dni", "dni")}</button>` : ""}</div>
        ${lessonsBlock(T, true)}
        <h3>Dziś</h3>
        ${items.length ? `<ul class="pl-items">${items.map(item).join("")}</ul>` : `<p class="meta">Nic więcej na dziś.</p>`}
        <div class="actions"><button type="button" class="btn primary" data-plact="addEv" data-v="${esc(T)}" ${dis}>+ Wydarzenie</button></div>
      </section>
      ${late.length ? `<section class="panel gl-late"><h2>Zaległe kroki celów</h2><ul class="pl-items">${late.slice(0, 6).map(x => item({ kind: "cel", title: x.step.title, sub: `${x.goal.title} · ${when(daysBetween(T, x.step.date))}`, cls: "goal late", gid: x.goal.id })).join("")}</ul></section>` : ""}
      <section class="panel"><h2>Najbliższe 7 dni</h2>
        ${days.length ? days.map(d => `<div class="pl-day"><p class="pl-dh">${esc(cap(fmtShortDay.format(parseDay(d.k))))} <span class="meta">· ${esc(when(daysBetween(T, d.k)))}</span></p><ul class="pl-items">${d.it.map(item).join("")}</ul></div>`).join("")
          : `<p class="meta">W tym tygodniu nie ma sprawdzianów, zawodów, kroków celów ani wydarzeń.</p>`}
      </section>`;
  }

  function calendarView() {
    const T = today();
    if (ui.y == null) { const d = parseDay(T); ui.y = d.getFullYear(); ui.m = d.getMonth(); }
    if (!ui.sel) ui.sel = T;
    const s = src(), grid = monthGrid(S, s, ui.y, ui.m), sel = ui.sel, items = agenda(S, s, sel);
    return `<section class="panel pl-cal">
        <div class="row pl-mhead"><button type="button" class="icon-btn" data-plact="month" data-v="-1" aria-label="Poprzedni miesiąc">‹</button><h2>${esc(cap(fmtMonth.format(new Date(ui.y, ui.m, 1))))}</h2><button type="button" class="icon-btn" data-plact="month" data-v="1" aria-label="Następny miesiąc">›</button></div>
        <div class="pl-grid" role="grid">${DOW.map(d => `<span class="pl-dow" role="columnheader">${d}</span>`).join("")}
          ${grid.map(c => `<button type="button" class="pl-cell${c.inMonth ? "" : " out"}${c.k === T ? " today" : ""}${c.k === sel ? " sel" : ""}" data-plact="sel" data-v="${c.k}" aria-pressed="${c.k === sel}" aria-label="${esc(fmtShortDay.format(parseDay(c.k)))}${c.kinds.length ? `: ${c.kinds.length} ${plural(c.kinds.length, "rodzaj", "rodzaje", "rodzajów")} wpisów` : ""}">
            <span>${parseDay(c.k).getDate()}</span><span class="pl-dots">${c.kinds.slice(0, 4).map(k => `<i class="pl-dot ${esc(k)}"></i>`).join("")}</span></button>`).join("")}</div>
        <p class="note pl-legend"><i class="pl-dot school"></i> sprawdzian <i class="pl-dot sport"></i> trening (był) <i class="pl-dot zaw"></i> zawody <i class="pl-dot goal"></i> krok celu <i class="pl-dot study"></i> test / matura <i class="pl-dot ev-inne"></i> wydarzenie</p>
      </section>
      <section class="panel"><h2>${esc(cap(fmtDay.format(parseDay(sel))))}</h2>
        ${lessonsBlock(sel, sel === T)}
        ${items.length ? `<ul class="pl-items">${items.map(item).join("")}</ul>` : `<p class="meta">Nic nie jest zaplanowane.</p>`}
        <div class="actions"><button type="button" class="btn primary" data-plact="addEv" data-v="${esc(sel)}" ${canWrite() ? "" : "disabled"}>+ Wydarzenie w tym dniu</button></div>
      </section>`;
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

  /* ---------- the event sheet ---------- */
  function renderSheet() {
    const el = $("plSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data;
    el.innerHTML = `<div class="sc-backdrop" data-plform="close"></div><form class="panel sc-form" id="plForm" role="dialog" aria-modal="true" aria-labelledby="plTitle" novalidate>
      <h2 id="plTitle">${d.id ? "Edytuj wydarzenie" : "Nowe wydarzenie"}</h2>
      <label class="sc-field"><span class="k">Co</span><input name="title" type="text" maxlength="80" placeholder="np. Urodziny, dentysta, termin zgłoszenia" value="${esc(d.title)}"></label>
      <div class="lf-2col"><label class="sc-field"><span class="k">Dzień</span><input name="date" type="date" value="${esc(d.date)}"></label>
        <label class="sc-field"><span class="k">Godzina (opcjonalnie)</span><input name="time" type="time" value="${esc(d.time || "")}"></label></div>
      <div class="sc-field"><span class="k">Rodzaj</span><div class="sc-cats">${CATS.map(c => `<button type="button" class="chip" data-plform="cat" data-v="${c.id}" aria-pressed="${d.cat === c.id}">${esc(c.name)}</button>`).join("")}</div></div>
      <label class="sc-field"><span class="k">Notatka</span><input name="note" type="text" maxlength="200" value="${esc(d.note)}"></label>
      <p class="sc-err" id="plErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-plform="close">Anuluj</button>${d.id ? `<button type="button" class="btn danger" data-plform="del">Usuń</button>` : ""}</div></form>`;
  }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function readForm() { const f = $("plForm"), d = ui.sheet.data; for (const n of ["title", "date", "time", "note"]) { const el = f && f.querySelector(`[name="${n}"]`); if (el) d[n] = el.value; } return d; }
  function submitSheet() {
    const d = readForm(), err = m => { const e = $("plErr"); if (e) e.textContent = m; return false; };
    const title = (d.title || "").trim();
    if (!title) return err("Wpisz, co to za wydarzenie.");
    if (!DAY.test(d.date || "")) return err("Wybierz dzień.");
    if (d.time && !HM.test(d.time)) return err("Godzina w formacie gg:mm.");
    const prev = exportState(), next = exportState();
    const rec = { id: d.id || newId("e"), title, date: d.date, time: d.time || null, cat: d.cat, note: (d.note || "").trim() };
    const old = d.id && next.events.find(x => x.id === d.id);
    if (old) Object.assign(old, rec); else next.events.push(rec);
    closeSheet();
    return save(next, `${old ? "Zapisano" : "Dodano"}: ${title}, ${fmtShortDay.format(parseDay(rec.date))}${rec.time ? " " + rec.time : ""}.`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-plform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.plform, d = readForm();
    if (a === "close") closeSheet();
    else if (a === "cat") { d.cat = b.dataset.v; renderSheet(); }
    else if (a === "del") { const prev = exportState(), next = exportState(), x = next.events.find(y => y.id === d.id); next.events = next.events.filter(y => y.id !== d.id); closeSheet(); save(next, `Usunięto: ${x ? x.title : ""}.`, prev); }
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
    else if (a === "addEv") { if (canWrite()) { ui.sheet = { data: { id: null, title: "", date: b.dataset.v || today(), time: "", cat: "inne", note: "" } }; renderSheet(); } }
    else if (a === "editEv") { const x = S.events.find(y => y.id === b.dataset.id); if (x && canWrite()) { ui.sheet = { data: Object.assign({}, x, { time: x.time || "" }) }; renderSheet(); } }
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
