// Rytm: bridge between the app's data and the store (stage 2B).
// The app keeps the same shapes as in stage 1:
//   FIT:    {acts:{id: pack}, bad:{id:[i]}, last:[id], hidden:{rowId: iso}}
//   habits: {habits:[...], log:{day:{habitId:value}}, notes:{day:text}, skips:{day:reason}}
//   CSV text, the stopwatch, the "undo import" copy.
// Loading turns store records into fresh, editable copies. Saving compares the app's data with the store and sends
// ONE batch with only what changed; removed items become deletion markers. The mapping is the one used (and verified)
// by the migration in migrate.js. If writing is off, the store refuses the batch: onBlocked is called and the error is
// thrown, so the caller can put the screen back to what is really stored. Nothing here touches localStorage.
(function (g) {
  "use strict";
  const Migrate = g.RytmMigrate || (typeof require === "function" ? require("./migrate.js") : null);
  const canon = Migrate.canon;
  const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ENVELOPE = ["id", "updatedAt", "deleted"];
  function bare(rec) { const o = {}; for (const k of Object.keys(rec)) if (!ENVELOPE.includes(k)) o[k] = rec[k]; return o; }

  function create(store, { onBlocked } = {}) {
    const packRefs = new Map();     // FIT id -> the pack object last loaded/saved; the same object means the same pack

    function commit(ops) {
      if (!ops.length) return Promise.resolve({ changed: 0 });
      let p;
      try { p = store.apply(ops); }
      catch (e) { if (onBlocked) { try { onBlocked(e); } catch (x) {} } throw e; }
      const done = p.then(() => ({ changed: ops.length }));
      done.catch(() => {});          // failures are shown from the store's status; callers decide what else to do
      return done;
    }
    // desired: Map id -> value without the envelope. Records of `coll` that `own` accepts and are not desired get deleted.
    function diff(coll, desired, own = () => true) {
      const ops = [];
      for (const [id, value] of desired) {
        const cur = store.get(coll, id);
        if (!cur || canon(bare(cur)) !== canon(value)) ops.push({ coll, id, value });
      }
      for (const rec of store.all(coll)) if (own(rec.id) && !desired.has(rec.id)) ops.push({ coll, id: rec.id, delete: true });
      return ops;
    }
    const metaOnly = id => x => x === id;

    /* ---------- trainings from FIT files ---------- */
    function loadFit() {
      const out = { acts: {}, bad: {}, last: [], hidden: {} };
      packRefs.clear();
      for (const r of store.all("fitActivities")) { const p = copy(r.pack); out.acts[r.id] = p; packRefs.set(r.id, p); }
      for (const r of store.all("badLengths")) out.bad[r.id] = copy(r.lengths);
      for (const r of store.all("hiddenRows")) out.hidden[r.id] = r.at;
      const last = store.get("meta", "fitLast");
      if (last) out.last = copy(last.list);
      return out;
    }
    function fitOps(state) {
      const acts = state.acts || {}, ops = [];
      for (const id of Object.keys(acts)) {
        const pack = acts[id], cur = store.get("fitActivities", id);
        if (cur && packRefs.get(id) === pack) continue;
        if (!cur || canon(cur.pack) !== canon(pack)) ops.push({ coll: "fitActivities", id, value: { pack } });
      }
      for (const rec of store.all("fitActivities")) if (!has(acts, rec.id)) ops.push({ coll: "fitActivities", id: rec.id, delete: true });
      const bad = new Map(Object.entries(state.bad || {}).map(([id, lengths]) => [id, { lengths }]));
      const hidden = new Map(Object.entries(state.hidden || {}).map(([id, at]) => [id, { at }]));
      return ops.concat(diff("badLengths", bad), diff("hiddenRows", hidden),
        diff("meta", new Map([["fitLast", { list: state.last || [] }]]), metaOnly("fitLast")));
    }
    function saveFit(state) {
      const p = commit(fitOps(state));
      for (const id of Object.keys(state.acts || {})) packRefs.set(id, state.acts[id]);
      return p;
    }

    /* ---------- habits ---------- */
    // null = no habit list was ever saved (the app then shows its starter list)
    function loadHabits() {
      const list = store.get("meta", "habitsList"), hs = store.all("habits"), days = store.all("habitDays");
      if (!list && !hs.length && !days.length) return null;
      const S = { habits: hs.slice().sort((a, b) => a.order - b.order).map(r => copy(r.habit)), log: {}, notes: {}, skips: {} };
      for (const d of days) {
        if ("values" in d) S.log[d.id] = copy(d.values);
        if ("note" in d) S.notes[d.id] = d.note;
        if ("skip" in d) S.skips[d.id] = d.skip;
      }
      return S;
    }
    function habitOps(S) {
      const hs = new Map();
      (S.habits || []).forEach((h, i) => hs.set(h.id, { order: i, habit: h }));
      const days = new Map();
      const day = k => { if (!days.has(k)) days.set(k, {}); return days.get(k); };
      for (const [k, v] of Object.entries(S.log || {})) day(k).values = v;
      for (const [k, v] of Object.entries(S.notes || {})) day(k).note = v;
      for (const [k, v] of Object.entries(S.skips || {})) day(k).skip = v;
      return diff("habits", hs).concat(diff("habitDays", days), diff("meta", new Map([["habitsList", { saved: true }]]), metaOnly("habitsList")));
    }
    const saveHabits = S => commit(habitOps(S));

    /* ---------- CSV, stopwatch, undo copy ---------- */
    function loadCsv() { const r = store.get("swimCsv", "main"); return r ? r.text : null; }
    const saveCsv = text => commit(diff("swimCsv", text == null ? new Map() : new Map([["main", { text }]])));
    function loadTimer() { const r = store.get("meta", "timer"); const t = r && r.value; return t && t.hid && t.start ? copy(t) : null; }
    const saveTimer = t => commit(diff("meta", t ? new Map([["timer", { value: t }]]) : new Map(), metaOnly("timer")));
    function loadUndo() { const r = store.get("snapshots", "przedImportem"); return r ? r.text : null; }
    const dropUndo = () => commit(diff("snapshots", new Map(), metaOnly("przedImportem")));
    const lastBackup = () => store.status().ostatniaKopia;

    /* ---------- attendance (Frekwencja): training days, start day, skipped days — one record in meta ---------- */
    const attRecord = a => ({ days: (a.days || []).slice(), from: a.from || null, cancelled: Object.assign({}, a.cancelled || {}) });
    // null = never saved (the app then uses Monday to Saturday from the first swim)
    function loadAttendance() { const r = store.get("meta", "attendance"); return r ? copy(attRecord(r)) : null; }
    const saveAttendance = a => commit(diff("meta", a ? new Map([["attendance", attRecord(a)]]) : new Map(), metaOnly("attendance")));

    // a validated backup (format 1) -> records for store.replaceAll(); the same conversion as the migration.
    // backup: what to record as "the last backup" — {lastAt, changesSince}. A file the user has: its date and 0 changes.
    // The internal undo copy is not such a file, so undo keeps the previous date and an unknown number of changes.
    function recordsFromBackup(data, { undoText = null, exportedAt = null, timer = null, backup = null } = {}) {
      const part = (present, value) => ({ present, ok: present, value: present ? value : null });
      const legacy = { parts: {
        csv: part(!!(data.swimCsv && data.swimCsv.text), data.swimCsv && data.swimCsv.text),
        fit: part(true, data.fit),
        habits: part(true, data.habits),
        undo: part(undoText != null, undoText),
        lastExport: part(false, null),
        timer: part(!!timer, timer),
      } };
      const { records } = Migrate.fromLegacy(legacy);
      const b = backup || (exportedAt ? { lastAt: exportedAt, changesSince: 0 } : null);
      if (b) records.meta.push({ id: "backup", lastAt: b.lastAt || null, changesSince: typeof b.changesSince === "number" ? b.changesSince : null });
      // attendance: an optional part (backups from stage 1 and 2B do not have it)
      if (data.attendance) records.meta.push(Object.assign({ id: "attendance" }, copy(attRecord(data.attendance))));
      // the note that the old data was already moved stays: otherwise, after loading a backup with no data,
      // the next start would offer moving the old data again
      const mig = store.get("meta", "migration");
      if (mig) records.meta.push(Object.assign(bare(mig), { id: "migration" }));
      return records;
    }

    return { loadFit, saveFit, fitOps, loadHabits, saveHabits, habitOps, loadCsv, saveCsv, loadTimer, saveTimer, loadUndo, dropUndo, lastBackup, recordsFromBackup, loadAttendance, saveAttendance };
  }

  const api = { create };
  g.RytmBridge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
