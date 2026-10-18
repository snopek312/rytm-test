// Rytm: learning (Nauka). The main tab is learning now ("Na bieżąco"): the topics of school subjects (written down
// after a lesson or before a test) with a status and spaced revision (1, 3, 7, 14, 30, 60 days), the coming tests
// (Szkoła), today's lessons (the timetable from Dziś), the subjects in order of what matters most for the grades,
// topics to catch up (e.g. after a year abroad) and the time spent learning. The second tab: the matura (topics of
// each subject with a status, a countdown) and the tests for studying abroad (SAT/ACT and an English test).
// The matura topic lists are a starting point, roughly following the national curriculum; the user edits them.
// Saved state (one record in meta "study"):
//   {v:1, maturaDate, subjects:[{id, name, level, maybe, topics:[{id, name, st, catchup}]}], tests:[{id, kind, target, date, results:[{id, date, score, note}]}],
//    current:{topics:[{id, sid, name, st, catchup, added, level, due, last}], sessions:[{id, sid, date, min}]}}
//   matura st: 0 not started, 1 covered (przerobione), 2 I know it (umiem), 3 revised (powtórzone)
//   current st: 0 to learn (do nauki), 1 learning (w trakcie), 2 I know it (umiem), 3 fixed (utrwalone); sid = Szkoła's subject id
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const ST = ["nie zaczęte", "przerobione", "umiem", "powtórzone"];
  const ST_NOW = ["do nauki", "w trakcie", "umiem", "utrwalone"];
  // days until the next revision after 0, 1, 2… good revisions in a row
  const INTERVALS = [1, 3, 7, 14, 30, 60];
  const MINUTES = [15, 25, 30, 45, 60, 90];
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
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const dayOr = v => (typeof v === "string" && DAY.test(v) ? v : null);
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const testOf = id => TESTS.find(t => t.id === id) || null;

  function defaults() {
    let n = 0;
    return { v: 1, maturaDate: null,
      subjects: SUBJECTS.map(s => ({ id: s.id, name: s.name, level: s.level, maybe: s.maybe, topics: s.topics.map(t => ({ id: `${s.id}-${++n}`, name: t, st: 0, catchup: false })) })),
      tests: [{ id: "t-sat", kind: "sat", target: null, date: null, results: [] }, { id: "t-toefl", kind: "toefl", target: null, date: null, results: [] }],
      current: { topics: [], sessions: [] } };
  }
  function normCurrent(c) {
    const o = c && typeof c === "object" ? c : {}, ids = new Set(), fresh = x => x && typeof x.id === "string" && x.id && !ids.has(x.id);
    const sidOk = v => typeof v === "string" && v.length > 0 && v.length <= 60;
    const topics = (Array.isArray(o.topics) ? o.topics : []).filter(t => fresh(t) && sidOk(t.sid) && str(t.name, 120) && ids.add(t.id)).map(t => ({
      id: t.id, sid: t.sid, name: str(t.name, 120), st: Number.isInteger(t.st) && t.st >= 0 && t.st <= 3 ? t.st : 0, catchup: t.catchup === true,
      added: dayOr(t.added), level: Number.isInteger(t.level) && t.level >= 0 && t.level < INTERVALS.length ? t.level : 0, due: dayOr(t.due), last: dayOr(t.last) }));
    const sessions = (Array.isArray(o.sessions) ? o.sessions : []).filter(x => fresh(x) && sidOk(x.sid) && DAY.test(x.date || "") && Number.isInteger(x.min) && x.min > 0 && x.min <= 600 && ids.add(x.id))
      .map(x => ({ id: x.id, sid: x.sid, date: x.date, min: x.min }));
    return { topics, sessions };
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
    return { v: 1, maturaDate: dayOr(o.maturaDate), subjects, tests, current: normCurrent(o.current) };
  }
  /* ---- learning now ---- */
  // a revision: remembered -> the next, longer gap (and "umiem", from the 3rd good one in a row "utrwalone"); forgotten -> again tomorrow
  function review(topic, ok, today) {
    const t = Object.assign({}, topic);
    if (ok) { t.level = Math.min(t.level + 1, INTERVALS.length - 1); t.st = t.level >= 3 ? 3 : Math.max(t.st, 2); t.due = addDays(today, INTERVALS[t.level]); }
    else { t.level = 0; t.st = 1; t.due = addDays(today, 1); }
    t.last = today;
    return t;
  }
  // a new topic: after a lesson it is "w trakcie" and comes back tomorrow; before a test it is "do nauki"
  function newTopic(sid, name, today, st = 1) { return { id: newId("n"), sid, name: str(name, 120), st, catchup: false, added: today, level: 0, due: st >= 1 ? addDays(today, 1) : null, last: null }; }
  // the topics to revise on day k (and the late ones), the most overdue first
  const dueList = (state, k) => state.current.topics.filter(t => t.st >= 1 && t.due && t.due <= k).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  // the timetable's subject name -> Szkoła's subject ("Język angielski" = "Język angielski"; "Angielski" fits too)
  function matchSubject(subjects, name) {
    const n = String(name || "").trim().toLowerCase(); if (!n) return null;
    return subjects.find(s => s.name.toLowerCase() === n) || subjects.find(s => { const m = s.name.toLowerCase(); return m.endsWith(" " + n) || n.endsWith(" " + m); }) || null;
  }
  // the order of the subjects: a test soon first, then a grade under its target, then close to a better grade, then revisions due, then a low grade
  // info: {grades:[{sid, avg, grade, target, need}], tests:[{sid, date, gid}]}
  function priorities(state, info, today) {
    const subs = (info && info.subjects) || [], grades = (info && info.grades) || [], tests = (info && info.tests) || [];
    return subs.map(s => {
      const g0 = grades.find(x => x.sid === s.id) || {}, own = state.current.topics.filter(t => t.sid === s.id);
      const next = tests.filter(t => t.sid === s.id && !t.gid && t.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
      const testIn = next ? daysBetween(today, next.date) : null;
      const due = own.filter(t => t.st >= 1 && t.due && t.due <= today).length, todo = own.filter(t => t.st < 2).length, catchup = own.filter(t => t.catchup && t.st < 2).length;
      const under = g0.target && g0.grade && g0.grade < g0.target, close = g0.need != null && g0.need <= 3 && g0.grade && g0.grade < 6;
      let score = 0, why = [];
      if (testIn != null && testIn <= 14) { score += 100 - testIn * 6; why.push(testIn === 0 ? "test dziś" : testIn === 1 ? "test jutro" : `test za ${testIn} dni`); }
      if (under) { score += 40; why.push(`cel ${g0.target}, teraz ${g0.grade}`); }
      if (close) { score += 15; why.push(`do ${g0.grade + 1} brakuje ${String(Math.round(g0.need * 10) / 10).replace(".", ",")} pp.`); }
      if (due) { score += 5 * due; why.push(`${due} do powtórki`); }
      if (g0.grade) score += (6 - g0.grade) * 3;
      if (catchup) score += 2 * catchup;
      return { s, grade: g0.grade || null, avg: g0.avg == null ? null : g0.avg, target: g0.target || null, testIn, test: next, due, todo, catchup, n: own.length, score, why };
    }).sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name, "pl"));
  }
  // minutes of learning in the week (Monday to Sunday) with day k
  function week(state, k) {
    const dow = (parseDay(k).getDay() + 6) % 7, mon = addDays(k, -dow), days = [];
    for (let i = 0; i < 7; i++) { const d = addDays(mon, i); days.push({ k: d, min: state.current.sessions.filter(x => x.date === d).reduce((a, x) => a + x.min, 0) }); }
    const bySid = {};
    for (const x of state.current.sessions) if (x.date >= mon && x.date <= addDays(mon, 6)) bySid[x.sid] = (bySid[x.sid] || 0) + x.min;
    return { days, total: days.reduce((a, d) => a + d.min, 0), bySid };
  }
  const hoursTxt = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
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

  const core = { ST, ST_NOW, INTERVALS, MINUTES, SUBJECTS, TESTS, defaults, normalize, progress, overall, topicsTouched, best, datesBetween, testOf, review, newTopic, dueList,
    matchSubject, priorities, week, hoursTxt, dayKey, parseDay, daysBetween, addDays };

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
  const ui = { tab: "teraz", long: "matura", open: null, edit: false, filter: "all", sheet: null, nopen: null, nf: "all", logSid: null, logMin: 30, more: false };
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };
  // what Nauka shows from the other sections: Szkoła's subjects, grades and tests, the timetable
  const info = () => { try { return (P && P.sources && P.sources()) || {}; } catch (e) { return {}; } };

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

  /* ---------- learning now ---------- */
  const fmtDow = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
  const DOWS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
  const gdot = gr => `<span class="sc-dot g-${gr || 0}" aria-label="${gr ? "ocena " + gr : "bez ocen"}">${gr || "–"}</span>`;
  function topicRow(t, T, dis) {
    const late = t.st >= 1 && t.due && t.due <= T;
    const dueTxt = t.st >= 1 && t.due ? (late ? (t.due === T ? "powtórka dziś" : `powtórka spóźniona (${when(daysBetween(T, t.due))})`) : `powtórka ${when(daysBetween(T, t.due))}`) : "jeszcze nie przerobione";
    return `<li class="st-t st-nt s-${t.st}${late ? " late" : ""}">
      <button type="button" class="st-pill" data-stact="ncycle" data-tid="${esc(t.id)}" aria-label="${esc(t.name)}: ${ST_NOW[t.st]} — zmień" ${dis}>${ST_NOW[t.st]}</button>
      <span class="st-name">${esc(t.name)}</span>
      <span class="st-nsub"><small>${esc(dueTxt)}</small><span class="st-tact"><button type="button" class="chip st-catch" data-stact="ncatch" data-tid="${esc(t.id)}" aria-pressed="${t.catchup}" ${dis}>nadrobić</button><button type="button" class="icon-btn" data-stact="ndel" data-tid="${esc(t.id)}" aria-label="Usuń temat ${esc(t.name)}" ${dis}>×</button></span></span></li>`;
  }
  function subjectCard(p, T, dis) {
    const open = ui.nopen === p.s.id;
    const list = S.current.topics.filter(t => t.sid === p.s.id && (ui.nf === "all" || (ui.nf === "catch" ? t.catchup : t.st < 2)))
      .sort((a, b) => a.st - b.st || ((a.due || "9") < (b.due || "9") ? -1 : 1));
    const counts = [p.todo ? `${p.todo} do nauki` : "", p.due ? `${p.due} do powtórki` : "", p.catchup ? `${p.catchup} do nadrobienia` : ""].filter(Boolean).join(" · ");
    return `<li class="st-pr${open ? " open" : ""}${p.testIn != null && p.testIn <= 3 ? " soon" : ""}">
      <button type="button" class="st-prh" data-stact="nopen" data-sid="${esc(p.s.id)}" aria-expanded="${open}">
        ${gdot(p.grade)}<span class="st-prn"><b>${esc(p.s.name)}</b><small>${esc(p.why.join(" · ") || (p.n ? counts : "bez tematów"))}</small></span>
        <span class="st-prc">${p.n ? `${p.n - p.todo}/${p.n}` : ""}<i aria-hidden="true">${open ? "▴" : "▾"}</i></span></button>
      ${open ? `<div class="st-prb">
        ${p.why.length && counts ? `<p class="meta">${esc(counts)}</p>` : ""}
        ${list.length ? `<ul class="st-topics">${list.map(t => topicRow(t, T, dis)).join("")}</ul>` : `<p class="meta">${ui.nf === "all" ? "Nie ma jeszcze tematów. Dopisz, co było na lekcjach albo co będzie na teście." : "Nic w tym filtrze."}</p>`}
        <form class="gl-add" data-stnadd="${esc(p.s.id)}" novalidate><input name="name" type="text" maxlength="120" placeholder="Nowy temat, np. Ruch jednostajny" aria-label="Nowy temat: ${esc(p.s.name)}" ${dis}><button type="submit" class="btn" ${dis}>Dodaj</button></form>
      </div>` : ""}</li>`;
  }
  function nowView() {
    const T = today(), dis = canWrite() ? "" : "disabled", I = info(), subs = I.subjects || [], cats = I.cats || [];
    const sub = id => subs.find(x => x.id === id), kindName = id => ((cats.find(c => c.id === id) || { name: "Test" }).name);
    const due = dueList(S, T), wk = week(S, T);
    const tests = (I.tests || []).filter(t => t.date >= T && t.date <= addDays(T, 14) && sub(t.sid)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const pr = priorities(S, { subjects: subs, grades: I.grades || [], tests: I.tests || [] }, T);
    // today's lessons, or the last school day's (at the weekend: Friday)
    let lk = T, lessons = [];
    for (let i = 0; i < 4; i++) { const k = addDays(T, -i), l = I.lessonsOn ? (() => { try { return I.lessonsOn(k); } catch (e) { return []; } })() : []; if (l.length) { lk = k; lessons = l; break; } }
    const lsubs = []; for (const l of lessons) { const m = matchSubject(subs, l.subject); if (m && !lsubs.some(x => x.id === m.id)) lsubs.push(m); }
    const max = Math.max(60, ...wk.days.map(d => d.min));
    const shown = ui.nf === "catch" ? pr.filter(p => p.catchup || S.current.topics.some(t => t.sid === p.s.id && t.catchup)) : pr;
    const top = ui.more || ui.nf === "catch" ? shown : shown.filter((p, i) => i < 5 || p.score >= 20 || ui.nopen === p.s.id);
    const logSid = ui.logSid && sub(ui.logSid) ? ui.logSid : (pr[0] && pr[0].s.id) || "";
    return `<section class="panel st-hero">
        <div class="tiles lf-tiles3">
          <div class="tile"><span class="k">Do powtórki</span><span class="v${due.length ? "" : " good"}">${due.length}</span><span class="d meta">${due.length ? "dziś" : "na dziś nic"}</span></div>
          <div class="tile"><span class="k">Testy</span><span class="v">${tests.length}</span><span class="d meta">w 14 dni</span></div>
          <div class="tile"><span class="k">Nauka</span><span class="v st-hours">${esc(hoursTxt(wk.total))}</span><span class="d meta">w tym tygodniu</span></div></div>
      </section>
      <section class="panel"><h2>Do powtórki dziś</h2>
        ${due.length ? `<ul class="st-rev">${due.slice(0, 12).map(t => `<li><span class="st-revn"><b>${esc(t.name)}</b><small>${esc(sub(t.sid) ? sub(t.sid).name : "?")}${t.due < T ? ` · spóźnione ${-daysBetween(T, t.due)} ${plural(-daysBetween(T, t.due), "dzień", "dni", "dni")}` : ""}</small></span>
            <button type="button" class="btn st-ok" data-stact="rev" data-v="1" data-tid="${esc(t.id)}" ${dis}>✓ Pamiętam</button><button type="button" class="btn st-no" data-stact="rev" data-v="0" data-tid="${esc(t.id)}" aria-label="Nie pamiętam: ${esc(t.name)}" ${dis}>✗</button></li>`).join("")}</ul>
          ${due.length > 12 ? `<p class="meta">i ${due.length - 12} więcej — po kolei.</p>` : ""}`
          : `<p class="meta">${S.current.topics.length ? "Wszystko powtórzone. Następne powtórki pokażą się tu same." : "Dopisuj tematy z lekcji (niżej) — każdy wróci do powtórki po 1, 3, 7, 14, 30 i 60 dniach. Krótka powtórka w dobrym momencie daje więcej niż długa nauka przed samym testem."}</p>`}
      </section>
      <section class="panel"><h2>Najbliższe testy</h2>
        ${tests.length ? `<ul class="st-tests">${tests.map(t => { const n = daysBetween(T, t.date), todo = S.current.topics.filter(x => x.sid === t.sid && x.st < 2), has = t.topic && S.current.topics.some(x => x.sid === t.sid && x.name.toLowerCase() === t.topic.toLowerCase());
            return `<li class="${n <= 2 ? "soon" : ""}"><span class="st-in"><b>${n === 0 ? "dziś" : n === 1 ? "jutro" : n}</b>${n > 1 ? `<small>${plural(n, "dzień", "dni", "dni")}</small>` : ""}</span>
              <span class="st-tn"><b>${esc(sub(t.sid).name)}${t.retake ? " (poprawa)" : ""}</b><small>${esc(kindName(t.cat))}${t.topic ? ` · ${esc(t.topic)}` : ""} · ${esc(fmtDow.format(parseDay(t.date)))}</small>
                ${todo.length ? `<small class="st-todo">Do nauki: ${todo.slice(0, 3).map(x => esc(x.name)).join(", ")}${todo.length > 3 ? ` i ${todo.length - 3} więcej` : ""}</small>` : ""}</span>
              ${t.topic && !has ? `<button type="button" class="btn small" data-stact="fromTest" data-sid="${esc(t.sid)}" data-name="${esc(t.topic)}" ${dis}>+ Do nauki</button>` : `<button type="button" class="btn link" data-stact="nopen" data-sid="${esc(t.sid)}" data-keep="1">Tematy</button>`}</li>`; }).join("")}</ul>`
          : `<p class="meta">W najbliższych dwóch tygodniach nie ma zapowiedzianych testów.</p>`}
        <p class="note">Testy dodajesz w kalendarzu (Dziś → + Test) albo w Szkole. Tu widać je wszystkie.</p>
      </section>
      <section class="panel"><h2>${lk === T ? "Dziś na lekcjach" : `Ostatnio na lekcjach <span class="meta">(${esc(fmtDow.format(parseDay(lk)))})</span>`}</h2>
        ${lsubs.length ? (() => { const done = m => S.current.topics.some(t => t.sid === m.id && t.added === lk), sel = lsubs.find(m => m.id === ui.lsub) || lsubs.find(m => !done(m)) || lsubs[0];
            const added = S.current.topics.filter(t => t.added === lk && lsubs.some(m => m.id === t.sid));
            return `<p class="hint">Wybierz przedmiot i zapisz w dwóch słowach, co było — temat wróci jutro do powtórki.</p>
            <div class="lf-chips st-lchips" role="group" aria-label="Przedmiot">${lsubs.map(m => `<button type="button" class="chip${done(m) ? " done" : ""}" data-stact="lsub" data-sid="${esc(m.id)}" aria-pressed="${m.id === sel.id}">${done(m) ? "✓ " : ""}${esc(m.name)}</button>`).join("")}</div>
            <form class="gl-add st-lform" data-stnadd="${esc(sel.id)}" data-day="${esc(lk)}" novalidate><input name="name" type="text" maxlength="120" placeholder="Temat: ${esc(sel.name)}" aria-label="Temat z lekcji: ${esc(sel.name)}" ${dis}><button type="submit" class="btn primary" ${dis}>Dodaj</button></form>
            ${added.length ? `<ul class="st-ladded">${added.map(t => `<li><b>${esc(subName(t.sid))}:</b> ${esc(t.name)}</li>`).join("")}</ul>` : ""}`; })()
          : `<p class="meta">${lessons.length ? "Przedmioty z planu nie pasują do przedmiotów w Szkole." : "Tu pokażą się przedmioty z dzisiejszego planu lekcji."} <button type="button" class="btn link" data-stact="go" data-v="today" data-arg="lekcje">Plan lekcji</button></p>`}
      </section>
      <section class="panel"><div class="row"><h2>Przedmioty</h2></div>
        <p class="hint">Od tego, co teraz najważniejsze: test niedługo, ocena poniżej celu, blisko wyższej oceny, powtórki. Dotknij przedmiotu, żeby zobaczyć tematy.</p>
        <div class="seg small st-filter" role="group" aria-label="Pokaż">${[["all", "Wszystkie"], ["todo", "Do nauki"], ["catch", "Do nadrobienia"]].map(([k, l]) => `<button type="button" class="seg-b" data-stact="nf" data-v="${k}" aria-pressed="${ui.nf === k}">${l}</button>`).join("")}</div>
        ${ui.nf === "catch" ? `<p class="note">„Nadrobić” oznacza temat do nadrobienia — np. po roku wymiany albo po chorobie. Zaznaczaj przy tematach, a tu zobaczysz wszystkie naraz.</p>` : ""}
        ${top.length ? `<ul class="st-prs">${top.map(p => subjectCard(p, T, dis)).join("")}</ul>` : `<p class="meta">${ui.nf === "catch" ? "Nie masz tematów do nadrobienia." : "Brak przedmiotów — dodaj je w Szkole."}</p>`}
        ${top.length < shown.length ? `<button type="button" class="btn link" data-stact="more">Pokaż wszystkie przedmioty (${shown.length})</button>` : ""}
      </section>
      <section class="panel"><h2>Czas nauki</h2>
        <div class="st-week" role="img" aria-label="Nauka w tym tygodniu: ${esc(hoursTxt(wk.total))}">${wk.days.map((d, i) => `<span class="st-wd${d.k === T ? " today" : ""}"><span class="st-wb"><i style="height:${Math.round(d.min / max * 100)}%"></i></span><small>${DOWS[i]}</small><small class="st-wm">${d.min ? d.min : ""}</small></span>`).join("")}</div>
        ${Object.keys(wk.bySid).length ? `<p class="meta">W tym tygodniu: ${Object.entries(wk.bySid).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([sid, m]) => `${esc(sub(sid) ? sub(sid).name : "?")} ${esc(hoursTxt(m))}`).join(" · ")}</p>` : ""}
        ${subs.length ? `<form class="st-log" data-stlog="1" novalidate>
          <select name="sid" aria-label="Przedmiot" ${dis}>${pr.map(p => `<option value="${esc(p.s.id)}"${p.s.id === logSid ? " selected" : ""}>${esc(p.s.name)}</option>`).join("")}</select>
          <div class="lf-chips" role="group" aria-label="Ile minut">${MINUTES.map(m => `<button type="button" class="chip" data-stact="min" data-v="${m}" aria-pressed="${ui.logMin === m}" ${dis}>${m}</button>`).join("")}<span class="meta">min</span></div>
          <button type="submit" class="btn primary" ${dis}>Zapisz naukę</button></form>` : ""}
        ${S.current.sessions.length ? `<ul class="lf-list st-sess">${S.current.sessions.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 4).map(x => `<li class="lf-row static"><span class="lf-d">${esc(fmtDow.format(parseDay(x.date)))}</span><span>${esc(sub(x.sid) ? sub(x.sid).name : "?")} · ${esc(hoursTxt(x.min))}</span><button type="button" class="icon-btn" data-stact="delSess" data-id="${esc(x.id)}" aria-label="Usuń wpis nauki" ${dis}>×</button></li>`).join("")}</ul>` : ""}
      </section>`;
  }

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
    for (const t of ["teraz", "dalej"]) { const b = $("stt-" + t); if (b) b.setAttribute("aria-selected", String(ui.tab === t)); }
    const sw = `<section class="panel st-long"><div class="seg small" role="group" aria-label="Matura czy testy"><button type="button" class="seg-b" data-stact="long" data-v="matura" aria-pressed="${ui.long === "matura"}">Matura</button><button type="button" class="seg-b" data-stact="long" data-v="testy" aria-pressed="${ui.long === "testy"}">SAT i angielski</button></div>
      <p class="note">Na później: przygotowanie do matury i testów na studia za granicą.</p></section>`;
    root.innerHTML = ui.tab === "teraz" ? nowView() : sw + (ui.long === "testy" ? testsView() : maturaView());
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
  const subName = sid => { const x = (info().subjects || []).find(y => y.id === sid); return x ? x.name : ""; };
  function onClick(e) {
    const b = e.target.closest("[data-stact]"); if (!b || b.disabled) return;
    const a = b.dataset.stact;
    if (a === "open") { ui.open = ui.open === b.dataset.sid ? null : b.dataset.sid; ui.edit = false; render(); return; }
    if (a === "edit") { ui.edit = !ui.edit; render(); return; }
    if (a === "filter") { ui.filter = b.dataset.v; render(); return; }
    if (a === "long") { ui.long = b.dataset.v === "testy" ? "testy" : "matura"; render(); return; }
    if (a === "nf") { ui.nf = b.dataset.v; render(); return; }
    if (a === "more") { ui.more = true; render(); return; }
    if (a === "lsub") { ui.lsub = b.dataset.sid; render(); const i = doc.querySelector("form.st-lform input"); if (i && i.focus) try { i.focus(); } catch (x) {} return; }
    if (a === "nopen") { ui.nopen = b.dataset.keep ? b.dataset.sid : ui.nopen === b.dataset.sid ? null : b.dataset.sid; if (b.dataset.keep) ui.more = true; render(); if (b.dataset.keep) { const el = doc.querySelector(`[data-stact="nopen"][data-sid="${b.dataset.sid}"]:not([data-keep])`); if (el && el.scrollIntoView) try { el.scrollIntoView({ block: "center" }); } catch (x) {} } return; }
    if (a === "go") { if (P && P.go) P.go(b.dataset.v, b.dataset.arg); return; }
    if (a === "min") { ui.logMin = +b.dataset.v; const f = doc.querySelector("[data-stlog] select"); if (f) ui.logSid = f.value; render(); return; }
    if (!canWrite()) return;
    const prev = exportState(), next = exportState();
    const ntop = id => next.current.topics.find(x => x.id === id);
    if (a === "rev") {
      const t = ntop(b.dataset.tid); if (!t) return;
      const ok = b.dataset.v === "1", r = review(t, ok, today()); Object.assign(t, r);
      return save(next, ok ? `${r.st === 3 ? "Utrwalone" : "Super"}: ${t.name} — następna powtórka ${when(daysBetween(today(), r.due))}.` : `${t.name} — wróci jutro.`, prev);
    }
    if (a === "ncycle") { const t = ntop(b.dataset.tid); if (!t) return; t.st = (t.st + 1) % 4; if (t.st >= 1 && !t.due) t.due = addDays(today(), 1); if (t.st >= 2) t.catchup = false; return save(next); }
    if (a === "ncatch") { const t = ntop(b.dataset.tid); if (!t) return; t.catchup = !t.catchup; return save(next); }
    if (a === "ndel") { const t = ntop(b.dataset.tid); if (!t) return; next.current.topics = next.current.topics.filter(x => x.id !== t.id); return save(next, `Usunięto temat: ${t.name}.`, prev); }
    if (a === "fromTest") { const t = newTopic(b.dataset.sid, b.dataset.name, today(), 0); next.current.topics.push(t); ui.nopen = b.dataset.sid; return save(next, `Dodano do nauki: ${t.name} (${subName(t.sid)}).`, prev); }
    if (a === "delSess") { const x = next.current.sessions.find(y => y.id === b.dataset.id); if (!x) return; next.current.sessions = next.current.sessions.filter(y => y.id !== x.id); return save(next, `Usunięto wpis: ${subName(x.sid)}, ${hoursTxt(x.min)}.`, prev); }
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
    if (f.dataset.stnadd) {
      e.preventDefault(); if (!canWrite()) return;
      const inp = f.querySelector('[name="name"]'), name = inp.value.trim(); if (!name) { try { inp.focus(); } catch (x) {} return; }
      const prev = exportState(), next = exportState(), day = f.dataset.day || today(), sid = f.dataset.stnadd;
      if (next.current.topics.some(t => t.sid === sid && t.name.toLowerCase() === name.toLowerCase())) { say().info(`„${name}” już jest w tematach.`); return; }
      const t = newTopic(sid, name, day, 1); next.current.topics.push(t);
      const keep = f.dataset.day ? null : sid;
      if (keep) ui.nopen = keep; else ui.lsub = sid;
      save(next, `Dodano temat: ${t.name} (${subName(sid)}) — powtórka ${when(daysBetween(today(), t.due))}.`, prev);
      const again = doc.querySelector(f.dataset.day ? "form.st-lform input" : `form[data-stnadd="${sid}"]:not([data-day]) input`); if (again && again.focus) try { again.focus(); } catch (x) {}
      return;
    }
    if (f.dataset.stlog) {
      e.preventDefault(); if (!canWrite()) return;
      const sid = f.querySelector('[name="sid"]').value; if (!sid) return;
      const prev = exportState(), next = exportState(), min = ui.logMin || 30;
      next.current.sessions.push({ id: newId("u"), sid, date: today(), min }); ui.logSid = sid;
      const tot = week(normalize(next), today()).total;
      save(next, `Zapisano: ${subName(sid)}, ${hoursTxt(min)}. W tym tygodniu razem ${hoursTxt(tot)}.`, prev);
      return;
    }
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
    for (const t of ["teraz", "dalej"]) { const b = $("stt-" + t); if (b) b.addEventListener("click", () => { ui.tab = t; render(); }); }
    const sh = $("stSheet");
    if (sh) { sh.addEventListener("click", onSheetClick); sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); }); }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
  }
  function summary() {
    const T = today(), d = dueList(S, T).length, w = week(S, T).total;
    if (S.current.topics.length || w) return `${d ? `${d} do powtórki` : "Powtórki zrobione"} · ${hoursTxt(w)} nauki w tym tygodniu`;
    const o = overall(S); return S.maturaDate ? `Matura ${when(daysBetween(T, S.maturaDate))} · ${o.pct}% opanowane` : "Tematy z lekcji, powtórki, matura i SAT";
  }
  function setMaturaDate(k) { if (!DAY.test(k || "") || !canWrite()) return false; const prev = exportState(), next = exportState(); next.maturaDate = k; return save(next, `Data matury: ${fmtLong.format(parseDay(k))}.`, prev); }
  function setClock(fn) { now = fn || (() => new Date()); }
  // "teraz" = learning now; "matura" / "testy" = the second tab with that part chosen
  function showTab(t) { if (t === "matura" || t === "testy") { ui.tab = "dalej"; ui.long = t; } else ui.tab = t === "dalej" ? "dalej" : "teraz"; render(); }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, showTab, setMaturaDate, ui, canWrite,
    datesBetween: (from, to) => datesBetween(S, from, to), reviewDue: () => dueList(S, today()).length });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmStudy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
