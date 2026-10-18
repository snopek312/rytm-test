// Rytm: goals (Cele) — a big goal split into steps with dates. Undone steps with a date appear on the "Dziś" screen and
// in the calendar; late ones are listed as "Zaległe kroki". Templates give a ready list of steps (MIT, an exchange year in
// the USA) that the user edits as he likes.
// Saved state (one record in meta "goals"): {v:1, goals:[{id, title, area, note, deadline, created, steps:[{id, title, date, done, doneAt}]}]}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const AREAS = [{ id: "szkola", name: "Szkoła" }, { id: "studia", name: "Studia" }, { id: "wymiana", name: "Wymiana" }, { id: "sport", name: "Sport" },
    { id: "finanse", name: "Finanse" }, { id: "rozwoj", name: "Rozwój" }, { id: "inne", name: "Inne" }];
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const dayOr = v => (typeof v === "string" && DAY.test(v) ? v : null);
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function defaults() { return { v: 1, goals: [] }; }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const seen = new Set();
    const goals = (Array.isArray(o.goals) ? o.goals : []).filter(x => x && typeof x.id === "string" && x.id && str(x.title, 120) && !seen.has(x.id) && seen.add(x.id)).map(x => {
      const ss = new Set();
      return { id: x.id, title: str(x.title, 120), area: AREAS.some(a => a.id === x.area) ? x.area : "inne", note: str(x.note, 600), deadline: dayOr(x.deadline), created: dayOr(x.created),
        steps: (Array.isArray(x.steps) ? x.steps : []).filter(s => s && typeof s.id === "string" && s.id && str(s.title, 160) && !ss.has(s.id) && ss.add(s.id))
          .map(s => ({ id: s.id, title: str(s.title, 160), date: dayOr(s.date), done: s.done === true, doneAt: s.done === true ? dayOr(s.doneAt) : null })) };
    });
    return { v: 1, goals };
  }
  // steps in date order; steps without a date go last, in the order they were added
  const byDate = (a, b) => ((a.date || "9999-99-99") < (b.date || "9999-99-99") ? -1 : (a.date || "9999-99-99") > (b.date || "9999-99-99") ? 1 : 0);
  const sortSteps = steps => steps.slice().sort(byDate);
  function progress(goal) { const total = goal.steps.length, done = goal.steps.filter(s => s.done).length; return { total, done, pct: total ? Math.round(done / total * 100) : 0 }; }
  const nextStep = goal => sortSteps(goal.steps.filter(s => !s.done))[0] || null;
  // undone steps with a date in [from, to] (both days included), with their goal, in date order
  function dueBetween(state, from, to) {
    const out = [];
    for (const goal of state.goals) for (const step of goal.steps) if (!step.done && step.date && step.date >= from && step.date <= to) out.push({ goal, step });
    return out.sort((a, b) => byDate(a.step, b.step));
  }
  const overdue = (state, today) => dueBetween(state, "0000-01-01", dayKeyBefore(today));
  function dayKeyBefore(k) { const d = parseDay(k); d.setDate(d.getDate() - 1); return dayKey(d); }

  // ready lists of steps; Y = the year of applying (autumn). Dates follow mitadmissions.org as of October 2026.
  const TEMPLATES = [
    { id: "mit", name: "MIT (studia w USA)", years: true, make: Y => ({ title: "Dostać się na MIT", area: "studia", deadline: `${Y}-11-01`,
      note: "Terminy według mitadmissions.org (październik 2026): Early Action do 1 listopada, Regular Action do 4 stycznia, SAT/ACT najpóźniej do 30 listopada (EA). Przed aplikacją sprawdź je jeszcze raz — mogą się zmienić.",
      steps: [["Wybierz test: SAT albo ACT (MIT wymaga jednego z nich)", null], ["Próbny SAT (aplikacja Bluebook) — sprawdź, gdzie jesteś", `${Y - 1}-03-01`],
        ["Test z angielskiego (TOEFL, IELTS, Duolingo albo Cambridge)", `${Y}-06-30`], ["Uzupełnione aktywności i osiągnięcia (zakładka Portfolio)", `${Y}-09-01`],
        ["Poproś dwóch nauczycieli o rekomendacje: przedmiot ścisły + humanistyczny albo język", `${Y}-09-15`], ["Eseje do aplikacji", `${Y}-10-15`],
        ["Złóż aplikację (Early Action)", `${Y}-11-01`], ["Ostatni termin SAT/ACT dla Early Action", `${Y}-11-30`], ["Wniosek o pomoc finansową (Early Action)", `${Y}-11-30`],
        ["Wyniki Early Action (połowa grudnia)", `${Y}-12-15`]] }) },
    { id: "wymiana", name: "Wymiana do USA", years: false, make: () => ({ title: "Wymiana do USA", area: "wymiana", deadline: null,
      note: "Wpisz daty kroków, kiedy je poznasz (np. termin zgłoszenia).",
      steps: [["Zgłoszenie (wpisz termin)", null], ["Rozmowa kwalifikacyjna", null], ["Rozmowa z wychowawcą i dyrekcją: jak nadrobić rok bez powtarzania klasy", null],
        ["Plan nadrabiania materiału (zakładka Nauka)", null], ["Paszport i wiza", null], ["Ubezpieczenie i sprawy organizacyjne", null], ["Wyjazd", null]] }) },
  ];
  // a template -> a goal with new ids
  function fromTemplate(id, year, today) {
    const t = TEMPLATES.find(x => x.id === id); if (!t) return null;
    const m = t.make(year);
    return { id: newId("g"), title: m.title, area: m.area, note: m.note, deadline: m.deadline, created: today,
      steps: m.steps.map(([title, date]) => ({ id: newId("s"), title, date, done: false, doneAt: null })) };
  }

  const core = { AREAS, TEMPLATES, defaults, normalize, sortSteps, progress, nextStep, dueBetween, overdue, fromTemplate, dayKey, parseDay, daysBetween };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmGoals = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtLong = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  const fmtShortY = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" }), fmtShortYY = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric" });
  const fmtShort = { format: d => (d.getFullYear() === now().getFullYear() ? fmtShortY : fmtShortYY).format(d) };
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const when = n => (n === 0 ? "dziś" : n === 1 ? "jutro" : n > 0 ? `za ${n} ${plural(n, "dzień", "dni", "dni")}` : n === -1 ? "wczoraj" : `${-n} ${plural(-n, "dzień", "dni", "dni")} temu`);
  const areaName = id => (AREAS.find(a => a.id === id) || AREAS[AREAS.length - 1]).name;
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, now = () => new Date();
  const ui = { open: null, sheet: null };
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const goalById = id => S.goals.find(x => x.id === id) || null;
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; if (ui.open && !goalById(ui.open)) ui.open = null; render(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  function save(next, okText, undoTo) {
    if (!P || !P.save) return false;
    const prev = S;
    S = normalize(next);
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { S = normalize(P.load ? P.load() : prev); render(); changed(); return false; }
    render(); changed();
    if (okText && P.whenSaved) P.whenSaved(res, () => say().info(okText, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
    return true;
  }

  const stepWhen = (s, T) => { if (!s.date) return "bez daty"; const d = daysBetween(T, s.date); return `${fmtShort.format(parseDay(s.date))} · ${when(d)}`; };
  const bar = pct => `<div class="lf-bar" role="img" aria-label="${pct}%"><span style="width:${pct}%"></span></div>`;

  function listView() {
    const T = today(), late = overdue(S, T), dis = canWrite() ? "" : "disabled";
    const cards = S.goals.map(goal => {
      const p = progress(goal), nx = nextStep(goal), dl = goal.deadline ? daysBetween(T, goal.deadline) : null;
      return `<article class="panel gl-card${p.total && p.done === p.total ? " done" : ""}" data-gid="${esc(goal.id)}">
        <div class="row"><button type="button" class="gl-name" data-glact="open" data-gid="${esc(goal.id)}">${esc(goal.title)} <span aria-hidden="true">›</span></button><span class="lf-tag">${esc(areaName(goal.area))}</span></div>
        ${bar(p.pct)}<p class="meta">${p.done} z ${p.total} ${plural(p.total, "kroku", "kroków", "kroków")}${goal.deadline ? ` · termin: ${esc(fmtLong.format(parseDay(goal.deadline)))} (${when(dl)})` : ""}</p>
        ${p.total && p.done === p.total ? `<p class="gl-next good">Wszystkie kroki zrobione — cel osiągnięty!</p>` : nx ? `<p class="gl-next${nx.date && nx.date < T ? " late" : ""}">Następny krok: <b>${esc(nx.title)}</b> <span class="meta">(${esc(stepWhen(nx, T))})</span></p>` : `<p class="meta">Dodaj pierwszy krok.</p>`}
      </article>`;
    }).join("");
    return `<section class="panel"><div class="row"><h2>Twoje cele</h2><button type="button" class="btn primary" data-glact="new" ${dis}>+ Nowy cel</button></div>
        <p class="hint">Duży cel rozbij na kroki z datami. Kroki z datą pokażą się na ekranie Dziś i w kalendarzu.</p>
        <div class="lf-chips"><span class="meta">Z szablonu:</span>${TEMPLATES.map(t => `<button type="button" class="chip" data-glact="tpl" data-t="${t.id}" ${dis}>${esc(t.name)}</button>`).join("")}</div>
        ${S.goals.length ? "" : `<p class="meta">Nie masz jeszcze celów.</p>`}</section>
      ${late.length ? `<section class="panel gl-late"><h2>Zaległe kroki</h2><ul class="lf-list">${late.map(({ goal, step }) => `<li><button type="button" class="lf-row" data-glact="open" data-gid="${esc(goal.id)}"><span class="lf-d">${esc(fmtShort.format(parseDay(step.date)))}</span><span>${esc(step.title)}<small>${esc(goal.title)}</small></span><span class="lf-late">${esc(when(daysBetween(T, step.date)))}</span></button></li>`).join("")}</ul></section>` : ""}
      ${cards}`;
  }

  function goalView(goal) {
    const T = today(), p = progress(goal), dis = canWrite() ? "" : "disabled";
    const steps = sortSteps(goal.steps);
    return `<div class="row"><button type="button" class="btn link" data-glact="back">‹ Wszystkie cele</button></div>
      <section class="panel gl-detail">
        <div class="row"><h2>${esc(goal.title)}</h2><span class="lf-tag">${esc(areaName(goal.area))}</span></div>
        ${bar(p.pct)}<p class="meta">${p.done} z ${p.total} ${plural(p.total, "kroku", "kroków", "kroków")} (${p.pct}%)${goal.deadline ? ` · termin: ${esc(fmtLong.format(parseDay(goal.deadline)))} (${when(daysBetween(T, goal.deadline))})` : ""}</p>
        ${goal.note ? `<p class="gl-note">${esc(goal.note)}</p>` : ""}
        <ul class="gl-steps">${steps.map(s => `<li class="gl-step${s.done ? " done" : ""}${!s.done && s.date && s.date < T ? " late" : ""}">
          <button type="button" class="gl-check" data-glact="toggle" data-sid="${esc(s.id)}" aria-pressed="${s.done}" aria-label="${s.done ? "Zrobione" : "Do zrobienia"}: ${esc(s.title)}" ${dis}>${s.done ? "✓" : ""}</button>
          <span class="gl-st"><span class="gl-tt">${esc(s.title)}</span><small>${esc(s.done && s.doneAt ? `zrobione ${fmtShort.format(parseDay(s.doneAt))}` : stepWhen(s, T))}</small></span>
          <button type="button" class="icon-btn" data-glact="editStep" data-sid="${esc(s.id)}" aria-label="Edytuj krok: ${esc(s.title)}" ${dis}>✎</button></li>`).join("")}</ul>
        <form class="gl-add" id="glStepForm" novalidate><input name="title" type="text" maxlength="160" placeholder="Nowy krok" aria-label="Nowy krok" ${dis}><input name="date" type="date" aria-label="Data kroku" ${dis}><button type="submit" class="btn" ${dis}>Dodaj</button></form>
        <p class="sc-err" id="glStepErr" role="alert"></p>
        <div class="actions"><button type="button" class="btn" data-glact="edit" ${dis}>Edytuj cel</button></div>
      </section>`;
  }

  function render() {
    const root = $("glRoot"); if (!root) return;
    const goal = ui.open && goalById(ui.open);
    if (!goal) ui.open = null;
    root.innerHTML = goal ? goalView(goal) : listView();
    renderSheet();
  }

  /* ---------- sheets: a goal, a step, a template ---------- */
  function renderSheet() {
    const el = $("glSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data;
    let inner = "", del = "";
    if (sh.mode === "goal") {
      inner = `<h2 id="glTitle">${d.id ? "Edytuj cel" : "Nowy cel"}</h2>
        <label class="sc-field"><span class="k">Cel</span><input name="title" type="text" maxlength="120" placeholder="np. Średnia 5,0 na koniec roku" value="${esc(d.title)}"></label>
        <div class="sc-field"><span class="k">Obszar</span><div class="sc-cats">${AREAS.map(a => `<button type="button" class="chip" data-glform="area" data-v="${a.id}" aria-pressed="${d.area === a.id}">${esc(a.name)}</button>`).join("")}</div></div>
        <label class="sc-field"><span class="k">Termin (opcjonalnie)</span><input name="deadline" type="date" value="${esc(d.deadline || "")}"></label>
        <label class="sc-field"><span class="k">Notatka (dlaczego, co pomoże)</span><textarea name="note" rows="3" maxlength="600">${esc(d.note)}</textarea></label>`;
      if (d.id) del = `<button type="button" class="btn danger" data-glform="delGoal">Usuń cel</button>`;
    } else if (sh.mode === "step") {
      inner = `<h2 id="glTitle">Edytuj krok</h2>
        <label class="sc-field"><span class="k">Krok</span><input name="title" type="text" maxlength="160" value="${esc(d.title)}"></label>
        <label class="sc-field"><span class="k">Data (opcjonalnie)</span><input name="date" type="date" value="${esc(d.date || "")}"></label>`;
      del = `<button type="button" class="btn danger" data-glform="delStep">Usuń krok</button>`;
    } else {
      const t = TEMPLATES.find(x => x.id === d.t), preview = t.make(d.year);
      inner = `<h2 id="glTitle">Szablon: ${esc(t.name)}</h2>
        ${t.years ? `<div class="sc-field"><span class="k">Rok, w którym składasz aplikację (jesień)</span><div class="sc-cats">${d.years.map(y => `<button type="button" class="chip" data-glform="year" data-v="${y}" aria-pressed="${y === d.year}">${y}</button>`).join("")}</div></div>` : ""}
        <p class="hint">${esc(preview.note)}</p>
        <ol class="gl-prev">${preview.steps.map(([title, date]) => `<li>${esc(title)}${date ? ` <span class="meta">— ${esc(fmtLong.format(parseDay(date)))}</span>` : ""}</li>`).join("")}</ol>
        <p class="meta">Po dodaniu możesz wszystko zmienić: kroki, daty i nazwę.</p>`;
    }
    el.innerHTML = `<div class="sc-backdrop" data-glform="close"></div><form class="panel sc-form" id="glForm" role="dialog" aria-modal="true" aria-labelledby="glTitle" novalidate>
      ${inner}<p class="sc-err" id="glErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">${sh.mode === "tpl" ? "Dodaj cel" : "Zapisz"}</button><button type="button" class="btn" data-glform="close">Anuluj</button>${del}</div></form>`;
    const f = doc.querySelector('#glForm input[name="title"]'); if (f && f.focus && !sh.focused) { sh.focused = true; try { f.focus(); } catch (e) {} }
  }
  function openSheet(mode, data) { if (!canWrite()) return false; ui.sheet = { mode, data }; renderSheet(); return true; }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function readForm() {
    const f = $("glForm"), d = ui.sheet.data;
    for (const n of ["title", "deadline", "note", "date"]) { const el = f && f.querySelector(`[name="${n}"]`); if (el) d[n] = el.value; }
    return d;
  }
  function submitSheet() {
    const sh = ui.sheet, d = readForm(), err = m => { const e = $("glErr"); if (e) e.textContent = m; return false; };
    const prev = exportState(), next = exportState();
    if (sh.mode === "goal") {
      const title = (d.title || "").trim();
      if (!title) return err("Wpisz, jaki to cel.");
      if (d.deadline && !DAY.test(d.deadline)) return err("Wybierz poprawną datę.");
      const old = d.id && next.goals.find(x => x.id === d.id);
      if (old) Object.assign(old, { title, area: d.area, deadline: d.deadline || null, note: (d.note || "").trim() });
      else { const gl = { id: newId("g"), title, area: d.area, deadline: d.deadline || null, note: (d.note || "").trim(), created: today(), steps: [] }; next.goals.push(gl); ui.open = gl.id; }
      closeSheet();
      return save(next, old ? `Zapisano cel: ${title}.` : `Dodano cel: ${title}. Dodaj teraz kroki.`, prev);
    }
    if (sh.mode === "step") {
      const title = (d.title || "").trim();
      if (!title) return err("Wpisz, co jest do zrobienia.");
      const gl = next.goals.find(x => x.id === d.gid), st = gl && gl.steps.find(s => s.id === d.id);
      if (!st) return closeSheet();
      Object.assign(st, { title, date: d.date || null });
      closeSheet();
      return save(next, "Zapisano krok.", prev);
    }
    const gl = fromTemplate(d.t, d.year, today());
    next.goals.push(gl); ui.open = gl.id;
    closeSheet();
    return save(next, `Dodano cel z szablonu: ${gl.title} (${gl.steps.length} kroków).`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-glform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.glform, d = readForm();
    if (a === "close") closeSheet();
    else if (a === "area") { d.area = b.dataset.v; renderSheet(); }
    else if (a === "year") { d.year = +b.dataset.v; renderSheet(); }
    else if (a === "delGoal") {
      const prev = exportState(), next = exportState(), gl = goalById(d.id);
      next.goals = next.goals.filter(x => x.id !== d.id); ui.open = null;
      closeSheet(); save(next, `Usunięto cel: ${gl ? gl.title : ""}.`, prev);
    } else if (a === "delStep") {
      const prev = exportState(), next = exportState(), gl = next.goals.find(x => x.id === d.gid);
      if (gl) gl.steps = gl.steps.filter(s => s.id !== d.id);
      closeSheet(); save(next, "Usunięto krok.", prev);
    }
  }

  /* ---------- events on the screen ---------- */
  function onClick(e) {
    const b = e.target.closest("[data-glact]"); if (!b || b.disabled) return;
    const a = b.dataset.glact, goal = ui.open && goalById(ui.open);
    if (a === "open") { ui.open = b.dataset.gid; render(); try { g.scrollTo({ top: 0 }); } catch (x) {} }
    else if (a === "back") { ui.open = null; render(); }
    else if (a === "new") openSheet("goal", { id: null, title: "", area: "szkola", deadline: "", note: "" });
    else if (a === "edit" && goal) openSheet("goal", { id: goal.id, title: goal.title, area: goal.area, deadline: goal.deadline || "", note: goal.note });
    else if (a === "tpl") { const y = now().getFullYear(); openSheet("tpl", { t: b.dataset.t, years: [y + 1, y + 2, y + 3], year: y + 2 }); }
    else if (a === "editStep" && goal) { const s = goal.steps.find(x => x.id === b.dataset.sid); if (s) openSheet("step", { gid: goal.id, id: s.id, title: s.title, date: s.date || "" }); }
    else if (a === "toggle" && goal) {
      const next = exportState(), gl = next.goals.find(x => x.id === goal.id), s = gl.steps.find(x => x.id === b.dataset.sid);
      if (!s) return;
      s.done = !s.done; s.doneAt = s.done ? today() : null;
      const p = progress(gl);
      save(next, s.done && p.done === p.total ? `Wszystkie kroki zrobione — cel „${gl.title}” osiągnięty!` : null);
    }
  }
  function onSubmit(e) {
    if (e.target.id === "glStepForm") {
      e.preventDefault();
      const goal = ui.open && goalById(ui.open); if (!goal || !canWrite()) return;
      const f = e.target, title = f.querySelector('[name="title"]').value.trim(), date = f.querySelector('[name="date"]').value;
      if (!title) { const er = $("glStepErr"); if (er) er.textContent = "Wpisz, co jest do zrobienia."; return; }
      const prev = exportState(), next = exportState();
      next.goals.find(x => x.id === goal.id).steps.push({ id: newId("s"), title, date: DAY.test(date) ? date : null, done: false, doneAt: null });
      save(next, `Dodano krok: ${title}.`, prev);
      const t = doc.querySelector('#glStepForm [name="title"]'); if (t && t.focus) try { t.focus(); } catch (x) {}
    }
  }
  function mount() {
    const root = $("glRoot");
    if (root) { root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); }
    const sh = $("glSheet");
    if (sh) { sh.addEventListener("click", onSheetClick); sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); }); }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
  }
  // the tile on "Więcej"
  function summary() {
    const n = S.goals.length; if (!n) return "Duże cele rozbite na kroki";
    const nx = S.goals.map(nextStep).filter(s => s && s.date).sort(byDate)[0];
    return `${n} ${plural(n, "cel", "cele", "celów")}${nx ? ` · następny krok ${when(daysBetween(today(), nx.date))}` : ""}`;
  }
  function setClock(fn) { now = fn || (() => new Date()); }
  function openGoal(id) { ui.open = goalById(id) ? id : null; render(); }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, openGoal, ui, canWrite,
    dueBetween: (from, to) => dueBetween(S, from, to), overdue: () => overdue(S, today()) });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmGoals = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
