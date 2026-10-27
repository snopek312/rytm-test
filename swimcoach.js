// Rytm: the coach's comments in Pływanie → Analiza (27.10.2026). Rules, not AI: every statistic is checked against fine
// steps, each step has its own words (and two or more versions of them), so even a small change in a number changes the
// comment. Strict on purpose: "Dobrze" only for really good numbers. Attendance weighs the most.
// Levels: "zle" (Źle), "slabo" (Słabo — a weak side), "popraw" (Do poprawy), "dobrze" (Dobrze).
// Each comment: {id, area, lvl, w (how much it matters, for the order), pl, en}. Pure logic, no page code.
// Input D (from the app): {today, trainings, acts, bad, recs, att (Attendance.stats()), swim (the saved part), hrMax, css (cssNow),
//   sleep: {nights, hours} | null, units: {u(), d(m), pace(s)}}
(function (g) {
  "use strict";
  const ST = g.RytmSwimStats || (typeof require === "function" ? require("./swimstats.js") : null);
  const LV = { zle: 4, slabo: 3, popraw: 2, dobrze: 1 };

  /* ---------- words and numbers ---------- */
  const nf = (lang, x, d = 0) => { if (x == null || !isFinite(x)) return "–"; const r = Math.round(x * 10 ** d) / 10 ** d; return (r === 0 ? 0 : r).toFixed(d).replace("-", "−").replace(".", lang === "pl" ? "," : "."); };
  // "dziś" / "wczoraj" / "5 dni temu"
  const AGO = d => (d <= 0 ? ["dziś", "today"] : d === 1 ? ["wczoraj", "yesterday"] : [`${d} dni temu`, `${d} days ago`]);
  const V = (x, d = 0) => [nf("pl", x, d), nf("en", x, d)];                          // a number in both languages
  const W = (pl, en) => [pl, en === undefined ? pl : en];                            // words in both languages
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n === 1 ? one : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? few : many; };
  // a number with its noun in the right form: NT(3, "trening", "treningi", "treningów", "session", "sessions") → ["3 treningi", "3 sessions"]
  const NT = (n, one, few, many, en1, enN) => [`${n} ${plural(n, one, few, many)}`, `${n} ${n === 1 ? en1 : enN}`];
  const TR = n => NT(n, "trening", "treningi", "treningów", "session", "sessions");
  // "every n-th": co siódmy / every seventh (n = planned ÷ missed, rounded)
  const ORDPL = ["", "", "drugi", "trzeci", "czwarty", "piąty", "szósty", "siódmy", "ósmy", "dziewiąty", "dziesiąty", "jedenasty", "dwunasty", "trzynasty", "czternasty", "piętnasty"];
  const ORDEN = ["", "", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth"];
  const ORD = x => { const k = Math.max(2, Math.min(15, Math.round(x) || 2)); return [ORDPL[k], ORDEN[k]]; };
  const fmtPace = s => { if (s == null || !isFinite(s)) return "–"; const r = Math.round(s); return Math.floor(r / 60) + ":" + String(r % 60).padStart(2, "0"); };
  const fmtTime = s => { const c = Math.round(s * 100), m = Math.floor(c / 6000), sec = (c % 6000) / 100; return (m ? m + ":" + (sec < 10 ? "0" : "") : "") + sec.toFixed(2); };
  const P = s => { const t = fmtPace(s); return [t, t]; };
  const TT = s => { const t = fmtTime(s); return [t.replace(".", ","), t]; };
  const fmtDayPl = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" }), fmtDayEn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  const DT = k => { const d = ST.parseDay(k); return [fmtDayPl.format(d), fmtDayEn.format(d)]; };
  const STROKE_INST = { free: ["kraulem", "freestyle"], back: ["grzbietem", "backstroke"], breast: ["żabką", "breaststroke"], fly: ["motylkiem", "butterfly"], im: ["zmiennym", "medley"] };
  const STROKE_NOM = { free: ["kraul", "freestyle"], back: ["grzbiet", "backstroke"], breast: ["żabka", "breaststroke"], fly: ["motyl", "butterfly"], im: ["zmienny", "medley"] };
  const unitOf = pool => (g.Swim && g.Swim.poolUnit ? g.Swim.poolUnit(pool) : "m");
  const EV = (stroke, dist, pool) => W(`${dist} ${unitOf(pool)} ${STROKE_INST[stroke][0]}`, `${dist} ${unitOf(pool)} ${STROKE_INST[stroke][1]}`);
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  const fill = (t, vars, i) => cap(t.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k][i] : m)));
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

  // one comment from a ladder of steps: steps = [{at, lvl, w, t:[[pl, en], …]}]; up = true when higher is better
  // (the first step with value ≥ at), false when lower is better (the first step with value ≤ at)
  function ladder(out, id, area, value, up, steps, vars, seed) {
    if (value == null || !isFinite(value)) return null;
    const st = steps.find(s => (up ? value >= s.at : value <= s.at)) || steps[steps.length - 1];
    if (!st || !st.t || !st.t.length) return null;
    const v = st.t[hash(id + "|" + steps.indexOf(st) + "|" + (seed != null ? seed : value)) % st.t.length];
    const c = { id, area, lvl: st.lvl, w: st.w, pl: fill(v[0], vars, 0), en: fill(v[1], vars, 1) };
    out.push(c);
    return c;
  }
  // a single comment without steps
  function say(out, id, area, lvl, w, variants, vars, seed) {
    const v = variants[hash(id + "|" + (seed || "")) % variants.length];
    const c = { id, area, lvl, w, pl: fill(v[0], vars || {}, 0), en: fill(v[1], vars || {}, 1) };
    out.push(c);
    return c;
  }
  const AREA = { att: ["Frekwencja", "Attendance"], vol: ["Objętość", "Volume"], reg: ["Regularność", "Regularity"], pace: ["Tempo", "Pace"], eff: ["Efektywność", "Efficiency"],
    swolf: ["SWOLF", "SWOLF"], hr: ["Tętno", "Heart rate"], css: ["CSS", "CSS"], load: ["Obciążenie", "Load"], tech: ["Technika", "Technique"], sets: ["Serie", "Sets"],
    rec: ["Rekordy", "Records"], pts: ["Punkty", "Points"], peer: ["Rówieśnicy", "Your age group"], goal: ["Cele", "Goals"], sleep: ["Sen", "Sleep"], data: ["Dane", "Data"], train: ["Trening", "Workout"] };
  const LEVEL = { zle: ["Źle", "Bad"], slabo: ["Słabo", "Weak spot"], popraw: ["Do poprawy", "To improve"], dobrze: ["Dobrze", "Good"] };

  /* ================= attendance ================= */
  function attendance(out, D) {
    const A = D.att; if (!A) { say(out, "att-none", "att", "popraw", 40, [W("Frekwencji jeszcze nie da się policzyć — wczytaj treningi z Garmina.", "Attendance can't be counted yet — load your workouts from Garmin.")]); return; }
    const s = A.season, per = s.kind === "wakacje" ? W(`w wakacjach ${s.label.replace(/^Wakacje /, "")}`, `in the ${s.label.replace(/^Wakacje /, "")} holidays`) : W(`w roku szkolnym ${s.label.replace(/^Rok /, "")}`, `in the ${s.label.replace(/^Rok /, "")} school year`);
    if (s.planned >= 4) {
      const miss = s.planned - s.present, vars = { p: V(s.pct), x: V(s.present), y: V(s.planned), miss: V(miss), per, mt: TR(miss),
        mo: NT(miss, "opuszczony trening", "opuszczone treningi", "opuszczonych treningów", "missed session", "missed sessions"), co: ORD(miss ? s.planned / miss : 0) };
      ladder(out, "att-season", "att", s.pct, true, [
        { at: 98, lvl: "dobrze", w: 8, t: [W("Frekwencja {p}% {per} ({x} z {y}) — prawie idealna. Jeden słabszy tydzień i spadnie, więc pilnuj.", "Attendance {p}% {per} ({x} of {y}) — almost perfect. One weaker week and it drops, so keep at it."),
          W("{p}% obecności {per}. Tak wygląda zawodnik, który chce bić rekordy.", "{p}% attendance {per}. That's what a swimmer who wants records looks like.")] },
        { at: 95, lvl: "dobrze", w: 12, t: [W("Frekwencja {p}% ({x} z {y}) — dobra. Opuściłeś {miss}, każdy następny trening ją zjada.", "Attendance {p}% ({x} of {y}) — good. You missed {miss}; every next one eats into it."),
          W("{p}% {per}: dobrze, ale nie idealnie — każdy opuszczony trening to trening mniej.", "{p}% {per}: good, not perfect — every missed session is one session less.")] },
        { at: 90, lvl: "popraw", w: 32, t: [W("Frekwencja {p}% ({x} z {y}). Przyzwoicie, ale opuszczone treningi: {miss} — przy biciu rekordów to się czuje.", "Attendance {p}% ({x} of {y}). Decent, but you've already missed {miss} — you feel that when chasing records."),
          W("{p}% {per}. To jeszcze nie poziom zawodnika — zawodnik ma 95% i więcej.", "{p}% {per}. Not a racer's level yet — racers have 95% or more.")] },
        { at: 85, lvl: "popraw", w: 46, t: [W("Frekwencja {p}%: opuszczone {miss} z {y}. Co {co} trening przepada.", "Attendance {p}%: {miss} missed out of {y}. Every {co} session is gone."), W("{p}% {per}. To wygląda przyzwoicie tylko na papierze — {mt} mniej to kilometry, których nie ma.", "{p}% {per}. It only looks decent on paper — {mt} fewer is distance that isn't there."),
          W("{p}% obecności {per} — za mało, żeby forma rosła równo. Brakuje {miss} treningów.", "{p}% attendance {per} — too little for steady progress. {miss} sessions missing.")] },
        { at: 80, lvl: "zle", w: 56, t: [W("Frekwencja {p}% — opuściłeś {miss} z {y} treningów. Przy takiej frekwencji rekordy będą przychodzić rzadko.", "Attendance {p}% — you missed {miss} of {y}. With that, records will come rarely."), W("Frekwencja {p}%. Z {y} zaplanowanych treningów byłeś na {x}. Za mało, żeby regularnie bić rekordy.", "Attendance {p}%. You made {x} of {y} planned sessions. Too few to break records regularly."),
          W("{p}% {per}. Co {co} trening opuszczony — to już hamuje postęp.", "{p}% {per}. Every {co} session missed — that already slows progress.")] },
        { at: 75, lvl: "zle", w: 64, t: [W("Frekwencja {p}% ({x} z {y}). Ćwierć treningów przepada. Technika i tempo nie poprawią się bez pływania.", "Attendance {p}% ({x} of {y}). A quarter of sessions lost. Technique and pace won't improve without swimming."), W("{p}% — opuszczasz co {co} trening. Rekordy wymagają regularności, a jej tu brakuje.", "{p}% — you miss every {co} session. Records need consistency, and it's missing here."),
          W("{p}% — {mo} {per}. To już nie wypadki, tylko nawyk.", "{p}% — {mo} {per}. Not accidents any more, a habit.")] },
        { at: 70, lvl: "zle", w: 72, t: [W("Frekwencja {p}%. Ponad ćwierć treningów opuszczona — tak forma nie urośnie.", "Attendance {p}%. Over a quarter of sessions missed — fitness won't grow like this."), W("Frekwencja {p}% {per}. Każdy opuszczony trening to trening, którego już nie odrobisz.", "Attendance {p}% {per}. Every missed session is one you can't make up."),
          W("{p}% obecności: {miss} z {y} treningów bez ciebie. Najpierw frekwencja, dopiero potem reszta.", "{p}% attendance: {miss} of {y} sessions without you. Attendance first, everything else later.")] },
        { at: 65, lvl: "zle", w: 78, t: [W("Frekwencja {p}% — za nisko. Opuszczasz więcej, niż jesteś w stanie nadrobić.", "Attendance {p}% — too low. You miss more than you can make up."), W("{p}% obecności. Nauka jest ważna, ale przy {miss} nieobecnościach basen przegrywa za często.", "{p}% attendance. School matters, but with {miss} absences the pool loses too often."),
          W("{p}% {per}. Przy {miss} opuszczonych treningach każdy powrót zaczyna się od nadrabiania.", "{p}% {per}. With {miss} missed, every return starts with catching up.")] },
        { at: 60, lvl: "zle", w: 84, t: [W("Frekwencja {p}%. To jest teraz twój największy problem — większy niż technika.", "Attendance {p}%. That's your biggest problem now — bigger than technique."), W("Frekwencja {p}% — {mo}. Ułóż naukę tak, żeby nie wypadała w godzinach treningu.", "Attendance {p}% — {mo}. Plan your studying so it doesn't fall in training hours."),
          W("{p}% ({x} z {y}). Prawie dwa na pięć treningów przepadają. Tak się nie buduje formy.", "{p}% ({x} of {y}). Almost two in five sessions lost. That's not how fitness is built.")] },
        { at: 50, lvl: "zle", w: 90, t: [W("Frekwencja {p}% — to ledwo ponad połowa treningów. Rekordy przy takiej frekwencji to przypadek, a nie plan.", "Attendance {p}% — barely over half the sessions. Records at this level are luck, not a plan."), W("{p}% {per}. Bez zmiany planu dnia ta liczba sama się nie poprawi.", "{p}% {per}. Without changing your daily plan this number won't improve on its own."),
          W("{p}% {per}: {mo}. Zanim zaczniesz poprawiać styl, zacznij przychodzić.", "{p}% {per}: {mo}. Before fixing technique, start showing up.")] },
        { at: 0, lvl: "zle", w: 97, t: [W("Frekwencja {p}% — opuszczasz więcej niż co drugi trening. Problem numer jeden, bez dyskusji.", "Attendance {p}% — you miss more than every second session. Problem number one, no discussion."), W("Frekwencja {p}%. Najpierw basen w kalendarzu, potem reszta — inaczej nic się nie zmieni.", "Attendance {p}%. Pool in the calendar first, the rest after — otherwise nothing changes."),
          W("{p}% ({x} z {y}). Przy takiej frekwencji nie da się trenować, tylko czasem popływać.", "{p}% ({x} of {y}). At this level you're not training, just swimming sometimes.")] },
      ], vars, `${s.present}/${s.planned}`);
      // what is still possible this period (90%)
      if (A.remaining != null && s.pct < 95) {
        const need = Math.ceil(0.9 * (s.planned + A.remaining)) - s.present, allowed = A.remaining - need;
        const maxPct = Math.round(100 * (s.present + A.remaining) / (s.planned + A.remaining));
        if (allowed < 0) say(out, "att-90-gone", "att", "zle", 70, [W("90% {per} już się nie da: nawet bez ani jednej nieobecności skończysz na {m}%.", "90% {per} is already gone: even with no more absences you'll end at {m}%."),
          W("Na 90% {per} jest za późno — najwyżej {m}%, jeśli nie opuścisz już nic.", "Too late for 90% {per} — at most {m}% if you miss nothing else.")], { per, m: V(maxPct) }, String(maxPct));
        else if (A.remaining >= 5) say(out, "att-90-left", "att", allowed <= 2 ? "zle" : "popraw", allowed <= 2 ? 60 : 38, [W("Żeby skończyć {per} z 90%, możesz opuścić najwyżej {a} z {r} pozostałych treningów.", "To finish {per} at 90%, you can miss at most {a} of the {r} sessions left."),
          W("90% {per} jest jeszcze możliwe: do końca {rt}, wolno opuścić {a}.", "90% {per} is still possible: {rt} left, you may miss {a}.")], { per, a: V(allowed), r: V(A.remaining), rt: TR(A.remaining) }, `${allowed}/${A.remaining}`);
      }
    }
    const m = A.month;
    if (m.planned >= 3 && s.planned >= 4 && s.pct != null) {
      const d = m.pct - s.pct, vars = { m: V(m.pct), p: V(s.pct), d: V(Math.abs(d)) };
      ladder(out, "att-month", "att", d, true, [
        { at: 8, lvl: m.pct >= 90 ? "dobrze" : "popraw", w: m.pct >= 90 ? 10 : 30, t: [W("Ten miesiąc lepszy: {m}% wobec {p}% w całym okresie. Utrzymaj to do końca miesiąca.", "This month is better: {m}% vs {p}% for the period. Keep it to the end of the month."),
          W("W tym miesiącu {m}% — o {d} punktów lepiej niż średnio. Dopiero kilka tygodni, nie ogłaszaj sukcesu.", "{m}% this month — {d} points above your average. Only a few weeks, don't celebrate yet.")] },
        { at: 3, lvl: "popraw", w: 28, t: [W("Ten miesiąc odrobinę lepszy ({m}%), ale to wciąż ten sam poziom co cały okres ({p}%).", "This month slightly better ({m}%), but it's the same level as the period ({p}%)."),
          W("{m}% w tym miesiącu — minimalna poprawa o {d} pkt. Za mało, żeby coś zmienić.", "{m}% this month — a tiny gain of {d} pts. Not enough to change anything.")] },
        { at: -3, lvl: m.pct >= 90 ? "dobrze" : "popraw", w: m.pct >= 90 ? 6 : 34, t: [W("W tym miesiącu {m}%, czyli tak samo jak zwykle ({p}%). Stoisz w miejscu.", "{m}% this month, same as usual ({p}%). Standing still."),
          W("Ten miesiąc bez zmian: {m}%. Bez wyraźnej poprawy frekwencja nie przestanie hamować wyników.", "This month unchanged: {m}%. Without a clear improvement attendance keeps holding you back.")] },
        { at: -8, lvl: "popraw", w: 42, t: [W("Ten miesiąc słabszy: {m}% (cały okres {p}%).", "This month weaker: {m}% (whole period {p}%)."),
          W("W tym miesiącu frekwencja spadła o {d} pkt, do {m}%. Złap to, zanim się utrwali.", "Attendance this month dropped {d} pts to {m}%. Catch it before it sticks.")] },
        { at: -15, lvl: "zle", w: 58, t: [W("Ten miesiąc wyraźnie gorszy: {m}% wobec {p}%. Coś się posypało.", "This month clearly worse: {m}% vs {p}%. Something fell apart."),
          W("Frekwencja w tym miesiącu {m}% — o {d} pkt niżej niż zwykle. Tak zaczyna się długi dołek.", "Attendance this month {m}% — {d} pts below usual. That's how a long slump starts.")] },
        { at: -100, lvl: "zle", w: 74, t: [W("Ten miesiąc to zapaść: {m}% wobec {p}% w całym okresie.", "This month is a collapse: {m}% vs {p}% for the period."),
          W("{m}% w tym miesiącu — {d} pkt poniżej średniej. Najgorszy moment od dawna.", "{m}% this month — {d} pts below average. The worst stretch in a while.")] },
      ], vars, `${m.present}/${m.planned}`);
    }
    const l = A.last14;
    if (l.planned >= 3) {
      const vars = { a: V(l.absent), x: V(l.present), y: V(l.planned), yt: TR(l.planned), at: TR(l.absent) };
      ladder(out, "att-14", "att", l.absent, false, [
        { at: 0, lvl: "dobrze", w: 6, t: [W("Ostatnie 2 tygodnie bez opuszczonego treningu ({x} z {y}).", "The last 2 weeks without a missed session ({x} of {y})."), W("14 dni, {yt}, zero nieobecności. Tak ma być zawsze.", "14 days, {yt}, zero absences. That's how it should always be.")] },
        { at: 1, lvl: "popraw", w: 36, t: [W("W ostatnich 2 tygodniach opuściłeś 1 trening z {y}.", "In the last 2 weeks you missed 1 of {y} sessions."), W("Jedna nieobecność w 14 dni. Niby mało, ale to ona decyduje o 100%.", "One absence in 14 days. Seems small, but it's what decides 100%.")] },
        { at: 2, lvl: "zle", w: 56, t: [W("2 opuszczone treningi w ostatnich 2 tygodniach ({x} z {y}).", "2 missed sessions in the last 2 weeks ({x} of {y})."), W("W 14 dni dwie nieobecności — to już tydzień treningu w plecy.", "Two absences in 14 days — that's a week of training lost.")] },
        { at: 3, lvl: "zle", w: 72, t: [W("3 nieobecności w 14 dni. Forma z takich tygodni nie rośnie.", "3 absences in 14 days. Fitness doesn't grow in weeks like that."), W("Ostatnie 2 tygodnie: tylko {x} z {y} treningów. Za mało.", "The last 2 weeks: only {x} of {y} sessions. Too few.")] },
        { at: 5, lvl: "zle", w: 85, t: [W("W 14 dni opuściłeś {at}. To prawie połowa.", "In 14 days you missed {at}. That's almost half."), W("{a} nieobecności w dwa tygodnie — praktycznie przerwa w treningach.", "{a} absences in two weeks — practically a break from training.")] },
        { at: 100, lvl: "zle", w: 95, t: [W("W 14 dni opuściłeś {at}. Tak się nie da trenować.", "In 14 days you missed {at}. You can't train like this."), W("Ostatnie 2 tygodnie: {x} z {y}. To nie jest trening, tylko przerwa.", "The last 2 weeks: {x} of {y}. That's not training, that's a break.")] },
      ], vars);
    }
    if (A.last28.planned >= 4 && A.prev28.planned >= 4) {
      const d = A.last28.pct - A.prev28.pct, vars = { a: V(A.last28.pct), b: V(A.prev28.pct), d: V(Math.abs(d)) };
      ladder(out, "att-28", "att", d, true, [
        { at: 10, lvl: A.last28.pct >= 90 ? "dobrze" : "popraw", w: 18, t: [W("Ostatnie 4 tygodnie: {a}%, wcześniejsze 4: {b}%. Idzie w dobrą stronę.", "The last 4 weeks: {a}%, the 4 before: {b}%. Going the right way."), W("Frekwencja w górę o {d} pkt ({b}% → {a}%). Pilnuj, żeby to nie był jednorazowy zryw.", "Attendance up {d} pts ({b}% → {a}%). Make sure it's not a one-off.")] },
        { at: 4, lvl: "popraw", w: 26, t: [W("Lekka poprawa: {b}% → {a}% w ostatnich 4 tygodniach.", "A slight improvement: {b}% → {a}% in the last 4 weeks."), W("Frekwencja +{d} pkt w 4 tygodnie. Za wolno, żeby nadrobić zaległości.", "Attendance +{d} pts in 4 weeks. Too slow to make up the gap.")] },
        { at: -4, lvl: A.last28.pct >= 90 ? "dobrze" : "popraw", w: A.last28.pct >= 90 ? 5 : 30, t: [W("Frekwencja stoi: {b}% → {a}% (4 tygodnie do 4 tygodni).", "Attendance flat: {b}% → {a}% (4 weeks against 4 weeks)."), W("Bez zmian od miesiąca: {a}%. Stabilnie — ale stabilnie na jakim poziomie?", "No change for a month: {a}%. Stable — but stable at what level?")] },
        { at: -10, lvl: "zle", w: 50, t: [W("Frekwencja spada: {b}% → {a}% w ostatnich 4 tygodniach.", "Attendance falling: {b}% → {a}% in the last 4 weeks."), W("−{d} pkt w miesiąc. Zatrzymaj to teraz.", "−{d} pts in a month. Stop it now.")] },
        { at: -20, lvl: "zle", w: 66, t: [W("Mocny spadek frekwencji: {b}% → {a}%.", "A big drop in attendance: {b}% → {a}%."), W("W 4 tygodnie frekwencja spadła o {d} pkt. To wygląda na odpuszczanie.", "Attendance down {d} pts in 4 weeks. It looks like giving up.")] },
        { at: -100, lvl: "zle", w: 80, t: [W("Frekwencja leci w dół: z {b}% do {a}% w miesiąc.", "Attendance in free fall: from {b}% to {a}% in a month."), W("−{d} pkt w 4 tygodnie. Tak forma rozpada się najszybciej.", "−{d} pts in 4 weeks. That's the fastest way to lose fitness.")] },
      ], vars);
    }
    ladder(out, "att-streak", "att", A.streak, true, [
      { at: 20, lvl: "dobrze", w: 4, t: [W("Seria: {nt} z rzędu. Tego nie przerywaj.", "A streak of {nt} in a row. Don't break it."), W("{nt} bez nieobecności — to jest regularność.", "{nt} without an absence — that's consistency.")] },
      { at: 10, lvl: "dobrze", w: 8, t: [W("Seria: {nt} z rzędu. Dobrze, teraz 20.", "A streak of {nt}. Good, now go for 20."), W("{n} z rzędu. Najtrudniejsze jest utrzymanie, nie początek.", "{n} in a row. Keeping it is harder than starting.")] },
      { at: 6, lvl: "popraw", w: 16, t: [W("Seria: {nt} z rzędu — dociągnij do 10.", "A streak of {nt} — push it to 10."), W("{n} z rzędu. Dobry początek, jeszcze nie nawyk.", "{n} in a row. A good start, not a habit yet.")] },
      { at: 3, lvl: "popraw", w: 26, t: [W("Seria: {nt} z rzędu. Krótka.", "Streak: {nt} in a row. Short."), W("Tylko {nt} bez przerwy. Zrób 10.", "Only {nt} without a gap. Make it 10.")] },
      { at: 1, lvl: "popraw", w: 40, t: [W("Seria: {n}. Po ostatniej nieobecności dopiero zaczynasz od nowa.", "Streak: {n}. After the last absence you're only starting again."), W("{nt} od ostatniej nieobecności. Słabo.", "{nt} since the last absence. Weak.")] },
      { at: 0, lvl: "zle", w: 62, t: [W("Seria 0 — ostatni trening opuszczony. Następny jest obowiązkowy.", "Streak 0 — the last session was missed. The next one is compulsory."), W("Ostatni trening bez ciebie. Nie rób z tego dwóch.", "The last session went without you. Don't make it two.")] },
    ], { n: V(A.streak), nt: TR(A.streak) }, `${A.streak}|${A.today}`);
    if (A.absentRun >= 2) ladder(out, "att-run", "att", A.absentRun, false, [
      { at: 2, lvl: "popraw", w: 50, t: [W("W ostatnich 4 tygodniach były 2 opuszczone treningi pod rząd.", "In the last 4 weeks there were 2 missed sessions in a row."), W("Dwa treningi z rzędu bez ciebie. Trzeci byłby już przerwą.", "Two sessions in a row without you. A third would be a break.")] },
      { at: 3, lvl: "zle", w: 70, t: [W("3 opuszczone treningi z rzędu w ostatnim miesiącu.", "3 missed sessions in a row in the last month."), W("Przerwa 3 treningów pod rząd — po niej wracasz słabszy.", "A gap of 3 sessions in a row — you come back weaker.")] },
      { at: 100, lvl: "zle", w: 86, t: [W("Przerwa: {nt} z rzędu. Po takiej przerwie wracanie trwa dłużej niż sama przerwa.", "A gap of {nt} in a row. Coming back takes longer than the gap itself."), W("{n} nieobecności pod rząd w ostatnich 4 tygodniach. To była przerwa, nie pech.", "{n} absences in a row in the last 4 weeks. That was a break, not bad luck.")] },
    ], { n: V(A.absentRun), nt: TR(A.absentRun) });
    if (A.sincePresent != null && A.sincePresent >= 4) ladder(out, "att-since", "att", A.sincePresent, false, [
      { at: 6, lvl: "popraw", w: 46, t: [W("Od ostatniego treningu minęło {d} dni.", "{d} days since your last session."), W("{d} dni bez treningu. Jutro basen.", "{d} days without training. Pool tomorrow.")] },
      { at: 13, lvl: "zle", w: 76, t: [W("{d} dni bez treningu. Forma już ucieka.", "{d} days without training. Fitness is already slipping."), W("Ostatni trening {d} dni temu. Każdy kolejny dzień kosztuje.", "Last session {d} days ago. Every extra day costs.")] },
      { at: 1000, lvl: "zle", w: 92, t: [W("{d} dni bez treningu — to przerwa. Wracaj od razu, spokojnie, bez rekordów na pierwszym treningu.", "{d} days without training — that's a break. Come back now, easy, no records on the first session."), W("Ponad dwa tygodnie poza wodą ({d} dni).", "Over two weeks out of the water ({d} days).")] },
    ], { d: V(A.sincePresent) });
    // the weekday missed most often (at least 3 planned and 2 missed)
    const DOWPL = ["poniedziałki", "wtorki", "środy", "czwartki", "piątki", "soboty", "niedziele"], DOWEN = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
    const dows = Object.entries(A.byDow || {}).filter(([, b]) => b.planned >= 3 && b.absent >= 2).map(([w, b]) => ({ w: +w, r: b.absent / b.planned, b })).sort((a, b) => b.r - a.r || b.b.absent - a.b.absent);
    if (dows.length && dows[0].r >= 0.3) {
      const x = dows[0], vars = { d: W(DOWPL[x.w - 1], DOWEN[x.w - 1]), a: V(x.b.absent), y: V(x.b.planned), r: V(x.r * 100), yt: TR(x.b.planned) };
      ladder(out, "att-dow", "att", x.r * 100, false, [
        { at: 40, lvl: "popraw", w: 36, t: [W("Najczęściej opuszczasz {d}: {a} z {y}. Sprawdź, co wtedy koliduje z treningiem.", "You miss {d} most often: {a} of {y}. Check what clashes with training then."),
          W("{d} to twój najsłabszy dzień — nieobecności: {a} na {yt}.", "{d} are your weakest day — {a} absences in {yt}.")] },
        { at: 60, lvl: "zle", w: 52, t: [W("{d}: opuszczone {a} z {y} ({r}%). Ten dzień trzeba przeorganizować — np. uczyć się dzień wcześniej.", "{d}: {a} of {y} missed ({r}%). That day needs reorganising — e.g. study the day before."),
          W("W {d} nie ma cię na co drugim treningu ({a} z {y}). To już stały wzór, nie przypadek.", "On {d} you miss every second session ({a} of {y}). That's a pattern, not chance.")] },
        { at: 101, lvl: "zle", w: 66, t: [W("{d} praktycznie odpuszczasz: {a} z {y} opuszczonych ({r}%).", "You practically skip {d}: {a} of {y} missed ({r}%)."),
          W("{d}: {r}% nieobecności. Albo zmień plan nauki, albo powiedz trenerowi, że wtedy nie trenujesz.", "{d}: {r}% absences. Either change your study plan or tell your coach you don't train then.")] },
      ], vars, `${x.w}|${x.b.absent}/${x.b.planned}`);
    }
    // absences on the day of a school test or the day before (school tests from Szkoła and the calendar)
    if (D.exams && D.exams.length && (A.absentDays || []).length >= 3) {
      const ex = new Set(D.exams), hit = A.absentDays.filter(k => ex.has(k) || ex.has(ST.addDays(k, 1))).length, part = hit / A.absentDays.length * 100;
      if (hit >= 2) ladder(out, "att-exams", "att", part, true, [
        { at: 50, lvl: "zle", w: 62, t: [W("{h} z {n} nieobecności wypadło w dniu sprawdzianu albo dzień przed nim. Nauka wypiera basen — ucz się wcześniej, nie w ostatni wieczór.", "{h} of {n} absences fell on a test day or the day before. School pushes the pool out — study earlier, not on the last evening."),
          W("Większość opuszczonych treningów ({h} z {n}) to dni przed sprawdzianami. Zaplanuj naukę 2–3 dni wcześniej.", "Most missed sessions ({h} of {n}) are days before tests. Plan studying 2–3 days earlier.")] },
        { at: 25, lvl: "popraw", w: 40, t: [W("{h} z {n} nieobecności przy sprawdzianach (w dniu albo dzień przed). Część z nich dało się uratować wcześniejszą nauką.", "{h} of {n} absences around tests (that day or the day before). Some could be saved by studying earlier."),
          W("{h} z {n} opuszczonych treningów to dni sprawdzianów albo dni przed nimi. Ucz się wcześniej, a basen zostanie.", "{h} of {n} missed sessions are test days or the days before them. Study earlier and the pool stays.")] },
        { at: 0, lvl: "popraw", w: 20, t: [W("Tylko {h} z {n} nieobecności przy sprawdzianach — reszta ma inne powody.", "Only {h} of {n} absences around tests — the rest have other reasons.")] },
      ], { h: V(hit), n: V(A.absentDays.length) }, `${hit}/${A.absentDays.length}`);
    }
    // the distance lost: absences in the period × the average training
    const sw = D.trainings.filter(t => t.swim && t.dist && ST.dayKey(t.date) >= s.start && ST.dayKey(t.date) <= D.today);
    if (s.absent >= 2 && sw.length >= 3) {
      const lost = s.absent * ST.mean(sw.map(t => t.dist)), U = D.units, km = U.d(lost) / 1000, vars = { a: V(s.absent), k: V(km, 1), per, u: W(U.u() === "yd" ? "tys. yd" : "km", U.u() === "yd" ? "k yd" : "km"), h: V(s.absent * ST.mean(sw.map(t => t.total || t.moving || 0)) / 3600, 1) };
      ladder(out, "att-lost", "att", km, false, [
        { at: 6, lvl: "popraw", w: 30, t: [W("{a} nieobecności {per} to około {k} {u} pływania mniej.", "{a} absences {per} is about {k} {u} less swimming."), W("Przez opuszczone treningi {per} brakuje ok. {k} {u} w wodzie.", "Missed sessions {per} cost about {k} {u} in the water.")] },
        { at: 20, lvl: "zle", w: 48, t: [W("Opuszczone treningi {per}: {a}, czyli ok. {k} {u} i {h} h w wodzie, których już nie odzyskasz.", "Missed sessions {per}: {a}, about {k} {u} and {h} h in the water you won't get back."),
          W("{a} nieobecności = ok. {k} {u} mniej. To kilka tygodni treningu.", "{a} absences = about {k} {u} less. That's weeks of training.")] },
        { at: 1e9, lvl: "zle", w: 64, t: [W("Przez {a} nieobecności {per} straciłeś ok. {k} {u} pływania ({h} h). Tego nie nadrobi żaden jeden mocny trening.", "{a} absences {per} cost you about {k} {u} of swimming ({h} h). No single hard session makes that up."),
          W("Ok. {k} {u} w plecy przez opuszczone treningi. Tyle pływa się przez cały miesiąc.", "About {k} {u} lost to missed sessions. That's a whole month of swimming.")] },
      ], vars, `${s.absent}|${Math.round(km * 10)}`);
    }
    // the rest of the period at this rate
    if (A.remaining >= 8 && s.planned >= 8 && s.pct < 95) {
      const miss = Math.round(A.remaining * (1 - s.pct / 100));
      say(out, "att-ahead", "att", miss >= 20 ? "zle" : "popraw", miss >= 20 ? 54 : 30,
        [W("Jeśli tak zostanie ({p}%), do końca {e} opuścisz jeszcze ok. {m} z {r} treningów.", "If it stays like this ({p}%), you'll miss about {m} of the {r} sessions left until the end of {e}."),
          W("Przy {p}% frekwencji z {r} pozostałych treningów przepadnie ok. {m}. Ta liczba jest jeszcze w twoich rękach.", "At {p}% attendance about {m} of the {r} sessions left will be lost. That number is still in your hands.")],
        { p: V(s.pct), m: V(miss), r: V(A.remaining), e: s.kind === "wakacje" ? W("wakacji", "the holidays") : W("roku szkolnego", "the school year") }, `${miss}|${A.remaining}`);
    }
    if (s.skipped >= 4) say(out, "att-skips", "att", "popraw", 22, [W("Dni pominięte {per} (choroba, wyjazd): {n}. Nie psują frekwencji, ale treningu też nie było.", "Skipped days {per} (illness, away): {n}. They don't hurt the percentage, but there was no training either.")], { per, n: V(s.skipped) }, String(s.skipped));
    if (s.marked >= 3) say(out, "att-marked", "att", "popraw", 24, [W("Sam zaznaczyłeś {n} nieobecności {per}. Wiesz najlepiej, ile ich było.", "You marked {n} absences yourself {per}. You know best how many there were.")], { per, n: V(s.marked) }, String(s.marked));
    if (A.until && ST.daysBetween(A.until, D.today) >= 4 && A.last14.unknown > 0)
      say(out, "att-stale", "data", "popraw", 44, [W("Ostatnie dane z Garmina są z {d}. Bez nowego eksportu ocena frekwencji i formy jest niepełna.", "The newest Garmin data is from {d}. Without a new export the attendance and form ratings are incomplete.")], { d: DT(A.until) }, A.until);
    // what an absence costs: after a break against regular training
    const ab = ST.afterBreak(D.trainings);
    if (ab) {
      if (ab.effRel != null) ladder(out, "att-cost-eff", "att", ab.effRel * 100, false, [
        { at: -6, lvl: "zle", w: 68, t: [W("Po przerwie ≥ 4 dni twoja efektywność jest średnio o {x}% niższa niż przy regularnych treningach. Opuszczanie kosztuje formę.", "After a break of 4+ days your efficiency is {x}% lower on average than when you train regularly. Missing sessions costs fitness."),
          W("Liczby nie kłamią: po dłuższej przerwie efektywność spada o {x}%.", "The numbers don't lie: after a longer break efficiency drops by {x}%.")] },
        { at: -2, lvl: "popraw", w: 40, t: [W("Po przerwach pływasz o {x}% mniej efektywnie. Mały, ale stały koszt nieobecności.", "After breaks you swim {x}% less efficiently. A small but steady cost of absences."),
          W("Efektywność po przerwie: −{x}%. Regularność to najprostszy sposób na lepszy wynik.", "Efficiency after a break: −{x}%. Consistency is the simplest way to a better result.")] },
        { at: 2, lvl: "popraw", w: 14, t: [W("Po przerwach efektywność prawie taka sama (różnica {x}%). Nie znaczy to, że przerwy nic nie kosztują — rekordy rosną z regularności.", "After breaks efficiency is almost the same ({x}% difference). That doesn't make breaks free — records come from consistency.")] },
        { at: 100, lvl: "popraw", w: 12, t: [W("Po przerwach efektywność nawet wyższa o {x}% — jesteś wypoczęty. Ale wypoczęty to nie to samo co silniejszy.", "After breaks efficiency is even {x}% higher — you're rested. Rested isn't the same as stronger.")] },
      ], { x: V(Math.abs(ab.effRel * 100), 1) });
      if (ab.paceD != null && ab.paceD >= 2) say(out, "att-cost-pace", "att", ab.paceD >= 4 ? "zle" : "popraw", ab.paceD >= 4 ? 60 : 38,
        [W("Po przerwie płyniesz średnio o {s} s/100 {u} wolniej.", "After a break you swim {s} s/100 {u} slower on average."), W("Przerwa = wolniej o {s} s na każde 100 {u}. Tyle kosztuje opuszczony trening.", "A break = {s} s slower per 100 {u}. That's what a missed session costs.")],
        { s: V(D.units.pace(ab.paceD), 1), u: W(D.units.u()) }, ab.paceD.toFixed(1));
    }
  }

  /* ================= volume and regularity ================= */
  function volume(out, D) {
    const wk = ST.weekly(D.trainings, D.today, 9), done = wk.slice(0, -1), cur = wk[wk.length - 1];
    const last4 = done.slice(-4), prev4 = done.slice(-8, -4);
    const km = a => a.reduce((x, w) => x + w.metres, 0) / a.length / 1000;
    if (last4.some(w => w.n)) {
      const k = km(last4), vars = { k: V(D.units.d(k * 1000) / 1000, 1), u: W(D.units.u() === "yd" ? "tys. yd" : "km", D.units.u() === "yd" ? "k yd" : "km") };
      ladder(out, "vol-week", "vol", k, true, [
        { at: 20, lvl: "dobrze", w: 6, t: [W("Średnio {k} {u} tygodniowo w ostatnim miesiącu. Mocna objętość.", "{k} {u} a week on average over the last month. Strong volume."), W("{k} {u} na tydzień — tyle pływa ktoś, kto chce wyników.", "{k} {u} a week — that's what someone after results swims.")] },
        { at: 15, lvl: "dobrze", w: 12, t: [W("Średnio {k} {u} tygodniowo. Dobra objętość, jest z czego budować.", "{k} {u} a week on average. Good volume to build on."), W("{k} {u} na tydzień. Solidnie.", "{k} {u} a week. Solid.")] },
        { at: 12, lvl: "popraw", w: 28, t: [W("Średnio {k} {u} tygodniowo. Średnio — na rekordy przydałoby się więcej.", "{k} {u} a week on average. Average — records need more."), W("{k} {u} na tydzień. Przyzwoicie, ale bez zapasu.", "{k} {u} a week. Decent, no margin.")] },
        { at: 9, lvl: "popraw", w: 42, t: [W("Tylko {k} {u} tygodniowo. Za mało jak na zawodnika klubowego.", "Only {k} {u} a week. Too little for a club swimmer."), W("{k} {u} na tydzień — objętość rekreacyjna, nie zawodnicza.", "{k} {u} a week — recreational volume, not a racer's.")] },
        { at: 6, lvl: "zle", w: 58, t: [W("Średnio {k} {u} tygodniowo. Tyle nie wystarczy, żeby się poprawiać.", "{k} {u} a week on average. Not enough to keep improving."), W("{k} {u} na tydzień. To dwa, trzy treningi — za mało.", "{k} {u} a week. That's two or three sessions — too few.")] },
        { at: 3, lvl: "zle", w: 72, t: [W("Średnio {k} {u} tygodniowo. Bardzo mało.", "{k} {u} a week on average. Very little."), W("{k} {u} na tydzień — przy takiej objętości forma spada.", "{k} {u} a week — at this volume fitness goes down.")] },
        { at: 0, lvl: "zle", w: 88, t: [W("Ostatni miesiąc: średnio {k} {u} tygodniowo. Praktycznie przerwa.", "The last month: {k} {u} a week on average. Practically a break."), W("{k} {u} na tydzień. Tego nie da się nazwać treningiem.", "{k} {u} a week. You can't call that training.")] },
      ], vars);
      if (prev4.some(w => w.n)) {
        const p = km(prev4), rel = p ? (k - p) / p * 100 : null;
        if (rel != null) ladder(out, "vol-trend", "vol", rel, true, [
          { at: 25, lvl: "popraw", w: 24, t: [W("Objętość skoczyła o {x}% (miesiąc do miesiąca). Dobrze, że więcej, ale tak szybki wzrost to ryzyko dla barków.", "Volume jumped {x}% (month to month). More is good, but that fast is a risk for the shoulders."), W("+{x}% kilometrów w miesiąc. Za szybko — barki nie lubią skoków.", "+{x}% distance in a month. Too fast — shoulders don't like jumps.")] },
          { at: 8, lvl: "dobrze", w: 8, t: [W("Objętość rośnie: +{x}% wobec poprzednich 4 tygodni.", "Volume growing: +{x}% vs the previous 4 weeks."), W("+{x}% kilometrów w miesiąc. Tak ma rosnąć.", "+{x}% distance in a month. That's how it should grow.")] },
          { at: -8, lvl: "popraw", w: 26, t: [W("Objętość stoi ({s}{x}% wobec poprzedniego miesiąca).", "Volume flat ({s}{x}% vs the previous month)."), W("Kilometry bez zmian od miesiąca. Bez wzrostu nie ma postępu.", "Distance unchanged for a month. No growth, no progress.")] },
          { at: -25, lvl: "zle", w: 52, t: [W("Objętość spadła o {x}% wobec poprzednich 4 tygodni.", "Volume down {x}% vs the previous 4 weeks."), W("−{x}% kilometrów w miesiąc. Forma pójdzie za tym.", "−{x}% distance in a month. Fitness will follow.")] },
          { at: -100, lvl: "zle", w: 70, t: [W("Objętość spadła aż o {x}%. To nie jest odpoczynek przed zawodami, tylko odpuszczanie.", "Volume dropped by {x}%. That's not a taper, that's slacking."), W("Kilometrów o {x}% mniej niż miesiąc wcześniej.", "{x}% less distance than a month earlier.")] },
        ], { x: V(Math.abs(rel)), s: W(rel < 0 ? "−" : "+") });
      }
      const dow = (ST.parseDay(D.today).getDay() + 6) % 7;
      if (dow >= 3 && k > 0) {
        const c = cur.metres / 1000 / k;
        if (c < 0.4) say(out, "vol-thisweek", "vol", c < 0.15 ? "zle" : "popraw", c < 0.15 ? 54 : 34, [W("Ten tydzień: dopiero {a} {u} ({p}% zwykłego tygodnia), a już {d}.", "This week: only {a} {u} ({p}% of a usual week), and it's already {d}.")],
          { a: V(D.units.d(cur.metres) / 1000, 1), u: W(D.units.u() === "yd" ? "tys. yd" : "km", D.units.u() === "yd" ? "k yd" : "km"), p: V(c * 100), d: W(["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"][dow], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][dow]) }, `${cur.metres}|${D.today}`);
      }
    }
    const L = D.trainings.filter(t => t.swim && t.dist).slice(-10);
    if (L.length >= 4) {
      const a = ST.mean(L.map(t => t.dist));
      ladder(out, "vol-session", "vol", a, true, [
        { at: 4000, lvl: "dobrze", w: 6, t: [W("Średni trening: {m}. Pełne treningi.", "Average session: {m}. Full sessions."), W("Na trening wychodzi średnio {m}. Tak ma być.", "{m} per session on average. That's how it should be.")] },
        { at: 3000, lvl: "popraw", w: 20, t: [W("Średni trening: {m}. Przyzwoicie, ale bez rezerwy.", "Average session: {m}. Decent, no reserve."), W("{m} na trening. Na zawody długodystansowe to mało.", "{m} per session. Little for distance races.")] },
        { at: 2000, lvl: "zle", w: 44, t: [W("Średni trening to tylko {m}. Krótko.", "The average session is only {m}. Short."), W("{m} na trening — wychodzisz za wcześnie albo za dużo stoisz.", "{m} per session — you leave too early or rest too much.")] },
        { at: 0, lvl: "zle", w: 60, t: [W("Średni trening: {m}. To rozgrzewka, nie trening.", "Average session: {m}. That's a warm-up, not training."), W("{m} na trening — za krótko, żeby cokolwiek zbudować.", "{m} per session — too short to build anything.")] },
      ], { m: W(`${Math.round(D.units.d(a)).toLocaleString("pl-PL")} ${D.units.u()}`, `${Math.round(D.units.d(a)).toLocaleString("en-GB")} ${D.units.u()}`) });
    }
    const R = ST.regularity(D.trainings, D.today, 60);
    if (R.n >= 3 && R.avgGap != null) ladder(out, "reg-gap", "reg", R.avgGap, false, [
      { at: 1.4, lvl: "dobrze", w: 6, t: [W("Pływasz średnio co {g} dnia. Regularnie.", "You swim every {g} days on average. Regular."), W("Co {g} dnia w wodzie. Tak wygląda regularność.", "In the water every {g} days. That's what consistency looks like.")] },
      { at: 1.9, lvl: "popraw", w: 22, t: [W("Średnio co {g} dnia w ostatnich 2 miesiącach. Prawie co drugi dzień — da się częściej.", "Every {g} days on average over the last 2 months. Almost every other day — you can do more."), W("Trening średnio co {g} dnia. Blisko, ale jeszcze nie codziennie.", "A session every {g} days on average. Close, but not daily yet.")] },
      { at: 2.6, lvl: "popraw", w: 38, t: [W("Średnio co {g} dnia. Za rzadko, żeby budować wytrzymałość.", "Every {g} days on average. Too rarely to build endurance."), W("Między treningami średnio {g} dnia — ciało zdąży zapomnieć.", "{g} days between sessions on average — the body has time to forget.")] },
      { at: 3.5, lvl: "zle", w: 56, t: [W("Pływasz średnio co {g} dnia. To za rzadko.", "You swim every {g} days on average. Too rarely."), W("Średnio {g} dnia przerwy. Bez częstszych treningów nie będzie postępu.", "{g} days between sessions on average. No progress without more frequent training.")] },
      { at: 100, lvl: "zle", w: 74, t: [W("Średnio {g} dnia między treningami. Przy takiej częstotliwości forma nie rośnie.", "{g} days between sessions on average. Fitness can't grow at this frequency."), W("Przerwy między treningami średnio {g} dnia — więcej odpoczynku niż pływania.", "{g} days between sessions on average — more rest than swimming.")] },
    ], { g: V(R.avgGap, 1) });
    if (R.n >= 2 && R.longest >= 5) ladder(out, "reg-longest", "reg", R.longest, false, [
      { at: 6, lvl: "popraw", w: 30, t: [W("Najdłuższa przerwa w 2 miesiące: {d} dni.", "The longest gap in 2 months: {d} days."), W("Była przerwa {d} dni. Pilnuj, żeby się nie powtórzyła.", "There was a {d}-day gap. Make sure it doesn't happen again.")] },
      { at: 9, lvl: "zle", w: 50, t: [W("Przerwa {d} dni w ostatnich 2 miesiącach. Za długa.", "A gap of {d} days in the last 2 months. Too long."), W("Najdłużej bez wody: {d} dni.", "Longest out of the water: {d} days.")] },
      { at: 1000, lvl: "zle", w: 66, t: [W("Była przerwa aż {d} dni. Po czymś takim trzeba odbudowywać formę.", "There was a gap of {d} days. After that you rebuild fitness."), W("{d} dni bez pływania w ostatnich 2 miesiącach.", "{d} days without swimming in the last 2 months.")] },
    ], { d: V(R.longest) });
  }

  // rests: their share of the time in the FIT files of the last 4 weeks
  function rests(out, D) {
    let rest = 0, all = 0, n = 0;
    for (const t of D.trainings) {
      if (!t.swim || !t.fit || ST.dayKey(t.date) <= ST.addDays(D.today, -28)) continue;
      n++; for (const l of t.fit.lengths) { all += l.t; if (l.s === "idle") rest += l.t; }
    }
    if (n < 3 || !all) return;
    ladder(out, "rest-share", "train", rest / all * 100, false, [
      { at: 15, lvl: "dobrze", w: 4, t: [W("Przerwy to tylko {x}% czasu na treningach (4 tygodnie). Gęsta praca.", "Rests are only {x}% of your training time (4 weeks). Dense work.")] },
      { at: 22, lvl: "popraw", w: 14, t: [W("Przerwy to {x}% czasu na treningach. W porządku, ale da się mniej.", "Rests are {x}% of training time. OK, but could be less."), W("{x}% czasu przy ścianie w ostatnich 4 tygodniach.", "{x}% of the time at the wall in the last 4 weeks.")] },
      { at: 30, lvl: "popraw", w: 26, t: [W("Przerwy zabierają {x}% czasu treningów. Skróć je o kilka sekund.", "Rests take {x}% of training time. Cut them by a few seconds."), W("{x}% przerw na treningach — sporo stania.", "{x}% rest in sessions — a lot of standing.")] },
      { at: 40, lvl: "zle", w: 38, t: [W("Prawie jedna trzecia treningu to przerwy ({x}%).", "Almost a third of training is rest ({x}%)."), W("{x}% czasu stoisz. Tak trening robi się krótszy, niż wygląda.", "You stand {x}% of the time. That makes a session shorter than it looks.")] },
      { at: 101, lvl: "zle", w: 50, t: [W("{x}% czasu na treningach to przerwy. Więcej stoisz, niż pływasz w tempie.", "{x}% of training time is rest. You stand more than you swim at pace.")] },
    ], { x: V(rest / all * 100) });
  }

  /* ================= pace, efficiency, SWOLF ================= */
  function pace(out, D) {
    const U = D.units, u = W(U.u());
    const tp = ST.trend(D.trainings, "pace");
    if (tp) ladder(out, "pace-trend", "pace", U.pace(tp.d), false, [
      { at: -4, lvl: "dobrze", w: 6, t: [W("Tempo: średnia z ostatnich {k} treningów szybsza o {s} s/100 {u} niż z {k} wcześniejszych. Wyraźny postęp.", "Pace: the last {k} sessions {s} s/100 {u} faster than the {k} before. Clear progress."), W("−{s} s na 100 {u} w {k} ostatnich treningach. Tak się idzie po rekordy.", "−{s} s per 100 {u} over the last {k} sessions. That's the road to records.")] },
      { at: -2, lvl: "dobrze", w: 10, t: [W("Tempo szybsze o {s} s/100 {u} w ostatnich {k} treningach. Dobrze.", "Pace {s} s/100 {u} faster (last {k} sessions). Good."), W("−{s} s na 100 {u} w ostatnich treningach. Tak trzymaj.", "−{s} s per 100 {u} in recent sessions. Keep it up.")] },
      { at: -0.6, lvl: "popraw", w: 22, t: [W("Tempo lekko lepsze (−{s} s/100 {u}). Mało.", "Pace slightly better (−{s} s/100 {u}). Not much."), W("Poprawa tempa o {s} s/100 {u} — w granicach przypadku.", "Pace up by {s} s/100 {u} — within chance.")] },
      { at: 0.6, lvl: "popraw", w: 34, t: [W("Tempo stoi w miejscu ({d} s/100 {u} różnicy).", "Pace standing still ({d} s/100 {u} difference)."), W("Od {k} treningów to samo tempo. Bez nowego bodźca nie ruszy.", "Same pace for {k} sessions. It won't move without a new stimulus.")] },
      { at: 2, lvl: "zle", w: 46, t: [W("Tempo gorsze o {s} s/100 {u} w ostatnich {k} treningach.", "Pace {s} s/100 {u} slower in the last {k} sessions."), W("Wolniej o {s} s na 100 {u}. Sprawdź frekwencję i sen.", "{s} s per 100 {u} slower. Check attendance and sleep.")] },
      { at: 4, lvl: "zle", w: 60, t: [W("Tempo spadło o {s} s/100 {u}. To już wyraźny regres.", "Pace dropped by {s} s/100 {u}. That's a clear step back."), W("Wolniej o {s} s na każde 100 {u}. Najpierw sprawdź frekwencję.", "{s} s slower per 100 {u}. Check your attendance first.")] },
      { at: 1000, lvl: "zle", w: 72, t: [W("Tempo gorsze aż o {s} s/100 {u} niż wcześniej. Forma się sypie.", "Pace {s} s/100 {u} slower than before. Form is falling apart."), W("+{s} s/100 {u}. Takiego spadku nie robi jeden zły dzień.", "+{s} s/100 {u}. One bad day doesn't do that.")] },
    ], { k: V(tp.k), s: V(Math.abs(U.pace(tp.d)), 1), d: V(U.pace(tp.d), 1), u });
    const L = D.trainings.filter(t => t.swim);
    const withP = L.filter(t => t.pace != null && (t.dist || 0) >= 500);
    if (withP.length >= 3) {
      const best = withP.reduce((b, t) => (t.pace < b.pace ? t : b)), days = Math.max(0, ST.daysBetween(ST.dayKey(best.date), D.today));
      ladder(out, "pace-best", "pace", days, false, [
        { at: 14, lvl: "dobrze", w: 5, t: [W("Najszybszy trening (od 500 {u}): {ago}, {p}/100 {u}.", "Your fastest session (500 {u}+): {ago}, {p}/100 {u}."), W("Najszybszy trening był {ago} ({p}/100 {u}). Forma jest.", "Your fastest session was {ago} ({p}/100 {u}). The form is there.")] },
        { at: 45, lvl: "popraw", w: 20, t: [W("Najszybszy trening był {d} dni temu ({p}/100 {u}). Czas go poprawić.", "Your fastest session was {d} days ago ({p}/100 {u}). Time to beat it."), W("Od {d} dni nie było szybszego treningu niż {p}/100 {u}.", "No session faster than {p}/100 {u} for {d} days.")] },
        { at: 90, lvl: "zle", w: 38, t: [W("Od najszybszego treningu minęło {d} dni. Od półtora miesiąca nie płyniesz szybciej.", "{d} days since your fastest session. No faster for over six weeks."), W("Najszybszy trening ({p}/100 {u}) był {d} dni temu. Od tamtej pory bez postępu.", "Your fastest session ({p}/100 {u}) was {d} days ago. No progress since.")] },
        { at: 100000, lvl: "zle", w: 48, t: [W("Najszybszy trening był {d} dni temu. Od ponad 3 miesięcy bez postępu w tempie.", "Your fastest session was {d} days ago. No pace progress for over 3 months."), W("{d} dni bez szybszego treningu. To nie zastój — to cofanie się.", "{d} days without a faster session. That's not a plateau — it's going backwards.")] },
      ], { d: V(days), ago: AGO(days), p: P(U.pace(best.pace)), u });
    }
    const te = ST.trend(D.trainings, "eff");
    if (te && te.rel != null) ladder(out, "eff-trend", "eff", te.rel * 100, true, [
      { at: 5, lvl: "dobrze", w: 6, t: [W("Efektywność w górę o {x}% w ostatnich {k} treningach. Pływasz dalej na każde uderzenie serca.", "Efficiency up {x}% (last {k} sessions). More distance per heartbeat."), W("+{x}% efektywności. Mniej wysiłku na ten sam dystans.", "+{x}% efficiency. Less effort for the same distance.")] },
      { at: 2, lvl: "dobrze", w: 12, t: [W("Efektywność +{x}%. Idzie dobrze.", "Efficiency +{x}%. Going well."), W("Efektywność lekko w górę (+{x}%). Utrzymaj regularność, to urośnie.", "Efficiency slightly up (+{x}%). Stay consistent and it will grow.")] },
      { at: -1, lvl: "popraw", w: 30, t: [W("Efektywność bez zmian ({s}{x}%).", "Efficiency unchanged ({s}{x}%)."), W("Efektywność stoi. Sama objętość już nie wystarcza — potrzebna technika.", "Efficiency flat. Volume alone isn't enough any more — technique is needed.")] },
      { at: -4, lvl: "zle", w: 46, t: [W("Efektywność spada: −{x}%.", "Efficiency falling: −{x}%."), W("−{x}% efektywności. Męczysz się bardziej przy tym samym tempie.", "−{x}% efficiency. You work harder for the same pace.")] },
      { at: -100, lvl: "zle", w: 62, t: [W("Efektywność spadła o {x}%. Zmęczenie albo przerwy — coś tu nie gra.", "Efficiency down {x}%. Fatigue or breaks — something's wrong."), W("−{x}% efektywności w ostatnich {k} treningach. Tak wygląda forma po opuszczonych treningach.", "−{x}% efficiency over {k} sessions. That's what form looks like after missed sessions.")] },
    ], { x: V(Math.abs(te.rel * 100), 1), k: V(te.k), s: W(te.rel < 0 ? "−" : "+") });
    const withE = L.filter(t => t.eff != null);
    if (withE.length >= 3) {
      const best = Math.max(...withE.map(t => t.eff)), last = withE[withE.length - 1].eff, r = last / best * 100;
      ladder(out, "eff-best", "eff", r, true, [
        { at: 99.5, lvl: "dobrze", w: 4, t: [W("Ostatni trening to twoja najlepsza efektywność.", "Your last session was your best efficiency."), W("Rekord efektywności na ostatnim treningu.", "An efficiency record in your last session.")] },
        { at: 96, lvl: "dobrze", w: 10, t: [W("Ostatni trening: {r}% twojej najlepszej efektywności.", "Last session: {r}% of your best efficiency."), W("Ostatnio {r}% najlepszej efektywności — blisko swojego maksimum.", "Last time {r}% of your best efficiency — close to your maximum.")] },
        { at: 92, lvl: "popraw", w: 24, t: [W("Ostatni trening: {r}% najlepszej efektywności. Brakuje kilku procent.", "Last session: {r}% of your best efficiency. A few percent missing."), W("{r}% najlepszej efektywności. Do swojego poziomu brakuje kilku procent.", "{r}% of your best efficiency. A few percent short of your level.")] },
        { at: 85, lvl: "zle", w: 40, t: [W("Ostatni trening tylko {r}% najlepszej efektywności.", "Last session only {r}% of your best efficiency."), W("Ostatnio tylko {r}% twojej najlepszej efektywności. Wyraźnie poniżej formy.", "Only {r}% of your best efficiency last time. Clearly below form.")] },
        { at: 0, lvl: "zle", w: 52, t: [W("Ostatni trening: {r}% najlepszej efektywności. Daleko od swojego poziomu.", "Last session: {r}% of your best efficiency. Far below your level."), W("{r}% najlepszej efektywności. Tak pływa ktoś po przerwie, nie w treningu.", "{r}% of your best efficiency. That's how someone swims after a break, not in training.")] },
      ], { r: V(r) });
    }
    const ts = ST.trend(D.trainings, "swolf");
    if (ts) ladder(out, "swolf-trend", "swolf", ts.d, false, [
      { at: -1.5, lvl: "dobrze", w: 8, t: [W("SWOLF niższy o {x} — mniej ruchów albo szybciej. Dobrze.", "SWOLF lower by {x} — fewer strokes or faster. Good."), W("SWOLF −{x}. Technika i tempo idą razem w dobrą stronę.", "SWOLF −{x}. Technique and pace moving the right way together.")] },
      { at: -0.5, lvl: "popraw", w: 20, t: [W("SWOLF minimalnie lepszy (−{x}).", "SWOLF slightly better (−{x})."), W("SWOLF lepszy tylko o {x}. Za mało, żeby mówić o postępie.", "SWOLF better by only {x}. Too little to call progress.")] },
      { at: 0.5, lvl: "popraw", w: 30, t: [W("SWOLF stoi ({d}). Technika się nie zmienia.", "SWOLF flat ({d}). Technique isn't changing."), W("SWOLF bez zmian. Pływasz tak samo jak kilka treningów temu.", "SWOLF unchanged. You swim the same as a few sessions ago.")] },
      { at: 1.5, lvl: "zle", w: 42, t: [W("SWOLF gorszy o {x}. Więcej ruchów albo wolniej.", "SWOLF worse by {x}. More strokes or slower."), W("SWOLF +{x}. Ruch się skraca albo zwalniasz.", "SWOLF +{x}. The stroke is shortening or you're slowing down.")] },
      { at: 100, lvl: "zle", w: 56, t: [W("SWOLF wyraźnie gorszy (+{x}). Technika się rozjeżdża.", "SWOLF clearly worse (+{x}). Technique is slipping."), W("SWOLF wyższy aż o {x}. Najpierw technika, potem tempo.", "SWOLF up by {x}. Technique first, then pace.")] },
    ], { x: V(Math.abs(ts.d), 1), d: V(ts.d, 1) });
  }

  /* ================= heart rate, CSS, load ================= */
  function heart(out, D) {
    if (!D.hrMax) { say(out, "hr-max", "data", "popraw", 26, [W("Nie znam twojego tętna maksymalnego — ustaw je w Analizie, inaczej strefy i obciążenie są tylko szacunkiem.", "I don't know your maximum heart rate — set it in Analiza, otherwise zones and load are only estimates.")]); return; }
    if (D.hrMaxFrom === "auto") say(out, "hr-auto", "data", "popraw", 12, [W("Tętno maksymalne {h} biorę z twoich treningów. Wpisz prawdziwe (z testu), żeby strefy były dokładne.", "I take your maximum heart rate ({h}) from your sessions. Enter the real one (from a test) for exact zones.")], { h: V(D.hrMax) }, String(D.hrMax));
    const Z = ST.zonesOver(D.trainings, D.hrMax, ST.addDays(D.today, -27), D.today);
    if (!Z) { say(out, "hr-none", "data", "popraw", 32, [W("Brak tętna w treningach z ostatnich 4 tygodni — bez tego nie ocenię intensywności.", "No heart rate in the last 4 weeks of sessions — I can't rate intensity without it.")]); return; }
    const hard = (Z.share[3] + Z.share[4]) * 100, easy = (Z.share[0] + Z.share[1]) * 100, z1 = Z.share[0] * 100;
    const vars = { h: V(hard), e: V(easy), z1: V(z1), n: V(Z.n) };
    ladder(out, "hr-hard", "hr", hard, true, [
      { at: 45, lvl: "zle", w: 50, t: [W("{h}% czasu w Z4–Z5 (ostatnie 4 tygodnie). Za mocno za często — tak łapie się przemęczenie.", "{h}% of the time in Z4–Z5 (last 4 weeks). Too hard too often — that's how you get worn out."), W("Aż {h}% czasu w Z4–Z5. Brakuje spokojnej pracy tlenowej — bez niej nie wytrzymasz końcówek.", "{h}% of the time in Z4–Z5. Easy aerobic work is missing — without it you won't last the finishes.")] },
      { at: 30, lvl: "popraw", w: 26, t: [W("Dużo mocnej pracy: {h}% w Z4–Z5. Pilnuj snu i regeneracji.", "Lots of hard work: {h}% in Z4–Z5. Watch your sleep and recovery."), W("{h}% w Z4–Z5 — sporo. Nie dokładaj, jeśli śpisz mało.", "{h}% in Z4–Z5 — a lot. Don't add more if you sleep little.")] },
      { at: 12, lvl: "dobrze", w: 8, t: [W("Intensywność rozsądna: {e}% spokojnie, {h}% mocno.", "Sensible intensity: {e}% easy, {h}% hard."), W("Dobre proporcje: {e}% w Z1–Z2, {h}% w Z4–Z5.", "Good balance: {e}% in Z1–Z2, {h}% in Z4–Z5.")] },
      { at: 5, lvl: "popraw", w: 34, t: [W("Mocnej pracy (Z4–Z5) tylko {h}%. Za mało, żeby szybciej płynąć.", "Only {h}% hard work (Z4–Z5). Too little to get faster."), W("{h}% w mocnych strefach. Dokładaj szybkie serie.", "{h}% in the hard zones. Add fast sets.")] },
      { at: 0, lvl: "zle", w: 48, t: [W("Prawie zero mocnej pracy ({h}% w Z4–Z5). Pływasz, ale nie trenujesz szybkości.", "Almost no hard work ({h}% in Z4–Z5). You swim, but don't train speed."), W("Bez mocnej pracy ({h}%) nie poprawisz rekordów.", "Without hard work ({h}%) you won't improve records.")] },
    ], vars);
    if (z1 > 55) say(out, "hr-z1", "hr", "popraw", 28, [W("{z1}% czasu w Z1 — za dużo stania i bardzo spokojnego pływania.", "{z1}% of the time in Z1 — too much standing and very easy swimming.")], vars, Math.round(z1));
    const rec = D.trainings.filter(t => t.swim && t.hrSwim && t.hrRest).slice(-5);
    if (rec.length >= 3) {
      const d = ST.mean(rec.map(t => t.hrSwim - t.hrRest));
      ladder(out, "hr-rest", "hr", d, true, [
        { at: 20, lvl: "dobrze", w: 4, t: [W("W przerwach tętno spada średnio o {d} ud./min — dobra regeneracja.", "In the rests your heart rate drops {d} bpm on average — good recovery."), W("Tętno w przerwach −{d} ud./min. Serce szybko odpoczywa.", "Heart rate in rests −{d} bpm. Your heart recovers fast.")] },
        { at: 10, lvl: "popraw", w: 16, t: [W("W przerwach tętno spada o {d} ud./min. Przeciętnie.", "In the rests your heart rate drops {d} bpm. Average."), W("Spadek tętna w przerwach: {d} ud./min. Mogłoby być lepiej.", "Heart-rate drop in rests: {d} bpm. Could be better.")] },
        { at: 0, lvl: "popraw", w: 28, t: [W("W przerwach tętno spada tylko o {d} ud./min — przerwy za krótkie albo słaba regeneracja.", "In the rests your heart rate drops only {d} bpm — rests too short or weak recovery."), W("Tylko −{d} ud./min w przerwach. Wytrzymałość tlenowa do budowania.", "Only −{d} bpm in rests. Aerobic endurance to build.")] },
      ], { d: V(d) });
    }
  }
  function css(out, D) {
    const C = D.css, U = D.units, u = W(U.u());
    if (!C) { say(out, "css-none", "css", "popraw", 30, [W("Nie znam twojego CSS. Zrób test: 400 m i 200 m kraulem na maksa (z przerwą), wpisz czasy w Analizie.", "I don't know your CSS. Do the test: 400 m and 200 m freestyle all-out (with a rest) and enter the times in Analiza.")]); return; }
    if (C.from === "estimate") say(out, "css-est", "css", "popraw", 22, [W("CSS {c}/100 {u} szacuję z treningów. Prawdziwy test (400 m + 200 m) da dokładniejszy wynik.", "I estimate your CSS at {c}/100 {u} from sessions. A real test (400 m + 200 m) gives a more exact one.")], { c: P(U.pace(C.css)), u }, Math.round(C.css));
    else {
      const age = Math.max(0, ST.daysBetween(C.date, D.today));
      ladder(out, "css-age", "css", age, false, [
        { at: 42, lvl: "dobrze", w: 3, t: [W("Test CSS aktualny ({ago}).", "CSS test up to date ({ago})."), W("CSS sprawdzony {ago} — aktualny.", "CSS checked {ago} — up to date.")] },
        { at: 63, lvl: "popraw", w: 20, t: [W("Ostatni test CSS {d} dni temu — powtórz w tym tygodniu.", "Last CSS test {d} days ago — redo it this week."), W("{d} dni od testu CSS. Czas na nowy.", "{d} days since the CSS test. Time for a new one.")] },
        { at: 120, lvl: "popraw", w: 32, t: [W("Test CSS ma {d} dni. Strefy tempa mogą już nie pasować.", "Your CSS test is {d} days old. Pace zones may be off."), W("CSS sprzed {d} dni. Nie trenuj według starych stref.", "CSS from {d} days ago. Don't train by old zones.")] },
        { at: 100000, lvl: "zle", w: 42, t: [W("Test CSS sprzed {d} dni — nieaktualny. Zrób nowy.", "CSS test from {d} days ago — out of date. Do a new one."), W("{d} dni bez testu CSS. Nie wiesz, na jakim jesteś poziomie.", "{d} days without a CSS test. You don't know your level.")] },
      ], { d: V(age), ago: AGO(age) });
    }
    ladder(out, "css-level", "css", C.css, false, [
      { at: 68, lvl: "dobrze", w: 4, t: [W("CSS {c}/100 m — bardzo mocny poziom.", "CSS {c}/100 m — a very strong level."), W("CSS {c}/100 m. Tu nie ma się do czego przyczepić.", "CSS {c}/100 m. Nothing to pick on here.")] },
      { at: 75, lvl: "dobrze", w: 8, t: [W("CSS {c}/100 m — mocny poziom klubowy.", "CSS {c}/100 m — a strong club level."), W("CSS {c}/100 m. Dobra wytrzymałość tempowa.", "CSS {c}/100 m. Good threshold endurance.")] },
      { at: 82, lvl: "popraw", w: 22, t: [W("CSS {c}/100 m — dobry, ale do czołówki brakuje.", "CSS {c}/100 m — good, but short of the top."), W("CSS {c}/100 m. Solidnie, ale bez przewagi.", "CSS {c}/100 m. Solid, without an edge.")] },
      { at: 90, lvl: "popraw", w: 34, t: [W("CSS {c}/100 m — przeciętnie. Wytrzymałość tempowa do budowania.", "CSS {c}/100 m — average. Threshold endurance to build."), W("CSS {c}/100 m. Średni poziom — serie w tempie CSS są dla ciebie obowiązkowe.", "CSS {c}/100 m. An average level — CSS-pace sets are a must for you.")] },
      { at: 100, lvl: "slabo", w: 46, t: [W("CSS {c}/100 m — słabo. To twoja słaba strona: wytrzymałość w tempie.", "CSS {c}/100 m — weak. That's your weak side: endurance at pace."), W("CSS {c}/100 m. Tu jesteś słaby — szybkość masz, wytrzymałości w tempie brakuje.", "CSS {c}/100 m. This is a weak spot — you have speed, not endurance at pace.")] },
      { at: 10000, lvl: "slabo", w: 58, t: [W("CSS {c}/100 m — bardzo słabo jak na zawodnika.", "CSS {c}/100 m — very weak for a racer."), W("CSS {c}/100 m. Bardzo słaba wytrzymałość tempowa.", "CSS {c}/100 m. Very weak threshold endurance.")] },
    ], { c: P(C.css) });
    const tests = (D.swim && D.swim.css) || [];
    if (tests.length >= 2) {
      const a = ST.cssOf(tests[tests.length - 2].t400, tests[tests.length - 2].t200), b = ST.cssOf(tests[tests.length - 1].t400, tests[tests.length - 1].t200), d = b - a;
      ladder(out, "css-change", "css", d, false, [
        { at: -2, lvl: "dobrze", w: 6, t: [W("CSS szybszy o {s} s od poprzedniego testu.", "CSS {s} s faster than the previous test."), W("Nowy test CSS: −{s} s/100 m. Postęp.", "New CSS test: −{s} s/100 m. Progress.")] },
        { at: -0.3, lvl: "popraw", w: 18, t: [W("CSS lepszy tylko o {s} s.", "CSS better by only {s} s."), W("Test CSS: lepiej o {s} s. Ledwo.", "CSS test: {s} s better. Barely.")] },
        { at: 0.5, lvl: "popraw", w: 30, t: [W("CSS bez zmian między testami.", "CSS unchanged between tests."), W("Dwa testy CSS, ten sam wynik. Trening nie działa tak, jak powinien.", "Two CSS tests, the same result. Training isn't working as it should.")] },
        { at: 1000, lvl: "zle", w: 46, t: [W("CSS wolniejszy o {s} s niż w poprzednim teście.", "CSS {s} s slower than in the previous test."), W("Test CSS gorszy o {s} s. Forma spadła.", "CSS test {s} s worse. Form has dropped.")] },
      ], { s: V(Math.abs(d), 1) });
    }
    let secs = [0, 0, 0, 0, 0], any = false;
    for (const t of D.trainings) { if (!t.swim || !t.fit || ST.dayKey(t.date) < ST.addDays(D.today, -27)) continue; const z = ST.paceZoneSecs(t.fit, C.css, D.bad); if (z) { any = true; z.forEach((s, i) => { secs[i] += s; }); } }
    if (any) {
      const tot = secs.reduce((a, b) => a + b, 0), fast = (secs[3] + secs[4]) / tot * 100;
      ladder(out, "css-fast", "css", fast, true, [
        { at: 25, lvl: "dobrze", w: 6, t: [W("{x}% kraula w tempie CSS lub szybciej — dobra dawka pracy progowej.", "{x}% of freestyle at CSS pace or faster — a good dose of threshold work."), W("Praca progowa jest: {x}% kraula w tempie CSS i szybciej.", "Threshold work is there: {x}% of freestyle at CSS and faster.")] },
        { at: 12, lvl: "popraw", w: 22, t: [W("{x}% kraula w tempie CSS lub szybciej. Mogłoby być więcej.", "{x}% of freestyle at CSS or faster. Could be more."), W("W tempie CSS i szybciej tylko {x}% kraula. Dołóż serię progową.", "Only {x}% of freestyle at CSS or faster. Add a threshold set.")] },
        { at: 5, lvl: "popraw", w: 34, t: [W("Tylko {x}% kraula w tempie CSS lub szybciej.", "Only {x}% of freestyle at CSS or faster."), W("{x}% kraula w tempie CSS — za mało, żeby próg się ruszył.", "{x}% of freestyle at CSS pace — too little to move your threshold.")] },
        { at: 0, lvl: "zle", w: 44, t: [W("Prawie nie pływasz w tempie CSS ({x}%). Bez tego próg nie ruszy.", "You hardly swim at CSS pace ({x}%). Your threshold won't move without it."), W("{x}% w tempie CSS. Pływasz za wolno, żeby się poprawiać.", "{x}% at CSS pace. You swim too slowly to improve.")] },
      ], { x: V(fast) });
    }
  }
  function load(out, D) {
    const L = ST.loadStats(D.trainings, D.hrMax, D.today);
    if (L.ratio == null || L.chronic < 30) return;
    const r = L.ratio, vars = { r: V(r, 2), a: V(L.acute), c: V(L.chronic) };
    ladder(out, "load-ratio", "load", r, false, [
      { at: 0.5, lvl: "zle", w: 58, t: [W("Ten tydzień to {r}× zwykłego obciążenia — prawie nic ({a} pkt przy średnio {c}).", "This week is {r}× your usual load — almost nothing ({a} pts vs {c} on average)."), W("Obciążenie ×{r}: ten tydzień prawie bez pracy.", "Load ×{r}: this week almost without work.")] },
      { at: 0.8, lvl: "popraw", w: 34, t: [W("Obciążenie spadło (×{r}: {a} pkt, zwykle {c}).", "Load has dropped (×{r}: {a} pts, usually {c})."), W("Mniej pracy niż zwykle (×{r}). Jeśli to nie odpoczynek przed zawodami — nadrób.", "Less work than usual (×{r}). If it's not a taper before a race — catch up.")] },
      { at: 1.3, lvl: "dobrze", w: 6, t: [W("Obciążenie równe: ×{r} wobec zwykłego tygodnia.", "Steady load: ×{r} of a usual week."), W("Obciążenie ×{r} — równo, bez skoków.", "Load ×{r} — steady, no spikes.")] },
      { at: 1.5, lvl: "popraw", w: 30, t: [W("Szybki wzrost obciążenia (×{r}). Następny tydzień nie dokładaj.", "Fast rise in load (×{r}). Don't add more next week."), W("Obciążenie ×{r}. Na granicy — śpij więcej.", "Load ×{r}. On the edge — sleep more.")] },
      { at: 100, lvl: "zle", w: 54, t: [W("Skok obciążenia ×{r} ({a} pkt, zwykle {c}). Ryzyko przeciążenia barków.", "A load spike ×{r} ({a} pts, usually {c}). Risk of overloading your shoulders."), W("×{r} zwykłego obciążenia. Tak wygląda nadrabianie po przerwie — i tak łapie się kontuzje.", "×{r} your usual load. That's catching up after a break — and how injuries happen.")] },
    ], vars);
    if (D.sleep && r > 1.3) {
      const n = (D.sleep.nights || []).filter(x => x.date > ST.addDays(D.today, -7) && x.date <= D.today);
      if (n.length >= 3) { const avg = ST.mean(n.map(durOf)); if (avg < D.sleep.hours * 60 - 30) say(out, "load-sleep", "load", "zle", 60, [W("Dużo pracy (×{r}) i mało snu (średnio {h}). Tak łapie się kontuzje.", "Lots of work (×{r}) and little sleep ({h} on average). That's how injuries happen.")], { r: V(r, 2), h: W(hm(avg)) }, Math.round(avg)); }
    }
  }
  const durOf = n => { const [bh, bm] = n.bed.split(":").map(Number), [wh, wm] = n.wake.split(":").map(Number); return ((wh * 60 + wm) - (bh * 60 + bm) + 1440) % 1440; };
  const hm = m => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;

  /* ================= technique and sets ================= */
  function technique(out, D) {
    for (const st of ["free", "back", "breast", "fly"]) {
      const s = ST.techSeries(D.trainings, D.bad, st); if (s.length < 4) continue;
      const k = Math.min(5, Math.floor(s.length / 2)), a = s.slice(-2 * k, -k), b = s.slice(-k);
      const dps = (ST.mean(b.map(x => x.dps)) - ST.mean(a.map(x => x.dps))) / ST.mean(a.map(x => x.dps)) * 100;
      const rate = (ST.mean(b.map(x => x.rate)) - ST.mean(a.map(x => x.rate))) / ST.mean(a.map(x => x.rate)) * 100;
      const vars = { s: STROKE_NOM[st], x: V(Math.abs(dps), 1), r: V(Math.abs(rate), 1), d: V(D.units.d(ST.mean(b.map(x => x.dps))), 2), u: W(D.units.u()), k: V(k) };
      ladder(out, `tech-dps-${st}`, "tech", dps, true, [
        { at: 3, lvl: "dobrze", w: 6, t: [W("{s}: dystans na ruch +{x}% ({d} {u}/ruch). Technika idzie do przodu.", "{s}: distance per stroke +{x}% ({d} {u}/stroke). Technique moving forward."), W("{s}: dłuższy ruch (+{x}%). Dobrze.", "{s}: a longer stroke (+{x}%). Good.")] },
        { at: 1, lvl: "popraw", w: 18, t: [W("{s}: dystans na ruch lekko lepszy (+{x}%).", "{s}: distance per stroke slightly better (+{x}%)."), W("{s}: +{x}% dystansu na ruch. Mało, ale w dobrą stronę.", "{s}: +{x}% distance per stroke. Small, but the right way.")] },
        { at: -1, lvl: "popraw", w: 28, t: [W("{s}: dystans na ruch stoi ({d} {u}/ruch).", "{s}: distance per stroke flat ({d} {u}/stroke)."), W("{s}: technika bez zmian od {k} treningów.", "{s}: technique unchanged for {k} sessions.")] },
        { at: -3, lvl: "zle", w: 40, t: [W("{s}: dystans na ruch spada (−{x}%). Ruch się skraca.", "{s}: distance per stroke falling (−{x}%). The stroke is getting shorter."), W("{s}: −{x}% dystansu na ruch. Machasz zamiast płynąć.", "{s}: −{x}% distance per stroke. Spinning instead of swimming.")] },
        { at: -100, lvl: "zle", w: 52, t: [W("{s}: −{x}% dystansu na ruch. Technika się psuje — wolniej, dłuższy ruch.", "{s}: −{x}% distance per stroke. Technique is breaking down — slow down, lengthen the stroke."), W("{s}: ruch krótszy o {x}%. Technika leci w dół.", "{s}: the stroke {x}% shorter. Technique is going down.")] },
      ], vars);
      if (rate > 3 && dps < -2) say(out, `tech-spin-${st}`, "tech", "zle", 50, [W("{s}: machasz szybciej (+{r}% ruchów na minutę), a każdy ruch daje mniej (−{x}%). To marnowanie siły.", "{s}: you stroke faster (+{r}% a minute) but each stroke gives less (−{x}%). That's wasted effort.")], vars, `${rate.toFixed(1)}|${dps.toFixed(1)}`);
    }
    const mix = ST.strokeMix(D.trainings, ST.addDays(D.today, -27), D.today);
    if (mix && mix.total >= 3000) {
      const fr = mix.share.free * 100;
      ladder(out, "tech-mix", "tech", fr, false, [
        { at: 60, lvl: "dobrze", w: 4, t: [W("Style rozłożone: kraul {f}% dystansu, reszta {o}%.", "Strokes well spread: freestyle {f}% of distance, the rest {o}%."), W("Kraul {f}%, inne style {o}%. Dobre proporcje.", "Freestyle {f}%, other strokes {o}%. Good balance.")] },
        { at: 75, lvl: "popraw", w: 18, t: [W("Kraul to {f}% dystansu. Pozostałe style dostają mało.", "Freestyle is {f}% of your distance. The other strokes get little."), W("{o}% na grzbiet, żabkę i motyl. Za mało, jeśli chcesz startować zmiennym.", "{o}% on back, breast and fly. Too little if you want to race medley.")] },
        { at: 88, lvl: "slabo", w: 32, t: [W("Prawie tylko kraul ({f}%). Grzbiet, żabka i motyl się nie rozwiną.", "Almost only freestyle ({f}%). Back, breast and fly won't develop."), W("Tylko {o}% dystansu poza kraulem. Inne style to twoja słaba strona.", "Only {o}% of the distance outside freestyle. Other strokes are your weak side.")] },
        { at: 101, lvl: "slabo", w: 42, t: [W("Kraul to {f}% dystansu — inne style praktycznie nie istnieją.", "Freestyle is {f}% of the distance — the other strokes practically don't exist."), W("{f}% kraula. Pozostałe style stoją w miejscu.", "{f}% freestyle. The other strokes are standing still.")] },
      ], { f: V(fr), o: V(100 - fr) });
      for (const st of ["back", "breast", "fly"]) if (mix.metres[st] === 0) say(out, `tech-none-${st}`, "tech", "slabo", 20, [W("W 4 tygodnie ani jednej długości {s}.", "Not a single length of {s} in 4 weeks.")], { s: W(STROKE_INST[st][0], STROKE_NOM[st][1]) });
    }
  }
  function sets(out, D) {
    const H = ST.setHistory(D.trainings), recent = H.filter(x => x.date > ST.addDays(D.today, -28));
    const fitRecent = D.trainings.some(t => t.swim && t.fit && ST.dayKey(t.date) > ST.addDays(D.today, -28));
    if (!recent.length) { if (fitRecent) say(out, "sets-none", "sets", "popraw", 18, [W("W 4 tygodnie nie widzę powtarzanych serii (np. 6 × 100). Albo ich nie pływasz, albo zegarek nie łapie przerw.", "In 4 weeks I see no repeated sets (e.g. 6 × 100). Either you don't swim them, or the watch misses the rests.")]); return; }
    const last = recent[recent.length - 1];
    setComments(out, D, last, "sets");
    const comp = recent.filter(x => x.prev);
    if (comp.length) {
      const d = ST.mean(comp.map(x => x.avg - x.prev.avg));
      ladder(out, "sets-vs", "sets", D.units.pace(d), false, [
        { at: -2, lvl: "dobrze", w: 6, t: [W("Te same serie co wcześniej płyniesz szybciej o {s} s/100 {u}.", "You swim the same sets {s} s/100 {u} faster than before."), W("Powtórzone serie: −{s} s/100 {u}. Postęp widać czarno na białym.", "Repeated sets: −{s} s/100 {u}. Progress in black and white.")] },
        { at: -0.3, lvl: "popraw", w: 18, t: [W("Te same serie: lepiej tylko o {s} s/100 {u}.", "The same sets: only {s} s/100 {u} better."), W("Serie, które już pływałeś: −{s} s/100 {u}. Ledwie.", "Sets you've swum before: −{s} s/100 {u}. Barely.")] },
        { at: 1.5, lvl: "popraw", w: 30, t: [W("Te same serie w tym samym tempie co ostatnio ({d} s/100 {u}).", "The same sets at the same pace as last time ({d} s/100 {u})."), W("Powtórzone serie bez poprawy. Stoisz w miejscu.", "Repeated sets with no improvement. Standing still.")] },
        { at: 1000, lvl: "zle", w: 44, t: [W("Te same serie wolniej o {s} s/100 {u} niż poprzednio.", "The same sets {s} s/100 {u} slower than before."), W("Serie, które już pływałeś, idą wolniej o {s} s/100 {u}. Regres.", "Sets you've swum before are {s} s/100 {u} slower. A step back.")] },
      ], { s: V(Math.abs(D.units.pace(d)), 1), d: V(D.units.pace(d), 1), u: W(D.units.u()) });
    }
  }
  function setComments(out, D, x, area, prefix = "set") {
    const name = W(`${x.reps} × ${Math.round(D.units.d(x.dist))} ${D.units.u()} ${STROKE_INST[x.stroke][0]}`, `${x.reps} × ${Math.round(D.units.d(x.dist))} ${D.units.u()} ${STROKE_INST[x.stroke][1]}`);
    const vars = { n: name, x: V(Math.abs(x.drop * 100), 1), sp: V(x.spread * 100, 1), b: P(D.units.pace(x.best)), w: P(D.units.pace(x.worst)), u: W(D.units.u()) };
    ladder(out, `${prefix}-drop-${x.sig}`, area, x.drop * 100, false, [
      { at: -2, lvl: "dobrze", w: 6, t: [W("{n}: końcówka szybsza o {x}% niż początek. Tak się płynie serię.", "{n}: the end {x}% faster than the start. That's how to swim a set."), W("{n}: przyspieszasz do końca (−{x}%). Wzorowo.", "{n}: faster to the end (−{x}%). Textbook.")] },
      { at: 1, lvl: "dobrze", w: 10, t: [W("{n}: równe tempo od początku do końca.", "{n}: even pace from start to finish."), W("{n}: bez spadku pod koniec. Dobrze rozłożone siły.", "{n}: no fade at the end. Well-paced.")] },
      { at: 3, lvl: "popraw", w: 26, t: [W("{n}: pod koniec wolniej o {x}%.", "{n}: {x}% slower at the end."), W("{n}: końcówka o {x}% słabsza. Lekko za szybki start.", "{n}: the end {x}% weaker. A slightly too fast start.")] },
      { at: 6, lvl: "zle", w: 42, t: [W("{n}: siadłeś pod koniec o {x}%. Za mocny start albo za mało wytrzymałości.", "{n}: you faded by {x}% at the end. Started too fast or not enough endurance."), W("{n}: spadek o {x}% w końcówce. Brakuje wytrzymałości.", "{n}: a {x}% fade at the end. Endurance is missing.")] },
      { at: 1000, lvl: "zle", w: 56, t: [W("{n}: końcówka wolniejsza aż o {x}% (od {b} do {w}/100 {u}). Seria się rozsypała.", "{n}: the end {x}% slower (from {b} to {w}/100 {u}). The set fell apart."), W("{n}: −{x}% pod koniec. Taka seria to więcej szkody niż pożytku.", "{n}: {x}% slower at the end. A set like that does more harm than good.")] },
    ], vars);
    ladder(out, `${prefix}-spread-${x.sig}`, area, x.spread * 100, false, [
      { at: 2, lvl: "dobrze", w: 4, t: [W("{n}: rozrzut tylko {sp}% — równo jak w zegarku.", "{n}: only {sp}% spread — like clockwork."), W("{n}: wszystkie powtórzenia w {sp}%. Bardzo równo.", "{n}: all reps within {sp}%. Very even.")] },
      { at: 4, lvl: "popraw", w: 16, t: [W("{n}: rozrzut {sp}% między najlepszym a najgorszym.", "{n}: {sp}% spread between best and worst."), W("{n}: od {b} do {w}/100 {u}. Prawie równo.", "{n}: from {b} to {w}/100 {u}. Almost even.")] },
      { at: 8, lvl: "popraw", w: 28, t: [W("{n}: nierówno — od {b} do {w}/100 {u} ({sp}%).", "{n}: uneven — from {b} to {w}/100 {u} ({sp}%)."), W("{n}: rozrzut {sp}%. Pilnuj tempa na każdym powtórzeniu.", "{n}: {sp}% spread. Watch the pace on every rep.")] },
      { at: 1000, lvl: "zle", w: 40, t: [W("{n}: rozrzut {sp}%. To nie seria, tylko przypadkowe odcinki.", "{n}: {sp}% spread. That's not a set, just random swims."), W("{n}: od {b} do {w}/100 {u}. Bez kontroli tempa.", "{n}: from {b} to {w}/100 {u}. No pace control.")] },
    ], vars);
  }

  /* ================= records, points, goals ================= */
  function records(out, D) {
    const recs = D.recs || {}, keys = Object.keys(recs); if (!keys.length) return;
    const news = ST.recordNews(recs, ST.parseDay(ST.addDays(D.today, -30)).getTime());
    if (news.last != null) {
      const days = Math.max(0, ST.daysBetween(ST.dayKey(new Date(news.last)), D.today));
      ladder(out, "rec-last", "rec", days, false, [
        { at: 7, lvl: "dobrze", w: 4, t: [W("Ostatni rekord: {ago}. Tak ma być.", "Last record: {ago}. That's how it should be."), W("Nowy rekord {ago}. Forma rośnie.", "A new record {ago}. Form is growing.")] },
        { at: 21, lvl: "dobrze", w: 10, t: [W("Ostatni rekord {d} dni temu.", "Last record {d} days ago."), W("{d} dni od ostatniego rekordu. Pilnuj, żeby nie było więcej.", "{d} days since the last record. Don't let it get longer.")] },
        { at: 45, lvl: "popraw", w: 26, t: [W("Od ostatniego rekordu minęło {d} dni.", "{d} days since your last record."), W("{d} dni bez rekordu. Czas na test.", "{d} days without a record. Time for a test.")] },
        { at: 90, lvl: "zle", w: 42, t: [W("{d} dni bez rekordu. Stoisz w miejscu.", "{d} days without a record. You're standing still."), W("Ostatni rekord {d} dni temu. Trenujesz, ale nie idziesz do przodu.", "Last record {d} days ago. You train, but don't move forward.")] },
        { at: 100000, lvl: "zle", w: 56, t: [W("Ostatni rekord {d} dni temu — ponad 3 miesiące bez postępu.", "Last record {d} days ago — over 3 months without progress."), W("{d} dni bez rekordu. Coś trzeba zmienić — zacznij od frekwencji.", "{d} days without a record. Something must change — start with attendance.")] },
      ], { d: V(days), ago: AGO(days) });
    }
    if (news.improved >= 3) say(out, "rec-month", "rec", "dobrze", 6, [W("W ostatnich 30 dniach poprawiłeś {nr}.", "You improved {n} records in the last 30 days.")], { n: V(news.improved), nr: NT(news.improved, "rekord", "rekordy", "rekordów", "record", "records") }, String(news.improved));
    const near = ST.inReach(recs, D.acts, D.bad, ST.addDays(D.today, -30)).slice(0, 3);
    for (const x of near) {
      const vars = { e: EV(x.stroke, x.dist, x.pool), s: V(x.best - x.pb, 2), g: V(x.gap * 100, 1), pb: TT(x.pb), b: TT(x.best) };
      ladder(out, `rec-near-${x.key}`, "rec", x.gap * 100, false, [
        { at: 0.5, lvl: "popraw", w: 14, t: [W("Rekord {e} na wyciągnięcie ręki: brakuje {s} s ({g}%). Rekord {pb}, ostatnio {b}.", "The {e} record is within reach: {s} s ({g}%) away. Record {pb}, recently {b}."), W("{e}: {b} wobec rekordu {pb}. Brakuje {s} s — następny trening.", "{e}: {b} against a record of {pb}. {s} s short — next session.")] },
        { at: 1.5, lvl: "popraw", w: 18, t: [W("{e}: brakuje {s} s do rekordu ({g}%). Dobry dzień i pęknie.", "{e}: {s} s off the record ({g}%). One good day and it falls."), W("{e} — ostatnio {b}, rekord {pb}. Blisko.", "{e} — recently {b}, record {pb}. Close.")] },
        { at: 3, lvl: "popraw", w: 22, t: [W("{e}: {g}% do rekordu ({b} wobec {pb}).", "{e}: {g}% off the record ({b} vs {pb})."), W("{e}: {s} s do rekordu. Do zrobienia w kilka tygodni regularnych treningów.", "{e}: {s} s off the record. Doable in a few weeks of regular training.")] },
      ], vars);
    }
    const SG = ST.strengths(recs);
    if (SG.list.length) {
      const top = SG.list[0];
      ladder(out, "pts-best", "pts", top.pts, true, [
        { at: 700, lvl: "dobrze", w: 4, t: [W("Najlepszy wynik: {e} — {p} pkt World Aquatics. Poziom zawodniczy.", "Best result: {e} — {p} World Aquatics points. A racer's level."), W("{p} pkt World Aquatics za {e}. To twoja mocna strona.", "{p} World Aquatics points for {e}. That's your strong side.")] },
        { at: 550, lvl: "dobrze", w: 10, t: [W("Najlepszy wynik: {e} — {p} pkt World Aquatics.", "Best result: {e} — {p} World Aquatics points."), W("{e}: {p} pkt. Dobry poziom, ale do 700 daleko.", "{e}: {p} points. A good level, but 700 is far.")] },
        { at: 450, lvl: "popraw", w: 22, t: [W("Najlepszy wynik: {e}, {p} pkt. Do 550 jeszcze sporo.", "Best result: {e}, {p} points. Still a way to 550."), W("{p} pkt za {e} — twój najlepszy wynik. Średnio-dobrze.", "{p} points for {e} — your best result. Fair.")] },
        { at: 350, lvl: "popraw", w: 32, t: [W("Twój najlepszy wynik ma {p} pkt ({e}). Średni poziom.", "Your best result is worth {p} points ({e}). An average level."), W("{e} za {p} pkt to najlepsze, co masz. Słabo-średnio.", "{e} for {p} points is the best you have. Below average.")] },
        { at: 250, lvl: "zle", w: 42, t: [W("Najwięcej punktów: {p} ({e}). Słabo jak na zawodnika.", "Most points: {p} ({e}). Weak for a racer."), W("Najlepszy wynik {p} pkt ({e}). Dużo pracy przed tobą.", "Best result {p} points ({e}). Lots of work ahead.")] },
        { at: 0, lvl: "zle", w: 50, t: [W("Najlepszy wynik to tylko {p} pkt ({e}).", "Your best result is only {p} points ({e})."), W("{p} pkt to twój szczyt ({e}). Bardzo słabo.", "{p} points is your peak ({e}). Very weak.")] },
      ], { e: EV(top.stroke, top.dist, top.pool), p: V(top.pts) });
      const by = Object.values(SG.byStroke).sort((a, b) => a.pts - b.pts);
      if (by.length >= 2) {
        const lo = by[0], hi = by[by.length - 1], d = hi.pts - lo.pts;
        if (d >= 40) ladder(out, "pts-weak-stroke", "pts", d, false, [
          { at: 80, lvl: "slabo", w: 30, t: [W("Najsłabszy styl: {a} ({x} pkt) — {d} pkt mniej niż {b}.", "Weakest stroke: {a} ({x} pts) — {d} pts below {b}."), W("{a} odstaje: {x} pkt wobec {y} za {b}.", "{a} lags: {x} pts vs {y} for {b}.")] },
          { at: 150, lvl: "slabo", w: 42, t: [W("Wyraźnie słaby styl: {a} ({x} pkt). Dla porównania {b}: {y} pkt.", "A clearly weak stroke: {a} ({x} pts). For comparison, {b}: {y} pts."), W("W tym jesteś słaby: {a} ({x} pkt, o {d} mniej niż {b}).", "This is where you're weak: {a} ({x} pts, {d} below {b}).")] },
          { at: 100000, lvl: "slabo", w: 54, t: [W("{a} to twoja największa słabość: {x} pkt, aż {d} mniej niż {b}.", "{a} is your biggest weakness: {x} pts, {d} below {b}."), W("{a}: {x} pkt. Przepaść — {d} pkt za {b}.", "{a}: {x} pts. A gulf — {d} pts behind {b}.")] },
        ], { a: STROKE_NOM[lo.stroke], b: STROKE_NOM[hi.stroke], x: V(lo.pts), y: V(hi.pts), d: V(d) });
      }
      if (SG.sprint && SG.distance) {
        const d = SG.sprint.pts - SG.distance.pts;
        if (Math.abs(d) >= 50) say(out, "pts-kind", "pts", "slabo", Math.abs(d) >= 120 ? 40 : 28, [d > 0
          ? W("Słabsza strona: dłuższe dystanse ({a} pkt) wobec sprintu ({b} pkt). Brakuje wytrzymałości.", "Weaker side: longer distances ({a} pts) vs sprint ({b} pts). Endurance is missing.")
          : W("Słabsza strona: sprint ({b} pkt) wobec dłuższych dystansów ({a} pkt). Brakuje szybkości.", "Weaker side: sprint ({b} pts) vs longer distances ({a} pts). Speed is missing.")],
          { a: V(SG.distance.pts), b: V(SG.sprint.pts) }, String(d));
      }
      for (const st of ["back", "breast", "fly"]) if (!SG.byStroke[st]) say(out, `pts-none-${st}`, "pts", "slabo", 16, [W("Nie masz ani jednego wyniku {s} — nie wiesz, na jakim jesteś poziomie.", "You have no {s} result at all — you don't know your level.")], { s: W(STROKE_INST[st][0], STROKE_NOM[st][1]) });
    }
  }
  function goals(out, D) {
    const G = (D.swim && D.swim.goals) || []; if (!G.length) return;
    for (const goal of G) {
      const key = g.Swim ? g.Swim.recKey(goal.pool, goal.stroke, goal.dist) : null, r = key && D.recs ? D.recs[key] : null;
      const vars = { e: EV(goal.stroke, goal.dist, goal.pool), t: TT(goal.time) };
      if (!r) { say(out, `goal-none-${goal.id}`, "goal", "popraw", 24, [W("Cel {e} w {t}: nie masz jeszcze żadnego wyniku na tym dystansie.", "Goal {e} in {t}: you don't have any result at this distance yet.")], vars); continue; }
      const gap = (r.time - goal.time) / goal.time * 100;
      Object.assign(vars, { pb: TT(r.time), s: V(r.time - goal.time, 2), g: V(gap, 1) });
      ladder(out, `goal-${goal.id}`, "goal", gap, false, [
        { at: 0, lvl: "dobrze", w: 4, t: [W("Cel {e} w {t} osiągnięty ({pb}). Ustaw następny.", "Goal {e} in {t} reached ({pb}). Set the next one."), W("{e} w {t} — zrobione ({pb}). Następny cel, bez odpoczywania na laurach.", "{e} in {t} — done ({pb}). Next goal, no resting on laurels.")] },
        { at: 1, lvl: "popraw", w: 16, t: [W("Cel {e}: brakuje {s} s ({g}%). Rekord {pb}, cel {t}.", "Goal {e}: {s} s ({g}%) to go. Record {pb}, goal {t}."), W("Do celu {e} zostało {s} s. Blisko.", "{s} s left to the {e} goal. Close.")] },
        { at: 3, lvl: "popraw", w: 26, t: [W("Cel {e} w {t}: jeszcze {s} s ({g}%).", "Goal {e} in {t}: {s} s ({g}%) still to go."), W("{e}: {pb} → cel {t}. {g}% do urwania.", "{e}: {pb} → goal {t}. {g}% to cut.")] },
        { at: 6, lvl: "zle", w: 38, t: [W("Cel {e} w {t} daleko: {g}% ({s} s).", "Goal {e} in {t} is far: {g}% ({s} s)."), W("Do celu {e} brakuje {s} s. Daleko.", "{s} s short of the {e} goal. Far.")] },
        { at: 1000, lvl: "zle", w: 48, t: [W("Cel {e} w {t}: brakuje {g}%. Bez regularnych treningów to tylko marzenie.", "Goal {e} in {t}: {g}% to go. Without regular training it's just a dream."), W("{e} w {t}? Na dziś {pb} — {g}% różnicy. Nierealne bez pełnej frekwencji.", "{e} in {t}? Today {pb} — {g}% apart. Unrealistic without full attendance.")] },
      ], vars);
      if (goal.by && gap > 0) {
        const weeks = ST.daysBetween(D.today, goal.by) / 7;
        if (weeks <= 0) say(out, `goal-late-${goal.id}`, "goal", "zle", 50, [W("Termin celu {e} minął ({d}), a brakuje {s} s.", "The deadline for {e} has passed ({d}), still {s} s to go.")], Object.assign(vars, { d: DT(goal.by) }));
        else {
          const per = (r.time - goal.time) / weeks, rel = gap / weeks;
          say(out, `goal-pace-${goal.id}`, "goal", rel > 0.5 ? "zle" : rel > 0.25 ? "popraw" : "dobrze", rel > 0.5 ? 46 : rel > 0.25 ? 28 : 8,
            [rel > 0.5 ? W("Do {d} musisz urywać {p} s tygodniowo na {e}. Przy obecnej frekwencji to nierealne.", "By {d} you must cut {p} s a week on {e}. At your current attendance that's unrealistic.")
              : rel > 0.25 ? W("Do {d}: {p} s tygodniowo na {e}. Da się, ale bez opuszczania treningów.", "By {d}: {p} s a week on {e}. Possible, but not with missed sessions.")
                : W("Do {d} wystarczy {p} s tygodniowo na {e}. Realne.", "By {d} you need {p} s a week on {e}. Realistic.")],
            Object.assign(vars, { d: DT(goal.by), p: V(per, 2) }), per.toFixed(2));
        }
      }
    }
  }

  /* ================= against boys of the same age: PZP classes and the ranking of the year of birth ================= */
  function peers(out, D) {
    const PE = g.RytmSwimPeers || (typeof require === "function" ? require("./swimpeers.js") : null);
    const born = D.swim && D.swim.born, recs = D.recs || {};
    if (!PE) return;
    if (!born) { if (Object.keys(recs).length) say(out, "peer-born", "data", "popraw", 8, [W("Wpisz swój rocznik w Analizie — porównam twoje rekordy z klasami PZP i z rankingiem twojego rocznika.", "Enter your year of birth in Analiza — I'll compare your records with the PZP classes and the ranking of your age group.")]); return; }
    const year = ST.parseDay(D.today).getFullYear(), all = [];
    for (const pool of [25, 50]) for (const r of PE.rows(recs, pool, born, year)) if (r.rec && r.cls) all.push(r);
    if (!all.length) return;
    const by = W(String(born)), ORDN = n => [`${n}.`, n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th")];
    const evOf = r => { const e = EV(r.stroke, r.dist, r.pool); return r.pool === 50 ? [e[0] + " (basen 50 m)", e[1] + " (50 m pool)"] : e; };
    const srcOf = r => (r.rec.src !== "manual" || r.rec.kind === "trening" ? W(" (z treningu)", " (in training)") : W(""));   // the watch = training
    const klOf = r => { const c = r.cls; if (c.got) return W(`klasa ${c.got.label} zdobyta`, `class ${c.got.label} reached`);
      const o = c.own || c.next; return o ? W(`do klasy ${o.label} brakuje ${nf("pl", r.rec.time - o.time, 2)} s`, `${nf("en", r.rec.time - o.time, 2)} s short of class ${o.label}`) : W(""); };
    for (const r of all) {
      const id = `peer-${r.pool}-${r.stroke}-${r.dist}`, vars = { e: evOf(r), t: TT(r.rec.time), src: srcOf(r), kl: klOf(r), b: by };
      if (r.rank) {
        Object.assign(vars, { n: ORDN(r.place), c: TT(r.rank[5]), d: TT(r.rank[3]) });
        ladder(out, id, "peer", r.place == null ? 999 : r.place, false, [
          { at: 3, lvl: "dobrze", w: 3, t: [W("{e}: {t}{src} — ok. {n} miejsce w roczniku {b} w Polsce. Ścisła czołówka; {kl}.", "{e}: {t}{src} — about {n} place among boys born {b} in Poland. The very top; {kl}."),
            W("{e}: ok. {n} miejsce w Polsce w twoim roczniku. Tu jesteś najlepszy z najlepszych.", "{e}: about {n} place in Poland in your age group. Best of the best here.")] },
          { at: 10, lvl: "dobrze", w: 5, t: [W("{e}: {t}{src} — ok. {n} miejsce w roczniku {b}. Pierwsza dziesiątka Polski; {kl}.", "{e}: {t}{src} — about {n} place among boys born {b}. Top ten in Poland; {kl}."),
            W("{e}: top 10 rocznika (ok. {n} miejsce). Pilnuj, bo inni też się poprawiają.", "{e}: top 10 of your age group (about {n}). Keep at it — the others improve too.")] },
          { at: 25, lvl: "dobrze", w: 8, t: [W("{e}: {t}{src} — ok. {n} miejsce w roczniku {b}; {kl}.", "{e}: {t}{src} — about {n} place among boys born {b}; {kl}."),
            W("{e}: ok. {n} miejsce w Polsce w twoim roczniku. Do pierwszej dziesiątki jeszcze kawałek.", "{e}: about {n} place in Poland in your age group. Still a way to the top ten.")] },
          { at: 50, lvl: "popraw", w: 14, t: [W("{e}: {t}{src} — ok. {n} miejsce w roczniku {b}. Pierwsza pięćdziesiątka, ale do czołówki daleko; {kl}.", "{e}: {t}{src} — about {n} place among boys born {b}. Top fifty, but far from the top; {kl}."),
            W("{e}: ok. {n} miejsce w roczniku. Pięćdziesiąty ma {d} — trzymaj się przynajmniej tego.", "{e}: about {n} place in your age group. The 50th has {d} — at least hold on to that.")] },
          { at: 100, lvl: "popraw", w: 22, t: [W("{e}: {t}{src} — ok. {n} miejsce w roczniku {b}. Druga pięćdziesiątka; {kl}.", "{e}: {t}{src} — about {n} place among boys born {b}. The second fifty; {kl}."),
            W("{e}: ok. {n} miejsce w Polsce w roczniku. Do pierwszej pięćdziesiątki (50. ma {d}) trzeba się poprawić.", "{e}: about {n} place in Poland in your age group. You need to improve to reach the top fifty (the 50th has {d}).")] },
          { at: 1000, lvl: "slabo", w: 30, t: [W("{e}: {t}{src} — poza pierwszą setką rocznika {b} (setny ma {c}); {kl}.", "{e}: {t}{src} — outside the top hundred of boys born {b} (the 100th has {c}); {kl}."),
            W("{e}: poza setką w twoim roczniku. Setny w Polsce ma {c}, ty {t}{src}.", "{e}: outside the top hundred in your age group. The 100th in Poland has {c}, you {t}{src}.")] },
        ], vars, `${r.rec.time}|${r.place}`);
      } else {
        const c = r.cls, gap = c.own ? r.rec.time - c.own.time : null;
        if (gap == null) continue;
        ladder(out, id, "peer", gap, false, [
          { at: -3, lvl: "dobrze", w: 5, t: [W("{e}: {t}{src} — {kl}, z dużym zapasem.", "{e}: {t}{src} — {kl}, with plenty to spare.")] },
          { at: 0, lvl: "dobrze", w: 9, t: [W("{e}: {t}{src} — {kl}.", "{e}: {t}{src} — {kl}.")] },
          { at: 1.5, lvl: "popraw", w: 18, t: [W("{e}: {t}{src} — {kl}. Blisko.", "{e}: {t}{src} — {kl}. Close.")] },
          { at: 1000, lvl: "slabo", w: 28, t: [W("{e}: {t}{src} — {kl}. Na tle rówieśników to słaby punkt.", "{e}: {t}{src} — {kl}. A weak spot against your age group.")] },
        ], vars, String(r.rec.time));
      }
    }
    // the best and the weakest event against the age group (by the place; outside the hundred counts as 101+)
    const ranked = all.filter(r => r.rank).map(r => ({ r, p: r.place == null ? 101 + (r.rec.time - r.rank[5]) / r.rank[5] * 100 : r.place }));
    if (ranked.length >= 3) {
      ranked.sort((a, b) => a.p - b.p);
      const best = ranked[0], worst = ranked[ranked.length - 1], pl = x => (x.r.place == null ? W("poza setką", "outside the top 100") : [`ok. ${x.r.place}. miejsce`, `about ${ORDN(x.r.place)[1]} place`]);
      say(out, "peer-best", "peer", best.p <= 25 ? "dobrze" : "popraw", best.p <= 25 ? 4 : 12, [W("Na tle rocznika najlepiej wypadasz: {e} ({x}).", "Against your age group you do best in: {e} ({x})."), W("Twoja najmocniejsza konkurencja w porównaniu z rówieśnikami: {e} — {x}.", "Your strongest event against your age group: {e} — {x}.")],
        { e: evOf(best.r), x: pl(best) }, `${best.r.stroke}${best.r.dist}|${Math.round(best.p)}`);
      if (worst !== best) say(out, "peer-worst", "peer", "slabo", worst.p > 100 ? 34 : 24, [W("Najsłabiej na tle rocznika: {e} ({x}). Tu tracisz do rówieśników najwięcej.", "Weakest against your age group: {e} ({x}). This is where you lose the most."),
        W("W tym jesteś słaby w porównaniu z rówieśnikami: {e} — {x}.", "This is your weak spot against your age group: {e} — {x}.")], { e: evOf(worst.r), x: pl(worst) }, `${worst.r.stroke}${worst.r.dist}|${Math.round(worst.p)}`);
    }
    // the class of your age: in how many events
    const withOwn = all.filter(r => r.cls.own), got = withOwn.filter(r => r.cls.got).length;
    if (withOwn.length >= 2) {
      const lab = withOwn[0].cls.own.label;
      ladder(out, "peer-classes", "peer", got / withOwn.length * 100, true, [
        { at: 75, lvl: "dobrze", w: 5, t: [W("Klasa {l} (lub lepsza) w {k} z {n} konkurencji.", "Class {l} (or better) in {k} of {n} events.")] },
        { at: 40, lvl: "popraw", w: 16, t: [W("Klasa {l} w {k} z {n} konkurencji. Reszta jeszcze nie.", "Class {l} in {k} of {n} events. Not the rest yet.")] },
        { at: 1, lvl: "popraw", w: 24, t: [W("Klasa {l} tylko w {k} z {n} konkurencji.", "Class {l} in only {k} of {n} events.")] },
        { at: 0, lvl: "slabo", w: 30, t: [W("Klasy {l} nie masz jeszcze w żadnej konkurencji ({n} sprawdzonych).", "No class {l} in any event yet ({n} checked).")] },
      ], { l: W(lab), k: V(got), n: V(withOwn.length) }, `${got}/${withOwn.length}`);
    }
  }

  /* ================= sleep ================= */
  function sleep(out, D) {
    if (!D.sleep || !D.sleep.nights || !D.sleep.nights.length) return;
    const n = D.sleep.nights.filter(x => x.date > ST.addDays(D.today, -7) && x.date <= D.today);
    if (n.length >= 3) {
      const avg = ST.mean(n.map(durOf)), d = avg - D.sleep.hours * 60;
      ladder(out, "sleep-avg", "sleep", d, true, [
        { at: -10, lvl: "dobrze", w: 4, t: [W("Śpisz średnio {h} — tyle, ile trzeba.", "You sleep {h} on average — as much as you need."), W("Sen {h} średnio. Regeneracja w porządku.", "{h} of sleep on average. Recovery is fine.")] },
        { at: -30, lvl: "popraw", w: 24, t: [W("Średnio {h} snu, {m} min poniżej celu.", "{h} of sleep on average, {m} min below your goal."), W("{h} snu — brakuje {m} min. Mało, ale się zbiera.", "{h} of sleep — {m} min short. Small, but it adds up.")] },
        { at: -60, lvl: "zle", w: 40, t: [W("Średnio {h} snu — brakuje {m} min każdej nocy. Regeneracja nie nadąża.", "{h} of sleep on average — {m} min short every night. Recovery can't keep up."), W("Sen {h} średnio. Przez tydzień to kilka godzin snu w plecy.", "{h} of sleep on average. Over a week that's hours of sleep lost.")] },
        { at: -1000, lvl: "zle", w: 56, t: [W("Śpisz średnio {h}, o {m} min za krótko. Na takim śnie rekordów nie będzie.", "You sleep {h} on average, {m} min too little. No records on that much sleep."), W("{h} snu. Za mało dla kogoś, kto trenuje i się uczy.", "{h} of sleep. Too little for someone who trains and studies.")] },
      ], { h: W(hm(avg)), m: V(Math.abs(d)) });
    }
    const e = ST.sleepEffect(D.trainings, D.sleep.nights, D.sleep.hours);
    if (e && e.effRel != null) ladder(out, "sleep-eff", "sleep", e.effRel * 100, true, [
      { at: -1, lvl: "popraw", w: 10, t: [W("Po krótkiej nocy efektywność prawie bez zmian (różnica {x}%). Ale brak snu zemści się przy większym zmęczeniu.", "After a short night efficiency barely changes ({x}% difference). Lack of sleep will catch up with you when you're more tired.")] },
      { at: -3, lvl: "popraw", w: 26, t: [W("Po krótkiej nocy efektywność niższa o {x}%.", "After a short night efficiency is {x}% lower."), W("Krótki sen = −{x}% efektywności na treningu.", "Short sleep = −{x}% efficiency in training.")] },
      { at: -100, lvl: "zle", w: 44, t: [W("Po krótkiej nocy efektywność spada aż o {x}%. Sen to też trening.", "After a short night efficiency drops by {x}%. Sleep is training too.")] },
    ], { x: V(Math.abs(e.effRel * 100), 1) });
  }

  /* ================= the whole picture ================= */
  const order = (a, b) => LV[b.lvl] - LV[a.lvl] || b.w - a.w;
  // all comments, the grade (1–6 with + / −) and the three weakest points
  function analyse(D) {
    const out = [];
    for (const f of [attendance, volume, rests, pace, heart, css, load, technique, sets, records, peers, goals, sleep]) { try { f(out, D); } catch (e) { /* one family failing must not hide the others */ } }
    const fits = D.trainings.filter(t => t.swim && t.fit && ST.dayKey(t.date) > ST.addDays(D.today, -28));
    if (D.trainings.some(t => t.swim) && !fits.length) say(out, "data-nofit", "data", "popraw", 30, [W("Brak plików FIT z ostatnich 4 tygodni — technika, serie i rekordy stoją.", "No FIT files from the last 4 weeks — technique, sets and records are on hold.")]);
    out.sort(order);
    const grade = gradeOf(D);
    const seen = new Set(), weak = out.filter(c => (c.lvl === "zle" || c.lvl === "slabo") && !seen.has(c.area) && seen.add(c.area)).slice(0, 3);
    return { comments: out, grade, weak, counts: { zle: out.filter(c => c.lvl === "zle").length, slabo: out.filter(c => c.lvl === "slabo").length, popraw: out.filter(c => c.lvl === "popraw").length, dobrze: out.filter(c => c.lvl === "dobrze").length } };
  }
  const clamp = x => Math.max(0, Math.min(1, x));
  // the grade: attendance 35%, progress 20%, volume 15%, records 15%, regularity 10%, technique 5% (only the parts with data)
  function gradeOf(D) {
    const parts = [];
    if (D.att && D.att.season.planned >= 4) parts.push(["att", 0.35, clamp((D.att.season.pct - 55) / 42)]);
    const te = ST.trend(D.trainings, "eff"), tp = ST.trend(D.trainings, "pace");
    if (te && te.rel != null) parts.push(["prog", 0.2, clamp(0.5 + te.rel * 10)]);
    else if (tp) parts.push(["prog", 0.2, clamp(0.5 - tp.d / 8)]);
    const wk = ST.weekly(D.trainings, D.today, 5).slice(0, -1);
    if (wk.some(w => w.n)) parts.push(["vol", 0.15, clamp(wk.reduce((a, w) => a + w.metres, 0) / 4 / 1000 / 16)]);
    const news = ST.recordNews(D.recs || {}, null);
    if (news.last != null) { const d = Math.max(0, ST.daysBetween(ST.dayKey(new Date(news.last)), D.today)); parts.push(["rec", 0.15, clamp(1 - Math.max(0, d - 7) / 90)]); }
    const R = ST.regularity(D.trainings, D.today, 60);
    if (R.avgGap != null) parts.push(["reg", 0.1, clamp(1 - (R.avgGap - 1.3) / 2.7)]);
    const s = ST.techSeries(D.trainings, D.bad, "free");
    if (s.length >= 4) { const k = Math.min(5, Math.floor(s.length / 2)), a = ST.mean(s.slice(-2 * k, -k).map(x => x.dps)), b = ST.mean(s.slice(-k).map(x => x.dps)); parts.push(["tech", 0.05, clamp(0.5 + (b - a) / a * 10)]); }
    if (!parts.length) return null;
    const W = parts.reduce((a, p) => a + p[1], 0), score = parts.reduce((a, p) => a + p[1] * p[2], 0) / W;
    const steps = [[0.93, 6, ""], [0.86, 5, "+"], [0.8, 5, ""], [0.75, 5, "−"], [0.7, 4, "+"], [0.64, 4, ""], [0.59, 4, "−"], [0.54, 3, "+"], [0.48, 3, ""], [0.43, 3, "−"], [0.38, 2, "+"], [0.32, 2, ""], [0.27, 2, "−"], [0, 1, ""]];
    const st = steps.find(x => score >= x[0]);
    const words = { 6: ["celujący", "excellent"], 5: ["bardzo dobry", "very good"], 4: ["dobry", "good"], 3: ["dostateczny", "satisfactory"], 2: ["dopuszczający", "pass"], 1: ["niedostateczny", "fail"] };
    return { score: Math.round(score * 100), value: st[1], sign: st[2], word: words[st[1]], parts: Object.fromEntries(parts.map(p => [p[0], Math.round(p[2] * 100)])) };
  }

  /* ================= one training ================= */
  function forTraining(D, t) {
    const out = [], U = D.units, u = W(U.u()), L = D.trainings.filter(x => x.swim), i = L.indexOf(t);
    if (!t.swim) return { comments: [] };
    const prev = i > 0 ? L[i - 1] : null, before = L.slice(Math.max(0, i - 5), i);
    if (prev) {
      const gap = ST.daysBetween(ST.dayKey(prev.date), ST.dayKey(t.date));
      if (gap >= 4) ladder(out, "tr-gap", "att", gap, false, [
        { at: 6, lvl: "popraw", w: 36, t: [W("Trening po {d} dniach przerwy.", "A session after a {d}-day break."), W("{d} dni od poprzedniego treningu.", "{d} days since the previous session.")] },
        { at: 13, lvl: "zle", w: 56, t: [W("Wracasz po {d} dniach przerwy — nie oczekuj rekordów.", "Back after {d} days off — don't expect records."), W("Przerwa {d} dni przed tym treningiem. Widać ją w liczbach.", "A {d}-day break before this session. It shows in the numbers.")] },
        { at: 1000, lvl: "zle", w: 70, t: [W("Pierwszy trening po {d} dniach. To była przerwa, nie odpoczynek.", "The first session after {d} days. That was a break, not rest."), W("{d} dni bez wody przed tym treningiem. Za długo.", "{d} days out of the water before this session. Too long.")] },
      ], { d: V(gap) });
      if (t.pace != null && prev.pace != null) ladder(out, "tr-pace-prev", "pace", U.pace(t.pace - prev.pace), false, [
        { at: -3, lvl: "dobrze", w: 6, t: [W("Tempo o {s} s/100 {u} szybsze niż na poprzednim treningu.", "Pace {s} s/100 {u} faster than the previous session."), W("−{s} s/100 {u} wobec poprzedniego treningu. Mocno.", "−{s} s/100 {u} vs the previous session. Strong.")] },
        { at: -1, lvl: "dobrze", w: 10, t: [W("Szybciej niż ostatnio o {s} s/100 {u}.", "{s} s/100 {u} faster than last time."), W("Tempo lepsze o {s} s/100 {u}.", "Pace {s} s/100 {u} better.")] },
        { at: 1, lvl: "popraw", w: 22, t: [W("Tempo prawie takie jak ostatnio ({d} s/100 {u}).", "Pace almost the same as last time ({d} s/100 {u})."), W("Tempo bez zmian wobec poprzedniego treningu.", "Pace unchanged vs the previous session.")] },
        { at: 3, lvl: "zle", w: 36, t: [W("Wolniej niż ostatnio o {s} s/100 {u}.", "{s} s/100 {u} slower than last time."), W("Tempo gorsze o {s} s/100 {u} niż poprzednio.", "Pace {s} s/100 {u} worse than before.")] },
        { at: 1000, lvl: "zle", w: 48, t: [W("Wyraźnie wolniej niż ostatnio: +{s} s/100 {u}.", "Clearly slower than last time: +{s} s/100 {u}."), W("+{s} s/100 {u} wobec poprzedniego treningu. Słaby dzień.", "+{s} s/100 {u} vs the previous session. A weak day.")] },
      ], { s: V(Math.abs(U.pace(t.pace - prev.pace)), 1), d: V(U.pace(t.pace - prev.pace), 1), u });
      if (t.eff != null && prev.eff != null) ladder(out, "tr-eff-prev", "eff", (t.eff - prev.eff) / prev.eff * 100, true, [
        { at: 3, lvl: "dobrze", w: 8, t: [W("Efektywność +{x}% wobec poprzedniego treningu.", "Efficiency +{x}% vs the previous session."), W("Lepsza efektywność niż ostatnio (+{x}%).", "Better efficiency than last time (+{x}%).")] },
        { at: -1, lvl: "popraw", w: 20, t: [W("Efektywność podobna jak ostatnio ({s}{x}%).", "Efficiency similar to last time ({s}{x}%)."), W("Efektywność bez większej zmiany ({s}{x}%).", "Efficiency without a real change ({s}{x}%).")] },
        { at: -5, lvl: "zle", w: 34, t: [W("Efektywność −{x}% wobec poprzedniego treningu.", "Efficiency −{x}% vs the previous session."), W("Słabsza efektywność niż ostatnio (−{x}%).", "Weaker efficiency than last time (−{x}%).")] },
        { at: -100, lvl: "zle", w: 46, t: [W("Efektywność spadła o {x}% od ostatniego razu. Zmęczenie?", "Efficiency down {x}% since last time. Tired?")] },
      ], { x: V(Math.abs((t.eff - prev.eff) / prev.eff * 100), 1), s: W(t.eff < prev.eff ? "−" : "+") });
      if (t.swolf != null && prev.swolf != null) ladder(out, "tr-swolf-prev", "swolf", t.swolf - prev.swolf, false, [
        { at: -1, lvl: "dobrze", w: 6, t: [W("SWOLF niższy o {x} niż ostatnio.", "SWOLF {x} lower than last time."), W("SWOLF lepszy o {x}.", "SWOLF better by {x}.")] },
        { at: 1, lvl: "popraw", w: 14, t: [W("SWOLF podobny jak ostatnio ({d}).", "SWOLF similar to last time ({d})."), W("SWOLF bez zmian ({d}).", "SWOLF unchanged ({d}).")] },
        { at: 100, lvl: "zle", w: 28, t: [W("SWOLF wyższy o {x} — więcej ruchów albo wolniej.", "SWOLF {x} higher — more strokes or slower."), W("SWOLF gorszy o {x} niż ostatnio.", "SWOLF {x} worse than last time.")] },
      ], { x: V(Math.abs(t.swolf - prev.swolf), 1), d: V(t.swolf - prev.swolf, 1) });
    } else say(out, "tr-first", "train", "popraw", 4, [W("Pierwszy trening na liście — nie ma z czym porównać.", "The first session in the list — nothing to compare with.")]);
    if (before.length >= 3 && t.dist) {
      const a = ST.mean(before.map(x => x.dist || 0)), rel = a ? (t.dist - a) / a * 100 : null;
      if (rel != null) ladder(out, "tr-dist", "vol", rel, true, [
        { at: 15, lvl: "dobrze", w: 6, t: [W("Dłuższy trening niż zwykle: +{x}% ({m}).", "Longer than usual: +{x}% ({m})."), W("{m} — więcej niż zwykle (+{x}%).", "{m} — more than usual (+{x}%).")] },
        { at: -10, lvl: "popraw", w: 12, t: [W("Dystans typowy dla ciebie ({m}).", "A typical distance for you ({m})."), W("{m}, czyli tyle, co zwykle.", "{m}, about as usual.")] },
        { at: -30, lvl: "popraw", w: 30, t: [W("Krótszy trening niż zwykle (−{x}%).", "Shorter than usual (−{x}%)."), W("{m} — mniej niż zwykle (−{x}%).", "{m} — less than usual (−{x}%).")] },
        { at: -100, lvl: "zle", w: 44, t: [W("Wyraźnie krótszy trening: −{x}% wobec średniej ({m}).", "A clearly short session: −{x}% vs your average ({m})."), W("Tylko {m}. Trening skrócony o {x}%.", "Only {m}. The session cut by {x}%.")] },
      ], { x: V(Math.abs(rel)), m: W(`${Math.round(U.d(t.dist)).toLocaleString("pl-PL")} ${U.u()}`, `${Math.round(U.d(t.dist)).toLocaleString("en-GB")} ${U.u()}`) });
    }
    if (t.fit) {
      if (D.hrMax) {
        const z = ST.hrZoneSecs(t.fit, D.hrMax);
        if (z) {
          const tot = z.reduce((a, b) => a + b, 0), hard = (z[3] + z[4]) / tot * 100;
          ladder(out, "tr-hard", "hr", hard, true, [
            { at: 50, lvl: "popraw", w: 18, t: [W("Mocny trening: {h}% w Z4–Z5. Następny spokojniej.", "A hard session: {h}% in Z4–Z5. Take the next one easier."), W("{h}% w Z4–Z5 — ciężka jednostka.", "{h}% in Z4–Z5 — a hard session.")] },
            { at: 15, lvl: "dobrze", w: 6, t: [W("{h}% treningu w Z4–Z5 — porządna praca.", "{h}% of the session in Z4–Z5 — proper work."), W("Porządna dawka mocnej pracy: {h}% w Z4–Z5.", "A proper dose of hard work: {h}% in Z4–Z5.")] },
            { at: 5, lvl: "popraw", w: 20, t: [W("Tylko {h}% w Z4–Z5. Spokojny trening.", "Only {h}% in Z4–Z5. An easy session."), W("Spokojnie: tylko {h}% mocnej pracy.", "Easy: only {h}% hard work.")] },
            { at: 0, lvl: "popraw", w: 26, t: [W("Prawie zero mocnej pracy ({h}%).", "Almost no hard work ({h}%).")] },
          ], { h: V(hard) });
        }
      }
      const rest = t.fit.lengths.filter(l => l.s === "idle").reduce((a, l) => a + l.t, 0), all = t.fit.lengths.reduce((a, l) => a + l.t, 0);
      if (all > 0) ladder(out, "tr-rest", "train", rest / all * 100, false, [
        { at: 25, lvl: "dobrze", w: 4, t: [W("Przerwy to {x}% treningu — pływasz, nie stoisz.", "Rests are {x}% of the session — you swim, you don't stand."), W("Tylko {x}% przerw. Gęsty trening.", "Only {x}% rest. A dense session.")] },
        { at: 35, lvl: "popraw", w: 16, t: [W("Przerwy to {x}% treningu.", "Rests are {x}% of the session."), W("{x}% treningu przy ścianie. Mogłoby być mniej.", "{x}% of the session at the wall. Could be less.")] },
        { at: 45, lvl: "zle", w: 30, t: [W("Przerwy to aż {x}% treningu. Za długo stoisz przy ścianie.", "Rests are {x}% of the session. Too long at the wall."), W("{x}% przerw. Za dużo stania.", "{x}% rest. Too much standing.")] },
        { at: 101, lvl: "zle", w: 42, t: [W("Ponad połowa treningu ({x}%) to przerwy.", "Over half the session ({x}%) is rest.")] },
      ], { x: V(rest / all * 100) });
      const tech = ST.technique(t.fit, D.bad).free, hist = before.filter(x => x.fit).map(x => ST.technique(x.fit, D.bad).free).filter(x => x && x.n >= 4);
      if (tech && tech.n >= 4 && hist.length >= 2) {
        const a = ST.mean(hist.map(x => x.dps)), rel = (tech.dps - a) / a * 100;
        ladder(out, "tr-dps", "tech", rel, true, [
          { at: 3, lvl: "dobrze", w: 6, t: [W("Kraul: dłuższy ruch niż zwykle (+{x}%, {d} {u}/ruch).", "Freestyle: a longer stroke than usual (+{x}%, {d} {u}/stroke)."), W("Kraul: {d} {u} na ruch — więcej niż zwykle.", "Freestyle: {d} {u} per stroke — more than usual.")] },
          { at: -2, lvl: "popraw", w: 14, t: [W("Kraul: dystans na ruch jak zwykle ({d} {u}/ruch).", "Freestyle: distance per stroke as usual ({d} {u}/stroke)."), W("Kraul: technika bez zmian ({d} {u}/ruch).", "Freestyle: technique unchanged ({d} {u}/stroke).")] },
          { at: -100, lvl: "zle", w: 30, t: [W("Kraul: ruch krótszy o {x}% niż zwykle. Zmęczenie łamie technikę.", "Freestyle: stroke {x}% shorter than usual. Fatigue is breaking your technique."), W("Kraul: −{x}% dystansu na ruch. Technika się posypała.", "Freestyle: −{x}% distance per stroke. Technique fell apart.")] },
        ], { x: V(Math.abs(rel), 1), d: V(U.d(tech.dps), 2), u });
      }
      for (const s of ST.setsOf(t.fit).slice(0, 3)) setComments(out, D, s, "sets", "tr-set");
      const recs = Object.values(D.recs || {}).filter(r => (r.history || []).some(h => h.actId === t.fit.id));
      if (recs.length) say(out, "tr-rec", "rec", "dobrze", 4, [W("Rekordy z tego treningu: {n}.", "Records from this session: {n}.")], { n: V(recs.length) }, String(recs.length));
    } else say(out, "tr-nofit", "data", "popraw", 10, [W("Bez pliku FIT widać tylko średnie — nie ocenię techniki, serii ani stref.", "Without a FIT file only the averages show — I can't rate technique, sets or zones.")]);
    if (D.sleep && D.sleep.nights) {
      const n = D.sleep.nights.find(x => x.date === ST.dayKey(t.date));
      if (n) { const d = durOf(n), goal = D.sleep.hours * 60; if (d < goal - 60) say(out, "tr-sleep", "sleep", "popraw", 24, [W("Przed tym treningiem spałeś tylko {h}.", "Before this session you slept only {h}.")], { h: W(hm(d)) }, String(d)); }
    }
    out.sort(order);
    return { comments: out };
  }

  const api = { LEVEL, AREA, LV, analyse, forTraining, gradeOf, ladder, hash };
  g.RytmSwimCoach = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
