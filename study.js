// Rytm: learning (Nauka) — the matura (topics of each subject with a status, a flag "to catch up", a countdown) and the
// tests for studying abroad (SAT/ACT and an English test: a target, the planned day, practice results).
// The topic lists are a starting point, roughly following the national curriculum; the user edits them.
// Saved state (one record in meta "study"):
//   {v:1, maturaDate, subjects:[{id, name, level, maybe, topics:[{id, name, st, catchup}]}], tests:[{id, kind, target, date, results:[{id, date, score, note}]}]}
//   st: 0 not started, 1 covered (przerobione), 2 I know it (umiem), 3 revised (powtórzone)
//   "current" (the "Na bieżąco" tab of 18.10.2026, taken out the same day at the user's wish): kept as it was saved, not shown
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const ST = ["nie zaczęte", "przerobione", "umiem", "powtórzone"];
  const voc = ["Człowiek", "Miejsce zamieszkania", "Edukacja", "Praca", "Życie prywatne", "Żywienie", "Zakupy i usługi", "Podróżowanie i turystyka", "Kultura",
    "Sport", "Zdrowie", "Nauka i technika", "Świat przyrody", "Państwo i społeczeństwo"].map(t => "Słownictwo: " + t.toLowerCase());
  const SUBJECTS = [
    { id: "pol", name: "Polski", level: "P", maybe: false, topics: ["Test: czytanie ze zrozumieniem", "Test: język (gramatyka, stylistyka)", "Wypracowanie (rozprawka)", "Starożytność", "Średniowiecze",
      "Renesans", "Barok", "Oświecenie", "Romantyzm", "Pozytywizm", "Młoda Polska", "Dwudziestolecie międzywojenne", "Literatura wojny i okupacji", "Literatura po 1945 r.",
      "Literatura współczesna", "Lektury obowiązkowe (dopisz swoje)", "Matura ustna"] },
    { id: "mat", name: "Matematyka", level: "R", maybe: false, topics: ["Liczby rzeczywiste, potęgi, pierwiastki", "Logarytmy", "Wyrażenia algebraiczne", "Równania i nierówności",
      "Układy równań", "Wartość bezwzględna (R)", "Funkcje — własności", "Funkcja liniowa", "Funkcja kwadratowa", "Wielomiany (R)", "Funkcje wymierne (R)",
      "Funkcja wykładnicza i logarytmiczna", "Ciągi (arytmetyczny, geometryczny)", "Granice ciągów i funkcji (R)", "Trygonometria", "Równania trygonometryczne (R)", "Planimetria",
      "Geometria analityczna", "Stereometria", "Kombinatoryka", "Rachunek prawdopodobieństwa", "Prawdopodobieństwo warunkowe (R)", "Statystyka", "Pochodna i optymalizacja (R)", "Dowody (R)"] },
    { id: "ang", name: "Angielski", level: "R", maybe: false, topics: ["Słuchanie", "Czytanie", "Środki językowe: gramatyka", "Środki językowe: słownictwo", "Wypowiedź pisemna: e-mail (P)",
      "Wypowiedź pisemna: rozprawka, artykuł, list formalny (R)", "Matura ustna", ...voc] },
    { id: "inf", name: "Informatyka", level: "R", maybe: false, topics: ["Systemy liczbowe", "Algorytmy na liczbach (NWD, liczby pierwsze, sito)", "Sortowanie", "Wyszukiwanie (w tym binarne)",
      "Rekurencja", "Algorytmy na tekstach", "Złożoność obliczeniowa", "Programowanie: pliki i dane wejściowe", "Programowanie: listy, słowniki, struktury", "Arkusz kalkulacyjny",
      "Bazy danych i SQL", "Logika i algebra Boole'a", "Reprezentacja danych (liczby, tekst, obraz)", "Kompresja i szyfrowanie", "Sieci komputerowe i internet", "Zadania maturalne z lat poprzednich"] },
    { id: "fiz", name: "Fizyka", level: "R", maybe: true, topics: ["Pomiary i niepewności", "Kinematyka", "Dynamika", "Praca, moc, energia", "Pęd i zderzenia", "Ruch obrotowy bryły sztywnej",
      "Grawitacja i astronomia", "Hydrostatyka", "Termodynamika", "Drgania", "Fale mechaniczne i akustyka", "Elektrostatyka", "Prąd stały", "Magnetyzm", "Indukcja elektromagnetyczna",
      "Prąd przemienny", "Fale elektromagnetyczne i optyka", "Fizyka atomowa i kwantowa", "Fizyka jądrowa", "Doświadczenia i analiza wyników"] },
  ];
  // the tests; min/max = the score scale. MIT's hints as published on mitadmissions.org (October 2026)
  const TESTS = [
    { id: "sat", name: "SAT", min: 400, max: 1600, info: "MIT wymaga SAT albo ACT. Nie ma progu — wynik oceniają na tle twojej sytuacji." },
    { id: "act", name: "ACT", min: 1, max: 36, info: "MIT wymaga SAT albo ACT. Nie ma progu — wynik oceniają na tle twojej sytuacji." },
    { id: "toefl", name: "TOEFL iBT", min: 0, max: 120, info: "MIT mocno zaleca test z angielskiego. TOEFL: minimum 90, zalecane 100 (nowa skala od 21.01.2026: minimum 5, zalecane 5,5)." },
    { id: "ielts", name: "IELTS", min: 0, max: 9, info: "MIT mocno zaleca test z angielskiego. IELTS: minimum 7, zalecane 7,5." },
    { id: "duolingo", name: "Duolingo English Test", min: 10, max: 160, info: "MIT mocno zaleca test z angielskiego. Duolingo: minimum 120, zalecane 125." },
    { id: "cambridge", name: "Cambridge C1/C2", min: 80, max: 230, info: "MIT mocno zaleca test z angielskiego. Cambridge C1 Advanced / C2 Proficiency: minimum 185, zalecane 190." },
  ];
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const dayOr = v => (typeof v === "string" && DAY.test(v) ? v : null);
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const testOf = id => TESTS.find(t => t.id === id) || null;

  function defaults() {
    let n = 0;
    return { v: 1, maturaDate: null,
      subjects: SUBJECTS.map(s => ({ id: s.id, name: s.name, level: s.level, maybe: s.maybe, topics: s.topics.map(t => ({ id: `${s.id}-${++n}`, name: t, st: 0, catchup: false })) })),
      tests: [{ id: "t-sat", kind: "sat", target: null, date: null, results: [] }, { id: "t-toefl", kind: "toefl", target: null, date: null, results: [] }] };
  }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const ids = new Set(), fresh = x => x && typeof x.id === "string" && x.id && !ids.has(x.id);
    const subjects = (Array.isArray(o.subjects) ? o.subjects : []).filter(s => fresh(s) && str(s.name, 40) && ids.add(s.id)).map(s => ({
      id: s.id, name: str(s.name, 40), level: s.level === "P" ? "P" : "R", maybe: s.maybe === true,
      topics: (Array.isArray(s.topics) ? s.topics : []).filter(t => fresh(t) && str(t.name, 120) && ids.add(t.id))
        .map(t => ({ id: t.id, name: str(t.name, 120), st: Number.isInteger(t.st) && t.st >= 0 && t.st <= 3 ? t.st : 0, catchup: t.catchup === true })) }));
    const tests = (Array.isArray(o.tests) ? o.tests : []).filter(t => fresh(t) && testOf(t.kind) && ids.add(t.id)).map(t => {
      const k = testOf(t.kind), inScale = v => typeof v === "number" && isFinite(v) && v >= k.min && v <= k.max;
      return { id: t.id, kind: t.kind, target: inScale(t.target) ? t.target : null, date: dayOr(t.date),
        results: (Array.isArray(t.results) ? t.results : []).filter(r => fresh(r) && inScale(r.score) && DAY.test(r.date || "") && ids.add(r.id)).map(r => ({ id: r.id, date: r.date, score: r.score, note: str(r.note, 120) })) };
    });
    const out = { v: 1, maturaDate: dayOr(o.maturaDate), subjects, tests };
    if (o.current && typeof o.current === "object" && !Array.isArray(o.current)) out.current = JSON.parse(JSON.stringify(o.current));
    return out;
  }
  // progress of a subject: points (0..3 per topic) out of 3 × topics, and how many topics are at each status
  function progress(subject) {
    const n = subject.topics.length, counts = [0, 0, 0, 0];
    let pts = 0; for (const t of subject.topics) { counts[t.st]++; pts += t.st; }
    return { n, counts, pct: n ? Math.round(pts / (3 * n) * 100) : 0, catchup: subject.topics.filter(t => t.catchup && t.st < 2).length };
  }
  function overall(state, withMaybe = false) {
    const subs = state.subjects.filter(s => withMaybe || !s.maybe);
    let pts = 0, n = 0; for (const s of subs) for (const t of s.topics) { pts += t.st; n++; }
    return { n, pct: n ? Math.round(pts / (3 * n) * 100) : 0, touched: subs.reduce((a, s) => a + s.topics.filter(t => t.st > 0).length, 0) };
  }
  const topicsTouched = state => state.subjects.reduce((a, s) => a + s.topics.filter(t => t.st > 0).length, 0);
  const best = test => (test.results.length ? Math.max(...test.results.map(r => r.score)) : null);
  // the planned test days and the matura in [from, to], for the calendar
  function datesBetween(state, from, to) {
    const out = [];
    for (const t of state.tests) if (t.date && t.date >= from && t.date <= to) out.push({ date: t.date, kind: "test", title: testOf(t.kind).name });
    if (state.maturaDate && state.maturaDate >= from && state.maturaDate <= to) out.push({ date: state.maturaDate, kind: "matura", title: "Matura (początek)" });
    return out;
  }

  const core = { ST, SUBJECTS, TESTS, defaults, normalize, progress, overall, topicsTouched, best, datesBetween, testOf, dayKey, parseDay, daysBetween };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmStudy = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtLong = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  const fmtShort = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric" });
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const when = n => (n === 0 ? "dziś" : n === 1 ? "jutro" : n > 0 ? `za ${n} ${plural(n, "dzień", "dni", "dni")}` : `${-n} ${plural(-n, "dzień", "dni", "dni")} temu`);
  const num = x => String(x).replace(".", ",");
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, now = () => new Date();
  const ui = { tab: "matura", open: null, edit: false, filter: "all", sheet: null };
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; render(); }
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
  const bar = pct => `<div class="lf-bar" role="img" aria-label="${pct}%"><span style="width:${pct}%"></span></div>`;

  function maturaView() {
    const T = today(), dis = canWrite() ? "" : "disabled", all = overall(S);
    const y = now().getFullYear();
    const head = S.maturaDate
      ? `<div class="tiles lf-tiles3"><div class="tile"><span class="k">Do matury</span><span class="v">${Math.max(0, daysBetween(T, S.maturaDate))}<small>dni</small></span><span class="d meta">ok. ${esc(fmtLong.format(parseDay(S.maturaDate)))}</span></div>
          <div class="tile"><span class="k">Opanowane</span><span class="v">${all.pct}<small>%</small></span><span class="d meta">bez przedmiotów „może”</span></div>
          <div class="tile"><span class="k">Do nadrobienia</span><span class="v">${S.subjects.reduce((a, s) => a + progress(s).catchup, 0)}</span><span class="d meta">działów</span></div></div>
         <label class="lf-inline"><span class="meta">Pierwszy dzień matury:</span><input type="date" data-stmatura="1" value="${esc(S.maturaDate)}" ${dis}></label>`
      : `<p class="hint">Kiedy piszesz maturę? Matura zaczyna się zwykle na początku maja — dokładne terminy podaje CKE.</p>
         <div class="lf-chips">${[y, y + 1, y + 2, y + 3].map(v => `<button type="button" class="chip" data-stact="year" data-v="${v}" ${dis}>Maj ${v}</button>`).join("")}</div>`;
    const subs = S.subjects.map(s => {
      const p = progress(s), open = ui.open === s.id;
      const list = s.topics.filter(t => ui.filter === "all" || (ui.filter === "catch" ? t.catchup : t.st < 2));
      return `<section class="panel st-sub${s.maybe ? " maybe" : ""}" data-sid="${esc(s.id)}">
        <button type="button" class="st-head" data-stact="open" data-sid="${esc(s.id)}" aria-expanded="${open}">
          <span><b>${esc(s.name)}</b> <span class="lf-tag">${s.level === "R" ? "rozszerzenie" : "podstawa"}</span>${s.maybe ? ` <span class="lf-tag soft">może</span>` : ""}</span>
          <span class="meta">${p.pct}% · ${p.counts[2] + p.counts[3]}/${p.n} umiem${p.catchup ? ` · ${p.catchup} do nadrobienia` : ""}</span></button>
        ${bar(p.pct)}
        ${open ? `<ul class="st-topics">${list.map(t => `<li class="st-t s-${t.st}">
            <button type="button" class="st-pill" data-stact="cycle" data-tid="${esc(t.id)}" aria-label="${esc(t.name)}: ${ST[t.st]} — zmień" ${dis}>${ST[t.st]}</button>
            ${ui.edit ? `<input type="text" value="${esc(t.name)}" maxlength="120" data-stedit="${esc(t.id)}" aria-label="Nazwa działu" ${dis}><button type="button" class="icon-btn" data-stact="delTopic" data-tid="${esc(t.id)}" aria-label="Usuń dział ${esc(t.name)}" ${dis}>×</button>`
              : `<span class="st-name">${esc(t.name)}</span>`}
            <button type="button" class="chip st-catch" data-stact="catch" data-tid="${esc(t.id)}" aria-pressed="${t.catchup}" ${dis}>nadrobić</button></li>`).join("") || `<li class="meta">Nic w tym filtrze.</li>`}</ul>
          <div class="actions">${ui.edit ? `<form class="gl-add" data-stadd="${esc(s.id)}" novalidate><input name="name" type="text" maxlength="120" placeholder="Nowy dział" aria-label="Nowy dział" ${dis}><button type="submit" class="btn" ${dis}>Dodaj</button></form>
            <button type="button" class="btn" data-stact="maybe" data-sid="${esc(s.id)}" ${dis}>${s.maybe ? "Zdaję na pewno" : "Oznacz jako „może”"}</button>` : ""}
            <button type="button" class="btn link" data-stact="edit">${ui.edit ? "Gotowe" : "Edytuj działy"}</button></div>` : ""}
      </section>`;
    }).join("");
    return `<section class="panel">${head}
        <p class="note">Dotknij nazwy statusu przy dziale, żeby go zmienić: nie zaczęte → przerobione → umiem → powtórzone. „Nadrobić” oznacza dział do nadrobienia, np. w roku wymiany. Listy działów to punkt startowy, z grubsza według podstawy programowej — porównaj z informatorem CKE i dopisz, czego brakuje.</p>
        <div class="seg small st-filter" role="group" aria-label="Pokaż">${[["all", "Wszystkie"], ["todo", "Do opanowania"], ["catch", "Do nadrobienia"]].map(([k, l]) => `<button type="button" class="seg-b" data-stact="filter" data-v="${k}" aria-pressed="${ui.filter === k}">${l}</button>`).join("")}</div>
      </section>${subs}`;
  }

  function testsView() {
    const T = today(), dis = canWrite() ? "" : "disabled";
    const cards = S.tests.map(t => {
      const k = testOf(t.kind), b = best(t);
      const res = t.results.slice().sort((a, c) => (a.date < c.date ? 1 : -1));
      return `<section class="panel st-test" data-id="${esc(t.id)}">
        <div class="row"><h2>${esc(k.name)}</h2><button type="button" class="btn" data-stact="editTest" data-id="${esc(t.id)}" ${dis}>Edytuj</button></div>
        <p class="hint">${esc(k.info)}</p>
        <div class="tiles lf-tiles3"><div class="tile"><span class="k">Cel</span><span class="v">${t.target == null ? "–" : num(t.target)}</span></div>
          <div class="tile"><span class="k">Najlepszy próbny</span><span class="v${b != null && t.target != null && b >= t.target ? " good" : ""}">${b == null ? "–" : num(b)}</span></div>
          <div class="tile"><span class="k">Termin</span><span class="v st-date">${t.date ? esc(fmtShort.format(parseDay(t.date))) : "–"}</span><span class="d meta">${t.date ? esc(when(daysBetween(T, t.date))) : "nie ustalony"}</span></div></div>
        ${res.length ? `<ul class="lf-list">${res.map(r => `<li class="lf-row static"><span class="lf-d">${esc(fmtShort.format(parseDay(r.date)))}</span><span>${esc(num(r.score))}${r.note ? `<small>${esc(r.note)}</small>` : ""}</span><button type="button" class="icon-btn" data-stact="delResult" data-id="${esc(t.id)}" data-rid="${esc(r.id)}" aria-label="Usuń wynik ${esc(num(r.score))}" ${dis}>×</button></li>`).join("")}</ul>` : `<p class="meta">Brak wyników próbnych.</p>`}
        <form class="gl-add st-res" data-stres="${esc(t.id)}" novalidate><input name="score" type="text" inputmode="decimal" placeholder="wynik (${k.min}–${k.max})" aria-label="Wynik próbny" ${dis}><input name="date" type="date" value="${esc(T)}" max="${esc(T)}" aria-label="Data" ${dis}><button type="submit" class="btn" ${dis}>+ Wynik</button></form>
        <p class="sc-err" data-sterr="${esc(t.id)}" role="alert"></p>
      </section>`;
    }).join("");
    return `<section class="panel"><div class="row"><h2>Testy na studia za granicą</h2><button type="button" class="btn primary" data-stact="addTest" ${dis}>+ Test</button></div>
        <p class="hint">Ustaw cel i termin, zapisuj wyniki testów próbnych. Termin testu pokaże się w kalendarzu.</p>
        <p class="note">Informacje o MIT według mitadmissions.org (październik 2026). Przed zapisaniem się na test sprawdź aktualne wymagania.</p></section>${cards}`;
  }

  function render() {
    const root = $("stRoot"); if (!root) return;
    for (const t of ["matura", "testy"]) { const b = $("stt-" + t); if (b) b.setAttribute("aria-selected", String(ui.tab === t)); }
    root.innerHTML = ui.tab === "testy" ? testsView() : maturaView();
    renderSheet();
  }

  /* ---------- the test sheet ---------- */
  function renderSheet() {
    const el = $("stSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data, k = testOf(d.kind);
    el.innerHTML = `<div class="sc-backdrop" data-stform="close"></div><form class="panel sc-form" id="stForm" role="dialog" aria-modal="true" aria-labelledby="stTitle" novalidate>
      <h2 id="stTitle">${d.id ? "Edytuj test" : "Nowy test"}</h2>
      <div class="sc-field"><span class="k">Test</span><div class="sc-cats">${TESTS.map(t => `<button type="button" class="chip" data-stform="kind" data-v="${t.id}" aria-pressed="${d.kind === t.id}">${esc(t.name)}</button>`).join("")}</div></div>
      <p class="hint">${esc(k.info)}</p>
      <label class="sc-field"><span class="k">Cel (skala ${k.min}–${k.max})</span><input name="target" type="text" inputmode="decimal" value="${esc(d.target == null ? "" : num(d.target))}"></label>
      <label class="sc-field"><span class="k">Termin testu (opcjonalnie)</span><input name="date" type="date" value="${esc(d.date || "")}"></label>
      <p class="sc-err" id="stErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-stform="close">Anuluj</button>${d.id ? `<button type="button" class="btn danger" data-stform="del">Usuń test</button>` : ""}</div></form>`;
  }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  const parseScore = (v, k) => { const s = String(v == null ? "" : v).trim().replace(",", "."); if (s === "") return { empty: true }; const n = Number(s); return isFinite(n) && n >= k.min && n <= k.max ? { v: n } : { bad: true }; };
  function submitSheet() {
    const d = ui.sheet.data, f = $("stForm"), err = m => { const e = $("stErr"); if (e) e.textContent = m; return false; };
    d.target = f.querySelector('[name="target"]').value; d.date = f.querySelector('[name="date"]').value;
    const k = testOf(d.kind), t = parseScore(d.target, k);
    if (t.bad) return err(`Cel: liczba od ${k.min} do ${k.max}.`);
    const prev = exportState(), next = exportState();
    const old = d.id && next.tests.find(x => x.id === d.id);
    const rec = { kind: d.kind, target: t.empty ? null : t.v, date: DAY.test(d.date || "") ? d.date : null };
    if (old) { if (old.kind !== rec.kind) old.results = []; Object.assign(old, rec); } else next.tests.push(Object.assign({ id: newId("t"), results: [] }, rec));
    closeSheet();
    return save(next, `${old ? "Zapisano" : "Dodano"} test: ${k.name}.`, prev);
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-stform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.stform, d = ui.sheet.data, f = $("stForm");
    if (f) { d.target = f.querySelector('[name="target"]').value; d.date = f.querySelector('[name="date"]').value; }
    if (a === "close") closeSheet();
    else if (a === "kind") { d.kind = b.dataset.v; renderSheet(); }
    else if (a === "del") { const prev = exportState(), next = exportState(); next.tests = next.tests.filter(x => x.id !== d.id); closeSheet(); save(next, `Usunięto test: ${testOf(d.kind).name}.`, prev); }
  }

  /* ---------- events on the screen ---------- */
  function findTopic(next, tid) { for (const s of next.subjects) { const t = s.topics.find(x => x.id === tid); if (t) return { s, t }; } return null; }
  function onClick(e) {
    const b = e.target.closest("[data-stact]"); if (!b || b.disabled) return;
    const a = b.dataset.stact;
    if (a === "open") { ui.open = ui.open === b.dataset.sid ? null : b.dataset.sid; ui.edit = false; render(); return; }
    if (a === "edit") { ui.edit = !ui.edit; render(); return; }
    if (a === "filter") { ui.filter = b.dataset.v; render(); return; }
    if (!canWrite()) return;
    const prev = exportState(), next = exportState();
    if (a === "year") { next.maturaDate = `${b.dataset.v}-05-04`; save(next, `Ustawiono maturę: maj ${b.dataset.v}. Dokładną datę zmienisz pod licznikiem, gdy CKE poda harmonogram.`, prev); }
    else if (a === "cycle") { const f = findTopic(next, b.dataset.tid); if (!f) return; f.t.st = (f.t.st + 1) % 4; if (f.t.st >= 2) f.t.catchup = false; save(next); }
    else if (a === "catch") { const f = findTopic(next, b.dataset.tid); if (!f) return; f.t.catchup = !f.t.catchup; save(next); }
    else if (a === "delTopic") { const f = findTopic(next, b.dataset.tid); if (!f) return; f.s.topics = f.s.topics.filter(x => x.id !== f.t.id); save(next, `Usunięto dział: ${f.t.name}.`, prev); }
    else if (a === "maybe") { const s = next.subjects.find(x => x.id === b.dataset.sid); if (!s) return; s.maybe = !s.maybe; save(next, `${s.name}: ${s.maybe ? "może" : "zdaję na pewno"}.`, prev); }
    else if (a === "addTest") { ui.sheet = { data: { id: null, kind: "sat", target: null, date: "" } }; renderSheet(); }
    else if (a === "editTest") { const t = S.tests.find(x => x.id === b.dataset.id); if (t) { ui.sheet = { data: { id: t.id, kind: t.kind, target: t.target, date: t.date || "" } }; renderSheet(); } }
    else if (a === "delResult") { const t = next.tests.find(x => x.id === b.dataset.id); if (!t) return; const r = t.results.find(x => x.id === b.dataset.rid); t.results = t.results.filter(x => x.id !== b.dataset.rid); save(next, `Usunięto wynik ${r ? num(r.score) : ""}.`, prev); }
  }
  function onSubmit(e) {
    const f = e.target;
    if (f.dataset.stadd) {
      e.preventDefault(); if (!canWrite()) return;
      const name = f.querySelector('[name="name"]').value.trim(); if (!name) return;
      const prev = exportState(), next = exportState(), s = next.subjects.find(x => x.id === f.dataset.stadd); if (!s) return;
      s.topics.push({ id: newId("d"), name, st: 0, catchup: false });
      save(next, `Dodano dział: ${name}.`, prev);
    } else if (f.dataset.stres) {
      e.preventDefault(); if (!canWrite()) return;
      const t = S.tests.find(x => x.id === f.dataset.stres); if (!t) return;
      const k = testOf(t.kind), sc = parseScore(f.querySelector('[name="score"]').value, k), date = f.querySelector('[name="date"]').value;
      const er = doc.querySelector(`[data-sterr="${t.id}"]`), err = m => { if (er) er.textContent = m; };
      if (sc.empty || sc.bad) return err(`Wpisz wynik od ${k.min} do ${k.max}.`);
      if (!DAY.test(date || "") || date > today()) return err("Wybierz datę (nie później niż dziś).");
      const prev = exportState(), next = exportState();
      next.tests.find(x => x.id === t.id).results.push({ id: newId("r"), date, score: sc.v, note: "" });
      const goal = t.target != null && sc.v >= t.target;
      save(next, `Zapisano wynik ${k.name}: ${num(sc.v)}${goal ? " — cel osiągnięty!" : t.target != null ? ` (cel: ${num(t.target)})` : ""}.`, prev);
    }
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset.stmatura) { if (!setMaturaDate(el.value)) render(); return; }
    if (!el.dataset.stedit || !canWrite()) return;
    const name = el.value.trim(), next = exportState(), f = findTopic(next, el.dataset.stedit);
    if (!f || !name || name === f.t.name) { render(); return; }
    f.t.name = name; save(next);
  }
  function mount() {
    const root = $("stRoot");
    if (root) { root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("change", onChange); }
    for (const t of ["matura", "testy"]) { const b = $("stt-" + t); if (b) b.addEventListener("click", () => { ui.tab = t; render(); }); }
    const sh = $("stSheet");
    if (sh) { sh.addEventListener("click", onSheetClick); sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); }); }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
  }
  function summary() { const o = overall(S); return S.maturaDate ? `Matura ${when(daysBetween(today(), S.maturaDate))} · ${o.pct}% opanowane` : `Matura i testy · ${o.pct}% opanowane`; }
  function setMaturaDate(k) { if (!DAY.test(k || "") || !canWrite()) return false; const prev = exportState(), next = exportState(); next.maturaDate = k; return save(next, `Data matury: ${fmtLong.format(parseDay(k))}.`, prev); }
  function setClock(fn) { now = fn || (() => new Date()); }
  function showTab(t) { ui.tab = t === "testy" ? "testy" : "matura"; render(); }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, showTab, setMaturaDate, ui, canWrite,
    datesBetween: (from, to) => datesBetween(S, from, to) });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmStudy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
