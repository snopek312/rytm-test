// Rytm: homework (Zadania domowe). One field: "mat zad. 3–7 str. 45". The subject is read from the first word(s)
// ("mat", "fiz", "ang", "hiszp", "wf" …), the day from a word like "jutro", "na pt", "na 20.10"; without one it is the
// next lesson of that subject in the timetable (Dziś → Plan lekcji), or tomorrow. Shown on Dziś (with the quick field)
// and as a list: late, for today, tomorrow, this week, later, done.
// Saved state (one record in meta "homework"): {v:1, items:[{id, sid, text, due, done, doneAt, added}]}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const isoDow = k => { const w = parseDay(k).getDay(); return w === 0 ? 7 : w; };
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // lower case, no Polish letters, no dots: "Język" -> "jezyk", "zad." -> "zad"
  const fold = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[.,:;!?]+$/g, "").trim();
  // short names people write that are not the start of a word of the subject's name
  const ALIASES = { wf: "wychowanie fizyczne", eo: "edukacja obywatelska", wos: "edukacja obywatelska", ez: "edukacja zdrowotna", edb: "edukacja zdrowotna",
    biz: "biznes i zarzadzanie", gw: "godzina z wychowawca", ang: "jezyk angielski", angielski: "jezyk angielski", hisz: "jezyk hiszpanski",
    hiszpanski: "jezyk hiszpanski", pol: "jezyk polski", polski: "jezyk polski", niem: "jezyk niemiecki", niemiecki: "jezyk niemiecki", infa: "informatyka", matma: "matematyka" };
  const DOWS = { pn: 1, pon: 1, poniedzialek: 1, wt: 2, wto: 2, wtorek: 2, sr: 3, sroda: 3, cz: 4, czw: 4, czwartek: 4, pt: 5, pia: 5, piatek: 5,
    so: 6, sob: 6, sobota: 6, nd: 7, ndz: 7, niedz: 7, niedziela: 7 };
  const NOT_DATE_AFTER = ["zad", "zadanie", "zadania", "cw", "str", "s", "nr", "punkt", "pkt", "rozdz", "rozdzial", "lekcja", "temat"];

  function defaults() { return { v: 1, items: [] }; }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const ids = new Set();
    const items = (Array.isArray(o.items) ? o.items : []).filter(x => x && typeof x.id === "string" && x.id && !ids.has(x.id) && str(x.text, 300) && DAY.test(x.due || "") && ids.add(x.id))
      .map(x => ({ id: x.id, sid: typeof x.sid === "string" && x.sid.length <= 60 ? x.sid : null, text: str(x.text, 300), due: x.due, done: x.done === true,
        doneAt: x.done === true && DAY.test(x.doneAt || "") ? x.doneAt : null, added: DAY.test(x.added || "") ? x.added : null }));
    return { v: 1, items };
  }

  // a word (or a few) -> the subject, or null when it is not clear
  function matchSubject(subjects, phrase) {
    const t = fold(phrase); if (!t || t.length < 2) return null;
    const named = subjects.map(s => ({ s, n: fold(s.name) }));
    const al = ALIASES[t]; if (al) { const m = named.find(x => x.n === al); if (m) return m.s; }
    const exact = named.find(x => x.n === t); if (exact) return exact.s;
    if (t.length < 3) return null;
    const one = list => (list.length === 1 ? list[0].s : null);
    if (t.includes(" ")) return one(named.filter(x => x.n.startsWith(t)));
    return one(named.filter(x => x.n.split(" ")[0].startsWith(t))) || one(named.filter(x => x.n.split(" ").some(w => w.length >= 3 && w.startsWith(t))));
  }
  // the next day after `today` with a lesson of this subject (lessonsOn(k) -> [{subject}]), within two weeks
  function nextLesson(subject, today, lessonsOn) {
    if (!subject || typeof lessonsOn !== "function") return null;
    const n = fold(subject.name);
    for (let i = 1; i <= 14; i++) {
      const k = addDays(today, i);
      let list = []; try { list = lessonsOn(k) || []; } catch (e) {}
      if (list.some(l => { const m = fold(l.subject); return m === n || m.endsWith(" " + n) || n.endsWith(" " + m); })) return k;
    }
    return null;
  }
  // a date word -> a day, or null. prev: the word before it ("na", "do" make dates and weekdays sure)
  function dateWord(word, prev, today, isLast) {
    const w = fold(word), sure = prev === "na" || prev === "do";
    if (w === "dzis" || w === "dzisiaj") return today;
    if (w === "jutro") return addDays(today, 1);
    if (w === "pojutrze") return addDays(today, 2);
    const okPlace = sure || (isLast && !NOT_DATE_AFTER.includes(prev));
    if (DOWS[w] && okPlace) { let d = DOWS[w] - isoDow(today); if (d <= 0) d += 7; return addDays(today, d); }
    const m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(String(word).replace(/\.$/, ""));
    if (m && okPlace) {
      const day = +m[1], mon = +m[2]; if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
      let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : parseDay(today).getFullYear();
      let k = `${y}-${pad(mon)}-${pad(day)}`;
      if (parseDay(k).getDate() !== day) return null;                       // 31.11 and the like
      if (!m[3] && daysBetween(today, k) < -60) k = `${y + 1}-${pad(mon)}-${pad(day)}`;   // "10.01" written in December
      // without "na"/"do" a number like "1.3" is more likely an exercise than a date: only a day in the next two months, not after a number
      if (!sure && (daysBetween(today, k) < 0 || daysBetween(today, k) > 60 || /\d/.test(prev))) return null;
      return k;
    }
    return null;
  }
  // the quick field -> {sid, text, due, dueFrom: "word" | "lesson" | "tomorrow"}
  function parse(input, subjects, today, lessonsOn) {
    const words = String(input || "").trim().split(/\s+/).filter(Boolean);
    let sub = null, used = 0;
    for (let n = Math.min(3, words.length); n >= 1 && !sub; n--) { const m = matchSubject(subjects || [], words.slice(0, n).join(" ")); if (m) { sub = m; used = n; } }
    let rest = words.slice(used), due = null;
    for (let i = rest.length - 1; i >= 0 && !due; i--) {
      const prev = i > 0 ? fold(rest[i - 1]) : "", d = dateWord(rest[i], prev, today, i === rest.length - 1);
      if (d) { due = d; rest = rest.slice(0, prev === "na" || prev === "do" ? i - 1 : i).concat(rest.slice(i + 1)); }
    }
    const text = rest.join(" ").replace(/^[\s:–—-]+/, "").trim();
    const lesson = due ? null : nextLesson(sub, today, lessonsOn);
    return { sid: sub ? sub.id : null, text, due: due || lesson || addDays(today, 1), dueFrom: due ? "word" : lesson ? "lesson" : "tomorrow" };
  }
  // the list in groups; done ones: the last 14 days
  function groups(state, today) {
    const open = state.items.filter(x => !x.done).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const tomorrow = addDays(today, 1), week = addDays(today, 7);
    return { late: open.filter(x => x.due < today), today: open.filter(x => x.due === today), tomorrow: open.filter(x => x.due === tomorrow),
      week: open.filter(x => x.due > tomorrow && x.due <= week), later: open.filter(x => x.due > week),
      done: state.items.filter(x => x.done && (!x.doneAt || x.doneAt >= addDays(today, -14))).sort((a, b) => ((a.doneAt || "") < (b.doneAt || "") ? 1 : -1)) };
  }
  const openOn = (state, k) => state.items.filter(x => !x.done && x.due === k);

  const core = { ALIASES, defaults, normalize, fold, matchSubject, nextLesson, dateWord, parse, groups, openOn, dayKey, parseDay, addDays, daysBetween };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmHomework = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDay = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const when = n => (n === 0 ? "dziś" : n === 1 ? "jutro" : n === 2 ? "pojutrze" : n > 0 ? `za ${n} ${plural(n, "dzień", "dni", "dni")}` : n === -1 ? "wczoraj" : `${-n} ${plural(-n, "dzień", "dni", "dni")} temu`);
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, now = () => new Date();
  const ui = { sheet: null, showDone: false, pick: {} };          // pick: a subject chosen by hand in a quick field (by form)
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };
  const src = () => { try { return (P && P.sources && P.sources()) || {}; } catch (e) { return {}; } };
  const subjects = () => src().subjects || [];
  const subName = sid => { const s = subjects().find(x => x.id === sid); return s ? s.name : "Bez przedmiotu"; };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; ui.pick = {}; render(); }
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

  /* ---------- pieces ---------- */
  const dueTxt = (k, T) => `${fmtDay.format(parseDay(k))} · ${when(daysBetween(T, k))}`;
  function itemRow(x, T, dis) {
    const late = !x.done && x.due < T;
    return `<li class="hw-item${x.done ? " done" : ""}${late ? " late" : ""}">
      <button type="button" class="hw-check" data-hwact="toggle" data-id="${esc(x.id)}" aria-pressed="${x.done}" aria-label="${x.done ? "Zrobione" : "Odhacz"}: ${esc(subName(x.sid))} — ${esc(x.text)}" ${dis}>✓</button>
      <button type="button" class="hw-body" data-hwact="edit" data-id="${esc(x.id)}" ${dis}><b>${esc(subName(x.sid))}</b> <span class="hw-tx">${esc(x.text)}</span>
        <small>${x.done ? `zrobione${x.doneAt ? " " + esc(fmtDay.format(parseDay(x.doneAt))) : ""}` : `na ${esc(dueTxt(x.due, T))}`}</small></button></li>`;
  }
  // the quick field; where = "full" (the Zadania view) or "today" (Dziś)
  function quickForm(where, dis) {
    return `<form class="hw-quick" data-hwquick="${where}" novalidate autocomplete="off">
        <div class="hw-qrow"><input name="hw" type="text" maxlength="300" placeholder="np. mat zad. 3–7 str. 45" aria-label="Nowe zadanie: przedmiot i co jest zadane" ${dis}><button type="submit" class="btn primary" ${dis}>Dodaj</button></div>
        <div class="hw-prev" aria-live="polite"><span class="meta">Zacznij od przedmiotu (mat, fiz, ang…). Termin sam ustawi się na najbliższą lekcję albo napisz „na pt”, „na 20.10”.</span></div></form>`;
  }
  function previewHtml(form, text) {
    const T = today(), subs = subjects(), r = parse(text, subs, T, src().lessonsOn), where = form.dataset.hwquick;
    const sid = ui.pick[where] || r.sid, manual = form.dataset.due;
    const due = manual || (ui.pick[where] && !r.sid && r.dueFrom !== "word" ? (nextLesson(subs.find(s => s.id === sid), T, src().lessonsOn) || r.due) : r.due);
    const from = manual ? "" : r.dueFrom === "lesson" || (ui.pick[where] && !r.sid && r.dueFrom !== "word") ? " (następna lekcja)" : r.dueFrom === "tomorrow" ? " (jutro, nie znam lekcji)" : "";
    if (!text.trim()) return `<span class="meta">Zacznij od przedmiotu (mat, fiz, ang…). Termin sam ustawi się na najbliższą lekcję albo napisz „na pt”, „na 20.10”.</span>`;
    const chips = sid ? "" : `<div class="lf-chips hw-subs" role="group" aria-label="Przedmiot">${subs.map(s => `<button type="button" class="chip" data-hwact="pick" data-sid="${esc(s.id)}">${esc(s.name)}</button>`).join("")}</div>`;
    return `<span class="hw-ps ${sid ? "" : "none"}">${sid ? esc(subName(sid)) : "Jaki przedmiot?"}</span>${sid && ui.pick[where] ? ` <button type="button" class="btn link" data-hwact="unpick">zmień</button>` : ""}
      <label class="hw-pd">na <input type="date" name="due" value="${esc(due)}" aria-label="Termin"></label><small class="meta">${esc(from)}</small>${chips}`;
  }
  function refreshPreview(form) {
    const box = form && form.querySelector(".hw-prev"), inp = form && form.querySelector('input[name="hw"]'); if (!box || !inp) return;
    box.innerHTML = previewHtml(form, inp.value);
  }

  function fullView() {
    const T = today(), dis = canWrite() ? "" : "disabled", G = groups(S, T);
    const sec = (title, list, cls) => (list.length ? `<section class="panel hw-group ${cls || ""}"><h2>${title} <span class="meta">${list.length}</span></h2><ul class="hw-list">${list.map(x => itemRow(x, T, dis)).join("")}</ul></section>` : "");
    const open = G.late.length + G.today.length + G.tomorrow.length + G.week.length + G.later.length;
    return `<section class="panel hw-top">${quickForm("full", dis)}
        <p class="meta">${open ? `Do zrobienia: ${open} · na jutro: ${G.tomorrow.length}${G.late.length ? ` · zaległe: ${G.late.length}` : ""}` : "Nic nie jest zadane."}</p></section>
      ${sec("Zaległe", G.late, "late")}${sec("Na dziś", G.today)}${sec("Na jutro", G.tomorrow, "soon")}${sec("W tym tygodniu", G.week)}${sec("Później", G.later)}
      ${G.done.length ? `<section class="panel hw-group"><button type="button" class="btn link" data-hwact="showDone" aria-expanded="${ui.showDone}">${ui.showDone ? "Schowaj zrobione" : `Zrobione w ostatnich 2 tygodniach (${G.done.length})`}</button>
        ${ui.showDone ? `<ul class="hw-list">${G.done.map(x => itemRow(x, T, dis)).join("")}</ul>` : ""}</section>` : ""}`;
  }
  // the panel on Dziś: the quick field, late + today + tomorrow (and the next ones if there is little)
  function widget(T) {
    T = T || today();
    const dis = canWrite() ? "" : "disabled", G = groups(S, T), soon = G.late.concat(G.today, G.tomorrow);
    const show = soon.length ? soon.slice(0, 6) : G.week.slice(0, 3), all = G.late.length + G.today.length + G.tomorrow.length + G.week.length + G.later.length;
    return `<section class="panel hw-today"><div class="row"><h2>Zadania domowe</h2><button type="button" class="btn link" data-hwact="all">${all ? `Wszystkie (${all}) ›` : "Lista ›"}</button></div>
      ${quickForm("today", dis)}
      ${show.length ? `${soon.length ? "" : `<p class="meta">Na jutro nic. Najbliższe:</p>`}<ul class="hw-list">${show.map(x => itemRow(x, T, dis)).join("")}</ul>${soon.length > 6 ? `<p class="meta">i ${soon.length - 6} więcej</p>` : ""}` : ""}
    </section>`;
  }
  function render() {
    const root = $("hwRoot"); if (root) root.innerHTML = fullView();
    renderSheet();
  }

  /* ---------- the edit sheet ---------- */
  function renderSheet() {
    const el = $("hwSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data, subs = subjects();
    el.innerHTML = `<div class="sc-backdrop" data-hwform="close"></div><form class="panel sc-form" id="hwForm" role="dialog" aria-modal="true" aria-labelledby="hwTitle" novalidate>
      <h2 id="hwTitle">Zadanie domowe</h2>
      <label class="sc-field"><span class="k">Przedmiot</span><select name="sid"><option value="">— bez przedmiotu —</option>${subs.map(s => `<option value="${esc(s.id)}"${s.id === d.sid ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <label class="sc-field"><span class="k">Co jest zadane</span><input name="text" type="text" maxlength="300" value="${esc(d.text)}"></label>
      <label class="sc-field"><span class="k">Na kiedy</span><input name="due" type="date" value="${esc(d.due)}"></label>
      <p class="sc-err" id="hwErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-hwform="close">Anuluj</button><button type="button" class="btn danger" data-hwform="del">Usuń</button></div></form>`;
  }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function submitSheet() {
    const f = $("hwForm"), d = ui.sheet.data, err = m => { const e = $("hwErr"); if (e) e.textContent = m; return false; };
    const sid = f.querySelector('[name="sid"]').value || null, text = f.querySelector('[name="text"]').value.trim(), due = f.querySelector('[name="due"]').value;
    if (!text) return err("Wpisz, co jest zadane.");
    if (!DAY.test(due || "")) return err("Wybierz dzień.");
    const prev = exportState(), next = exportState(), x = next.items.find(y => y.id === d.id); if (!x) return closeSheet();
    Object.assign(x, { sid, text, due });
    closeSheet();
    return save(next, `Zapisano: ${subName(sid)} — na ${fmtDay.format(parseDay(due))}.`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-hwform]"); if (!b || !ui.sheet) return;
    if (b.dataset.hwform === "close") closeSheet();
    else if (b.dataset.hwform === "del") {
      const prev = exportState(), next = exportState(), x = S.items.find(y => y.id === ui.sheet.data.id);
      next.items = next.items.filter(y => y.id !== ui.sheet.data.id); closeSheet();
      save(next, `Usunięto zadanie: ${x ? subName(x.sid) : ""}.`, prev);
    }
  }

  /* ---------- events (in Zadania and in the panel on Dziś) ---------- */
  function add(form) {
    if (!canWrite()) return false;
    const inp = form.querySelector('input[name="hw"]'), raw = inp.value.trim(), where = form.dataset.hwquick;
    if (!raw) { try { inp.focus(); } catch (e) {} return false; }
    const T = today(), subs = subjects(), r = parse(raw, subs, T, src().lessonsOn), dueIn = form.querySelector('input[name="due"]');
    const sid = ui.pick[where] || r.sid;
    if (!sid) { refreshPreview(form); say().info("Wybierz przedmiot pod polem."); return false; }
    let due = dueIn && DAY.test(dueIn.value || "") ? dueIn.value : r.due;
    const text = r.sid ? r.text : r.text || raw;
    if (!text) { say().info("Dopisz, co jest zadane."); return false; }
    const prev = exportState(), next = exportState();
    next.items.push({ id: newId("h"), sid, text, due, done: false, doneAt: null, added: T });
    ui.pick[where] = null;
    const ok = save(next, `Dodano: ${subName(sid)} — ${text}, na ${fmtDay.format(parseDay(due))} (${when(daysBetween(T, due))}).`, prev);
    const again = doc.querySelector(`form[data-hwquick="${where}"] input[name="hw"]`); if (again && again.focus) try { again.focus(); } catch (e) {}
    return ok;
  }
  function onClick(e) {
    const b = e.target.closest("[data-hwact]"); if (!b || b.disabled) return;
    const a = b.dataset.hwact;
    if (a === "all") { if (P && P.go) P.go("homework"); return; }
    if (a === "showDone") { ui.showDone = !ui.showDone; render(); return; }
    if (a === "pick" || a === "unpick") {
      const form = b.closest("form[data-hwquick]"); if (!form) return;
      ui.pick[form.dataset.hwquick] = a === "pick" ? b.dataset.sid : null; delete form.dataset.due;
      refreshPreview(form); const i = form.querySelector('input[name="hw"]'); if (i && i.focus) try { i.focus(); } catch (x) {}
      return;
    }
    if (!canWrite()) return;
    if (a === "toggle") {
      const next = exportState(), x = next.items.find(y => y.id === b.dataset.id); if (!x) return;
      x.done = !x.done; x.doneAt = x.done ? today() : null;
      const left = next.items.filter(y => !y.done && y.due === addDays(today(), 1)).length;
      save(next, x.done ? `Zrobione: ${subName(x.sid)}.${left ? ` Na jutro zostało: ${left}.` : " Na jutro wszystko zrobione!"}` : null, x.done ? exportState() : null);
    } else if (a === "edit") {
      const x = S.items.find(y => y.id === b.dataset.id); if (!x) return;
      ui.sheet = { data: { id: x.id, sid: x.sid, text: x.text, due: x.due } }; renderSheet();
    }
  }
  function onInput(e) {
    const form = e.target.closest && e.target.closest("form[data-hwquick]"); if (!form) return;
    if (e.target.name === "due") { form.dataset.due = e.target.value; return; }
    if (e.target.name === "hw") { delete form.dataset.due; refreshPreview(form); }
  }
  function onSubmit(e) { const form = e.target.closest && e.target.closest("form[data-hwquick]"); if (!form) return; e.preventDefault(); add(form); }
  function mount() {
    for (const id of ["hwRoot", "plRoot"]) { const r = $(id); if (r) { r.addEventListener("click", onClick); r.addEventListener("input", onInput); r.addEventListener("change", onInput); r.addEventListener("submit", onSubmit); } }
    const sh = $("hwSheet"); if (sh) { sh.addEventListener("click", onSheetClick); sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); }); }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
  }
  function summary() { const T = today(), G = groups(S, T), n = G.late.length + G.today.length + G.tomorrow.length + G.week.length + G.later.length;
    return n ? `Na jutro: ${G.tomorrow.length}${G.late.length ? ` · zaległe: ${G.late.length}` : ""} · razem ${n}` : "Nic nie jest zadane"; }
  function setClock(fn) { now = fn || (() => new Date()); }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, widget, ui, canWrite, openOn: k => openOn(S, k) });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmHomework = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
