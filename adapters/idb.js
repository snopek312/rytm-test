// Rytm: IndexedDB storage adapter (stage 2A).
// One object store per collection, records keyed by "id". A commit is one readwrite transaction:
// it counts as saved only when the transaction reports "complete"; any error aborts the whole transaction.
(function (g) {
  "use strict";
  const Store = g.RytmStore || (typeof require === "function" ? require("../store.js") : null);
  const COLLECTIONS = Store.COLLECTIONS;
  const VERSION = 1;
  const err = (name, m) => { let e; try { e = new DOMException(m, name); } catch (x) { e = new Error(m); e.name = name; } return e; };

  function createIdbAdapter(opts = {}) {
    const name = opts.name || "rytm";
    const factory = opts.factory || g.indexedDB;
    let db = null, lost = null;

    function openConnection(track) {
      return new Promise((resolve, reject) => {
        let req, created = false;
        try {
          if (!factory) throw err("NotSupportedError", "Ta przeglądarka nie obsługuje IndexedDB.");
          req = factory.open(name, VERSION);
        } catch (e) { reject(e); return; }
        req.onupgradeneeded = ev => {
          created = ev.oldVersion === 0;
          const d = req.result;
          for (const c of COLLECTIONS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: "id" });
        };
        req.onsuccess = () => {
          const d = req.result;
          if (track) {
            // another tab upgrades or deletes the database (e.g. website data cleared): let it go, report it on the next write
            d.onversionchange = () => { try { d.close(); } catch (e) {} if (db === d) { db = null; lost = "inna karta albo usunięcie danych witryny"; } };
            d.onclose = () => { if (db === d) { db = null; lost = "przeglądarka zamknęła połączenie"; } };
          }
          resolve({ d, created });
        };
        req.onerror = () => reject(req.error || err("UnknownError", "Nie udało się otworzyć bazy."));
        req.onblocked = () => {};      // waits for other connections; the store has a time limit
      });
    }
    function need() {
      if (!db) throw err("InvalidStateError", "Połączenie z bazą zostało zamknięte" + (lost ? ` (${lost})` : "") + ".");
      return db;
    }
    function readAll(d) {
      return new Promise((resolve, reject) => {
        const out = {};
        let tx;
        try { tx = d.transaction(COLLECTIONS, "readonly"); } catch (e) { reject(e); return; }
        for (const c of COLLECTIONS) { const r = tx.objectStore(c).getAll(); r.onsuccess = () => { out[c] = r.result; }; }
        tx.oncomplete = () => resolve(out);
        tx.onabort = () => reject(tx.error || err("AbortError", "Odczyt został przerwany."));
      });
    }

    return {
      kind: "idb", name,
      async open() { const { d, created } = await openConnection(true); db = d; lost = null; return { created }; },
      loadAll() { return readAll(need()); },
      commit({ clear = [], puts = [] } = {}) {
        return new Promise((resolve, reject) => {
          let d;
          try { d = need(); } catch (e) { reject(e); return; }
          const stores = [...new Set([...clear, ...puts.map(p => p.coll)])];
          if (!stores.length) { resolve(); return; }
          let tx;
          try { tx = d.transaction(stores, "readwrite", { durability: "strict" }); } catch (e) { reject(e); return; }
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error || err("AbortError", "Zapis został przerwany."));
          try {
            for (const c of clear) tx.objectStore(c).clear();
            for (const p of puts) tx.objectStore(p.coll).put(p.rec);
          } catch (e) {
            try { tx.abort(); } catch (e2) {}
            reject(e);
          }
        });
      },
      // a second, separate connection: what is really on the disk, not what this connection remembers
      async readFresh() {
        const { d } = await openConnection(false);
        try { return await readAll(d); } finally { try { d.close(); } catch (e) {} }
      },
      async reopen() { if (db) { try { db.close(); } catch (e) {} db = null; } return this.open(); },
      async close() { if (db) { try { db.close(); } catch (e) {} } db = null; },
      destroy() {
        if (db) { try { db.close(); } catch (e) {} db = null; }
        return new Promise((resolve, reject) => {
          let req;
          try { req = factory.deleteDatabase(name); } catch (e) { reject(e); return; }
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error || err("UnknownError", "Nie udało się usunąć bazy."));
          req.onblocked = () => {};
        });
      },
      // tests only: the connection breaks the way it does when the browser drops it
      __testLoseConnection() { if (db) { try { db.close(); } catch (e) {} } },
    };
  }
  const api = { createIdbAdapter, IDB_VERSION: VERSION };
  g.RytmAdapters = Object.assign(g.RytmAdapters || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
