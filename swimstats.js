// Rytm: Pływanie → Analiza (27.10.2026) — the numbers behind the coach's comments, all from the user's own data.
// Pure logic, no page code (Node-testable). Uses Swim (swim.js) for the lengths that count (watch errors left out).
//   heart-rate zones   Z1 < 60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 ≥ 90% of the maximum heart rate (set by hand, or the
//                      highest one in the data); time in each zone from the heart-rate samples of the FIT file
//   CSS                Critical Swim Speed = (T400 − T200) / 2 per 100 m: from a test typed in, or estimated from the
//                      fastest continuous 400 m and 200 m freestyle in the files; pace zones around it
//   load               points of one training: minutes in each heart-rate zone × 1…5 (without heart rate: minutes × 2);
//                      acute = the last 7 days, chronic = a week on average over the last 28 days, and their ratio
//   technique          per stroke: stroke rate (strokes a minute) and distance per stroke (pool ÷ strokes), from each length
//   sets               swims of the same distance and stroke after one another (at least 3, with rests): e.g. 6 × 100 m freestyle;
//                      their pace, the spread, the drop at the end, and the same set in earlier trainings
//   points             World Aquatics points = 1000 × (base time ÷ time)³, men's base times (World Aquatics table of
//                      5.09.2026: 25 m pool valid 1.09.2026–31.08.2027, 50 m pool valid 1.01–31.12.2026)
// Saved state of the part "swim" (one record in meta): {v:1, hrMax:number|null, css:[{id, date, t400, t200}],
//   goals:[{id, stroke, dist, pool, time, by:"YYYY-MM-DD"|null, note}], born: year of birth|null (for "Na tle rówieśników")}
(function (g) {
  "use strict";
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)) : 0; };
  const S = () => g.Swim;
  const STROKES = ["free", "back", "breast", "fly"];
  const STROKE_NAME = { free: "kraul", back: "grzbiet", breast: "żabka", fly: "motyl", im: "zmienny" };
  const STROKE_EN = { free: "freestyle", back: "backstroke", breast: "breaststroke", fly: "butterfly", im: "medley" };
  const swims = list => (list || []).filter(t => t && t.swim);
  const badOf = (bad, act) => new Set((bad && bad[act.id]) || []);

  /* ---------- the saved part ---------- */
  function defaults() { return { v: 1, hrMax: null, css: [], goals: [], born: null }; }
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : null);
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  function normalize(o) {
    o = o && typeof o === "object" ? o : {};
    const ids = new Set(), fresh = x => x && typeof x.id === "string" && x.id && !ids.has(x.id) && ids.add(x.id);
    const css = (Array.isArray(o.css) ? o.css : []).filter(x => fresh(x) && DAY.test(x.date || "") && num(x.t400, 120, 1800) != null && num(x.t200, 50, 900) != null && x.t400 > x.t200)
      .map(x => ({ id: x.id, date: x.date, t400: Math.round(x.t400 * 100) / 100, t200: Math.round(x.t200 * 100) / 100 })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const goals = (Array.isArray(o.goals) ? o.goals : []).filter(x => fresh(x) && ["free", "back", "breast", "fly", "im"].includes(x.stroke) && num(x.dist, 25, 1500) != null
      && num(x.pool, 10, 100) != null && num(x.time, 5, 3600) != null)
      .map(x => ({ id: x.id, stroke: x.stroke, dist: x.dist, pool: Math.round(x.pool * 100) / 100, time: Math.round(x.time * 100) / 100, by: DAY.test(x.by || "") ? x.by : null, note: str(x.note, 120) }));
    const born = Number.isInteger(o.born) && o.born >= 1940 && o.born <= 2030 ? o.born : null;
    return { v: 1, hrMax: num(o.hrMax, 120, 240), css, goals, born };
  }

  /* ---------- heart-rate zones ---------- */
  const HR_ZONES = [{ z: 1, name: "Z1 regeneracja", lo: 0, hi: 0.6 }, { z: 2, name: "Z2 tlenowo", lo: 0.6, hi: 0.7 }, { z: 3, name: "Z3 tempo", lo: 0.7, hi: 0.8 },
    { z: 4, name: "Z4 próg", lo: 0.8, hi: 0.9 }, { z: 5, name: "Z5 maksimum", lo: 0.9, hi: 9 }];
  // the highest heart rate in the data (a training's maximum), when it looks real (150–230)
  function hrMaxAuto(list) { const v = swims(list).map(t => t.maxHr).filter(x => x >= 150 && x <= 230); return v.length ? Math.max(...v) : null; }
  const zoneOfHr = (b, hrMax) => { const f = b / hrMax; return f < 0.6 ? 0 : f < 0.7 ? 1 : f < 0.8 ? 2 : f < 0.9 ? 3 : 4; };
  // seconds in each zone [Z1..Z5] from the samples of one training (each sample lasts until the next one, at most 30 s)
  function hrZoneSecs(act, hrMax) {
    const h = (act && act.hrs) || []; if (!hrMax || h.length < 2) return null;
    const out = [0, 0, 0, 0, 0];
    for (let i = 0; i < h.length; i++) { const dt = i + 1 < h.length ? Math.min(30, Math.max(0, (h[i + 1].t - h[i].t) / 1000)) : 10; out[zoneOfHr(h[i].b, hrMax)] += dt; }
    return out;
  }
  // the zones over many trainings (from…to, day keys)
  function zonesOver(list, hrMax, from, to) {
    const out = [0, 0, 0, 0, 0]; let n = 0;
    for (const t of swims(list)) { const k = dayKey(t.date); if (k < from || k > to || !t.fit) continue; const z = hrZoneSecs(t.fit, hrMax); if (!z) continue; n++; z.forEach((s, i) => { out[i] += s; }); }
    const tot = out.reduce((a, b) => a + b, 0);
    return n ? { secs: out, total: tot, share: out.map(s => (tot ? s / tot : 0)), n } : null;
  }

  /* ---------- CSS (Critical Swim Speed) ---------- */
  const cssOf = (t400, t200) => (t400 > t200 && t200 > 0 ? (t400 - t200) / 2 : null);
  // the fastest continuous `meters` of a stroke in one activity (a metric pool that divides it), or null
  function bestIn(act, bad, meters, stroke) {
    const sw = S(); if (!sw || !act || !act.pool || sw.isYardPool && sw.isYardPool(act.pool)) return null;
    const n = meters / act.pool; if (Math.abs(n - Math.round(n)) > 1e-6) return null;
    let best = null;
    for (const run of sw.runsOf(act, badOf(bad, act))) {
      if (run.s !== stroke || run.idx.length < n) continue;
      const ts = run.idx.map(i => act.lengths[i].t);
      let sum = 0; for (let k = 0; k < n; k++) sum += ts[k];
      let min = sum; for (let k = n; k < ts.length; k++) { sum += ts[k] - ts[k - n]; if (sum < min) min = sum; }
      if (best == null || min < best) best = min;
    }
    return best;
  }
  function bestOver(acts, bad, meters, stroke, from) {
    let best = null;
    for (const act of Object.values(acts || {})) {
      if (from && dayKey(new Date(act.start)) < from) continue;
      if (S() && S().poolTrusted && !S().poolTrusted(act)) continue;
      const t = bestIn(act, bad, meters, stroke);
      if (t != null && (!best || t < best.time)) best = { time: t, date: dayKey(new Date(act.start)), actId: act.id };
    }
    return best;
  }
  // CSS from the files: the fastest continuous 400 m and 200 m freestyle (the last 120 days, then any time)
  function cssEstimate(acts, bad, today) {
    for (const from of [today ? addDays(today, -120) : null, null]) {
      const a = bestOver(acts, bad, 400, "free", from), b = bestOver(acts, bad, 200, "free", from);
      if (a && b && a.time > b.time) return { css: cssOf(a.time, b.time), t400: a, t200: b, recent: !!from };
    }
    return null;
  }
  // the CSS that counts: the newest test, else the estimate
  function cssNow(state, acts, bad, today) {
    const t = state && state.css && state.css.length ? state.css[state.css.length - 1] : null;
    if (t) return { css: cssOf(t.t400, t.t200), from: "test", date: t.date, test: t };
    const e = cssEstimate(acts, bad, today);
    return e ? { css: e.css, from: "estimate", date: e.t400.date > e.t200.date ? e.t400.date : e.t200.date, est: e } : null;
  }
  const PACE_ZONES = [{ z: 1, name: "regeneracja", d: "wolniej niż CSS + 12 s" }, { z: 2, name: "tlenowo", d: "CSS + 6…12 s" }, { z: 3, name: "tempo", d: "CSS + 2…6 s" },
    { z: 4, name: "próg (CSS)", d: "CSS ± 2 s" }, { z: 5, name: "szybkość", d: "szybciej niż CSS − 2 s" }];
  const paceZone = (pace, css) => { const d = pace - css; return d > 12 ? 0 : d > 6 ? 1 : d > 2 ? 2 : d >= -2 ? 3 : 4; };
  // seconds of freestyle in each pace zone (per length)
  function paceZoneSecs(act, css, bad) {
    if (!act || !css) return null;
    const sus = S() ? S().suspicious(act) : new Set(), b = badOf(bad, act), out = [0, 0, 0, 0, 0]; let n = 0;
    act.lengths.forEach((l, i) => { if (l.s !== "free" || !(l.t > 0) || sus.has(i) || b.has(i)) return; out[paceZone(l.t / act.pool * 100, css)] += l.t; n++; });
    return n ? out : null;
  }

  /* ---------- load ---------- */
  function loadOf(t, hrMax) {
    if (t.fit && hrMax) { const z = hrZoneSecs(t.fit, hrMax); if (z) return { pts: Math.round(z.reduce((a, s, i) => a + (s / 60) * (i + 1), 0)), by: "hr" }; }
    const min = (t.moving || t.total || 0) / 60;
    return min ? { pts: Math.round(min * 2), by: "time" } : null;
  }
  // acute (7 days), chronic (a week on average over 28 days), their ratio, and the last 8 weeks (Monday to Sunday)
  function loadStats(list, hrMax, today) {
    const byDay = new Map();
    for (const t of swims(list)) { const l = loadOf(t, hrMax); if (!l) continue; const k = dayKey(t.date); byDay.set(k, (byDay.get(k) || 0) + l.pts); }
    const sum = (a, b) => { let s = 0; for (const [k, v] of byDay) if (k >= a && k <= b) s += v; return s; };
    const acute = sum(addDays(today, -6), today), chronic = sum(addDays(today, -27), today) / 4;
    const dow = (parseDay(today).getDay() + 6) % 7, mon = addDays(today, -dow), weeks = [];
    for (let i = 7; i >= 0; i--) { const a = addDays(mon, -7 * i); weeks.push({ from: a, pts: sum(a, addDays(a, 6)) }); }
    return { acute, chronic: Math.round(chronic), ratio: chronic ? acute / chronic : null, weeks, days: byDay.size };
  }

  /* ---------- technique ---------- */
  // per stroke: {n lengths, rate (strokes a minute), dps (metres per stroke), swolf}
  function technique(act, bad) {
    if (!act) return {};
    const sus = S() ? S().suspicious(act) : new Set(), b = badOf(bad, act), acc = {};
    act.lengths.forEach((l, i) => {
      if (!STROKES.includes(l.s) || !(l.t > 0) || !(l.k > 0) || sus.has(i) || b.has(i)) return;
      const a = acc[l.s] || (acc[l.s] = { rate: [], dps: [], swolf: [] });
      a.rate.push(l.k / l.t * 60); a.dps.push(act.pool / l.k); a.swolf.push((l.t + l.k) * 25 / act.pool);
    });
    const out = {};
    for (const [s, a] of Object.entries(acc)) out[s] = { n: a.rate.length, rate: mean(a.rate), dps: mean(a.dps), swolf: mean(a.swolf) };
    return out;
  }
  // one stroke across trainings: [{date, id, rate, dps, swolf, n}] (only trainings with at least 4 such lengths)
  function techSeries(list, bad, stroke) {
    return swims(list).filter(t => t.fit).map(t => { const x = technique(t.fit, bad)[stroke]; return x && x.n >= 4 ? Object.assign({ date: dayKey(t.date), id: t.id }, x) : null; }).filter(Boolean);
  }
  // how the distance splits between the strokes (FIT trainings in the range)
  function strokeMix(list, from, to) {
    const m = { free: 0, back: 0, breast: 0, fly: 0, other: 0 }; let tot = 0;
    for (const t of swims(list)) {
      const k = dayKey(t.date); if (!t.fit || k < from || k > to) continue;
      for (const l of t.fit.lengths) { if (l.s === "idle") continue; const key = STROKES.includes(l.s) ? l.s : "other"; m[key] += t.fit.pool; tot += t.fit.pool; }
    }
    return tot ? { metres: m, total: tot, share: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / tot])) } : null;
  }

  /* ---------- sets ---------- */
  function intervals(act) {
    const out = []; let cur = null;
    act.lengths.forEach((l, i) => {
      if (l.s === "idle") { if (cur) { cur.rest = l.t; cur = null; } return; }
      if (!cur) { cur = { from: i, lens: [], rest: null }; out.push(cur); }
      cur.lens.push(l);
    });
    return out.map(iv => {
      const t = iv.lens.reduce((a, l) => a + l.t, 0), dist = iv.lens.length * act.pool, strokes = [...new Set(iv.lens.map(l => l.s))];
      return { dist, t, pace: t / dist * 100, stroke: strokes.length === 1 ? strokes[0] : "mixed", rest: iv.rest };
    });
  }
  // repeated swims: the same distance and stroke at least 3 times in a row
  function setsOf(act) {
    if (!act) return [];
    const ivs = intervals(act), out = [];
    let i = 0;
    while (i < ivs.length) {
      let j = i; while (j + 1 < ivs.length && ivs[j + 1].dist === ivs[i].dist && ivs[j + 1].stroke === ivs[i].stroke) j++;
      const reps = ivs.slice(i, j + 1);
      if (reps.length >= 3 && STROKES.includes(ivs[i].stroke) && ivs[i].dist >= 50) {
        const p = reps.map(r => r.pace), third = Math.max(1, Math.floor(p.length / 3));
        const first = mean(p.slice(0, third)), last = mean(p.slice(-third)), avg = mean(p);
        const rests = reps.slice(0, -1).map(r => r.rest).filter(x => x != null);
        out.push({ sig: `${ivs[i].dist}|${ivs[i].stroke}`, reps: reps.length, dist: ivs[i].dist, stroke: ivs[i].stroke, paces: p, avg, best: Math.min(...p), worst: Math.max(...p),
          spread: (Math.max(...p) - Math.min(...p)) / avg, cv: sd(p) / avg, drop: (last - first) / first, rest: rests.length ? mean(rests) : null });
      }
      i = j + 1;
    }
    return out;
  }
  // every training's sets, each with the same set (distance and stroke) the last time it was swum
  function setHistory(list) {
    const seen = new Map(), out = [];
    for (const t of swims(list).filter(t => t.fit)) {
      for (const s of setsOf(t.fit)) {
        const prev = seen.get(s.sig) || null;
        out.push(Object.assign({ date: dayKey(t.date), id: t.id, prev }, s));
        seen.set(s.sig, Object.assign({ date: dayKey(t.date), id: t.id }, s));
      }
    }
    return out;
  }

  /* ---------- World Aquatics points (men) ---------- */
  const T = (m, s) => m * 60 + s;
  const BASE = {
    25: { free: { 50: 19.90, 100: 44.84, 200: T(1, 38.61), 400: T(3, 32.25), 800: T(7, 20.46), 1500: T(14, 6.88) }, back: { 50: 22.11, 100: 48.16, 200: T(1, 45.12) },
      breast: { 50: 24.95, 100: 55.28, 200: T(1, 59.52) }, fly: { 50: 21.32, 100: 47.68, 200: T(1, 46.85) }, im: { 100: 49.28, 200: T(1, 48.88), 400: T(3, 54.81) } },
    50: { free: { 50: 20.91, 100: 46.40, 200: T(1, 42.00), 400: T(3, 39.96), 800: T(7, 32.12), 1500: T(14, 30.67) }, back: { 50: 23.55, 100: 51.60, 200: T(1, 51.92) },
      breast: { 50: 25.95, 100: 56.88, 200: T(2, 5.48) }, fly: { 50: 22.27, 100: 49.45, 200: T(1, 50.34) }, im: { 200: T(1, 52.69), 400: T(4, 2.50) } },
  };
  const BASE_INFO = "World Aquatics, mężczyźni: basen 25 m — czasy bazowe ważne 1.09.2026–31.08.2027, basen 50 m — ważne 1.01–31.12.2026";
  function points(stroke, dist, pool, time) {
    const b = BASE[Math.round(pool)] && Math.abs(pool - Math.round(pool)) < 0.01 && BASE[Math.round(pool)][stroke] && BASE[Math.round(pool)][stroke][dist];
    return b && time > 0 ? Math.floor(1000 * Math.pow(b / time, 3)) : null;
  }
  // the records with points: [{key, stroke, dist, pool, time, date, pts}] (events World Aquatics scores)
  function recordPoints(recs) {
    return Object.entries(recs || {}).map(([key, r]) => ({ key, stroke: r.stroke, dist: r.dist, pool: r.pool, time: r.time, date: r.date, src: r.src, pts: points(r.stroke, r.dist, r.pool, r.time), history: r.history || [] }))
      .filter(x => x.pts != null).sort((a, b) => b.pts - a.pts);
  }
  // the best of each stroke (points) and of sprint (50–100) against distance (200+)
  function strengths(recs) {
    const P = recordPoints(recs), byStroke = {}, by = { sprint: null, distance: null };
    for (const x of P) {
      if (!byStroke[x.stroke] || x.pts > byStroke[x.stroke].pts) byStroke[x.stroke] = x;
      const kind = x.dist <= 100 ? "sprint" : "distance";
      if (!by[kind] || x.pts > by[kind].pts) by[kind] = x;
    }
    return { list: P, byStroke, sprint: by.sprint, distance: by.distance };
  }

  /* ---------- records ---------- */
  // the newest improvement of any record (date, ms) and how many records were improved since `from`
  function recordNews(recs, fromMs) {
    let last = null, n = 0;
    for (const r of Object.values(recs || {})) { const d = r.date; if (last == null || d > last) last = d; if (fromMs != null && d >= fromMs && (r.history || []).length > 1) n++; }
    const firsts = Object.values(recs || {}).filter(r => fromMs != null && r.date >= fromMs && (r.history || []).length <= 1).length;
    return { last, improved: n, firsts };
  }
  // the best of each record key in recent activities, against the record: [{key, stroke, dist, pool, pb, best, gap (part), date}]
  function inReach(recs, acts, bad, fromKey) {
    const sw = S(); if (!sw) return [];
    const recent = {};
    for (const act of Object.values(acts || {})) {
      if (dayKey(new Date(act.start)) < fromKey || (sw.poolTrusted && !sw.poolTrusted(act))) continue;
      for (const [k, b] of Object.entries(sw.bestInActivity(act, badOf(bad, act)))) if (!recent[k] || b.time < recent[k].time) recent[k] = { time: b.time, date: dayKey(new Date(act.start)) };
    }
    const out = [];
    for (const [k, x] of Object.entries(recent)) { const r = recs && recs[k]; if (!r || x.time <= r.time + 1e-9) continue; out.push({ key: k, stroke: r.stroke, dist: r.dist, pool: r.pool, pb: r.time, best: x.time, gap: (x.time - r.time) / r.time, date: x.date }); }
    return out.sort((a, b) => a.gap - b.gap);
  }

  /* ---------- trends ---------- */
  // the average of the last k trainings against the k before them (k = up to 5, at least 2)
  function trend(list, key, kMax = 5) {
    const v = swims(list).filter(t => t[key] != null).map(t => t[key]); const n = v.length; if (n < 4) return null;
    const k = Math.min(kMax, Math.floor(n / 2)), a = mean(v.slice(n - 2 * k, n - k)), b = mean(v.slice(n - k));
    return { k, prev: a, cur: b, d: b - a, rel: a ? (b - a) / a : null };
  }
  // distance per week (Monday–Sunday) for the last `n` weeks, the newest last
  function weekly(list, today, n = 8) {
    const dow = (parseDay(today).getDay() + 6) % 7, mon = addDays(today, -dow), out = [];
    for (let i = n - 1; i >= 0; i--) { const a = addDays(mon, -7 * i), b = addDays(a, 6); let m = 0, c = 0; for (const t of swims(list)) { const k = dayKey(t.date); if (k >= a && k <= b) { m += t.dist || 0; c++; } } out.push({ from: a, metres: m, n: c }); }
    return out;
  }
  // days between trainings in the last `days` days: average and the longest gap (also up to today)
  function regularity(list, today, days = 60) {
    const ks = [...new Set(swims(list).map(t => dayKey(t.date)).filter(k => k > addDays(today, -days) && k <= today))].sort();
    if (!ks.length) return { n: 0, avgGap: null, longest: days, sinceLast: null };
    const gaps = []; for (let i = 1; i < ks.length; i++) gaps.push(daysBetween(ks[i - 1], ks[i]));
    const sinceLast = daysBetween(ks[ks.length - 1], today);
    return { n: ks.length, avgGap: gaps.length ? mean(gaps) : null, longest: Math.max(sinceLast, ...gaps, 0), sinceLast };
  }
  // how you swim after a break: trainings with ≥ 4 days since the previous one against those with ≤ 2 days
  function afterBreak(list) {
    const L = swims(list), out = { after: [], regular: [] };
    for (let i = 1; i < L.length; i++) {
      const gap = daysBetween(dayKey(L[i - 1].date), dayKey(L[i].date)), t = L[i];
      if (t.eff == null && t.pace == null) continue;
      if (gap >= 4) out.after.push(t); else if (gap <= 2) out.regular.push(t);
    }
    if (out.after.length < 2 || out.regular.length < 3) return null;
    const m = (arr, k) => mean(arr.map(t => t[k]).filter(x => x != null));
    const ea = m(out.after, "eff"), er = m(out.regular, "eff"), pa = m(out.after, "pace"), pr = m(out.regular, "pace");
    return { nAfter: out.after.length, nRegular: out.regular.length, effRel: ea && er ? (ea - er) / er : null, paceD: pa && pr ? pa - pr : null };
  }
  // sleep before training: the night ending on the training day, short (< goal − 1 h) against enough (≥ goal − 30 min)
  function sleepEffect(list, nights, goalH) {
    if (!nights || !nights.length || !goalH) return null;
    const dur = n => { const [bh, bm] = n.bed.split(":").map(Number), [wh, wm] = n.wake.split(":").map(Number); return ((wh * 60 + wm) - (bh * 60 + bm) + 1440) % 1440; };
    const byDay = new Map(nights.map(n => [n.date, dur(n)]));
    const short = [], ok = [];
    for (const t of swims(list)) { const d = byDay.get(dayKey(t.date)); if (d == null || (t.eff == null && t.pace == null)) continue; if (d < goalH * 60 - 60) short.push(t); else if (d >= goalH * 60 - 30) ok.push(t); }
    if (short.length < 2 || ok.length < 2) return { nShort: short.length, nOk: ok.length, effRel: null, paceD: null };
    const m = (arr, k) => mean(arr.map(t => t[k]).filter(x => x != null));
    const es = m(short, "eff"), eo = m(ok, "eff"), ps = m(short, "pace"), po = m(ok, "pace");
    return { nShort: short.length, nOk: ok.length, effRel: es && eo ? (es - eo) / eo : null, paceD: ps && po ? ps - po : null };
  }

  const api = { DAY, STROKES, STROKE_NAME, STROKE_EN, HR_ZONES, PACE_ZONES, BASE, BASE_INFO, defaults, normalize, dayKey, parseDay, addDays, daysBetween, mean, sd,
    hrMaxAuto, zoneOfHr, hrZoneSecs, zonesOver, cssOf, bestIn, bestOver, cssEstimate, cssNow, paceZone, paceZoneSecs, loadOf, loadStats, technique, techSeries, strokeMix,
    intervals, setsOf, setHistory, points, recordPoints, strengths, recordNews, inReach, trend, weekly, regularity, afterBreak, sleepEffect };
  g.RytmSwimStats = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
