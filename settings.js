// Rytm: Ustawienia (23.10.2026) — the language of the app (Polski / English) and the time zone of the app's "now".
// Opened with the gear in the top right corner of "Więcej".
// Saved state (one record in meta "prefs"): {v:1, lang:"pl"|"en", tz:""|IANA name}
//   tz "" = automatically, the phone's own zone (the default). Another zone changes only what the app thinks "now" is:
//   which day it is (Dziś, homework, attendance, sleep, birthdays) and the hour (the plan, the time left until bed).
//   The times of trainings from the watch and of saved entries stay as they were saved.
//   English: i18n.js translates the screen; the names typed in by the user stay as typed.
(function (g) {
  "use strict";
  const LANGS = ["pl", "en"];
  const FALLBACK_ZONES = ["Europe/Warsaw", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome",
    "Europe/Prague", "Europe/Vienna", "Europe/Stockholm", "Europe/Helsinki", "Europe/Athens", "Europe/Kyiv", "Europe/Istanbul", "Europe/Moscow",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Mexico_City", "America/Sao_Paulo",
    "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Pacific/Auckland", "Africa/Cairo", "Atlantic/Canary"];
  const REGIONS = { Europe: "Europa", America: "Ameryka", Asia: "Azja", Africa: "Afryka", Australia: "Australia", Pacific: "Pacyfik", Atlantic: "Atlantyk",
    Indian: "Ocean Indyjski", Antarctica: "Antarktyda", Arctic: "Arktyka" };
  const pad = n => String(n).padStart(2, "0");

  function defaults() { return { v: 1, lang: "pl", tz: "" }; }
  const fmts = new Map();
  function fmtOf(tz) {
    if (fmts.has(tz)) return fmts.get(tz);
    let f = null;
    try { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }); } catch (e) { f = null; }
    fmts.set(tz, f); return f;
  }
  const validZone = tz => typeof tz === "string" && tz.length > 0 && tz.length <= 64 && !!fmtOf(tz);
  function normalize(o) {
    o = o && typeof o === "object" && !Array.isArray(o) ? o : {};
    return { v: 1, lang: LANGS.includes(o.lang) ? o.lang : "pl", tz: validZone(o.tz) ? o.tz : "" };
  }
  // the wall clock in tz at the moment d: {year, month, day, hour, minute, second} or null
  function parts(tz, d) {
    const f = fmtOf(tz); if (!f) return null;
    const p = {}; for (const x of f.formatToParts(d)) if (x.type !== "literal") p[x.type] = +x.value;
    if (p.hour === 24) p.hour = 0;
    return p;
  }
  // "now" for the app: a Date whose own (local) fields show the wall clock in tz; tz "" = the phone's own time
  function zoneNow(tz, d) {
    d = d || new Date(); if (!tz) return d;
    const p = parts(tz, d); if (!p) return d;
    return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, d.getMilliseconds());
  }
  // minutes ahead of UTC in tz at the moment d
  function offsetMin(tz, d) {
    d = d || new Date();
    const p = tz ? parts(tz, d) : null; if (!p) return -d.getTimezoneOffset();
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  }
  const utcLabel = m => `UTC${m < 0 ? "−" : "+"}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? ":" + pad(Math.abs(m) % 60) : ""}`;
  function phoneZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } }
  let zoneCache = null;
  // all the zones the phone knows, by region: [{region, name, list:[{tz, city}]}]
  function zones() {
    if (zoneCache) return zoneCache;
    let list = [];
    try { if (typeof Intl.supportedValuesOf === "function") list = Intl.supportedValuesOf("timeZone"); } catch (e) { list = []; }
    if (!list.length) list = FALLBACK_ZONES;
    const groups = new Map();
    for (const tz of [...new Set(list)]) {
      const i = tz.indexOf("/"), region = i > 0 ? tz.slice(0, i) : "";
      const key = REGIONS[region] ? region : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ tz, city: (i > 0 ? tz.slice(i + 1) : tz).replace(/\//g, " / ").replace(/_/g, " ") });
    }
    if (!groups.has("")) groups.set("", []);
    if (!groups.get("").some(z => z.tz === "UTC")) groups.get("").push({ tz: "UTC", city: "UTC" });
    const order = Object.keys(REGIONS).concat([""]);
    zoneCache = order.filter(k => groups.has(k) && groups.get(k).length).map(k => ({ region: k, name: REGIONS[k] || "Inne", list: groups.get(k).sort((a, b) => (a.city < b.city ? -1 : 1)) }));
    return zoneCache;
  }

  const core = { LANGS, REGIONS, defaults, normalize, validZone, parts, zoneNow, offsetMin, utcLabel, phoneZone, zones };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmSettings = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtNow = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, base = () => new Date();
  const canWrite = () => !!(P && P.writable && P.writable());
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };
  const now = () => zoneNow(S.tz, base());
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const zoneName = tz => (tz === "UTC" ? "UTC" : tz.replace(/_/g, " "));

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); render(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  function save(next, okText) {
    if (!P || !P.save) return false;
    const prev = S;
    S = normalize(next);
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { S = normalize(P.load ? P.load() : prev); render(); changed(); return false; }
    render(); changed();
    if (okText && P.whenSaved) P.whenSaved(res, () => say().info(okText));
    return true;
  }

  function render() {
    const root = $("setRoot"); if (!root) return;
    const dis = canWrite() ? "" : "disabled", d = base(), phone = phoneZone(), n = now();
    const opt = z => `<option value="${esc(z.tz)}"${z.tz === S.tz ? " selected" : ""} translate="no">${esc(z.city)} (${utcLabel(offsetMin(z.tz, d))})</option>`;
    const other = S.tz && (offsetMin(S.tz, d) !== offsetMin("", d));
    root.innerHTML = `<section class="panel set-lang" aria-labelledby="setLangT"><h2 id="setLangT">Język</h2>
        <div class="seg" role="group" aria-labelledby="setLangT" translate="no">
          <button type="button" class="seg-b" data-setact="lang" data-v="pl" lang="pl" aria-pressed="${S.lang === "pl"}" ${dis}>Polski</button>
          <button type="button" class="seg-b" data-setact="lang" data-v="en" lang="en" aria-pressed="${S.lang === "en"}" ${dis}>English</button></div>
        <p class="meta">Nazwy, które wpisujesz sam (przedmioty, nawyki, cele, osoby), zostają tak, jak je wpisałeś.</p></section>
      <section class="panel set-tz" aria-labelledby="setTzT"><h2 id="setTzT">Strefa czasowa</h2>
        <label class="sc-field"><span class="k">Czas w aplikacji</span><select name="tz" data-setzone ${dis}>
          <option value=""${S.tz ? "" : " selected"}>Automatycznie — z telefonu${phone ? ` · ${esc(zoneName(phone))}` : ""}</option>
          ${zones().map(gr => `<optgroup label="${esc(gr.name)}">${gr.list.map(opt).join("")}</optgroup>`).join("")}</select></label>
        <div class="set-clock" aria-live="polite"><b>${esc(hm(n))}</b><span>${esc(fmtNow.format(n))} · <span translate="no">${esc(utcLabel(offsetMin(S.tz, d)))}${S.tz ? ` · ${esc(zoneName(S.tz))}` : ""}</span></span></div>
        ${other ? `<p class="meta">Na telefonie jest teraz ${esc(hm(d))}. Aplikacja liczy dzień i godzinę według wybranej strefy.</p>` : ""}
        <p class="meta">Strefa zmienia to, który jest dzień i godzina w aplikacji: Dziś, plan lekcji, zadania, sen, frekwencję i urodziny. Godziny treningów z zegarka i zapisane wpisy się nie zmieniają.</p></section>
      <p class="meta set-ver">Wersja aplikacji: <span translate="no">${esc((g.Rytm && g.Rytm.VERSION) || "—")}</span></p>`;
  }
  function onClick(e) {
    const b = e.target.closest("[data-setact]"); if (!b || b.disabled || !canWrite()) return;
    if (b.dataset.setact === "lang" && b.dataset.v !== S.lang) {
      const next = exportState(); next.lang = b.dataset.v;
      save(next, next.lang === "en" ? "Język: English." : "Język: polski.");
      if (P && P.onLang) try { P.onLang(S.lang); } catch (x) {}
    }
  }
  function onChange(e) {
    const el = e.target; if (!el.dataset || el.dataset.setzone === undefined || !canWrite()) return;
    const next = exportState(); next.tz = validZone(el.value) ? el.value : "";
    save(next, next.tz ? `Strefa czasowa: ${zoneName(next.tz)} (${utcLabel(offsetMin(next.tz, base()))}).` : "Strefa czasowa: automatycznie z telefonu.");
    if (P && P.onZone) try { P.onZone(S.tz); } catch (x) {}
  }
  function mount() { const r = $("setRoot"); if (r) { r.addEventListener("click", onClick); r.addEventListener("change", onChange); } }
  // the base clock (the real time; tests set a made-up one); the app's "now" is that moment in the chosen zone
  function setClock(fn) { base = fn || (() => new Date()); }
  function summary() { return `${S.lang === "en" ? "English" : "Polski"} · ${S.tz ? zoneName(S.tz) : "strefa z telefonu"}`; }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, now, canWrite });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  Object.defineProperty(api, "lang", { get: () => S.lang, enumerable: true });
  Object.defineProperty(api, "tz", { get: () => S.tz, enumerable: true });
  g.RytmSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
