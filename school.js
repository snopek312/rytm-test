// Rytm: school ("Szkoła") — grades in percent, with the limits of a percent-based school:
//   1–39 → 1, 40–54 → 2, 55–69 → 3, 70–84 → 4, 85–94 → 5, 95–100 → 6 (the limits can be changed in the settings).
// Each grade: subject, percent, weight 1–10, kind (praca klasowa, sprawdzian, kartkówka, ...), description, date, and optionally:
// a mark for the analysis ("ok" or "zle" — I do not like it), a planned retake percent (only for "what if") and a
// real retake percent (counted by the school rule: replaces the grade, both count, or the better one counts).
// The average of a subject is the weighted average of the percents; the predicted final grade comes from the same
// limits. The school year runs 1 September – 30 June; the first term ends on a day set in the settings.
// Saved state (one record): {v:1, subjects:[...], grades:[...], tests:[...], settings:{...}}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const MD = /^\d{2}-\d{2}$/;
  const SUBJECTS = ["Biologia", "Biznes i zarządzanie", "Chemia", "Edukacja obywatelska", "Edukacja zdrowotna", "Fizyka", "Geografia",
    "Historia", "Informatyka", "Język angielski", "Język hiszpański", "Język polski", "Matematyka", "Wychowanie fizyczne"];
  const EXTENDED = ["Matematyka", "Fizyka", "Informatyka"];
  // the kinds as in the school's e-register (praca klasowa 8 is the heaviest); "inne" must stay last (the fallback)
  const CATS = [{ id: "pk", name: "Praca klasowa", w: 8 }, { id: "spr", name: "Sprawdzian", w: 5 }, { id: "kart", name: "Kartkówka", w: 3 },
    { id: "odp", name: "Odpowiedź", w: 2 }, { id: "lek", name: "Praca na lekcji", w: 2 }, { id: "prez", name: "Prezentacja", w: 3 }, { id: "proj", name: "Projekt", w: 3 },
    { id: "dom", name: "Praca domowa", w: 1 }, { id: "akt", name: "Aktywność", w: 1 }, { id: "inne", name: "Inne", w: 1 }];
  const GRADE_NAMES = ["", "niedostateczny", "dopuszczający", "dostateczny", "dobry", "bardzo dobry", "celujący"];
  const RETAKE = ["replace", "both", "max"];
  const DEFAULT_SETTINGS = { th: [40, 55, 70, 85, 95], retake: "replace", semEnd: "01-31", pasek: 4.75,
    catW: Object.fromEntries(CATS.map(c => [c.id, c.w])) };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;
  const slug = name => "s-" + String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function defaults() {
    return { v: 1, subjects: SUBJECTS.map(n => ({ id: slug(n), name: n, ext: EXTENDED.includes(n), counts: true, target: null })),
      grades: [], tests: [], settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
  }
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : null);
  const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  // anything saved (or loaded from a backup) -> a clean state; missing parts get the defaults
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const D = DEFAULT_SETTINGS, si = o.settings && typeof o.settings === "object" ? o.settings : {};
    const th = Array.isArray(si.th) && si.th.length === 5 && si.th.every((x, i, a) => num(x, 1, 100) != null && (i === 0 || x > a[i - 1])) ? si.th.slice() : D.th.slice();
    const catW = {}; for (const c of CATS) catW[c.id] = intIn(si.catW && si.catW[c.id], 1, 10) || D.catW[c.id];
    const settings = { th, retake: RETAKE.includes(si.retake) ? si.retake : D.retake, semEnd: MD.test(si.semEnd || "") ? si.semEnd : D.semEnd,
      pasek: num(si.pasek, 1, 6) || D.pasek, catW };
    const seen = new Set();
    const subjects = (Array.isArray(o.subjects) ? o.subjects : defaults().subjects).filter(s => s && typeof s.id === "string" && typeof s.name === "string" && s.name.trim() && !seen.has(s.id) && seen.add(s.id))
      .map(s => ({ id: s.id, name: s.name.trim().slice(0, 60), ext: !!s.ext, counts: s.counts !== false, target: intIn(s.target, 1, 6) }));
    const ids = new Set(subjects.map(s => s.id)), gids = new Set();
    const grades = (Array.isArray(o.grades) ? o.grades : []).filter(x => x && typeof x.id === "string" && !gids.has(x.id) && ids.has(x.sid) && num(x.pct, 0, 100) != null && DAY.test(x.date || "") && gids.add(x.id))
      .map(x => ({ id: x.id, sid: x.sid, pct: r1(x.pct), w: intIn(x.w, 1, 10) || 1, cat: CATS.some(c => c.id === x.cat) ? x.cat : "inne", desc: str(x.desc, 200), date: x.date,
        flag: x.flag === "ok" || x.flag === "zle" ? x.flag : null, plan: num(x.plan, 0, 100) == null ? null : r1(x.plan), retake: num(x.retake, 0, 100) == null ? null : r1(x.retake) }));
    const tids = new Set();
    const tests = (Array.isArray(o.tests) ? o.tests : []).filter(t => t && typeof t.id === "string" && !tids.has(t.id) && ids.has(t.sid) && DAY.test(t.date || "") && tids.add(t.id))
      .map(t => ({ id: t.id, sid: t.sid, date: t.date, cat: CATS.some(c => c.id === t.cat) ? t.cat : "spr", w: intIn(t.w, 1, 10) || 1, topic: str(t.topic, 200), gid: typeof t.gid === "string" && gids.has(t.gid) ? t.gid : null, retake: t.retake === true }));
    return { v: 1, subjects, grades, tests, settings };
  }

  // percent -> grade 1..6 by the school's limits
  // 0 none, 1 the pasek (≥ 4,75 by default), 2 ≥ 5,0, 3 ≥ 5,2
  const avgTier = (avg, pasek = DEFAULT_SETTINGS.pasek) => (avg == null ? 0 : avg >= 5.2 ? 3 : avg >= 5 ? 2 : avg >= pasek ? 1 : 0);
  function gradeOf(pct, th = DEFAULT_SETTINGS.th) {
    if (pct == null) return null;
    let gr = 1; for (let i = 0; i < th.length; i++) if (pct >= th[i]) gr = i + 2;
    return gr;
  }
  const lowerLimit = (grade, th) => (grade <= 1 ? 0 : th[grade - 2]);

  /* periods: the school year (1.09 – 30.06) and its two terms; July and August belong to the year that just ended */
  function schoolYearOf(k) { const d = parseDay(k), m = d.getMonth() + 1; return m >= 9 ? d.getFullYear() : d.getFullYear() - 1; }
  function yearRange(y0, semEnd = DEFAULT_SETTINGS.semEnd) {
    const end1 = `${y0 + 1}-${semEnd}`;
    return { y0, start: `${y0}-09-01`, end: `${y0 + 1}-06-30`, label: `Rok ${y0}/${String(y0 + 1).slice(2)}`,
      I: { start: `${y0}-09-01`, end: end1 }, II: { start: addDays(end1, 1), end: `${y0 + 1}-06-30` } };
  }
  function range(y0, part, semEnd) { const Y = yearRange(y0, semEnd); return part === "I" ? Y.I : part === "II" ? Y.II : { start: Y.start, end: Y.end }; }
  function termOf(k, semEnd) { const Y = yearRange(schoolYearOf(k), semEnd); return k <= Y.I.end ? "I" : "II"; }
  const inRange = (k, R) => k >= R.start && k <= R.end;

  // what a grade adds to the weighted average: [[percent, weight], ...]; plan = use the planned retake ("what if")
  function parts(gr, rule, plan) {
    const r = plan && gr.plan != null ? gr.plan : gr.retake;
    if (r == null) return [[gr.pct, gr.w]];
    if (rule === "both") return [[gr.pct, gr.w], [r, gr.w]];
    if (rule === "max") return [[Math.max(gr.pct, r), gr.w]];
    return [[r, gr.w]];
  }
  // a subject's grades -> weighted average, predicted grade, how far to the next grade
  function stats(grades, settings, o = {}) {
    const th = settings.th; let W = 0, sum = 0;
    const plan = typeof o.plan === "function" ? o.plan : (o.plan ? () => true : () => false);
    for (const gr of grades) for (const [p, w] of parts(gr, settings.retake, plan(gr))) { W += w; sum += p * w; }
    const avg = W ? sum / W : null, grade = gradeOf(avg, th);
    const next = grade && grade < 6 ? grade + 1 : null;
    return { n: grades.length, W, sum, avg, grade, next, need: next ? lowerLimit(next, th) - avg : null };
  }
  // the percent needed on n more grades of weight w (all equal) to reach the target grade
  function required(st, target, w, settings, n = 1) {
    const T = lowerLimit(target, settings.th);
    const pct = st.W ? (T * (st.W + n * w) - st.sum) / (n * w) : T;
    return { pct, possible: pct <= 100, free: pct <= 0, T };
  }
  // the fewest grades of weight w (at 100% each, up to 10) that still reach the target; null if not even 10
  function gradesNeeded(st, target, w, settings) {
    for (let n = 1; n <= 10; n++) if (required(st, target, w, settings, n).possible) return n;
    return null;
  }
  const subjectGrades = (state, sid, R) => state.grades.filter(x => x.sid === sid && (!R || inRange(x.date, R))).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  // all subjects in a period: stats, and the average of the predicted final grades (subjects that count and have grades)
  function overview(state, R, o = {}) {
    const rows = state.subjects.map(s => ({ s, st: stats(subjectGrades(state, s.id, R), state.settings, o) }));
    const counted = rows.filter(r => r.s.counts && r.st.grade);
    const avg = counted.length ? counted.reduce((a, r) => a + r.st.grade, 0) / counted.length : null;
    return { rows, avg: avg == null ? null : r2(avg), counted: counted.length, pasek: avg != null && r2(avg) >= state.settings.pasek };
  }
  // the grades marked "zle", each with what a retake would give: to its plan, or else to the lower limit of the next grade
  function ranking(state, R) {
    const out = [];
    for (const gr of state.grades) {
      if (gr.flag !== "zle" || (R && !inRange(gr.date, R))) continue;
      const own = gradeOf(gr.pct, state.settings.th);
      const target = gr.plan != null ? gr.plan : own < 6 ? lowerLimit(own + 1, state.settings.th) : null;
      if (target == null) continue;
      const list = subjectGrades(state, gr.sid, R);
      const before = stats(list, state.settings);
      const after = stats(list.map(x => (x.id === gr.id ? Object.assign({}, x, { retake: target }) : x)), state.settings);
      out.push({ g: gr, target, before, after, dAvg: (after.avg || 0) - (before.avg || 0), dGrade: (after.grade || 0) - (before.grade || 0) });
    }
    return out.sort((a, b) => b.dGrade - a.dGrade || b.dAvg - a.dAvg);
  }
  // the average of predicted final grades over time: one point per day with a new grade
  function trend(state, R) {
    const dates = [...new Set(state.grades.filter(x => inRange(x.date, R)).map(x => x.date))].sort();
    return dates.map(d => ({ date: d, avg: overview(state, { start: R.start, end: d }).avg }));
  }
  const core = { SUBJECTS, EXTENDED, CATS, GRADE_NAMES, DEFAULT_SETTINGS, defaults, normalize, avgTier, gradeOf, lowerLimit, schoolYearOf, yearRange, range, termOf, inRange,
    parts, stats, required, gradesNeeded, subjectGrades, overview, ranking, trend, slug, dayKey, parseDay, addDays, daysBetween, r1, r2, newId };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmSchool = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = x => (x == null ? "–" : r1(x).toFixed(1).replace(".", ","));
  const f0 = x => (x == null ? "–" : String(Math.round(x)));
  const f2 = x => (x == null ? "–" : x.toFixed(2).replace(".", ","));
  const pctTxt = x => (x == null ? "–" : (Number.isInteger(x) ? String(x) : f1(x)) + "%");
  const fmtDay = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });
  const fmtShort = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
  const dayTxt = k => fmtDay.format(parseDay(k));
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const catName = id => (CATS.find(c => c.id === id) || CATS[CATS.length - 1]).name;
  const TERM_NAME = { I: "I półrocze", II: "II półrocze", rok: "cały rok" };
  const RETAKE_NAME = { replace: "poprawa zastępuje ocenę", both: "liczą się obie oceny", max: "liczy się lepsza z dwóch" };
  const when = n => (n === 0 ? "dziś" : n === 1 ? "jutro" : n === 2 ? "pojutrze" : n > 0 ? `za ${n} ${plural(n, "dzień", "dni", "dni")}` : n === -1 ? "wczoraj" : `${-n} ${plural(-n, "dzień", "dni", "dni")} temu`);

  let S = defaults(), P = null, now = () => new Date();
  const tierSeen = {};
  const ui = { tab: "przedmioty", term: null, y0: null, sid: null, gid: null, sheet: null, chartSid: null, anFilter: "all", setOpen: false };
  let charts = [];
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const sub = id => S.subjects.find(s => s.id === id);
  const gradeById = id => S.grades.find(x => x.id === id);
  function curRange() {
    if (ui.y0 == null) ui.y0 = schoolYearOf(today());
    if (!ui.term) { const Y = yearRange(ui.y0, S.settings.semEnd); ui.term = inRange(today(), Y) ? termOf(today(), S.settings.semEnd) : "rok"; }
    return range(ui.y0, ui.term, S.settings.semEnd);
  }
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); render(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  // the whole school record is written at once; the screen shows the change now, the message comes only after the
  // store confirmed the save; if writing is off, the screen goes back to what is stored
  // other screens that show school data (the calendar, Nauka) are told after every change, also after "Cofnij"
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };
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

  /* ---------- small pieces ---------- */
  const gcls = gr => `g-${gr || 0}`;
  function chip(x) {
    const st = S.settings, eff = parts(x, st.retake, false), shown = x.retake != null ? eff[eff.length - 1][0] : x.pct, gr = gradeOf(shown, st.th);
    const tip = `<span class="sc-tip" role="tooltip"><b>${esc(catName(x.cat))} · waga ${x.w}</b><span>${pctTxt(x.pct)} → ${gradeOf(x.pct, st.th)} (${GRADE_NAMES[gradeOf(x.pct, st.th)]})${x.retake != null ? `<br>poprawa: ${pctTxt(x.retake)} → ${gradeOf(x.retake, st.th)}` : ""}</span><span>${esc(dayTxt(x.date))}</span>${x.desc ? `<span class="sc-tipd">${esc(x.desc)}</span>` : ""}</span>`;
    return `<button type="button" class="sc-chip ${gcls(gr)}${x.flag ? " f-" + x.flag : ""}${x.retake != null ? " has-retake" : ""}${ui.gid === x.id ? " open" : ""}" data-scact="chip" data-gid="${x.id}"
      aria-label="${esc(`${catName(x.cat)}, waga ${x.w}: ${pctTxt(x.pct)}, ocena ${gradeOf(x.pct, st.th)}${x.desc ? ", " + x.desc : ""}`)}" aria-expanded="${ui.gid === x.id}"><b>${gr}</b><small>${pctTxt(shown)}</small><i class="sc-w" aria-hidden="true">${x.w}</i>${tip}</button>`;
  }
  function meter(avg) {
    const th = S.settings.th;
    return `<div class="sc-meter" aria-hidden="true"><div class="sc-fill ${gcls(gradeOf(avg, th))}" style="width:${avg == null ? 0 : Math.max(1, Math.min(100, avg))}%"></div>${th.map((t, i) => `<i style="left:${t}%"><span>${i + 2}</span></i>`).join("")}</div>`;
  }
  function needTxt(st) {
    if (st.avg == null) return "brak ocen";
    return st.next ? `do ${st.next} brakuje ${f1(st.need)} pkt` : "najwyższa ocena";
  }
  function gradeDetail(x) {
    const st = S.settings, dis = canWrite() ? "" : "disabled", g0 = gradeOf(x.pct, st.th);
    return `<div class="sc-gdet" id="scGdet">
      <p><strong class="${gcls(g0)}-t">${pctTxt(x.pct)} → ${g0} (${GRADE_NAMES[g0]})</strong> · waga ${x.w} · ${esc(catName(x.cat))} · ${esc(dayTxt(x.date))}</p>
      ${x.desc ? `<p class="sc-desc">${esc(x.desc)}</p>` : ""}
      ${x.retake != null ? `<p class="meta">Poprawa: ${pctTxt(x.retake)} → ${gradeOf(x.retake, st.th)} (${RETAKE_NAME[st.retake]}).</p>` : ""}
      <div class="actions">
        <button type="button" class="chip sc-flag ok" data-scact="flag" data-f="ok" data-gid="${x.id}" aria-pressed="${x.flag === "ok"}" ${dis}>✓ Okej</button>
        <button type="button" class="chip sc-flag zle" data-scact="flag" data-f="zle" data-gid="${x.id}" aria-pressed="${x.flag === "zle"}" ${dis}>✗ Nie podoba mi się</button>
        <button type="button" class="btn" data-scact="edit" data-gid="${x.id}" ${dis}>Edytuj</button>
        <button type="button" class="btn" data-scact="retake" data-gid="${x.id}" ${dis}>${x.retake != null ? "Zmień poprawę" : "Poprawa"}</button>
      </div></div>`;
  }

  /* ---------- the screen ---------- */
  function render() {
    const root = $("scRoot"); if (!root) return;
    charts.forEach(c => { try { c.destroy(); } catch (e) {} }); charts = [];
    const R = curRange(), Y = yearRange(ui.y0, S.settings.semEnd);
    if ($("scSub")) $("scSub").textContent = `${Y.label} · ${TERM_NAME[ui.term]}`;
    for (const t of ["przedmioty", "analiza", "wykresy", "sprawdziany"]) { const b = $("sct-" + t); if (b) b.setAttribute("aria-selected", String(ui.tab === t)); }
    if ($("scAdd")) $("scAdd").disabled = !canWrite();
    const bar = `<div class="sc-bar">
        <div class="sc-year"><button type="button" class="icon-btn" data-scact="yprev" aria-label="Poprzedni rok szkolny">‹</button><strong>${esc(Y.label)}</strong><button type="button" class="icon-btn" data-scact="ynext" aria-label="Następny rok szkolny" ${ui.y0 >= schoolYearOf(today()) ? "disabled" : ""}>›</button></div>
        <span class="seg small sc-terms" role="group" aria-label="Okres">${["I", "II", "rok"].map(t => `<button type="button" class="seg-b" data-scact="term" data-t="${t}" aria-pressed="${ui.term === t}">${t === "rok" ? "Rok" : t + " półr."}</button>`).join("")}</span>
      </div>`;
    let body = "";
    if (ui.tab === "przedmioty") body = ui.sid && sub(ui.sid) ? subjectView(sub(ui.sid), R) : subjectsView(R);
    else if (ui.tab === "analiza") body = analysisView(R);
    else if (ui.tab === "wykresy") body = chartsView(R);
    else body = testsView();
    root.innerHTML = (ui.tab === "sprawdziany" ? "" : bar) + body;
    if (ui.tab === "wykresy") drawCharts(R);
    if (ui.tab === "przedmioty" && ui.sid) drawSubjectChart(R);
    renderSheet();
  }

  function subjectsView(R) {
    const O = overview(S, R), T = today();
    const inR = S.grades.filter(x => inRange(x.date, R));
    const zle = inR.filter(x => x.flag === "zle").length;
    const next = S.tests.filter(t => !t.gid && t.date >= T).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    const best = O.rows.filter(r => r.st.avg != null).sort((a, b) => b.st.avg - a.st.avg)[0];
    const pasekGap = O.avg == null ? null : S.settings.pasek - O.avg;
    const tier = avgTier(O.avg, S.settings.pasek), tkey = `${ui.y0}|${ui.term}`, rose = tierSeen[tkey] != null && tier > tierSeen[tkey];
    tierSeen[tkey] = tier;
    const head = `<section class="panel sc-head tier-${tier}${rose ? " celebrate" : ""}" aria-label="Podsumowanie">
        ${tier ? `<span class="sc-tier">${["", "Pasek", "Średnia 5,0+", "Średnia 5,2+"][tier]}</span>` : ""}
        <div class="sc-big"><span class="sc-avg ${O.avg == null ? "" : gcls(Math.round(O.avg))}">${O.avg == null ? "–" : f2(O.avg)}</span>
          <span class="sc-of"><strong>Średnia ocen końcowych</strong><br>przewidywana z ${O.counted} ${plural(O.counted, "przedmiotu", "przedmiotów", "przedmiotów")}
          <br>${O.avg == null ? "" : O.pasek ? `<span class="sc-pasek ok">Pasek na świadectwie ✓</span>` : `<span class="sc-pasek">Do paska (${f2(S.settings.pasek)}) brakuje ${f2(pasekGap)}</span>`}</span></div>
        <div class="tiles sc-tiles">
          <div class="tile"><span class="k">Oceny</span><span class="v">${inR.length}</span><span class="d">${esc(TERM_NAME[ui.term])}</span></div>
          <div class="tile"><span class="k">Nie podobają się</span><span class="v">${zle}</span><span class="d">${zle ? `<button type="button" class="btn link" data-scact="tab" data-t="analiza">przeanalizuj ›</button>` : "zaznacz w Analizie"}</span></div>
          <div class="tile"><span class="k">Najlepszy</span><span class="v sc-small">${best ? esc(best.s.name) : "–"}</span><span class="d">${best ? `${f1(best.st.avg)}% · ${best.st.grade}` : ""}</span></div>
          <div class="tile"><span class="k">Najbliższy sprawdzian</span><span class="v sc-small">${next ? esc(sub(next.sid).name) : "–"}</span><span class="d">${next ? `${esc(catName(next.cat))} · ${when(daysBetween(T, next.date))}` : `<button type="button" class="btn link" data-scact="tab" data-t="sprawdziany">dodaj ›</button>`}</span></div>
        </div></section>`;
    const empty = O.rows.filter(r => r.st.avg == null);
    const cards = O.rows.filter(r => r.st.avg != null).map(({ s, st }) => {
      const list = subjectGrades(S, s.id, R);
      const open = list.find(x => x.id === ui.gid);
      return `<article class="sc-sub${st.avg == null ? " empty" : ""}" data-sid="${s.id}">
        <div class="sc-subhead"><button type="button" class="sc-name" data-scact="openSub" data-sid="${s.id}">${esc(s.name)}${s.ext ? ` <span class="sc-r" title="rozszerzony">R</span>` : ""}${s.counts ? "" : ` <span class="meta">(nie do średniej)</span>`} <span aria-hidden="true">›</span></button>
          ${st.grade ? `<span class="sc-gbig ${gcls(st.grade)}" aria-label="przewidywana ocena ${st.grade}">${st.grade}</span>` : ""}
          <button type="button" class="icon-btn sc-plus" data-scact="add" data-sid="${s.id}" aria-label="Dodaj ocenę: ${esc(s.name)}" ${canWrite() ? "" : "disabled"}>+</button></div>
        ${st.avg == null ? `<p class="meta">Brak ocen w tym okresie.</p>` : `${meter(st.avg)}<p class="sc-line"><b>${f1(st.avg)}%</b> · ${needTxt(st)} · ${st.n} ${plural(st.n, "ocena", "oceny", "ocen")}</p>
        <div class="sc-chips">${list.map(chip).join("")}</div>${open ? gradeDetail(open) : ""}`}
      </article>`;
    }).join("");
    const emptyBox = empty.length ? `<section class="panel sc-empty"><h3>Bez ocen ${ui.term === "rok" ? "w tym roku" : "w tym półroczu"}</h3>
        <div class="sc-emptyl">${empty.map(({ s }) => `<span class="sc-ep"><button type="button" class="btn link" data-scact="openSub" data-sid="${s.id}">${esc(s.name)}</button>${s.ext ? ` <span class="sc-r">R</span>` : ""}<button type="button" class="icon-btn sc-plus" data-scact="add" data-sid="${s.id}" aria-label="Dodaj ocenę: ${esc(s.name)}" ${canWrite() ? "" : "disabled"}>+</button></span>`).join("")}</div></section>` : "";
    return head + `<div class="sc-list">${cards}</div>` + emptyBox + settingsView();
  }

  function subjectView(s, R) {
    const list = subjectGrades(S, s.id, R), st = stats(list, S.settings), T = today();
    const target = s.target || (st.grade ? Math.min(6, st.grade + 1) : 5);
    const calc = CATS.filter(c => ["pk", "spr", "kart", "odp"].includes(c.id)).map(c => {
      const w = S.settings.catW[c.id], rq = required(st, target, w, S.settings);
      let txt;
      if (rq.free) txt = `wystarczy dowolny wynik — ${target} już masz`;
      else if (rq.possible) txt = `co najmniej <b>${pctTxt(Math.ceil(rq.pct * 10) / 10)}</b>`;
      else { const n = gradesNeeded(st, target, w, S.settings); txt = n ? `jedna nie wystarczy — potrzebujesz ${n} takich ocen na 100% (albo ${n} po ${pctTxt(Math.ceil(required(st, target, w, S.settings, n).pct * 10) / 10)})` : "nawet 10 takich ocen na 100% nie wystarczy"; }
      return `<li><span>${esc(c.name)} (waga ${w})</span><span>${txt}</span></li>`;
    }).join("");
    const tests = S.tests.filter(t => t.sid === s.id && !t.gid && t.date >= T).sort((a, b) => (a.date < b.date ? -1 : 1));
    const open = list.find(x => x.id === ui.gid);
    return `<div class="row"><button type="button" class="btn link" data-scact="back">‹ Wszystkie przedmioty</button></div>
      <section class="panel sc-detail">
        <div class="sc-subhead"><h2>${esc(s.name)}${s.ext ? ` <span class="sc-r">R</span>` : ""}</h2>${st.grade ? `<span class="sc-gbig ${gcls(st.grade)}">${st.grade}</span>` : ""}</div>
        ${st.avg == null ? `<p class="meta">Brak ocen w tym okresie.</p>` : `${meter(st.avg)}<p class="sc-line"><b>${f1(st.avg)}%</b> · przewidywana ocena ${st.grade} (${GRADE_NAMES[st.grade]}) · ${needTxt(st)}</p>`}
        <div class="sc-chips">${list.map(chip).join("")}</div>${open ? gradeDetail(open) : ""}
        <div class="actions"><button type="button" class="btn primary" data-scact="add" data-sid="${s.id}" ${canWrite() ? "" : "disabled"}>+ Dodaj ocenę</button></div>
      </section>
      <section class="panel sc-calc">
        <h2>Ile muszę dostać?</h2>
        <div class="sc-targets" role="group" aria-label="Cel na koniec">${[2, 3, 4, 5, 6].map(n => `<button type="button" class="chip" data-scact="target" data-n="${n}" aria-pressed="${target === n}" ${canWrite() ? "" : "disabled"}>${n}</button>`).join("")}</div>
        <p class="hint">Cel: <b>${target}</b> (${GRADE_NAMES[target]}) — średnia co najmniej ${lowerLimit(target, S.settings.th)}%. Żeby to mieć, z następnej oceny potrzebujesz:</p>
        <ul class="sc-calcl">${calc}</ul>
        ${tests.length ? `<p class="meta">Zapowiedziane: ${tests.map(t => `${esc(catName(t.cat))} ${when(daysBetween(T, t.date))}${t.topic ? ` (${esc(t.topic)})` : ""}`).join(", ")}.</p>` : ""}
      </section>
      ${list.length ? `<section class="panel"><h2>Oceny w czasie</h2><p class="hint">Punkty to oceny (wynik w %), linia to średnia po każdej ocenie. Poziome kreski to progi ocen.</p><div class="chart"><canvas id="scSubChart" aria-label="Wykres ocen z przedmiotu ${esc(s.name)}"></canvas></div></section>
      <section class="panel"><h2>Wszystkie oceny</h2><div class="tablewrap"><table class="sc-table"><thead><tr><th>Data</th><th>Wynik</th><th>Waga</th><th>Rodzaj</th><th>Opis</th></tr></thead><tbody>
        ${list.slice().reverse().map(x => `<tr class="${x.flag ? "f-" + x.flag : ""}"><td>${esc(fmtShort.format(parseDay(x.date)))}</td><td><span class="sc-dot ${gcls(gradeOf(x.pct, S.settings.th))}">${gradeOf(x.pct, S.settings.th)}</span> ${pctTxt(x.pct)}${x.retake != null ? ` → ${pctTxt(x.retake)}` : ""}</td><td>${x.w}</td><td>${esc(catName(x.cat))}</td><td>${esc(x.desc)}</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}`;
  }

  function analysisView(R) {
    const inR = S.grades.filter(x => inRange(x.date, R));
    const nOk = inR.filter(x => x.flag === "ok").length, nZle = inR.filter(x => x.flag === "zle").length, nNone = inR.length - nOk - nZle;
    const O = overview(S, R), OP = overview(S, R, { plan: x => x.flag === "zle" });
    const rank = ranking(S, R), dis = canWrite() ? "" : "disabled";
    const close = overview(S, R).rows.filter(r => r.st.avg != null && r.st.next && r.st.need <= 6).sort((a, b) => a.st.need - b.st.need);
    const planned = inR.filter(x => x.flag === "zle" && x.plan != null).length;
    const filt = { all: () => true, none: x => !x.flag, zle: x => x.flag === "zle", ok: x => x.flag === "ok" }[ui.anFilter] || (() => true);
    const groups = S.subjects.map(s => ({ s, list: subjectGrades(S, s.id, R) })).filter(gp => gp.list.length);
    return `<section class="panel sc-an-head">
        <h2>Analiza ocen</h2>
        <p class="hint">Przejdź przez oceny i zaznacz: <b>✓ okej</b> albo <b>✗ nie podoba mi się</b>. Przy tych drugich ustaw, na ile chcesz je poprawić — od razu zobaczysz, co to zmieni w średniej i w ocenie na koniec. To tylko plan: prawdziwe oceny się nie zmieniają.</p>
        <div class="tiles sc-tiles">
          <div class="tile"><span class="k">Okej</span><span class="v">${nOk}</span></div>
          <div class="tile"><span class="k">Nie podobają się</span><span class="v">${nZle}</span></div>
          <div class="tile"><span class="k">Nieoznaczone</span><span class="v">${nNone}</span></div>
          <div class="tile"><span class="k">Średnia końcowa</span><span class="v">${f2(O.avg)}</span><span class="d">${planned ? `z planem poprawy: <b>${f2(OP.avg)}</b>` : "bez planów poprawy"}</span></div>
        </div>
        ${planned ? `<p class="sc-sim ${OP.avg > O.avg ? "up" : ""}">Gdybyś poprawił ${planned} ${plural(planned, "ocenę", "oceny", "ocen")} według planu: średnia ocen końcowych <b>${f2(O.avg)} → ${f2(OP.avg)}</b>${OP.pasek && !O.pasek ? " — i jest pasek!" : ""}.</p>` : ""}
      </section>
      <section class="panel"><h2>Co najbardziej się opłaca poprawić</h2>
        ${rank.length ? `<ol class="sc-rank">${rank.slice(0, 6).map(r => `<li>
          <span class="sc-dot ${gcls(gradeOf(r.g.pct, S.settings.th))}">${gradeOf(r.g.pct, S.settings.th)}</span>
          <span><b>${esc(sub(r.g.sid).name)}</b> · ${esc(catName(r.g.cat))} ${esc(fmtShort.format(parseDay(r.g.date)))} · ${pctTxt(r.g.pct)} (waga ${r.g.w})${r.g.desc ? ` · ${esc(r.g.desc)}` : ""}<br>
          <span class="meta">poprawa na ${pctTxt(r.target)}${r.g.plan == null ? " (próg następnej oceny)" : " (twój plan)"}: średnia ${f1(r.before.avg)}% → ${f1(r.after.avg)}%, ocena ${r.before.grade} → <b class="${r.dGrade > 0 ? "sc-up" : ""}">${r.after.grade}</b></span></span></li>`).join("")}</ol>`
          : `<p class="meta">Zaznacz poniżej oceny, które ci się nie podobają (✗) — tu pojawi się lista od tych, których poprawa da najwięcej.</p>`}
      </section>
      ${close.length ? `<section class="panel"><h2>Najbliżej wyższej oceny</h2><ul class="sc-close">${close.map(({ s, st }) => {
          const w = S.settings.catW.spr, rq = required(st, st.next, w, S.settings);
          return `<li><b>${esc(s.name)}</b> ${f1(st.avg)}% — do ${st.next} brakuje ${f1(st.need)} pkt · sprawdzian (waga ${w}) ${rq.possible ? `na co najmniej ${pctTxt(Math.ceil(rq.pct * 10) / 10)}` : "nie wystarczy jeden"}</li>`; }).join("")}</ul></section>` : ""}
      <div class="sc-anfilter seg small" role="group" aria-label="Pokaż">${[["all", "Wszystkie"], ["none", "Nieoznaczone"], ["zle", "✗ Nie podobają"], ["ok", "✓ Okej"]].map(([k, l]) => `<button type="button" class="seg-b" data-scact="anf" data-f="${k}" aria-pressed="${ui.anFilter === k}">${l}</button>`).join("")}</div>
      ${groups.map(({ s, list }) => {
        const shown = list.filter(filt); if (!shown.length) return "";
        const st = stats(list, S.settings), sp = stats(list, S.settings, { plan: x => x.flag === "zle" });
        return `<section class="panel sc-an-sub"><div class="sc-subhead"><h3>${esc(s.name)}</h3><span class="meta">${f1(st.avg)}% · ${st.grade}${sp.avg !== st.avg ? ` → z planem <b>${f1(sp.avg)}% · ${sp.grade}</b>` : ""}</span></div>
          ${shown.map(x => {
            const g0 = gradeOf(x.pct, S.settings.th);
            const one = x.flag === "zle" ? stats(list.map(y => (y.id === x.id ? Object.assign({}, y, { retake: x.plan != null ? x.plan : y.pct }) : y)), S.settings) : null;
            return `<div class="sc-an-row ${x.flag ? "f-" + x.flag : ""}" data-gid="${x.id}">
              <span class="sc-dot ${gcls(g0)}">${g0}</span>
              <span class="sc-an-info"><b>${pctTxt(x.pct)}</b> · waga ${x.w} · ${esc(catName(x.cat))} · ${esc(fmtShort.format(parseDay(x.date)))}${x.desc ? `<br><span class="meta">${esc(x.desc)}</span>` : ""}</span>
              <span class="sc-an-btns"><button type="button" class="chip sc-flag ok" data-scact="flag" data-f="ok" data-gid="${x.id}" aria-pressed="${x.flag === "ok"}" aria-label="Okej" ${dis}>✓</button><button type="button" class="chip sc-flag zle" data-scact="flag" data-f="zle" data-gid="${x.id}" aria-pressed="${x.flag === "zle"}" aria-label="Nie podoba mi się" ${dis}>✗</button></span>
              ${x.flag === "zle" ? `<label class="sc-plan">Poprawię na <input type="range" min="0" max="100" step="1" value="${x.plan != null ? x.plan : x.pct}" data-scplan="${x.id}" ${dis}> <output data-scout="${x.id}">${pctTxt(x.plan != null ? x.plan : x.pct)} → ${gradeOf(x.plan != null ? x.plan : x.pct, S.settings.th)}</output></label>
                <p class="meta sc-plan-res" data-scres="${x.id}">${x.plan != null ? `średnia z przedmiotu: ${f1(st.avg)}% → ${f1(one.avg)}%, ocena ${st.grade} → ${one.grade}` : "Przesuń suwak, żeby zobaczyć, co da poprawa."}</p>` : ""}
            </div>`; }).join("")}
        </section>`; }).join("") || `<p class="meta">Brak ocen w tym okresie.</p>`}`;
  }

  function chartsView(R) {
    const withGrades = S.subjects.filter(s => subjectGrades(S, s.id, R).length);
    if (!withGrades.length) return `<section class="panel"><h2>Wykresy</h2><p class="meta">Dodaj oceny, a pojawią się tu wykresy.</p></section>`;
    if (!ui.chartSid || !withGrades.some(s => s.id === ui.chartSid)) ui.chartSid = withGrades[0].id;
    return `<section class="panel"><h2>Średnia z przedmiotów</h2><p class="hint">Średnia ważona w %, od najlepszej. Pionowe kreski to progi ocen 2–6.</p>
        <div class="chart sc-tall" style="height:${Math.max(160, withGrades.length * 30 + 40)}px"><canvas id="scBars" aria-label="Średnia z przedmiotów"></canvas></div></section>
      <section class="panel"><div class="row"><h2>Oceny w czasie</h2>
        <select id="scChartSid" aria-label="Przedmiot">${withGrades.map(s => `<option value="${s.id}"${s.id === ui.chartSid ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        <p class="hint">Punkty to oceny, linia to średnia po każdej kolejnej ocenie.</p><div class="chart"><canvas id="scLine" aria-label="Oceny w czasie"></canvas></div></section>
      <div class="grid2">
        <section class="panel"><h2>Ile jakich ocen</h2><p class="hint">Wszystkie oceny z tego okresu.</p><div class="chart"><canvas id="scDist" aria-label="Rozkład ocen"></canvas></div></section>
        <section class="panel"><h2>Średnia końcowa w czasie</h2><p class="hint">Przewidywana średnia ocen końcowych po każdym dniu z nową oceną.</p><div class="chart"><canvas id="scTrend" aria-label="Średnia końcowa w czasie"></canvas></div></section>
      </div>`;
  }

  function testsView() {
    const T = today(), dis = canWrite() ? "" : "disabled";
    const up = S.tests.filter(t => !t.gid).sort((a, b) => (a.date < b.date ? -1 : 1));
    const done = S.tests.filter(t => t.gid).sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 10);
    const row = t => {
      const s = sub(t.sid), d = daysBetween(T, t.date), st = stats(subjectGrades(S, t.sid, range(schoolYearOf(t.date), termOf(t.date, S.settings.semEnd), S.settings.semEnd)), S.settings);
      const target = s.target || (st.grade ? Math.min(6, st.grade + 1) : 5), rq = required(st, target, t.w, S.settings);
      return `<li class="sc-test${d < 0 ? " past" : d <= 2 ? " soon" : ""}">
        <span class="sc-when"><b>${esc(fmtShort.format(parseDay(t.date)))}</b><small>${when(d)}</small></span>
        <span class="sc-tinfo"><b>${esc(s.name)}</b>${t.retake ? ` <span class="sc-retk">(poprawa)</span>` : ""} · ${esc(catName(t.cat))} (waga ${t.w})${t.topic ? `<br>${esc(t.topic)}` : ""}
          <br><span class="meta">na ${target}: ${rq.free ? `${target} już masz` : rq.possible ? `potrzebujesz co najmniej ${pctTxt(Math.ceil(rq.pct * 10) / 10)}` : (n => n ? `jeden wynik nie wystarczy (potrzeba ${n} takich na 100%)` : "jeden wynik nie wystarczy")(gradesNeeded(st, target, t.w, S.settings))}</span></span>
        <span class="sc-tbtns">${d <= 0 ? `<button type="button" class="btn primary" data-scact="result" data-tid="${t.id}" ${dis}>Wpisz wynik</button>` : ""}<button type="button" class="btn" data-scact="editTest" data-tid="${t.id}" ${dis}>Edytuj</button></span></li>`;
    };
    return `<section class="panel"><div class="row"><h2>Zapowiedziane</h2><button type="button" class="btn primary" data-scact="addTest" ${dis}>+ Zapowiedz</button></div>
        ${up.length ? `<ul class="sc-tests">${up.map(row).join("")}</ul>` : `<p class="meta">Nic nie jest zapowiedziane. Dodaj sprawdzian albo kartkówkę — zobaczysz, ile musisz dostać na wybraną ocenę.</p>`}</section>
      ${done.length ? `<section class="panel"><h2>Ostatnio wpisane</h2><ul class="sc-done">${done.map(t => { const x = gradeById(t.gid), gr = gradeOf(x.pct, S.settings.th);
        const shown = t.retake && x.retake != null ? x.retake : x.pct, g2 = gradeOf(shown, S.settings.th);
        return `<li><span class="sc-dot ${gcls(g2)}">${g2}</span> <b>${esc(sub(t.sid).name)}</b>${t.retake ? " (poprawa)" : ""} · ${esc(catName(t.cat))} ${esc(fmtShort.format(parseDay(t.date)))} · ${pctTxt(shown)}${t.topic ? ` · ${esc(t.topic)}` : ""}</li>`; }).join("")}</ul></section>` : ""}`;
  }

  function settingsView() {
    const st = S.settings, dis = canWrite() ? "" : "disabled";
    return `<details class="panel sc-set" id="scSet"${ui.setOpen ? " open" : ""}><summary><h2>Ustawienia szkoły</h2></summary>
      <div class="sc-field"><span class="k">Progi ocen (od ilu %)</span><div class="sc-ths">${[2, 3, 4, 5, 6].map((n, i) => `<label><span>${n}</span><input type="number" min="1" max="100" step="1" inputmode="numeric" value="${st.th[i]}" data-scset="th" data-i="${i}" ${dis}></label>`).join("")}</div></div>
      <div class="sc-field"><span class="k">Poprawa</span><span class="seg small" role="group" aria-label="Jak liczy się poprawa">${[["replace", "Zastępuje"], ["both", "Liczą się obie"], ["max", "Lepsza"]].map(([k, l]) => `<button type="button" class="seg-b" data-scact="rule" data-r="${k}" aria-pressed="${st.retake === k}" ${dis}>${l}</button>`).join("")}</span></div>
      <label class="sc-field"><span class="k">Koniec I półrocza</span><input type="date" value="${ui.y0 + 1}-${st.semEnd}" data-scset="semEnd" ${dis}></label>
      <label class="sc-field"><span class="k">Pasek od średniej</span><input type="number" min="1" max="6" step="0.01" inputmode="decimal" value="${st.pasek}" data-scset="pasek" ${dis}></label>
      <div class="sc-field"><span class="k">Domyślne wagi</span><div class="sc-cws">${CATS.map(c => `<label><span>${esc(c.name)}</span><input type="number" min="1" max="10" step="1" inputmode="numeric" value="${st.catW[c.id]}" data-scset="catW" data-c="${c.id}" ${dis}></label>`).join("")}</div></div>
      <div class="sc-field"><span class="k">Przedmioty</span><ul class="sc-subs">${S.subjects.map(s => { const n = S.grades.filter(x => x.sid === s.id).length;
        return `<li><input type="text" value="${esc(s.name)}" maxlength="60" data-scset="name" data-sid="${s.id}" aria-label="Nazwa przedmiotu" ${dis}>
          <button type="button" class="chip" data-scact="ext" data-sid="${s.id}" aria-pressed="${s.ext}" title="rozszerzony" ${dis}>R</button>
          <button type="button" class="chip" data-scact="counts" data-sid="${s.id}" aria-pressed="${s.counts}" title="liczy się do średniej" ${dis}>do średniej</button>
          <button type="button" class="icon-btn" data-scact="delSub" data-sid="${s.id}" aria-label="Usuń przedmiot ${esc(s.name)}" ${n || !canWrite() ? "disabled" : ""} title="${n ? "ma oceny — nie da się usunąć" : "usuń"}">×</button></li>`; }).join("")}</ul>
        <div class="sc-addsub"><input type="text" id="scNewSub" maxlength="60" placeholder="Nowy przedmiot" ${dis}><button type="button" class="btn" data-scact="addSub" ${dis}>Dodaj</button></div></div>
      <p class="note">Średnia z przedmiotu to średnia ważona wyników w %. Przewidywana ocena końcowa wychodzi z tych samych progów. Średnia ocen końcowych liczy przedmioty oznaczone „do średniej”. Pasek wymaga też zachowania co najmniej bardzo dobrego — tego aplikacja nie liczy.</p>
    </details>`;
  }

  /* ---------- the form (a sheet over the screen) ---------- */
  function renderSheet() {
    const el = $("scSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data, subjOpts = S.subjects.map(s => `<option value="${s.id}"${s.id === d.sid ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    const catChips = CATS.map(c => `<button type="button" class="chip" data-scform="cat" data-c="${c.id}" aria-pressed="${d.cat === c.id}">${esc(c.name)}</button>`).join("");
    const wChips = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<button type="button" class="chip" data-scform="w" data-n="${n}" aria-pressed="${d.w === n}">${n}</button>`).join("");
    let inner = "";
    if (sh.mode === "grade") {
      const gr = d.pct === "" || d.pct == null || isNaN(Number(String(d.pct).replace(",", "."))) ? null : gradeOf(Number(String(d.pct).replace(",", ".")), S.settings.th);
      inner = `<h2 id="scSheetTitle">${d.id ? "Edytuj ocenę" : "Nowa ocena"}</h2>
        <label class="sc-field"><span class="k">Przedmiot</span><select name="sid">${subjOpts}</select></label>
        <div class="sc-field"><span class="k">Wynik</span><span class="sc-pctrow"><input name="pct" type="text" inputmode="decimal" autocomplete="off" placeholder="np. 78" value="${esc(d.pct)}" aria-label="Wynik w procentach"><span>%</span>
          <output id="scPrev" class="sc-dot ${gcls(gr)}">${gr || "?"}</output><span class="meta" id="scPrevT">${gr ? GRADE_NAMES[gr] : ""}</span></span></div>
        <div class="sc-field"><span class="k">Rodzaj</span><div class="sc-cats">${catChips}</div></div>
        <div class="sc-field"><span class="k">Waga</span><div class="sc-ws">${wChips}</div></div>
        <label class="sc-field"><span class="k">Opis</span><input name="desc" type="text" maxlength="200" placeholder="np. Funkcja kwadratowa" value="${esc(d.desc)}"></label>
        <label class="sc-field"><span class="k">Data</span><input name="date" type="date" value="${esc(d.date)}" max="${esc(today())}"></label>`;
    } else if (sh.mode === "retakePick") {
      const t = S.tests.find(y => y.id === d.tid), list = S.grades.filter(g => g.sid === d.sid).sort((a, b) => (a.date < b.date ? 1 : -1));
      inner = `<h2 id="scSheetTitle">Wynik poprawy</h2><p class="meta">${esc(sub(d.sid).name)} · ${esc(catName(t ? t.cat : "spr"))}${t && t.topic ? ` · ${esc(t.topic)}` : ""}</p>
        <label class="sc-field"><span class="k">Którą ocenę poprawiasz?</span><select name="gid">${list.map(g => `<option value="${g.id}"${g.id === d.gid ? " selected" : ""}>${esc(catName(g.cat))} ${esc(fmtShort.format(parseDay(g.date)))} · ${pctTxt(g.pct)} → ${gradeOf(g.pct, S.settings.th)}${g.desc ? ` · ${esc(g.desc)}` : ""}</option>`).join("")}</select></label>
        <div class="sc-field"><span class="k">Wynik poprawy</span><span class="sc-pctrow"><input name="pct" type="text" inputmode="decimal" autocomplete="off" placeholder="np. 85" value="${esc(d.pct)}" aria-label="Wynik poprawy w procentach"><span>%</span></span></div>
        <p class="meta">Teraz: ${RETAKE_NAME[S.settings.retake]} (zmienisz w ustawieniach).</p>`;
    } else if (sh.mode === "retake") {
      const x = gradeById(d.gid);
      inner = `<h2 id="scSheetTitle">Poprawa</h2><p class="meta">${esc(sub(x.sid).name)} · ${esc(catName(x.cat))} · ${pctTxt(x.pct)} → ${gradeOf(x.pct, S.settings.th)}. Teraz: ${RETAKE_NAME[S.settings.retake]} (zmienisz w ustawieniach).</p>
        <div class="sc-field"><span class="k">Wynik poprawy</span><span class="sc-pctrow"><input name="pct" type="text" inputmode="decimal" autocomplete="off" placeholder="np. 85" value="${esc(d.pct)}" aria-label="Wynik poprawy w procentach"><span>%</span></span></div>`;
    } else {
      inner = `<h2 id="scSheetTitle">${d.id ? "Edytuj zapowiedź" : "Zapowiedz test"}</h2>
        <label class="sc-field"><span class="k">Przedmiot</span><select name="sid">${subjOpts}</select></label>
        <label class="sc-field"><span class="k">Kiedy</span><input name="date" type="date" value="${esc(d.date)}"></label>
        <div class="sc-field"><span class="k">Rodzaj</span><div class="sc-cats">${catChips}</div></div>
        <div class="sc-field"><span class="k">Waga</span><div class="sc-ws">${wChips}</div></div>
        <label class="sc-field"><span class="k">Temat</span><input name="topic" type="text" maxlength="200" placeholder="np. Dział 2: kinematyka" value="${esc(d.topic)}"></label>
        <div class="sc-field"><span class="k">Poprawa?</span><div class="sc-cats"><button type="button" class="chip" data-scform="retakeFlag" aria-pressed="${!!d.retake}">To poprawa</button></div></div>`;
    }
    const del = sh.mode === "grade" && d.id ? `<button type="button" class="btn danger" data-scform="delGrade">Usuń ocenę</button>`
      : sh.mode === "retake" && gradeById(d.gid).retake != null ? `<button type="button" class="btn danger" data-scform="delRetake">Usuń poprawę</button>`
      : sh.mode === "test" && d.id ? `<button type="button" class="btn danger" data-scform="delTest">Usuń</button>` : "";
    el.innerHTML = `<div class="sc-backdrop" data-scform="close"></div><form class="panel sc-form" id="scForm" role="dialog" aria-modal="true" aria-labelledby="scSheetTitle" novalidate>
      ${inner}<p class="sc-err" id="scErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-scform="close">Anuluj</button>${del}</div></form>`;
  }
  function openSheet(mode, data) { ui.sheet = { mode, data }; renderSheet(); const f = doc.querySelector('#scForm input[name="pct"], #scForm input[name="topic"]'); if (f && f.focus) try { f.focus(); } catch (e) {} }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function readForm() {
    const f = $("scForm"), d = ui.sheet.data, val = n => (f.querySelector(`[name="${n}"]`) || {}).value;
    if (f.querySelector('[name="sid"]')) d.sid = val("sid");
    if (f.querySelector('[name="pct"]')) d.pct = val("pct");
    if (f.querySelector('[name="desc"]')) d.desc = val("desc");
    if (f.querySelector('[name="date"]')) d.date = val("date");
    if (f.querySelector('[name="topic"]')) d.topic = val("topic");
    if (f.querySelector('select[name="gid"]')) d.gid = val("gid");
    return d;
  }
  const parsePct = v => { const n = Number(String(v == null ? "" : v).trim().replace(",", ".").replace("%", "")); return String(v).trim() !== "" && isFinite(n) && n >= 0 && n <= 100 ? r1(n) : null; };
  function submitSheet() {
    const sh = ui.sheet, d = readForm(), err = m => { const e = $("scErr"); if (e) e.textContent = m; };
    const next = exportState();
    if (sh.mode === "grade") {
      const pct = parsePct(d.pct);
      if (pct == null) return err("Wpisz wynik od 0 do 100%.");
      if (!DAY.test(d.date || "")) return err("Wybierz datę.");
      if (!sub(d.sid)) return err("Wybierz przedmiot.");
      const rec = { id: d.id || newId("g"), sid: d.sid, pct, w: d.w, cat: d.cat, desc: (d.desc || "").trim(), date: d.date, flag: null, plan: null, retake: null };
      const old = d.id && next.grades.find(x => x.id === d.id);
      if (old) Object.assign(old, { sid: rec.sid, pct: rec.pct, w: rec.w, cat: rec.cat, desc: rec.desc, date: rec.date });
      else next.grades.push(rec);
      if (d.tid) { const t = next.tests.find(x => x.id === d.tid); if (t) t.gid = rec.id; }
      const prev = exportState(); closeSheet();
      if (!old) { ui.gid = rec.id; if (!inRange(rec.date, curRange())) { ui.y0 = schoolYearOf(rec.date); ui.term = termOf(rec.date, S.settings.semEnd); } }
      save(next, `${old ? "Zapisano zmiany" : "Dodano ocenę"}: ${sub(rec.sid).name} — ${pctTxt(pct)} → ${gradeOf(pct, S.settings.th)}.`, prev);
    } else if (sh.mode === "retakePick") {
      const pct = parsePct(d.pct);
      if (pct == null) return err("Wpisz wynik poprawy od 0 do 100%.");
      const x = next.grades.find(y => y.id === d.gid); if (!x) return err("Wybierz ocenę, którą poprawiasz.");
      x.retake = pct;
      const t = next.tests.find(y => y.id === d.tid); if (t) t.gid = x.id;
      const prev = exportState(); closeSheet();
      save(next, `Zapisano poprawę: ${sub(x.sid).name} — ${pctTxt(pct)} → ${gradeOf(pct, S.settings.th)}.`, prev);
    } else if (sh.mode === "retake") {
      const pct = parsePct(d.pct);
      if (pct == null) return err("Wpisz wynik poprawy od 0 do 100%.");
      const x = next.grades.find(y => y.id === d.gid); x.retake = pct;
      const prev = exportState(); closeSheet();
      save(next, `Zapisano poprawę: ${pctTxt(pct)} → ${gradeOf(pct, S.settings.th)}.`, prev);
    } else {
      if (!DAY.test(d.date || "")) return err("Wybierz datę.");
      if (!sub(d.sid)) return err("Wybierz przedmiot.");
      const rec = { id: d.id || newId("t"), sid: d.sid, date: d.date, cat: d.cat, w: d.w, topic: (d.topic || "").trim(), gid: null, retake: !!d.retake };
      const old = d.id && next.tests.find(t => t.id === d.id);
      if (old) Object.assign(old, { sid: rec.sid, date: rec.date, cat: rec.cat, w: rec.w, topic: rec.topic, retake: rec.retake }); else next.tests.push(rec);
      const prev = exportState(); closeSheet();
      save(next, `${old ? "Zapisano zmiany" : "Zapowiedziano"}: ${sub(rec.sid).name}${rec.retake ? " (poprawa)" : ""} — ${catName(rec.cat).toLowerCase()} ${when(daysBetween(today(), rec.date))}.`, prev);
    }
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-scform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.scform, d = readForm();
    if (a === "close") closeSheet();
    else if (a === "cat") { d.cat = b.dataset.c; d.w = S.settings.catW[d.cat] || d.w; renderSheet(); }
    else if (a === "w") { d.w = +b.dataset.n; renderSheet(); }
    else if (a === "retakeFlag") { d.retake = !d.retake; renderSheet(); }
    else if (a === "delGrade") {
      const prev = exportState(), next = exportState(), x = next.grades.find(y => y.id === d.id);
      next.grades = next.grades.filter(y => y.id !== d.id); next.tests.forEach(t => { if (t.gid === d.id) t.gid = null; });
      closeSheet(); ui.gid = null;
      save(next, `Usunięto ocenę: ${sub(x.sid).name} — ${pctTxt(x.pct)}.`, prev);
    } else if (a === "delRetake") {
      const prev = exportState(), next = exportState(); next.grades.find(y => y.id === d.gid).retake = null;
      closeSheet(); save(next, "Usunięto poprawę.", prev);
    } else if (a === "delTest") {
      const prev = exportState(), next = exportState(); next.tests = next.tests.filter(t => t.id !== d.id);
      closeSheet(); save(next, "Usunięto zapowiedź.", prev);
    }
  }
  function onSheetInput(e) {
    if (!ui.sheet || ui.sheet.mode !== "grade" || e.target.name !== "pct") return;
    const v = parsePct(e.target.value), gr = v == null ? null : gradeOf(v, S.settings.th), o = $("scPrev"), t = $("scPrevT");
    if (o) { o.className = `sc-dot ${gcls(gr)}`; o.textContent = gr || "?"; }
    if (t) t.textContent = gr ? GRADE_NAMES[gr] : "";
  }

  /* ---------- events on the screen ---------- */
  function newGradeData(sid, extra) {
    const cat = "spr";
    return Object.assign({ id: null, sid: sid || ui.sid || S.subjects[0].id, pct: "", cat, w: S.settings.catW[cat], desc: "", date: today() }, extra || {});
  }
  function onClick(e) {
    const b = e.target.closest("[data-scact]"); if (!b || b.disabled) return;
    const a = b.dataset.scact;
    const setFlag = (gid, f) => {
      const prev = exportState(), next = exportState(), x = next.grades.find(y => y.id === gid);
      x.flag = x.flag === f ? null : f; if (x.flag !== "zle") x.plan = null;
      save(next, null, prev);
    };
    if (a === "chip") { ui.gid = ui.gid === b.dataset.gid ? null : b.dataset.gid; render(); const d = $("scGdet"); if (d && d.scrollIntoView) d.scrollIntoView({ block: "nearest" }); }
    else if (a === "openSub") { ui.sid = b.dataset.sid; ui.gid = null; render(); try { g.scrollTo({ top: 0 }); } catch (x) {} }
    else if (a === "back") { ui.sid = null; ui.gid = null; render(); }
    else if (a === "add") openSheet("grade", newGradeData(b.dataset.sid));
    else if (a === "edit") { const x = gradeById(b.dataset.gid); openSheet("grade", { id: x.id, sid: x.sid, pct: String(x.pct).replace(".", ","), cat: x.cat, w: x.w, desc: x.desc, date: x.date }); }
    else if (a === "retake") { const x = gradeById(b.dataset.gid); openSheet("retake", { gid: x.id, pct: x.retake == null ? "" : String(x.retake).replace(".", ",") }); }
    else if (a === "flag") setFlag(b.dataset.gid, b.dataset.f);
    else if (a === "term") { ui.term = b.dataset.t; ui.gid = null; render(); }
    else if (a === "yprev" || a === "ynext") { ui.y0 += a === "ynext" ? 1 : -1; ui.gid = null; render(); }
    else if (a === "tab") showTab(b.dataset.t);
    else if (a === "anf") { ui.anFilter = b.dataset.f; render(); }
    else if (a === "target") { const prev = exportState(), next = exportState(), s = next.subjects.find(x => x.id === ui.sid); s.target = +b.dataset.n; save(next, null, prev); }
    else if (a === "addTest") openSheet("test", { id: null, sid: ui.sid || S.subjects[0].id, date: addDays(today(), 7), cat: "spr", w: S.settings.catW.spr, topic: "" });
    else if (a === "editTest") { const t = S.tests.find(x => x.id === b.dataset.tid); openSheet("test", { id: t.id, sid: t.sid, date: t.date, cat: t.cat, w: t.w, topic: t.topic, retake: t.retake }); }
    else if (a === "result") {
      const t = S.tests.find(x => x.id === b.dataset.tid);
      // a retake: which grade it improves (the latest one of the same kind is picked first); otherwise a new grade
      const own = S.grades.filter(g => g.sid === t.sid).sort((a2, b2) => (a2.date < b2.date ? 1 : -1));
      if (t.retake && own.length) openSheet("retakePick", { tid: t.id, sid: t.sid, gid: (own.find(g => g.cat === t.cat && g.retake == null) || own[0]).id, pct: "" });
      else openSheet("grade", newGradeData(t.sid, { cat: t.cat, w: t.w, desc: t.topic, date: t.date <= today() ? t.date : today(), tid: t.id }));
    }
    else if (a === "rule") { ui.setOpen = true; const prev = exportState(), next = exportState(); next.settings.retake = b.dataset.r; save(next, `Poprawa: ${RETAKE_NAME[b.dataset.r]}.`, prev); }
    else if (a === "ext" || a === "counts") { ui.setOpen = true; const prev = exportState(), next = exportState(), s = next.subjects.find(x => x.id === b.dataset.sid); s[a] = !s[a]; save(next, null, prev); }
    else if (a === "delSub") { ui.setOpen = true; const prev = exportState(), next = exportState(), s = next.subjects.find(x => x.id === b.dataset.sid); next.subjects = next.subjects.filter(x => x.id !== s.id); next.tests = next.tests.filter(t => t.sid !== s.id); save(next, `Usunięto przedmiot: ${s.name}.`, prev); }
    else if (a === "addSub") {
      ui.setOpen = true; const inp = $("scNewSub"), name = (inp && inp.value || "").trim(); if (!name) return;
      const prev = exportState(), next = exportState(); let id = slug(name); while (next.subjects.some(s => s.id === id)) id += "-2";
      next.subjects.push({ id, name, ext: false, counts: true, target: null }); save(next, `Dodano przedmiot: ${name}.`, prev);
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === "scChartSid") { ui.chartSid = t.value; render(); return; }
    if (t.dataset.scplan) {
      const prev = exportState(), next = exportState(), x = next.grades.find(y => y.id === t.dataset.scplan); x.plan = r1(+t.value);
      save(next, null, prev); return;
    }
    const k = t.dataset.scset; if (!k) return;
    ui.setOpen = true;
    const prev = exportState(), next = exportState(), st = next.settings;
    if (k === "th") { const th = st.th.slice(); th[+t.dataset.i] = +t.value; if (th.every((x, i) => x >= 1 && x <= 100 && (i === 0 || x > th[i - 1]))) st.th = th; else { say().error("Progi muszą rosnąć", ["Każdy próg musi być większy od poprzedniego (od 1 do 100%)."]); render(); return; } }
    else if (k === "semEnd") { if (!DAY.test(t.value)) return; st.semEnd = t.value.slice(5); }
    else if (k === "pasek") { const v = Number(String(t.value).replace(",", ".")); if (!(v >= 1 && v <= 6)) { render(); return; } st.pasek = Math.round(v * 100) / 100; }
    else if (k === "catW") { const v = Math.round(+t.value); if (!(v >= 1 && v <= 10)) { render(); return; } st.catW[t.dataset.c] = v; }
    else if (k === "name") { const v = t.value.trim(); if (!v) { render(); return; } next.subjects.find(x => x.id === t.dataset.sid).name = v.slice(0, 60); }
    save(next, null, prev);
  }
  // the plan slider: the result line follows the finger; the plan is saved when the slider is let go (change)
  function onInput(e) {
    const t = e.target; if (!t.dataset.scplan) return;
    const x = gradeById(t.dataset.scplan), v = +t.value, list = subjectGrades(S, x.sid, curRange());
    const st = stats(list, S.settings), one = stats(list.map(y => (y.id === x.id ? Object.assign({}, y, { retake: v }) : y)), S.settings);
    const o = doc.querySelector(`[data-scout="${x.id}"]`), r = doc.querySelector(`[data-scres="${x.id}"]`);
    if (o) o.textContent = `${pctTxt(v)} → ${gradeOf(v, S.settings.th)}`;
    if (r) r.textContent = `średnia z przedmiotu: ${f1(st.avg)}% → ${f1(one.avg)}%, ocena ${st.grade} → ${one.grade}`;
  }
  function showTab(t) { ui.tab = t; ui.gid = null; if (t !== "przedmioty") ui.sid = null; render(); try { g.scrollTo({ top: 0 }); } catch (x) {} }

  /* ---------- charts (Chart.js, local copy) ---------- */
  const css = n => getComputedStyle(doc.documentElement).getPropertyValue(n).trim();
  // the grade limits as thin dashed lines with their grade (2..6), on the value axis
  const limitsPlugin = horizontal => ({ id: "scLimits", afterDatasetsDraw(c) {
    const ax = horizontal ? c.scales.x : c.scales.y, area = c.chartArea, ctx = c.ctx; if (!ax || !area) return;
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = css("--muted"); ctx.globalAlpha = .55; ctx.lineWidth = 1;
    ctx.fillStyle = css("--muted"); ctx.font = "11px " + (css("--f-body") || "sans-serif");
    S.settings.th.forEach((t, i) => {
      const p = ax.getPixelForValue(t);
      ctx.beginPath(); if (horizontal) { ctx.moveTo(p, area.top); ctx.lineTo(p, area.bottom); } else { ctx.moveTo(area.left, p); ctx.lineTo(area.right, p); } ctx.stroke();
      if (horizontal) ctx.fillText(String(i + 2), p - 3, area.top - 4); else ctx.fillText(String(i + 2), area.left + 4, p - 3);
    });
    ctx.restore(); } });
  function newChart(id, cfg) { const el = $(id); if (!el || !g.Chart) return null; const c = new g.Chart(el, cfg); charts.push(c); return c; }
  const baseOpts = () => ({ responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { displayColors: false } },
    scales: {} });
  function axis(o) { return Object.assign({ grid: { color: css("--line") }, ticks: { color: css("--muted") }, border: { color: css("--line") } }, o); }
  function lineFor(list) {
    let W = 0, sum = 0; const st = S.settings;
    return list.map(x => { for (const [p, w] of parts(x, st.retake, false)) { W += w; sum += p * w; } return r1(sum / W); });
  }
  function drawSubjectChart(R) { const s = sub(ui.sid); if (!s) return; drawLine("scSubChart", subjectGrades(S, s.id, R)); }
  function drawLine(id, list) {
    if (!list.length) return;
    const labels = list.map(x => fmtShort.format(parseDay(x.date)));
    const o = baseOpts();
    o.scales = { y: axis({ min: 0, max: 100, ticks: { color: css("--muted"), callback: v => v + "%" } }), x: axis({ grid: { display: false } }) };
    o.plugins.legend = { display: true, labels: { color: css("--muted"), usePointStyle: true, boxWidth: 10 } };
    o.plugins.tooltip.callbacks = { label: c => c.datasetIndex === 0 ? `${list[c.dataIndex].desc || catName(list[c.dataIndex].cat)}: ${pctTxt(c.parsed.y)} (waga ${list[c.dataIndex].w})` : `średnia: ${f1(c.parsed.y)}%` };
    newChart(id, { type: "line", data: { labels, datasets: [
      { label: "Oceny (%)", data: list.map(x => x.pct), showLine: false, pointRadius: 5, pointHoverRadius: 7, backgroundColor: css("--accent"), borderColor: css("--accent"), pointBackgroundColor: css("--accent"), pointBorderColor: css("--surface"), pointBorderWidth: 2, pointStyle: "circle" },
      { label: "Średnia", data: lineFor(list), borderColor: css("--trend"), backgroundColor: css("--trend"), borderWidth: 2, pointRadius: 0, pointStyle: "line", tension: 0 }] }, options: o, plugins: [limitsPlugin(false)] });
  }
  function drawCharts(R) {
    const O = overview(S, R), rows = O.rows.filter(r => r.st.avg != null).sort((a, b) => b.st.avg - a.st.avg);
    if (!rows.length) return;
    const ob = baseOpts(); ob.indexAxis = "y"; ob.layout = { padding: { top: 14 } };
    ob.scales = { x: axis({ min: 0, max: 100, ticks: { color: css("--muted"), callback: v => v + "%" } }), y: axis({ grid: { display: false } }) };
    ob.plugins.tooltip.callbacks = { label: c => `${f1(c.parsed.x)}% → ${rows[c.dataIndex].st.grade} (${GRADE_NAMES[rows[c.dataIndex].st.grade]})` };
    newChart("scBars", { type: "bar", data: { labels: rows.map(r => r.s.name), datasets: [{ data: rows.map(r => r1(r.st.avg)), backgroundColor: css("--accent"), borderRadius: 4, barPercentage: .7, categoryPercentage: .9 }] }, options: ob, plugins: [limitsPlugin(true)] });
    drawLine("scLine", subjectGrades(S, ui.chartSid, R));
    const counts = [1, 2, 3, 4, 5, 6].map(n => S.grades.filter(x => inRange(x.date, R) && gradeOf(x.pct, S.settings.th) === n).length);
    const od = baseOpts(); od.scales = { y: axis({ beginAtZero: true, ticks: { color: css("--muted"), precision: 0 } }), x: axis({ grid: { display: false } }) };
    od.plugins.tooltip.callbacks = { title: c => `${c[0].label} — ${GRADE_NAMES[+c[0].label]}`, label: c => `${c.parsed.y} ${plural(c.parsed.y, "ocena", "oceny", "ocen")}` };
    newChart("scDist", { type: "bar", data: { labels: ["1", "2", "3", "4", "5", "6"], datasets: [{ data: counts, backgroundColor: css("--accent"), borderRadius: 4 }] }, options: od });
    const tr = trend(S, R).filter(p => p.avg != null);
    const ot = baseOpts(); ot.scales = { y: axis({ suggestedMin: 1, suggestedMax: 6, ticks: { color: css("--muted") } }), x: axis({ grid: { display: false } }) };
    ot.plugins.tooltip.callbacks = { label: c => `średnia końcowa: ${f2(c.parsed.y)}` };
    newChart("scTrend", { type: "line", data: { labels: tr.map(p => fmtShort.format(parseDay(p.date))), datasets: [{ data: tr.map(p => p.avg), borderColor: css("--accent"), borderWidth: 2, pointRadius: 3, tension: 0 }] }, options: ot });
  }

  function mount() {
    const root = $("scRoot"); if (!root) return;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("input", onInput);
    // the hover box of a grade must stay on the screen: shift it left or right when the grade is near an edge
    root.addEventListener("mouseover", e => {
      const c = e.target.closest(".sc-chip"); if (!c) return;
      const tip = c.querySelector(".sc-tip"); if (!tip) return;
      tip.style.left = "50%"; tip.style.transform = "translateX(-50%)";
      const r = tip.getBoundingClientRect(), vw = doc.documentElement.clientWidth, m = 8;
      if (!r.width) return;
      const shift = r.left < m ? m - r.left : r.right > vw - m ? vw - m - r.right : 0;
      if (shift) tip.style.transform = `translateX(calc(-50% + ${Math.round(shift)}px))`;
    });
    root.addEventListener("toggle", e => { if (e.target.id === "scSet") ui.setOpen = e.target.open; }, true);
    for (const t of ["przedmioty", "analiza", "wykresy", "sprawdziany"]) { const b = $("sct-" + t); if (b) b.addEventListener("click", () => showTab(t)); }
    if ($("scAdd")) $("scAdd").addEventListener("click", () => { if (canWrite()) openSheet("grade", newGradeData()); });
    const sh = $("scSheet");
    if (sh) {
      sh.addEventListener("click", onSheetClick);
      sh.addEventListener("input", onSheetInput);
      sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); });
      doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
    }
  }
  // the calendar (Dziś) adds and changes announced tests through these: the same list as "Sprawdziany"
  function saveTest(t) {
    if (!canWrite() || !t || !sub(t.sid) || !DAY.test(t.date || "")) return false;
    const prev = exportState(), next = exportState(), cat = CATS.some(c => c.id === t.cat) ? t.cat : "spr";
    const old = t.id && next.tests.find(x => x.id === t.id);
    const rec = { id: (old && old.id) || newId("t"), sid: t.sid, date: t.date, cat, w: old && old.cat === cat ? old.w : S.settings.catW[cat], topic: str(t.topic, 200), gid: old ? old.gid : null, retake: t.retake === true };
    if (old) Object.assign(old, rec); else next.tests.push(rec);
    return save(next, `${old ? "Zapisano" : "Dodano test"}: ${catName(cat)} — ${sub(t.sid).name}${rec.retake ? " (poprawa)" : ""}, ${fmtShort.format(parseDay(t.date))}.`, prev);
  }
  function deleteTest(id) {
    const t = S.tests.find(x => x.id === id); if (!t || !canWrite()) return false;
    const prev = exportState(), next = exportState(); next.tests = next.tests.filter(x => x.id !== id);
    return save(next, `Usunięto test: ${catName(t.cat)} — ${sub(t.sid) ? sub(t.sid).name : ""}.`, prev);
  }
  // tests only: a fixed "now"
  function setClock(fn) { now = fn || (() => new Date()); ui.y0 = null; ui.term = null; }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, showTab, ui, saveTest, deleteTest, canWrite });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmSchool = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
