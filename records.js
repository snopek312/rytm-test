// Rytm: results typed in by hand, for the records board (Pływanie → Rekordy).
// The watch does not always have everything: a competition (start from the block, official time to 0,01 s), a swim the
// watch did not record, or a watch time that is wrong. Such results are kept here and merged with the records computed
// from the FIT files: the board shows the fastest of both, the history of a record has both, and every hand-typed
// result is marked on the board ("zawody", "ręcznie", "poprawka").
// Saved state (one record in meta): {v:1, entries:[{id, pool, stroke, dist, time, date, kind, note, fix, fixTime}]}
//   kind     "zawody" (a competition) | "trening" (a training the watch missed)
//   fix      id of the FIT activity whose watch result for this pool/stroke/distance this entry corrects: that one watch
//            result stops counting (the activity's other distances are not touched); fixTime = the watch time it replaced
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const Swim = g.Swim || (typeof require === "function" ? require("./swim.js") : null);
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const IM = { id: "im", name: "Zmienny", inst: "stylem zmiennym" };
  const STROKES = Swim.STROKES.concat([IM]);
  const DISTS = [25, 50, 100, 200, 300, 400, 500, 800, 1000, 1500];
  const IM_DISTS = [100, 200, 400];
  const KINDS = [{ id: "zawody", name: "Zawody", tag: "zawody", long: "zawody (start ze słupka)" },
    { id: "trening", name: "Trening", tag: "ręcznie", long: "trening, wpisany ręcznie" }];
  const MAX_SPEED = 2.6;        // m/s: faster than any world record (50 m freestyle, short course ≈ 2,5 m/s) — surely a typo
  const r2 = x => Math.round(x * 100) / 100;
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : null);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayTs = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12).getTime(); };
  const strokeOf = id => STROKES.find(s => s.id === id) || null;
  const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];
  const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const keyOf = e => Swim.recKey(e.pool, e.stroke, e.dist);

  function defaults() { return { v: 1, entries: [] }; }
  // anything saved (or loaded from a backup) -> a clean state; broken entries are left out
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const seen = new Set();
    const entries = (Array.isArray(o.entries) ? o.entries : []).filter(e => e && typeof e.id === "string" && e.id && !seen.has(e.id)
        && strokeOf(e.stroke) && DISTS.includes(e.dist) && num(e.pool, 10, 100) != null && num(e.time, 0.01, 3599.99) != null && DAY.test(e.date || "") && seen.add(e.id))
      .map(e => {
        const fix = typeof e.fix === "string" && e.fix ? e.fix : null;
        return { id: e.id, pool: r2(e.pool), stroke: e.stroke, dist: e.dist, time: r2(e.time), date: e.date, kind: fix ? "trening" : kindOf(e.kind).id,
          note: str(e.note, 120), fix, fixTime: fix && num(e.fixTime, 0.01, 3600) != null ? e.fixTime : null };
      });
    return { v: 1, entries };
  }

  // the three time fields of the form (minutes, seconds, fraction after the comma) -> seconds, or an error text.
  // The fraction is read as decimals: "3" = 0,3 s, "32" = 0,32 s, "03" = 0,03 s.
  function parseTime(m, s, frac) {
    const t = v => String(v == null ? "" : v).trim();
    const M = t(m), S = t(s), F = t(frac);
    if (!S && !M && !F) return { error: "Wpisz czas, np. 1:05,32." };
    if ((M && !/^\d{1,2}$/.test(M)) || !/^\d{1,2}$/.test(S || "x") || (F && !/^\d{1,2}$/.test(F))) return { error: "Czas wpisz cyframi, np. 1 : 05 , 32." };
    if (+S > 59) return { error: "Sekundy muszą być od 0 do 59." };
    const sec = r2((+M || 0) * 60 + +S + (F ? +F / Math.pow(10, F.length) : 0));
    if (!(sec > 0)) return { error: "Wpisz czas, np. 1:05,32." };
    return { time: sec };
  }
  // a result that cannot be real (a typo): faster than any world record
  const tooFast = (dist, time) => dist / time > MAX_SPEED;

  // m:ss,cc (to 0,01 s) for hand-typed results; the watch's own times stay as the board shows them (to 0,1 s)
  function fmtHund(sec) {
    const c = Math.round(sec * 100), m = Math.floor(c / 6000), s = Math.floor((c % 6000) / 100), d = c % 100;
    return m + ":" + pad(s) + "," + pad(d);
  }
  const fmt = r => (r && r.src === "manual" ? fmtHund(r.time) : Swim.fmtTime(r.time));
  const tag = r => (!r || r.src !== "manual" ? "" : r.fix ? "poprawka" : kindOf(r.kind).tag);

  // all results per board cell: watch results (one per activity, the best inside it) and the hand-typed ones.
  // -> {"pool|stroke|dist": {stroke, dist, pool, time, date, src, actId, idx, entry, kind, note, fix, history:[...]}}
  // The record is the fastest result; the history is every result that beat the one before it, in date order — for
  // watch results alone this is exactly Swim.computeRecords (a tie keeps the earlier result).
  function merge(acts, bad, state) {
    const S = state && Array.isArray(state.entries) ? state : normalize(state);
    const lists = {}, push = (k, x) => (lists[k] || (lists[k] = [])).push(x);
    const fixed = new Set(S.entries.filter(e => e.fix).map(e => e.fix + "#" + keyOf(e)));
    const sorted = Object.values(acts || {}).filter(Swim.poolTrusted).sort((a, b) => a.start - b.start);
    for (const act of sorted) {
      const best = Swim.bestInActivity(act, new Set((bad && bad[act.id]) || []));
      for (const [k, b] of Object.entries(best)) {
        if (fixed.has(act.id + "#" + k)) continue;
        push(k, { time: b.time, date: act.start, src: "watch", actId: act.id, idx: b.idx, pool: act.pool, entry: null, kind: null, note: "", fix: null });
      }
    }
    for (const e of S.entries) push(keyOf(e), { time: e.time, date: dayTs(e.date), src: "manual", actId: null, idx: [], pool: e.pool, entry: e.id, kind: e.kind, note: e.note, fix: e.fix });
    const rec = {};
    for (const [k, list] of Object.entries(lists)) {
      list.sort((a, b) => a.date - b.date);
      const [, stroke, dist] = k.split("|");
      let r = null;
      for (const x of list) {
        if (r && !(x.time < r.time - 1e-9)) continue;
        const history = r ? r.history.slice() : [];
        history.push({ time: x.time, date: x.date, actId: x.actId, src: x.src, entry: x.entry, kind: x.kind, fix: x.fix });
        r = Object.assign({ stroke, dist: +dist }, x, { history });
      }
      rec[k] = r;
    }
    return rec;
  }

  // pool lengths for the switch above the board: those from trusted FIT files and those of hand-typed results
  function pools(acts, state) {
    const P = Swim.poolsOf(acts || {}), m = new Map(P.pools.map(p => [p.pool, { pool: p.pool, n: p.n, manual: 0 }]));
    for (const e of (state && state.entries) || []) { const x = m.get(e.pool) || { pool: e.pool, n: 0, manual: 0 }; x.manual++; m.set(e.pool, x); }
    return { pools: [...m.values()].sort((a, b) => a.pool - b.pool), excluded: P.excluded };
  }
  // the default pool: the one with the most FIT files, then the most typed results, then the shorter one
  const mainPool = list => (list.length ? [...list].sort((a, b) => b.n - a.n || b.manual - a.manual || a.pool - b.pool)[0].pool : null);
  // rows and columns of the board for a pool: the usual ones, plus 400/1500 m and "Zmienny" when a typed result needs them
  const inPool = (state, pool) => ((state && state.entries) || []).filter(e => e.pool === pool);
  const distances = (state, pool) => DISTS.filter(D => Swim.DISTANCES.includes(D) || inPool(state, pool).some(e => e.dist === D));
  const strokes = (state, pool) => (inPool(state, pool).some(e => e.stroke === "im") ? STROKES : Swim.STROKES);

  const core = { STROKES, DISTS, IM_DISTS, KINDS, MAX_SPEED, defaults, normalize, parseTime, tooFast, fmtHund, fmt, tag, merge, pools, mainPool, distances, strokes, dayKey, dayTs, keyOf };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmRecords = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtShort = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
  const fmtLong = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  const poolTxt = p => (Math.round(p * 100) / 100).toLocaleString("pl-PL") + " m";
  const what = e => `${e.dist} m ${(strokeOf(e.stroke) || IM).inst}`;
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, now = () => new Date();
  const ui = { sheet: null };
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const entry = id => S.entries.find(e => e.id === id) || null;
  const data = () => (P && P.data ? P.data() : { acts: {}, bad: {} });
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); ui.sheet = null; renderSheet(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  // the whole list is written at once; the screen changes now, the message comes only after the store confirmed the
  // save; if writing is off the screen goes back to what is stored
  function save(next, okText, undoTo) {
    if (!P || !P.save) return false;
    const prev = S;
    S = normalize(next);
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { S = normalize(P.load ? P.load() : prev); changed(); return false; }
    changed();
    const text = typeof okText === "function" ? okText() : okText;
    if (text && P.whenSaved) P.whenSaved(res, () => say().info(text, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
    return true;
  }

  /* ---------- the form (a sheet over the screen) ---------- */
  function poolChoices() {
    const set = new Set([25, 50]);
    for (const p of pools(data().acts, S).pools) set.add(p.pool);
    return [...set].sort((a, b) => a - b);
  }
  function splitTime(t) {
    if (t == null) return { m: "", s: "", f: "" };
    const c = Math.round(t * 100), m = Math.floor(c / 6000);
    return { m: m ? String(m) : "", s: pad(Math.floor((c % 6000) / 100)), f: pad(c % 100) };
  }
  function renderSheet() {
    const el = $("rmSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh) { el.hidden = true; el.innerHTML = ""; doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data, fixMode = !!d.fix;
    const chips = (name, list, cur) => list.map(([v, l]) => `<button type="button" class="chip" data-rmform="${name}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join("");
    const dists = d.stroke === "im" ? IM_DISTS : DISTS;
    const title = fixMode ? "Popraw czas z zegarka" : d.id ? "Edytuj wynik" : "Nowy wynik";
    const head = fixMode
      ? `<p class="meta" id="rmFixInfo">${esc(what(d))} · basen ${esc(poolTxt(d.pool))} · trening z ${esc(fmtLong.format(new Date(dayTs(d.date))))}${d.fixTime != null ? ` · zegarek: ${esc(Swim.fmtTime(d.fixTime))}` : ""}</p>
         <p class="hint">Wpisz prawdziwy czas tego odcinka (np. ze stopera trenera). Ten wynik z zegarka przestanie się liczyć, a inne dystanse z tego treningu zostaną bez zmian.</p>`
      : `<div class="sc-field"><span class="k">Rodzaj</span><div class="sc-cats">${chips("kind", KINDS.map(k => [k.id, k.name]), d.kind)}</div></div>
         <div class="sc-field"><span class="k">Basen</span><div class="sc-cats">${chips("pool", poolChoices().map(p => [p, poolTxt(p)]), d.pool)}</div></div>
         <div class="sc-field"><span class="k">Styl</span><div class="sc-cats">${chips("stroke", STROKES.map(s => [s.id, s.name]), d.stroke)}</div></div>
         <div class="sc-field"><span class="k">Dystans</span><div class="sc-cats">${chips("dist", dists.map(D => [D, D + " m"]), d.dist)}</div></div>`;
    const del = d.id ? `<button type="button" class="btn danger" data-rmform="del">${fixMode ? "Usuń poprawkę" : "Usuń wynik"}</button>` : "";
    el.innerHTML = `<div class="sc-backdrop" data-rmform="close"></div><form class="panel sc-form" id="rmForm" role="dialog" aria-modal="true" aria-labelledby="rmTitle" novalidate>
      <h2 id="rmTitle">${title}</h2>${head}
      <div class="sc-field"><span class="k">Czas</span><span class="rm-time">
        <input name="m" type="text" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="min" value="${esc(d.m)}" aria-label="Minuty"><span aria-hidden="true">:</span>
        <input name="s" type="text" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="sek" value="${esc(d.s)}" aria-label="Sekundy"><span aria-hidden="true">,</span>
        <input name="f" type="text" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="00" value="${esc(d.f)}" aria-label="Setne sekundy">
        <output id="rmPrev" class="meta"></output></span></div>
      ${fixMode ? "" : `<label class="sc-field"><span class="k">Data</span><input name="date" type="date" value="${esc(d.date)}" max="${esc(today())}"></label>`}
      <label class="sc-field"><span class="k">Opis</span><input name="note" type="text" maxlength="120" placeholder="${fixMode ? "np. czas ze stopera trenera" : "np. Mistrzostwa okręgu, finał"}" value="${esc(d.note)}"></label>
      <p class="sc-err" id="rmErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-rmform="close">Anuluj</button>${del}</div></form>`;
    preview();
  }
  // "= 1:05,32 · tempo 1:05 /100 m" under the time, as it is typed
  function preview() {
    const f = $("rmForm"), o = $("rmPrev"); if (!f || !o || !ui.sheet) return;
    const v = n => f.querySelector(`[name="${n}"]`).value, t = parseTime(v("m"), v("s"), v("f")), d = ui.sheet.data;
    o.textContent = t.time ? `= ${fmtHund(t.time)} · tempo ${Swim.fmtPace(t.time, d.dist)} /100 m` : "";
  }
  function readForm() {
    const f = $("rmForm"), d = ui.sheet.data;
    for (const n of ["m", "s", "f", "date", "note"]) { const el = f && f.querySelector(`[name="${n}"]`); if (el) d[n] = el.value; }
    return d;
  }
  function open(data) {
    if (!canWrite()) return false;
    const t = splitTime(data.time);
    ui.sheet = { data: Object.assign({ id: null, kind: "zawody", pool: 25, stroke: "free", dist: 100, date: today(), note: "", fix: null, fixTime: null }, data, { m: t.m, s: t.s, f: t.f }) };
    renderSheet();
    const first = doc.querySelector('#rmForm input[name="m"]'); if (first && first.focus) try { first.focus(); } catch (e) {}
    return true;
  }
  const openAdd = (o = {}) => open({ pool: o.pool || poolChoices()[0], stroke: o.stroke || "free", dist: o.dist || 100, kind: o.kind || "zawody", date: o.date || today() });
  function openEdit(id) { const e = entry(id); return e ? open(Object.assign({}, e)) : false; }
  // r: a watch record from the board (merge) — corrects that one watch result
  function openFix(r) {
    if (!r || r.src !== "watch") return false;
    const old = S.entries.find(e => e.fix === r.actId && keyOf(e) === Swim.recKey(r.pool, r.stroke, r.dist));
    if (old) return openEdit(old.id);
    return open({ pool: r.pool, stroke: r.stroke, dist: r.dist, kind: "trening", date: dayKey(new Date(r.date)), fix: r.actId, fixTime: r.time, time: r2(r.time) });
  }
  function close() { ui.sheet = null; renderSheet(); }

  function submit() {
    const d = readForm(), err = m => { const e = $("rmErr"); if (e) e.textContent = m; return false; };
    const t = parseTime(d.m, d.s, d.f);
    if (t.error) return err(t.error);
    if (d.stroke === "im" && !IM_DISTS.includes(d.dist)) return err("Styl zmienny pływa się na 100, 200 albo 400 m.");
    if (tooFast(d.dist, t.time)) return err(`${fmtHund(t.time)} na ${d.dist} m to szybciej niż rekord świata. Sprawdź czas (minuty : sekundy , setne).`);
    if (!DAY.test(d.date || "") || d.date > today()) return err("Wybierz datę (nie później niż dziś).");
    const next = exportState(), prev = exportState();
    const rec = { id: d.id || newId(), pool: d.pool, stroke: d.stroke, dist: d.dist, time: t.time, date: d.date, kind: d.fix ? "trening" : d.kind, note: (d.note || "").trim(), fix: d.fix || null, fixTime: d.fix ? d.fixTime : null };
    const old = d.id && next.entries.find(e => e.id === d.id);
    if (old) Object.assign(old, rec); else next.entries.push(rec);
    close();
    const label = `${what(rec)} — ${fmtHund(rec.time)}`;
    // whether it is the record now is known only after the change: the text is made when the save is confirmed
    const text = () => {
      if (rec.fix) return `Poprawiono czas: ${label}${rec.fixTime != null ? ` zamiast ${Swim.fmtTime(rec.fixTime)}` : ""}.`;
      const r = merge(data().acts, data().bad, S)[keyOf(rec)];
      const isRec = r && r.entry === rec.id;
      return `${old ? "Zapisano zmiany" : "Dodano wynik"}: ${label}${rec.kind === "zawody" ? " (zawody)" : ""}.${isRec ? " To twój rekord!" : r ? ` Rekord to nadal ${fmt(r)}.` : ""}`;
    };
    save(next, text, prev);
    return true;
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-rmform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.rmform, d = readForm();
    if (a === "close") close();
    else if (a === "kind") { d.kind = b.dataset.v; renderSheet(); }
    else if (a === "pool") { d.pool = Number(b.dataset.v); renderSheet(); }
    else if (a === "stroke") { d.stroke = b.dataset.v; if (d.stroke === "im" && !IM_DISTS.includes(d.dist)) d.dist = 200; renderSheet(); }
    else if (a === "dist") { d.dist = Number(b.dataset.v); renderSheet(); }
    else if (a === "del") {
      const x = entry(d.id); if (!x) return close();
      const prev = exportState(), next = exportState();
      next.entries = next.entries.filter(y => y.id !== x.id);
      close();
      save(next, x.fix ? `Usunięto poprawkę: ${what(x)} — liczy się znowu czas z zegarka.` : `Usunięto wynik: ${what(x)} — ${fmtHund(x.time)}.`, prev);
    }
  }

  /* ---------- the list of typed results (under the board, for the pool shown) ---------- */
  function renderList(pool, rec) {
    const el = $("recManual"); if (!el) return;
    const list = inPool(S, pool).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (!list.length) { el.hidden = true; el.innerHTML = ""; return; }
    const isRec = e => { const r = rec && rec[keyOf(e)]; return !!(r && r.entry === e.id); };
    el.hidden = false;
    el.innerHTML = `<div class="row"><h2>Wpisane ręcznie</h2><span class="meta">basen ${esc(poolTxt(pool))}</span></div>
      <ul class="rm-list">${list.map(e => `<li><button type="button" class="rm-row" data-rmact="edit" data-id="${esc(e.id)}" ${canWrite() ? "" : "disabled"} aria-label="Edytuj: ${esc(what(e))}, ${esc(fmtHund(e.time))}">
        <span class="rm-d">${esc(fmtShort.format(new Date(dayTs(e.date))))}</span>
        <span class="rm-w">${esc(what(e))}${e.note ? `<small>${esc(e.note)}</small>` : ""}</span>
        <span class="rm-t">${esc(fmtHund(e.time))}${isRec(e) ? `<small class="rm-rec">rekord</small>` : ""}</span>
        <span class="rm-tag">${esc(e.fix ? "poprawka" : kindOf(e.kind).tag)}</span></button></li>`).join("")}</ul>
      <p class="note">Dotknij wyniku, żeby go poprawić albo usunąć.</p>`;
  }

  function mount() {
    const sh = $("rmSheet");
    if (sh) {
      sh.addEventListener("click", onSheetClick);
      sh.addEventListener("input", preview);
      sh.addEventListener("submit", e => { e.preventDefault(); submit(); });
      doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) close(); });
    }
    const list = $("recManual");
    if (list) list.addEventListener("click", e => { const b = e.target.closest('[data-rmact="edit"]'); if (b && !b.disabled) openEdit(b.dataset.id); });
  }
  // tests only: a fixed "now"
  function setClock(fn) { now = fn || (() => new Date()); }

  const api = Object.assign({}, core, { attach, mount, exportState, setClock, openAdd, openEdit, openFix, close, renderList, entry, canWrite, ui,
    distances: pool => distances(S, pool), strokes: pool => strokes(S, pool), pools: acts => pools(acts, S), merge: (acts, bad) => merge(acts, bad, S) });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmRecords = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
