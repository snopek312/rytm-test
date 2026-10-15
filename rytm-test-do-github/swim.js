// Mój Basen: reading pool lengths from Garmin FIT files and computing personal records.
// Pure logic, no page code. Needs the MBVendor bundle (Garmin FIT SDK + fflate).
(function (g) {
  "use strict";

  const DISTANCES = [25, 50, 100, 200, 300, 500, 800, 1000];
  const STROKES = [
    { id: "free", name: "Kraul", inst: "kraulem" },
    { id: "back", name: "Grzbiet", inst: "grzbietem" },
    { id: "breast", name: "Żabka", inst: "żabką" },
    { id: "fly", name: "Motyl", inst: "motylkiem" },
  ];
  const FIT_STROKE = { freestyle: "free", backstroke: "back", breaststroke: "breast", butterfly: "fly", drill: "drill", mixed: "mixed", im: "mixed" };
  // Watch errors: when the watch sees an extra turn it splits one length into two short ones,
  // or it guesses the wrong stroke. Such lengths must not become records. Three checks:
  //  1. faster than world-class speed for that stroke (m/s, 25 m with a push-off),
  //  2. far faster than this session's typical length (compared as "freestyle-equivalent" time),
  //  3. far fewer strokes than the typical length of that stroke in this session.
  const MAX_SPEED_BY = { free: 2.4, back: 2.15, breast: 1.9, fly: 2.2 };
  const STROKE_FACTOR = { free: 1, back: 1.12, breast: 1.25, fly: 1.08 };   // typical time vs freestyle
  const FAST_RATIO = 0.6, STROKES_RATIO = 0.55;
  const MAX_GAP_MS = 3000; // a longer pause between two lengths ends a continuous swim

  // ---------- reading files ----------

  function isZip(u8) { return u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04; }

  // files: [{name, bytes: Uint8Array}] -> flat list of {name, bytes} that look like FIT files.
  // log (optional array) collects a plain-language line for every file that was skipped.
  function expandFiles(files, depth = 0, log = null) {
    const out = [];
    for (const f of files) {
      if (isZip(f.bytes)) {
        if (depth > 3) continue;
        let entries;
        try { entries = g.MBVendor.unzipSync(f.bytes); }
        catch (e) { log && log.push(`${f.name}: nie udało się rozpakować (${e && e.message || e})`); continue; }
        const names = Object.keys(entries);
        const inner = names.filter(n => /\.(fit|zip)$/i.test(n) && entries[n].length).map(n => ({ name: n, bytes: entries[n] }));
        if (!inner.length && log) log.push(`${f.name}: w środku nie ma pliku .fit (${names.length ? names.slice(0, 3).join(", ") : "pusty"})`);
        out.push(...expandFiles(inner, depth + 1, log));
      } else if (/\.fit$/i.test(f.name) || looksLikeFit(f.bytes)) {
        out.push(f);
      } else if (log) {
        log.push(`${f.name}: to nie jest plik .fit ani .zip (${f.bytes.length} B)`);
      }
    }
    return out;
  }
  function looksLikeFit(u8) { return u8.length > 12 && u8[8] === 0x2e && u8[9] === 0x46 && u8[10] === 0x49 && u8[11] === 0x54; }

  // One FIT file -> a pool-swim activity or null (not a pool swim).
  // {id, start, pool, lengths:[{s,t,a,e,k,hr}], sum:{dist,timer,elapsed,avgHr,maxHr,kcal,te}, hrs:[{t,b}]}
  //   s stroke, t seconds, a/e start/end (ms), k strokes in the length, hr average heart rate in the length
  function parseFit(u8) {
    const { Decoder, Stream } = g.MBVendor;
    const stream = Stream.fromArrayBuffer(u8.slice().buffer);
    if (!Decoder.isFIT(stream)) return { skipped: "notFit" };
    const { messages } = new Decoder(stream).read({ convertDateTimesToDates: true, mergeHeartRates: true, includeUnknownData: false });
    const sessions = messages.sessionMesgs || [];
    const lengths = messages.lengthMesgs || [];
    const sport = sessions[0] ? [sessions[0].sport, sessions[0].subSport].filter(Boolean).join(" / ") : "";
    if (!lengths.length) return { skipped: "noLengths", sport };
    const ses = sessions.find(s => s.poolLength) || sessions[0];
    if (!ses || !ses.poolLength) return { skipped: "noPool", sport };
    if (ses.poolLengthUnit && ses.poolLengthUnit !== "metric") return { skipped: "yards" };
    const pool = Math.round(ses.poolLength * 100) / 100;
    const start = +(ses.startTime || lengths[0].startTime || lengths[0].timestamp);
    // what the file itself says about the pool, kept so the pool length can be checked later
    const poolSrc = { len: ses.poolLength, unit: ses.poolLengthUnit || null,
      dist: ses.totalDistance != null ? ses.totalDistance : null, active: ses.numActiveLengths != null ? ses.numActiveLengths : null };

    // heart rate samples from records (heart-rate straps are merged into records by the SDK)
    const raw = (messages.recordMesgs || []).filter(r => r.heartRate > 0 && r.timestamp).map(r => ({ t: +r.timestamp, b: r.heartRate }));
    raw.sort((x, y) => x.t - y.t);

    const list = lengths
      .map((l, i) => ({ l, i }))
      .sort((x, y) => (x.l.startTime - y.l.startTime) || ((x.l.messageIndex ?? x.i) - (y.l.messageIndex ?? y.i)))
      .map(({ l }) => {
        const t = l.totalTimerTime ?? l.totalElapsedTime ?? 0;
        const el = l.totalElapsedTime ?? t;
        // Some watches write the same timestamp (the session start) on every length,
        // so the end of a length is its start plus its duration.
        const a = l.startTime ? +l.startTime : (l.timestamp ? +l.timestamp - el * 1000 : 0);
        const e = a + el * 1000;
        const s = l.lengthType === "idle" ? "idle" : (FIT_STROKE[l.swimStroke] || "other");
        const k = l.totalStrokes > 0 ? l.totalStrokes : null;
        return { s, t: Math.round(t * 1000) / 1000, a, e, k, hr: avgHrIn(raw, a, e) };
      });

    const active = list.filter(L => L.s !== "idle");
    const sum = {
      dist: ses.totalDistance || active.length * pool,
      timer: ses.totalTimerTime || null,
      elapsed: ses.totalElapsedTime || null,
      avgHr: ses.avgHeartRate || (raw.length ? Math.round(raw.reduce((x, r) => x + r.b, 0) / raw.length) : null),
      maxHr: ses.maxHeartRate || (raw.length ? Math.max(...raw.map(r => r.b)) : null),
      kcal: ses.totalCalories || null,
      te: ses.totalTrainingEffect || null,
    };
    return { id: new Date(start).toISOString(), start, pool, poolSrc, lengths: list, sum, hrs: downsample(raw, 10000) };
  }
  // average heart rate between two times; samples just around a short length also count
  function avgHrIn(raw, a, e) {
    if (!raw.length) return null;
    let sum = 0, n = 0;
    for (const r of raw) { if (r.t >= a && r.t <= e) { sum += r.b; n++; } else if (r.t > e) break; }
    if (n) return Math.round(sum / n);
    let best = null;                              // nearest sample within 10 s
    for (const r of raw) { const d = Math.min(Math.abs(r.t - a), Math.abs(r.t - e)); if (d <= 10000 && (!best || d < best.d)) best = { d, b: r.b }; }
    return best ? best.b : null;
  }
  // one averaged sample per step (ms) keeps storage small
  function downsample(raw, step) {
    const out = []; let bucket = null, sum = 0, n = 0;
    for (const r of raw) {
      const b = Math.floor(r.t / step);
      if (b !== bucket && n) { out.push({ t: bucket * step + step / 2, b: Math.round(sum / n) }); sum = 0; n = 0; }
      bucket = b; sum += r.b; n++;
    }
    if (n) out.push({ t: bucket * step + step / 2, b: Math.round(sum / n) });
    return out;
  }

  // ---------- records ----------

  // Splits an activity into runs of continuous, same-stroke, believable lengths.
  const median = arr => { const a = [...arr].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const suspCache = new WeakMap();
  // indexes of lengths that look like watch errors (see the three checks above)
  function suspicious(act) {
    if (suspCache.has(act)) return suspCache.get(act);
    const out = new Set();
    const sw = act.lengths.map((l, i) => ({ l, i })).filter(x => STROKE_FACTOR[x.l.s] && x.l.t > 0);
    if (sw.length) {
      const eq = median(sw.map(x => x.l.t / STROKE_FACTOR[x.l.s]));
      const kMed = {};
      for (const st of Object.keys(STROKE_FACTOR)) {
        const ks = sw.filter(x => x.l.s === st && x.l.k).map(x => x.l.k);
        if (ks.length >= 4) kMed[st] = median(ks);
      }
      for (const { l, i } of sw) {
        if (act.pool / l.t > MAX_SPEED_BY[l.s]) out.add(i);
        else if (sw.length >= 6 && l.t / STROKE_FACTOR[l.s] < FAST_RATIO * eq) out.add(i);
        else if (kMed[l.s] >= 6 && l.k && l.k < STROKES_RATIO * kMed[l.s]) out.add(i);
      }
    }
    suspCache.set(act, out);
    return out;
  }

  function runsOf(act, badSet) {
    const runs = [], sus = suspicious(act);
    let cur = null;
    act.lengths.forEach((L, i) => {
      const ok = STROKES.some(s => s.id === L.s) && L.t > 0 && !sus.has(i) && !badSet.has(i);
      const prev = cur && cur.idx.length ? act.lengths[cur.idx[cur.idx.length - 1]] : null;
      const joins = ok && cur && cur.s === L.s && prev && (L.a - prev.e) <= MAX_GAP_MS;
      if (!ok) { cur = null; return; }
      if (!joins) { cur = { s: L.s, idx: [] }; runs.push(cur); }
      cur.idx.push(i);
    });
    return runs;
  }

  // ---------- pool length ----------
  // The pool length comes from the FIT file (the value set on the watch before the swim).
  // It is trusted for records only when the file is consistent with it:
  //   ok          unit is metres and the file's own totals match lengths × pool length
  //   unverified  unit is metres but the file has no totals to compare with
  //   mismatch    the file's totals do not match lengths × pool length  -> left out of records
  //   no-unit     the file does not say metres or yards                 -> left out of records
  function poolCheck(act) {
    const n = act.lengths.filter(l => l.s !== "idle").length;
    const src = act.poolSrc;
    if (src) {
      if (src.unit !== "metric") return { status: "no-unit", n };
      const checks = [];
      if (src.active != null) checks.push(src.active === n);
      if (src.dist != null) checks.push(Math.abs(src.dist - n * src.len) <= Math.max(1, src.dist * 0.01));
      if (!checks.length) return { status: "unverified", n };
      return { status: checks.every(Boolean) ? "ok" : "mismatch", n, fileDist: src.dist, fileActive: src.active };
    }
    // saved before the pool facts were kept: only the stored total distance can be compared
    const d = act.sum && act.sum.dist;
    if (d == null) return { status: "unverified", n };
    return { status: Math.abs(d - n * act.pool) <= Math.max(1, d * 0.01) ? "unverified" : "mismatch", n, fileDist: d };
  }
  const poolTrusted = act => { const s = poolCheck(act).status; return s === "ok" || s === "unverified"; };
  const fmtPool = p => (Math.round(p * 100) / 100).toLocaleString("pl-PL") + " m";
  // pools that have trusted activities, and activities left out of records with the reason
  function poolsOf(acts) {
    const count = new Map(), excluded = [];
    for (const a of Object.values(acts)) {
      const c = poolCheck(a);
      if (c.status === "ok" || c.status === "unverified") count.set(a.pool, (count.get(a.pool) || 0) + 1);
      else excluded.push({ id: a.id, start: a.start, pool: a.pool, ...c });
    }
    const pools = [...count.entries()].sort((x, y) => x[0] - y[0]).map(([pool, n]) => ({ pool, n }));
    return { pools, excluded };
  }
  const recKey = (pool, stroke, dist) => `${Math.round(pool * 100) / 100}|${stroke}|${dist}`;

  // Best time of each (stroke, distance) inside one activity.
  function bestInActivity(act, badSet) {
    const best = {};
    for (const run of runsOf(act, badSet)) {
      const times = run.idx.map(i => act.lengths[i].t);
      for (const D of DISTANCES) {
        const nf = D / act.pool, n = Math.round(nf);
        if (n < 1 || Math.abs(nf - n) > 1e-6 || times.length < n) continue;
        let sum = 0;
        for (let k = 0; k < n; k++) sum += times[k];
        let min = sum, at = 0;
        for (let k = n; k < times.length; k++) {
          sum += times[k] - times[k - n];
          if (sum < min - 1e-9) { min = sum; at = k - n + 1; }
        }
        const key = recKey(act.pool, run.s, D);
        if (!best[key] || min < best[key].time) best[key] = { time: min, idx: run.idx.slice(at, at + n) };
      }
    }
    return best;
  }

  // All activities -> {"pool|stroke|dist": {pool, stroke, dist, time, date, actId, idx, history:[{time,date,actId}]}}
  // Records are kept separately for every pool length; activities whose pool length is not trusted are left out.
  function computeRecords(acts, bad) {
    const sorted = Object.values(acts).filter(poolTrusted).sort((a, b) => a.start - b.start);
    const rec = {};
    for (const act of sorted) {
      const best = bestInActivity(act, new Set((bad && bad[act.id]) || []));
      for (const [key, b] of Object.entries(best)) {
        const r = rec[key];
        if (!r || b.time < r.time - 1e-9) {
          const [, stroke, dist] = key.split("|");
          const history = r ? r.history.slice() : [];
          history.push({ time: b.time, date: act.start, actId: act.id });
          rec[key] = { stroke, dist: +dist, time: b.time, date: act.start, actId: act.id, idx: b.idx, pool: act.pool, history };
        }
      }
    }
    return rec;
  }

  // Which records changed between two record sets (for the "new records" message).
  function diffRecords(before, after) {
    const out = [];
    for (const [key, r] of Object.entries(after)) {
      const old = before[key];
      if (!old) out.push({ key, rec: r, prev: null });
      else if (r.time < old.time - 1e-9) out.push({ key, rec: r, prev: old.time });
    }
    return out.sort((a, b) => (a.prev === null) - (b.prev === null) || a.rec.dist - b.rec.dist);
  }

  // ---------- storage format (compact) ----------
  function pack(act) {
    return { v: 4, id: act.id, start: act.start, pool: act.pool, P: act.poolSrc || null, sum: act.sum || null,
      L: act.lengths.map(l => [l.s, Math.round(l.t * 1000), Math.round((l.a - act.start) / 1000), Math.round((l.e - act.start) / 1000), l.k ?? null, l.hr ?? null]),
      H: (act.hrs || []).map(r => [Math.round((r.t - act.start) / 1000), r.b]) };
  }
  function unpack(p) {
    return { id: p.id, start: p.start, pool: p.pool, poolSrc: p.P || null, sum: p.sum || null,
      // files read before version 3 could have an end time before the start (see parseFit); repair it here
      lengths: p.L.map(([s, tm, a, e, k, hr]) => ({ s, t: tm / 1000, a: p.start + a * 1000, e: p.start + (e < a ? a + tm / 1000 : e) * 1000, k: k ?? null, hr: hr ?? null })),
      hrs: (p.H || []).map(([t, b]) => ({ t: p.start + t * 1000, b })) };
  }

  // ---------- formatting ----------
  function fmtTime(sec) {
    const tenths = Math.round(sec * 10);
    const m = Math.floor(tenths / 600), s = Math.floor((tenths % 600) / 10), d = tenths % 10;
    return m + ":" + String(s).padStart(2, "0") + "," + d;
  }
  function fmtPace(sec, dist) {
    const p = Math.round(sec / dist * 100);
    return Math.floor(p / 60) + ":" + String(p % 60).padStart(2, "0");
  }

  const api = { DISTANCES, STROKES, expandFiles, parseFit, runsOf, suspicious, bestInActivity, computeRecords, diffRecords, pack, unpack, fmtTime, fmtPace,
    poolCheck, poolTrusted, poolsOf, recKey, fmtPool };
  g.Swim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
