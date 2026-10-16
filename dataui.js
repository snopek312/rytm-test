// Rytm: where the data lives, on screen (stage 2B).
// Opens the store, chooses the mode, runs the manual migration screen, shows the save status, the error messages
// and the "Stan zapisu" card.
//   normal   — the IndexedDB store; changes are saved
//   podglad  — data can be seen but nothing is saved, and the screen says why:
//              przed-migracja (old data not moved yet), baza-niedostepna (IndexedDB does not work),
//              baza-zniknela (the database disappeared), druga-karta (Rytm is open in another tab)
// It never writes the stage-1 keys and never switches to saving in the old format.
(function (g) {
  "use strict";
  const Store = g.RytmStore, Migrate = g.RytmMigrate, A = g.RytmAdapters, Bridge = g.RytmBridge, Backup = g.Backup;
  // legacy: false — this installation never looks at the stage-1 keys (no migration screen, no old data in the
  // read-only views); they stay where they are, untouched. Used by the GitHub web app: that address never had stage-1
  // data, and the test version on the same address writes synthetic stage-1 data there. Data comes in from a backup.
  const DEFAULTS = { dbName: "rytm", keys: { journal: "rytmDziennik", marker: "rytmBaza" }, test: false, label: null, filePrefix: "rytm", storeOptions: {}, wrapAdapter: null, lockTimeoutMs: 1500, legacy: true };
  const user = g.RytmConfig || {};
  const cfg = Object.assign({}, DEFAULTS, user, { keys: Object.assign({}, DEFAULTS.keys, user.keys || {}) });
  const say = g.Rytm.notify;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const msg = e => String((e && e.message) || e || "nieznany błąd");
  const longDay = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  const hhmm = d => d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const when = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? `${longDay.format(d)}, ${hhmm(d)}` : null; };
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };

  const VIEW_TEXT = {
    "przed-migracja": ["Podgląd: dane nie są jeszcze przeniesione", "Widzisz dane zapisane wcześniej na tym urządzeniu. Zmiany zapiszesz po przeniesieniu danych do nowego zapisu."],
    "baza-niedostepna": ["Zapis jest wyłączony: nie mogę otworzyć bazy danych", "Pokazuję stary zapis z tego urządzenia, jeśli jest. Jeśli dane były już przeniesione do nowej bazy, nie ma w nim późniejszych zmian. Nic nie zapisuję. Zamknij aplikację całkowicie i otwórz ją ponownie; jeśli to nie pomoże, uruchom telefon ponownie."],
    "baza-zniknela": ["Baza danych zniknęła", "Na tym urządzeniu nie ma już bazy z twoimi danymi (na przykład usunięto dane witryny). Nic nie odtwarzam bez twojej decyzji. Wczytaj kopię zapasową w zakładce Dane."],
    "druga-karta": ["Rytm jest otwarty w innej karcie", "Tutaj jest tylko podgląd. Zamknij drugą kartę i otwórz tę ponownie, żeby wprowadzać zmiany."],
    "zniknela-w-trakcie": ["Baza danych zniknęła w trakcie pracy", "Ostatnie zmiany są widoczne, ale nie są zapisane na urządzeniu. Zapisz kopię teraz, a potem otwórz aplikację ponownie i wczytaj tę kopię."],
  };

  const ctx = { cfg, kv: null, store: null, bridge: null, mode: "start", reason: null, status: null, pending: null, lost: null, report: null, backupOk: null, cb: {}, unsub: null, lock: null, durability: null };

  /* ---------- how long the browser keeps what is saved here ---------- */
  // A database that accepted a write is not always kept: Safari and every iPhone browser (WebKit) keep the storage
  // of a page embedded from another site (an Artifact inside Claude, for example) only until the app is closed.
  //   tymczasowa — embedded in another site, in WebKit: everything is gone after closing the app
  //   zwykla     — the browser keeps it, but may delete it when the device is short of space
  //                (Safari in a normal tab also after 7 days without opening the page)
  //   chroniona  — the browser agreed not to delete it on its own (navigator.storage.persisted())
  const DURABILITY = {
    tymczasowa: { status: "Zapisano tymczasowo, do zamknięcia aplikacji",
      title: "Pamięć tymczasowa: dane znikną po zamknięciu aplikacji",
      text: "Ta strona działa wewnątrz innej strony (np. w Claude). Na iPhonie i w Safari taka pamięć jest kasowana po zamknięciu aplikacji. Zmiany są widoczne teraz, ale po zamknięciu zostanie tylko plik kopii." },
    zwykla: { status: "Zapisano na tym urządzeniu",
      text: "Pamięć przeglądarki bez ochrony: przy braku miejsca na urządzeniu przeglądarka może ją usunąć." },
    chroniona: { status: "Zapisano na tym urządzeniu",
      text: "Przeglądarka zgodziła się nie usuwać tych danych sama (pamięć chroniona). Usunięcie aplikacji albo danych witryny nadal je kasuje." },
  };
  function probeEnv() {
    const nav = g.navigator || {}, ua = String(nav.userAgent || ""), vendor = String(nav.vendor || "");
    let embedded = false;
    try { embedded = g.self !== g.top; } catch (e) { embedded = true; }
    const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    const webkit = ios || (vendor.indexOf("Apple") === 0 && !/Chrome|Chromium|CriOS|Edg|jsdom/.test(ua));
    let standalone = nav.standalone === true;
    try { standalone = standalone || !!(g.matchMedia && g.matchMedia("(display-mode: standalone)").matches); } catch (e) {}
    return { embedded, webkit, ios, standalone };
  }
  // pure: env -> {level, notes[]}
  function classify(env) {
    if (env.native) return { level: "chroniona", notes: [] };
    if (env.embedded && env.webkit) return { level: "tymczasowa", notes: [] };
    const notes = [];
    if (env.webkit && !env.standalone && !env.embedded) notes.push("W Safari dane strony nieotwieranej przez 7 dni mogą zostać usunięte. Dodaj ją do ekranu początkowego.");
    return { level: env.persisted ? "chroniona" : "zwykla", notes };
  }
  async function checkDurability() {
    const env = Object.assign(probeEnv(), cfg.storageEnv || {});      // storageEnv: only for tests
    if (env.persisted === undefined) {
      env.persisted = false;
      try {
        const sm = g.navigator && g.navigator.storage;
        if (sm && typeof sm.persisted === "function") {
          const ask = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
          let p = await ask(sm.persisted(), 1500);
          // an installed app (home screen, installed from the browser) asks once to be protected; a normal tab never asks
          if (!p && env.standalone && !env.embedded && typeof sm.persist === "function") p = await ask(sm.persist(), 1500);
          env.persisted = !!p;
        }
      } catch (e) {}
    }
    ctx.durability = Object.assign({ env }, classify(env));
    return ctx.durability;
  }
  const durabilityLevel = () => (ctx.durability ? ctx.durability.level : null);

  /* ---------- opening ---------- */
  function safeKv() { try { const s = g.localStorage; s.getItem("rytmBaza"); return s; } catch (e) { return null; } }
  function safeIdb() { try { return g.indexedDB || null; } catch (e) { return null; } }
  const emptyKv = { getItem: () => null, key: () => null, length: 0 };
  function idbAdapter() {
    let a = A.createIdbAdapter({ name: cfg.dbName, factory: safeIdb() });
    if (typeof cfg.wrapAdapter === "function") a = cfg.wrapAdapter(a) || a;
    return a;
  }
  function roError() { const e = new Error("Podgląd: zapis jest wyłączony."); e.name = "ReadOnlyError"; return e; }
  function readOnlyIdb() { return Object.assign({}, idbAdapter(), { readOnly: true, kind: "idb-podglad", commit: () => Promise.reject(roError()), destroy: () => Promise.reject(roError()) }); }
  const oldKv = () => (cfg.legacy === false ? null : ctx.kv);          // where the stage-1 keys are read from (never written)
  const legacyAdapter = () => A.createLegacyAdapter({ kv: oldKv() || emptyKv });
  const storeOptions = extra => Object.assign({ kv: ctx.kv, keys: cfg.keys }, cfg.storeOptions, extra);

  function acquireLock() {
    return new Promise(resolve => {
      let locks = null;
      try { locks = g.navigator && g.navigator.locks; } catch (e) {}
      if (!locks || typeof locks.request !== "function") { resolve(null); return; }     // not available: no protection, like before
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      try {
        locks.request(cfg.dbName + "-zapis", { ifAvailable: true }, lock => {
          if (!lock) { finish(false); return; }
          finish(true);
          return new Promise(() => {});           // held while the page is open
        }).catch(() => finish(null));
      } catch (e) { finish(null); }
      setTimeout(() => finish(null), cfg.lockTimeoutMs);
    });
  }

  async function start(cb) {
    ctx.cb = cb || {};
    if (!ctx.durability) await checkDurability();
    ctx.kv = safeKv();
    if (ctx.lock === null || ctx.lock === undefined) ctx.lock = await acquireLock();
    if (ctx.lock === false) return openView("druga-karta", readOnlyIdb());
    const store = await Store.open(storeOptions({ adapter: idbAdapter() }));
    return decide(store);
  }
  async function decide(store) {
    if (store.mode === Store.MODE.NORMAL) {
      const need = oldKv() ? Migrate.needed(store, oldKv()) : { needed: false };
      if (need.needed) { ctx.pending = store; return openView("przed-migracja", legacyAdapter()); }
      return useStore(store);
    }
    if (store.state === Store.STATE.DB_LOST) { ctx.lost = store; return openView("baza-zniknela", legacyAdapter()); }
    return openView("baza-niedostepna", legacyAdapter(), store);
  }
  async function openView(reason, adapter, failed) {
    const s = await Store.open(storeOptions({ adapter, kv: null }));
    if (failed) ctx.failed = failed;
    setStore(s, "podglad", reason);
    return ctx;
  }
  function useStore(store) {
    setStore(store, "normal", null);
    if (store.state === Store.STATE.MARKER_LOST)
      say.error("Mogły przepaść ostatnie niezapisane zmiany", ["Dane w localStorage zostały usunięte, a baza z danymi została. Zmiany, które w tej chwili czekały na zapis, mogły przepaść.", "Sprawdź ostatnie wpisy. Pozostałe dane są na miejscu."], { key: "marker-lost" });
    return ctx;
  }
  function setStore(s, mode, reason) {
    if (ctx.unsub) ctx.unsub();
    ctx.store = s; ctx.mode = mode; ctx.reason = reason;
    ctx.bridge = Bridge.create(s, { onBlocked: blocked });
    ctx.unsub = s.onStatus(onStatus);
    onStatus(s.status());
    renderBanner();
  }
  // re-reads everything (after the test panel changes the old data, or after a recovery)
  async function restart() {
    for (const s of [ctx.store, ctx.pending, ctx.lost]) if (s) { try { await s.close(); } catch (e) {} }
    ctx.store = ctx.pending = ctx.lost = ctx.failed = null; ctx.backupOk = null; ctx.report = null;
    await start(ctx.cb);
    if (ctx.cb.onData) ctx.cb.onData();
    return ctx;
  }

  /* ---------- status ---------- */
  function statusText(st = ctx.status) {
    if (!st || ctx.mode === "start") return "Wczytuję dane…";
    if (ctx.mode !== "normal" || st.tryb !== "normalny") return "Zapis wyłączony";
    if (st.blad && !st.blad.retrying) return `Błąd zapisu · niezapisane zmiany: ${st.niezapisane}`;
    if (st.niezapisane || st.zapisywanie) return "Zapisuję…";
    return (DURABILITY[durabilityLevel()] || DURABILITY.zwykla).status;
  }
  function stateClass(st = ctx.status) {
    if (!st || ctx.mode !== "normal" || st.tryb !== "normalny") return "off";
    if (st.blad && !st.blad.retrying) return "error";
    if (st.niezapisane || st.zapisywanie) return "saving";
    return durabilityLevel() === "tymczasowa" ? "temp" : "ok";
  }
  function onStatus(st) {
    ctx.status = st;
    const bb = $("bb-data");
    if (bb) bb.dataset.save = stateClass(st);
    if (ctx.mode === "normal" && st.tryb === "zablokowany" && st.stan === Store.STATE.DB_LOST && ctx.reason !== "zniknela-w-trakcie") {
      ctx.reason = "zniknela-w-trakcie"; renderBanner();
    }
    if (ctx.mode === "normal" && st.blad && !st.blad.retrying && st.tryb === "normalny") {
      say.error(`Nie zapisano ${st.niezapisane} ${plural(st.niezapisane, "zmiany", "zmian", "zmian")}`, [
        `${st.blad.text}: ${st.blad.detail}`,
        st.poziomy.dziennik && !st.poziomy.pamiec ? "Zmiany są widoczne i czekają w dzienniku na tym urządzeniu, ale nie ma ich jeszcze w bazie."
          : "Zmiany są widoczne, ale tylko do zamknięcia aplikacji.",
        "Jeśli błąd się powtarza, zapisz kopię teraz: będą w niej też te zmiany.",
      ], { key: "save-error", actions: [{ label: "Spróbuj ponownie", fn: retry }, { label: "Zapisz kopię teraz", fn: () => ctx.cb.exportNow && ctx.cb.exportNow() }] });
    } else if (!st.blad) say.dismiss("save-error");
    if (ctx.cb.onStatus) ctx.cb.onStatus(st);
    if ($("saveCard") && !$("saveCard").closest("[hidden]")) renderCard();
  }
  function retry() { if (ctx.store) ctx.store.retry().catch(() => {}); }
  function blocked(e) {
    if (e && e.code === "zly-zapis") {
      say.error("Nie zapisano zmiany: błąd w aplikacji", [msg(e), "Ekran pokazuje to, co jest zapisane. Zapisz kopię i wyślij zrzut ekranu."], { key: "bad-write" });
      return;
    }
    const [title] = VIEW_TEXT[ctx.reason] || ["Zapis jest wyłączony"];
    say.error("Nie zapisano tej zmiany", [title + ".", "Ekran wrócił do zapisanych danych."], { key: "blocked" });
  }
  // calls fn after the store confirms the save (forces the write now instead of waiting a moment)
  function whenSaved(res, fn, onFail) {
    if (!res || !res.ok) return;
    if (ctx.store) ctx.store.flush().catch(() => {});
    res.saved.then(() => fn && fn(), e => onFail && onFail(e));
  }

  /* ---------- the banner above every view ---------- */
  function renderBanner() {
    const b = $("dataBanner");
    if (!b) return;
    const reason = ctx.reason, temp = durabilityLevel() === "tymczasowa";
    if (!reason && !temp) { b.hidden = true; b.innerHTML = ""; document.body.classList.remove("readonly"); return; }
    let html = "";
    if (reason) {
      const [title, text] = VIEW_TEXT[reason];
      const btns = [`<button class="btn" type="button" data-dact="export">Zapisz kopię do pliku</button>`];
      if (reason === "przed-migracja") btns.unshift(`<button class="btn primary" type="button" data-dact="migrate">Przenieś dane</button>`);
      if (reason === "baza-zniknela") btns.unshift(`<button class="btn primary" type="button" data-dact="import">Wczytaj kopię</button>`);
      html += `<div class="d-err" role="alert"><strong>${esc(title)}</strong><p>${esc(text)}</p><div class="actions">${btns.join("")}</div></div>`;
    }
    if (temp) {
      const D = DURABILITY.tymczasowa;
      html += `<div class="d-warn" id="tempNote" role="note"><strong>${esc(D.title)}</strong><p>${esc(D.text)}</p>${reason ? "" : `<div class="actions"><button class="btn" type="button" data-dact="export">Zapisz kopię do pliku</button></div>`}</div>`;
    }
    b.innerHTML = html;
    b.hidden = false;
    document.body.classList.toggle("readonly", ctx.mode !== "normal" || reason === "zniknela-w-trakcie");
  }
  function onBannerClick(e) {
    const t = e.target.closest("[data-dact]"); if (!t) return;
    const a = t.dataset.dact;
    if (a === "export" && ctx.cb.exportNow) ctx.cb.exportNow();
    if (a === "migrate") showMigration();
    if (a === "import" && ctx.cb.showView) ctx.cb.showView("data");
    if (a === "rescue") saveRescue();
    if (a === "remigrate") remigrate();
  }

  /* ---------- the "Stan zapisu" card in Dane ---------- */
  function renderCard() {
    const el = $("saveCard"); if (!el) return;
    const st = ctx.status || {};
    const cls = stateClass(st);
    const rows = [];
    if (ctx.mode === "normal") {
      rows.push(["Miejsce zapisu", "baza danych na tym urządzeniu (IndexedDB)"]);
      const lvl = durabilityLevel();
      rows.push(["Trwałość zapisu", { tymczasowa: "tymczasowa: do zamknięcia aplikacji", zwykla: "zwykła: bez ochrony przed usunięciem", chroniona: "chroniona" }[lvl] || "nie sprawdzono"]);
      const zap = ctx.store ? ctx.store.get("meta", "zapis") : null;        // also from before this start
      const lastWrite = st.ostatniZapis || (zap && zap.at) || null;
      rows.push(["Ostatni zapis w bazie", lastWrite ? when(lastWrite) : "–"]);
      rows.push(["Czeka w dzienniku", String((st.poziomy && st.poziomy.dziennik) || 0)]);
      rows.push(["Tylko w pamięci", String((st.poziomy && st.poziomy.pamiec) || 0)]);
      rows.push(["Zmiany, których nie ma w żadnej kopii", st.odOstatniejKopii == null ? "nie wiadomo (zrób kopię)" : String(st.odOstatniejKopii)]);
    } else {
      rows.push(["Miejsce zapisu", "brak: tylko podgląd"]);
      rows.push(["Powód", (VIEW_TEXT[ctx.reason] || ["?"])[0]]);
    }
    rows.push(["Ostatnia kopia w pliku", st.ostatniaKopia ? when(st.ostatniaKopia) || st.ostatniaKopia : "jeszcze żadnej"]);
    const probs = (st.problemy || []).filter(p => !["localStorage-niedostepne"].includes(p.code) || ctx.mode === "normal");
    let html = `<h2 id="saveTitle">Stan zapisu</h2>
      <p class="savestate ${cls}"><span class="dot" aria-hidden="true"></span><strong>${esc(statusText(st))}</strong></p>
      <dl class="d-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
    if (st.blad && !st.blad.retrying && ctx.mode === "normal")
      html += `<div class="d-err" role="alert"><strong>${esc(st.blad.text)}</strong><p>${esc(st.blad.detail)}</p>
        <div class="actions"><button class="btn" type="button" data-dact2="retry">Spróbuj ponownie</button><button class="btn" type="button" data-dact2="export">Zapisz kopię teraz</button></div></div>`;
    const dur = ctx.durability, durNotes = dur ? [(DURABILITY[dur.level] || {}).text, ...dur.notes].filter(Boolean) : [];
    if (ctx.mode === "normal" && durNotes.length) html += `<ul class="d-where" id="durNotes">${durNotes.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`;
    if (probs.length) html += `<ul class="d-where">${probs.map(p => `<li>${esc(p.text)}</li>`).join("")}</ul>`;
    const mig = ctx.store && ctx.mode === "normal" ? ctx.store.get("meta", "migration") : null;
    if (mig && mig.state === "zweryfikowana")
      html += `<p class="meta">Dane przeniesione ze starego zapisu ${esc(when(mig.verifiedAt) || "")} i sprawdzone. Stary zapis został na urządzeniu bez zmian; aplikacja już go nie używa.</p>`;
    if (ctx.reason === "baza-zniknela") {
      const extra = [`<button class="btn" type="button" data-dact="rescue">Zapisz dane ratunkowe</button>`];
      if (oldKv() && Migrate.hasLegacy(oldKv())) extra.push(`<button class="btn" type="button" data-dact="remigrate">Przenieś ponownie stary zapis</button>`);
      html += `<div class="d-warn"><p>Możesz wczytać kopię poniżej. Dane ratunkowe to zmiany, które czekały w dzienniku, gdy baza zniknęła.${oldKv() && Migrate.hasLegacy(oldKv()) ? " Stary zapis (sprzed przeniesienia) też jest na urządzeniu, ale zawiera dane z dnia przeniesienia, bez późniejszych zmian." : ""}</p><div class="actions">${extra.join("")}</div></div>`;
    }
    html += `<p class="note">Zapis na tym urządzeniu nie chroni przed usunięciem danych witryny ani zgubieniem telefonu. Chroni tylko kopia w pliku.</p>`;
    el.innerHTML = html;
    el.hidden = false;
  }
  function onCardClick(e) {
    const t = e.target.closest("[data-dact2]");
    if (t) { if (t.dataset.dact2 === "retry") retry(); if (t.dataset.dact2 === "export" && ctx.cb.exportNow) ctx.cb.exportNow(); return; }
    onBannerClick(e);
  }
  async function saveRescue() {
    const out = {};
    try {
      for (let i = 0; i < ctx.kv.length; i++) { const k = ctx.kv.key(i); if (k === cfg.keys.journal || (k && k.indexOf(cfg.keys.journal + ".") === 0)) out[k] = ctx.kv.getItem(k); }
    } catch (e) {}
    if (!Object.keys(out).length) { say.info("Nie ma danych ratunkowych: dziennik był pusty."); return; }
    const r = await ctx.cb.saveTextFile(`${cfg.filePrefix}-dane-ratunkowe-${Date.now()}.txt`, JSON.stringify(out), "text/plain");
    if (!r.ok && !r.declined) say.error("Nie udało się zapisać pliku", ["Spróbuj „Zapisz kopię do pliku” albo zrób zrzut ekranu."]);
  }
  async function remigrate() {
    if (!ctx.lost) return;
    try { await ctx.lost.startFresh(); }
    catch (e) { say.error("Nie udało się założyć nowej bazy", [msg(e)]); return; }
    ctx.pending = ctx.lost; ctx.lost = null; ctx.reason = "przed-migracja";
    renderBanner();
    showMigration();
  }

  /* ---------- import into the store (the app builds the records) ---------- */
  function canImport() { return ctx.mode === "normal" ? (ctx.status && ctx.status.tryb === "normalny") : ctx.reason === "baza-zniknela" && !!ctx.lost; }
  async function replaceAll(records) {
    if (ctx.mode !== "normal") {
      if (ctx.reason !== "baza-zniknela" || !ctx.lost) throw new Error((VIEW_TEXT[ctx.reason] || ["Zapis jest wyłączony"])[0]);
      await ctx.lost.startFresh();
      const s = ctx.lost; ctx.lost = null;
      useStore(s);                                   // an empty, working database from now on
      if (ctx.cb.onData) ctx.cb.onData();            // the screen must not keep showing the old read-only view
      await s.replaceAll(records);
      return;
    }
    await ctx.store.replaceAll(records);
  }

  /* ---------- the migration screen ---------- */
  function legacyData() {
    const L = Migrate.readLegacy(oldKv() || emptyKv), P = L.parts, v = p => (p.present && p.ok ? p.value : null);
    return { L, csv: v(P.csv), fit: v(P.fit), habits: v(P.habits) };
  }
  function expectedSummary(d) {
    let rows = 0;
    if (d.csv) { try { rows = ctx.cb.parseCsv(d.csv).length; } catch (e) { rows = null; } }
    return Backup.summarize({ swimCsv: d.csv ? { text: d.csv } : null, fit: d.fit || {}, habits: d.habits || {} }, rows);
  }
  function backupTextFrom(d) {
    const fit = d.fit || {};
    const state = { csvText: d.csv || null, fit: { acts: fit.acts || {}, bad: fit.bad || {}, last: fit.last || [], hidden: fit.hidden || {} }, habits: d.habits || {} };
    let rows = 0;
    if (d.csv) { try { rows = ctx.cb.parseCsv(d.csv).length; } catch (e) { rows = null; } }
    return JSON.stringify(Backup.build(state, { appVersion: g.Rytm.VERSION, csvRows: rows }));
  }
  const SUMMARY_ROWS = [["Nawyki", "habits"], ["Dni z wpisami", "habitDays"], ["Notatki", "notes"], ["Treningi z CSV", "csvTrainings"], ["Treningi z FIT", "fitTrainings"], ["Usunięte treningi", "hiddenTrainings"]];
  function showMigration() {
    const v = $("v-migrate"); if (!v) return;
    document.body.classList.add("migrating");
    v.hidden = false;
    renderMigration();
    try { g.scrollTo({ top: 0 }); } catch (e) {}
  }
  function hideMigration() {
    document.body.classList.remove("migrating");
    const v = $("v-migrate"); if (v) v.hidden = true;
  }
  function renderMigration() {
    const v = $("v-migrate"); if (!v) return;
    const d = legacyData(), sm = expectedSummary(d);
    const skipped = Migrate.LEGACY.filter(x => d.L.parts[x.part].present && !d.L.parts[x.part].ok);
    v.innerHTML = `<header class="vh"><div><p class="eyebrow">Rytm</p><h1 id="m-title">Nowy sposób zapisu</h1></div></header>
      <section class="panel">
        <p>Rytm będzie zapisywać dane w bazie danych przeglądarki (IndexedDB). Zapis jest pewniejszy przy błędach i nie ma limitu kilku MB. Najpierw zapiszesz kopię, potem przeniosę dane i sprawdzę każdą część. Stare dane zostaną na urządzeniu bez zmian.</p>
        <div class="d-grid">${SUMMARY_ROWS.map(([k, key]) => `<div><span class="k">${k}</span><span class="v">${sm[key] == null ? "–" : sm[key]}</span></div>`).join("")}</div>
        ${durabilityLevel() === "tymczasowa" ? `<div class="d-warn" id="migTemp"><strong>${esc(DURABILITY.tymczasowa.title)}</strong><p>Przeniesione dane też znikną po zamknięciu aplikacji. Trwała zostanie tylko kopia zapasowa z kroku 1.</p></div>` : ""}
        ${skipped.length ? `<div class="d-warn"><strong>Tej części nie da się odczytać</strong><ul>${skipped.map(x => `<li>${esc(x.label)}: ${esc(d.L.parts[x.part].reason)}. Nie zostanie przeniesiona i zostaje w starym zapisie bez zmian.</li>`).join("")}</ul></div>` : ""}
      </section>
      <section class="panel" aria-labelledby="m1">
        <h2 id="m1">1. Kopia zapasowa</h2>
        <p class="hint">Plik ze wszystkim, co widać powyżej. Zanim go zapiszę, sprawdzę, czy da się go odczytać i czy liczby się zgadzają. Bez zapisanej kopii nie zacznę przenoszenia.</p>
        <div class="actions"><button class="btn primary" type="button" id="migSave">Zapisz kopię zapasową</button></div>
        <div id="migSaveState" role="status"></div>
      </section>
      <section class="panel" aria-labelledby="m2">
        <h2 id="m2">2. Przeniesienie</h2>
        <p class="hint">Zapiszę wszystko w nowej bazie jednym ruchem, odczytam z powrotem i porównam ze starym zapisem. Jeśli coś się nie zgodzi, nowa baza zostanie usunięta, a twoje dane zostaną tak jak teraz.</p>
        <div class="actions"><button class="btn primary" type="button" id="migGo" disabled>Przenieś dane</button></div>
        <div id="migResult" role="status"></div>
      </section>
      <div class="actions"><button class="btn link" type="button" id="migLater">Na razie nie przenoś — pokaż dane bez możliwości zmian</button></div>`;
    $("migSave").addEventListener("click", migSave);
    $("migGo").addEventListener("click", migGo);
    $("migLater").addEventListener("click", () => { hideMigration(); if (ctx.cb.showView) ctx.cb.showView("habits"); });
    if (ctx.backupOk) backupDone(ctx.backupOk);
  }
  function setSaveState(html) { const el = $("migSaveState"); if (el) el.innerHTML = html; }
  async function migSave() {
    const btn = $("migSave"); btn.disabled = true;
    ctx.backupOk = null; $("migGo").disabled = true;
    setSaveState(`<p class="meta">Sprawdzam kopię…</p>`);
    const d = legacyData();
    let text = null, v = null, want = null;
    try { text = backupTextFrom(d); want = expectedSummary(d); v = Backup.validate(text, { parseCsv: ctx.cb.parseCsv }); }
    catch (e) { v = { ok: false, errors: [msg(e)] }; }
    const keys = ["habits", "habitDays", "notes", "skippedDays", "csvTrainings", "fitTrainings", "hiddenTrainings"];
    const mismatch = v.ok ? keys.filter(k => (v.summary[k] ?? null) !== (want[k] ?? null)) : [];
    if (!v.ok || mismatch.length) {
      setSaveState(`<div class="d-err" role="alert"><strong>Kopia nie przeszła sprawdzenia, więc nie zaczynam przenoszenia</strong><ul>${(v.ok ? mismatch.map(k => `Niezgodna liczba: ${k}`) : v.errors).map(x => `<li>${esc(x)}</li>`).join("")}</ul><p>Twoje dane są bez zmian. Zapisz kopię jako tekst w zakładce Dane i wyślij ją do sprawdzenia.</p></div>`);
      btn.disabled = false;
      return;
    }
    const name = Backup.fileName().replace(/^rytm-/, cfg.filePrefix + "-");
    const r = await ctx.cb.saveTextFile(name, text);
    btn.disabled = false;
    const info = { name, summary: v.summary };
    if (r.ok && !r.unsure) { backupDone(info); return; }
    if (r.ok && r.unsure) {
      setSaveState(`<div class="d-prev"><p>Plik ${esc(name)} powinien być w folderze Pobrane. Sprawdź, czy tam jest.</p>
        <div class="actions"><button class="btn" type="button" id="migSavedYes">Plik się zapisał</button><button class="btn link" type="button" id="migSavedNo">Nie widzę pliku</button></div></div>`);
      $("migSavedYes").addEventListener("click", () => backupDone(info));
      $("migSavedNo").addEventListener("click", () => setSaveState(`<div class="d-err"><strong>Bez kopii nie przenoszę danych</strong><p>Spróbuj zapisać kopię jeszcze raz albo w innej przeglądarce.</p></div>`));
      return;
    }
    setSaveState(`<div class="d-err" role="alert"><strong>${r.declined ? "Zapis pliku został anulowany" : "Nie udało się zapisać pliku kopii"}</strong><p>Bez zapisanej kopii nie przenoszę danych. Spróbuj jeszcze raz.</p></div>`);
  }
  function backupDone(info) {
    ctx.backupOk = info;
    const s = info.summary;
    setSaveState(`<p class="savestate ok"><span class="dot" aria-hidden="true"></span><strong>Kopia zapisana i sprawdzona: ${esc(info.name)}</strong></p>
      <p class="meta">W kopii: ${s.habits} ${plural(s.habits, "nawyk", "nawyki", "nawyków")}, ${s.habitDays} dni z wpisami, ${s.fitTrainings} treningów z FIT, ${s.csvTrainings ?? 0} z CSV.</p>`);
    const go = $("migGo"); if (go) go.disabled = false;
  }
  const PART_LABEL = { zgodne: "✓ zgodne", brak: "– brak", pominiete: "⚠ pominięte", rozne: "✗ różne" };
  function reportTable(rep) {
    return `<div class="tablewrap"><table class="tr-ctable"><thead><tr><th>Część</th><th>Wynik</th><th>Szczegóły</th></tr></thead><tbody>
      ${rep.parts.map(p => `<tr><th scope="row">${esc(p.label)}</th><td>${PART_LABEL[p.status] || esc(p.status)}</td><td>${esc(p.detail)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  async function migGo() {
    if (!ctx.backupOk) return;                     // never without a saved, checked backup
    const go = $("migGo"); go.disabled = true; $("migSave").disabled = true;
    const out = $("migResult");
    out.innerHTML = `<p class="meta">Przenoszę i sprawdzam dane…</p>`;
    let store = ctx.pending;
    if (!store || store.mode !== Store.MODE.NORMAL) {
      store = await Store.open(storeOptions({ adapter: idbAdapter() }));
      if (store.mode !== Store.MODE.NORMAL) {
        out.innerHTML = `<div class="d-err" role="alert"><strong>Nie mogę otworzyć nowej bazy danych</strong><p>${esc((store.status().problemy[0] || {}).text || store.state)}</p><p>Twoje dane są bez zmian.</p></div>`;
        go.disabled = false; $("migSave").disabled = false;
        return;
      }
    }
    let rep;
    try { rep = await Migrate.run({ store, kv: oldKv() || emptyKv, version: g.Rytm.VERSION }); }
    catch (e) { rep = { ok: false, error: msg(e), parts: [] }; }
    ctx.report = rep;
    if (rep.ok) {
      ctx.pending = null;
      useStore(store);
      if (ctx.cb.onData) ctx.cb.onData();
      out.innerHTML = `<p class="savestate ok"><span class="dot" aria-hidden="true"></span><strong>Dane przeniesione i sprawdzone</strong></p>${reportTable(rep)}
        <p class="meta">Stary zapis został na urządzeniu bez zmian. Aplikacja zapisuje teraz w nowej bazie.</p>
        <div class="actions"><button class="btn primary" type="button" id="migDone">Przejdź do aplikacji</button></div>`;
      $("migDone").addEventListener("click", () => { hideMigration(); if (ctx.cb.showView) ctx.cb.showView("habits"); });
      return;
    }
    ctx.pending = null;
    out.innerHTML = `<div class="d-err" role="alert"><strong>Nie przeniosłem danych</strong><p>${esc(rep.error || "")}</p>
      <p>Twoje dane są bez zmian: stary zapis nie był ruszany${rep.cleanup && rep.cleanup.ok ? ", a nowa baza została usunięta" : ""}. Aplikacja pokazuje je bez możliwości zmian.</p></div>
      ${rep.parts && rep.parts.length ? reportTable(rep) : ""}
      <div class="actions"><button class="btn" type="button" id="migAgain">Spróbuj ponownie</button></div>`;
    $("migAgain").addEventListener("click", () => { go.disabled = false; $("migSave").disabled = false; out.innerHTML = ""; });
  }

  function init() {
    const b = $("dataBanner"); if (b) b.addEventListener("click", onBannerClick);
    const c = $("saveCard"); if (c) c.addEventListener("click", onCardClick);
    if (cfg.test) {
      const band = document.createElement("div");
      band.className = "testband"; band.id = "testBand"; band.setAttribute("role", "note");
      band.textContent = cfg.label || "WERSJA TESTOWA";
      document.body.prepend(band);
      document.body.classList.add("is-test");
    }
    window.addEventListener("pagehide", () => { if (ctx.store && ctx.mode === "normal") ctx.store.flush().catch(() => {}); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && ctx.store && ctx.mode === "normal") ctx.store.flush().catch(() => {}); });
    window.addEventListener("beforeunload", e => { const st = ctx.status; if (ctx.mode === "normal" && st && st.niezapisane) { e.preventDefault(); e.returnValue = ""; } });
  }

  g.RytmData = { ctx, cfg, start, restart, statusText, stateClass, classify, DURABILITY, get durability() { return ctx.durability; }, whenSaved, renderCard, renderBanner, showMigration, hideMigration, canImport, replaceAll, VIEW_TEXT, init,
    get store() { return ctx.store; }, get bridge() { return ctx.bridge; }, get mode() { return ctx.mode; }, get reason() { return ctx.reason; } };
})(typeof window !== "undefined" ? window : globalThis);
