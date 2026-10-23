/* QuickVolunteer · Accessibility tools bar
   Loaded in the <head> of every page, so saved settings are applied before
   the page is drawn. The settings are kept in this browser only (no account
   or database needed) and can be reset at any time. */
(function () {
  "use strict";
  var KEY = "qv_accessibility";
  var TEXT_STEPS = [100, 115, 130, 150];
  var COLOURS = ["standard", "contrast", "dark", "cream"];
  var DEFAULTS = { text: 100, colour: "standard", font: false, spacing: false, links: false, cursor: false, ruler: false, mask: false, rate: 1 };
  var root = document.documentElement;

  function read() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = k in saved ? saved[k] : DEFAULTS[k]; });
    if (TEXT_STEPS.indexOf(s.text) < 0) s.text = 100;
    if (COLOURS.indexOf(s.colour) < 0) s.colour = "standard";
    if ([0.8, 1, 1.25].indexOf(s.rate) < 0) s.rate = 1;
    return s;
  }
  var settings = read();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* still works on this page */ }
  }

  function loadReadableFont() {
    if (document.getElementById("qv-readable-font")) return;
    var link = document.createElement("link");
    link.id = "qv-readable-font";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap";
    document.head.appendChild(link);
  }

  function apply() {
    var scale = settings.text / 100;
    root.style.setProperty("--qv-text", scale);
    root.style.setProperty("--qv-text-big", 1 + (scale - 1) * 0.4);
    root.classList.toggle("qv-text", settings.text !== 100);
    COLOURS.forEach(function (c) { root.classList.toggle("qv-colour-" + c, settings.colour === c && c !== "standard"); });
    root.classList.toggle("qv-font", settings.font);
    root.classList.toggle("qv-spacing", settings.spacing);
    root.classList.toggle("qv-links", settings.links);
    root.classList.toggle("qv-cursor", settings.cursor);
    if (settings.font) loadReadableFont();
  }
  apply();

  /* ---------- Toolbar (after the page has loaded) ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    var bar = document.querySelector("[data-a11y-bar]");
    if (!bar) return;
    var toggle = bar.querySelector("[data-a11y-open]");
    var panel = document.getElementById("a11y-panel");
    var status = bar.querySelector("[data-a11y-status]");
    var ruler = document.createElement("div");
    var mask = document.createElement("div");
    ruler.className = "a11y-ruler";
    mask.className = "a11y-mask";
    [ruler, mask].forEach(function (el) { el.setAttribute("aria-hidden", "true"); el.hidden = true; document.body.appendChild(el); });

    function say(message) {
      status.textContent = "";
      window.setTimeout(function () { status.textContent = message; }, 50);
    }

    function open(show, focusPanel) {
      panel.hidden = !show;
      toggle.setAttribute("aria-expanded", String(show));
      bar.classList.toggle("is-open", show);
      if (show && focusPanel) panel.querySelector("button").focus();
      if (!show && focusPanel !== false) toggle.focus();
    }
    toggle.addEventListener("click", function () { open(panel.hidden, true); });
    bar.querySelectorAll("[data-a11y-close]").forEach(function (b) {
      b.addEventListener("click", function () { open(false); });
    });
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); open(false); }
    });

    // Show the current state on every control
    function refresh() {
      bar.querySelector("[data-a11y-text-value]").textContent = settings.text + "%";
      bar.querySelector("[data-a11y-text='down']").disabled = settings.text === TEXT_STEPS[0];
      bar.querySelector("[data-a11y-text='up']").disabled = settings.text === TEXT_STEPS[TEXT_STEPS.length - 1];
      bar.querySelectorAll("[data-a11y-colour]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.a11yColour === settings.colour));
      });
      bar.querySelectorAll("[data-a11y-switch]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(settings[b.dataset.a11ySwitch] === true));
      });
      bar.querySelectorAll("[data-a11y-rate]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(Number(b.dataset.a11yRate) === settings.rate));
      });
      ruler.hidden = !settings.ruler;
      mask.hidden = !settings.mask;
      toggle.classList.toggle("is-active", JSON.stringify(settings) !== JSON.stringify(DEFAULTS));
    }

    function change(key, value, message) {
      settings[key] = value;
      save();
      apply();
      refresh();
      if (message) say(message);
    }

    bar.querySelectorAll("[data-a11y-text]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = TEXT_STEPS.indexOf(settings.text) + (b.dataset.a11yText === "up" ? 1 : -1);
        i = Math.max(0, Math.min(TEXT_STEPS.length - 1, i));
        change("text", TEXT_STEPS[i], "Text size " + TEXT_STEPS[i] + "%");
      });
    });
    bar.querySelectorAll("[data-a11y-colour]").forEach(function (b) {
      b.addEventListener("click", function () { change("colour", b.dataset.a11yColour, b.textContent.trim() + " colours on"); });
    });
    bar.querySelectorAll("[data-a11y-switch]").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.dataset.a11ySwitch;
        var on = settings[key] !== true;
        change(key, on, b.dataset.a11yLabel + (on ? " on" : " off"));
      });
    });
    bar.querySelectorAll("[data-a11y-rate]").forEach(function (b) {
      b.addEventListener("click", function () { change("rate", Number(b.dataset.a11yRate), "Reading speed " + b.textContent.trim()); });
    });
    bar.querySelector("[data-a11y-reset]").addEventListener("click", function () {
      stopReading();
      settings = JSON.parse(JSON.stringify(DEFAULTS));
      save();
      apply();
      refresh();
      say("All accessibility settings are back to standard");
    });

    // Reading ruler and screen mask follow the pointer (mouse, pen or finger)
    function follow(y) {
      ruler.style.top = (y - 22) + "px";
      mask.style.setProperty("--qv-mask-y", y + "px");
    }
    document.addEventListener("pointermove", function (e) { if (settings.ruler || settings.mask) follow(e.clientY); }, { passive: true });
    follow(window.innerHeight / 3);

    /* ---------- Read aloud ---------- */
    var speech = window.speechSynthesis;
    var playBtn = bar.querySelector("[data-a11y-read]");
    var stopBtn = bar.querySelector("[data-a11y-stop]");
    var reading = false;

    function textToRead() {
      var selected = String(window.getSelection ? window.getSelection() : "").trim();
      if (selected) return selected;
      var main = document.getElementById("main") || document.body;
      var parts = [];
      main.querySelectorAll("h1, h2, h3, p, li, dt, dd, label, legend, td, th, summary, .btn").forEach(function (el) {
        if (el.closest("[hidden], .sr-only, [aria-hidden='true']") || !el.offsetParent) return;
        if (el.querySelector("p, li, h2, h3")) return; // read the inner items instead
        var t = el.innerText.replace(/\s+/g, " ").trim();
        if (t && parts[parts.length - 1] !== t) parts.push(t);
      });
      return parts.join(". ");
    }

    function stopReading() {
      if (!speech) return;
      speech.cancel();
      reading = false;
      playBtn.textContent = "Read aloud";
      playBtn.setAttribute("aria-pressed", "false");
      stopBtn.disabled = true;
    }

    if (!speech || typeof SpeechSynthesisUtterance === "undefined") {
      bar.querySelector("[data-a11y-speech]").hidden = true;
    } else {
      playBtn.addEventListener("click", function () {
        if (reading && !speech.paused) { speech.pause(); playBtn.textContent = "Continue"; return; }
        if (reading && speech.paused) { speech.resume(); playBtn.textContent = "Pause"; return; }
        var text = textToRead();
        if (!text) { say("There is no text to read"); return; }
        var utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-GB";
        utterance.rate = settings.rate;
        var voice = speech.getVoices().filter(function (v) { return /^en(-|_)GB/i.test(v.lang); })[0];
        if (voice) utterance.voice = voice;
        utterance.onend = stopReading;
        utterance.onerror = stopReading;
        speech.cancel();
        speech.speak(utterance);
        reading = true;
        playBtn.textContent = "Pause";
        playBtn.setAttribute("aria-pressed", "true");
        stopBtn.disabled = false;
      });
      stopBtn.addEventListener("click", function () { stopReading(); say("Reading stopped"); });
      window.addEventListener("pagehide", stopReading);
    }

    refresh();
  });
})();
