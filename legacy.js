// Rytm: read-only view of the stage-1 localStorage keys (stage 2A).
// Lets the store show the old data without a database. It cannot write or delete anything:
// commit and destroy always fail, and the store does not touch localStorage when it is opened on this adapter.
(function (g) {
  "use strict";
  const Migrate = g.RytmMigrate || (typeof require === "function" ? require("../migrate.js") : null);
  const readOnly = () => { const e = new Error("Stary zapis jest tylko do odczytu."); e.name = "ReadOnlyError"; return Promise.reject(e); };
  function createLegacyAdapter({ kv } = {}) {
    if (!kv) throw new Error("createLegacyAdapter: brak localStorage");
    const load = async () => Migrate.fromLegacy(Migrate.readLegacy(kv)).records;
    return {
      kind: "legacy", readOnly: true,
      async open() { return { created: false }; },
      loadAll: load, readFresh: load,
      commit: readOnly, destroy: readOnly,
      async reopen() { return { created: false }; },
      async close() {},
    };
  }
  const api = { createLegacyAdapter };
  g.RytmAdapters = Object.assign(g.RytmAdapters || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
