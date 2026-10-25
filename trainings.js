// Rytm: one list of trainings built from the Garmin CSV and FIT files,
// a page for each training (charts along distance or time, intervals, comparison with the previous one).
// "Pokaż szczegóły wykresu" (25.10.2026): one big chart over the screen where heart rate, pace, SWOLF and the distance of the
// current swim (it grows while you swim and starts again from zero after a rest) can be switched on and off, with the rests shown.
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const STROKE = { free: "kraul", back: "grzbiet", breast: "żabka", fly: "motyl", drill: "ćwiczenia", mixed: "mieszany", other: "inny" };
  const STROKE_VAR = { free: "--h0", breast: "--h1", back: "--h2", fly: "--h5" };
  // the unit for showing distances, pace and efficiency (Ustawienia → Jednostki, 25.10.2026); saved values are metres
  const U = () => g.RytmUnits || { yd: false, u: () => "m", d: m => m, pace: s => s, eff: e => e };
  const fmtDist = m => Math.round(U().d(m)).toLocaleString("pl-PL") + " " + U().u();

  // FIT activity -> training fields (same definitions as the CSV, so trends stay comparable)
  function fromFit(act) {
    const sw = act.lengths.filter(l => l.s !== "idle");
    const swim = sw.filter(l => l.s !== "drill");
    const moving = sw.reduce((a, l) => a + l.t, 0);
    const dist = sw.length * act.pool || (act.sum && act.sum.dist) || null;
    const withK = swim.filter(l => l.k);
    const avgHr = act.sum && act.sum.avgHr ? act.sum.avgHr : null;
    const hrSwim = weightedHr(sw), hrRest = weightedHr(act.lengths.filter(l => l.s === "idle"));
    return {
      dist, moving, total: act.sum && act.sum.elapsed ? act.sum.elapsed : (act.lengths.length ? (act.lengths[act.lengths.length - 1].e - act.start) / 1000 : null),
      pace: dist && moving ? moving / dist * 100 : null,
      avgHr, maxHr: act.sum ? act.sum.maxHr : null, hrSwim, hrRest,
      swolf: withK.length ? withK.reduce((a, l) => a + l.t + l.k, 0) / withK.length : null,
      spl: withK.length ? withK.reduce((a, l) => a + l.k, 0) / withK.length : null,
      kcal: act.sum ? act.sum.kcal : null, te: act.sum ? act.sum.te : null, pool: act.pool,
    };
  }
  function weightedHr(ls) {
    let s = 0, w = 0; for (const l of ls) if (l.hr) { s += l.hr * l.t; w += l.t; }
    return w ? s / w : null;
  }
  const effOf = t => t.dist && t.moving && t.avgHr ? (t.dist / (t.moving / 60)) / t.avgHr : null;

  // csv: rows from the activity CSV; fit: {id: unpacked activity}; hidden: {trainingId: deletedAt} (CSV rows the user deleted)
  function build(csv, fit, hidden) {
    const out = [], used = new Set();
    const fits = Object.values(fit || {}).sort((a, b) => a.start - b.start);
    for (const r of csv || []) {
      if (hidden && hidden["c" + (+r.date)]) continue;
      const t = { id: "c" + (+r.date), date: r.date, type: r.type, swim: r.swim, csv: r, fit: null,
        dist: r.meters, moving: r.moving, total: r.time, pace: r.pace, avgHr: r.hr, maxHr: r.maxhr, swolf: r.swolf, spl: r.spl ?? null,
        kcal: r.kcal ?? null, te: r.te, pool: null, hrSwim: null, hrRest: null };
      if (r.swim) {
        const m = fits.find(a => !used.has(a.id) && Math.abs(a.start - r.date) < 3 * 60 * 1000);
        if (m) { used.add(m.id); attachFit(t, m); }
      }
      t.eff = effOf(t);
      out.push(t);
    }
    for (const a of fits) {
      if (used.has(a.id)) continue;
      const t = { id: "f" + a.start, date: new Date(a.start), type: "Pływanie na basenie", swim: true, csv: null, fit: null };
      attachFit(t, a); t.eff = effOf(t);
      out.push(t);
    }
    out.sort((a, b) => a.date - b.date);
    return out;
  }
  function attachFit(t, a) {
    const f = fromFit(a);
    t.fit = a;
    for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined) t[k] = v;
  }

  // the previous training of the same kind
  function previous(list, t) {
    const i = list.indexOf(t);
    for (let j = i - 1; j >= 0; j--) if (list[j].type === t.type) return list[j];
    return null;
  }

  // metric table for the comparison; better: "up" | "down" | null (neutral)
  const METRICS = [
    { k: "dist", eps: 0.5, label: "Dystans", swim: true, better: null, fmt: v => fmtDist(v), dfmt: v => fmtDist(v) },
    { k: "moving", eps: 30, label: "Czas pływania", swim: true, better: null, fmt: fmtDur, dfmt: v => fmtDur(v) },
    { k: "pace", eps: 0.5, get label() { return "Tempo / 100 " + U().u(); }, swim: true, better: "down", fmt: v => fmtPace(U().pace(v)), dfmt: v => Math.round(U().pace(v)) + " s" },
    { k: "eff", eps: 0.0005, label: "Efektywność", swim: true, better: "up", fmt: v => U().eff(v).toFixed(3) + " " + U().u() + "/ud.", dfmt: v => U().eff(v).toFixed(3), rel: true },
    { k: "avgHr", eps: 0.5, label: "Średnie tętno", better: null, fmt: v => Math.round(v) + " ud./min", dfmt: v => Math.round(v) + " ud./min" },
    { k: "maxHr", eps: 0.5, label: "Maks. tętno", better: null, fmt: v => Math.round(v) + " ud./min", dfmt: v => Math.round(v) + " ud./min" },
    { k: "swolf", eps: 0.05, label: "SWOLF", swim: true, better: "down", fmt: v => v.toFixed(1), dfmt: v => v.toFixed(1) },
    { k: "spl", eps: 0.05, label: "Ruchy na długość", swim: true, better: "down", fmt: v => v.toFixed(1), dfmt: v => v.toFixed(1) },
    { k: "total", eps: 30, label: "Czas treningu", swim: false, better: null, fmt: fmtDur, dfmt: v => fmtDur(v) },
    { k: "kcal", eps: 0.5, label: "Kalorie", better: null, fmt: v => Math.round(v) + " kcal", dfmt: v => Math.round(v) + " kcal" },
    { k: "te", eps: 0.05, label: "Efekt treningowy", better: null, fmt: v => v.toFixed(1), dfmt: v => v.toFixed(1) },
  ];
  function compare(t, p) {
    if (!p) return [];
    return METRICS.filter(m => (m.swim === undefined || m.swim === t.swim) && t[m.k] != null && p[m.k] != null).map(m => {
      const d = t[m.k] - p[m.k];
      const same = Math.abs(d) < (m.eps || 1e-9);
      const tone = !m.better || same ? "flat" : (m.better === "up" ? d > 0 : d < 0) ? "up" : "down";
      return { ...m, cur: t[m.k], prev: p[m.k], d: same ? 0 : d, pct: same ? 0 : p[m.k] ? d / p[m.k] : null, tone };
    });
  }
  // one or two plain sentences about what changed since the previous training
  function summary(t, p) {
    if (!p) return "To pierwszy taki trening na liście, więc nie ma jeszcze z czym porównać.";
    if (!t.swim) {
      if (t.avgHr && p.avgHr) return `Średnie tętno ${t.avgHr < p.avgHr ? "niższe" : t.avgHr > p.avgHr ? "wyższe" : "takie samo"} niż ostatnio (${Math.round(p.avgHr)} → ${Math.round(t.avgHr)} ud./min).`;
      return "Za mało danych do porównania.";
    }
    const bits = [];
    if (t.pace && p.pace) {
      const d = Math.round(U().pace(t.pace) - U().pace(p.pace)), u = U().u();
      bits.push(d < 0 ? `Płynąłeś szybciej o ${-d} s na 100 ${u}` : d > 0 ? `Płynąłeś wolniej o ${d} s na 100 ${u}` : "Płynąłeś w tym samym tempie");
    }
    if (t.avgHr && p.avgHr) {
      const d = Math.round(t.avgHr - p.avgHr);
      bits.push(d < 0 ? `przy tętnie niższym o ${-d} ud./min` : d > 0 ? `przy tętnie wyższym o ${d} ud./min` : "przy takim samym tętnie");
    }
    let s = bits.length ? bits.join(" ") + "." : "";
    if (t.eff && p.eff) {
      const r = (t.eff - p.eff) / p.eff;
      s += Math.abs(r) < 0.01 ? " Efektywność bez większej zmiany." : r > 0 ? ` Efektywność wzrosła o ${Math.round(r * 100)}%, czyli robisz więcej przy tym samym wysiłku.` : ` Efektywność spadła o ${Math.round(-r * 100)}%.`;
    }
    return s.trim() || "Za mało danych do porównania.";
  }

  // intervals = swimming between two rests
  function intervals(act) {
    const out = []; let cur = null;
    act.lengths.forEach((l, i) => {
      if (l.s === "idle") { if (cur) { cur.rest = l.t; cur = null; } return; }
      if (!cur) { cur = { from: i, lens: [], rest: null }; out.push(cur); }
      cur.lens.push(l);
    });
    return out.map((iv, n) => {
      const t = iv.lens.reduce((a, l) => a + l.t, 0), dist = iv.lens.length * act.pool;
      const strokes = [...new Set(iv.lens.map(l => l.s))];
      const withK = iv.lens.filter(l => l.k && l.s !== "drill");
      return { n: n + 1, dist, t, pace: t / dist * 100, stroke: strokes.length === 1 ? strokes[0] : "mixed", hr: weightedHr(iv.lens),
        swolf: withK.length ? withK.reduce((a, l) => a + l.t + l.k, 0) / withK.length : null, rest: iv.rest };
    });
  }

  function fmtPace(s) { if (s == null || !isFinite(s)) return "–"; const r = Math.round(s); return Math.floor(r / 60) + ":" + String(r % 60).padStart(2, "0"); }
  function fmtDur(s) { if (s == null) return "–"; const m = Math.round(s / 60); if (m < 60) return m + " min"; return Math.floor(m / 60) + " h " + (m % 60) + " min"; }
  function fmtSec(s) { const r = Math.round(s); return Math.floor(r / 60) + ":" + String(r % 60).padStart(2, "0"); }

  // the last k swims against the k before them (k = up to 5)
  function progress(swims) {
    const n = swims.length; if (n < 4) return null;
    const k = Math.min(5, Math.floor(n / 2));
    const A = swims.slice(n - 2 * k, n - k), B = swims.slice(n - k);
    const avg = (arr, key) => { const v = arr.map(t => t[key]).filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
    const rows = ["pace", "eff", "avgHr", "swolf", "dist"].map(key => {
      const m = METRICS.find(x => x.k === key), a = avg(A, key), b = avg(B, key);
      if (a == null || b == null) return null;
      const same = Math.abs(b - a) < (m.eps || 1e-9), d = same ? 0 : b - a;
      const tone = !m.better || same ? "flat" : (m.better === "up" ? d > 0 : d < 0) ? "up" : "down";
      return { ...m, cur: b, prev: a, d, pct: same ? 0 : a ? d / a : null, tone };
    }).filter(Boolean);
    return { k, rows };
  }
  // best trainings: most efficient, fastest (at least 500 m), longest
  function bests(swims) {
    const pick = (arr, key, dir) => arr.filter(t => t[key] != null).reduce((b, t) => !b || (dir > 0 ? t[key] > b[key] : t[key] < b[key]) ? t : b, null);
    return { eff: pick(swims, "eff", 1), pace: pick(swims.filter(t => (t.dist || 0) >= 500), "pace", -1), dist: pick(swims, "dist", 1) };
  }

  const core = { fromFit, build, previous, compare, summary, intervals, effOf, fmtPace, fmtDur, progress, bests };

  /* ================= UI ================= */
  let list = [], openId = null, axis = "dist", charts = {}, onOpenChange = null;
  let view = "list";                // list (swimming) | others (recreational activities)
  let confirmDel = null, onDelete = null;
  // competition days (Frekwencja → "Zawody"): opts.compDay(t) — the day is one, opts.comp(t) — the workout counts as the competition,
  // opts.setNotComp(id, on) — "to nie jest zapis z zawodów" (25.10.2026)
  let compOpts = {};
  // the big chart: which lines, the rests, the axis; remembered while the app is open
  const big = { open: false, show: { hr: true, pace: true, swolf: false, dist: false }, rests: true, axis: "time" };
  const isComp = t => { try { return !!(compOpts.comp && compOpts.comp(t)); } catch (e) { return false; } };
  const isCompDay = t => { try { return !!(compOpts.compDay && compOpts.compDay(t)); } catch (e) { return false; } };
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dateFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
  const longFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function setData(csv, fit, hidden) {
    list = build(csv, fit, hidden);
    if (openId && !list.find(t => t.id === openId)) openId = null;
    render();
  }

  function render() {
    const root = $("trRoot"); if (!root) return;
    Object.values(charts).forEach(c => c && c.destroy && c.destroy()); charts = {};
    const t = openId && list.find(x => x.id === openId);
    root.innerHTML = t ? detailView(t) : view === "others" ? othersView() : listView();
    if (t && t.fit) drawCharts(t);
    if (!t && view === "list") drawListCharts();
    if (big.open && !(t && t.fit)) big.open = false;
    renderBig();
  }

  function deltaChip(c, short) {
    if (!c) return "";
    if (!c.d) return `<span class="tr-d flat">= bez zmian</span>`;
    const arrow = c.tone === "up" ? "▲" : c.tone === "down" ? "▼" : c.d > 0 ? "↑" : "↓";
    const word = c.tone === "up" ? "lepiej" : c.tone === "down" ? "gorzej" : "";
    const val = c.rel && c.pct != null ? Math.abs(Math.round(c.pct * 100)) + "%" : c.dfmt(Math.abs(c.d));
    return `<span class="tr-d ${c.tone}">${arrow} ${short ? "" : word + " "}${esc(val)}</span>`;
  }

  function rowHtml(t) {
    const p = previous(list, t), cmp = compare(t, p);
    const ch = k => cmp.find(c => c.k === k);
    const main = t.swim
      ? `<span><b>${t.dist ? fmtDist(t.dist) : "–"}</b></span><span>${fmtPace(U().pace(t.pace))} /100 ${U().u()}</span><span>${t.avgHr ? Math.round(t.avgHr) + " ud./min" : "–"}</span>${t.eff ? `<span>${U().eff(t.eff).toFixed(3)} ${U().u()}/ud.</span>` : ""}`
      : `<span><b>${fmtDur(t.total)}</b></span><span>${t.avgHr ? Math.round(t.avgHr) + " ud./min" : "–"}</span><span>${t.kcal ? Math.round(t.kcal) + " kcal" : ""}</span>`;
    const chips = t.swim ? [ch("eff"), ch("pace")].filter(Boolean).map(c => `<span class="tr-chip">${c.k === "eff" ? "efektywność" : "tempo"} ${deltaChip(c, true)}</span>`).join("") : "";
    return `<button class="tr-row" data-tr="${t.id}">
      <span class="tr-top"><span class="tr-date">${esc(dateFmt.format(t.date))}</span>${isComp(t) ? `<span class="tag comp">zawody</span>` : ""}${t.swim ? "" : `<span class="tag other">${esc(t.type)}</span>`}${t.fit ? `<span class="tr-fit" title="Jest plik FIT z wykresami">wykresy</span>` : ""}</span>
      <span class="tr-main">${main}</span>
      ${chips ? `<span class="tr-chips">${chips}</span>` : ""}
    </button>`;
  }

  function listView() {
    const swims = list.filter(t => t.swim), others = list.filter(t => !t.swim);
    const otherLink = others.length ? `<div class="tr-others"><button class="btn link" data-tract="others">Inne aktywności (${others.length}) ›</button><span class="meta">rekreacyjne, nie liczą się do statystyk pływania</span></div>` : "";
    if (!swims.length) return `<section class="panel"><h2>Brak treningów pływackich</h2>
      <p class="hint">Dodaj eksport CSV z Garmin Connect (lista wszystkich treningów) albo pliki .FIT pojedynczych treningów przyciskiem „+ Dodaj dane” na górze. Pliki FIT dają wykresy tętna i tempa wewnątrz treningu oraz rekordy.</p></section>${otherLink}`;
    const nFit = swims.filter(t => t.fit).length, totM = swims.reduce((a, t) => a + (t.dist || 0), 0), u = U().u();
    const total = U().yd ? Math.round(U().d(totM)).toLocaleString("pl-PL") + " yd" : (totM / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 }) + " km";
    const P = progress(swims), B = bests(swims);
    const best = (lbl, t, val) => t ? `<button class="tr-best" data-tr="${t.id}"><span class="k">${lbl}</span><span class="v">${esc(val)}</span><span class="meta">${esc(dateFmt.format(t.date))}</span></button>` : "";
    return `<div class="row"><h2 class="h-sub">Treningi pływackie</h2><span class="meta">${swims.length} · ${total} · ${nFit} z wykresami</span></div>
      ${P ? `<section class="panel"><h3>Ostatnie ${P.k} treningów w porównaniu z ${P.k} wcześniejszymi</h3>
        <div class="tr-prog">${P.rows.map(c => `<div><span class="k">${c.label}</span><span class="v">${esc(c.fmt(c.cur))}</span>${deltaChip(c)}</div>`).join("")}</div>
        <p class="meta">Średnie z ${P.k} ostatnich treningów, a strzałka pokazuje zmianę względem ${P.k} poprzednich. To lepiej pokazuje kierunek niż porównanie dwóch pojedynczych treningów.</p></section>` : ""}
      <div class="tr-bests">${best("Najlepsza efektywność", B.eff, B.eff ? U().eff(B.eff.eff).toFixed(3) + ` ${u}/ud.` : "")}${best("Najszybsze tempo (od 500 m)", B.pace, B.pace ? fmtPace(U().pace(B.pace.pace)) + ` /100 ${u}` : "")}${best("Najdłuższy trening", B.dist, B.dist ? fmtDist(B.dist.dist) : "")}</div>
      <section class="panel"><h3>Efektywność w kolejnych treningach</h3><p class="meta">${U().yd ? "Jardy" : "Metry"} na jedno uderzenie serca. Linia przerywana to trend, złoty punkt to najlepszy trening. Dotknij punktu, żeby go otworzyć.</p>
        <div class="legend"><span>trening</span><span class="t">trend</span></div><div class="chart"><canvas id="trEffAll" aria-label="Efektywność w kolejnych treningach"></canvas></div></section>
      <section class="panel"><h3>Tempo na 100 ${u} w kolejnych treningach</h3><p class="meta">Wyżej znaczy szybciej. Złoty punkt to najszybszy trening od 500 m.</p>
        <div class="chart"><canvas id="trPaceAll" aria-label="Tempo w kolejnych treningach"></canvas></div></section>
      <div class="row"><h3 class="tr-h">Wszystkie treningi</h3></div>
      <p class="note">Strzałki przy treningu pokazują zmianę względem poprzedniego treningu. ▲ to poprawa, ▼ pogorszenie.</p>
      <div class="tr-list">${[...swims].reverse().map(rowHtml).join("")}</div>
      ${otherLink}`;
  }

  function othersView() {
    const others = list.filter(t => !t.swim);
    return `<div class="row"><button class="btn link" data-tract="back">‹ Treningi pływackie</button></div>
      <div class="row"><h2 class="h-sub">Inne aktywności</h2><span class="meta">${others.length}</span></div>
      <p class="note">Aktywności rekreacyjne, np. siatkówka. Są tutaj dla porządku i nie wliczają się do statystyk ani wykresów pływania.</p>
      <div class="tr-list">${others.length ? [...others].reverse().map(rowHtml).join("") : `<p class="meta">Brak innych aktywności.</p>`}</div>`;
  }

  // trend charts across all swims; tapping a point opens that training
  function trendLine(ys) {
    const pts = ys.map((y, i) => [i, y]).filter(p => p[1] != null); if (pts.length < 3) return ys.map(() => null);
    const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0), sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n; return ys.map((_, i) => a + b * i);
  }
  function drawListCharts() {
    if (!$("trEffAll")) return;
    if (typeof Chart === "undefined") { setTimeout(drawListCharts, 80); return; }
    const swims = list.filter(t => t.swim), B = bests(swims);
    const acc = css("--accent"), gold = css("--rope"), tr = css("--trend"), mut = css("--muted"), ln = css("--line"), sf = css("--surface");
    const mk = (id, key, bestT, fmt, reverse) => {
      const conv = key === "pace" ? U().pace : key === "eff" ? U().eff : v => v;
      const data = swims.map(t => (t[key] == null ? null : conv(t[key]))), bi = swims.indexOf(bestT);
      charts[id] = new Chart($(id), { type: "line",
        data: { labels: swims.map(t => dateFmt.format(t.date)), datasets: [
          { data, borderColor: acc, borderWidth: 2, tension: .25, spanGaps: true, pointHitRadius: 12, pointBorderColor: sf, pointBorderWidth: 2,
            pointRadius: c => c.dataIndex === bi ? 7 : 4, pointHoverRadius: 8, pointBackgroundColor: c => c.dataIndex === bi ? gold : acc },
          { data: trendLine(data), borderColor: tr, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0, fill: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
          onClick: (e, els) => { const el = els.find(x => x.datasetIndex === 0); if (el && swims[el.index]) open(swims[el.index].id); },
          plugins: { legend: { display: false }, tooltip: { filter: i => i.datasetIndex === 0, callbacks: { label: c => " " + fmt(c.parsed.y), footer: () => "Dotknij, żeby otworzyć" } } },
          scales: { x: { grid: { display: false }, ticks: { color: mut, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
            y: { reverse, grid: { color: ln }, border: { display: false }, ticks: { color: mut, maxTicksLimit: 5, callback: v => fmt(v) } } } } });
    };
    mk("trEffAll", "eff", B.eff, v => v == null ? "–" : v.toFixed(3), false);
    mk("trPaceAll", "pace", B.pace, v => fmtPace(v), true);
  }

  function detailView(t) {
    const p = previous(list, t), cmp = compare(t, p);
    const group = list.filter(x => x.swim === t.swim), i = group.indexOf(t);
    const older = group[i - 1], newer = group[i + 1];
    const tiles = t.swim ? [
      ["Dystans", t.dist ? Math.round(U().d(t.dist)).toLocaleString("pl-PL") : "–", U().u()],
      ["Czas pływania", t.moving ? fmtSec(t.moving) : "–", t.total ? "z " + fmtDur(t.total) : ""],
      ["Tempo / 100 " + U().u(), fmtPace(U().pace(t.pace)), ""],
      ["Efektywność", t.eff ? U().eff(t.eff).toFixed(3) : "–", U().u() + " na uderzenie"],
      ["Średnie tętno", t.avgHr ? Math.round(t.avgHr) : "–", "ud./min"],
      ["Maks. tętno", t.maxHr ? Math.round(t.maxHr) : "–", "ud./min"],
      ["SWOLF", t.swolf ? t.swolf.toFixed(1) : "–", "czas + ruchy na długość"],
      ["Ruchy na długość", t.spl ? t.spl.toFixed(1) : "–", t.pool ? `basen ${g.Swim && g.Swim.fmtPool ? g.Swim.fmtPool(t.pool) : t.pool + " m"}` : ""],
    ] : [
      ["Czas", fmtDur(t.total), ""], ["Średnie tętno", t.avgHr ? Math.round(t.avgHr) : "–", "ud./min"],
      ["Maks. tętno", t.maxHr ? Math.round(t.maxHr) : "–", "ud./min"], ["Efekt treningowy", t.te != null ? t.te.toFixed(1) : "–", "aerobowy"],
    ];
    const extra = t.fit && (t.hrSwim || t.hrRest) ? `<p class="meta">Tętno podczas pływania: <b>${t.hrSwim ? Math.round(t.hrSwim) : "–"}</b> ud./min · w przerwach: <b>${t.hrRest ? Math.round(t.hrRest) : "–"}</b> ud./min</p>` : "";
    let html = `<div class="tr-detail">
      <div class="row"><button class="btn link" data-tract="back">${t.swim ? "‹ Wszystkie treningi" : "‹ Inne aktywności"}</button>
        <span class="controls"><button class="btn" data-tract="go" data-to="${older ? older.id : ""}" ${older ? "" : "disabled"}>‹ Starszy</button><button class="btn" data-tract="go" data-to="${newer ? newer.id : ""}" ${newer ? "" : "disabled"}>Nowszy ›</button></span></div>
      <div><p class="eyebrow">${esc(t.type)}${isComp(t) ? ` <span class="tag comp">zawody</span>` : ""}</p><h2 class="tr-title">${esc(longFmt.format(t.date))}</h2></div>
      <div class="h-stats tr-tiles">${tiles.map(([k, v, u]) => `<div><span class="k">${k}</span><span class="v">${v}</span><span class="meta">${esc(u)}</span></div>`).join("")}</div>
      ${extra}
      <section class="panel tr-cmp"><h3>Zmiana od poprzedniego treningu</h3>
        <p class="tr-sum">${esc(summary(t, p))}</p>
        ${p ? `<p class="meta">Porównanie z: ${esc(longFmt.format(p.date))}</p>
        <div class="tablewrap"><table class="tr-ctable"><thead><tr><th></th><th>Ten trening</th><th>Poprzedni</th><th>Zmiana</th></tr></thead><tbody>
          ${cmp.map(c => `<tr><th scope="row">${c.label}</th><td class="num">${esc(c.fmt(c.cur))}</td><td class="num muted">${esc(c.fmt(c.prev))}</td><td>${deltaChip(c)}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
      </section>`;
    if (t.fit) {
      const ivs = intervals(t.fit);
      const used = [...new Set(t.fit.lengths.filter(l => STROKE_VAR[l.s]).map(l => l.s))];
      const hasHr = t.fit.lengths.some(l => l.hr) || (t.fit.hrs && t.fit.hrs.length);
      html += `
      <div class="row"><h3 class="tr-h">W trakcie treningu</h3>
        <div class="seg small" role="group" aria-label="Oś pozioma"><button class="seg-b" data-tract="axis" data-ax="dist" aria-pressed="${axis === "dist"}">Po dystansie</button><button class="seg-b" data-tract="axis" data-ax="time" aria-pressed="${axis === "time"}">Po czasie</button></div></div>
      <div class="tr-legend">${used.map(s => `<span><i style="background:var(${STROKE_VAR[s]})"></i>${STROKE[s]}</span>`).join("")}</div>
      <button class="btn tr-bigbtn" data-tract="big">Pokaż szczegóły wykresu</button>
      <section class="panel"><h3>Tempo na 100 ${U().u()}</h3><p class="meta">Każdy punkt to jedna długość basenu. Wyżej znaczy szybciej.</p><div class="chart"><canvas id="trPace"></canvas></div></section>
      <section class="panel"><h3>Tętno</h3>${hasHr ? `<p class="meta">${axis === "time" ? "Linia z całego treningu, także z przerw." : "Średnie tętno na każdej długości."}</p><div class="chart"><canvas id="trHr"></canvas></div>` : `<p class="meta">Ten plik nie ma zapisu tętna. Część zegarków nie mierzy tętna w wodzie bez paska na klatkę.</p>`}</section>
      <section class="panel"><h3>SWOLF na długość</h3><p class="meta">Czas długości w sekundach + liczba ruchów. Niżej znaczy sprawniej.</p><div class="chart"><canvas id="trSwolf"></canvas></div></section>
      ${(() => { const n = g.Swim && g.Swim.suspicious ? g.Swim.suspicious(t.fit).size : 0; return n ? `<p class="note">${n} ${n === 1 ? "długość wygląda" : n < 5 ? "długości wyglądają" : "długości wygląda"} na błąd zegarka (np. jedna długość policzona jako dwie albo źle rozpoznany styl), więc nie ${n === 1 ? "liczy" : "liczą"} się do rekordów.</p>` : ""; })()}
      <section class="panel"><h3>Odcinki</h3><p class="meta">Pływanie między przerwami.</p>
        <div class="tablewrap"><table><thead><tr><th>#</th><th>Dystans</th><th>Styl</th><th>Czas</th><th>Tempo</th><th>Tętno</th><th>SWOLF</th><th>Przerwa</th></tr></thead><tbody>
        ${ivs.map(v => `<tr><td>${v.n}</td><td class="num">${fmtDist(v.dist)}</td><td>${STROKE_VAR[v.stroke] ? `<i class="tr-dot" style="background:var(${STROKE_VAR[v.stroke]})"></i>` : v.stroke === "mixed" ? `<i class="tr-dot mix"></i>` : ""}${STROKE[v.stroke] || v.stroke}</td><td class="num">${fmtSec(v.t)}</td><td class="num">${fmtPace(U().pace(v.pace))}</td><td class="num">${v.hr ? Math.round(v.hr) : "–"}</td><td class="num">${v.swolf ? v.swolf.toFixed(1) : "–"}</td><td class="num">${v.rest ? fmtSec(v.rest) : "–"}</td></tr>`).join("")}
        </tbody></table></div></section>`;
    } else if (t.swim) {
      html += `<section class="panel"><h3>Wykresy tętna i tempa</h3><p class="hint">Do tego treningu nie ma pliku .FIT, więc widać tylko średnie. Na connect.garmin.com otwórz ten trening, kliknij koło zębate i wybierz eksport oryginału, a potem dodaj plik przyciskiem „Dodaj dane”.</p></section>`;
    }
    html += compBlock(t);
    html += onDelete ? deleteBlock(t) : "";
    return html + `</div>`;
  }

  // on a competition day: a quiet button for "this is not the competition" (the watch may not be allowed there), and its undo
  function compBlock(t) {
    if (!isCompDay(t)) return "";
    const dis = compOpts.canWrite && !compOpts.canWrite() ? "disabled" : "";
    return isComp(t)
      ? `<p class="tr-notcomp"><button class="btn link" data-tract="notComp" ${dis}>To nie jest zapis z zawodów</button></p>`
      : `<p class="tr-notcomp"><span>Oznaczone: to nie jest zapis z zawodów.</span> <button class="btn link" data-tract="isComp" ${dis}>To jednak zawody</button></p>`;
  }

  // delete with an explicit confirmation step
  function deleteBlock(t) {
    const what = [t.fit ? "plik FIT (wykresy, długości, rekordy z tego treningu)" : null, t.csv ? "wiersz z listy CSV" : null].filter(Boolean).join(" i ");
    if (confirmDel !== t.id) return `<div class="actions tr-del"><button class="btn danger" data-tract="delAsk">Usuń trening</button></div>`;
    return `<section class="panel tr-confirm" role="alertdialog" aria-labelledby="trDelTitle">
      <h3 id="trDelTitle">Usunąć trening z ${esc(longFmt.format(t.date))}?</h3>
      <p class="meta">Zniknie ${esc(what)}. Rekordy i wykresy przeliczą się bez niego. Od razu po usunięciu możesz kliknąć „Cofnij”. Plik FIT możesz też wczytać ponownie.</p>
      <div class="actions"><button class="btn danger" data-tract="delYes">Tak, usuń trening</button><button class="btn" data-tract="delNo">Anuluj</button></div>
    </section>`;
  }

  // series for the charts inside one training
  function seriesOf(t) {
    const act = t.fit, pts = { pace: [], swolf: [], hr: [] };
    let dist = 0, prevIdle = true;
    for (const l of act.lengths) {
      // a rest breaks the line: Chart.js needs a point object here ({x, y: null}); a bare null made it throw
      if (l.s === "idle") {
        const gap = { x: axis === "dist" ? U().d(dist) : ((l.a + l.e) / 2 - act.start) / 60000, y: null };
        prevIdle = true; pts.pace.push(gap); pts.swolf.push(gap); if (axis === "dist") pts.hr.push(gap); continue;
      }
      dist += act.pool;
      const x = axis === "dist" ? U().d(dist) : ((l.a + l.e) / 2 - act.start) / 60000;
      if (STROKE_VAR[l.s]) {
        pts.pace.push({ x, y: U().pace(l.t / act.pool * 100), s: l.s });
        if (l.k) pts.swolf.push({ x, y: l.t + l.k, s: l.s });
      }
      if (axis === "dist" && l.hr) pts.hr.push({ x, y: l.hr, s: l.s });
      prevIdle = false;
    }
    if (axis === "time") pts.hr = (act.hrs || []).map(r => ({ x: (r.t - act.start) / 60000, y: r.b }));
    return pts;
  }
  function drawCharts(t) {
    if (typeof Chart === "undefined") { setTimeout(() => drawCharts(t), 80); return; }
    const P = seriesOf(t), mut = css("--muted"), ln = css("--line"), acc = css("--accent"), sf = css("--surface");
    const col = p => p && p.s && STROKE_VAR[p.s] ? css(STROKE_VAR[p.s]) : acc;
    const xTitle = axis === "dist" ? "metry" : "minuty";
    const base = (yfmt, reverse) => ({
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: items => axis === "dist" ? `${Math.round(items[0].parsed.x)} ${U().u()}` : `${items[0].parsed.x.toFixed(1).replace(".", ",")} min`,
        label: c => " " + yfmt(c.parsed.y) + (c.raw && c.raw.s ? " · " + STROKE[c.raw.s] : "") } } },
      scales: {
        x: { type: "linear", grid: { display: false }, ticks: { color: mut, maxTicksLimit: 7, callback: v => axis === "dist" ? v + " " + U().u() : v + "′" }, title: { display: false, text: xTitle } },
        y: { reverse, grid: { color: ln }, border: { display: false }, ticks: { color: mut, maxTicksLimit: 5, callback: v => yfmt(v) } } } });
    const line = (data, fmt, reverse, pointsOnly) => ({
      type: "line",
      data: { datasets: [{ data, borderColor: pointsOnly ? "transparent" : ln, borderWidth: pointsOnly ? 0 : 1.5, spanGaps: false, tension: 0,
        pointRadius: pointsOnly ? 3.5 : 0, pointHoverRadius: 6, pointBackgroundColor: ctx => col(ctx.raw), pointBorderColor: sf, pointBorderWidth: 1,
        segment: { borderColor: () => ln } }] },
      options: base(fmt, reverse) });
    if ($("trPace")) {
      const cfg = line(P.pace, v => fmtPace(v), true, false); cfg.data.datasets[0].pointRadius = 3.5;
      charts.pace = new Chart($("trPace"), cfg);
    }
    if ($("trHr")) {
      const cfg = line(P.hr, v => Math.round(v) + " ud./min", false, false);
      // a red line on both axes (along the distance: the average of each length, broken by the rests)
      Object.assign(cfg.data.datasets[0], { borderColor: css("--bad"), borderWidth: 2, segment: undefined, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: css("--bad") });
      charts.hr = new Chart($("trHr"), cfg);
    }
    if ($("trSwolf")) {
      const cfg = line(P.swolf, v => (Math.round(v * 10) / 10).toString().replace(".", ","), false, false); cfg.data.datasets[0].pointRadius = 3.5;
      charts.swolf = new Chart($("trSwolf"), cfg);
    }
  }

  /* ---------- the big chart over the screen ---------- */
  const BIG = [["hr", "Tętno"], ["pace", "Tempo"], ["swolf", "SWOLF"], ["dist", "Dystans"]];
  // the lines of one training for the big chart; x = minutes from the start, or the distance swum so far (in the chosen unit)
  function bigSeries(t, ax) {
    const act = t.fit, min = ms => (ms - act.start) / 60000, out = { hr: [], pace: [], swolf: [], dist: [], rests: [] };
    let total = 0, run = 0, swims = 0;
    for (const l of act.lengths) {
      if (l.s === "idle") {
        const x = ax === "dist" ? U().d(total) : min((l.a + l.e) / 2);
        out.pace.push({ x, y: null }); out.swolf.push({ x, y: null }); if (ax === "dist") out.hr.push({ x, y: null });
        out.rests.push(ax === "dist" ? { at: U().d(total), t: l.t } : { a: min(l.a), e: min(l.e), t: l.t });
        run = 0; continue;
      }
      if (run === 0) {                      // a new swim: the distance line breaks and starts again from zero
        const x0 = ax === "dist" ? U().d(total) : min(l.a);
        if (swims++) out.dist.push({ x: x0, y: null });
        out.dist.push({ x: x0, y: 0 });
      }
      total += act.pool; run += act.pool;
      const xm = ax === "dist" ? U().d(total) : min((l.a + l.e) / 2), xe = ax === "dist" ? U().d(total) : min(l.e);
      out.dist.push({ x: xe, y: U().d(run) });
      if (STROKE_VAR[l.s]) { out.pace.push({ x: xm, y: U().pace(l.t / act.pool * 100), s: l.s }); if (l.k) out.swolf.push({ x: xm, y: l.t + l.k, s: l.s }); }
      if (ax === "dist" && l.hr) out.hr.push({ x: xm, y: l.hr });
    }
    if (ax === "time") out.hr = (act.hrs || []).map(r => ({ x: min(r.t), y: r.b }));
    return out;
  }
  function renderBig() {
    const el = $("trSheet"); if (!el) return;
    const t = big.open && openId && list.find(x => x.id === openId);
    if (charts.big) { charts.big.destroy(); delete charts.big; }
    if (!t || !t.fit) { el.hidden = true; el.innerHTML = ""; if (!document.querySelector(".sc-sheet:not([hidden])")) document.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; document.body.classList.add("sc-sheet-open");
    const any = BIG.some(([k]) => big.show[k]);
    el.innerHTML = `<div class="sc-backdrop" data-trbig="close"></div>
      <div class="panel sc-form tr-big" role="dialog" aria-modal="true" aria-labelledby="trBigT">
        <div class="row"><h2 id="trBigT">Szczegóły wykresu</h2><button class="btn" data-trbig="close">Zamknij</button></div>
        <p class="meta">${esc(longFmt.format(t.date))}</p>
        <div class="lf-chips" role="group" aria-label="Co pokazać">${BIG.map(([k, n]) => `<button type="button" class="chip tr-bk-${k}" data-trbig="show" data-k="${k}" aria-pressed="${big.show[k]}"><i aria-hidden="true"></i>${n}</button>`).join("")}</div>
        <div class="tr-bigrow">
          <label class="d-check"><input type="checkbox" data-trbig="rests" ${big.rests ? "checked" : ""}> <span>Pokaż przerwy</span></label>
          <div class="seg small" role="group" aria-label="Oś pozioma"><button class="seg-b" data-trbig="axis" data-ax="time" aria-pressed="${big.axis === "time"}">Po czasie</button><button class="seg-b" data-trbig="axis" data-ax="dist" aria-pressed="${big.axis === "dist"}">Po dystansie</button></div>
        </div>
        ${any ? `<div class="chart tr-bigchart"><canvas id="trBig" aria-label="Szczegóły wykresu"></canvas></div>` : `<p class="hint">Wybierz, co pokazać.</p>`}
        <p class="meta">${big.show.dist ? "<span>Dystans rośnie, gdy płyniesz bez przerwy, a po przerwie zaczyna od zera.</span> " : ""}${big.rests ? `<span>${big.axis === "time" ? "Szare pasy to przerwy, nad nimi ich długość." : "Kreski to przerwy, nad nimi ich długość."}</span>` : ""}</p>
      </div>`;
    if (any) drawBig(t);
  }
  function drawBig(t) {
    if (typeof Chart === "undefined") { setTimeout(() => drawBig(t), 80); return; }
    const cv = $("trBig"); if (!cv) return;
    const ax = big.axis, S = bigSeries(t, ax), u = U().u(), mut = css("--muted"), ln = css("--line"), acc = css("--accent"), sf = css("--surface");
    const col = p => (p && p.s && STROKE_VAR[p.s] ? css(STROKE_VAR[p.s]) : acc);
    const on = BIG.map(([k]) => k).filter(k => big.show[k]);
    const FMT = { hr: v => Math.round(v) + " ud./min", pace: v => fmtPace(v) + " /100 " + u, swolf: v => (Math.round(v * 10) / 10).toString().replace(".", ","), dist: v => Math.round(v) + " " + u };
    const NAME = Object.fromEntries(BIG);
    const ds = [], scales = {
      x: { type: "linear", grid: { display: false }, ticks: { color: mut, maxTicksLimit: 8, callback: v => (ax === "dist" ? v + " " + u : v + "′") } } };
    on.forEach((k, i) => {
      const id = "y" + k, side = i === 0 ? "left" : "right";
      scales[id] = { position: side, display: i < 2, reverse: k === "pace", beginAtZero: k === "dist", grid: { color: ln, drawOnChartArea: i === 0 }, border: { display: false },
        ticks: { color: k === "hr" ? css("--bad") : k === "dist" ? css("--rope") : mut, maxTicksLimit: 6, callback: v => FMT[k](v).replace(/ \/100 (m|yd)$/, "") } };
      const base = { label: NAME[k], data: S[k], yAxisID: id, spanGaps: false, tension: 0 };
      if (k === "hr") ds.push(Object.assign(base, { borderColor: css("--bad"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: css("--bad") }));
      else if (k === "dist") ds.push(Object.assign(base, { borderColor: css("--rope"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: css("--rope") }));
      else ds.push(Object.assign(base, { borderColor: ln, borderWidth: 1, pointStyle: k === "swolf" ? "triangle" : "circle", pointRadius: k === "swolf" ? 4.5 : 3.5, pointHoverRadius: 6,
        pointBackgroundColor: c => col(c.raw), pointBorderColor: sf, pointBorderWidth: 1 }));
    });
    // the rests: grey bands along the time (lines along the distance) with their length on top
    const rests = { id: "trRests", beforeDatasetsDraw(chart) {
      if (!big.rests) return;
      const xs = chart.scales.x, a = chart.chartArea, c = chart.ctx; c.save();
      c.font = "600 10px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "top";
      for (const r of S.rests) {
        if (ax === "time") {
          const x1 = xs.getPixelForValue(r.a), x2 = xs.getPixelForValue(r.e); if (x2 < a.left || x1 > a.right) continue;
          c.globalAlpha = 0.45; c.fillStyle = ln; c.fillRect(Math.max(x1, a.left), a.top, Math.min(x2, a.right) - Math.max(x1, a.left), a.bottom - a.top);
          c.globalAlpha = 1; c.fillStyle = mut; if (x2 - x1 > 22) c.fillText(fmtSec(r.t), (x1 + x2) / 2, a.top + 2);
        } else {
          const x = xs.getPixelForValue(r.at); if (x < a.left || x > a.right) continue;
          c.globalAlpha = 0.8; c.strokeStyle = mut; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, a.top + 12); c.lineTo(x, a.bottom); c.stroke(); c.setLineDash([]);
          c.globalAlpha = 1; c.fillStyle = mut; c.fillText(fmtSec(r.t), x, a.top);
        }
      }
      c.restore();
    } };
    charts.big = new Chart(cv, { type: "line", data: { datasets: ds }, plugins: [rests],
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "nearest", intersect: false, axis: "x" },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: items => (ax === "dist" ? `${Math.round(items[0].parsed.x)} ${u}` : `${items[0].parsed.x.toFixed(1).replace(".", ",")} min`),
          label: c => { const k = on[c.datasetIndex]; return " " + NAME[k] + ": " + FMT[k](c.parsed.y) + (c.raw && c.raw.s ? " · " + STROKE[c.raw.s] : ""); } } } },
        scales } });
  }
  function onBigClick(e) {
    const b = e.target.closest("[data-trbig]"); if (!b) return;
    const a = b.dataset.trbig;
    if (a === "close") { big.open = false; renderBig(); return; }
    if (a === "show") { big.show[b.dataset.k] = !big.show[b.dataset.k]; renderBig(); }
    else if (a === "axis") { big.axis = b.dataset.ax === "dist" ? "dist" : "time"; renderBig(); }
  }
  function onBigChange(e) { if (e.target.dataset && e.target.dataset.trbig === "rests") { big.rests = e.target.checked; renderBig(); } }

  function open(id) { openId = id; confirmDel = null; render(); onOpenChange && onOpenChange(id); try { window.scrollTo({ top: 0 }); } catch (e) {} }

  function mount(opts = {}) {
    onOpenChange = opts.onOpenChange || null;
    onDelete = opts.onDelete || null;
    compOpts = { comp: opts.comp, compDay: opts.compDay, setNotComp: opts.setNotComp, canWrite: opts.canMark };
    const root = $("trRoot"); if (!root) return;
    const sh = $("trSheet");
    if (sh) { sh.addEventListener("click", onBigClick); sh.addEventListener("change", onBigChange); }
    document.addEventListener("keydown", e => { if (e.key === "Escape" && big.open) { big.open = false; renderBig(); } });
    root.addEventListener("click", e => {
      const row = e.target.closest("[data-tr]");
      if (row) { open(row.dataset.tr); return; }
      const b = e.target.closest("[data-tract]"); if (!b) return;
      const a = b.dataset.tract;
      if (a === "back") {
        if (openId) { const t = list.find(x => x.id === openId); view = t && !t.swim ? "others" : "list"; openId = null; }
        else view = "list";
        render(); onOpenChange && onOpenChange(null); try { window.scrollTo({ top: 0 }); } catch (e) {}
      }
      else if (a === "others") { view = "others"; render(); try { window.scrollTo({ top: 0 }); } catch (e) {} }
      else if (a === "go" && b.dataset.to) { confirmDel = null; open(b.dataset.to); }
      else if (a === "delAsk") { confirmDel = openId; render(); const c = root.querySelector(".tr-confirm"); if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest" }); }
      else if (a === "delNo") { confirmDel = null; render(); }
      else if (a === "delYes") {
        const t = list.find(x => x.id === openId); confirmDel = null;
        if (t && onDelete) { view = t.swim ? "list" : "others"; openId = null; onDelete(t); onOpenChange && onOpenChange(null); }
      }
      else if (a === "axis") { axis = b.dataset.ax; render(); }
      else if (a === "big") { big.open = true; renderBig(); }
      else if ((a === "notComp" || a === "isComp") && openId && compOpts.setNotComp) { compOpts.setNotComp(openId, a === "notComp"); render(); }
    });
  }

  g.Trainings = { core, mount, setData, render, open, deltaChip, list: () => list, isOpen: () => !!openId };
  if (typeof module !== "undefined" && module.exports) module.exports = g.Trainings;
})(typeof window !== "undefined" ? window : globalThis);
