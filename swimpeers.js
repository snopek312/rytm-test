// Rytm: Pływanie → Analiza → "Na tle rówieśników" (27.10.2026). Your best time in each event against Polish boys of your age:
//   1) the sports classes of the Polish Swimming Federation (PZP, "Klasyfikacja sportowa w pływaniu na lata 2025–2028",
//      men, uchwała Zarządu PZP nr 09/01/2025): MM, M, I, II and the classes for an age — II/17,18, II/16, II/15, II/14, III/13, III/12
//      (age = calendar year − year of birth, as in Polish swimming);
//   2) the ranking of one year of birth in Poland (swimtop.pl, the best result of each swimmer born that year, all seasons,
//      boys): the times at places 1, 10, 25, 50, 75 and 100 — a snapshot of 27.10.2026, so it gets older with time.
// Nothing is fetched by the app: the numbers are written here. Only times — no names of anyone. Pure logic (Node-testable).
(function (g) {
  "use strict";
  const T = (m, s) => m * 60 + s;
  // column order of every row: MM, M, I, II, II/17,18, II/16, II/15, II/14, III/13, III/12 (the long events have no III classes)
  const CLASS_COLS = ["MM", "M", "I", "II", "II/17,18", "II/16", "II/15", "II/14", "III/13", "III/12"];
  const PZP = {
    25: {
      free: { 50: [20.80, 21.43, 22.14, 22.76, 24.34, 25.03, 26.09, 27.07, 29.25, 32.32], 100: [46.09, 47.15, 48.30, 49.84, 53.34, 54.86, 57.18, 59.54, T(1, 4.17), T(1, 13.05)],
        200: [T(1, 41.91), T(1, 44.21), T(1, 46.75), T(1, 49.52), T(1, 57.06), T(1, 59.87), T(2, 4.85), T(2, 10.76), T(2, 20.85), T(2, 36.47)],
        400: [T(3, 38.74), T(3, 44.41), T(3, 50.76), T(3, 56.30), T(4, 8.33), T(4, 14.66), T(4, 23.52), T(4, 35.54), T(4, 58.95), T(5, 22.34)],
        800: [T(7, 33.85), T(7, 46.82), T(8, 1.16), T(8, 15.09), T(8, 31.10), T(8, 44.78), T(9, 5.17), T(9, 33.44), T(10, 20.73), T(11, 18.36)],
        1500: [T(14, 32.10), T(14, 53.67), T(15, 17.05), T(15, 43.08), T(16, 17.07), T(16, 50.39), T(17, 18.10), T(17, 57.87)] },
      back: { 50: [22.89, 23.61, 24.44, 25.46, 27.44, 28.41, 29.82, 31.18, 33.61, 37.32], 100: [49.61, 51.18, 52.96, 55.67, 59.21, T(1, 1.12), T(1, 4.28), T(1, 6.96), T(1, 12.21), T(1, 22.11)],
        200: [T(1, 50.80), T(1, 54.21), T(1, 58.03), T(2, 3.21), T(2, 8.13), T(2, 13.45), T(2, 18.70), T(2, 25.66), T(2, 37.50), T(2, 54.47)] },
      breast: { 50: [25.77, 26.63, 27.63, 28.41, 30.38, 31.48, 32.71, 33.90, 36.69, 42.03], 100: [56.46, 58.26, T(1, 0.31), T(1, 2.24), T(1, 6.79), T(1, 8.62), T(1, 11.70), T(1, 14.32), T(1, 20.13), T(1, 33.61)],
        200: [T(2, 3.49), T(2, 7.55), T(2, 12.21), T(2, 17.46), T(2, 23.93), T(2, 28.77), T(2, 36.73), T(2, 41.82), T(2, 54.70), T(3, 16.56)] },
      fly: { 50: [22.09, 22.77, 23.54, 24.51, 25.92, 26.63, 27.90, 28.92, 31.32, 36.31], 100: [49.29, 50.78, 52.43, 54.45, 57.56, 58.72, T(1, 1.40), T(1, 4.36), T(1, 10.51), T(1, 24.36)],
        200: [T(1, 50.89), T(1, 54.62), T(1, 58.90), T(2, 3.16), T(2, 8.13), T(2, 12.03), T(2, 18.16), T(2, 24.73)] },
      im: { 100: [51.90, 53.37, 55.01, 56.91, 59.12, T(1, 0.85), T(1, 3.24), T(1, 6.17), T(1, 12.27), T(1, 22.32)],
        200: [T(1, 53.00), T(1, 56.93), T(2, 1.47), T(2, 5.13), T(2, 11.52), T(2, 15.32), T(2, 20.61), T(2, 27.18), T(2, 37.62), T(2, 57.38)],
        400: [T(4, 4.24), T(4, 10.56), T(4, 17.44), T(4, 29.52), T(4, 39.85), T(4, 47.58), T(4, 58.41), T(5, 9.37)] },
    },
    50: {
      free: { 50: [21.94, 22.33, 22.76, 23.45, 25.03, 25.72, 26.80, 27.80], 100: [48.41, 49.17, 49.92, 51.54, 54.85, 56.39, 58.74, T(1, 1.13)],
        200: [T(1, 46.37), T(1, 48.23), T(1, 50.18), T(1, 52.96), T(2, 0.37), T(2, 3.22), T(2, 8.24), T(2, 14.26)],
        400: [T(3, 47.14), T(3, 52.32), T(3, 57.78), T(4, 4.67), T(4, 15.35), T(4, 21.76), T(4, 30.77), T(4, 43.02)],
        800: [T(7, 48.28), T(8, 2.06), T(8, 17.48), T(8, 28.79), T(8, 41.80), T(9, 4.65), T(9, 20.44), T(9, 42.33)],
        1500: [T(15, 1.97), T(15, 23.87), T(15, 47.56), T(16, 10.36), T(16, 43.58), T(17, 14.31), T(17, 39.71), T(18, 41.66)] },
      back: { 50: [24.68, 25.28, 25.94, 26.88, 28.22, 29.21, 30.63, 32.02], 100: [53.71, 54.88, 56.15, 58.53, T(1, 0.89), T(1, 2.83), T(1, 6.02), T(1, 8.76)],
        200: [T(1, 57.58), T(2, 0.71), T(2, 4.12), T(2, 8.35), T(2, 13.50), T(2, 17.17), T(2, 23.66), T(2, 29.56)] },
      breast: { 50: [27.23, 27.88, 28.62, 29.49, 31.24, 32.35, 33.60, 34.81], 100: [59.68, T(1, 1.34), T(1, 3.18), T(1, 5.13), T(1, 8.68), T(1, 10.53), T(1, 13.65), T(1, 16.31)],
        200: [T(2, 9.95), T(2, 13.98), T(2, 17.90), T(2, 22.41), T(2, 28.00), T(2, 32.92), T(2, 40.99), T(2, 46.15)] },
      fly: { 50: [23.24, 23.67, 24.14, 24.93, 26.65, 27.37, 28.66, 29.69], 100: [51.62, 52.70, 53.88, 55.65, 59.19, T(1, 0.36), T(1, 3.07), T(1, 6.08)],
        200: [T(1, 55.96), T(1, 58.49), T(2, 1.91), T(2, 7.32), T(2, 10.18), T(2, 15.72), T(2, 21.91), T(2, 28.60)] },
      im: { 200: [T(1, 58.15), T(2, 1.84), T(2, 5.94), T(2, 9.88), T(2, 15.25), T(2, 19.10), T(2, 24.43), T(2, 31.12)],
        400: [T(4, 15.76), T(4, 22.55), T(4, 30.01), T(4, 38.99), T(4, 47.77), T(4, 55.61), T(5, 5.17), T(5, 16.93)] },
    },
  };
  const PZP_INFO = "Klasyfikacja sportowa PZP 2025–2028 (mężczyźni)";
  // the ranking of a year of birth: times at these places
  const PLACES = [1, 10, 25, 50, 75, 100];
  const RANK = {
    2011: { date: "2026-10-27", src: "swimtop.pl",
      25: { free: { 50: [23.24, 24.48, 25.07, 25.55, 25.90, 26.14], 100: [51.74, 53.72, 54.78, 56.02, 57.16, 57.86],
          200: [T(1, 52.40), T(1, 57.58), T(2, 1.41), T(2, 4.15), T(2, 6.81), T(2, 8.65)], 400: [T(3, 52.81), T(4, 9.48), T(4, 19.88), T(4, 27.64), T(4, 32.81), T(4, 36.01)] },
        back: { 50: [26.39, 27.58, 28.47, 29.72, 30.40, 31.01], 100: [56.72, T(1, 0.09), T(1, 1.65), T(1, 3.78), T(1, 5.93), T(1, 7.88)],
          200: [T(2, 1.86), T(2, 11.00), T(2, 15.28), T(2, 22.87), T(2, 30.14), T(2, 34.00)] },
        breast: { 50: [27.43, 30.82, 31.55, 32.55, 33.34, 33.99], 100: [T(1, 2.78), T(1, 7.50), T(1, 9.39), T(1, 11.74), T(1, 13.79), T(1, 15.73)],
          200: [T(2, 16.82), T(2, 28.40), T(2, 33.66), T(2, 41.51), T(2, 47.65), T(2, 55.77)] },
        fly: { 50: [25.18, 26.20, 27.09, 27.83, 28.35, 28.79], 100: [55.74, 58.53, T(1, 0.63), T(1, 2.77), T(1, 4.11), T(1, 5.99)],
          200: [T(2, 5.17), T(2, 13.94), T(2, 22.54), T(2, 33.09), T(2, 47.02), T(3, 26.98)] },
        im: { 100: [57.56, T(1, 1.42), T(1, 3.04), T(1, 4.41), T(1, 5.41), T(1, 6.59)], 200: [T(2, 4.20), T(2, 13.08), T(2, 17.45), T(2, 20.94), T(2, 24.53), T(2, 27.18)] } },
      50: { free: { 50: [24.23, 25.20, 25.69, 26.31, 26.56, 26.90], 100: [52.76, 54.96, 56.57, 57.54, 58.41, 59.05],
          200: [T(1, 52.61), T(1, 59.80), T(2, 4.65), T(2, 9.21), T(2, 11.19), T(2, 13.55)], 400: [T(3, 58.80), T(4, 16.70), T(4, 26.90), T(4, 37.57), T(4, 43.57), T(4, 49.82)] },
        back: { 50: [27.34, 28.76, 29.62, 30.67, 31.30, 32.13], 100: [58.91, T(1, 2.48), T(1, 4.95), T(1, 6.63), T(1, 9.42), T(1, 11.25)],
          200: [T(2, 7.27), T(2, 17.25), T(2, 21.29), T(2, 26.75), T(2, 34.06), T(2, 41.87)] },
        breast: { 50: [28.97, 31.62, 32.28, 33.50, 34.52, 35.35], 100: [T(1, 4.67), T(1, 9.20), T(1, 11.24), T(1, 14.37), T(1, 16.93), T(1, 19.77)],
          200: [T(2, 19.61), T(2, 33.35), T(2, 40.47), T(2, 46.75), T(2, 53.45), T(3, 1.47)] },
        fly: { 50: [25.60, 26.66, 27.47, 28.07, 28.73, 29.28], 100: [56.70, 59.25, T(1, 1.44), T(1, 4.40), T(1, 6.68), T(1, 8.31)],
          200: [T(2, 5.86), T(2, 16.67), T(2, 26.62), T(2, 37.39), T(2, 52.11), T(3, 15.09)] },
        im: { 200: [T(2, 9.34), T(2, 17.42), T(2, 22.25), T(2, 26.95), T(2, 30.58), T(2, 32.59)] } },
    },
  };
  const STROKE_ORDER = ["free", "back", "breast", "fly", "im"];

  // the age in a calendar year (as in Polish swimming) and the column of that age's class
  const ageIn = (born, year) => (born ? year - born : null);
  function ageCol(age) {
    if (age == null) return null;
    if (age <= 12) return 9; if (age === 13) return 8; if (age === 14) return 7; if (age === 15) return 6; if (age === 16) return 5; if (age <= 18) return 4;
    return 3;                                                                                  // 19 and older: the class II
  }
  const pzpRow = (pool, stroke, dist) => { const p = PZP[Math.round(pool)]; return (Math.abs(pool - Math.round(pool)) < 0.01 && p && p[stroke] && p[stroke][dist]) || null; };
  const colTime = (row, col) => (row && col != null && col < row.length ? row[col] : null);
  // the best class reached: MM, M, I, II, then the class of the age; {label, col} or null; plus the class of the age and the gap to it
  function classOf(time, pool, stroke, dist, age) {
    const row = pzpRow(pool, stroke, dist), ac = ageCol(age); if (!row || ac == null) return null;
    const cols = [0, 1, 2, 3].concat(ac > 3 && ac < row.length ? [ac] : []);
    const got = cols.find(c => time <= row[c] + 1e-9);
    const own = colTime(row, ac);
    const next = got == null ? (own != null ? ac : 3) : got > 0 ? (got === ac ? 3 : got - 1) : null;   // the next class to reach
    return { got: got == null ? null : { col: got, label: CLASS_COLS[got], time: row[got] }, own: own == null ? null : { col: ac, label: CLASS_COLS[ac], time: own },
      next: next == null ? null : { col: next, label: CLASS_COLS[next], time: row[next], gap: time - row[next] }, nextYear: ac > 3 ? { col: ageCol(age + 1), label: CLASS_COLS[ageCol(age + 1)], time: colTime(row, ageCol(age + 1)) } : null, row };
  }
  const rankRow = (born, pool, stroke, dist) => { const r = RANK[born]; const p = r && r[Math.round(pool)]; return (Math.abs(pool - Math.round(pool)) < 0.01 && p && p[stroke] && p[stroke][dist]) || null; };
  // the place in the ranking of the year of birth (interpolated between the known places); null = after the 100th
  function placeOf(time, row) {
    if (!row) return null;
    if (time <= row[0] + 1e-9) return 1;
    for (let i = 1; i < row.length; i++) {
      if (time <= row[i] + 1e-9) { const a = row[i - 1], b = row[i], pa = PLACES[i - 1], pb = PLACES[i]; return Math.max(pa, Math.min(pb, Math.round(pa + (time - a) / (b - a || 1) * (pb - pa)))); }
    }
    return null;
  }
  // every event with data for the pool, with the swimmer's best time (records: {key: {time, date, src, kind, pool, stroke, dist}})
  function rows(recs, pool, born, year) {
    const age = ageIn(born, year), out = [], P = PZP[pool]; if (!P) return out;
    const key = (s, d) => `${pool}|${s}|${d}`;
    for (const s of STROKE_ORDER) for (const d of Object.keys(P[s] || {}).map(Number).sort((a, b) => a - b)) {
      const r = recs && recs[key(s, d)], rank = rankRow(born, pool, s, d);
      out.push({ stroke: s, dist: d, pool, rec: r || null, cls: r ? classOf(r.time, pool, s, d, age) : (age != null ? classOf(Infinity, pool, s, d, age) : null), rank, place: r && rank ? placeOf(r.time, rank) : null, age });
    }
    return out;
  }
  const hasRank = born => !!RANK[born];

  const api = { CLASS_COLS, PZP, PZP_INFO, PLACES, RANK, STROKE_ORDER, ageIn, ageCol, pzpRow, classOf, rankRow, placeOf, rows, hasRank };
  g.RytmSwimPeers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
