// Rytm: sleep (Sen). In the morning two times: when I went to bed and when I got up. A goal: the hour to go to bed and
// how many hours to sleep. In the evening Dziś shows how long is left until that hour and what is on tomorrow
// (tests, homework). The view: last night, the week's average, 14 nights on a chart, nights after an evening training
// against the others, school nights against the weekend, and a suggested hour to go to bed.
// Saved state (one record in meta "sleep"): {v:1, bed: "22:30" | null, hours: 8, nights:[{date, bed, wake}]}
//   date = the day of waking up; bed may be the evening before (23:40) or after midnight (00:30)
(function (g) {
  "use strict";

  /* ================= core (no DOM) ================= */
  const DAY = /^\d{4}-\d{2}-\d{2}$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const HOURS = [8, 8.5, 9, 9.5];
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const isoDow = k => { const w = parseDay(k).getDay(); return w === 0 ? 7 : w; };
  const mins = hm => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
  const hmOf = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  // minutes asleep (from going to bed to getting up); 2–16 h is believable
  const duration = n => (mins(n.wake) - mins(n.bed) + 1440) % 1440;
  const okNight = n => { const d = duration(n); return d >= 120 && d <= 960; };
  // the evening the night began: the day before waking up (also when going to bed after midnight)
  const bedDay = n => addDays(n.date, -1);
  const fmtDur = m => (m == null ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

  function defaults() { return { v: 1, bed: null, hours: 8, nights: [] }; }
  function normalize(raw) {
    const o = raw && typeof raw === "object" ? raw : null;
    if (!o) return defaults();
    const seen = new Set();
    const nights = (Array.isArray(o.nights) ? o.nights : []).filter(n => n && DAY.test(n.date || "") && HM.test(n.bed || "") && HM.test(n.wake || "") && okNight(n) && !seen.has(n.date) && seen.add(n.date))
      .map(n => ({ date: n.date, bed: n.bed, wake: n.wake })).sort((a, b) => (a.date < b.date ? -1 : 1));
    return { v: 1, bed: HM.test(o.bed || "") ? o.bed : null, hours: HOURS.includes(o.hours) ? o.hours : 8, nights };
  }
  const avg = list => (list.length ? Math.round(list.reduce((a, n) => a + duration(n), 0) / list.length) : null);
  // nights that ended in the n days up to `today`
  const lastNights = (state, today, n) => state.nights.filter(x => x.date > addDays(today, -n) && x.date <= today);
  // minutes until the bedtime goal at hh:mm now (negative = already late); null without a goal
  function untilBed(state, nowHM) {
    if (!state.bed) return null;
    let d = mins(state.bed) - mins(nowHM);
    if (d < -720) d += 1440; if (d > 720) d -= 1440;
    return d;
  }
  // nights after an evening training against the others; school nights against the weekend (the last `days` days)
  function compare(state, today, evening, days = 60) {
    const list = lastNights(state, today, days), ev = k => { try { return !!(evening && evening(k)); } catch (e) { return false; } };
    const part = l => ({ avg: avg(l), n: l.length });
    const school = list.filter(n => isoDow(n.date) <= 5);
    return { train: part(list.filter(n => ev(bedDay(n)))), rest: part(list.filter(n => !ev(bedDay(n)))), school: part(school), weekend: part(list.filter(n => isoDow(n.date) > 5)) };
  }
  // the usual time of getting up on school days (the middle one of the last 14) and the hour to go to bed for the goal
  function suggest(state, today) {
    const w = lastNights(state, today, 21).filter(n => isoDow(n.date) <= 5).map(n => mins(n.wake)).sort((a, b) => a - b);
    if (w.length < 3) return null;
    const wake = w[Math.floor(w.length / 2)];
    return { wake: hmOf(wake), bed: hmOf(Math.floor((wake - state.hours * 60) / 5) * 5) };
  }

  const core = { HOURS, defaults, normalize, duration, bedDay, okNight, avg, lastNights, untilBed, compare, suggest, fmtDur, mins, hmOf, dayKey, parseDay, addDays };

  /* ================= view ================= */
  const doc = g.document;
  if (!doc) { g.RytmSleep = core; if (typeof module !== "undefined" && module.exports) module.exports = core; return; }
  const $ = id => doc.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDay = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
  const DOW1 = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
  const num = x => String(x).replace(".", ",");
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  const nights = n => `${n} ${plural(n, "noc", "noce", "nocy")}`;
  const say = () => (g.Rytm && g.Rytm.notify) || { info() {}, error() {} };

  let S = defaults(), P = null, now = () => new Date();
  const ui = {};
  const today = () => dayKey(now());
  const hm = () => { const d = now(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const canWrite = () => !!(P && P.writable && P.writable());
  const changed = () => { if (P && P.onChange) try { P.onChange(); } catch (e) {} };
  const src = () => { try { return (P && P.sources && P.sources()) || {}; } catch (e) { return {}; } };

  function attach(persist) { P = persist || null; S = normalize(P && P.load ? P.load() : null); render(); }
  function exportState() { return JSON.parse(JSON.stringify(S)); }
  function save(next, okText, undoTo) {
    if (!P || !P.save) return false;
    const prev = S;
    S = normalize(next);
    let res;
    try { res = { ok: true, saved: P.save(exportState()) }; }
    catch (e) { S = normalize(P.load ? P.load() : prev); render(); changed(); return false; }
    render(); changed();
    if (okText && P.whenSaved) P.whenSaved(res, () => say().info(okText, undoTo ? { action: { label: "Cofnij", fn: () => save(undoTo, "Cofnięto.") } } : undefined));
    return true;
  }
  const last = () => S.nights[S.nights.length - 1] || null;
  const tone = m => (m == null ? "" : m >= S.hours * 60 ? "good" : m >= S.hours * 60 - 60 ? "mid" : "low");

  function logForm(where, date, dis) {
    const l = last();
    return `<form class="sl-log" data-sllog="${where}" novalidate>
        ${where === "full" ? `<label class="sc-field"><span class="k">Noc kończąca się</span><input type="date" name="date" value="${esc(date)}" max="${esc(today())}" ${dis}></label>` : `<input type="hidden" name="date" value="${esc(date)}">`}
        <div class="sl-times"><label class="sc-field"><span class="k">Poszedłem spać</span><input type="time" name="bed" value="${esc((l && l.bed) || S.bed || "23:00")}" ${dis}></label>
          <label class="sc-field"><span class="k">Wstałem</span><input type="time" name="wake" value="${esc((l && l.wake) || "06:30")}" ${dis}></label>
          <button type="submit" class="btn primary" ${dis}>Zapisz</button></div>
        <p class="sc-err" data-slerr="${where}" role="alert"></p></form>`;
  }
  function chart(T) {
    const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(T, -i));
    const W = 320, H = 130, top = 8, bottom = 22, maxH = 12 * 60, bw = W / 14, y = m => top + (H - top - bottom) * (1 - Math.min(m, maxH) / maxH);
    const bars = days.map((k, i) => {
      const n = S.nights.find(x => x.date === k), m = n ? duration(n) : null, x = i * bw + 3;
      return `${n ? `<rect class="sl-bar ${tone(m)}" x="${x.toFixed(1)}" y="${y(m).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${(H - bottom - y(m)).toFixed(1)}" rx="3"><title>${esc(fmtDay.format(parseDay(k)))}: ${esc(fmtDur(m))}</title></rect>` : `<rect class="sl-none" x="${x.toFixed(1)}" y="${(H - bottom - 3).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="3" rx="1.5"></rect>`}
        <text class="sl-lab${k === T ? " today" : ""}" x="${(x + (bw - 6) / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${DOW1[isoDow(k) - 1]}</text>`;
    }).join("");
    const ty = y(S.hours * 60);
    return `<svg class="sl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sen w ostatnich 14 nocach">${bars}
      <line class="sl-goal" x1="0" x2="${W}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}"></line><text class="sl-goalt" x="${W - 2}" y="${(ty - 3).toFixed(1)}" text-anchor="end">cel ${num(S.hours)} h</text></svg>`;
  }
  function fullView() {
    const T = today(), dis = canWrite() ? "" : "disabled", l = last(), wk = lastNights(S, T, 7), a7 = avg(wk), s = src();
    const cmp = compare(S, T, s.eveningTraining), sg = suggest(S, T);
    const pair = (a, b, la, lb) => (a.n >= 2 && b.n >= 2 ? `<div class="sl-cmp"><span><small>${la}</small><b class="${tone(a.avg)}">${fmtDur(a.avg)}</b><small>${nights(a.n)}</small></span><span><small>${lb}</small><b class="${tone(b.avg)}">${fmtDur(b.avg)}</b><small>${nights(b.n)}</small></span></div>` : "");
    const cmpHtml = pair(cmp.train, cmp.rest, "Po wieczornym treningu", "Bez wieczornego treningu") + pair(cmp.school, cmp.weekend, "Przed szkołą", "W weekend");
    return `<section class="panel sl-hero">
        <div class="tiles lf-tiles3">
          <div class="tile"><span class="k">Ostatnia noc</span><span class="v sl-v ${tone(l ? duration(l) : null)}">${l ? esc(fmtDur(duration(l))) : "–"}</span><span class="d meta">${l ? `${esc(l.bed)}–${esc(l.wake)}` : "brak wpisu"}</span></div>
          <div class="tile"><span class="k">Średnio, 7 dni</span><span class="v sl-v ${tone(a7)}">${esc(fmtDur(a7))}</span><span class="d meta">${nights(wk.length)}</span></div>
          <div class="tile"><span class="k">Cel</span><span class="v sl-v">${num(S.hours)} h</span><span class="d meta">${S.bed ? `spać o ${esc(S.bed)}` : "godzina: nie ustawiona"}</span></div></div>
        ${a7 != null && a7 < S.hours * 60 ? `<p class="meta">W tym tygodniu brakuje ci średnio <b>${esc(fmtDur(S.hours * 60 - a7))}</b> snu na noc.</p>` : ""}
      </section>
      <section class="panel"><h2>Zapisz noc</h2>${logForm("full", T, dis)}</section>
      <section class="panel"><h2>Ostatnie 14 nocy</h2>${S.nights.length ? chart(T) : `<p class="meta">Zapisuj rano, o której poszedłeś spać i wstałeś — tu zobaczysz wykres.</p>`}</section>
      <section class="panel"><h2>Porównanie</h2>${cmpHtml || `<p class="meta">Po kilku zapisanych nocach zobaczysz tu, ile śpisz po wieczornym treningu, a ile bez niego, i ile przed szkołą, a ile w weekend.</p>`}
        <p class="note">Wieczorny trening = rozpoczęty po 16:00 (z twoich treningów z zegarka).</p></section>
      <section class="panel"><h2>Cel</h2>
        <div class="sc-field"><span class="k">Ile chcesz spać</span><div class="lf-chips" role="group" aria-label="Ile godzin snu">${HOURS.map(h => `<button type="button" class="chip" data-slact="hours" data-v="${h}" aria-pressed="${S.hours === h}" ${dis}>${num(h)} h</button>`).join("")}</div></div>
        <label class="sc-field"><span class="k">O której chcesz iść spać</span><input type="time" data-slbed="1" value="${esc(S.bed || "")}" ${dis}></label>
        ${sg ? `<p class="hint">W dni szkolne wstajesz zwykle o <b>${esc(sg.wake)}</b>. Żeby spać ${num(S.hours)} h, kładź się o <b>${esc(sg.bed)}</b>.${S.bed !== sg.bed ? ` <button type="button" class="btn link" data-slact="useSuggest" data-v="${esc(sg.bed)}" ${dis}>Ustaw ${esc(sg.bed)}</button>` : ""}</p>` : ""}
        <p class="note">Nastolatkom zaleca się 8–10 godzin snu. Godzina snu pokaże się wieczorem na ekranie Dziś (aplikacja nie wysyła powiadomień).</p></section>
      ${S.nights.length ? `<section class="panel"><h2>Zapisane noce</h2><ul class="lf-list">${S.nights.slice(-14).reverse().map(n => `<li class="lf-row static sl-row"><span class="lf-d">${esc(fmtDay.format(parseDay(n.date)))}</span><span>${esc(n.bed)}–${esc(n.wake)}</span><b class="${tone(duration(n))}">${esc(fmtDur(duration(n)))}</b><button type="button" class="icon-btn" data-slact="del" data-v="${esc(n.date)}" aria-label="Usuń noc ${esc(fmtDay.format(parseDay(n.date)))}" ${dis}>×</button></li>`).join("")}</ul></section>` : ""}`;
  }
  // on Dziś: in the morning "how did you sleep" (until it is written down), in the evening the time left until bed and tomorrow
  // ctx: {tomorrowTests: [text], tomorrowHomework: number}
  function widget(T, ctx) {
    T = T || today(); ctx = ctx || {};
    const t = hm(), h = +t.slice(0, 2), dis = canWrite() ? "" : "disabled", n = S.nights.find(x => x.date === T);
    if (h >= 4 && h < 13) {
      if (n) return `<section class="panel sl-today"><p class="sl-line"><span class="sl-moon" aria-hidden="true">☾</span> Ta noc: <b class="${tone(duration(n))}">${esc(fmtDur(duration(n)))}</b> <span class="meta">(${esc(n.bed)}–${esc(n.wake)}, cel ${num(S.hours)} h)</span> <button type="button" class="btn link" data-slact="go">Sen ›</button></p></section>`;
      return `<section class="panel sl-today"><div class="row"><h2>Jak spałeś?</h2><button type="button" class="btn link" data-slact="go">Sen ›</button></div>${logForm("today", T, dis)}</section>`;
    }
    if (h >= 18 || h < 4) {
      const left = untilBed(S, t), tests = ctx.tomorrowTests || [], hw = ctx.tomorrowHomework || 0;
      const what = [tests.length ? `${plural(tests.length, "test", "testy", "testów")}: ${tests.map(esc).join(", ")}` : "", hw ? `${hw} ${plural(hw, "zadanie domowe", "zadania domowe", "zadań domowych")}` : ""].filter(Boolean);
      const head = left == null ? `<p class="sl-line"><span class="sl-moon" aria-hidden="true">☾</span> Ustaw godzinę, o której chcesz chodzić spać — będzie tu odliczanie. <button type="button" class="btn link" data-slact="go">Ustaw ›</button></p>`
        : left > 0 ? `<p class="sl-left"><span class="sl-moon" aria-hidden="true">☾</span> Do snu (${esc(S.bed)}) zostało <b>${esc(fmtDur(left))}</b></p>`
        : `<p class="sl-left late"><span class="sl-moon" aria-hidden="true">☾</span> ${left === 0 ? "Już" : `Już ${esc(fmtDur(-left))} po`} ${esc(S.bed)} — czas kończyć dzień</p>`;
      return `<section class="panel sl-today evening">${head}<p class="meta">${what.length ? `Jutro: ${what.join(" · ")}.` : "Na jutro nic nie jest zapisane."}</p></section>`;
    }
    return "";
  }
  function render() { const root = $("slRoot"); if (root) root.innerHTML = fullView(); }

  /* ---------- events ---------- */
  function saveNight(form) {
    const where = form.dataset.sllog, val = n => (form.querySelector(`[name="${n}"]`) || {}).value || "";
    const err = m => { const e = doc.querySelector(`[data-slerr="${where}"]`); if (e) e.textContent = m; return false; };
    const n = { date: val("date"), bed: val("bed"), wake: val("wake") };
    if (!DAY.test(n.date) || n.date > today()) return err("Wybierz dzień (nie późniejszy niż dziś).");
    if (!HM.test(n.bed) || !HM.test(n.wake)) return err("Wpisz obie godziny.");
    if (!okNight(n)) return err(`Wychodzi ${fmtDur(duration(n))} snu — sprawdź godziny.`);
    const prev = exportState(), next = exportState(), had = next.nights.some(x => x.date === n.date);
    next.nights = next.nights.filter(x => x.date !== n.date).concat([n]);
    const m = duration(n);
    return save(next, `${had ? "Poprawiono" : "Zapisano"} noc: ${fmtDur(m)}${m < S.hours * 60 ? ` (do celu brakuje ${fmtDur(S.hours * 60 - m)})` : " — cel osiągnięty"}.`, prev);
  }
  function onClick(e) {
    const b = e.target.closest("[data-slact]"); if (!b || b.disabled) return;
    const a = b.dataset.slact;
    if (a === "go") { if (P && P.go) P.go("sleep"); return; }
    if (!canWrite()) return;
    const prev = exportState(), next = exportState();
    if (a === "hours") { next.hours = +b.dataset.v; save(next); }
    else if (a === "useSuggest") { next.bed = b.dataset.v; save(next, `Godzina snu: ${b.dataset.v}.`, prev); }
    else if (a === "del") { next.nights = next.nights.filter(x => x.date !== b.dataset.v); save(next, `Usunięto noc ${fmtDay.format(parseDay(b.dataset.v))}.`, prev); }
  }
  function onChange(e) {
    const el = e.target; if (!el.dataset || !el.dataset.slbed || !canWrite()) return;
    const prev = exportState(), next = exportState(); next.bed = HM.test(el.value || "") ? el.value : null;
    save(next, next.bed ? `Godzina snu: ${next.bed}. Wieczorem zobaczysz na Dziś, ile zostało.` : "Bez godziny snu.", prev);
  }
  function onSubmit(e) { const f = e.target.closest && e.target.closest("form[data-sllog]"); if (!f) return; e.preventDefault(); if (canWrite()) saveNight(f); }
  function mount() {
    for (const id of ["slRoot", "plRoot"]) { const r = $(id); if (r) { r.addEventListener("click", onClick); r.addEventListener("change", onChange); r.addEventListener("submit", onSubmit); } }
  }
  function summary() { const T = today(), a = avg(lastNights(S, T, 7)), l = last(); return l ? `Średnio ${fmtDur(a)} w 7 dni · cel ${num(S.hours)} h` : "Zapisuj rano, ile spałeś"; }
  function setClock(fn) { now = fn || (() => new Date()); }

  const api = Object.assign({}, core, { attach, render, mount, exportState, setClock, summary, widget, ui, canWrite });
  Object.defineProperty(api, "state", { get: exportState, enumerable: true });
  g.RytmSleep = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
