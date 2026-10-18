// Rytm: portfolio — activities and achievements, written down as they happen, so that an application (e.g. to a US
// university) does not have to be reconstructed from memory. Like application forms ask: what, your role, a short
// description (up to 150 characters), hours per week and weeks per year. Hours of swimming can be taken from the trainings.
// Saved state (one record in meta "portfolio"): {v:1, activities:[{id, name, kind, role, org, desc, start, end, hpw, wpy, auto}], awards:[{id, title, level, date, note}]}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/;
  const KINDS = [{ id: "sport", name: "Sport" }, { id: "konkurs", name: "Konkurs / olimpiada" }, { id: "projekt", name: "Projekt" }, { id: "nauka", name: "Nauka" },
    { id: "wolontariat", name: "Wolontariat" }, { id: "praca", name: "Praca" }, { id: "inne", name: "Inne" }];
  const LEVELS = [{ id: "szkolny", name: "szkolny" }, { id: "miejski", name: "miejski" }, { id: "wojewodzki", name: "wojewódzki" }, { id: "krajowy", name: "krajowy" }, { id: "miedzynarodowy", name: "międzynarodowy" }];
  const DESC_MAX = 150;
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : null);
  const r1 = x => Math.round(x * 10) / 10;
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function defaults() { return { v: 1, activities: [], awards: [] }; }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const ids = new Set(), ok = x => x && typeof x.id === "string" && x.id && !ids.has(x.id);
    const activities = (Array.isArray(o.activities) ? o.activities : []).filter(x => ok(x) && str(x.name, 80) && ids.add(x.id)).map(x => ({
      id: x.id, name: str(x.name, 80), kind: KINDS.some(k => k.id === x.kind) ? x.kind : "inne", role: str(x.role, 60), org: str(x.org, 80), desc: str(x.desc, DESC_MAX),
      start: MONTH.test(x.start || "") ? x.start : null, end: MONTH.test(x.end || "") ? x.end : null,
      hpw: num(x.hpw, 0, 80) == null ? null : r1(x.hpw), wpy: Number.isInteger(x.wpy) && x.wpy >= 0 && x.wpy <= 52 ? x.wpy : null, auto: x.auto === "swim" ? "swim" : null }));
    const awards = (Array.isArray(o.awards) ? o.awards : []).filter(x => ok(x) && str(x.title, 120) && ids.add(x.id)).map(x => ({
      id: x.id, title: str(x.title, 120), level: LEVELS.some(l => l.id === x.level) ? x.level : "szkolny", date: DAY.test(x.date || "") ? x.date : null, note: str(x.note, 200) }));
    return { v: 1, activities, awards };
  }
  const hoursPerYear = a => (a.hpw != null && a.wpy != null ? Math.round(a.hpw * a.wpy) : null);
  const totalHours = S => S.activities.reduce((s, a) => s + (hoursPerYear(a) || 0), 0);
  const ongoing = (a, monthNow) => !a.end || a.end >= monthNow;

  // swimming from the trainings: hours per week over the last `weeks` weeks, and in how many of the last 52 weeks he trained
  // trainings: [{date: Date, swim: bool, total|moving: seconds}]
  function swimStats(trainings, todayKey, weeks = 12) {
    const end = new Date(todayKey + "T23:59:59"), from = new Date(end.getTime() - weeks * 7 * 864e5), year = new Date(end.getTime() - 52 * 7 * 864e5);
    let sec = 0, n = 0; const wk = new Set();
    for (const t of trainings || []) {
      if (!t || !t.swim || !(t.date instanceof Date) || t.date > end) continue;
      const s = t.total || t.moving || 0;
      if (t.date >= from) { sec += s; n++; }
      if (t.date >= year) wk.add(Math.floor((end - t.date) / (7 * 864e5)));
    }
    return { sessions: n, hours: r1(sec / 3600), hpw: r1(sec / 3600 / weeks), activeWeeks: wk.size, weeks };
  }
  // plain text for copying into an application form
  function asText(S) {
    const kind = id => (KINDS.find(k => k.id === id) || KINDS[KINDS.length - 1]).name;
    const lvl = id => (LEVELS.find(l => l.id === id) || LEVELS[0]).name;
    const a = S.activities.map((x, i) => [`${i + 1}. ${x.name} (${kind(x.kind)})${x.role ? " — " + x.role : ""}${x.org ? ", " + x.org : ""}`,
      x.desc, [x.start ? `od ${x.start}` : "", x.end ? `do ${x.end}` : x.start ? "nadal" : "", x.hpw != null ? `${String(x.hpw).replace(".", ",")} h/tydz.` : "", x.wpy != null ? `${x.wpy} tyg./rok` : ""].filter(Boolean).join(", ")].filter(Boolean).join("\n"));
    const w = S.awards.map(x => `• ${x.title} (poziom ${lvl(x.level)}${x.date ? ", " + x.date : ""})${x.note ? " — " + x.note : ""}`);
    return ["AKTYWNOŚCI", ...(a.length ? a : ["(brak)"]), "", "OSIĄGNIĘCIA", ...(w.length ? w : ["(brak)"])].join("\n");
  }

  const core = { KINDS, LEVELS, DESC_MAX, defaults, normalize, hoursPerYear, totalHours, ongoing, swimStats, asText };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmPortfolio = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtLong = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  const fmtMonth = new Intl.DateTimeFormat("pl-PL", { month: "short", year: "numeric" });
  const monthTxt = m => fmtMonth.format(new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1));
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const f1 = x => String(x).replace(".", ",");
  const kindName = id => (KINDS.find(k => k.id === id) || KINDS[KINDS.length - 1]).name;
  const levelName = id => (LEVELS.find(l => l.id === id) || LEVELS[0]).name;
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, now = () => new Date();
  const ui = { sheet: null };
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const swim = () => swimStats(P && P.trainings ? P.trainings() : [], today());

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; render(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  function save(next, okText, undoTo) {
    if (!P || !P.save) return false;
    const prev = S;
    S = normalize(next);
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { S = normalize(P.load ? P.load() : prev); render(); return false; }
    render();
    if (okText && P.whenSaved) P.whenSaved(res, () => say().info(okText, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
    return true;
  }

  function render() {
    const root = $("pfRoot"); if (!root) return;
    const dis = canWrite() ? "" : "disabled", sw = swim(), mNow = today().slice(0, 7);
    const act = S.activities.map(a => {
      const hy = hoursPerYear(a), auto = a.auto === "swim";
      return `<article class="pf-item" data-id="${esc(a.id)}"><div class="row"><b>${esc(a.name)}</b><span class="lf-tag">${esc(kindName(a.kind))}</span></div>
        ${a.role || a.org ? `<p class="meta">${esc([a.role, a.org].filter(Boolean).join(" · "))}</p>` : ""}
        ${a.desc ? `<p>${esc(a.desc)}</p>` : ""}
        <p class="meta">${esc([a.start ? `${monthTxt(a.start)} – ${a.end ? monthTxt(a.end) : "teraz"}` : "", a.hpw != null ? `${f1(a.hpw)} h/tydz.` : "", a.wpy != null ? `${a.wpy} tyg./rok` : "", hy != null ? `≈ ${hy} h rocznie` : ""].filter(Boolean).join(" · "))}${!ongoing(a, mNow) ? " · zakończone" : ""}</p>
        ${auto && sw.sessions ? `<p class="pf-auto">Z twoich treningów: <b>${f1(sw.hpw)} h/tydz.</b> (ostatnie ${sw.weeks} tyg., ${sw.sessions} ${plural(sw.sessions, "trening", "treningi", "treningów")})${Math.abs((a.hpw || 0) - sw.hpw) >= 0.1 ? ` <button type="button" class="btn link" data-pfact="useSwim" data-id="${esc(a.id)}" ${dis}>Wpisz ${f1(sw.hpw)} h</button>` : ""}</p>` : ""}
        <div class="actions"><button type="button" class="btn" data-pfact="editAct" data-id="${esc(a.id)}" ${dis}>Edytuj</button></div></article>`;
    }).join("");
    const awards = S.awards.slice().sort((a, b) => ((b.date || "") > (a.date || "") ? 1 : -1)).map(w => `<li><button type="button" class="lf-row" data-pfact="editAward" data-id="${esc(w.id)}" ${dis}>
      <span class="lf-d">${esc(w.date ? fmtMonth.format(new Date(w.date + "T12:00")) : "—")}</span><span>${esc(w.title)}${w.note ? `<small>${esc(w.note)}</small>` : ""}</span><span class="lf-tag">${esc(levelName(w.level))}</span></button></li>`).join("");
    const hasSwim = S.activities.some(a => a.auto === "swim");
    root.innerHTML = `<section class="panel">
        <div class="tiles lf-tiles3">
          <div class="tile"><span class="k">Aktywności</span><span class="v">${S.activities.length}</span></div>
          <div class="tile"><span class="k">Godzin w roku</span><span class="v">${totalHours(S) ? "≈ " + totalHours(S) : "–"}</span></div>
          <div class="tile"><span class="k">Osiągnięcia</span><span class="v">${S.awards.length}</span></div>
        </div>
        <p class="hint">Zapisuj na bieżąco, co robisz poza lekcjami. W aplikacji na studia w USA pytają o każdą aktywność: twoja rola, krótki opis (do ${DESC_MAX} znaków), ile godzin tygodniowo i ile tygodni w roku.</p>
        <div class="actions"><button type="button" class="btn" data-pfact="copy">Kopiuj wszystko jako tekst</button></div>
      </section>
      <section class="panel"><div class="row"><h2>Aktywności</h2><button type="button" class="btn primary" data-pfact="addAct" ${dis}>+ Aktywność</button></div>
        ${!hasSwim && sw.sessions ? `<p class="pf-auto">Masz ${sw.sessions} ${plural(sw.sessions, "trening", "treningi", "treningów")} pływackich w ostatnich ${sw.weeks} tygodniach (≈ ${f1(sw.hpw)} h/tydz.). <button type="button" class="btn link" data-pfact="addSwim" ${dis}>Dodaj pływanie jako aktywność</button></p>` : ""}
        ${act || `<p class="meta">Nie ma jeszcze aktywności. Pomysły: sport, projekty programistyczne, konkursy i olimpiady, wolontariat, praca.</p>`}</section>
      <section class="panel"><div class="row"><h2>Osiągnięcia</h2><button type="button" class="btn primary" data-pfact="addAward" ${dis}>+ Osiągnięcie</button></div>
        ${awards ? `<ul class="lf-list">${awards}</ul>` : `<p class="meta">Nagrody, wyróżnienia, miejsca w konkursach i zawodach, certyfikaty.</p>`}</section>`;
    renderSheet();
  }

  /* ---------- sheets ---------- */
  function renderSheet() {
    const el = $("pfSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data;
    let inner;
    if (sh.mode === "act") {
      inner = `<h2 id="pfTitle">${d.id ? "Edytuj aktywność" : "Nowa aktywność"}</h2>
        <label class="sc-field"><span class="k">Nazwa</span><input name="name" type="text" maxlength="80" placeholder="np. Pływanie w klubie" value="${esc(d.name)}"></label>
        <div class="sc-field"><span class="k">Rodzaj</span><div class="sc-cats">${KINDS.map(k => `<button type="button" class="chip" data-pfform="kind" data-v="${k.id}" aria-pressed="${d.kind === k.id}">${esc(k.name)}</button>`).join("")}</div></div>
        <label class="sc-field"><span class="k">Twoja rola</span><input name="role" type="text" maxlength="60" placeholder="np. zawodnik, autor, kapitan" value="${esc(d.role)}"></label>
        <label class="sc-field"><span class="k">Gdzie / z kim</span><input name="org" type="text" maxlength="80" placeholder="np. klub, szkoła, organizator" value="${esc(d.org)}"></label>
        <label class="sc-field"><span class="k">Opis <span id="pfDescN">${(d.desc || "").length}/${DESC_MAX}</span></span><textarea name="desc" rows="3" maxlength="${DESC_MAX}" placeholder="Co robisz i co z tego wyszło — konkretnie, z liczbami">${esc(d.desc)}</textarea></label>
        <div class="lf-2col"><label class="sc-field"><span class="k">Od (miesiąc)</span><input name="start" type="month" value="${esc(d.start || "")}"></label>
          <label class="sc-field"><span class="k">Do (puste = nadal)</span><input name="end" type="month" value="${esc(d.end || "")}"></label></div>
        <div class="lf-2col"><label class="sc-field"><span class="k">Godzin tygodniowo</span><input name="hpw" type="text" inputmode="decimal" placeholder="np. 8" value="${esc(d.hpw == null ? "" : f1(d.hpw))}"></label>
          <label class="sc-field"><span class="k">Tygodni w roku</span><input name="wpy" type="text" inputmode="numeric" placeholder="np. 46" value="${esc(d.wpy == null ? "" : d.wpy)}"></label></div>
        ${d.auto === "swim" ? `<p class="meta">Godziny pływania podpowiadam z twoich treningów.</p>` : ""}`;
    } else {
      inner = `<h2 id="pfTitle">${d.id ? "Edytuj osiągnięcie" : "Nowe osiągnięcie"}</h2>
        <label class="sc-field"><span class="k">Co</span><input name="title" type="text" maxlength="120" placeholder="np. Finalista konkursu, 2. miejsce na 100 m" value="${esc(d.title)}"></label>
        <div class="sc-field"><span class="k">Poziom</span><div class="sc-cats">${LEVELS.map(l => `<button type="button" class="chip" data-pfform="level" data-v="${l.id}" aria-pressed="${d.level === l.id}">${esc(l.name)}</button>`).join("")}</div></div>
        <label class="sc-field"><span class="k">Data</span><input name="date" type="date" value="${esc(d.date || "")}" max="${esc(today())}"></label>
        <label class="sc-field"><span class="k">Notatka</span><input name="note" type="text" maxlength="200" value="${esc(d.note)}"></label>`;
    }
    const del = d.id ? `<button type="button" class="btn danger" data-pfform="del">Usuń</button>` : "";
    el.innerHTML = `<div class="sc-backdrop" data-pfform="close"></div><form class="panel sc-form" id="pfForm" role="dialog" aria-modal="true" aria-labelledby="pfTitle" novalidate>
      ${inner}<p class="sc-err" id="pfErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-pfform="close">Anuluj</button>${del}</div></form>`;
  }
  function openSheet(mode, data) { if (!canWrite()) return false; ui.sheet = { mode, data }; renderSheet(); return true; }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function readForm() {
    const f = $("pfForm"), d = ui.sheet.data;
    for (const n of ["name", "role", "org", "desc", "start", "end", "hpw", "wpy", "title", "date", "note"]) { const el = f && f.querySelector(`[name="${n}"]`); if (el) d[n] = el.value; }
    return d;
  }
  function submitSheet() {
    const sh = ui.sheet, d = readForm(), err = m => { const e = $("pfErr"); if (e) e.textContent = m; return false; };
    const prev = exportState(), next = exportState();
    if (sh.mode === "act") {
      const name = (d.name || "").trim();
      if (!name) return err("Wpisz nazwę aktywności.");
      const hpwS = String(d.hpw == null ? "" : d.hpw).trim().replace(",", "."), wpyS = String(d.wpy == null ? "" : d.wpy).trim();
      const hpw = hpwS === "" ? null : Number(hpwS), wpy = wpyS === "" ? null : Number(wpyS);
      if (hpw != null && !(isFinite(hpw) && hpw >= 0 && hpw <= 80)) return err("Godziny tygodniowo: liczba od 0 do 80.");
      if (wpy != null && !(Number.isInteger(wpy) && wpy >= 0 && wpy <= 52)) return err("Tygodnie w roku: liczba od 0 do 52.");
      if (d.start && d.end && d.end < d.start) return err("Koniec nie może być przed początkiem.");
      const rec = { id: d.id || newId("a"), name, kind: d.kind, role: (d.role || "").trim(), org: (d.org || "").trim(), desc: (d.desc || "").trim().slice(0, DESC_MAX),
        start: d.start || null, end: d.end || null, hpw: hpw == null ? null : r1(hpw), wpy, auto: d.auto || null };
      const old = d.id && next.activities.find(x => x.id === d.id);
      if (old) Object.assign(old, rec); else next.activities.push(rec);
      closeSheet();
      return save(next, `${old ? "Zapisano" : "Dodano"} aktywność: ${name}.`, prev);
    }
    const title = (d.title || "").trim();
    if (!title) return err("Wpisz, co osiągnąłeś.");
    if (d.date && d.date > today()) return err("Data nie może być z przyszłości.");
    const rec = { id: d.id || newId("w"), title, level: d.level, date: d.date || null, note: (d.note || "").trim() };
    const old = d.id && next.awards.find(x => x.id === d.id);
    if (old) Object.assign(old, rec); else next.awards.push(rec);
    closeSheet();
    return save(next, `${old ? "Zapisano" : "Dodano"} osiągnięcie: ${title}.`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-pfform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.pfform, d = readForm();
    if (a === "close") closeSheet();
    else if (a === "kind") { d.kind = b.dataset.v; renderSheet(); }
    else if (a === "level") { d.level = b.dataset.v; renderSheet(); }
    else if (a === "del") {
      const prev = exportState(), next = exportState(), list = ui.sheet.mode === "act" ? "activities" : "awards";
      const x = next[list].find(y => y.id === d.id);
      next[list] = next[list].filter(y => y.id !== d.id);
      closeSheet(); save(next, `Usunięto: ${x ? x.name || x.title : ""}.`, prev);
    }
  }
  function onClick(e) {
    const b = e.target.closest("[data-pfact]"); if (!b || b.disabled) return;
    const a = b.dataset.pfact, sw = swim();
    if (a === "addAct") openSheet("act", { id: null, name: "", kind: "projekt", role: "", org: "", desc: "", start: today().slice(0, 7), end: "", hpw: null, wpy: null, auto: null });
    else if (a === "addSwim") openSheet("act", { id: null, name: "Pływanie", kind: "sport", role: "zawodnik", org: "", desc: "", start: "", end: "", hpw: sw.hpw, wpy: Math.min(52, sw.activeWeeks) || null, auto: "swim" });
    else if (a === "editAct") { const x = S.activities.find(y => y.id === b.dataset.id); if (x) openSheet("act", Object.assign({}, x)); }
    else if (a === "addAward") openSheet("award", { id: null, title: "", level: "szkolny", date: today(), note: "" });
    else if (a === "editAward") { const x = S.awards.find(y => y.id === b.dataset.id); if (x) openSheet("award", Object.assign({}, x)); }
    else if (a === "useSwim") {
      const prev = exportState(), next = exportState(), x = next.activities.find(y => y.id === b.dataset.id); if (!x) return;
      x.hpw = sw.hpw; save(next, `Wpisano ${f1(sw.hpw)} h tygodniowo (z treningów).`, prev);
    } else if (a === "copy") {
      const text = asText(S), done = () => say().info("Skopiowano. Wklej, gdzie potrzebujesz.");
      try { g.navigator.clipboard.writeText(text).then(done, () => say().info("Nie udało się skopiować automatycznie.")); } catch (x) { say().info("Nie udało się skopiować automatycznie."); }
    }
  }
  function mount() {
    const root = $("pfRoot"); if (root) root.addEventListener("click", onClick);
    const sh = $("pfSheet");
    if (sh) {
      sh.addEventListener("click", onSheetClick);
      sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); });
      sh.addEventListener("input", e => { if (e.target.name === "desc") { const n = $("pfDescN"); if (n) n.textContent = `${e.target.value.length}/${DESC_MAX}`; } });
    }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
  }
  function summary() { const a = S.activities.length, w = S.awards.length; return a || w ? `${a} ${plural(a, "aktywność", "aktywności", "aktywności")} · ${w} ${plural(w, "osiągnięcie", "osiągnięcia", "osiągnięć")}` : "Aktywności i osiągnięcia"; }
  function setClock(fn) { now = fn || (() => new Date()); }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, ui, canWrite });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmPortfolio = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
