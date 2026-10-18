// Rytm: backup file — build, check and summarise. Pure logic, no page code.
// File shape (format 1):
// { app:"rytm", kind:"backup", format:1, exportedAt, appVersion, summary, checksum, data:{
//     swimCsv: {text} | null,                         // the Garmin activities CSV as it was loaded
//     fit:     {acts:{id:packed}, bad:{id:[i]}, last:[id], hidden:{trainingId: deletedAtISO}},
//     habits:  {habits:[...], log:{day:{habitId:value}}, notes:{day:text}, skips:{day:reason}},
//     attendance: {days:[1..7], from:day|null, cancelled:{day:reason}, absent:{day:""}}   // optional, since 16.10.2026;
//     school: {v:1, subjects:[...], grades:[{id,sid,pct,w,cat,desc,date,...}], tests:[...], settings:{...}}   // optional, 16.10.2026;
//     manualRecords: {v:1, entries:[{id,pool,stroke,dist,time,date,kind,note,fix,fixTime}]}   // optional, 17.10.2026;
//     plan: {v:1, bells, lessons, events, cats}, goals: {v:1, seeded, goals}, portfolio: {v:1, activities, awards},
//     study: {v:1, maturaDate, subjects, tests, current}, savings: {v:1, box, old}  (savings: encrypted with the user's PIN)   // optional, 17.10.2026;
//     homework: {v:1, items:[{id,sid,text,due,done,doneAt,added}]}, sleep: {v:1, bed, hours, nights:[{date,bed,wake}]},
//     birthdays: {v:1, people:[{id,name,day,month,year,note,ideas:[{id,text,got}]}]}   // optional, 18.10.2026;
//   } }                                                                  // older versions ignore it, so it stays format 1
(function (g) {
  "use strict";
  const FORMAT = 1;
  const HABIT_TYPES = ["count", "bool", "amount", "time"];
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const PARTS = ["plan", "goals", "portfolio", "study", "savings", "homework", "sleep", "birthdays"];
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

  // FNV-1a over the UTF-16 code units: detects a cut-off or hand-edited file (not a security measure)
  function checksum(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8) + "-" + str.length;
  }

  function summarize(data, csvRows) {
    const h = data.habits || {}, f = data.fit || {};
    const days = Object.keys(h.log || {}).filter(k => Object.keys(h.log[k] || {}).length);
    const fitIds = Object.keys(f.acts || {});
    const allDays = [...days, ...Object.keys(h.notes || {}), ...fitIds.map(id => String(id).slice(0, 10))].sort();
    return {
      csvTrainings: csvRows == null ? (data.swimCsv && data.swimCsv.text ? null : 0) : csvRows,
      fitTrainings: fitIds.length,
      hiddenTrainings: Object.keys(f.hidden || {}).length,
      habits: (h.habits || []).length,
      habitDays: days.length,
      notes: Object.keys(h.notes || {}).length,
      skippedDays: Object.keys(h.skips || {}).length,
      cancelledTrainings: Object.keys((data.attendance && data.attendance.cancelled) || {}).length,
      markedAbsences: Object.keys((data.attendance && data.attendance.absent) || {}).length,
      schoolGrades: ((data.school && data.school.grades) || []).length,
      manualRecords: ((data.manualRecords && data.manualRecords.entries) || []).length,
      planEvents: ((data.plan && data.plan.events) || []).length,
      homework: ((data.homework && data.homework.items) || []).length,
      sleepNights: ((data.sleep && data.sleep.nights) || []).length,
      birthdays: ((data.birthdays && data.birthdays.people) || []).length,
      goals: ((data.goals && data.goals.goals) || []).length,
      portfolio: ((data.portfolio && data.portfolio.activities) || []).length + ((data.portfolio && data.portfolio.awards) || []).length,
      studyTopics: ((data.study && data.study.subjects) || []).reduce((a, s) => a + ((s && s.topics) || []).filter(t => t && t.st > 0).length, 0)
        + ((data.study && data.study.current && Array.isArray(data.study.current.topics)) ? data.study.current.topics.length : 0),
      savings: data.savings && (data.savings.box || (data.savings.old || []).length) ? 1 : 0,
      firstDay: allDays[0] || null,
      lastDay: allDays[allDays.length - 1] || null,
    };
  }

  // state: {csvText, fit:{acts,bad,last,hidden}, habits:{habits,log,notes,skips}, attendance?:{days,from,cancelled}, school?:{...}}
  function build(state, meta = {}) {
    const data = {
      swimCsv: state.csvText ? { text: state.csvText } : null,
      fit: { acts: state.fit.acts || {}, bad: state.fit.bad || {}, last: state.fit.last || [], hidden: state.fit.hidden || {} },
      habits: { habits: state.habits.habits || [], log: state.habits.log || {}, notes: state.habits.notes || {}, skips: state.habits.skips || {} },
    };
    if (state.attendance) data.attendance = { days: state.attendance.days || [], from: state.attendance.from || null, cancelled: state.attendance.cancelled || {}, absent: state.attendance.absent || {} };
    if (state.school) data.school = state.school;
    if (state.manualRecords) data.manualRecords = state.manualRecords;
    for (const p of PARTS) if (state[p]) data[p] = state[p];
    const json = JSON.stringify(data);
    return {
      app: "rytm", kind: "backup", format: FORMAT,
      exportedAt: (meta.now || new Date()).toISOString(), appVersion: meta.appVersion || null,
      summary: summarize(data, meta.csvRows), checksum: checksum(json), data,
    };
  }
  const fileName = (d = new Date()) => {
    const p = n => String(n).padStart(2, "0");
    return `rytm-kopia-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  };

  // text -> {ok, errors:[...], warnings:[...], backup, summary}
  // parseCsv (optional): text -> rows; throws with a readable message when the CSV is not a Garmin export
  function validate(text, opts = {}) {
    const errors = [], warnings = [];
    const fail = m => ({ ok: false, errors: [m], warnings, backup: null, summary: null });
    if (typeof text !== "string" || !text.trim()) return fail("Plik jest pusty.");
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return fail("To nie jest plik kopii Rytm (nie da się go odczytać jako JSON)."); }
    if (!isObj(obj) || obj.app !== "rytm" || obj.kind !== "backup") return fail("To nie jest plik kopii Rytm.");
    if (!Number.isInteger(obj.format) || obj.format < 1) return fail("Plik kopii ma nieznany format.");
    if (obj.format > FORMAT) return fail(`Ta kopia pochodzi z nowszej wersji aplikacji (format ${obj.format}). Najpierw zaktualizuj aplikację.`);
    if (!isObj(obj.data)) return fail("W pliku kopii brakuje danych.");
    if (typeof obj.checksum !== "string" || obj.checksum !== checksum(JSON.stringify(obj.data)))
      return fail("Plik kopii jest uszkodzony albo był zmieniany ręcznie (suma kontrolna się nie zgadza).");

    const d = obj.data;
    // CSV
    let csvRows = 0;
    if (d.swimCsv !== null && d.swimCsv !== undefined) {
      if (!isObj(d.swimCsv) || typeof d.swimCsv.text !== "string") errors.push("Część „lista treningów (CSV)” ma zły format.");
      else if (opts.parseCsv) {
        try { csvRows = opts.parseCsv(d.swimCsv.text).length; }
        catch (e) { errors.push("Lista treningów (CSV) w kopii jest nieczytelna: " + (e && e.message || e)); }
      } else csvRows = null;
    }
    // FIT
    const f = d.fit;
    if (!isObj(f) || !isObj(f.acts) || !isObj(f.bad) || !Array.isArray(f.last) || !isObj(f.hidden)) errors.push("Część „treningi z plików FIT” ma zły format.");
    else {
      for (const [id, a] of Object.entries(f.acts)) {
        if (!isObj(a) || a.id !== id || typeof a.start !== "number" || !(a.pool > 0) || !Array.isArray(a.L)
          || !a.L.every(r => Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "number")) {
          errors.push(`Trening z pliku FIT „${String(id).slice(0, 40)}” ma zły format.`); if (errors.length > 8) break;
        }
      }
      for (const [id, idx] of Object.entries(f.bad)) if (!Array.isArray(idx) || !idx.every(Number.isInteger)) { errors.push("Lista pominiętych długości ma zły format."); break; }
      for (const [k, v] of Object.entries(f.hidden)) if (typeof k !== "string" || typeof v !== "string") { errors.push("Lista usuniętych treningów ma zły format."); break; }
    }
    // habits
    const h = d.habits;
    if (!isObj(h) || !Array.isArray(h.habits) || !isObj(h.log) || !isObj(h.notes) || !isObj(h.skips)) errors.push("Część „nawyki” ma zły format.");
    else {
      const ids = new Set();
      for (const x of h.habits) {
        if (!isObj(x) || typeof x.id !== "string" || typeof x.name !== "string" || !HABIT_TYPES.includes(x.type)) { errors.push(`Nawyk „${isObj(x) && x.name || "?"}” ma zły format.`); continue; }
        if (ids.has(x.id)) errors.push(`Nawyk „${x.name}” występuje w kopii dwa razy.`);
        ids.add(x.id);
        if (x.type === "count" && !(Number.isInteger(x.target) && x.target >= 1)) errors.push(`Nawyk „${x.name}”: zła liczba powtórzeń.`);
        if ((x.type === "amount" || x.type === "time") && !(x.goal > 0)) errors.push(`Nawyk „${x.name}”: zły cel.`);
      }
      let unknown = 0;
      for (const [day, row] of Object.entries(h.log)) {
        if (!DAY.test(day) || !isObj(row)) { errors.push(`Wpis z dnia „${day}” ma zły format.`); continue; }
        for (const [hid, v] of Object.entries(row)) {
          if (!ids.has(hid)) unknown++;
          if (!(typeof v === "number" || typeof v === "boolean")) errors.push(`Wpis z dnia ${day} ma złą wartość.`);
        }
      }
      if (unknown) warnings.push(`${unknown} wpisów dotyczy nawyków, których nie ma w kopii. Zostaną zachowane, ale nie będą widoczne.`);
      for (const k of [...Object.keys(h.notes), ...Object.keys(h.skips)]) if (!DAY.test(k)) { errors.push(`Notatka albo pominięty dzień „${k}” ma zły format daty.`); break; }
    }
    // attendance (optional)
    const a = d.attendance;
    if (a !== undefined && a !== null) {
      if (!isObj(a) || !Array.isArray(a.days) || !a.days.every(x => Number.isInteger(x) && x >= 1 && x <= 7) || !(a.from === null || (typeof a.from === "string" && DAY.test(a.from))) || !isObj(a.cancelled))
        errors.push("Część „frekwencja” ma zły format.");
      else {
        for (const [k, v] of Object.entries(a.cancelled)) if (!DAY.test(k) || typeof v !== "string") { errors.push("Lista pominiętych treningów ma zły format."); break; }
        if (a.absent !== undefined && (!isObj(a.absent) || !Object.entries(a.absent).every(([k, v]) => DAY.test(k) && typeof v === "string"))) errors.push("Lista nieobecności ma zły format.");
      }
    }
    // school (optional): the shape only; the app cleans the details when it loads it
    const sc = d.school;
    if (sc !== undefined && sc !== null) {
      if (!isObj(sc) || !Array.isArray(sc.subjects) || !Array.isArray(sc.grades) || !Array.isArray(sc.tests) || !isObj(sc.settings)) errors.push("Część „szkoła” ma zły format.");
      else if (!sc.grades.every(x => isObj(x) && typeof x.id === "string" && typeof x.sid === "string" && typeof x.pct === "number" && x.pct >= 0 && x.pct <= 100 && DAY.test(x.date || "")))
        errors.push("Lista ocen ma zły format.");
    }
    // results typed in by hand (optional): the shape only; the app cleans the details when it loads it
    const mr = d.manualRecords;
    if (mr !== undefined && mr !== null) {
      if (!isObj(mr) || !Array.isArray(mr.entries)) errors.push("Część „wyniki wpisane ręcznie” ma zły format.");
      else if (!mr.entries.every(x => isObj(x) && typeof x.id === "string" && typeof x.time === "number" && x.time > 0 && typeof x.dist === "number" && typeof x.stroke === "string" && DAY.test(x.date || "")))
        errors.push("Lista wyników wpisanych ręcznie ma zły format.");
    }
    // the parts added on 17–18.10.2026 (optional): the shape only; each module cleans the details when it loads them
    const part = (k, name, ok) => { const v = d[k]; if (v !== undefined && v !== null && !(isObj(v) && ok(v))) errors.push(`Część „${name}” ma zły format.`); };
    const box = b => isObj(b) && typeof b.salt === "string" && typeof b.iv === "string" && typeof b.ct === "string" && Number.isInteger(b.iter);
    part("plan", "kalendarz i plan lekcji", v => Array.isArray(v.events) && (v.lessons === undefined || isObj(v.lessons)) && (v.bells === undefined || Array.isArray(v.bells)) && (v.cats === undefined || Array.isArray(v.cats)));
    part("goals", "cele", v => Array.isArray(v.goals) && v.goals.every(x => isObj(x) && typeof x.id === "string" && typeof x.title === "string" && Array.isArray(x.steps)));
    part("portfolio", "portfolio", v => Array.isArray(v.activities) && Array.isArray(v.awards));
    part("homework", "zadania domowe", v => Array.isArray(v.items) && v.items.every(x => isObj(x) && typeof x.id === "string" && typeof x.text === "string"));
    part("sleep", "sen", v => Array.isArray(v.nights) && v.nights.every(isObj));
    part("birthdays", "urodziny", v => Array.isArray(v.people) && v.people.every(x => isObj(x) && typeof x.id === "string" && typeof x.name === "string"));
    part("study", "nauka", v => Array.isArray(v.subjects) && Array.isArray(v.tests) && (v.current === undefined || (isObj(v.current) && (v.current.topics === undefined || Array.isArray(v.current.topics)) && (v.current.sessions === undefined || Array.isArray(v.current.sessions)))));
    part("savings", "oszczędzanie", v => (v.box === null || box(v.box)) && Array.isArray(v.old) && v.old.every(box));
    const uniq = [...new Set(errors)];
    if (uniq.length) return { ok: false, errors: uniq.slice(0, 8), warnings, backup: null, summary: null };
    return { ok: true, errors: [], warnings, backup: obj, summary: summarize(d, csvRows) };
  }

  // warnings shown before replacing data: the backup looks older or smaller than what is on the device now
  function compare(current, incoming) {
    const out = [];
    const lost = (k, label) => { if ((incoming[k] || 0) < (current[k] || 0)) out.push(`${label}: na urządzeniu ${current[k]}, w kopii ${incoming[k] || 0}.`); };
    lost("fitTrainings", "Treningi z plików FIT");
    lost("csvTrainings", "Treningi z listy CSV");
    lost("habits", "Nawyki");
    lost("habitDays", "Dni z wpisami nawyków");
    lost("notes", "Notatki");
    lost("cancelledTrainings", "Oznaczone dni treningowe (zawody, odwołane, choroba, wyjazd)");
    lost("markedAbsences", "Nieobecności zaznaczone ręcznie");
    lost("schoolGrades", "Oceny (szkoła)");
    lost("manualRecords", "Wyniki wpisane ręcznie (rekordy)");
    lost("planEvents", "Wydarzenia w kalendarzu");
    lost("goals", "Cele");
    lost("portfolio", "Portfolio (aktywności i osiągnięcia)");
    lost("studyTopics", "Tematy w nauce (z postępem)");
    lost("homework", "Zadania domowe");
    lost("sleepNights", "Zapisane noce (sen)");
    lost("birthdays", "Urodziny");
    if ((current.savings || 0) > (incoming.savings || 0)) out.push("Oszczędzanie: na urządzeniu są zaszyfrowane dane, a w kopii ich nie ma.");
    if (current.lastDay && incoming.lastDay && incoming.lastDay < current.lastDay)
      out.push(`Najnowsze dane w kopii są z ${incoming.lastDay}, a na urządzeniu z ${current.lastDay}.`);
    return out;
  }

  const api = { FORMAT, checksum, build, validate, summarize, compare, fileName };
  g.Backup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
