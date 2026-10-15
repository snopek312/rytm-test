// Rytm: moving data from the stage-1 localStorage keys into the store (stage 2A).
//
// The old keys are only READ here: never written, never removed — not even a damaged one (stage 1 used to move
// a damaged key aside; the migration leaves it exactly where it is and reports it).
// Steps: read → fingerprint each key → convert → write everything in ONE transaction → read it back from the disk
// through a new connection → convert back to the old format → compare part by part → check the old keys did not
// change meanwhile. Only if everything matches is the migration marked "zweryfikowana". Otherwise the new database is
// removed completely, and the old keys stay as they were.
(function (g) {
  "use strict";
  const Store = g.RytmStore || (typeof require === "function" ? require("./store.js") : null);
  const Backup = g.Backup || (typeof require === "function" ? (() => { try { return require("./backup.js"); } catch (e) { return null; } })() : null);
  const COLLECTIONS = Store.COLLECTIONS;
  const LEGACY = [
    { part: "csv", key: "mojBasenCsv", type: "text", label: "lista treningów (CSV)" },
    { part: "fit", key: "mojBasenFit", type: "json", label: "treningi z plików FIT" },
    { part: "habits", key: "rytmHabits", type: "json", label: "nawyki" },
    { part: "undo", key: "rytmPrzedImportem", type: "text", label: "stan sprzed wczytania kopii (Cofnij)" },
    { part: "lastExport", key: "rytmOstatniaKopia", type: "text", label: "data ostatniej kopii" },
    { part: "timer", key: "rytmTimer", type: "json", label: "stoper" },
  ];
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const msg = e => String((e && e.message) || e || "nieznany błąd");
  function checksum(str) {     // same FNV-1a as backup.js
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8) + "-" + str.length;
  }
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (isObj(v)) { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]); return o; }
    return v;
  }
  const canon = v => JSON.stringify(sortKeys(v === undefined ? null : v));
  function rest(o, known) { const out = {}; let any = false; for (const k of Object.keys(o)) if (!known.includes(k)) { out[k] = o[k]; any = true; } return any ? out : null; }

  // the app treats these the same way: a missing part is an empty part
  function normFit(v) { return v ? Object.assign({}, v, { acts: v.acts || {}, bad: v.bad || {}, last: v.last || [], hidden: v.hidden || {} }) : { acts: {}, bad: {}, last: [], hidden: {} }; }
  // ...but not for habits: no saved habits means "show the starter list", an empty list means "no habits"
  function normHabits(v) { return v ? Object.assign({}, v, { log: v.log || {}, notes: v.notes || {}, skips: v.skips || {} }) : null; }

  function shapeProblem(part, v) {
    if (part === "fit") {
      if (!isObj(v) || !isObj(v.acts)) return "nieznany układ danych (brak listy treningów)";
      if (!Object.values(v.acts).every(isObj)) return "nieznany układ danych (trening nie jest obiektem)";
      if (v.bad !== undefined && !isObj(v.bad)) return "nieznany układ danych (pominięte długości)";
      if (v.hidden !== undefined && !isObj(v.hidden)) return "nieznany układ danych (usunięte treningi)";
      if (v.last !== undefined && !Array.isArray(v.last)) return "nieznany układ danych (ostatnio dodane)";
    }
    if (part === "habits") {
      if (!isObj(v) || !Array.isArray(v.habits)) return "nieznany układ danych (brak listy nawyków)";
      const ids = new Set();
      for (const h of v.habits) {
        if (!isObj(h) || typeof h.id !== "string" || !h.id) return "nawyk bez identyfikatora";
        if (ids.has(h.id)) return `nawyk „${String(h.name || h.id).slice(0, 40)}” występuje dwa razy`;
        ids.add(h.id);
      }
      for (const k of ["log", "notes", "skips"]) if (v[k] !== undefined && !isObj(v[k])) return `nieznany układ danych (${k})`;
      if (v.log && !Object.values(v.log).every(isObj)) return "nieznany układ danych (wpis dnia)";
    }
    if (part === "timer" && !(isObj(v) && v.hid && v.start)) return "zapis stopera, którego aplikacja i tak nie używa";
    return null;
  }

  // reads the old keys; uses only getItem, key and length — never setItem/removeItem
  function readLegacy(kv) {
    const out = { parts: {}, rescueKeys: [], readError: null };
    for (const L of LEGACY) {
      const p = { part: L.part, key: L.key, label: L.label, type: L.type, present: false, raw: null, value: null, ok: true, reason: null, fingerprint: null };
      out.parts[L.part] = p;
      let raw;
      try { raw = kv.getItem(L.key); } catch (e) { p.ok = false; p.reason = "nie da się odczytać: " + msg(e); out.readError = msg(e); continue; }
      if (raw == null) continue;
      p.present = true; p.raw = raw; p.fingerprint = checksum(raw);
      if (L.type === "json") { try { p.value = JSON.parse(raw); } catch (e) { p.ok = false; p.reason = "uszkodzony zapis (to nie jest poprawny JSON)"; continue; } }
      else p.value = raw;
      const why = shapeProblem(L.part, p.value);
      if (why) { p.ok = false; p.reason = why; }
    }
    try {   // copies of damaged data put aside by stage 1 — listed, never touched
      for (let i = 0; i < kv.length; i++) {
        const k = kv.key(i);
        if (k && /\.uszkodzone\.\d+$/.test(k) && LEGACY.some(L => k.startsWith(L.key + "."))) out.rescueKeys.push(k);
      }
    } catch (e) {}
    out.rescueKeys.sort();
    return out;
  }
  function hasLegacy(kv) { return LEGACY.some(L => { try { return kv.getItem(L.key) != null; } catch (e) { return false; } }); }
  const fingerprints = legacy => { const o = {}; for (const L of LEGACY) o[L.key] = legacy.parts[L.part].fingerprint; return o; };

  // stage-1 data → store records (only parts that were read correctly)
  function fromLegacy(legacy) {
    const R = {}; for (const c of COLLECTIONS) R[c] = [];
    const P = legacy.parts;
    const use = p => p && p.present && p.ok;
    if (use(P.csv)) R.swimCsv.push({ id: "main", text: P.csv.value });
    if (use(P.fit)) {
      const f = P.fit.value;
      for (const [id, pack] of Object.entries(f.acts)) R.fitActivities.push({ id, pack });          // the pack itself is not repacked
      for (const [id, lengths] of Object.entries(f.bad || {})) R.badLengths.push({ id, lengths });
      for (const [id, at] of Object.entries(f.hidden || {})) R.hiddenRows.push({ id, at });
      R.meta.push({ id: "fitLast", list: Array.isArray(f.last) ? f.last : [] });
      const extra = rest(f, ["acts", "bad", "last", "hidden"]);
      if (extra) R.meta.push({ id: "legacyFitExtra", fields: extra });
    }
    if (use(P.habits)) {
      const h = P.habits.value;
      h.habits.forEach((x, i) => R.habits.push({ id: x.id, order: i, habit: x }));
      const days = new Map();
      const day = k => { if (!days.has(k)) days.set(k, { id: k }); return days.get(k); };
      for (const [k, v] of Object.entries(h.log || {})) day(k).values = v;
      for (const [k, v] of Object.entries(h.notes || {})) day(k).note = v;
      for (const [k, v] of Object.entries(h.skips || {})) day(k).skip = v;
      R.habitDays.push(...days.values());
      R.meta.push({ id: "habitsList", saved: true });
      const extra = rest(h, ["habits", "log", "notes", "skips"]);
      if (extra) R.meta.push({ id: "legacyHabitsExtra", fields: extra });
    }
    if (use(P.undo)) R.snapshots.push({ id: "przedImportem", text: P.undo.value });
    if (use(P.lastExport)) R.meta.push({ id: "backup", lastAt: P.lastExport.value, changesSince: null });
    if (use(P.timer)) R.meta.push({ id: "timer", value: P.timer.value });
    const skipped = LEGACY.filter(L => P[L.part].present && !P[L.part].ok).map(L => ({ part: L.part, key: L.key, label: L.label, reason: P[L.part].reason }));
    return { records: R, skipped };
  }

  // store records → the stage-1 format (used to verify the migration)
  function toLegacy(data) {
    const live = c => ((data && data[c]) || []).filter(r => r && !r.deleted);
    const meta = id => live("meta").find(r => r.id === id) || null;
    const csv = live("swimCsv").find(r => r.id === "main");
    let fit = null;
    if (live("fitActivities").length || live("badLengths").length || live("hiddenRows").length || meta("fitLast") || meta("legacyFitExtra")) {
      fit = { acts: {}, bad: {}, last: meta("fitLast") ? meta("fitLast").list : [], hidden: {} };
      for (const r of live("fitActivities")) fit.acts[r.id] = r.pack;
      for (const r of live("badLengths")) fit.bad[r.id] = r.lengths;
      for (const r of live("hiddenRows")) fit.hidden[r.id] = r.at;
      if (meta("legacyFitExtra")) Object.assign(fit, meta("legacyFitExtra").fields);
    }
    let habits = null;
    if (meta("habitsList") || live("habits").length || live("habitDays").length) {
      habits = { habits: live("habits").slice().sort((a, b) => a.order - b.order).map(r => r.habit), log: {}, notes: {}, skips: {} };
      for (const d of live("habitDays")) {
        if ("values" in d) habits.log[d.id] = d.values;
        if ("note" in d) habits.notes[d.id] = d.note;
        if ("skip" in d) habits.skips[d.id] = d.skip;
      }
      if (meta("legacyHabitsExtra")) Object.assign(habits, meta("legacyHabitsExtra").fields);
    }
    const undo = live("snapshots").find(r => r.id === "przedImportem");
    const bk = meta("backup"), tm = meta("timer");
    return { csv: csv ? csv.text : null, fit, habits, undo: undo ? undo.text : null, lastExport: bk && bk.lastAt != null ? bk.lastAt : null, timer: tm ? tm.value : null };
  }

  // compares the old data with the round trip, part by part
  function compare(legacy, rt) {
    const parts = [], diffs = [];
    const P = legacy.parts;
    const add = (L, status, detail) => { parts.push({ part: L.part, key: L.key, label: L.label, status, detail: detail || "" }); if (status === "rozne") diffs.push(`${L.label}: ${detail}`); };
    const ids = (a, b) => { const out = []; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (canon(a[k]) !== canon(b[k])) out.push(k); return out; };
    const list = (what, keys) => `${what}: ${keys.length} (${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", …" : ""})`;
    for (const L of LEGACY) {
      const p = P[L.part];
      if (p.present && !p.ok) {
        const leaked = L.part === "fit" ? rt.fit !== null : rt[L.part] !== null;
        add(L, leaked ? "rozne" : "pominiete", leaked ? "pominięta część pojawiła się w nowej bazie" : `pominięte: ${p.reason}; zostaje w starym zapisie bez zmian`);
        continue;
      }
      if (L.part === "fit") {
        const a = normFit(p.present ? p.value : null), b = normFit(rt.fit);
        const bad = [];
        const da = ids(a.acts, b.acts); if (da.length) bad.push(list("różne treningi", da));
        const db = ids(a.bad, b.bad); if (db.length) bad.push(list("różne pominięte długości", db));
        const dh = ids(a.hidden, b.hidden); if (dh.length) bad.push(list("różne usunięte treningi", dh));
        if (canon(a.last) !== canon(b.last)) bad.push("różna lista ostatnio dodanych");
        if (canon(rest(a, ["acts", "bad", "last", "hidden"])) !== canon(rest(b, ["acts", "bad", "last", "hidden"]))) bad.push("różne dodatkowe pola");
        if (!bad.length && canon(a) !== canon(b)) bad.push("różnica w całości danych");
        add(L, bad.length ? "rozne" : (p.present ? "zgodne" : "brak"), bad.length ? bad.join("; ") : (p.present ? `${Object.keys(a.acts).length} treningów, identyczne` : ""));
        continue;
      }
      if (L.part === "habits") {
        const a = normHabits(p.present ? p.value : null), b = normHabits(rt.habits);
        if (!a || !b) { const same = !a && !b; add(L, same ? "brak" : "rozne", same ? "" : (a ? "nawyki zniknęły" : "pojawiły się nawyki, których nie było")); continue; }
        const bad = [];
        if (canon(a.habits) !== canon(b.habits)) bad.push("różna lista nawyków");
        const dl = ids(a.log, b.log); if (dl.length) bad.push(list("różne dni", dl));
        const dn = ids(a.notes, b.notes); if (dn.length) bad.push(list("różne notatki", dn));
        const ds = ids(a.skips, b.skips); if (ds.length) bad.push(list("różne pominięte dni", ds));
        if (!bad.length && canon(a) !== canon(b)) bad.push("różnica w całości danych");
        add(L, bad.length ? "rozne" : "zgodne", bad.length ? bad.join("; ") : `${a.habits.length} nawyków, ${Object.keys(a.log).length} dni, identyczne`);
        continue;
      }
      const want = p.present ? (L.type === "json" ? canon(p.value) : p.raw) : null;
      const got = rt[L.part] == null ? null : (L.type === "json" ? canon(rt[L.part]) : rt[L.part]);
      if (want === got) add(L, p.present ? "zgodne" : "brak", p.present ? (L.type === "text" ? `${p.raw.length} znaków, identyczne` : "identyczne") : "");
      else add(L, "rozne", want === null ? "pojawiło się w nowej bazie, choć nie było w starym zapisie" : got === null ? "brak w nowej bazie" : "treść się różni");
    }
    return { ok: !diffs.length, parts, diffs };
  }

  // the same numbers as the backup preview (Backup.summarize), for the report
  function counts(legacyLike) {
    const data = { swimCsv: legacyLike.csv != null ? { text: legacyLike.csv } : null, fit: normFit(legacyLike.fit), habits: legacyLike.habits ? normHabits(legacyLike.habits) : { habits: [], log: {}, notes: {}, skips: {} } };
    const s = Backup ? Backup.summarize(data, null) : null;
    return Object.assign({ csvChars: legacyLike.csv != null ? legacyLike.csv.length : 0 }, s || {});
  }
  const legacyAsData = legacy => {
    const P = legacy.parts, v = p => (p.present && p.ok ? p.value : null);
    return { csv: v(P.csv), fit: v(P.fit), habits: v(P.habits), undo: v(P.undo), lastExport: v(P.lastExport), timer: v(P.timer) };
  };

  function hasUserData(store) { return COLLECTIONS.some(c => c !== "meta" && store.count(c) > 0); }
  function needed(store, kv) {
    if (!hasLegacy(kv)) return { needed: false, reason: "W starym zapisie nie ma danych." };
    const mig = store.get("meta", "migration");
    if (mig && mig.state === "zweryfikowana") return { needed: false, reason: "Dane zostały już przeniesione i sprawdzone." };
    if (mig) return { needed: true, reason: "Poprzednie przenoszenie nie zostało sprawdzone do końca — powtarzam je." };
    if (hasUserData(store)) return { needed: false, reason: "Nowa baza zawiera już dane — nie nadpisuję ich starym zapisem." };
    return { needed: true, reason: "Pierwsze uruchomienie z nową bazą." };
  }

  async function run({ store, kv, now = () => new Date(), version = null } = {}) {
    const t0 = Date.now();
    const report = { ok: false, error: null, stage: "start", startedAt: now().toISOString(), finishedAt: null, ms: 0,
      parts: [], diffs: [], skipped: [], rescueKeys: [], counts: null, legacyUnchanged: null, cleanup: null, records: 0 };
    const finish = () => { report.finishedAt = now().toISOString(); report.ms = Date.now() - t0; return report; };
    async function cleanup() {
      try { const r = await store.destroy({ force: true }); report.cleanup = { ok: true, removedKeys: r.removedKeys }; }
      catch (e) { report.cleanup = { ok: false, error: msg(e) }; }
    }
    if (store.mode !== Store.MODE.NORMAL) { report.error = `Nowa baza nie jest gotowa do zapisu (stan: ${store.state}).`; return finish(); }
    const need = needed(store, kv);
    if (!need.needed) { report.error = need.reason; report.notNeeded = true; return finish(); }

    report.stage = "odczyt";
    const legacy = readLegacy(kv);
    if (legacy.readError) { report.error = "Nie da się odczytać starego zapisu: " + legacy.readError; return finish(); }
    const fp = fingerprints(legacy);
    const { records, skipped } = fromLegacy(legacy);
    report.skipped = skipped; report.rescueKeys = legacy.rescueKeys;
    report.counts = { before: counts(legacyAsData(legacy)), after: null };
    records.meta.push({ id: "migration", state: "niezweryfikowana", at: report.startedAt, from: "localStorage", version, fingerprints: fp, skipped });
    report.records = COLLECTIONS.reduce((n, c) => n + records[c].length, 0);

    report.stage = "zapis";
    try { await store.replaceAll(records, { reason: "migracja" }); }
    catch (e) { report.error = "Zapis do nowej bazy nie udał się (nic nie zostało zapisane): " + msg(e); await cleanup(); return finish(); }

    report.stage = "weryfikacja";
    let disk;
    try { disk = await store.readBack(); }
    catch (e) { report.error = "Nie udało się odczytać nowej bazy do sprawdzenia: " + msg(e); await cleanup(); return finish(); }
    const rt = toLegacy(disk);
    const cmp = compare(legacy, rt);
    report.parts = cmp.parts; report.diffs = cmp.diffs;
    report.counts.after = counts(rt);
    const fpAfter = fingerprints(readLegacy(kv));
    report.legacyUnchanged = LEGACY.every(L => fp[L.key] === fpAfter[L.key]);
    if (!cmp.ok || !report.legacyUnchanged) {
      report.error = !cmp.ok ? "Dane w nowej bazie różnią się od starego zapisu: " + cmp.diffs.join(" | ") : "Stary zapis zmienił się w trakcie przenoszenia.";
      await cleanup();
      return finish();
    }

    report.stage = "oznaczenie";
    try {
      await store.setMeta("migration", { state: "zweryfikowana", at: report.startedAt, verifiedAt: now().toISOString(), from: "localStorage", version, fingerprints: fp, skipped, counts: report.counts.before });
    } catch (e) {
      report.error = "Dane są zgodne, ale nie udało się zapisać wyniku sprawdzenia: " + msg(e) + ". Przenoszenie zostanie powtórzone przy następnym uruchomieniu.";
      return finish();
    }
    report.ok = true; report.stage = "gotowe";
    return finish();
  }

  const api = { LEGACY, readLegacy, hasLegacy, fromLegacy, toLegacy, compare, counts, needed, run, checksum, canon };
  g.RytmMigrate = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
