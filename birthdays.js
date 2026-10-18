// Rytm: birthdays and presents (Urodziny). A name, the day and month (the year if known, then the age shows), ideas for
// a present (ticked when bought) and a note. The birthdays come back every year in the calendar (category "Urodziny"),
// and a week before Dziś shows "za 5 dni: Ania". A red dot on "Więcej" and on the Urodziny tile a week before, again
// 2 days before and on the day; opening Urodziny marks it as read. A list can be pasted ("Ania - 9 stycznia (2010)").
// "Wspomnienie" (someone who has died): in the list and the calendar, without the age and without the red dot.
// Saved state (one record in meta "birthdays"):
//   {v:1, people:[{id, name, day, month, year, note, memorial, ideas:[{id, text, got}]}], seen:["<person id>|<date>|<7|2|0>"]}
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
  const fold = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
  const MONTH_KEYS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paz", "lis", "gru"];
  const MEMORIAL = /[\u{1F940}\u2020\u271D\u271E]/gu;          // 🥀 † ✝ ✞

  function defaults() { return { v: 1, people: [], seen: [] }; }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const ids = new Set();
    const people = (Array.isArray(o.people) ? o.people : []).filter(p => p && typeof p.id === "string" && p.id && !ids.has(p.id) && str(p.name, 60)
        && intIn(p.month, 1, 12) && intIn(p.day, 1, daysIn(p.month, 2024)) && ids.add(p.id))
      .map(p => ({ id: p.id, name: str(p.name, 60), day: p.day, month: p.month, year: intIn(p.year, 1900, 2100), note: str(p.note, 300), memorial: p.memorial === true,
        ideas: (Array.isArray(p.ideas) ? p.ideas : []).filter(x => x && typeof x.id === "string" && x.id && !ids.has(x.id) && str(x.text, 120) && ids.add(x.id))
          .map(x => ({ id: x.id, text: str(x.text, 120), got: x.got === true })) }));
    const seen = (Array.isArray(o.seen) ? o.seen : []).filter(k => typeof k === "string" && k.length <= 80 && /^[^|]+\|\d{4}-\d{2}-\d{2}\|[720]$/.test(k));
    return { v: 1, people, seen: [...new Set(seen)] };
  }
  // one line of a pasted list: "Ania - 9 stycznia (2010)", "Babcia Hania - 7 września (1957)", "Mama - 23 czerwca (dzień ojca) (1981)",
  // "Kuba: 21 październik 2011", "Ola 1.09.2010". Other things in brackets become the note; 🥀 or † = a memorial.
  function parseLine(line) {
    let t = String(line || "").trim(); if (!t || !/\d/.test(t)) return null;           // a title like "Urodziny"
    const memorial = MEMORIAL.test(t); MEMORIAL.lastIndex = 0;
    let year = null; const notes = [];
    t = t.replace(/\(([^)]*)\)/g, (m, x) => { const v = x.replace(MEMORIAL, "").trim(); MEMORIAL.lastIndex = 0; if (/^\d{4}$/.test(v)) year = +v; else if (v) notes.push(v); return " "; });
    t = t.replace(MEMORIAL, " ").replace(/\s+/g, " ").trim(); MEMORIAL.lastIndex = 0;
    let name, day, month;
    let m = /^(.+?)\s*[-–—:]?\s+(\d{1,2})\.?\s+(\p{L}+)\.?(?:\s+(\d{4})(?:\s*r\.?)?)?$/u.exec(t);
    if (m) { name = m[1]; day = +m[2]; month = MONTH_KEYS.indexOf(fold(m[3]).slice(0, 3)) + 1; if (m[4]) year = +m[4]; }
    else if ((m = /^(.+?)\s*[-–—:]?\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\.?$/u.exec(t))) { name = m[1]; day = +m[2]; month = +m[3]; if (m[4]) year = +m[4]; }
    else return { bad: true, line: String(line).trim() };
    name = name.replace(/[\s\-–—:]+$/, "").trim().slice(0, 60);
    if (!name || month < 1 || month > 12 || day < 1 || day > daysIn(month, 2024)) return { bad: true, line: String(line).trim() };
    return { name, day, month, year: intIn(year, 1900, 2100), note: notes.join(", ").slice(0, 300), memorial };
  }
  // a whole pasted list -> {add: [person], dup: [name], bad: [line]} (a name already on the list or twice in the text is not added again)
  function parseList(text, state) {
    const have = new Set(((state && state.people) || []).map(p => fold(p.name))), out = { add: [], dup: [], bad: [] };
    for (const line of String(text || "").split(/\r?\n/)) {
      const r = parseLine(line); if (!r) continue;
      if (r.bad) { out.bad.push(r.line); continue; }
      if (have.has(fold(r.name))) { out.dup.push(r.name); continue; }
      have.add(fold(r.name)); out.add.push(r);
    }
    return out;
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
  // the red dot: a week before (7…3 days), again 2 days before (2…1) and on the day; each stage once, until it is read
  const stage = days => (days === 0 ? "0" : days <= 2 ? "2" : days <= 7 ? "7" : null);
  const alerts = (state, today) => upcoming(state, today, 7).filter(x => !x.p.memorial).map(x => ({ key: `${x.p.id}|${x.date}|${stage(x.days)}`, x })).filter(a => !state.seen.includes(a.key));
  // the order of the list: from the next birthday ("najbliższe") or from January ("kalendarz")
  function ordered(state, today, mode) {
    const list = upcoming(state, today);
    return mode === "kalendarz" ? list.slice().sort((a, b) => a.p.month - b.p.month || a.p.day - b.p.day || a.p.name.localeCompare(b.p.name, "pl")) : list;
  }
  // birthdays on day k (for the calendar)
  const on = (state, k) => state.people.filter(p => inYear(p, parseDay(k).getFullYear()) === k).map(p => ({ p, age: ageOn(p, k) }));

  const core = { MONTHS, defaults, normalize, next, ageOn, upcoming, on, parseLine, parseList, stage, alerts, ordered, dayKey, parseDay, daysBetween };

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
  const ui = { open: null, sheet: null, order: "najblizsze", paste: null };      // paste: {text, parsed}
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
    const gift = p.memorial || !p.ideas.length ? "" : ` · ${got ? `prezent: ${got === p.ideas.length ? "kupiony ✓" : `${got} z ${p.ideas.length}`}` : `${left} ${plural(left, "pomysł", "pomysły", "pomysłów")}`}`;
    return `<li class="bd-item${p.memorial ? " memorial" : ""}${x.days <= 7 && !p.memorial ? " soon" : ""}${x.days === 0 && !p.memorial ? " today" : ""}${open ? " open" : ""}">
      <button type="button" class="bd-head" data-bdact="open" data-id="${esc(p.id)}" aria-expanded="${open}">
        <span class="bd-cal" aria-hidden="true"><b>${p.day}</b><small>${esc(MONTHS[p.month - 1].slice(0, 3))}</small></span>
        <span class="bd-nm"><b>${p.memorial ? `<span class="bd-mem" aria-label="wspomnienie">🥀</span> ` : ""}${esc(p.name)}</b><small>${p.memorial ? `rocznica urodzin ${esc(when(x.days).replace("!", ""))}` : `${esc(when(x.days))}${x.age != null ? ` · kończy ${x.age}` : ""}${gift}`}</small></span>
        <i aria-hidden="true">${open ? "▴" : "▾"}</i></button>
      ${open ? `<div class="bd-body">
        <p class="meta">${esc(dateTxt(p))}${p.year ? ` ${p.year}` : ""}${p.memorial ? " · wspomnienie (bez wieku i bez czerwonej kropki)" : ""}</p>
        ${p.note ? `<p class="bd-note">${esc(p.note)}</p>` : ""}
        ${p.memorial ? `<div class="actions"><button type="button" class="btn" data-bdact="edit" data-id="${esc(p.id)}" ${dis}>Edytuj</button></div></div>` : ""}${p.memorial ? "" : `
        <h3>Pomysły na prezent</h3>
        ${p.ideas.length ? `<ul class="bd-ideas">${p.ideas.map(i => `<li class="${i.got ? "got" : ""}"><button type="button" class="hw-check" data-bdact="got" data-id="${esc(p.id)}" data-iid="${esc(i.id)}" aria-pressed="${i.got}" aria-label="${i.got ? "Kupione" : "Oznacz jako kupione"}: ${esc(i.text)}" ${dis}>✓</button><span>${esc(i.text)}</span><button type="button" class="icon-btn" data-bdact="delIdea" data-id="${esc(p.id)}" data-iid="${esc(i.id)}" aria-label="Usuń pomysł ${esc(i.text)}" ${dis}>×</button></li>`).join("")}</ul>` : `<p class="meta">Jeszcze nic — dopisz, gdy coś przyjdzie ci do głowy.</p>`}
        <form class="gl-add" data-bdidea="${esc(p.id)}" novalidate><input name="text" type="text" maxlength="120" placeholder="np. książka, słuchawki, bilet" aria-label="Nowy pomysł na prezent: ${esc(p.name)}" ${dis}><button type="submit" class="btn" ${dis}>Dodaj</button></form>
        <div class="actions"><button type="button" class="btn" data-bdact="edit" data-id="${esc(p.id)}" ${dis}>Edytuj</button></div>
      </div>`}` : ""}</li>`;
  }
  function pasteBlock(dis) {
    const pv = ui.paste, r = pv && pv.parsed;
    return `<section class="panel bd-paste"><h2>Wklej listę</h2>
        <p class="hint">Skopiuj listę z notatek — jedna osoba w linii, np. <code>Ania - 9 stycznia (2010)</code>. Rok w nawiasie jest opcjonalny; inne rzeczy w nawiasie trafią do notatki, a 🥀 oznacza wspomnienie (bez wieku i bez kropki). Osób, które już są, nie doda drugi raz.</p>
        <textarea class="pl-codein bd-pastein" rows="7" spellcheck="false" aria-label="Lista urodzin" placeholder="Ania - 9 stycznia (2010)&#10;Kuba - 21 października (2011)" ${dis}>${esc(pv ? pv.text : "")}</textarea>
        <div class="actions"><button type="button" class="btn" data-bdact="pasteCheck" ${dis}>Sprawdź</button><button type="button" class="btn link" data-bdact="pasteClose">Zamknij</button></div>
        ${r ? `<div class="bd-pasteprev">
          <p><b>${r.add.length} ${plural(r.add.length, "osoba", "osoby", "osób")} do dodania</b>${r.dup.length ? ` · ${r.dup.length} już ${plural(r.dup.length, "jest", "są", "jest")} na liście` : ""}${r.bad.length ? ` · ${r.bad.length} ${plural(r.bad.length, "linia", "linie", "linii")} do poprawy` : ""}</p>
          ${r.add.length ? `<ul class="bd-pl">${r.add.map(x => `<li>${x.memorial ? "🥀 " : ""}<b>${esc(x.name)}</b> — ${esc(dateTxt(x))}${x.year ? ` ${x.year}` : ""}${x.note ? ` <span class="meta">(${esc(x.note)})</span>` : ""}</li>`).join("")}</ul>` : ""}
          ${r.dup.length ? `<p class="meta">Już są: ${r.dup.map(esc).join(", ")}</p>` : ""}
          ${r.bad.length ? `<ul class="sc-err bd-bad">${r.bad.slice(0, 8).map(l => `<li>Nie rozumiem: „${esc(l)}”</li>`).join("")}</ul>` : ""}
          ${r.add.length ? `<div class="actions"><button type="button" class="btn primary" data-bdact="pasteAdd" ${dis}>Dodaj ${r.add.length} ${plural(r.add.length, "osobę", "osoby", "osób")}</button></div>` : ""}</div>` : ""}
      </section>`;
  }
  function fullView() {
    const T = today(), dis = canWrite() ? "" : "disabled", list = ordered(S, T, ui.order);
    // groups by month: from this month on (the next birthdays first) or from January
    const groups = []; for (const x of list) { const m = x.p.month; let gr = groups[groups.length - 1]; if (!gr || gr.m !== m) groups.push(gr = { m, list: [] }); gr.list.push(x); }
    const head = gr => { const y = ui.order === "kalendarz" ? "" : ` ${parseDay(gr.list[0].date).getFullYear()}`; return `${MONTHS_NOM[gr.m - 1].charAt(0).toUpperCase()}${MONTHS_NOM[gr.m - 1].slice(1)}${y !== ` ${parseDay(T).getFullYear()}` ? y : ""}`; };
    return `<section class="panel bd-top"><div class="row"><h2>Urodziny</h2><span class="bd-btns"><button type="button" class="btn" data-bdact="paste" ${dis}>Wklej listę</button><button type="button" class="btn primary" data-bdact="new" ${dis}>+ Osoba</button></span></div>
        <p class="hint">Urodziny pokażą się co roku w kalendarzu, a tydzień wcześniej na ekranie Dziś. Czerwona kropka na „Więcej” przypomni tydzień wcześniej, 2 dni wcześniej i w dniu urodzin.</p>
        ${list.length ? `<div class="seg small bd-order" role="group" aria-label="Kolejność"><button type="button" class="seg-b" data-bdact="order" data-v="najblizsze" aria-pressed="${ui.order !== "kalendarz"}">Od najbliższych</button><button type="button" class="seg-b" data-bdact="order" data-v="kalendarz" aria-pressed="${ui.order === "kalendarz"}">Od stycznia</button></div>` : ""}</section>
      ${ui.paste ? pasteBlock(dis) : ""}
      ${list.length ? `<section class="panel"><p class="meta">${list.length} ${plural(list.length, "osoba", "osoby", "osób")}</p>${groups.map(gr => `<h3 class="bd-month">${esc(head(gr))}</h3><ul class="bd-list">${gr.list.map(x => personCard(x, dis)).join("")}</ul>`).join("")}</section>`
        : ui.paste ? "" : `<section class="panel"><p class="meta">Nie ma jeszcze nikogo. Dodaj osobę przyciskiem „+ Osoba” albo wklej całą listę.</p></section>`}`;
  }
  // on Dziś: birthdays in the next 7 days
  function widget(T) {
    T = T || today();
    const list = upcoming(S, T, 7); if (!list.length) return "";
    return `<section class="panel bd-today"><div class="row"><h2>Urodziny</h2><button type="button" class="btn link" data-bdact="go">Wszystkie ›</button></div>
      <ul class="bd-wl">${list.map(x => `<li><button type="button" class="pl-item" data-bdact="go" data-id="${esc(x.p.id)}"><span class="bd-cal small" aria-hidden="true"><b>${x.p.day}</b><small>${esc(MONTHS[x.p.month - 1].slice(0, 3))}</small></span><span class="pl-it"><b>${x.p.memorial ? "🥀 " : ""}${esc(x.p.name)}</b>${x.age != null && !x.p.memorial ? ` (${x.age})` : ""}<small>${esc(when(x.days))}${x.p.memorial ? " · rocznica urodzin" : x.p.ideas.length ? ` · ${ideasLeft(x.p) ? `${ideasLeft(x.p)} ${plural(ideasLeft(x.p), "pomysł", "pomysły", "pomysłów")} na prezent` : "prezent kupiony ✓"}` : " · brak pomysłu na prezent"}</small></span><span class="pl-k">${x.days === 0 ? "dziś" : x.p.memorial ? "rocznica" : "urodziny"}</span></button></li>`).join("")}</ul>
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
      <div class="sc-field"><span class="k">Wspomnienie</span><div class="sc-cats"><button type="button" class="chip" data-bdform="memorial" aria-pressed="${!!d.memorial}">🥀 Wspomnienie (bez wieku i bez kropki)</button></div></div>
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
    const rec = { name, day, month, year, note: val("note").trim(), memorial: !!d.memorial };
    if (old) Object.assign(old, rec); else { const p = Object.assign({ id: newId("b"), ideas: [] }, rec); next.people.push(p); ui.open = p.id; }
    closeSheet();
    const days = daysBetween(today(), core.next(rec, today()));
    return save(next, `${old ? "Zapisano" : "Dodano"}: ${name}, ${dateTxt(rec)} (${when(days)}).`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-bdform]"); if (!b || !ui.sheet) return;
    if (b.dataset.bdform === "close") closeSheet();
    else if (b.dataset.bdform === "memorial") {
      const f = $("bdForm"), d = ui.sheet.data; for (const n of ["name", "day", "month", "year", "note"]) { const el = f.querySelector(`[name="${n}"]`); if (el) d[n] = el.value; }
      d.memorial = !d.memorial; renderSheet();
    }
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
    if (a === "order") { ui.order = b.dataset.v === "kalendarz" ? "kalendarz" : "najblizsze"; render(); return; }
    if (a === "paste") { ui.paste = ui.paste || { text: "", parsed: null }; render(); const t = doc.querySelector(".bd-pastein"); if (t && t.focus) try { t.focus(); } catch (x) {} return; }
    if (a === "pasteClose") { ui.paste = null; render(); return; }
    if (a === "pasteCheck") { const t = doc.querySelector(".bd-pastein"), text = t ? t.value : ""; ui.paste = { text, parsed: parseList(text, S) }; render(); return; }
    if (!canWrite()) return;
    const prev = exportState(), next = exportState(), p = next.people.find(x => x.id === b.dataset.id);
    if (a === "new") { ui.sheet = { data: { id: null, name: "", day: parseDay(today()).getDate(), month: parseDay(today()).getMonth() + 1, year: "", note: "", memorial: false } }; renderSheet(); }
    else if (a === "edit" && p) { ui.sheet = { data: { id: p.id, name: p.name, day: p.day, month: p.month, year: p.year || "", note: p.note, memorial: p.memorial } }; renderSheet(); }
    else if (a === "pasteAdd") {
      const r = parseList(ui.paste ? ui.paste.text : "", S); if (!r.add.length) return;
      for (const x of r.add) next.people.push(Object.assign({ id: newId("b"), ideas: [] }, x));
      ui.paste = null;
      save(next, `Dodano ${r.add.length} ${plural(r.add.length, "osobę", "osoby", "osób")}${r.dup.length ? ` (${r.dup.length} już ${plural(r.dup.length, "była", "były", "było")})` : ""}.`, prev);
    }
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
  // the red dot: how many reminders are not read yet; opening Urodziny reads them (saved quietly, old ones dropped)
  const alertCount = () => alerts(S, today()).length;
  function markSeen() {
    const T = today(), keys = alerts(S, T).map(a => a.key); if (!keys.length) return false;
    const next = exportState(); next.seen = S.seen.filter(k => k.split("|")[1] >= T).concat(keys);
    if (canWrite() && P && P.save) return save(next);
    S = normalize(next); return true;                       // read-only: read for this session
  }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, widget, openPerson, alertCount, markSeen, ui, canWrite,
    on: k => on(S, k), upcoming: (t, w) => upcoming(S, t || today(), w) });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmBirthdays = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
