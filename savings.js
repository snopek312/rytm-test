// Rytm: savings (Oszczędzanie), locked with a PIN. The amounts are encrypted with a key made from the PIN
// (PBKDF2-SHA-256 → AES-GCM 256, Web Crypto), and only the encrypted box is ever saved — in the data store and in backups.
// Without the PIN nobody (not even the app) can read them. A forgotten PIN cannot be recovered: "zacznij od nowa" puts the
// old encrypted box aside (nothing is deleted), so it can be restored if the old PIN comes back to mind.
// Saved record (meta "savings"): {v:1, box:{v,kdf,iter,salt,iv,ct}|null, old:[box,...]}
// Decrypted data (only in memory while unlocked): {v:1, goals:[{id, name, target, deadline}], moves:[{id, date, amount, goal, note}]}
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const ITER = 300000;
  const PIN_RE = /^\d{4,8}$/;
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const r2 = x => Math.round(x * 100) / 100;
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cryptoObj = () => (g.crypto && g.crypto.subtle ? g.crypto : (typeof require === "function" ? require("crypto").webcrypto : null));

  // bytes <-> text and base64, without relying on TextEncoder (older test environments lack it)
  function utf8(s) { const b = unescape(encodeURIComponent(s)), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function fromUtf8(u) { let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return decodeURIComponent(escape(s)); }
  function b64(u) { let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return (g.btoa || btoa)(s); }
  function unb64(s) { const b = (g.atob || atob)(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  const random = n => { const a = new Uint8Array(n); cryptoObj().getRandomValues(a); return a; };

  async function deriveKey(pin, salt, iter) {
    const C = cryptoObj().subtle;
    const base = await C.importKey("raw", utf8(pin), "PBKDF2", false, ["deriveKey"]);
    return C.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(data, key, salt, iter) {
    const iv = random(12);
    const ct = await cryptoObj().subtle.encrypt({ name: "AES-GCM", iv }, key, utf8(JSON.stringify(data)));
    return { v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  const isBox = b => !!b && typeof b === "object" && typeof b.salt === "string" && typeof b.iv === "string" && typeof b.ct === "string" && Number.isInteger(b.iter) && b.iter > 0;
  // a wrong PIN makes AES-GCM fail: the promise rejects
  async function unlockBox(box, pin, iterOverride) {
    const salt = unb64(box.salt), key = await deriveKey(pin, salt, box.iter);
    const pt = await cryptoObj().subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
    return { key, salt, iter: box.iter, data: normalizeData(JSON.parse(fromUtf8(new Uint8Array(pt)))) };
  }
  async function createBox(pin, data, iter = ITER) {
    const salt = random(16), key = await deriveKey(pin, salt, iter);
    return { key, salt, iter, box: await seal(normalizeData(data), key, salt, iter) };
  }

  function emptyData() { return { v: 1, goals: [], moves: [] }; }
  function normalizeData(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return emptyData();
    const ids = new Set(), fresh = x => x && typeof x.id === "string" && x.id && !ids.has(x.id);
    const goals = (Array.isArray(o.goals) ? o.goals : []).filter(x => fresh(x) && str(x.name, 60) && typeof x.target === "number" && x.target > 0 && x.target < 1e8 && ids.add(x.id))
      .map(x => ({ id: x.id, name: str(x.name, 60), target: r2(x.target), deadline: DAY.test(x.deadline || "") ? x.deadline : null }));
    const gids = new Set(goals.map(x => x.id));
    const moves = (Array.isArray(o.moves) ? o.moves : []).filter(x => fresh(x) && typeof x.amount === "number" && isFinite(x.amount) && x.amount !== 0 && Math.abs(x.amount) < 1e8 && DAY.test(x.date || "") && ids.add(x.id))
      .map(x => ({ id: x.id, date: x.date, amount: r2(x.amount), goal: gids.has(x.goal) ? x.goal : null, note: str(x.note, 80) }));
    return { v: 1, goals, moves };
  }
  function normalizeRecord(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    return { v: 1, box: o && isBox(o.box) ? o.box : null, old: o && Array.isArray(o.old) ? o.old.filter(isBox) : [] };
  }

  const balance = (D, goalId) => r2(D.moves.filter(m => goalId === undefined || m.goal === goalId).reduce((s, m) => s + m.amount, 0));
  // the date `months` months before `today` (same day of the month, or the last day of a shorter month)
  function monthsBefore(today, months) { const d = parseDay(today), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() - months); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return dayKey(d); }
  // net saving per month over the last `months` months (all goals, or one)
  function perMonth(D, today, months = 3, goalId) {
    const from = monthsBefore(today, months);
    return r2(D.moves.filter(m => m.date > from && m.date <= today && (goalId === undefined || m.goal === goalId)).reduce((s, m) => s + m.amount, 0) / months);
  }
  // when the target is reached at the current pace: {done} | {months, date} | null (no saving lately)
  function forecast(target, saved, monthly, today) {
    if (saved >= target) return { done: true };
    if (!(monthly > 0)) return null;
    const months = Math.ceil((target - saved) / monthly - 1e-9), d = parseDay(today);
    d.setMonth(d.getMonth() + months);
    return { months, date: dayKey(d) };
  }
  // how much a month is needed to reach the target by the deadline
  function neededPerMonth(target, saved, deadline, today) {
    if (!deadline || saved >= target) return null;
    const a = parseDay(today), b = parseDay(deadline);
    const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1);
    return months <= 0 ? { late: true, rest: r2(target - saved) } : { months, amount: r2((target - saved) / months) };
  }
  // the balance after each day with a move, for the chart
  function series(D) {
    const by = new Map(); for (const m of D.moves) by.set(m.date, (by.get(m.date) || 0) + m.amount);
    let s = 0; return [...by.keys()].sort().map(k => { s = r2(s + by.get(k)); return { date: k, balance: s }; });
  }

  const core = { ITER, PIN_RE, utf8, fromUtf8, b64, unb64, deriveKey, seal, unlockBox, createBox, isBox, emptyData, normalizeData, normalizeRecord, balance, perMonth, forecast, neededPerMonth, series, monthsBefore, dayKey };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmSavings = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
  const zl = x => money.format(x);
  const fmtShort = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
  const fmtMonth = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
  const fmtLong = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let R = normalizeRecord(null), P = null, now = () => new Date(), iterNew = ITER;
  let D = null, K = null;                         // decrypted data and the key, only while unlocked
  let queue = Promise.resolve(), chart = null;
  const ui = { mode: null, busy: false, wrong: 0, until: 0, forgot: false, restore: false, archive: false, sheet: null, msg: "" };
  const today = () => dayKey(now());
  const canWrite = () => !!(P && P.writable && P.writable());
  const isOpen = () => !!D;

  function attach(persist) { P = persist || null; R = normalizeRecord(P && P.load ? P.load() : null); lock(true); }
  // what goes into the backup: only the encrypted record (null if no PIN was ever set)
  function exportState() { return R.box || R.old.length ? JSON.parse(JSON.stringify(R)) : null; }
  function lock(silent) {
    D = null; K = null; ui.sheet = null; ui.forgot = false; ui.restore = false; ui.msg = "";
    ui.mode = R.box ? "locked" : "setup";
    if (chart) { try { chart.destroy(); } catch (e) {} chart = null; }
    render();
    if (!silent) renderSheet();
  }
  // every change: the screen first, then encryption, then the store; the message only after the store confirmed it
  function save(nextData, okText, undoTo) {
    if (!P || !P.save || !isOpen()) return false;
    const prev = D, key = K;
    D = normalizeData(nextData); render();
    const data = D;
    queue = queue.then(async () => {
      let box;
      try { box = await seal(data, key.key, key.salt, key.iter); }
      catch (e) { if (D === data) { D = prev; render(); } say().error("Nie udało się zaszyfrować zmian", [String(e && e.message || e), "Nic nie zostało zapisane."]); return; }
      const rec = { v: 1, box, old: R.old };
      let res;
      try { res = { ok: true, saved: P.save(rec) }; }
      catch (e) { if (D === data) { D = prev; render(); } return; }
      R = rec;
      if (okText && P.whenSaved) P.whenSaved(res, () => say().info(okText, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
    });
    return true;
  }

  /* ---------- screens ---------- */
  function lockView() {
    const dis = canWrite() ? "" : "disabled", wait = Math.max(0, Math.ceil((ui.until - Date.now()) / 1000));
    if (ui.mode === "setup") {
      return `<section class="panel sv-lock"><h2>${ui.archive ? "Nowy PIN" : "Ustaw PIN"}</h2>
        <p class="hint">Oszczędności będą zaszyfrowane tym PIN-em — także w kopii zapasowej. Bez PIN-u nikt ich nie odczyta, nawet aplikacja. Zapomnianego PIN-u nie da się odzyskać (reszta aplikacji działa normalnie).</p>
        <form id="svSetForm" class="sv-pinform" novalidate>
          <label class="sc-field"><span class="k">PIN (4–8 cyfr)</span><input name="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" ${dis}></label>
          <label class="sc-field"><span class="k">Powtórz PIN</span><input name="pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" ${dis}></label>
          <p class="sc-err" id="svErr" role="alert">${esc(ui.msg)}</p>
          <div class="actions"><button type="submit" class="btn primary" ${dis || (ui.busy ? "disabled" : "")}>${ui.busy ? "Szyfruję…" : "Ustaw PIN"}</button>${ui.archive ? `<button type="button" class="btn" data-svact="cancelNew">Anuluj</button>` : ""}</div>
        </form>
        <p class="note">Dłuższy PIN (6–8 cyfr) jest bezpieczniejszy. PIN chroni przed kimś, kto weźmie twój telefon albo zobaczy plik kopii.</p></section>`;
    }
    return `<section class="panel sv-lock"><h2>Oszczędzanie jest zablokowane</h2>
      <form id="svUnlockForm" class="sv-pinform" novalidate>
        <label class="sc-field"><span class="k">${ui.restore ? "Stary PIN (do poprzednich danych)" : "PIN"}</span><input name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" ${wait ? "disabled" : ""}></label>
        <p class="sc-err" id="svErr" role="alert">${esc(wait ? `Za dużo prób. Spróbuj za ${wait} s.` : ui.msg)}</p>
        <div class="actions"><button type="submit" class="btn primary" ${wait || ui.busy ? "disabled" : ""}>${ui.busy ? "Sprawdzam…" : ui.restore ? "Przywróć" : "Odblokuj"}</button>
          ${ui.restore ? `<button type="button" class="btn" data-svact="cancelRestore">Anuluj</button>` : `<button type="button" class="btn link" data-svact="forgot">Nie pamiętam PIN-u</button>`}</div>
      </form>
      ${ui.forgot ? `<div class="sv-forgot"><p>PIN-u nie da się odzyskać — tak działa szyfrowanie. Możesz zacząć od nowa z nowym PIN-em. <b>Nic nie zostanie usunięte:</b> obecne zaszyfrowane dane zostaną odłożone obok i przywrócisz je, jeśli przypomnisz sobie stary PIN.</p>
        <div class="actions"><button type="button" class="btn" data-svact="startOver" ${dis}>Zacznij od nowa z nowym PIN-em</button><button type="button" class="btn link" data-svact="forgotNo">Jednak pamiętam</button></div></div>` : ""}
      ${R.old.length && !ui.restore ? `<p class="meta">Masz odłożone poprzednie dane (${R.old.length}). <button type="button" class="btn link" data-svact="restore" ${dis}>Przywróć je starym PIN-em</button></p>` : ""}
    </section>`;
  }
  function openView() {
    const T = today(), dis = canWrite() ? "" : "disabled", total = balance(D), pm = perMonth(D, T, 3);
    const monthStart = T.slice(0, 8) + "01", thisMonth = r2(D.moves.filter(m => m.date >= monthStart && m.date <= T).reduce((s, m) => s + m.amount, 0));
    const assigned = D.goals.reduce((s, x) => s + balance(D, x.id), 0);
    const goals = D.goals.map(x => {
      const saved = balance(D, x.id), pct = Math.max(0, Math.min(100, Math.round(saved / x.target * 100))), gpm = perMonth(D, T, 3, x.id);
      const fc = forecast(x.target, saved, gpm, T), need = neededPerMonth(x.target, saved, x.deadline, T);
      return `<li class="sv-goal"><button type="button" class="lf-row" data-svact="editGoal" data-id="${esc(x.id)}" ${dis}><span><b>${esc(x.name)}</b><small>${zl(saved)} z ${zl(x.target)}${x.deadline ? ` · do ${esc(fmtLong.format(parseDay(x.deadline)))}` : ""}</small></span><span class="sv-pct">${pct}%</span></button>
        <div class="lf-bar"><span style="width:${pct}%"></span></div>
        <p class="meta">${fc && fc.done ? `<b class="good">Cel osiągnięty!</b>` : fc ? `Przy obecnym tempie (${zl(gpm)}/mies.): ${esc(fmtMonth.format(parseDay(fc.date)))}` : "Wpłacaj na ten cel, żeby policzyć, kiedy go osiągniesz."}${need ? need.late ? ` · termin minął, brakuje ${zl(need.rest)}` : ` · żeby zdążyć: ${zl(need.amount)}/mies.` : ""}</p></li>`;
    }).join("");
    const moves = D.moves.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 40).map(m => {
      const gl = D.goals.find(x => x.id === m.goal);
      return `<li><button type="button" class="lf-row" data-svact="editMove" data-id="${esc(m.id)}" ${dis}><span class="lf-d">${esc(fmtShort.format(parseDay(m.date)))}</span><span>${esc(m.note || (m.amount > 0 ? "Wpłata" : "Wypłata"))}${gl ? `<small>${esc(gl.name)}</small>` : ""}</span><span class="sv-amt ${m.amount > 0 ? "in" : "out"}">${m.amount > 0 ? "+" : "−"}${zl(Math.abs(m.amount))}</span></button></li>`;
    }).join("");
    return `<section class="panel">
        <div class="tiles lf-tiles3"><div class="tile"><span class="k">Oszczędności</span><span class="v sv-money">${zl(total)}</span></div>
          <div class="tile"><span class="k">Ten miesiąc</span><span class="v sv-money ${thisMonth >= 0 ? "" : "bad"}">${thisMonth >= 0 ? "+" : "−"}${zl(Math.abs(thisMonth))}</span></div>
          <div class="tile"><span class="k">Średnio / mies.</span><span class="v sv-money">${zl(pm)}</span><span class="d meta">ostatnie 3 miesiące</span></div></div>
        <div class="actions"><button type="button" class="btn primary" data-svact="in" ${dis}>+ Wpłata</button><button type="button" class="btn" data-svact="out" ${dis}>− Wypłata</button><button type="button" class="btn" data-svact="addGoal" ${dis}>+ Cel</button>
          <span class="sv-sp"></span><button type="button" class="btn" data-svact="lock">Zablokuj</button></div>
      </section>
      <section class="panel"><h2>Cele</h2>${goals ? `<ul class="lf-list sv-goals">${goals}</ul>${total - assigned > 0.004 ? `<p class="meta">Poza celami: ${zl(r2(total - assigned))}</p>` : ""}` : `<p class="meta">Dodaj cel, np. wyjazd albo nowy sprzęt — zobaczysz, ile brakuje i kiedy go osiągniesz.</p>`}</section>
      ${D.moves.length > 1 ? `<section class="panel"><h2>Saldo w czasie</h2><div class="chart"><canvas id="svChart" aria-label="Wykres oszczędności w czasie"></canvas></div></section>` : ""}
      <section class="panel"><h2>Wpłaty i wypłaty</h2>${moves ? `<ul class="lf-list">${moves}</ul>` : `<p class="meta">Nic jeszcze nie ma. Zacznij od „+ Wpłata”.</p>`}</section>
      <section class="panel"><div class="actions"><button type="button" class="btn" data-svact="changePin" ${dis}>Zmień PIN</button></div>
        <p class="note">Dane są zaszyfrowane twoim PIN-em, także w kopii zapasowej. Zakładka blokuje się sama, gdy z niej wyjdziesz.</p></section>`;
  }
  function render() {
    const root = $("svRoot"); if (!root) return;
    if (chart) { try { chart.destroy(); } catch (e) {} chart = null; }
    root.innerHTML = isOpen() ? openView() : lockView();
    if (isOpen()) drawChart();
  }
  function drawChart() {
    const c = $("svChart"); if (!c || !g.Chart) return;
    const css = n => getComputedStyle(doc.documentElement).getPropertyValue(n).trim();
    const s = series(D);
    try {
      chart = new g.Chart(c, { type: "line", data: { labels: s.map(p => fmtShort.format(parseDay(p.date))), datasets: [{ data: s.map(p => p.balance), borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: 2, tension: 0, stepped: true }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => zl(x.parsed.y) } } },
          scales: { y: { beginAtZero: true, ticks: { color: css("--muted"), callback: v => zl(v) }, grid: { color: css("--line") } }, x: { ticks: { color: css("--muted"), maxTicksLimit: 6 }, grid: { display: false } } } } });
    } catch (e) {}
  }

  /* ---------- sheets: a move, a goal, a new PIN ---------- */
  function renderSheet() {
    const el = $("svSheet"); if (!el) return;
    const sh = ui.sheet;
    if (!sh || !isOpen()) { el.hidden = true; el.innerHTML = ""; if (!doc.querySelector(".sc-sheet:not([hidden])")) doc.body.classList.remove("sc-sheet-open"); return; }
    el.hidden = false; doc.body.classList.add("sc-sheet-open");
    const d = sh.data;
    let inner, del = "";
    if (sh.mode === "move") {
      inner = `<h2 id="svTitle">${d.id ? "Edytuj" : d.sign > 0 ? "Wpłata" : "Wypłata"}</h2>
        <div class="seg small" role="group" aria-label="Rodzaj"><button type="button" class="seg-b" data-svform="sign" data-v="1" aria-pressed="${d.sign > 0}">Wpłata</button><button type="button" class="seg-b" data-svform="sign" data-v="-1" aria-pressed="${d.sign < 0}">Wypłata</button></div>
        <label class="sc-field"><span class="k">Kwota (zł)</span><input name="amount" type="text" inputmode="decimal" placeholder="np. 50" value="${esc(d.amount)}"></label>
        ${D.goals.length ? `<div class="sc-field"><span class="k">Cel</span><div class="sc-cats"><button type="button" class="chip" data-svform="goal" data-v="" aria-pressed="${!d.goal}">bez celu</button>${D.goals.map(x => `<button type="button" class="chip" data-svform="goal" data-v="${esc(x.id)}" aria-pressed="${d.goal === x.id}">${esc(x.name)}</button>`).join("")}</div></div>` : ""}
        <label class="sc-field"><span class="k">Data</span><input name="date" type="date" value="${esc(d.date)}" max="${esc(today())}"></label>
        <label class="sc-field"><span class="k">Opis</span><input name="note" type="text" maxlength="80" placeholder="np. kieszonkowe, prezent, słuchawki" value="${esc(d.note)}"></label>`;
      if (d.id) del = `<button type="button" class="btn danger" data-svform="delMove">Usuń</button>`;
    } else if (sh.mode === "goal") {
      inner = `<h2 id="svTitle">${d.id ? "Edytuj cel" : "Nowy cel"}</h2>
        <label class="sc-field"><span class="k">Na co</span><input name="name" type="text" maxlength="60" placeholder="np. Wyjazd, laptop" value="${esc(d.name)}"></label>
        <label class="sc-field"><span class="k">Ile potrzebujesz (zł)</span><input name="target" type="text" inputmode="decimal" value="${esc(d.target)}"></label>
        <label class="sc-field"><span class="k">Do kiedy (opcjonalnie)</span><input name="deadline" type="date" value="${esc(d.deadline || "")}"></label>
        ${d.id ? `<p class="meta">Usunięcie celu nie usuwa wpłat — staną się „bez celu”.</p>` : ""}`;
      if (d.id) del = `<button type="button" class="btn danger" data-svform="delGoal">Usuń cel</button>`;
    } else {
      inner = `<h2 id="svTitle">Zmień PIN</h2>
        <label class="sc-field"><span class="k">Nowy PIN (4–8 cyfr)</span><input name="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>
        <label class="sc-field"><span class="k">Powtórz nowy PIN</span><input name="pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>`;
    }
    el.innerHTML = `<div class="sc-backdrop" data-svform="close"></div><form class="panel sc-form" id="svForm" role="dialog" aria-modal="true" aria-labelledby="svTitle" novalidate>
      ${inner}<p class="sc-err" id="svFormErr" role="alert"></p>
      <div class="actions"><button type="submit" class="btn primary">Zapisz</button><button type="button" class="btn" data-svform="close">Anuluj</button>${del}</div></form>`;
  }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function readForm() { const f = $("svForm"), d = ui.sheet.data; for (const n of ["amount", "date", "note", "name", "target", "deadline", "pin", "pin2"]) { const el = f && f.querySelector(`[name="${n}"]`); if (el) d[n] = el.value; } return d; }
  const parseAmount = v => { const s = String(v == null ? "" : v).trim().replace(/\s/g, "").replace(",", "."); const n = Number(s); return s !== "" && isFinite(n) && n > 0 && n < 1e8 ? r2(n) : null; };
  async function submitSheet() {
    const sh = ui.sheet, d = readForm(), err = m => { const e = $("svFormErr"); if (e) e.textContent = m; return false; };
    const prev = JSON.parse(JSON.stringify(D)), next = JSON.parse(JSON.stringify(D));
    if (sh.mode === "move") {
      const a = parseAmount(d.amount);
      if (a == null) return err("Wpisz kwotę większą od zera, np. 50 albo 12,50.");
      if (!DAY.test(d.date || "") || d.date > today()) return err("Wybierz datę (nie później niż dziś).");
      const rec = { id: d.id || newId("m"), date: d.date, amount: d.sign * a, goal: d.goal || null, note: (d.note || "").trim() };
      const old = d.id && next.moves.find(x => x.id === d.id);
      if (old) Object.assign(old, rec); else next.moves.push(rec);
      const gl = D.goals.find(x => x.id === rec.goal);
      closeSheet();
      return save(next, `${old ? "Zapisano" : d.sign > 0 ? "Dodano wpłatę" : "Dodano wypłatę"}: ${zl(a)}${gl ? ` (${gl.name})` : ""}.`, prev);
    }
    if (sh.mode === "goal") {
      const name = (d.name || "").trim(), t = parseAmount(d.target);
      if (!name) return err("Wpisz, na co oszczędzasz.");
      if (t == null) return err("Wpisz, ile potrzebujesz (więcej niż 0 zł).");
      const old = d.id && next.goals.find(x => x.id === d.id);
      if (old) Object.assign(old, { name, target: t, deadline: d.deadline || null }); else next.goals.push({ id: newId("c"), name, target: t, deadline: d.deadline || null });
      closeSheet();
      return save(next, `${old ? "Zapisano" : "Dodano"} cel: ${name} (${zl(t)}).`, prev);
    }
    // a new PIN: a new salt and key; the data is the same
    if (!PIN_RE.test(d.pin || "")) return err("PIN to od 4 do 8 cyfr.");
    if (d.pin !== d.pin2) return err("PIN-y się różnią.");
    try {
      const nb = await createBox(d.pin, D, iterNew);
      const rec = { v: 1, box: nb.box, old: R.old };
      const res = { ok: true, saved: P.save(rec) };
      R = rec; K = { key: nb.key, salt: nb.salt, iter: nb.iter };
      closeSheet();
      if (P.whenSaved) P.whenSaved(res, () => say().info("Zmieniono PIN. Zapamiętaj nowy — starego już nie trzeba."));
    } catch (e) { err("Nie udało się zmienić PIN-u: " + (e && e.message || e)); }
    return true;
  }
  function onSheetClick(e) {
    const b = e.target.closest("[data-svform]"); if (!b || !ui.sheet) return;
    const a = b.dataset.svform, d = readForm();
    if (a === "close") closeSheet();
    else if (a === "sign") { d.sign = +b.dataset.v; renderSheet(); }
    else if (a === "goal") { d.goal = b.dataset.v || null; renderSheet(); }
    else if (a === "delMove") { const prev = JSON.parse(JSON.stringify(D)), next = JSON.parse(JSON.stringify(D)), m = D.moves.find(x => x.id === d.id); next.moves = next.moves.filter(x => x.id !== d.id); closeSheet(); save(next, `Usunięto: ${m ? zl(Math.abs(m.amount)) : ""}.`, prev); }
    else if (a === "delGoal") { const prev = JSON.parse(JSON.stringify(D)), next = JSON.parse(JSON.stringify(D)), x = D.goals.find(y => y.id === d.id); next.goals = next.goals.filter(y => y.id !== d.id); next.moves.forEach(m => { if (m.goal === d.id) m.goal = null; }); closeSheet(); save(next, `Usunięto cel: ${x ? x.name : ""}.`, prev); }
  }

  /* ---------- PIN: set, unlock, start over, restore ---------- */
  async function setPin(pin, pin2) {
    if (!canWrite()) return false;
    if (!PIN_RE.test(pin || "")) { ui.msg = "PIN to od 4 do 8 cyfr."; render(); return false; }
    if (pin !== pin2) { ui.msg = "PIN-y się różnią."; render(); return false; }
    ui.busy = true; ui.msg = ""; render();
    try {
      const nb = await createBox(pin, emptyData(), iterNew);
      const rec = { v: 1, box: nb.box, old: ui.archive && R.box ? R.old.concat([R.box]) : R.old };
      const res = { ok: true, saved: P.save(rec) };
      R = rec; D = emptyData(); K = { key: nb.key, salt: nb.salt, iter: nb.iter };
      const wasArchive = ui.archive;
      ui.busy = false; ui.archive = false; ui.mode = null; render();
      if (P.whenSaved) P.whenSaved(res, () => say().info(wasArchive ? "Nowy PIN ustawiony. Poprzednie dane są odłożone — przywrócisz je starym PIN-em." : "PIN ustawiony. Oszczędności są zaszyfrowane."));
      return true;
    } catch (e) { ui.busy = false; ui.msg = "Nie udało się: " + (e && e.message || e); render(); return false; }
  }
  async function unlock(pin) {
    if (Date.now() < ui.until) return false;
    if (!PIN_RE.test(pin || "")) { ui.msg = "PIN to od 4 do 8 cyfr."; render(); return false; }
    ui.busy = true; ui.msg = ""; render();
    if (ui.restore) {
      for (let i = 0; i < R.old.length; i++) {
        try {
          const u = await unlockBox(R.old[i], pin);
          const old = R.old.filter((_, j) => j !== i).concat(R.box ? [R.box] : []);
          const rec = { v: 1, box: R.old[i], old };
          const res = { ok: true, saved: P.save(rec) };
          R = rec; D = u.data; K = { key: u.key, salt: u.salt, iter: u.iter };
          ui.busy = false; ui.restore = false; ui.wrong = 0; render();
          if (P.whenSaved) P.whenSaved(res, () => say().info("Przywrócono poprzednie dane. Teraz obowiązuje stary PIN, a dane z nowym PIN-em są odłożone obok."));
          return true;
        } catch (e) { /* not this one */ }
      }
    } else {
      try {
        const u = await unlockBox(R.box, pin);
        D = u.data; K = { key: u.key, salt: u.salt, iter: u.iter };
        ui.busy = false; ui.wrong = 0; ui.forgot = false; render();
        return true;
      } catch (e) { /* wrong PIN */ }
    }
    ui.busy = false; ui.wrong++;
    if (ui.wrong >= 5) { ui.until = Date.now() + 30000; ui.wrong = 0; setTimeout(render, 30500); }
    ui.msg = "Zły PIN."; render();
    return false;
  }
  function onClick(e) {
    const b = e.target.closest("[data-svact]"); if (!b || b.disabled) return;
    const a = b.dataset.svact;
    if (a === "lock") lock();
    else if (a === "forgot") { ui.forgot = true; render(); }
    else if (a === "forgotNo") { ui.forgot = false; render(); }
    else if (a === "startOver") { ui.forgot = false; ui.archive = true; ui.mode = "setup"; ui.msg = ""; render(); }
    else if (a === "cancelNew") { ui.archive = false; ui.mode = R.box ? "locked" : "setup"; ui.msg = ""; render(); }
    else if (a === "restore") { ui.restore = true; ui.msg = ""; render(); }
    else if (a === "cancelRestore") { ui.restore = false; ui.msg = ""; render(); }
    else if (!isOpen() || !canWrite()) return;
    else if (a === "in" || a === "out") { ui.sheet = { mode: "move", data: { id: null, sign: a === "in" ? 1 : -1, amount: "", goal: D.goals.length === 1 ? D.goals[0].id : null, date: today(), note: "" } }; renderSheet(); }
    else if (a === "editMove") { const m = D.moves.find(x => x.id === b.dataset.id); if (m) { ui.sheet = { mode: "move", data: { id: m.id, sign: m.amount > 0 ? 1 : -1, amount: String(Math.abs(m.amount)).replace(".", ","), goal: m.goal, date: m.date, note: m.note } }; renderSheet(); } }
    else if (a === "addGoal") { ui.sheet = { mode: "goal", data: { id: null, name: "", target: "", deadline: "" } }; renderSheet(); }
    else if (a === "editGoal") { const x = D.goals.find(y => y.id === b.dataset.id); if (x) { ui.sheet = { mode: "goal", data: { id: x.id, name: x.name, target: String(x.target).replace(".", ","), deadline: x.deadline || "" } }; renderSheet(); } }
    else if (a === "changePin") { ui.sheet = { mode: "pin", data: {} }; renderSheet(); }
  }
  function onSubmit(e) {
    const f = e.target;
    if (f.id === "svSetForm") { e.preventDefault(); setPin(f.querySelector('[name="pin"]').value, f.querySelector('[name="pin2"]').value); }
    else if (f.id === "svUnlockForm") { e.preventDefault(); unlock(f.querySelector('[name="pin"]').value); }
  }
  function mount() {
    const root = $("svRoot"); if (root) { root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); }
    const sh = $("svSheet"); if (sh) { sh.addEventListener("click", onSheetClick); sh.addEventListener("submit", e => { e.preventDefault(); submitSheet(); }); }
    doc.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });
    // locked again when the app goes to the background
    doc.addEventListener("visibilitychange", () => { if (doc.hidden && isOpen()) lock(); });
  }
  const summary = () => (R.box ? "Zaszyfrowane, chronione PIN-em" : "Ustaw PIN i zacznij oszczędzać");
  function setClock(fn) { now = fn || (() => new Date()); }
  function setIterations(n) { iterNew = n || ITER; }            // tests only: fewer rounds to run quickly
  // wait for pending encryptions (tests, and before making a backup)
  const settled = () => queue;

  const api = Object.assign({}, core, { attach, render, mount, exportState, lock, unlock, setPin, isOpen, summary, setClock, setIterations, settled, ui, canWrite });
  Object.defineProperty(api, "data", { get: () => (D ? JSON.parse(JSON.stringify(D)) : null), enumerable: true });
  g.RytmSavings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
