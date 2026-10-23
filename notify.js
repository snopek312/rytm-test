// Rytm: visible messages and safe access to device storage.
// Loaded before every other script, so all modules report problems the same way.
(function (g) {
  "use strict";
  const VERSION = "2026.10.23-ustawienia";

  /* ---------------- messages ---------------- */
  // Errors stay on screen until closed; info messages disappear on their own.
  const shown = new Map();                 // dedupe identical errors
  function host() {
    let h = document.getElementById("notices");
    if (!h) {
      h = document.createElement("div");
      h.id = "notices";
      h.setAttribute("aria-live", "assertive");
      (document.body || document.documentElement).appendChild(h);
    }
    return h;
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // error(title, details?) – details: string or array of strings (plain text, never HTML)
  function error(title, details, opts = {}) {
    const key = opts.key || title + "|" + [].concat(details || []).join("|");
    if (shown.has(key) && shown.get(key).isConnected) return shown.get(key);
    const box = el("div", "notice err"); box.setAttribute("role", "alert");
    const head = el("div", "notice-head");
    head.appendChild(el("strong", null, title));
    const close = el("button", "notice-x", "×"); close.type = "button"; close.setAttribute("aria-label", "Zamknij komunikat");
    close.addEventListener("click", () => { box.remove(); shown.delete(key); });
    head.appendChild(close); box.appendChild(head);
    const list = [].concat(details || []).filter(Boolean);
    if (list.length) { const ul = el("ul"); list.forEach(t => ul.appendChild(el("li", null, t))); box.appendChild(ul); }
    const actions = [].concat(opts.action || [], opts.actions || []);
    if (actions.length) {
      const row = el("div", "notice-acts");
      for (const a of actions) {
        const b = el("button", "btn", a.label); b.type = "button";
        b.addEventListener("click", () => { box.remove(); shown.delete(key); a.fn(); });
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    box.appendChild(el("p", "notice-ver", "Wersja aplikacji: " + VERSION));
    host().prepend(box); shown.set(key, box);
    return box;
  }
  // info(text, {action:{label, fn}, ms})
  function info(text, opts = {}) {
    const t = el("div", "h-toast"); t.setAttribute("role", "status");
    t.appendChild(el("span", null, text));
    if (opts.action) {
      const b = el("button", "toast-act", opts.action.label); b.type = "button";
      b.addEventListener("click", () => { t.remove(); opts.action.fn(); });
      t.appendChild(b);
    }
    document.querySelectorAll(".h-toast").forEach(x => x.remove());
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => t.remove(), opts.ms || (opts.action ? 8000 : 3500));
    return t;
  }
  function clearErrors() { shown.forEach(b => b.remove()); shown.clear(); }
  // closes one message by its key (e.g. when the problem it describes is gone)
  function dismiss(key) { const b = shown.get(key); if (b) { b.remove(); shown.delete(key); } }
  const isShown = key => !!(shown.get(key) && shown.get(key).isConnected);

  /* ---------------- storage ---------------- */
  const isQuota = e => !!e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || "")));
  let available = null;
  function checkAvailable() {
    if (available !== null) return available;
    try { const k = "__rytm_test__"; localStorage.setItem(k, "1"); localStorage.removeItem(k); available = true; }
    catch (e) { available = false; }
    return available;
  }
  function read(key) {
    try { return { ok: true, value: localStorage.getItem(key) }; }
    catch (e) { return { ok: false, value: null, error: e }; }
  }
  // Reads JSON. If the stored text is damaged, it is copied aside (never overwritten) and the user is told.
  function readJSON(key, what) {
    const r = read(key);
    if (!r.ok || r.value == null) return { ok: r.ok, value: null };
    try { return { ok: true, value: JSON.parse(r.value) }; }
    catch (e) {
      const rescue = key + ".uszkodzone." + Date.now();
      let saved = false;
      try { localStorage.setItem(rescue, r.value); localStorage.removeItem(key); saved = true; } catch (e2) {}
      error(`Nie udało się odczytać zapisanych danych: ${what}`, [
        saved ? "Uszkodzony zapis odłożyłem w bezpieczne miejsce na tym urządzeniu i nie zostanie nadpisany." : "Uszkodzonego zapisu nie udało się odłożyć. Nie usuwaj danych przeglądarki i wczytaj kopię z pliku.",
        "Jeśli masz plik kopii, wczytaj go w zakładce Dane."], { key: "corrupt|" + key });
      return { ok: false, value: null, corrupt: true, rescueKey: saved ? rescue : null };
    }
  }
  // Writes text. Returns true/false and shows one clear message on failure.
  function write(key, text, what) {
    try { localStorage.setItem(key, text); return true; }
    catch (e) {
      if (isQuota(e)) error("Brak miejsca na dane na tym urządzeniu", [
        `Nie zapisałem: ${what}. Zmiany są tylko do zamknięcia aplikacji.`,
        "Zapisz kopię w zakładce Dane, a potem usuń stare treningi albo zwolnij miejsce w telefonie."], { key: "quota" });
      else error(`Nie udało się zapisać: ${what}`, [
        checkAvailable() ? String(e && e.message || e) : "Ta przeglądarka nie pozwala zapisywać danych (np. tryb prywatny).",
        "Zmiany są tylko do zamknięcia aplikacji. Zapisz kopię w zakładce Dane."], { key: "write|" + key });
      return false;
    }
  }
  function remove(key) { try { localStorage.removeItem(key); return true; } catch (e) { return false; } }
  // total size of this app's data on the device (UTF-16 chars ≈ bytes×2 in most browsers)
  function usage(keys) {
    let n = 0; for (const k of keys) { const r = read(k); if (r.value) n += r.value.length; }
    return n;
  }

  /* ---------------- unexpected errors ---------------- */
  function onUnexpected(msg) {
    if (!msg || /ResizeObserver loop/i.test(msg)) return;
    error("Wystąpił nieoczekiwany błąd", [String(msg).slice(0, 300), "Twoje dane nie zostały usunięte. Jeśli błąd się powtarza, zapisz kopię w zakładce Dane i wyślij zrzut ekranu."], { key: "unexpected|" + msg });
  }
  if (g.addEventListener) {
    g.addEventListener("error", e => { if (e && e.message) onUnexpected(e.message); });
    g.addEventListener("unhandledrejection", e => { const r = e && e.reason; onUnexpected(r && (r.message || r.code) || String(r)); });
  }

  g.Rytm = Object.assign(g.Rytm || {}, {
    VERSION,
    notify: { error, info, clearErrors, dismiss, isShown },
    storage: { available: checkAvailable, read, readJSON, write, remove, usage, isQuota },
  });
  if (typeof module !== "undefined" && module.exports) module.exports = g.Rytm;
})(typeof window !== "undefined" ? window : globalThis);
