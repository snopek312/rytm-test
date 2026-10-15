// Rytm: test panel — ONLY in the test version ("Rytm – wersja testowa"). The real app does not include this file,
// and even if it did, it does nothing unless RytmConfig.test is set by the test build.
// Gives two switches for trying things on a phone: put synthetic stage-1 data into this test version's own storage
// (only when there is no old data at all, so nothing is overwritten), and make database writes fail on purpose.
// There is no button that deletes data.
(function (g) {
  "use strict";
  const C = g.RytmConfig;
  if (!C || !C.test) return;
  const state = { failWrites: false };
  C.wrapAdapter = a => Object.assign({}, a, {
    kind: a.kind + "+panel-testowy",
    commit(batch) {
      if (state.failWrites) { const e = new Error("Symulowany błąd zapisu (panel testowy)"); e.name = "AbortError"; return Promise.reject(e); }
      return a.commit(batch);
    },
  });

  const OLD_KEYS = ["mojBasenCsv", "mojBasenFit", "rytmHabits", "rytmPrzedImportem", "rytmOstatniaKopia", "rytmTimer"];
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // synthetic data in the stage-1 format; dates are relative to today so the charts show them
  function synthLegacy(now = new Date()) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 30);
    const daysAgo = n => new Date(base.getTime() - n * 864e5);
    const head = "Typ aktywności,Data,Ulubiony,Tytuł,Dystans,Suma kalorii,Czas,Średnie tętno,Maksymalne tętno,Aerobowy TE,Średnie tempo,Średni Swolf,Czas ruchu";
    const rows = [head];
    for (let i = 0; i < 12; i++) {
      const d = daysAgo(3 + i * 3), dist = 1200 + (i % 4) * 200, mins = 30 + (i % 5) * 3;
      rows.push(`Pływanie w basenie,${dayKey(d)} 07:30:00,false,Basen testowy ${i + 1},${dist},${300 + i * 7},00:${mins}:00,${140 + (i % 6)},${170 + (i % 9)},${(2.6 + (i % 5) / 10).toFixed(1)},2:${30 + (i % 20)},${36 + (i % 5)},00:${mins - 3}:00`);
    }
    rows.push(`Siatkówka,${dayKey(daysAgo(5))} 18:00:00,false,Siatkówka testowa,--,420,01:30:00,128,171,2.4,--,--,01:25:00`);
    const acts = {};
    [2, 8, 14].forEach((ago, n) => {
      const start = daysAgo(ago).getTime(), L = [], H = [];
      let a = 0;
      for (let k = 0; k < 48; k++) {
        const ms = 21000 + ((k * 977 + n * 131) % 6000), sec = Math.round(ms / 1000);
        L.push([k % 16 === 15 ? "idle" : ["free", "free", "back", "breast"][k % 4], ms, a, a + sec, 11 + (k % 6), 120 + ((k * 7 + n) % 50)]);
        a += sec + 2;
      }
      for (let t = 0; t < a; t += 10) H.push([t, 115 + ((t / 10 + n * 3) % 60)]);
      const id = new Date(start).toISOString();
      acts[id] = { v: 4, id, start, pool: 25, P: { len: 25, unit: "metric", dist: 45 * 25, active: 45 }, sum: { dist: 1125, timer: a, elapsed: a + 20, avgHr: 141, maxHr: 172, kcal: 250, te: 2.9 }, L, H };
    });
    const ids = Object.keys(acts);
    const hiddenDay = daysAgo(3 + 11 * 3);
    const fit = { acts, bad: { [ids[0]]: [3] }, last: [ids[ids.length - 1]], hidden: { ["c" + new Date(dayKey(hiddenDay) + "T07:30:00").getTime()]: new Date(base.getTime() - 864e5).toISOString() } };
    const t0 = dayKey(daysAgo(20));
    const habits = {
      habits: [
        { id: "t-zeby", name: "Mycie zębów (test)", type: "count", target: 3, color: 0, created: t0 },
        { id: "t-cukier", name: "Bez słodyczy (test)", type: "bool", color: 4, created: t0 },
        { id: "t-trening", name: "Rozciąganie (test)", type: "time", dir: "min", goal: 15, step: 5, color: 3, created: t0 },
      ],
      log: {}, notes: {}, skips: {},
    };
    for (let i = 1; i <= 6; i++) habits.log[dayKey(daysAgo(i))] = { "t-zeby": 1 + (i % 3), "t-cukier": i % 2 === 0, "t-trening": 5 * (i % 4) };
    habits.notes[dayKey(daysAgo(2))] = "Notatka testowa — „zażółć gęślą jaźń”";
    habits.skips[dayKey(daysAgo(7))] = "Wyjazd";
    return {
      mojBasenCsv: rows.join("\n"),
      mojBasenFit: JSON.stringify(fit),
      rytmHabits: JSON.stringify(habits),
      rytmOstatniaKopia: new Date(base.getTime() - 3 * 864e5).toISOString(),
    };
  }

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ls() { try { return g.localStorage; } catch (e) { return null; } }
  function oldKeysPresent() { const s = ls(); if (!s) return []; return OLD_KEYS.filter(k => { try { return s.getItem(k) != null; } catch (e) { return false; } }); }
  function canInsert() {
    const D = g.RytmData; if (!D || !D.store) return { ok: false, why: "Aplikacja jeszcze się wczytuje." };
    if (oldKeysPresent().length) return { ok: false, why: "Stare dane już są w tej wersji testowej — nic nie nadpisuję." };
    if (D.mode !== "normal") return { ok: false, why: "Zapis jest wyłączony." };
    if (D.store.hasUserData() || D.store.get("meta", "migration")) return { ok: false, why: "Nowa baza tej wersji testowej ma już dane. Do nowej próby potrzebna jest nowa wersja testowa." };
    return { ok: true };
  }
  async function insert() {
    const c = canInsert();
    if (!c.ok) { g.Rytm.notify.info(c.why); render(); return; }
    const s = ls();
    try { for (const [k, v] of Object.entries(synthLegacy())) s.setItem(k, v); }
    catch (e) { g.Rytm.notify.error("Nie udało się wstawić danych testowych", [String(e && e.message || e)]); return; }
    await g.RytmData.restart();
    if (g.RytmData.reason === "przed-migracja") g.RytmData.showMigration();
  }
  function render() {
    const el = $("testPanel"); if (!el) return;
    const D = g.RytmData, st = D && D.store ? D.store.status() : null, c = canInsert(), keys = oldKeysPresent();
    el.hidden = false;
    el.innerHTML = `<h2>Panel testowy</h2>
      <p class="hint">Tylko w wersji testowej. Ta wersja ma własną bazę <code>${esc(C.dbName)}</code> i własne klucze (<code>${esc(C.keys.marker)}</code>, <code>${esc(C.keys.journal)}</code>). Wszystkie dane tutaj są syntetyczne. Nie ma przycisku usuwania danych: kolejna próba to nowa wersja testowa.</p>
      <div class="actions"><button class="btn" type="button" id="tpInsert" ${c.ok ? "" : "disabled"}>Wstaw stare dane testowe (format etapu 1)</button></div>
      <p class="meta">${c.ok ? "Wstawi syntetyczne dane w starym formacie; potem pojawi się ekran przenoszenia danych." : esc(c.why)}</p>
      <label class="d-check"><input type="checkbox" id="tpFail" ${state.failWrites ? "checked" : ""}> <span>Symuluj błąd zapisu do bazy. Komunikat pojawi się po trzech ponownych próbach (około 15 s).</span></label>
      <details><summary>Szczegóły magazynu</summary><pre class="tp-pre">${esc(JSON.stringify({ tryb: D && D.mode, powod: D && D.reason, stareKlucze: keys, stan: st }, null, 2))}</pre></details>`;
    $("tpInsert").addEventListener("click", insert);
    $("tpFail").addEventListener("change", e => { state.failWrites = e.target.checked; g.Rytm.notify.info(state.failWrites ? "Zapis do bazy będzie się teraz nie udawał." : "Zapis do bazy działa normalnie. Użyj „Spróbuj ponownie”, jeśli coś czeka."); });
  }
  g.RytmTestPanel = { render, synthLegacy, state };
})(typeof window !== "undefined" ? window : globalThis);
