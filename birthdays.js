// Rytm: birthdays and presents (Urodziny). A name, the day and month (the year if known, then the age shows), ideas for
// a present (ticked when bought) and a note. The birthdays come back every year in the calendar (category "Urodziny"),
// and a week before Dziś shows "za 5 dni: Ania".
// Saved state (one record in meta "birthdays"): {v:1, people:[{id, name, day, month, year, note, ideas:[{id, text, got}]}]}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
  const MONTHS_NOM = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
  const daysIn = (m, y) => new Date(y, m, 0).getDate();
  const intIn = (v, a, b) => (Number.isInteger(v) && v >= a && v <= b ? v : null);

  function defaults() { return { v: 1, people: [] }; }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const ids = new Set();
    const people = (Array.isArray(o.people) ? o.people : []).filter(p => p && typeof p.id === "string" && p.id && !ids.has(p.id) && str(p.name, 60)
        && intIn(p.month, 1, 12) && intIn(p.day, 1, daysIn(p.month, 2024)) && ids.add(p.id))
      .map(p => ({ id: p.id, name: str(p.name, 60), day: p.day, month: p.month, year: intIn(p.year, 1900, 2100), note: str(p.note, 300),
        ideas: (Array.isArray(p.ideas) ? p.ideas : []).filter(x => x && typeof x.id === "string" && x.id && !ids.has(x.id) && str(x.text, 120) && ids.add(x.id))
          .map(x => ({ id: x.id, text: str(x.text, 120), got: x.got === true })) }));
    return { v: 1, people };
  }
  // the birthday in a given year (29 February → 28 February when the year has no 29th)
  const inYear = (p, y) => `${y}-${pad(p.month)}-${pad(Math.min(p.day, daysIn(p.month, y)))}`;
  // the next birthday from `today` (today counts)
  function next(p, today) { const y = parseDay(today).getFullYear(), k = inYear(p, y); return k >= today ? k : inYear(p, y + 1); }
  const ageOn = (p, k) => (p.year ? parseDay(k).getFullYear() - p.year : null);
  // everyone, by the next birthday: {p, date, days, age}
  function upcoming(state, today, within) {
    return state.people.map(p => { const d = next(p, today); return { p, date: d, days: daysBetween(today, d), age: ageOn(p, d) }; })
      .filter(x => within == null || x.days <= within).sort((a, b) => a.days - b.days || a.p.name.localeCompare(b.p.name, "pl"));
  }
  // birthdays on day k (for the calendar)
  const on = (state, k) => state.people.filter(p => inYear(p, parseDay(k).getFullYear()) === k).map(p => ({ p, age: ageOn(p, k) }));

  const core = { MONTHS, defaults, normalize, next, ageOn, upcoming, on, dayKey, parseDay, daysBetween };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmBirthdays = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const when = n => (n === 0 ? "dziś!" : n === 1 ? "jutro" : n === 2 ? "pojutrze" : `za ${n} ${plural(n, "dzień", "dni", "dni")}`);
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };
  const dateTxt = p => `${p.day} ${MONTHS[p.month - 1]}`;

  let S = defaults(), P = null, now = () => new Date();
  const ui = { open: null, sheet: null };
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; if (ui.open && !S.people.some(p => p.id === ui.open)) ui.open = null; render(); }
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

  const ideasLeft = p => p.ideas.filter(x => !x.got).length;
  function personCard(x, dis) {
    const p = x.p, open = ui.open === p.id, left = ideasLeft(p), got = p.ideas.length - left;
    return `<li class="bd-item${x.days <= 7 ? " soon" : ""}${x.days === 0 ? " today" : ""}${open ? " open" : ""}">
      <button type="button" class="bd-head" data-bdact="open" data-id="${esc(p.id)}" aria-expanded="${open}">
        <span class="bd-cal" aria-hidden="true"><b>${p.day}</b><small>${esc(MONTHS[p.month - 1].slice(0, 3))}</small></span>
        <span class="bd-nm"><b>${esc(p.name)}</b><small>${esc(when(x.days))}${x.age != null ? ` · kończy ${x.age}` : ""}${p.ideas.length ? ` · ${got ? `prezent: ${got === p.ideas.length ? "kupiony ✓" : `${got} z ${p.ideas.length}`}` : `${left} ${plural(left, "pomysł", "pomysły", "pomysłów")}`}` : ""}</small></span>
        <i aria-hidden="true">${open ? "▴" : "▾"}</i></button>
      ${open ? `<div class="bd-body">
        <p class="meta">${esc(dateTxt(p))}${p.year ? ` ${p.year}` : ""}</p>
        ${p.note ? `<p class="bd-note">${esc(p.note)}</p>` : ""}
        <h3>Pomysły na prezent</h3>
        ${p.ideas.length ? `<ul class="bd-ideas">${p.ideas.map(i => `<li class="${i.got ? "got" : ""}"><button type="button" class="hw-check" data-bdact="got" data-id="${esc(p.id)}" data-iid="${esc(i.id)}" aria-pressed="${i.got}" aria-label="${i.got ? "Kupione" : "Oznacz jako kupione"}: ${esc(i.text)}" ${dis}>✓</button><span>${esc(i.text)}</span><button type="button" class="icon-btn" data-bdact="delIdea" data-id="${esc(p.id)}" data-iid="${esc(i.id)}" aria-label="Usuń pomysł ${esc(i.text)}" ${dis}>×</button></li>`).join("")}</ul>` : `<p class="meta">Jeszcze nic — dopisz, gdy coś przyjdzie ci do głowy.</p>`}
        <form class="gl-add" data-bdidea="${esc(p.id)}" novalidate><input name="text" type="text" maxlength="120" placeholder="np. książka, słuchawki, bilet" aria-label="Nowy pomysł na prezent: ${esc(p.name)}" ${dis}><button type="submit" class="btn" ${dis}>Dodaj</button></form>
        <div class="actions"><button type="button" class="btn" data-bdact="edit" data-id="${esc(p.id)}" ${dis}>Edytuj</button></div>
      </div>` : ""}</li>`;
  }
  function fullView() {
    const T = today(), dis = canWrite() ? "" : "disabled", list = upcoming(S, T), soon = list.filter(x => x.days <= 30);
    return `<section class="panel bd-top"><div class="row"><h2>Urodziny</h2><button type="button" class="btn primary" data-bdact="new" ${dis}>+ Osoba</button></div>
        <p class="hint">Urodziny pokażą się co roku w kalendarzu, a tydzień wcześniej na ekranie Dziś. Pomysły na prezent zapisuj, kiedy przyjdą do głowy.</p></section>
      ${list.length ? `${soon.length ? `<section class="panel"><h2>Najbliższe 30 dni</h2><ul class="bd-list">${soon.map(x => personCard(x, dis)).join("")}</ul></section>` : ""}
        ${list.length > soon.length ? `<section class="panel"><h2>${soon.length ? "Później" : "Wszyscy"}</h2><ul class="bd-list">${list.filter(x => x.days > 30).map(x => personCard(x, dis)).join("")}</ul></section>` : ""}`
        : `<section class="panel"><p class="meta">Nie ma jeszcze nikogo. Dodaj rodzinę i znajomych przyciskiem „+ Osoba”.</p></section>`}`;
  }
  // on Dziś: birthdays in the next 7 days
  function widget(T) {
    T = T || today();
    const list = upcoming(S, T, 7); if (!list.length) return "";
    return `<section class="panel bd-today"><div class="row"><h2>Urodziny</h2><button type="button" class="btn link" data-bdact="go">Wszystkie ›</button></div>
      <ul class="bd-wl">${list.map(x => `<li><button type="button" class="pl-item" data-bdact="go" data-id="${esc(x.p.id)}"><span class="bd-cal small" aria-hidden="true"><b>${x.p.day}</b><small>${esc(MONTHS[x.p.month - 1].slice(0, 3))}</small></span><span class="pl-it"><b>${esc(x.p.name)}</b>${x.age != null ? ` (${x.age})` : ""}<small>${esc(when(x.days))}${x.p.ideas.length ? ` · ${ideasLeft(x.p) ? `${ideasLeft(x.p)} ${plural(ideasLeft(x.p), "pomysł", "pomysły", "pomysłów")} na prezent` : "prezent kupiony ✓"}` : " · brak pomysłu na prezent"}</small></span><span class="pl-k">${x.days === 0 ? "dziś" : "urodziny"}</span></button></li>`).join("")}</ul>
    </section>`;
  }
  function render() { const root = $("bdRoot"); if (root) root.innerHTML = fullView(); renderSheet(); }

  /* ---------- the sheet: a person ---------- */
  function renderSheet() {
    const el = $("bdSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data;
    el.innerHTML = `<div class="sc-backdrop" data-bdform="close"></div><form class="panel sc-form" id="bdForm" role="dialog" aria-modal="true" aria-labelledby="bdTitle" novalidate>
      <h2 id="bdTitle">${d.id ? "Edytuj osobę" : "Nowa osoba"}</h2>
      <label class="sc-field"><span class="k">Imię (albo jak ją nazywasz)</span><input name="name" type="text" maxlength="60" placeholder="np. Ania, babcia, Kuba z klasy" value="${esc(d.name)}"></label>
      <div class="bd-date"><label class="sc-field"><span class="k">Dzień</span><select name="day">${Array.from({ length: 31 }, (_, i) => i + 1).map(n => `<option value="${n}"${+d.day === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="sc-field"><span class="k">Miesiąc</span><select name="month">${MONTHS_NOM.map((m, i) => `<option value="${i + 1}"${+d.month === i + 1 ? " selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="sc-field"><span class="k">Rok (opcjonalnie)</span><input name="year" type="text" inputmode="numeric" maxlength="4" placeholder="—" value="${esc(d.year || "")}"></label></div>
      <label class="sc-field"><span class="k">Notatka (opcjonalnie)</span><input name="note" type="text" maxlength="300" placeholder="np. lubi koszykówkę, rozmiar M" value="${esc(d.note)}"></label>
      <p class="sc-err" id="bdErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-bdform="close">Anuluj</button>${d.id ? `<button type="button" class="btn danger" data-bdform="del">Usuń</button>` : ""}</div></form>`;
    const f = doc.querySelector('#bdForm input[name="name"]'); if (f && f.focus && !sh.focused) { sh.focused = true; try { f.focus(); } catch (e) {} }
  }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function submitSheet() {
    const f = $("bdForm"), d = ui.sheet.data, val = n => (f.querySelector(`[name="${n}"]`) || {}).value || "", err = m => { const e = $("bdErr"); if (e) e.textContent = m; return false; };
    const name = val("name").trim(), day = +val("day"), month = +val("month"), ys = val("year").trim(), year = ys ? +ys : null;
    if (!name) return err("Wpisz imię.");
    if (day > daysIn(month, 2024)) return err(`${MONTHS_NOM[month - 1]} nie ma ${day} dni.`);
    if (ys && !(Number.isInteger(year) && year >= 1900 && year <= parseDay(today()).getFullYear())) return err("Rok: cztery cyfry, np. 2010 (albo zostaw puste).");
    const prev = exportState(), next = exportState(), old = d.id && next.people.find(p => p.id === d.id);
    const rec = { name, day, month, year, note: val("note").trim() };
    if (old) Object.assign(old, rec); else { const p = Object.assign({ id: newId("b"), ideas: [] }, rec); next.people.push(p); ui.open = p.id; }
    closeSheet();
    const days = daysBetween(today(), core.next(rec, today()));
    return save(next, `${old ? "Zapisano" : "Dodano"}: ${name}, ${dateTxt(rec)} (${when(days)}).`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-bdform]"); if (!b || !ui.sheet) return;
    if (b.dataset.bdform === "close") closeSheet();
    else if (b.dataset.bdform === "del") {
      const prev = exportState(), next = exportState(), p = S.people.find(x => x.id === ui.sheet.data.id);
      next.people = next.people.filter(x => x.id !== ui.sheet.data.id); ui.open = null; closeSheet();
      save(next, `Usunięto: ${p ? p.name : ""}.`, prev);
    }
  }

  /* ---------- events (in Urodziny and in the panel on Dziś) ---------- */
  function onClick(e) {
    const b = e.target.closest("[data-bdact]"); if (!b || b.disabled) return;
    const a = b.dataset.bdact;
    if (a === "go") { if (b.dataset.id) ui.open = b.dataset.id; if (P && P.go) P.go("birthdays"); return; }
    if (a === "open") { ui.open = ui.open === b.dataset.id ? null : b.dataset.id; render(); return; }
    if (!canWrite()) return;
    const prev = exportState(), next = exportState(), p = next.people.find(x => x.id === b.dataset.id);
    if (a === "new") { ui.sheet = { data: { id: null, name: "", day: parseDay(today()).getDate(), month: parseDay(today()).getMonth() + 1, year: "", note: "" } }; renderSheet(); }
    else if (a === "edit" && p) { ui.sheet = { data: { id: p.id, name: p.name, day: p.day, month: p.month, year: p.year || "", note: p.note } }; renderSheet(); }
    else if (a === "got" && p) { const i = p.ideas.find(x => x.id === b.dataset.iid); if (!i) return; i.got = !i.got; save(next, i.got ? `Kupione: ${i.text}.` : null); }
    else if (a === "delIdea" && p) { const i = p.ideas.find(x => x.id === b.dataset.iid); p.ideas = p.ideas.filter(x => x.id !== b.dataset.iid); save(next, `Usunięto pomysł: ${i ? i.text : ""}.`, prev); }
  }
  function onSubmit(e) {
    const f = e.target.closest && e.target.closest("form[data-bdidea]"); if (!f) return;
    e.preventDefault(); if (!canWrite()) return;
    const inp = f.querySelector('[name="text"]'), text = inp.value.trim(); if (!text) { try { inp.focus(); } catch (x) {} return; }
    const prev = exportState(), next = exportState(), p = next.people.find(x => x.id === f.dataset.bdidea); if (!p) return;
    p.ideas.push({ id: newId("i"), text: text.slice(0, 120), got: false }); ui.open = p.id;
    save(next, `Dodano pomysł dla: ${p.name}.`, prev);
    const again = doc.querySelector(`form[data-bdidea="${p.id}"] input`); if (again && again.focus) try { again.focus(); } catch (x) {}
  }
  function mount() {
    for (const id of ["bdRoot", "plRoot"]) { const r = $(id); if (r) { r.addEventListener("click", onClick); r.addEventListener("submit", onSubmit); } }
    const sh = $("bdSheet"); if (sh) { sh.addEventListener("click", onSheetClick); sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); }); }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
  }
  function summary() { const n = upcoming(S, today())[0]; return n ? `Najbliższe: ${n.p.name} — ${when(n.days)}` : "Daty urodzin i pomysły na prezenty"; }
  function setClock(fn) { now = fn || (() => new Date()); }
  function openPerson(id) { ui.open = id; }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, widget, openPerson, ui, canWrite,
    on: k => on(S, k), upcoming: (t, w) => upcoming(S, t || today(), w) });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmBirthdays = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
