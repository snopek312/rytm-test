// Rytm: Pływanie → Analiza (27.10.2026). The coach's grade and comments (swimcoach.js) over all the numbers (swimstats.js):
// attendance, heart-rate zones (with the maximum heart rate typed in), CSS (tests typed in, or estimated from the files) and its
// pace zones, the weekly load, technique per stroke, repeated sets, goals for races and World Aquatics points.
// In Treningi each workout gets its own comments, zones, technique and sets (trainingBlock).
// The comments are written in both languages and shown in the one chosen in Ustawienia (no translation needed: translate="no").
// Saved part "swim" (one record in meta, see swimstats.js). A message comes only after the store confirmed the save.
(function (g) {
  "use strict";
  const ST = g.RytmSwimStats, CO = g.RytmSwimCoach, doc = g.document;
  const $ = id => doc.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const U = () => g.RytmUnits || { yd: false, u: () => "m", d: m => m, pace: s => s, eff: e => e };
  const L = () => (g.RytmI18n && g.RytmI18n.lang === "en" ? 1 : 0);
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const fmtPace = s => { if (s == null || !isFinite(s)) return "–"; const r = Math.round(s); return Math.floor(r / 60) + ":" + String(r % 60).padStart(2, "0"); };
  const fmtT = s => { if (s == null || !isFinite(s)) return "–"; const c = Math.round(s * 100), m = Math.floor(c / 6000), x = (c % 6000) / 100; return (m ? m + ":" + (x < 10 ? "0" : "") : "") + x.toFixed(2).replace(".", ","); };
  const dayFmt = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
  const dayTxt = k => dayFmt.format(ST.parseDay(k));
  const STROKE_INST = { free: "kraulem", back: "grzbietem", breast: "żabką", fly: "motylkiem", im: "zmiennym" };
  const STROKE_NOM = { free: "Kraul", back: "Grzbiet", breast: "Żabka", fly: "Motyl", im: "Zmienny" };
  const STROKE_VAR = { free: "--h0", breast: "--h1", back: "--h2", fly: "--h5" };
  const GOAL_DISTS = { free: [50, 100, 200, 400, 800, 1500], back: [50, 100, 200], breast: [50, 100, 200], fly: [50, 100, 200], im: [100, 200, 400] };
  const ZCOL = ["var(--muted)", "var(--h0)", "var(--h2)", "var(--h3)", "var(--bad)"];

  let S = ST.defaults(), P = null, now = () => new Date();
  const ui = { lvl: "all", all: false, tech: "free", trAll: null, err: {} };
  const today = () => ST.dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function attach(persist) { P = persist || null; S = ST.normalize(P && P.load ? P.load() : null); cache = null; render(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  function save(next, okText, undoTo) {
    if (!P || !P.save) return false;
    const prev = S;
    S = ST.normalize(next); cache = null;
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { S = ST.normalize(P.load ? P.load() : prev); cache = null; render(); return false; }
    render(); if (P.onChange) try { P.onChange(); } catch (e) {}
    if (okText && P.whenSaved) P.whenSaved(res, () => say().info(okText, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
    return true;
  }
  function setClock(fn) { now = fn || (() => new Date()); cache = null; }

  /* ---------- everything the comments need, from the other sections (cached until something changes) ---------- */
  let cache = null;
  function inputs() {
    const list = (P && P.trainings ? P.trainings() : []) || [], T = today(), units = U();
    const att = P && P.attendance ? P.attendance() : null, sleep = P && P.sleep ? P.sleep() : null;
    const sig = [list.length, list.length ? list[list.length - 1].id : "", T, units.u(), JSON.stringify(S), JSON.stringify(att), sleep ? sleep.nights.length + "|" + sleep.hours : "", P && P.sig ? P.sig() : ""].join("§");
    if (cache && cache.sig === sig && cache.list === list) return cache.D;
    const acts = {}; for (const t of list) if (t.fit) acts[t.fit.id] = t.fit;
    const bad = P && P.bad ? P.bad() || {} : {};
    let recs = {}; try { recs = P && P.records ? P.records(acts, bad) : g.Swim.computeRecords(acts, bad); } catch (e) { recs = {}; }
    const hrAuto = ST.hrMaxAuto(list), hrMax = S.hrMax || hrAuto;
    const D = { today: T, trainings: list, acts, bad, recs, att, swim: S, hrMax, hrMaxAuto: hrAuto, hrMaxFrom: S.hrMax ? "set" : hrAuto ? "auto" : null,
      css: ST.cssNow(S, acts, bad, T), sleep: sleep && sleep.nights && sleep.nights.length ? { nights: sleep.nights, hours: sleep.hours || 8 } : null,
      exams: P && P.exams ? P.exams() || [] : [], units };
    D.result = CO.analyse(D);
    cache = { sig, list, D };
    return D;
  }

  /* ---------- pieces ---------- */
  const li = (c, l) => `<li class="an-c ${c.lvl}"><span class="an-lv">${esc(CO.LEVEL[c.lvl][l])}</span><span class="an-tx">${esc(c[l ? "en" : "pl"])}</span><span class="an-ar">${esc(CO.AREA[c.area] ? CO.AREA[c.area][l] : c.area)}</span></li>`;
  const listHtml = (cs, l) => `<ul class="an-list" translate="no">${cs.map(c => li(c, l)).join("")}</ul>`;
  const tiles = arr => `<div class="h-stats an-tiles">${arr.map(([k, v, m]) => `<div><span class="k">${esc(k)}</span><span class="v">${v}</span><span class="meta">${esc(m || "")}</span></div>`).join("")}</div>`;
  function hbar(parts, label) {
    const tot = parts.reduce((a, p) => a + p.v, 0) || 1;
    return `<div class="an-hbar" role="img" aria-label="${esc(label)}">${parts.map(p => p.v > 0 ? `<i style="width:${(p.v / tot * 100).toFixed(1)}%;background:${p.c}" title="${esc(p.t)}"></i>` : "").join("")}</div>`;
  }

  function gradePanel(D) {
    const R = D.result, G = R.grade, l = L();
    if (!R.comments.length) return `<section class="panel"><h2>Analiza</h2><p class="meta">Dodaj treningi z Garmina (lista CSV i pliki FIT) — wtedy zobaczysz ocenę i komentarze.</p></section>`;
    const PART = { att: "Frekwencja", prog: "Postęp", vol: "Objętość", rec: "Rekordy", reg: "Regularność", tech: "Technika" };
    const W = { att: 35, prog: 20, vol: 15, rec: 15, reg: 10, tech: 5 };
    return `<section class="panel an-grade">
      <div class="an-head">${G ? `<div class="an-mark g${G.value}" translate="no"><b>${G.value}${G.sign}</b><small>${esc(G.word[l])}</small></div>` : ""}
        <div><h2>Ocena trenera</h2>
          ${G ? `<p class="meta"><span>Wynik: ${G.score}/100.</span> <span>Najwięcej waży frekwencja.</span></p>` : `<p class="meta">Za mało danych na ocenę.</p>`}
          <div class="an-counts">${["zle", "slabo", "popraw", "dobrze"].map(k => `<span class="an-n ${k}">${esc(CO.LEVEL[k][0])}: <b>${R.counts[k]}</b></span>`).join("")}</div></div></div>
      ${G ? `<div class="an-parts">${Object.entries(G.parts).map(([k, v]) => `<div class="an-part"><span>${PART[k]} <small>(${W[k]}%)</small></span><span class="an-pbar"><i style="width:${v}%" class="${v < 40 ? "lo" : v < 70 ? "mid" : "hi"}"></i></span><b>${v}</b></div>`).join("")}</div>` : ""}
      ${R.weak.length ? `<h3>Najsłabsze punkty</h3>${listHtml(R.weak, l)}` : ""}
    </section>`;
  }
  function commentsPanel(D) {
    const R = D.result, l = L(); if (!R.comments.length) return "";
    const pool = ui.lvl === "all" ? R.comments : R.comments.filter(c => c.lvl === ui.lvl), shown = ui.all ? pool : pool.slice(0, 12);
    const chip = (k, name, n) => `<button type="button" class="chip" data-anact="lvl" data-v="${k}" aria-pressed="${ui.lvl === k}">${name} (${n})</button>`;
    return `<section class="panel an-comments"><h2>Komentarze</h2>
      <p class="meta">Liczone z twoich danych za każdym razem od nowa — zmienia się nawet przy małej zmianie wyników. Ostre na start: „Dobrze” tylko za naprawdę dobre liczby.</p>
      <div class="an-filter">${chip("all", "Wszystkie", R.comments.length)}${chip("zle", "Źle", R.counts.zle)}${chip("slabo", "Słabo", R.counts.slabo)}${chip("popraw", "Do poprawy", R.counts.popraw)}${chip("dobrze", "Dobrze", R.counts.dobrze)}</div>
      ${shown.length ? listHtml(shown, l) : `<p class="meta">Brak komentarzy na tym poziomie.</p>`}
      ${pool.length > 12 ? `<div class="actions"><button type="button" class="btn link" data-anact="all">${ui.all ? "Pokaż mniej" : `Pokaż wszystkie (${pool.length})`}</button></div>` : ""}
    </section>`;
  }
  function attendancePanel(D) {
    const A = D.att; if (!A) return "";
    const s = A.season, per = s.kind === "wakacje" ? "wakacje" : "rok szkolny";
    const t = [["Ten okres", s.pct == null ? "–" : `${s.pct}<small>%</small>`, `${s.present} z ${s.planned} · ${per}`],
      ["Ten miesiąc", A.month.pct == null ? "–" : `${A.month.pct}<small>%</small>`, `${A.month.present} z ${A.month.planned}`],
      ["Ostatnie 14 dni", A.last14.pct == null ? "–" : `${A.last14.pct}<small>%</small>`, `${A.last14.absent} ${plural(A.last14.absent, "nieobecność", "nieobecności", "nieobecności")}`],
      ["Seria", String(A.streak), `${plural(A.streak, "trening", "treningi", "treningów")} z rzędu`]];
    let goal = "";
    if (s.planned && A.remaining != null) {
      const need = Math.ceil(0.9 * (s.planned + A.remaining)) - s.present, allowed = A.remaining - need, max = Math.round(100 * (s.present + A.remaining) / (s.planned + A.remaining));
      goal = allowed < 0 ? `<p class="an-goal bad"><span>90% na koniec okresu już się nie da.</span> <span>Najwyżej ${max}%, jeśli nie opuścisz już nic.</span></p>`
        : `<p class="an-goal"><span>Do 90% na koniec okresu: ${plural(A.remaining, "został", "zostały", "zostało")} ${A.remaining} ${plural(A.remaining, "trening", "treningi", "treningów")}.</span> <span>Możesz opuścić najwyżej ${allowed}.</span></p>`;
    }
    const DOW = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"], days = Object.entries(A.byDow || {}).sort((a, b) => a[0] - b[0]);
    return `<section class="panel"><div class="row"><h2>Frekwencja</h2><button type="button" class="btn link" data-anact="goAtt">Kalendarz ›</button></div>
      ${tiles(t)}${goal}
      ${days.length ? `<div class="tablewrap"><table class="an-dow"><thead><tr><th>Dzień</th><th>Treningi</th><th>Opuszczone</th><th></th></tr></thead><tbody>${days.map(([w, b]) => `<tr><th scope="row">${DOW[w - 1]}</th><td class="num">${b.planned}</td><td class="num${b.absent / b.planned >= 0.4 ? " bad" : ""}">${b.absent}</td><td class="an-cell">${hbar([{ v: b.planned - b.absent, c: "var(--good)", t: "obecny" }, { v: b.absent, c: "var(--bad)", t: "nieobecny" }], "obecności i nieobecności")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </section>`;
  }
  function zonesPanel(D) {
    const dis = canWrite() ? "" : "disabled", hm = D.hrMax, Z = hm ? ST.zonesOver(D.trainings, hm, ST.addDays(D.today, -27), D.today) : null;
    const rows = ST.HR_ZONES.map((z, i) => { const lo = Math.round(z.lo * hm), hi = Math.round(z.hi * hm) - 1; return { z, i, range: !hm ? "–" : i === 0 ? `< ${Math.round(0.6 * hm)}` : i === 4 ? `≥ ${lo}` : `${lo}–${hi}` }; });
    return `<section class="panel"><h2>Strefy tętna</h2>
      <form class="an-form an-hr" data-anform="hr" novalidate><label class="sc-field"><span class="k">Tętno maksymalne (ud./min)</span><input name="hr" type="text" inputmode="numeric" maxlength="3" placeholder="${D.hrMaxAuto || "np. 200"}" value="${S.hrMax || ""}" ${dis}></label><button type="submit" class="btn" ${dis}>Zapisz</button>${S.hrMax ? `<button type="button" class="btn link" data-anact="hrAuto" ${dis}>Bierz z danych</button>` : ""}</form>
      <p class="sc-err" role="alert">${esc(ui.err.hr || "")}</p>
      <p class="meta">${S.hrMax ? `<span>Wpisane: ${S.hrMax} ud./min.</span>` : D.hrMaxAuto ? `<span>Z danych: ${D.hrMaxAuto} ud./min (najwyższe z treningów).</span> <span>Najlepiej wpisz wynik z testu.</span>` : `<span>Brak tętna w danych — wpisz je sam.</span>`}</p>
      ${Z ? `${hbar(Z.secs.map((v, i) => ({ v, c: ZCOL[i], t: ST.HR_ZONES[i].name })), "Czas w strefach tętna")}
        <div class="tablewrap"><table class="an-zt"><thead><tr><th>Strefa</th><th>Tętno</th><th>Czas (4 tyg.)</th></tr></thead><tbody>
        ${rows.map(r => `<tr><th scope="row"><i class="an-sw" style="background:${ZCOL[r.i]}"></i>${esc(r.z.name)}</th><td class="num">${r.range}</td><td class="num">${Math.round(Z.secs[r.i] / 60)} min <small>${Math.round(Z.share[r.i] * 100)}%</small></td></tr>`).join("")}
        </tbody></table></div><p class="meta">Z ${Z.n} ${plural(Z.n, "treningu", "treningów", "treningów")} z plikiem FIT w ostatnich 4 tygodniach.</p>` : hm ? `<p class="meta">W ostatnich 4 tygodniach nie ma treningów z zapisem tętna (pliki FIT).</p>` : ""}
    </section>`;
  }
  function cssPanel(D) {
    const dis = canWrite() ? "" : "disabled", C = D.css, u = U().u();
    const zones = C ? ST.PACE_ZONES.map((z, i) => { const c = C.css, r = [[c + 12, null], [c + 6, c + 12], [c + 2, c + 6], [c - 2, c + 2], [null, c - 2]][i];
      const f = x => fmtPace(U().pace(x)); return `<tr><th scope="row">${i + 1}. ${esc(z.name)}</th><td class="num">${r[1] == null ? `wolniej niż ${f(r[0])}` : r[0] == null ? `szybciej niż ${f(r[1])}` : `${f(r[0])}–${f(r[1])}`}</td></tr>`; }).join("") : "";
    const tests = S.css.slice().reverse();
    return `<section class="panel"><h2>CSS — tempo progowe</h2>
      <p class="meta">CSS (Critical Swim Speed) = (czas 400 m − czas 200 m) ÷ 2. To tempo, które utrzymasz długo na granicy zmęczenia.</p>
      ${C ? `<p class="an-big"><b>${fmtPace(U().pace(C.css))}</b> /100 ${u} <span class="meta">${C.from === "test" ? `test z ${dayTxt(C.date)}` : `szacunek z treningów`}</span></p>
        ${C.from === "estimate" ? `<p class="meta"><span>Najszybsze 400 m kraulem bez przerwy: ${fmtT(C.est.t400.time)} (${dayTxt(C.est.t400.date)}).</span> <span>200 m: ${fmtT(C.est.t200.time)} (${dayTxt(C.est.t200.date)}).</span> <span>Prawdziwy test da dokładniejszy wynik.</span></p>` : ""}
        <div class="tablewrap"><table class="an-zt"><thead><tr><th>Strefa tempa</th><th>Tempo /100 ${u}</th></tr></thead><tbody>${zones}</tbody></table></div>`
        : `<p class="meta">Nie ma jeszcze CSS: wpisz test albo dodaj pliki FIT z ciągłym 400 m i 200 m kraulem.</p>`}
      <h3>Dodaj test</h3><p class="hint">Rozgrzewka, 400 m kraulem na maksa, 5–10 min spokojnie, 200 m na maksa. Czasy wpisz np. 5:20,4 i 2:28,9 (basen 25 m lub 50 m).</p>
      <form class="an-form an-css" data-anform="css" novalidate>
        <label class="sc-field"><span class="k">Dzień</span><input name="date" type="date" value="${today()}" ${dis}></label>
        <label class="sc-field"><span class="k">400 m</span><input name="t400" type="text" inputmode="decimal" maxlength="9" placeholder="5:20,4" ${dis}></label>
        <label class="sc-field"><span class="k">200 m</span><input name="t200" type="text" inputmode="decimal" maxlength="9" placeholder="2:28,9" ${dis}></label>
        <button type="submit" class="btn primary" ${dis}>Dodaj test</button></form>
      <p class="sc-err" role="alert">${esc(ui.err.css || "")}</p>
      ${tests.length ? `<div class="tablewrap"><table class="an-tests"><thead><tr><th>Dzień</th><th>400 m</th><th>200 m</th><th>CSS /100 m</th><th></th></tr></thead><tbody>
        ${tests.map(x => `<tr><td>${dayTxt(x.date)}</td><td class="num">${fmtT(x.t400)}</td><td class="num">${fmtT(x.t200)}</td><td class="num"><b>${fmtPace(ST.cssOf(x.t400, x.t200))}</b></td><td><button type="button" class="icon-btn" data-anact="delCss" data-id="${esc(x.id)}" aria-label="Usuń test z ${dayTxt(x.date)}" ${dis}>×</button></td></tr>`).join("")}
        </tbody></table></div>` : ""}
    </section>`;
  }
  function loadPanel(D) {
    const Ls = ST.loadStats(D.trainings, D.hrMax, D.today); if (!Ls.days) return "";
    const max = Math.max(1, ...Ls.weeks.map(w => w.pts)), W = 320, H = 130, bw = 30, gap = (W - 8 * bw) / 9;
    const bars = Ls.weeks.map((w, i) => { const h = Math.round(w.pts / max * 84), x = Math.round(gap + i * (bw + gap)), cur = i === 7;
      return `<rect x="${x}" y="${100 - h}" width="${bw}" height="${h}" rx="3" class="${cur ? "cur" : ""}"></rect><text x="${x + bw / 2}" y="${95 - h}" class="v">${w.pts}</text><text x="${x + bw / 2}" y="116" class="d">${esc(dayTxt(w.from))}</text>`; }).join("");
    const r = Ls.ratio, warn = r == null ? "" : r > 1.5 ? "bad" : r > 1.3 ? "warn" : r < 0.8 ? "warn" : "ok";
    return `<section class="panel"><h2>Obciążenie</h2>
      <p class="meta">Punkty = minuty w strefach tętna × 1–5 (bez tętna: minuty × 2). Tygodnie od poniedziałku.</p>
      <svg class="an-load" viewBox="0 0 ${W} ${H}" role="img" aria-label="Obciążenie w ostatnich 8 tygodniach">${bars}</svg>
      ${tiles([["Ostatnie 7 dni", String(Ls.acute), "pkt"], ["Średnio na tydzień", String(Ls.chronic), "pkt (4 tygodnie)"], ["Stosunek", r == null ? "–" : r.toFixed(2).replace(".", ","), "7 dni do średniej"],
        ["Ocena", r == null ? "–" : r > 1.5 ? "skok" : r > 1.3 ? "wysoko" : r < 0.8 ? "mało" : "równo", "0,8–1,3 = bezpiecznie"]])}
      ${warn === "bad" ? `<p class="an-goal bad">Obciążenie skoczyło ponad 1,5 × zwykłego tygodnia — ryzyko przeciążenia barków.</p>` : ""}
    </section>`;
  }
  function techPanel(D) {
    const st = ui.tech, rows = [];
    for (const s of ["free", "back", "breast", "fly"]) {
      const ser = ST.techSeries(D.trainings, D.bad, s); if (!ser.length) continue;
      const k = Math.min(5, Math.max(1, Math.floor(ser.length / 2))), b = ser.slice(-k), a = ser.length >= 2 * k ? ser.slice(-2 * k, -k) : null;
      const m = (arr, key) => ST.mean(arr.map(x => x[key]));
      rows.push({ s, n: ser.length, rate: m(b, "rate"), dps: m(b, "dps"), swolf: m(b, "swolf"), d: a ? { rate: m(b, "rate") - m(a, "rate"), dps: m(b, "dps") - m(a, "dps"), swolf: m(b, "swolf") - m(a, "swolf") } : null });
    }
    if (!rows.length) return `<section class="panel"><h2>Technika</h2><p class="meta">Technikę widać z plików FIT (ruchy na każdej długości). Potrzeba co najmniej 4 długości jednym stylem na treningu.</p></section>`;
    const u = U().u(), ch = (v, good, d = 1) => v == null ? "" : `<small class="d ${Math.abs(v) < Math.pow(10, -d) ? "flat" : (v > 0) === good ? "up" : "down"}">${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d).replace(".", ",")}</small>`;
    const ser = ST.techSeries(D.trainings, D.bad, st).slice(-20);
    let svg = "";
    if (ser.length >= 2) {
      const W = 320, H = 120, ys = ser.map(x => U().d(x.dps)), lo = Math.min(...ys), hi = Math.max(...ys), sp = hi - lo || 0.1;
      const X = i => 14 + i * (W - 58) / (ser.length - 1), Y = v => 96 - (v - lo) / sp * 76;
      svg = `<svg class="an-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dystans na ruch na kolejnych treningach"><polyline points="${ys.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}" style="stroke:var(${STROKE_VAR[st]})"></polyline>
        ${ys.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" style="fill:var(${STROKE_VAR[st]})"></circle>`).join("")}
        <text x="14" y="114" class="d">${esc(dayTxt(ser[0].date))}</text><text x="${W - 44}" y="114" class="d end">${esc(dayTxt(ser[ser.length - 1].date))}</text>
        <text x="${W - 4}" y="${Y(hi) + 4}" class="v end">${hi.toFixed(2).replace(".", ",")}</text><text x="${W - 4}" y="${Y(lo) + 4}" class="v end">${lo.toFixed(2).replace(".", ",")}</text></svg>`;
    }
    return `<section class="panel"><h2>Technika</h2>
      <p class="meta">Średnia z ostatnich 5 treningów i zmiana wobec 5 wcześniejszych. Więcej ${u} na ruch i niższy SWOLF (na 25 ${u}) = lepiej.</p>
      <div class="tablewrap"><table class="an-tech"><thead><tr><th>Styl</th><th>Ruchy/min</th><th>${u}/ruch</th><th>SWOLF</th></tr></thead><tbody>
      ${rows.map(r => `<tr><th scope="row"><i class="tr-dot" style="background:var(${STROKE_VAR[r.s]})"></i>${STROKE_NOM[r.s]}</th><td class="num">${r.rate.toFixed(1).replace(".", ",")}${r.d ? ch(r.d.rate, false) : ""}</td><td class="num">${U().d(r.dps).toFixed(2).replace(".", ",")}${r.d ? ch(U().d(r.d.dps), true, 2) : ""}</td><td class="num">${r.swolf.toFixed(1).replace(".", ",")}${r.d ? ch(r.d.swolf, false) : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="seg small an-seg" role="group" aria-label="Styl na wykresie">${rows.map(r => `<button type="button" class="seg-b" data-anact="tech" data-v="${r.s}" aria-pressed="${st === r.s}">${STROKE_NOM[r.s]}</button>`).join("")}</div>
      ${svg ? `<p class="meta">${u} na ruch — ${STROKE_NOM[st].toLowerCase()}, kolejne treningi</p>${svg}` : `<p class="meta">Za mało treningów tym stylem na wykres.</p>`}
    </section>`;
  }
  const setName = x => `${x.reps} × ${Math.round(U().d(x.dist))} ${U().u()} ${STROKE_INST[x.stroke]}`;
  function setsTable(list, withDate) {
    const u = U().u(), sg = v => (v > 0 ? "+" : v < 0 ? "−" : "±");
    return `<ul class="an-setl">${list.map(x => { const d = x.prev ? U().pace(x.avg - x.prev.avg) : null, drop = x.drop * 100;
      return `<li><div class="an-sn"><b>${esc(setName(x))}</b><small>${withDate ? esc(dayTxt(x.date)) : ""}${withDate && x.rest != null ? " · " : ""}${x.rest != null ? `przerwy ${Math.round(x.rest)} s` : ""}</small></div>
        <div class="an-sv"><span><small>Średnio /100 ${u}</small><b>${fmtPace(U().pace(x.avg))}</b></span><span><small>Od – do</small><b>${fmtPace(U().pace(x.best))}–${fmtPace(U().pace(x.worst))}</b></span>
        <span><small>Koniec</small><b class="d ${drop > 3 ? "down" : drop < -1 ? "up" : "flat"}">${sg(drop)}${Math.abs(drop).toFixed(1).replace(".", ",")}%</b></span>
        <span><small>Wobec poprzednio</small><b class="${d == null ? "" : `d ${d < -0.3 ? "up" : d > 0.3 ? "down" : "flat"}`}">${d == null ? "–" : `${sg(d)}${Math.abs(d).toFixed(1).replace(".", ",")} s`}</b></span></div></li>`; }).join("")}</ul>`;
  }
  function setsPanel(D) {
    const H = ST.setHistory(D.trainings).slice(-6).reverse();
    return `<section class="panel"><h2>Serie</h2>
      <p class="meta">Te same odcinki (dystans i styl) co najmniej 3 razy z przerwami, np. 8 × 100 m. „Koniec”: o ile wolniejsza była ostatnia część serii niż pierwsza. „Wobec poprzednio”: ta sama seria ostatnim razem.</p>
      ${H.length ? setsTable(H, true) : `<p class="meta">Nie widzę jeszcze powtarzanych serii w plikach FIT.</p>`}
    </section>`;
  }
  function goalsPanel(D) {
    const dis = canWrite() ? "" : "disabled", key = (p, s, d) => g.Swim.recKey(p, s, d);
    const goals = S.goals.map(x => { const r = D.recs[key(x.pool, x.stroke, x.dist)]; return { x, r, gap: r ? r.time - x.time : null }; });
    const pts = ST.recordPoints(D.recs).slice(0, 10);
    const f = ui.goal || { stroke: "free", dist: 100, pool: 25 };
    return `<section class="panel"><h2>Cele na zawody</h2>
      ${goals.length ? `<ul class="an-goals">${goals.map(({ x, r, gap }) => `<li><div><b>${x.dist} m ${STROKE_INST[x.stroke]}</b> <span class="meta">(basen ${x.pool} m)</span> — cel <b>${fmtT(x.time)}</b>${x.by ? ` <span class="meta">do ${dayTxt(x.by)}</span>` : ""}${x.note ? ` <span class="meta">· ${esc(x.note)}</span>` : ""}
          <small>${r ? gap <= 0 ? `<span class="d up">Osiągnięty: rekord ${fmtT(r.time)}.</span>` : `<span>Rekord ${fmtT(r.time)}</span> · <span class="d down">brakuje ${gap < 60 ? fmtT(gap) + " s" : fmtT(gap)} (${(gap / x.time * 100).toFixed(1).replace(".", ",")}%)</span>${x.pool && ST.points(x.stroke, x.dist, x.pool, x.time) != null ? ` · <span>cel = ${ST.points(x.stroke, x.dist, x.pool, x.time)} pkt</span>` : ""}` : `<span>Brak wyniku na tym dystansie.</span>`}</small></div>
          <button type="button" class="icon-btn" data-anact="delGoal" data-id="${esc(x.id)}" aria-label="Usuń cel ${x.dist} m ${STROKE_INST[x.stroke]}" ${dis}>×</button></li>`).join("")}</ul>` : `<p class="meta">Wpisz czas, który chcesz osiągnąć (albo limit na zawody) — zobaczysz, ile brakuje.</p>`}
      <form class="an-form an-goalf" data-anform="goal" novalidate>
        <label class="sc-field"><span class="k">Styl</span><select name="stroke" ${dis}>${Object.keys(GOAL_DISTS).map(s => `<option value="${s}"${f.stroke === s ? " selected" : ""}>${STROKE_NOM[s]}</option>`).join("")}</select></label>
        <label class="sc-field"><span class="k">Dystans</span><select name="dist" ${dis}>${GOAL_DISTS[f.stroke].map(d => `<option value="${d}"${+f.dist === d ? " selected" : ""}>${d} m</option>`).join("")}</select></label>
        <label class="sc-field"><span class="k">Basen</span><select name="pool" ${dis}><option value="25"${+f.pool === 25 ? " selected" : ""}>25 m</option><option value="50"${+f.pool === 50 ? " selected" : ""}>50 m</option></select></label>
        <label class="sc-field"><span class="k">Czas (cel)</span><input name="time" type="text" inputmode="decimal" maxlength="9" placeholder="1:05,00" ${dis}></label>
        <label class="sc-field"><span class="k">Do kiedy (opcjonalnie)</span><input name="by" type="date" ${dis}></label>
        <label class="sc-field wide"><span class="k">Notatka (opcjonalnie)</span><input name="note" type="text" maxlength="120" placeholder="np. limit na mistrzostwa" ${dis}></label>
        <button type="submit" class="btn primary" ${dis}>Dodaj cel</button></form>
      <p class="sc-err" role="alert">${esc(ui.err.goal || "")}</p>
      <h3>Punkty World Aquatics</h3>
      ${pts.length ? `<div class="tablewrap"><table class="an-pts"><thead><tr><th>Konkurencja</th><th>Rekord</th><th>Punkty</th></tr></thead><tbody>
        ${pts.map(x => `<tr><th scope="row">${x.dist} m ${STROKE_INST[x.stroke]} <small>basen ${Math.round(x.pool)} m</small></th><td class="num">${fmtT(x.time)}</td><td class="num"><b>${x.pts}</b></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="meta">Brak rekordów w basenie 25 m lub 50 m, za które liczy się punkty.</p>`}
      <p class="meta">${esc(ST.BASE_INFO)}. Punkty = 1000 × (czas bazowy ÷ twój czas)³.</p>
    </section>`;
  }
  // "Na tle rówieśników" (27.10.2026): each record against the PZP classes of the age and the ranking of the year of birth
  function peerScale(r) {
    const c = r.cls, rk = r.rank, my = r.rec.time, ticks = [];
    if (c && c.own) ticks.push({ t: c.own.time, l: c.own.label, cls: "own", p: 0 });
    if (c && c.row && (!c.own || c.own.col !== 3)) ticks.push({ t: c.row[3], l: "II", cls: "ii", p: 1 });
    if (c && c.nextYear && c.nextYear.time != null && (!c.own || c.nextYear.col !== c.own.col)) ticks.push({ t: c.nextYear.time, l: c.nextYear.label, cls: "ny", p: 2 });
    // the scale covers the classes and the ranking; a time far slower sits at the left edge (an open dot)
    const ref = ticks.map(x => x.t).concat(rk ? [rk[0], rk[5]] : []);
    let fast = Math.min(my, ...ref), slow = Math.max(...ref, ref.length ? 0 : my);
    const pad = (slow - fast) * 0.06 || 1; fast -= pad; slow += pad;
    const out = my > slow + (slow - fast) * 0.35; if (out) slow += pad; else slow = Math.max(slow, my + pad);
    const W = 320, X = t => 8 + (slow - Math.min(t, slow)) / (slow - fast) * (W - 16), F = v => v.toFixed(1);
    // labels that would touch are left out (the more important ones first)
    const place = (items, gap) => { const kept = []; for (const it of items.slice().sort((a, b) => a.p - b.p)) if (kept.every(k => Math.abs(X(k.t) - X(it.t)) >= gap)) kept.push(it); return kept; };
    let z = "";
    if (rk) { const b = [rk[5], rk[3], rk[2], rk[1], rk[0]]; for (let i = 0; i < 4; i++) z += `<rect x="${F(X(b[i]))}" y="18" width="${F(X(b[i + 1]) - X(b[i]))}" height="10" class="z${i + 1}"></rect>`;
      z += place([[rk[5], "100.", 0], [rk[0], "1.", 1], [rk[3], "50.", 2], [rk[1], "10.", 3], [rk[2], "25.", 4]].map(([t, l, p]) => ({ t, l, p })), 18).map(x => `<text x="${F(X(x.t))}" y="42" class="pl">${x.l}</text>`).join(""); }
    const labels = place(ticks, 26);
    const tk = ticks.map(x => `<line x1="${F(X(x.t))}" x2="${F(X(x.t))}" y1="12" y2="30" class="tk ${x.cls}"></line>`).join("") + labels.map(x => `<text x="${F(X(x.t))}" y="9" class="cl ${x.cls}">${esc(x.l)}</text>`).join("");
    return `<svg class="an-pscale" viewBox="0 0 ${W} 46" role="img" aria-label="${esc(`Twój czas ${fmtT(my)} na tle klas PZP i rankingu rocznika`)}"><rect x="8" y="22" width="${W - 16}" height="2" class="base"></rect>${z}${tk}${out ? `<text x="${F(X(my) + 9)}" y="27" class="far">‹</text>` : ""}<circle cx="${F(X(my))}" cy="23" r="5.5" class="me${out ? " far" : ""}"></circle></svg>`;
  }
  function peersPanel(D) {
    const PE = g.RytmSwimPeers; if (!PE) return "";
    const dis = canWrite() ? "" : "disabled", born = S.born, year = ST.parseDay(D.today).getFullYear();
    const form = `<form class="an-form an-born" data-anform="born" novalidate><label class="sc-field"><span class="k">Twój rocznik</span><input name="born" type="text" inputmode="numeric" maxlength="4" placeholder="np. 2011" value="${born || ""}" ${dis}></label><button type="submit" class="btn" ${dis}>Zapisz</button></form><p class="sc-err" role="alert">${esc(ui.err.born || "")}</p>`;
    if (!born) return `<section class="panel an-peers"><h2>Na tle rówieśników</h2><p class="meta">Wpisz swój rocznik — twoje rekordy porównam z klasami sportowymi PZP dla twojego wieku i z rankingiem twojego rocznika w Polsce.</p>${form}</section>`;
    const age = year - born, pool = ui.peerPool === 50 ? 50 : 25, list = PE.rows(D.recs, pool, born, year), mine = list.filter(r => r.rec), none = list.filter(r => !r.rec);
    const ev = r => `${r.dist} m ${STROKE_INST[r.stroke]}`;
    const item = r => {
      const c = r.cls, src = r.rec.src !== "manual" ? "z treningu (zegarek)" : r.rec.kind === "trening" ? "z treningu" : "zawody";
      const kl = !c ? "" : c.got ? `<span class="d up">Klasa ${esc(c.got.label)} ✓</span>` : c.own ? `<span>Klasa ${esc(c.own.label)}: ${fmtT(c.own.time)} — brakuje ${fmtT(r.rec.time - c.own.time)} s</span>` : c.next ? `<span>Klasa ${esc(c.next.label)}: ${fmtT(c.next.time)} — brakuje ${fmtT(r.rec.time - c.next.time)} s</span>` : "";
      const ny = c && c.nextYear && c.nextYear.time != null && c.own && c.nextYear.col !== c.own.col ? `<span>Za rok (${esc(c.nextYear.label)}): ${fmtT(c.nextYear.time)}</span>` : "";
      const pl = r.rank ? (r.place != null ? `<span>Ok. ${r.place}. miejsce w roczniku ${born}</span>` : `<span>Poza setką rocznika ${born} (100. miejsce: ${fmtT(r.rank[5])})</span>`) : "";
      return `<li class="an-peer"><div class="an-pn"><b>${ev(r)}</b> <span class="meta">${fmtT(r.rec.time)} · ${dayTxt(ST.dayKey(new Date(r.rec.date)))} · ${src}</span></div>${peerScale(r)}<p class="an-pt">${[kl, ny, pl].filter(Boolean).join(" · ")}</p></li>`;
    };
    return `<section class="panel an-peers"><h2>Na tle rówieśników</h2>
      <p class="meta"><span>Rocznik ${born}: w ${year} masz ${age} ${plural(age, "rok", "lata", "lat")} (wiek rocznikowy, jak w PZP).</span>${PE.hasRank(born) ? "" : ` <span>Ranking rocznika mam na razie tylko dla rocznika 2011 — tu są same klasy PZP.</span>`}</p>
      <div class="seg small an-pseg" role="group" aria-label="Basen"><button type="button" class="seg-b" data-anact="peerPool" data-v="25" aria-pressed="${pool === 25}">Basen 25 m</button><button type="button" class="seg-b" data-anact="peerPool" data-v="50" aria-pressed="${pool === 50}">Basen 50 m</button></div>
      ${mine.length ? `<ul class="an-peerl">${mine.map(item).join("")}</ul>
        <p class="an-plegend"><span><i class="z1"></i>51–100</span><span><i class="z2"></i>26–50</span><span><i class="z3"></i>11–25</span><span><i class="z4"></i>1–10 miejsce</span><span><i class="tk"></i>klasa PZP</span><span><i class="me"></i>ty</span></p>`
        : `<p class="meta">Nie masz jeszcze wyników w basenie ${pool} m w konkurencjach, dla których mam dane.</p>`}
      ${none.length && mine.length ? `<p class="meta"><span>Bez twojego wyniku:</span> ${none.map(r => `<span>${ev(r)}</span>`).join(", ")}.</p>` : ""}
      <p class="meta"><span>Klasy: ${esc(PE.PZP_INFO)}.</span>${PE.hasRank(born) ? ` <span>Ranking rocznika ${born}: najlepszy wynik każdego zawodnika z tego rocznika w Polsce, ${esc(PE.RANK[born].src)}, stan na ${dayTxt(PE.RANK[born].date)} ${PE.RANK[born].date.slice(0, 4)} — z czasem się zestarzeje.</span>` : ""} <span>Wynik z zegarka to wynik z treningu — na zawodach zwykle płynie się szybciej.</span></p>
      ${form}
    </section>`;
  }
  function fullView() {
    const D = inputs();
    if (!D.trainings.some(t => t.swim)) return `<section class="panel"><h2>Analiza</h2><p class="meta">Dodaj treningi z Garmina (lista CSV i pliki FIT) — wtedy zobaczysz ocenę, komentarze i statystyki.</p></section>`;
    return gradePanel(D) + commentsPanel(D) + peersPanel(D) + attendancePanel(D) + zonesPanel(D) + cssPanel(D) + loadPanel(D) + techPanel(D) + setsPanel(D) + goalsPanel(D);
  }
  function render() { const root = $("anRoot"); if (!root || (P && P.visible && !P.visible())) return; root.innerHTML = fullView(); }

  /* ---------- one workout (in Treningi) ---------- */
  function trainingBlock(t) {
    if (!t || !t.swim) return "";
    let D; try { D = inputs(); } catch (e) { return ""; }
    const l = L(), R = CO.forTraining(D, t), cs = R.comments, open = ui.trAll === t.id, shown = open ? cs : cs.slice(0, 6);
    let html = `<section class="panel an-tr"><h3>Komentarz trenera</h3>${cs.length ? listHtml(shown, l) : `<p class="meta">Za mało danych do komentarza.</p>`}
      ${cs.length > 6 ? `<div class="actions"><button type="button" class="btn link" data-anact="trAll" data-id="${esc(t.id)}">${open ? "Pokaż mniej" : `Pokaż wszystkie (${cs.length})`}</button></div>` : ""}`;
    if (t.fit) {
      const z = D.hrMax ? ST.hrZoneSecs(t.fit, D.hrMax) : null;
      if (z) { const tot = z.reduce((a, b) => a + b, 0) || 1; html += `<h3>Strefy tętna</h3>${hbar(z.map((v, i) => ({ v, c: ZCOL[i], t: ST.HR_ZONES[i].name })), "Czas w strefach tętna")}<p class="meta an-zl">${z.map((v, i) => `<span><i class="an-sw" style="background:${ZCOL[i]}"></i>Z${i + 1} ${Math.round(v / tot * 100)}%</span>`).join(" ")}</p>`; }
      const tech = ST.technique(t.fit, D.bad), ks = ["free", "back", "breast", "fly"].filter(s => tech[s]);
      if (ks.length) html += `<h3>Technika</h3><div class="tablewrap"><table class="an-tech"><thead><tr><th>Styl</th><th>Ruchy/min</th><th>${U().u()}/ruch</th><th>SWOLF</th></tr></thead><tbody>
        ${ks.map(s => `<tr><th scope="row"><i class="tr-dot" style="background:var(${STROKE_VAR[s]})"></i>${STROKE_NOM[s]}<small>${tech[s].n} ${plural(tech[s].n, "długość", "długości", "długości")}</small></th><td class="num">${tech[s].rate.toFixed(1).replace(".", ",")}</td><td class="num">${U().d(tech[s].dps).toFixed(2).replace(".", ",")}</td><td class="num">${tech[s].swolf.toFixed(1).replace(".", ",")}</td></tr>`).join("")}</tbody></table></div>`;
      const H = ST.setHistory(D.trainings).filter(x => x.id === t.id);
      if (H.length) html += `<h3>Serie</h3>${setsTable(H, false)}`;
    }
    return html + `</section>`;
  }

  /* ---------- typing in ---------- */
  // "5:20,4", "5:20.40", "320,4", "58.3" -> seconds
  function parseTime(s) {
    const m = String(s || "").trim().replace(/\s+/g, "").match(/^(?:(\d{1,2}):)?(\d{1,3})(?:[,.](\d{1,2}))?$/);
    if (!m) return null;
    if (m[1] != null && (m[2].length !== 2 || +m[2] > 59)) return null;
    const t = (+m[1] || 0) * 60 + +m[2] + (m[3] ? +m[3] / Math.pow(10, m[3].length) : 0);
    return t > 0 ? Math.round(t * 100) / 100 : null;
  }
  function onSubmit(e) {
    const f = e.target.closest && e.target.closest("form[data-anform]"); if (!f) return;
    e.preventDefault(); if (!canWrite()) return;
    const v = n => ((f.querySelector(`[name="${n}"]`) || {}).value || "").trim(), kind = f.dataset.anform;
    const err = m => { ui.err[kind] = m; render(); return false; };
    ui.err[kind] = "";
    const prev = exportState(), next = exportState();
    if (kind === "hr") {
      const h = +v("hr");
      if (!v("hr")) return err("Wpisz tętno maksymalne, np. 198.");
      if (!Number.isInteger(h) || h < 120 || h > 240) return err("Tętno maksymalne: liczba od 120 do 240.");
      next.hrMax = h;
      return save(next, `Zapisano tętno maksymalne: ${h} ud./min.`, prev);
    }
    if (kind === "css") {
      const d = v("date"), a = parseTime(v("t400")), b = parseTime(v("t200"));
      if (!ST.DAY.test(d)) return err("Wybierz dzień testu.");
      if (d > today()) return err("Test nie może być z przyszłości.");
      if (a == null || b == null) return err("Wpisz oba czasy, np. 5:20,4 i 2:28,9.");
      if (!(a > b)) return err("Czas na 400 m musi być dłuższy niż na 200 m.");
      if (a < 180 || a > 1200 || b < 85 || b > 600) return err("Te czasy wyglądają na pomyłkę — sprawdź minuty i sekundy.");
      if (a < b * 1.9) return err("400 m nie może być szybsze (na 100 m) niż 200 m — sprawdź czasy.");
      next.css.push({ id: newId("c"), date: d, t400: a, t200: b });
      return save(next, `Dodano test CSS: ${fmtPace(ST.cssOf(a, b))}/100 m.`, prev);
    }
    if (kind === "born") {
      const y = +v("born"), now = ST.parseDay(today()).getFullYear();
      if (!/^\d{4}$/.test(v("born")) || y < 1940 || y > now - 5) return err(`Rocznik: cztery cyfry, np. ${now - 15}.`);
      next.born = y;
      return save(next, `Zapisano rocznik: ${y}.`, prev);
    }
    if (kind === "goal") {
      const stroke = v("stroke"), dist = +v("dist"), pool = +v("pool"), t = parseTime(v("time")), by = v("by");
      ui.goal = { stroke, dist, pool };
      if (!GOAL_DISTS[stroke] || !GOAL_DISTS[stroke].includes(dist) || ![25, 50].includes(pool)) return err("Wybierz styl, dystans i basen.");
      if (t == null) return err("Wpisz czas, np. 1:05,00.");
      if (dist / t > 2.5) return err("Ten czas byłby szybszy niż rekord świata — sprawdź minuty i sekundy.");
      if (by && !ST.DAY.test(by)) return err("Zła data.");
      if (by && by < today()) return err("Termin celu już minął — wybierz dzień z przyszłości albo zostaw puste.");
      next.goals.push({ id: newId("g"), stroke, dist, pool, time: t, by: by || null, note: v("note").slice(0, 120) });
      return save(next, `Dodano cel: ${dist} m ${STROKE_INST[stroke]} w ${fmtT(t)}.`, prev);
    }
  }
  function onClick(e) {
    const b = e.target.closest("[data-anact]"); if (!b || b.disabled) return;
    const a = b.dataset.anact;
    if (a === "lvl") { ui.lvl = b.dataset.v; ui.all = false; render(); return; }
    if (a === "all") { ui.all = !ui.all; render(); return; }
    if (a === "tech") { ui.tech = b.dataset.v; render(); return; }
    if (a === "peerPool") { ui.peerPool = +b.dataset.v === 50 ? 50 : 25; render(); return; }
    if (a === "trAll") { ui.trAll = ui.trAll === b.dataset.id ? null : b.dataset.id; if (P && P.redrawTraining) P.redrawTraining(); return; }
    if (a === "goAtt") { if (P && P.goAttendance) P.goAttendance(); return; }
    if (!canWrite()) return;
    const prev = exportState(), next = exportState();
    if (a === "hrAuto") { next.hrMax = null; save(next, "Tętno maksymalne: z danych.", prev); }
    else if (a === "delCss") { const x = S.css.find(c => c.id === b.dataset.id); if (!x) return; next.css = next.css.filter(c => c.id !== x.id); save(next, `Usunięto test CSS z ${dayTxt(x.date)}.`, prev); }
    else if (a === "delGoal") { const x = S.goals.find(c => c.id === b.dataset.id); if (!x) return; next.goals = next.goals.filter(c => c.id !== x.id); save(next, `Usunięto cel: ${x.dist} m ${STROKE_INST[x.stroke]}.`, prev); }
  }
  function onChange(e) {
    // the distances follow the chosen stroke
    const s = e.target.closest && e.target.closest('form[data-anform="goal"] select[name="stroke"]'); if (!s) return;
    const f = s.form, d = f.querySelector('[name="dist"]'), cur = +d.value;
    d.innerHTML = GOAL_DISTS[s.value].map(x => `<option value="${x}"${x === cur ? " selected" : ""}>${x} m</option>`).join("");
  }
  function mount() {
    doc.addEventListener("click", e => { if (e.target.closest && e.target.closest("#anRoot, #trRoot")) onClick(e); });
    const r = $("anRoot"); if (r) { r.addEventListener("submit", onSubmit); r.addEventListener("change", onChange); }
  }
  function summary() { const D = inputs(), G = D.result.grade; return G ? `Ocena ${G.value}${G.sign} · ${D.result.counts.zle} × źle` : "Analiza treningów"; }
  function invalidate() { cache = null; }

  const api = { attach, render, mount, exportState, setClock, trainingBlock, summary, invalidate, parseTime, ui, canWrite, inputs };
  g.RytmSwimAnalysis = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
