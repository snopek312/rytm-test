// Rytm: data store (stage 2A). The only place that writes data.
//
// All data is loaded into memory when the app starts, so the rest of the app can read without waiting.
// Every change goes through three places, and the store always knows which one it has reached:
//   1. memory            ("pamiec")    — lost when the app is closed
//   2. journal           ("dziennik")  — a small list of pending changes in localStorage, written synchronously
//   3. the database      ("urzadzenie")— IndexedDB, only after the transaction is confirmed complete
// A backup file (outside the browser) is the only level that survives "clear website data": that wipes
// IndexedDB and localStorage together, journal included. The store counts changes made since the last backup.
//
// The store never reads, writes or removes the stage-1 keys (mojBasenCsv, mojBasenFit, rytmHabits, ...).
// Its own localStorage keys are only the marker and the journal (names below, configurable for tests).
(function (g) {
  "use strict";
  const SCHEMA = 1;
  const COLLECTIONS = ["habits", "habitDays", "fitActivities", "badLengths", "hiddenRows", "swimCsv", "meta", "snapshots"];
  const KEYS = { journal: "rytmDziennik", marker: "rytmBaza" };
  const INTERNAL_META = ["db", "zapis"];          // written by the store itself only
  const STATE = {
    OK: "ok",                         // database and marker match
    NEW: "nowa",                      // nothing was stored here before (a new device — or everything was wiped; these look the same)
    DB_LOST: "baza-zniknela",         // the marker says a database existed, but it is gone or different
    MARKER_LOST: "brak-znacznika",    // the database is here, but localStorage was cleared (pending journal changes may be lost)
    DB_UNAVAILABLE: "baza-niedostepna",
    READ_ONLY: "stary-zapis",         // opened on the stage-1 data, read only
  };
  const MODE = { NORMAL: "normalny", BLOCKED: "zablokowany", READ_ONLY: "tylko-odczyt", CLOSED: "zamkniety" };
  const LEVELS = [
    { id: "pamiec", label: "Tylko w pamięci", survivesClosing: false, survivesSiteDataLoss: false },
    { id: "dziennik", label: "W dzienniku, czeka na zapis", survivesClosing: true, survivesSiteDataLoss: false },
    { id: "urzadzenie", label: "Zapisane na tym urządzeniu", survivesClosing: true, survivesSiteDataLoss: false },
    { id: "kopia", label: "W kopii zapasowej", survivesClosing: true, survivesSiteDataLoss: true },
  ];
  const KIND_TEXT = {
    "brak-miejsca": "Brak miejsca na dane w przeglądarce",
    "czas": "Zapis trwał zbyt długo",
    "polaczenie": "Połączenie z bazą danych zostało przerwane",
    "przerwany": "Zapis został przerwany",
    "baza-zniknela": "Baza danych zniknęła (na przykład usunięto dane witryny)",
    "inny": "Nie udało się zapisać",
  };
  const DEFAULTS = { delayMs: 300, retryDelays: [1000, 3000, 10000], journalLimit: 1000000, openTimeoutMs: 10000, commitTimeoutMs: 15000 };

  class StoreError extends Error {
    constructor(code, message, cause) { super(message); this.name = "StoreError"; this.code = code; if (cause) this.cause = cause; }
  }
  const bad = m => new StoreError("zly-zapis", m);
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const clone = v => JSON.parse(JSON.stringify(v));
  const msg = e => String((e && e.message) || e || "nieznany błąd");
  const keyOf = (c, id) => c + "\u0000" + id;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
    return o;
  }
  function classify(e) {
    const name = (e && e.name) || "", m = msg(e);
    if (name === "QuotaExceededError" || (e && (e.code === 22 || e.code === 1014)) || /quota/i.test(m)) return "brak-miejsca";
    if (name === "TimeoutError") return "czas";
    if (name === "InvalidStateError" || name === "UnknownError" || /connection|closing|closed/i.test(m)) return "polaczenie";
    if (name === "AbortError") return "przerwany";
    return "inny";
  }
  function withTimeout(p, ms, what) {
    if (!(ms > 0)) return p;
    let t;
    const to = new Promise((_, rej) => { t = setTimeout(() => { const e = new Error(`${what}: brak odpowiedzi po ${ms} ms`); e.name = "TimeoutError"; rej(e); }, ms); });
    return Promise.race([p, to]).finally(() => clearTimeout(t));
  }
  function randomId() {
    try { if (g.crypto && typeof g.crypto.randomUUID === "function") return g.crypto.randomUUID(); } catch (e) {}
    return "db-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function defaultKv() { try { return g.localStorage || null; } catch (e) { return null; } }

  async function open(options) {
    const o = Object.assign({}, DEFAULTS, options);
    const adapter = o.adapter;
    if (!adapter) throw new Error("RytmStore.open: brak adaptera");
    const keys = Object.assign({}, KEYS, o.keys);
    const now = o.now || (() => new Date());
    const newId = o.newId || randomId;
    const kv = o.kv === undefined ? defaultKv() : o.kv;
    const t0 = Date.now();

    let mem = {};
    const resetMem = () => { mem = {}; for (const c of COLLECTIONS) mem[c] = new Map(); };
    resetMem();
    const pending = new Map();                 // key -> {coll, id, rec, seq, level, internal}
    let waiters = [];                          // {seq, resolve, reject}
    let seq = 0, committedSeq = 0;
    let state = null, mode = MODE.NORMAL, dbId = null;
    let kvOk = !!kv, journalBroken = false, busy = false;
    let journalOps = [];                       // mirror of the journal in localStorage: [seq, coll, id, rec]
    let lastError = null, lastCommitAt = null, attempts = 0, reopens = 0;
    let timer = null, running = null;
    const problems = [];
    const listeners = new Set();
    const report = { state: null, created: false, replayed: 0, journalOpsLeft: 0, problems, dbId: null, openMs: 0, adapter: adapter.kind || "?" };

    const problem = (code, text) => { if (!problems.some(p => p.code === code)) problems.push({ code, text }); };
    const journalUsable = () => kvOk && !journalBroken && mode === MODE.NORMAL;
    function errInfo(e, kind, n, retrying) {
      return { kind, text: KIND_TEXT[kind] || KIND_TEXT.inny, detail: msg(e), name: (e && e.name) || null, attempts: n, at: now().toISOString(), retrying: !!retrying };
    }
    function notify() { const s = status(); for (const fn of listeners) { try { fn(s); } catch (e) {} } }

    /* ---------- localStorage: marker and journal ---------- */
    function kvGet(k) { try { return kv.getItem(k); } catch (e) { kvOk = false; problem("localStorage-niedostepne", "Pamięć localStorage jest niedostępna: zmiany są tylko w pamięci, dopóki nie zapiszą się w bazie."); return null; } }
    function writeMarker() {
      if (!kvOk) return;
      try { kv.setItem(keys.marker, JSON.stringify({ dbId, schema: SCHEMA, at: now().toISOString() })); }
      catch (e) { problem("znacznik-niezapisany", "Nie udało się zapisać znacznika bazy: " + msg(e)); }
    }
    // moves a damaged or foreign journal aside instead of deleting it; if that fails, the journal is not used this session
    function moveAside(key, label) {
      const raw = kvGet(key);
      if (raw == null) return null;
      const to = `${key}.${label}.${Date.now()}`;
      try { kv.setItem(to, raw); kv.removeItem(key); return to; }
      catch (e) { journalBroken = true; problem("dziennik-zablokowany", "Nie udało się odłożyć starego dziennika, więc w tej sesji dziennik jest wyłączony: " + msg(e)); return null; }
    }
    function journalAppend(entries) {
      if (!journalUsable()) return false;
      const next = journalOps.concat(entries.map(e => [e.seq, e.coll, e.id, e.rec, e.internal ? 1 : 0]));
      const text = JSON.stringify({ v: 1, dbId, ops: next });
      if (text.length > o.journalLimit) { problem("dziennik-pelny", "Część zmian jest za duża dla dziennika: do zapisu w bazie są tylko w pamięci."); return false; }
      try { kv.setItem(keys.journal, text); journalOps = next; return true; }
      catch (e) { problem("dziennik-niezapisany", "Nie udało się dopisać zmian do dziennika (" + msg(e) + "): do zapisu w bazie są tylko w pamięci."); return false; }
    }
    function journalTrim(maxSeq) {
      if (!journalUsable() || !journalOps.length) return;
      const next = journalOps.filter(op => op[0] > maxSeq);
      if (next.length === journalOps.length) return;
      try { if (next.length) kv.setItem(keys.journal, JSON.stringify({ v: 1, dbId, ops: next })); else kv.removeItem(keys.journal); journalOps = next; }
      catch (e) { /* stale entries are harmless: replay skips everything up to the committed sequence number */ }
    }
    function readJournal() {
      const raw = kvGet(keys.journal);
      if (raw == null) return null;
      let j = null;
      try { j = JSON.parse(raw); } catch (e) { j = null; }
      if (!isObj(j) || j.v !== 1 || !Array.isArray(j.ops)) {
        const to = moveAside(keys.journal, "uszkodzony");
        problem("dziennik-uszkodzony", "Dziennik zmian był uszkodzony" + (to ? `; odłożyłem go pod nazwą ${to}` : "") + ". Zmiany, które w nim czekały, mogły przepaść.");
        return null;
      }
      return j;
    }

    /* ---------- the database ---------- */
    const commitRaw = batch => withTimeout(Promise.resolve().then(() => adapter.commit(batch)), o.commitTimeoutMs, "Zapis do bazy");
    async function initDb() {
      dbId = newId();
      const rec = { id: "db", dbId, createdAt: now().toISOString(), schema: SCHEMA };
      await commitRaw({ puts: [{ coll: "meta", rec }] });
      mem.meta.set("db", deepFreeze(rec));
      writeMarker();
    }
    const hasUserData = () => COLLECTIONS.some(c => c !== "meta" && mem[c].size > 0);

    function vanished() {
      state = STATE.DB_LOST; mode = MODE.BLOCKED;
      if (timer) { clearTimeout(timer); timer = null; }
      problem("baza-zniknela", "Baza danych zniknęła w trakcie działania aplikacji (na przykład usunięto dane witryny). Zmiany, które nie zdążyły się zapisać, są tylko w pamięci" + (journalOps.length ? " i w dzienniku" : "") + ". Zapisz kopię zapasową.");
    }

    async function commitOnce() {
      const batch = [...pending.values()];
      if (!batch.length) return;
      let maxSeq = 0; for (const e of batch) if (e.seq > maxSeq) maxSeq = e.seq;
      const zap = { id: "zapis", committedSeq: maxSeq, at: now().toISOString() };
      attempts++;
      await commitRaw({ puts: batch.map(e => ({ coll: e.coll, rec: e.rec })).concat([{ coll: "meta", rec: zap }]) });
      for (const e of batch) { const k = keyOf(e.coll, e.id); if (pending.get(k) === e) pending.delete(k); }
      committedSeq = Math.max(committedSeq, maxSeq);
      mem.meta.set("zapis", deepFreeze(zap));
      lastCommitAt = zap.at; lastError = null;
      journalTrim(maxSeq);
      const keep = []; for (const w of waiters) (w.seq <= maxSeq ? w.resolve() : keep.push(w)); waiters = keep;
    }
    function failAll(err) { const ws = waiters; waiters = []; for (const w of ws) w.reject(err); }
    async function runCommit(retries) {
      let attempt = 0;
      for (;;) {
        if (mode !== MODE.NORMAL) throw new StoreError("zablokowany", "Zapis jest wstrzymany.");
        try { await commitOnce(); return; }
        catch (e) {
          let kind = classify(e);
          if ((kind === "polaczenie" || kind === "czas") && mode === MODE.NORMAL) {
            reopens++;
            try {
              const r = await withTimeout(Promise.resolve().then(() => adapter.reopen()), o.openTimeoutMs, "Ponowne otwarcie bazy");
              if (r && r.created) { vanished(); kind = "baza-zniknela"; }
            } catch (e2) { /* stays a connection problem; the next attempt will try again */ }
          }
          const canRetry = retries && mode === MODE.NORMAL && kind !== "brak-miejsca" && attempt < o.retryDelays.length;
          if (!canRetry) {
            lastError = errInfo(e, kind, attempt + 1, false);
            const err = new StoreError("zapis-nieudany", `${KIND_TEXT[kind]}: ${msg(e)}`, e);
            err.kind = kind;
            failAll(err); notify();
            throw err;
          }
          lastError = errInfo(e, kind, attempt + 1, true); notify();
          await sleep(o.retryDelays[attempt++]);
        }
      }
    }
    function pump(retries = true) {
      if (running) return running;
      running = (async () => {
        try { do { await runCommit(retries); } while (pending.size && mode === MODE.NORMAL); }
        catch (e) { /* in status(); waiting promises were rejected */ }
        finally { running = null; notify(); }
      })();
      return running;
    }
    function schedule(delay) {
      if (mode !== MODE.NORMAL || timer) return;
      timer = setTimeout(() => { timer = null; pump(true); }, delay == null ? o.delayMs : delay);
    }

    /* ---------- writing ---------- */
    function assertWritable() {
      if (busy) throw new StoreError("zablokowany", "Trwa zapisywanie wszystkich danych naraz — spróbuj za chwilę.");
      if (mode === MODE.NORMAL) return;
      const why = {
        [MODE.BLOCKED]: `Zapis jest wstrzymany (${state}).`,
        [MODE.READ_ONLY]: "Dane z poprzedniej wersji są tylko do odczytu.",
        [MODE.CLOSED]: "Magazyn danych jest zamknięty.",
      }[mode];
      throw new StoreError("zablokowany", why);
    }
    function prepare(op, t) {
      if (!isObj(op)) throw bad("Zmiana musi być obiektem.");
      const { coll, id } = op;
      if (!COLLECTIONS.includes(coll)) throw bad(`Nieznana kolekcja „${coll}”.`);
      if (typeof id !== "string" || !id || id.length > 200) throw bad("Zły identyfikator rekordu.");
      if (coll === "meta" && INTERNAL_META.includes(id)) throw bad(`Rekord „${id}” jest zarezerwowany dla magazynu danych.`);
      if (op.delete === true) return { coll, id, rec: { id, deleted: true, updatedAt: t } };
      if (!isObj(op.value)) throw bad("Wartość rekordu musi być obiektem.");
      let v;
      try { v = clone(op.value); } catch (e) { throw bad("Tej wartości nie da się zapisać: " + msg(e)); }
      if ("deleted" in v) throw bad("Pole „deleted” jest zarezerwowane.");
      if ("id" in v && v.id !== id) throw bad("Pole „id” nie zgadza się z identyfikatorem rekordu.");
      v.id = id; v.updatedAt = t;
      return { coll, id, rec: v };
    }
    function stage(prepared) {
      const entries = prepared.map(p => Object.assign({}, p, { seq: ++seq, level: "pamiec" }));
      for (const e of entries) { deepFreeze(e.rec); mem[e.coll].set(e.id, e.rec); pending.set(keyOf(e.coll, e.id), e); }
      if (journalAppend(entries)) for (const e of entries) e.level = "dziennik";
      const target = seq;
      const p = new Promise((resolve, reject) => waiters.push({ seq: target, resolve, reject }));
      p.catch(() => {});      // callers may ignore the promise; failures are always visible in status()
      notify();
      schedule();
      return p;
    }
    // ops: [{coll, id, value}] or [{coll, id, delete:true}]. Throws (nothing changed) on a bad change or when writing is blocked.
    // Otherwise the change is in memory at once; the returned promise resolves when it is saved in the database.
    function apply(ops) {
      assertWritable();
      if (!Array.isArray(ops)) ops = [ops];
      if (!ops.length) return Promise.resolve();
      const t = now().toISOString();
      const prepared = ops.map(op => prepare(op, t));
      // count of changes not yet in any backup file: unknown (null) stays unknown until the next backup
      const bk = mem.meta.get("backup");
      let since;
      if (bk) since = typeof bk.changesSince === "number" ? bk.changesSince + prepared.length : null;
      else since = hasUserData() ? null : prepared.length;
      prepared.push({ coll: "meta", id: "backup", internal: true,
        rec: { id: "backup", lastAt: bk ? bk.lastAt : null, changesSince: since, updatedAt: t } });
      return stage(prepared);
    }
    function setMeta(id, value) {
      assertWritable();
      if (typeof id !== "string" || !id || INTERNAL_META.includes(id)) throw bad(`Rekord „${id}” jest zarezerwowany dla magazynu danych.`);
      const p = prepare({ coll: "meta", id, value }, now().toISOString());
      return stage([Object.assign(p, { internal: true })]);
    }
    // call after a backup file was saved; changes still waiting for the database are inside that file too
    function markBackup(at) {
      assertWritable();
      const t = now().toISOString();
      const when = at instanceof Date ? at.toISOString() : (at || t);
      return stage([{ coll: "meta", id: "backup", internal: true, rec: { id: "backup", lastAt: when, changesSince: 0, updatedAt: t } }]);
    }
    async function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (running) await running;
      if (pending.size && mode === MODE.NORMAL) await pump(true);
      if (pending.size) {
        const kind = lastError ? lastError.kind : "inny";
        const err = new StoreError("zapis-nieudany", mode === MODE.NORMAL ? `${KIND_TEXT[kind] || KIND_TEXT.inny}: ${pending.size} zmian czeka na zapis.` : `Zapis jest wstrzymany (${state}); ${pending.size} zmian jest tylko w pamięci lub w dzienniku.`);
        err.kind = kind;
        throw err;
      }
    }
    // replaces everything in one transaction (migration, and later importing a backup). Not journaled: the source still exists.
    async function replaceAll(byColl, opts = {}) {
      assertWritable();
      if (timer || running || pending.size) {
        try { await flush(); } catch (e) { throw new StoreError("oczekujace", "Najpierw muszą się zapisać zmiany, które czekają na zapis.", e); }
      }
      assertWritable();
      for (const c of Object.keys(byColl || {})) if (!COLLECTIONS.includes(c)) throw bad(`Nieznana kolekcja „${c}”.`);
      const t = now().toISOString();
      const puts = [];
      for (const c of COLLECTIONS) for (const r of (byColl && byColl[c]) || []) {
        if (!isObj(r) || typeof r.id !== "string" || !r.id) throw bad(`Rekord w „${c}” nie ma identyfikatora.`);
        if (c === "meta" && INTERNAL_META.includes(r.id)) continue;
        const rec = clone(r);
        if (!rec.updatedAt) rec.updatedAt = t;
        puts.push({ coll: c, rec });
      }
      const dbRec = mem.meta.get("db");
      if (dbRec) puts.push({ coll: "meta", rec: clone(dbRec) });
      const zap = { id: "zapis", committedSeq: seq, at: t };
      puts.push({ coll: "meta", rec: zap });
      busy = true; notify();
      try { await commitRaw({ clear: COLLECTIONS.slice(), puts }); }
      catch (e) { const kind = classify(e); const err = new StoreError("zapis-nieudany", `${KIND_TEXT[kind]}: ${msg(e)}`, e); err.kind = kind; throw err; }
      finally { busy = false; }
      resetMem();
      for (const p of puts) mem[p.coll].set(p.rec.id, deepFreeze(p.rec));
      committedSeq = seq; lastCommitAt = t; lastError = null;
      journalTrim(Infinity);
      notify();
      return { records: puts.length, reason: opts.reason || null };
    }
    // reads everything again from the storage through a new connection (not from memory)
    function readBack() { return withTimeout(Promise.resolve().then(() => adapter.readFresh()), o.openTimeoutMs * 3, "Odczyt kontrolny"); }
    // removes this store's database and its own two localStorage keys (used when a migration does not verify)
    async function destroy({ force = false } = {}) {
      if (pending.size && !force) throw new StoreError("oczekujace", "Są niezapisane zmiany — nie usuwam bazy.");
      if (timer) { clearTimeout(timer); timer = null; }
      mode = MODE.CLOSED;
      const removedKeys = [];
      if (kvOk) for (const k of [keys.marker, keys.journal]) { try { if (kv.getItem(k) != null) { kv.removeItem(k); removedKeys.push(k); } } catch (e) {} }
      failAll(new StoreError("zablokowany", "Magazyn danych został usunięty."));
      pending.clear(); journalOps = []; resetMem();
      await withTimeout(Promise.resolve().then(() => adapter.destroy()), o.openTimeoutMs, "Usuwanie bazy");
      notify();
      return { removedKeys };
    }
    // after "baza-zniknela": start an empty database. The old journal is moved aside, never deleted.
    // Changes that only existed in memory are dropped from memory here (save a backup first); the journal is kept aside.
    async function startFresh() {
      if (state !== STATE.DB_LOST) throw new StoreError("zly-stan", "Nowa baza jest potrzebna tylko wtedy, gdy poprzednia zniknęła.");
      if (timer) { clearTimeout(timer); timer = null; }
      if (running) { try { await running; } catch (e) {} }
      await adapter.reopen();
      const data = await adapter.loadAll();
      if (COLLECTIONS.some(c => c !== "meta" && ((data && data[c]) || []).length))
        throw new StoreError("zly-stan", "W bazie są dane innej bazy — nie zastępuję ich automatycznie.");
      failAll(new StoreError("zablokowany", "Rozpoczęto nową bazę."));
      pending.clear();
      const moved = kvOk ? moveAside(keys.journal, "osierocony") : null;
      journalOps = [];
      resetMem();
      for (const c of COLLECTIONS) for (const r of (data && data[c]) || []) mem[c].set(r.id, deepFreeze(r));
      committedSeq = 0; seq = 0;
      mode = MODE.NORMAL;
      try { await initDb(); } catch (e) { mode = MODE.BLOCKED; throw e; }
      state = STATE.OK; lastError = null;
      notify();
      return { movedJournal: moved, dbId };
    }
    async function close() {
      if (mode === MODE.CLOSED) return;
      let err = null;
      if (mode === MODE.NORMAL) { try { await flush(); } catch (e) { err = e; } }
      if (timer) { clearTimeout(timer); timer = null; }
      mode = MODE.CLOSED;
      try { await adapter.close(); } catch (e) {}
      notify();
      if (err) throw err;
    }
    // tests only: the page "dies" — no flush, no close, timers stopped
    function __abandon() { if (timer) clearTimeout(timer); timer = null; mode = MODE.CLOSED; }

    /* ---------- reading ---------- */
    function checkColl(c) { if (!COLLECTIONS.includes(c)) throw bad(`Nieznana kolekcja „${c}”.`); }
    function get(coll, id) { checkColl(coll); const r = mem[coll].get(id); return r && !r.deleted ? r : null; }
    function all(coll) { checkColl(coll); return [...mem[coll].values()].filter(r => !r.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); }
    function count(coll) { checkColl(coll); let n = 0; for (const r of mem[coll].values()) if (!r.deleted) n++; return n; }
    function levelOf(coll, id) {
      checkColl(coll);
      const e = pending.get(keyOf(coll, id));
      if (e) return e.level;
      return mem[coll].has(id) ? "urzadzenie" : null;
    }
    // everything in memory, deleted markers included (for a backup and for comparisons)
    function snapshot() { const out = {}; for (const c of COLLECTIONS) out[c] = [...mem[c].values()]; return out; }
    function status() {
      let m = 0, j = 0;
      for (const e of pending.values()) { if (e.internal) continue; if (e.level === "dziennik") j++; else m++; }
      const bk = mem.meta.get("backup");
      return {
        stan: state, tryb: mode, dbId,
        poziomy: { pamiec: m, dziennik: j },
        niezapisane: m + j,
        zapisywanie: !!running || busy,
        ostatniZapis: lastCommitAt,
        blad: lastError ? Object.assign({}, lastError) : null,
        ostatniaKopia: bk ? bk.lastAt || null : null,
        odOstatniejKopii: bk ? (typeof bk.changesSince === "number" ? bk.changesSince : null) : (hasUserData() ? null : 0),
        dziennik: journalUsable() ? "wlaczony" : "wylaczony",
        proby: attempts, ponowneOtwarcia: reopens,
        problemy: problems.slice(),
      };
    }

    const api = {
      get, all, count, levelOf, snapshot, status, hasUserData,
      apply, setMeta, markBackup, flush, retry: flush, replaceAll, readBack, destroy, startFresh, close, __abandon,
      onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      get state() { return state; }, get mode() { return mode; },
      report, keys, adapterKind: adapter.kind || "?",
    };

    /* ---------- opening ---------- */
    function finish() { report.state = state; report.dbId = dbId; report.openMs = Date.now() - t0; return api; }

    let marker = null;
    if (adapter.readOnly) kvOk = false;          // the read-only stage-1 view never touches localStorage
    else if (kvOk) {
      const raw = kvGet(keys.marker);
      if (raw != null) {
        try { marker = JSON.parse(raw); if (!isObj(marker) || typeof marker.dbId !== "string") throw new Error("zły kształt"); }
        catch (e) { marker = null; problem("znacznik-uszkodzony", "Znacznik bazy w localStorage był uszkodzony."); }
      }
    } else problem("localStorage-niedostepne", "Pamięć localStorage jest niedostępna: zmiany są tylko w pamięci, dopóki nie zapiszą się w bazie.");

    let opening;
    try {
      opening = Promise.resolve().then(() => adapter.open());
      const r = await withTimeout(opening, o.openTimeoutMs, "Otwieranie bazy");
      report.created = !!(r && r.created);
      const data = await withTimeout(Promise.resolve().then(() => adapter.loadAll()), o.openTimeoutMs * 3, "Wczytywanie danych");
      for (const c of COLLECTIONS) for (const rec of (data && data[c]) || []) mem[c].set(rec.id, deepFreeze(rec));
    } catch (e) {
      if (opening) opening.then(() => { try { adapter.close(); } catch (x) {} }, () => {});
      state = STATE.DB_UNAVAILABLE; mode = MODE.BLOCKED;
      lastError = errInfo(e, classify(e), 1, false);
      problem("baza-niedostepna", "Nie mogę otworzyć bazy danych na tym urządzeniu: " + msg(e));
      return finish();
    }

    if (adapter.readOnly) { state = STATE.READ_ONLY; mode = MODE.READ_ONLY; return finish(); }

    const dbMeta = mem.meta.get("db") || null;
    const zap = mem.meta.get("zapis");
    committedSeq = (zap && zap.committedSeq) || 0;
    seq = committedSeq;
    const mig = mem.meta.get("migration");
    const unverifiedMigration = !!(mig && mig.state !== "zweryfikowana");
    try {
      if (!kvOk) {
        if (dbMeta) { dbId = dbMeta.dbId; state = STATE.OK; } else { await initDb(); state = hasUserData() ? STATE.OK : STATE.NEW; }
      } else if (marker && dbMeta && marker.dbId === dbMeta.dbId) {
        dbId = dbMeta.dbId; state = STATE.OK;
      } else if (marker) {
        dbId = dbMeta ? dbMeta.dbId : null;
        state = STATE.DB_LOST; mode = MODE.BLOCKED;
        const j = readJournalCountOnly();
        report.journalOpsLeft = j;
        problem("baza-zniknela", "Baza danych z tego urządzenia zniknęła albo została zastąpiona (na przykład usunięto dane witryny)." + (j ? ` W dzienniku zostało ${j} zmian; nie usuwam go.` : "") + " Wczytaj kopię zapasową.");
      } else if (dbMeta) {
        dbId = dbMeta.dbId;
        writeMarker();
        if (hasUserData() && !unverifiedMigration) {
          state = STATE.MARKER_LOST;
          problem("mozliwa-utrata", "Dane w localStorage zostały usunięte, a baza została. Zmiany, które w chwili usunięcia czekały w dzienniku, mogły przepaść.");
        } else state = STATE.OK;
      } else {
        await initDb();
        state = hasUserData() ? STATE.OK : STATE.NEW;
      }
    } catch (e) {
      state = STATE.DB_UNAVAILABLE; mode = MODE.BLOCKED;
      lastError = errInfo(e, classify(e), 1, false);
      problem("baza-niedostepna", "Nie udało się przygotować bazy danych: " + msg(e));
      return finish();
    }
    function readJournalCountOnly() {
      const raw = kvGet(keys.journal);
      if (raw == null) return 0;
      try { const j = JSON.parse(raw); return Array.isArray(j.ops) ? j.ops.length : 0; } catch (e) { return 0; }
    }

    // replay changes that were in the journal but not yet in the database
    if (mode === MODE.NORMAL && kvOk) {
      const j = readJournal();
      if (j && j.dbId !== dbId) {
        const to = moveAside(keys.journal, "osierocony");
        problem("dziennik-osierocony", "Dziennik należał do innej bazy, więc go nie odtwarzam" + (to ? `; odłożyłem go pod nazwą ${to}` : "") + ".");
      } else if (j) {
        const valid = j.ops.filter(op => Array.isArray(op) && Number.isInteger(op[0]) && COLLECTIONS.includes(op[1]) && typeof op[2] === "string" && op[2] && isObj(op[3]))
          .sort((a, b) => a[0] - b[0]);
        if (valid.length < j.ops.length) problem("dziennik-czesciowo-nieczytelny", `${j.ops.length - valid.length} wpisów dziennika było nieczytelnych i zostało pominiętych.`);
        journalOps = valid;
        journalTrim(committedSeq);                 // entries already in the database are dropped from the journal
        const ops = valid.filter(op => op[0] > committedSeq);
        for (const [s, coll, id, rec, internal] of ops) {
          deepFreeze(rec);
          mem[coll].set(id, rec);
          pending.set(keyOf(coll, id), { coll, id, rec, seq: s, level: "dziennik", internal: !!internal });
          if (s > seq) seq = s;
        }
        report.replayed = ops.length;
      }
      if (pending.size) {
        await pump(false);                       // one quick attempt; if it fails, keep trying in the background
        if (pending.size) schedule(o.retryDelays[0] || o.delayMs);
      }
    }
    return finish();
  }

  const api = { open, SCHEMA, COLLECTIONS, KEYS, STATE, MODE, LEVELS, KIND_TEXT, StoreError, classify, deepFreeze };
  g.RytmStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
