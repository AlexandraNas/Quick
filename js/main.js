// QuickVolunteer · front-end behaviour (no frameworks)
// Works on its own as a prototype with demo data. When the pages are served by Flask,
// js/api.js connects the same pages to the API and the MySQL database.

document.addEventListener("DOMContentLoaded", () => {
  setUpAuthHeader();
  setUpMobileMenu();
  setUpPasswordToggles();
  setUpSubscribeForm();
  setUpLoginForm();
  setUpSignupForm();
  markMatches();
  setUpTaskFilters();
  setUpReportLinks();
  setUpOnboarding();
  setUpDashboard();
  setUpLogout();
  setUpNotifications();
  setUpCounters();
  setUpRowFilters();
  setUpTaskDetail();
  setUpPostRequest();
  setUpCloseRequest();
  setUpOffers();
  setUpWithdraw();
  setUpHistory();
  setUpReview();
  setUpProfile();
  setUpReport();
  setUpAdmin();
  setUpSimpleForms();
  setUpTables();
  setUpConfirmations();
  setUpAskLinks();
});

/* ---------- Saved profile (prototype only) ----------
   For now the profile is kept in the browser with localStorage.
   Later Flask will save it in MySQL (USERS: postcode, account_type,
   skills) and send it back with fetch(). */
const PROFILE_KEY = "qv_profile";
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch (e) { return {}; }
}
function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) { /* storage blocked */ }
}

/* ---------- Onboarding (3 steps) ---------- */
function setUpOnboarding() {
  const form = document.getElementById("onboarding-form");
  if (!form) return;
  const steps = Array.from(form.querySelectorAll(".onboard-step"));
  const label = document.getElementById("step-label");
  const fill = document.getElementById("progress-fill");
  const back = document.getElementById("onboard-back");
  const next = document.getElementById("onboard-next");
  const saved = loadProfile();
  let current = 1;
  const total = 3;

  // Fill in anything already saved, so "Edit preferences" works too
  if (saved.postcode) form.postcode.value = saved.postcode;
  if (saved.area) form.area.value = saved.area;
  if (saved.distance) form.querySelector(`[name=distance][value="${saved.distance}"]`).checked = true;
  if (saved.role) form.querySelector(`[name=role][value="${saved.role}"]`).checked = true;
  if (saved.mode) { const m = form.querySelector(`[name=mode][value="${saved.mode}"]`); if (m) m.checked = true; }
  (saved.skills || []).forEach((k) => {
    const box = form.querySelector(`[name=skills][value="${k}"]`);
    if (box) box.checked = true;
  });

  const role = () => (form.querySelector("[name=role]:checked") || {}).value;
  const askOnly = () => role() === "help_seeker";

  // Everyone has 3 steps: area, how you take part, and your skills
  // (at least one skill is needed to finish). On step 2 the button stays
  // disabled until a choice is made.
  function updateButton() {
    label.textContent = `Step ${current} of ${total}`;
    fill.style.width = `${(current / total) * 100}%`;
    next.textContent = current === total ? "Finish" : "Continue";
    next.disabled = current === 2 && !role();
  }
  form.querySelectorAll("[name=role]").forEach((r) => r.addEventListener("change", updateButton));

  function saveAndFinish() {
    const ask = askOnly();
    saveProfile({
      ...saved,
      postcode: form.postcode.value.trim().toUpperCase(),
      area: form.area.value.trim(),
      distance: form.querySelector("[name=distance]:checked").value,
      role: role(),
      skills: Array.from(form.querySelectorAll("[name=skills]:checked")).map((b) => b.value),
      mode: ask ? (saved.mode || "any") : form.querySelector("[name=mode]:checked").value,
      skipped: false,
      onboarded: true,
    });
    window.location.href = "dashboard.html";
  }

  // Skip for now: keep what was typed (if valid) and go to the dashboard.
  // Anyone without a chosen account type is set to "both".
  document.getElementById("onboard-skip").addEventListener("click", () => {
    const profile = { ...saved, role: saved.role || "both", skipped: !saved.onboarded };
    if (!validate(1)) {
      profile.postcode = form.postcode.value.trim().toUpperCase();
      profile.area = form.area.value.trim();
    }
    markInvalid(form.postcode, false);
    markInvalid(form.area, false);
    saveProfile(profile);
    window.location.href = "dashboard.html";
  });

  function show(step, moveFocus = true) {
    current = step;
    steps.forEach((s) => s.classList.toggle("is-active", Number(s.dataset.step) === step));
    back.hidden = step === 1;
    showError(form, null);
    updateButton();

    // Step 3 wording changes for people who only ask for help
    if (step === 3) {
      const ask = askOnly();
      form.querySelector("[data-step3-title]").textContent = ask ? "What are you good at?" : "What can you help with?";
      form.querySelector("[data-step3-text]").textContent = ask
        ? "Everyone has something to offer. Your skills help volunteers get to know you."
        : "Pick your skills so we can show the best matched tasks first.";
      form.querySelectorAll("[data-volunteer-only]").forEach((el) => { el.hidden = ask; });
    }
    const heading = steps[step - 1].querySelector("h1");
    if (heading && moveFocus) { heading.setAttribute("tabindex", "-1"); heading.focus(); }
  }

  function validate(step) {
    if (step === 1) {
      const ok = isPostcode(form.postcode.value);
      markInvalid(form.postcode, !ok);
      const areaOk = form.area.value.trim().length > 1;
      markInvalid(form.area, !areaOk);
      if (!ok) return "Please enter a valid UK postcode, for example E8 1AB.";
      if (!areaOk) return "Please enter your neighbourhood.";
    }
    if (step === 2 && !role()) return "Please choose how you would like to take part.";
    if (step === 3 && !form.querySelector("[name=skills]:checked")) return "Please choose at least one skill.";
    return null;
  }

  back.addEventListener("click", () => show(current - 1));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const problem = validate(current);
    if (problem) { showError(form, problem); return; }
    if (current < total) { show(current + 1); return; }
    saveAndFinish();
  });

  show(1, false);
}

/* ---------- Dashboard that adapts to the chosen role ---------- */
function setUpDashboard() {
  const dash = document.querySelector(".dash");
  if (!dash) return;
  const profile = loadProfile();
  const role = profile.role || "both";

  if (profile.area) {
    dash.querySelector("[data-area-label]").textContent =
      `${profile.area} · ${profile.postcode || ""} · up to ${profile.distance || 3} miles`;
  }
  const text = {
    help_seeker: "Post a small request and follow the offers from your neighbours.",
    volunteer: "Here are tasks near you that match your skills and your free time.",
    both: "Switch between the help you give and the help you ask for.",
  };
  dash.querySelector("[data-role-text]").textContent = text[role];
  updateSuggestions();

  const panels = dash.querySelectorAll(".dash-panel");
  const tabs = dash.querySelector(".dash-tabs");
  const showPanel = (name) => {
    panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
    tabs.querySelectorAll(".dash-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  };

  if (role === "both") {
    tabs.hidden = false;
    if (!tabs.dataset.bound) {
      tabs.dataset.bound = "yes";
      tabs.querySelectorAll(".dash-tab").forEach((t) => t.addEventListener("click", () => showPanel(t.dataset.tab)));
    }
    showPanel("give");
  } else {
    tabs.hidden = true;
    showPanel(role === "help_seeker" ? "ask" : "give");
  }
}

/* Suggested tasks on the dashboard (US-13), worked out in the browser:
   1. With skills: tasks that match the skills come first, then the nearest.
   2. With only a location: "Tasks near you", nearest first, within the chosen distance.
   3. With neither: the section is hidden.
   The live site fills the same list from GET /api/tasks and calls this again. */
function updateSuggestions() {
  const box = document.querySelector("[data-suggestions]");
  if (!box) return;
  const list = box.querySelector("[data-suggestion-list]");
  const profile = loadProfile();
  const skills = hasSkills(profile);
  const home = districtOf(profile.postcode);
  if (!skills && !home) { box.hidden = true; return; }
  box.hidden = false;
  markMatches();

  const maxMiles = Number(profile.distance || 0);
  const cards = Array.from(list.querySelectorAll(".task-card"));
  cards.forEach((card) => {
    const miles = taskMiles(card, profile);
    card.dataset.miles = miles == null ? "" : String(miles);
    // In person tasks further away than the chosen distance are left out
    card.hidden = card.dataset.mode === "in_person" && miles != null && maxMiles && miles > maxMiles;
    if (!skills && card.dataset.mode !== "in_person") card.hidden = true;
  });
  const near = (c) => (c.dataset.miles === "" ? 99 : Number(c.dataset.miles));
  cards.sort((a, b) => (skills ? (b.dataset.match === "true") - (a.dataset.match === "true") : 0) || near(a) - near(b))
    .forEach((c) => list.appendChild(c));
  // Show the best three
  let shown = 0;
  cards.forEach((c) => { if (!c.hidden) { shown += 1; if (shown > 3) c.hidden = true; } });

  const title = box.querySelector("[data-matches-title]");
  const note = box.querySelector("[data-skills-text]");
  if (skills) {
    title.textContent = "Best matches for you";
    note.textContent = `Tasks that match your skills come first: ${profile.skills.join(", ")}.`;
  } else {
    title.textContent = "Tasks near you";
    note.innerHTML = `In person tasks within ${maxMiles || 3} miles of ${escapeHtml(profile.area || profile.postcode)}. <a class="link-green" href="profile.html">Add your skills</a> to see the tasks that match you first.`;
  }
  let empty = box.querySelector("[data-suggestions-empty]");
  if (!empty) {
    empty = document.createElement("p");
    empty.className = "empty-note";
    empty.dataset.suggestionsEmpty = "";
    empty.textContent = "No tasks match right now. Check back soon or see all tasks.";
    list.after(empty);
  }
  empty.hidden = shown > 0;
  showDistances(list);
}

/* ---------- Name in the header, and log out ---------- */
function setUpLogout() {
  const profile = loadProfile();
  if (profile.name) {
    const first = profile.name.split(" ")[0];
    document.querySelectorAll("[data-first-name]").forEach((el) => { el.textContent = first; });
    document.querySelectorAll("[data-initial]").forEach((el) => { el.textContent = first.charAt(0).toUpperCase(); });
  }
  // Verified members get a badge on their profile picture
  document.querySelectorAll("[data-initial]").forEach((el) => {
    el.classList.toggle("is-verified", profile.verification === "approved");
    if (profile.verification === "approved") el.title = "Verified member";
  });
  document.querySelectorAll("[data-logout]").forEach((a) => {
    a.addEventListener("click", () => { try { localStorage.removeItem(PROFILE_KEY); } catch (e) {} });
  });
}

/* ---------- Mobile menu ---------- */
function setUpMobileMenu() {
  const menu = document.getElementById("mobile-menu");
  const openBtn = document.querySelector(".menu-toggle");
  const closeBtn = document.querySelector(".menu-close");
  if (!menu || !openBtn || !closeBtn) return;

  const open = () => {
    menu.classList.add("is-open");
    document.body.classList.add("menu-open");
    openBtn.setAttribute("aria-expanded", "true");
    closeBtn.focus();
  };
  const close = () => {
    menu.classList.remove("is-open");
    document.body.classList.remove("menu-open");
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.focus();
  };

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("is-open")) close();
  });
  // Close the menu if the window grows to desktop size
  window.matchMedia("(min-width: 961px)").addEventListener("change", (e) => {
    if (e.matches && menu.classList.contains("is-open")) close();
  });
}

/* ---------- Show or hide password ---------- */
function setUpPasswordToggles() {
  document.querySelectorAll(".toggle-password").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
}

/* ---------- Helpers ---------- */
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function markInvalid(input, invalid) {
  input.closest(".field__control").classList.toggle("is-invalid", invalid);
  input.setAttribute("aria-invalid", String(invalid));
}

function showError(form, message) {
  const box = form.querySelector(".form-error");
  if (!box) return;
  if (message) {
    const text = box.querySelector("span");
    if (text) text.textContent = message;
    box.classList.add("is-visible");
  } else {
    box.classList.remove("is-visible");
  }
}

/* ---------- Footer subscribe ---------- */
function setUpSubscribeForm() {
  const form = document.querySelector(".subscribe");
  if (!form) return;
  const note = document.querySelector(".subscribe-note");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector("input");
    note.hidden = false;
    if (isEmail(input.value)) {
      note.textContent = "Thanks! You are subscribed.";
      note.style.color = "";
      form.reset();
    } else {
      note.textContent = "Please enter a valid email address.";
      note.style.color = "var(--error)";
    }
  });
}

/* ---------- Log in ---------- */
function setUpLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = form.querySelector("#email");
    const password = form.querySelector("#password");
    const emailOk = isEmail(email.value);
    const passwordOk = password.value.length > 0;
    markInvalid(email, !emailOk);
    markInvalid(password, !passwordOk);

    if (!emailOk || !passwordOk) {
      showError(form, "Email or password is incorrect.");
      return;
    }
    showError(form, null);
    // One login for everyone: Flask checks the account type and sends
    // members to their dashboard and the administrator to the admin page.
    // Prototype only: an email starting with "admin" opens the admin page.
    const isAdmin = email.value.trim().toLowerCase().startsWith("admin");
    // Remember that someone is logged in (prototype only; Flask will use a session cookie)
    if (!isAdmin) saveProfile({ ...loadProfile(), email: email.value.trim(), loggedIn: true });
    // Go back to the page they came from, for example Post a help request
    const next = new URLSearchParams(window.location.search).get("next");
    const safeNext = next && /^[a-z-]+\.html$/.test(next) ? next : null;
    window.location.href = isAdmin ? "admin.html" : (safeNext || "dashboard.html");
  });
}

/* ---------- Sign up ---------- */
function setUpSignupForm() {
  const form = document.getElementById("signup-form");
  if (!form) return;
  const success = form.querySelector(".form-success");

  // Live checks: password length and whether the two passwords match
  const pw = form.querySelector("#password");
  const pw2 = form.querySelector("#confirm");
  const hint = document.getElementById("pw-hint");
  const matchNote = document.getElementById("pw-match");
  const liveCheck = () => {
    const left = 12 - pw.value.length;
    hint.textContent = pw.value.length === 0 ? "At least 12 characters."
      : left > 0 ? `At least 12 characters (${left} more to go).` : "Password length is fine.";
    hint.classList.toggle("is-ok", left <= 0);
    if (!pw2.value) { matchNote.hidden = true; return; }
    const same = pw.value === pw2.value;
    matchNote.hidden = false;
    matchNote.textContent = same ? "Passwords match." : "Passwords do not match yet.";
    matchNote.classList.toggle("is-ok", same);
    if (same) { markInvalid(pw2, false); showError(form, null); }
    if (left <= 0) markInvalid(pw, false);
  };
  pw.addEventListener("input", liveCheck);
  pw2.addEventListener("input", liveCheck);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const first = form.querySelector("#firstname");
    const last = form.querySelector("#lastname");
    const email = form.querySelector("#email");
    const password = form.querySelector("#password");
    const confirm = form.querySelector("#confirm");
    const terms = form.querySelector("#terms");

    const checks = [
      [first, first.value.trim().length >= 1, "Please enter your first name."],
      [last, last.value.trim().length >= 1, "Please enter your last name."],
      [email, isEmail(email.value), "Please enter a valid email address."],
      [password, password.value.length >= 12, "Your password needs at least 12 characters."],
      [confirm, confirm.value === password.value && confirm.value !== "", "The passwords do not match."],
    ];

    let firstMessage = null;
    checks.forEach(([input, ok, message]) => {
      markInvalid(input, !ok);
      if (!ok && !firstMessage) firstMessage = message;
    });
    if (!firstMessage && !terms.checked) {
      firstMessage = "Please agree to the Terms of Use and Privacy Policy.";
    }

    success.classList.remove("is-visible");
    if (firstMessage) {
      showError(form, firstMessage);
      return;
    }
    showError(form, null);
    saveProfile({ firstName: first.value.trim(), lastName: last.value.trim(),
      name: `${first.value.trim()} ${last.value.trim()}`, email: email.value.trim() });
    success.textContent = "Account created. Next, tell us about your area.";
    success.classList.add("is-visible");
    setTimeout(() => { window.location.href = "onboarding.html"; }, 800);
  });
}

/* ---------- Find a task: search and filter chips ---------- */
function setUpTaskFilters() {
  const list = document.getElementById("task-list");
  if (!list) return;
  // The live site re-renders the cards and calls this again: bind only once.
  if (list.qvApply) { list.qvRefresh(); return; }

  const chips = document.querySelectorAll(".filters .chip");
  const search = document.getElementById("task-search");
  const count = document.getElementById("task-count");
  const empty = document.getElementById("empty-state");
  const typeBox = document.getElementById("task-type");
  const lengthBox = document.getElementById("task-duration");
  const distanceBox = document.getElementById("task-distance");
  const areaBox = document.getElementById("task-area");
  const verifiedBox = document.getElementById("task-verified");
  const distanceHint = document.querySelector("[data-distance-hint]");
  const cards = () => Array.from(list.querySelectorAll(".task-card"));

  // Search text can also come from the mobile menu search (?q=...)
  const params = new URLSearchParams(window.location.search);
  if (params.get("q")) search.value = params.get("q");

  let active = "all";

  // Neighbourhood options come from the tasks themselves
  function fillAreas() {
    if (!areaBox) return;
    const chosen = areaBox.value;
    const areas = Array.from(new Set(cards().map((c) => c.dataset.area).filter(Boolean))).sort();
    areaBox.innerHTML = '<option value="">All</option>' +
      areas.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
    if (areas.includes(chosen)) areaBox.value = chosen;
  }

  // Distance needs the member's postcode
  function prepareDistance() {
    const profile = loadProfile();
    const home = districtOf(profile.postcode);
    if (distanceBox) {
      distanceBox.disabled = !home;
      if (!home) distanceBox.value = "";
    }
    if (distanceHint) distanceHint.hidden = !!home;
    cards().forEach((card) => {
      const miles = taskMiles(card, profile);
      card.dataset.miles = miles == null ? "" : String(miles);
    });
    showDistances(list);
  }

  function refresh() {
    markMatches();
    fillAreas();
    prepareDistance();
    // Best match first (only when the member has skills), then nearest
    const near = (c) => (c.dataset.miles === "" ? 99 : Number(c.dataset.miles));
    cards()
      .sort((a, b) => (b.dataset.match === "true") - (a.dataset.match === "true") || near(a) - near(b))
      .forEach((card) => list.appendChild(card));
    apply();
  }

  function apply() {
    const text = search.value.trim().toLowerCase();
    const maxMiles = distanceBox && distanceBox.value ? Number(distanceBox.value) : 0;
    let shown = 0;
    cards().forEach((card) => {
      const minutes = Number(card.dataset.minutes);
      const passFilter =
        active === "all" ||
        card.dataset.mode === active ||
        (active === "match" && card.dataset.match === "true");
      const passType = !typeBox || !typeBox.value || card.dataset.category === typeBox.value;
      const passLength = !lengthBox || !lengthBox.value || minutes <= Number(lengthBox.value);
      // Distance applies to in person tasks; remote tasks can be done from anywhere
      const passDistance = !maxMiles || card.dataset.mode !== "in_person" ||
        (card.dataset.miles !== "" && Number(card.dataset.miles) <= maxMiles);
      const passArea = !areaBox || !areaBox.value || card.dataset.area === areaBox.value;
      const passVerified = !verifiedBox || !verifiedBox.checked || card.dataset.verified === "true";
      const passSearch = !text || card.textContent.toLowerCase().includes(text);
      const visible = passFilter && passType && passLength && passDistance && passArea && passVerified && passSearch;
      card.hidden = !visible;
      if (visible) shown++;
    });
    if (count) count.textContent = shown;
    const clear = document.getElementById("clear-filters");
    const any = active !== "all" || text || [typeBox, lengthBox, distanceBox, areaBox].some((b) => b && b.value) || (verifiedBox && verifiedBox.checked);
    if (clear) clear.hidden = !any;
    empty.classList.toggle("is-visible", shown === 0);
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      active = chip.dataset.filter;
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      apply();
    });
  });
  search.addEventListener("input", apply);
  // Type of help, duration, distance, neighbourhood and verified members (US-05)
  [typeBox, lengthBox, distanceBox, areaBox, verifiedBox].forEach((box) => { if (box) box.addEventListener("change", apply); });
  // Clear filters: back to all tasks with nothing selected
  document.querySelectorAll("#clear-filters, [data-clear-filters]").forEach((btn) => btn.addEventListener("click", () => {
    active = "all";
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === "all")));
    search.value = "";
    [typeBox, lengthBox, distanceBox, areaBox].forEach((b) => { if (b) b.value = ""; });
    if (verifiedBox) verifiedBox.checked = false;
    apply();
  }));
  list.qvApply = apply;
  list.qvRefresh = refresh;
  refresh();
}

/* ---------- Report a concern ---------- */
function setUpReportLinks() {
  document.querySelectorAll("button.report").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.nextElementSibling && btn.nextElementSibling.classList.contains("report-note")) return;
      const note = document.createElement("p");
      note.className = "report-note";
      note.setAttribute("role", "status");
      note.textContent = "Thank you. Our team will review this concern.";
      btn.after(note);
    });
  });
}

/* ---------- Notifications in the top bar ---------- */
function setUpNotifications() {
  const boxes = document.querySelectorAll("[data-notif]");
  if (!boxes.length) return;
  const profile = loadProfile();
  const incomplete = !(profile.role && profile.postcode && Array.isArray(profile.skills) && profile.skills.length);

  boxes.forEach((box) => {
    const btn = box.querySelector(".notif__btn");
    const panel = box.querySelector(".notif__panel");
    box.querySelector(".notif__dot").hidden = !incomplete;
    box.querySelector("[data-notif-profile]").hidden = !incomplete;
    box.querySelector("[data-notif-empty]").hidden = incomplete;
    btn.setAttribute("aria-label", incomplete ? "Notifications, 1 new" : "Notifications");

    const close = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target)) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  });
}

/* =========================================================
   Inner pages
   Demo data below stands in for the Flask API. Each function
   says which request will replace it later.
   ========================================================= */

/* Demo tasks (prototype only). The live site uses GET /api/tasks and
   GET /api/users/<id>/summary for the requester's details. */
const DEMO_TASKS = {
  1: { title: "Mow a small back garden lawn", who: "Margaret O.", mode: "in_person", minutes: 45, when: "Sat 24 Oct", where: "Hackney", postcode: "E8 3AA", skills: ["Gardening"],
       verified: true, since: "October 2026", completed: 2, about: "Retired nurse, keen gardener until my knee operation.",
       description: "My back lawn is small but has grown too long for me to manage since my knee operation. The electric mower, extension lead and grass box are in the shed. It would also help to trim the edges if there is time." },
  2: { title: "Weekly check-in call with an older resident", who: "Tom B.", mode: "remote", minutes: 20, when: "Fri 30 Oct", where: "By phone", skills: ["Friendly calls"],
       verified: false, since: "October 2026", completed: 0, about: "I enjoy a good chat about football and old films.",
       description: "I am 82 and live on my own. A regular call once a week to chat would make a real difference to me. Any weekday after 14:00 suits me best." },
  3: { title: "Collect a click and collect grocery order", who: "Nadia R.", mode: "in_person", minutes: 30, when: "Mon 26 Oct", where: "Dalston", postcode: "E8 2AA", skills: ["Shopping"],
       verified: true, since: "October 2026", completed: 3, about: "Retired teacher. I like to stay independent but sometimes need a hand.",
       description: "My order is already paid for and ready to collect from the supermarket on the high street. I need it brought to my flat on the second floor, as I cannot carry heavy bags at the moment. There are three bags." },
  4: { title: "Review a CV before a job application", who: "Amira K.", mode: "remote", minutes: 30, when: "Fri 30 Oct", where: "Online", skills: ["Writing and forms"],
       verified: true, since: "October 2026", completed: 1, about: "Returning to work after a career break.",
       description: "I am returning to work after five years and applying for an administrative role. I would like someone to review my two page CV and suggest how to present my experience more clearly. I can share it by email or video call." },
  5: { title: "Help assemble a flat pack wardrobe", who: "Joe P.", mode: "in_person", minutes: 60, when: "Wed 28 Oct", where: "Hackney Wick", postcode: "E9 5AA", skills: ["DIY and small repairs"],
       verified: false, since: "October 2026", completed: 0, about: "",
       description: "I have a two door wardrobe with the instructions and all the tools. Some panels need two people to lift and hold in place, so I need a second pair of hands." },
  6: { title: "Translate a tenancy letter into Arabic", who: "Layla H.", mode: "remote", minutes: 15, when: "Sun 1 Nov", where: "Online", skills: ["Translation"],
       verified: true, since: "October 2026", completed: 1, about: "I live with my parents and help them with English letters.",
       description: "My landlord has sent a two page letter about changes to my tenancy. I would like it translated into Arabic so my parents, who live with me, can understand it. I can share a photo of the letter." },
};
const completedText = (n) => `${n} completed task${n === 1 ? "" : "s"}`;

/* Fill a member summary box (task page and offers). Same fields as GET /api/users/<id>/summary */
function fillMemberBox(root, prefix, member) {
  const set = (name, value) => root.querySelectorAll(`[data-${prefix}-${name}]`).forEach((el) => { el.textContent = value; });
  set("name", member.name);
  set("initial", member.name.charAt(0));
  set("since", `Member since ${member.since}`);
  set("completed", completedText(member.completed));
  set("about", member.about || "");
  root.querySelectorAll(`[data-${prefix}-verified]`).forEach((el) => { el.hidden = !member.verified; });
  root.querySelectorAll(`[data-${prefix}-initial]`).forEach((el) => el.classList.toggle("is-verified", !!member.verified));
  root.querySelectorAll(`[data-${prefix}-skills]`).forEach((box) => {
    box.innerHTML = (member.skills || []).map((k) => `<span class="skill-tag">${escapeHtml(k)}</span>`).join("");
  });
}

/* Character counters under text areas */
function setUpCounters() {
  document.querySelectorAll("[data-counter-for]").forEach((counter) => {
    const box = document.getElementById(counter.dataset.counterFor);
    if (!box) return;
    const update = () => { counter.textContent = `${box.value.length} / ${box.maxLength}`; };
    box.addEventListener("input", update);
    update();
  });
}

/* Check required fields inside a form. Returns the first problem or null. */
function checkRequired(form, extra = []) {
  let first = null;
  form.querySelectorAll("input[required], textarea[required], select[required]").forEach((el) => {
    if (el.closest("[hidden]")) { markInvalid(el, false); return; }
    let ok = el.value.trim() !== "";
    if (ok && el.type === "email") ok = isEmail(el.value);
    markInvalid(el, !ok);
    if (!ok && !first) {
      const label = form.querySelector(`label[for="${el.id}"]`);
      first = el.type === "email" && el.value.trim() ? "Please enter a valid email address."
        : `Please fill in: ${label ? label.firstChild.textContent.trim() : "this field"}.`;
    }
  });
  form.querySelectorAll("[data-required-group]").forEach((group) => {
    if (group.closest("[hidden]")) return;
    const ok = !!group.querySelector("input:checked");
    group.classList.toggle("is-invalid", !ok);
    if (!ok && !first) first = `Please choose: ${group.querySelector("legend").firstChild.textContent.trim()}.`;
  });
  extra.forEach(([ok, message]) => { if (!ok && !first) first = message; });
  return first;
}

/* Chip filters for lists (My requests) */
function setUpRowFilters() {
  const group = document.querySelector("[data-row-filter]");
  const list = document.querySelector("[data-rows]");
  if (!group || !list) return;
  const empty = document.querySelector("[data-rows-empty]");
  const chips = group.querySelectorAll(".chip");
  chips.forEach((chip) => chip.addEventListener("click", () => {
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    let shown = 0;
    list.querySelectorAll(".row-card").forEach((row) => {
      const show = chip.dataset.filter === "all" || row.dataset.status === chip.dataset.filter;
      row.hidden = !show;
      if (show) shown++;
    });
    if (empty) empty.classList.toggle("is-visible", shown === 0);
  }));
}

/* Task details page (task.html?id=3). In live mode api.js uses the Flask API. */
function setUpTaskDetail() {
  const page = document.querySelector("[data-task-page]");
  if (!page) return;
  const id = new URLSearchParams(window.location.search).get("id") || "3";
  const task = DEMO_TASKS[id] || DEMO_TASKS[3];
  const set = (sel, value) => page.querySelectorAll(sel).forEach((el) => { el.textContent = value; });
  document.title = `${task.title} · QuickVolunteer`;
  set("[data-task-title]", task.title);
  set("[data-task-minutes]", task.minutes);
  set("[data-task-when]", task.when);
  set("[data-task-where]", task.where);
  set("[data-task-description]", task.description);
  // What volunteers can see about the requester
  fillMemberBox(page, "requester", { name: task.who, since: task.since, verified: task.verified, completed: task.completed, about: task.about, skills: [] });
  page.querySelector("[data-task-tag]").outerHTML = task.mode === "remote"
    ? '<span class="tag tag--remote"><img src="assets/icons/laptop-tag.svg" alt="" width="14" height="14">Remote</span>'
    : '<span class="tag tag--in-person"><img src="assets/icons/pin-tag.svg" alt="" width="14" height="14">In person</span>';
  page.querySelector("[data-task-report]").href = `report.html?task=${id}`;

  // Highlight skills that match the volunteer's profile
  const mySkills = loadProfile().skills || [];
  const skillBox = page.querySelector("[data-task-skills]");
  task.skills.forEach((skill) => {
    const tag = document.createElement("span");
    const match = mySkills.includes(skill);
    tag.className = `skill-tag${match ? " skill-tag--match" : ""}`;
    tag.textContent = match ? `${skill} · your skill` : skill;
    skillBox.appendChild(tag);
  });
  const matched = task.skills.filter((s) => mySkills.includes(s));
  if (matched.length) {
    page.querySelector("[data-task-match]").hidden = false;
    page.querySelector("[data-task-match-text]").textContent = `It matches your skills: ${matched.join(", ")}.`;
  }

  // Offer to help (live: POST /api/tasks/<id>/apply, DELETE /api/applications/<id>)
  const form = document.getElementById("offer-form");
  const sent = document.getElementById("offer-sent");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    form.hidden = true;
    sent.hidden = false;
    sent.querySelector("h2").setAttribute("tabindex", "-1");
    sent.querySelector("h2").focus();
  });
  document.getElementById("withdraw-offer").addEventListener("click", () => {
    sent.hidden = true;
    form.hidden = false;
  });
}

/* Post a help request. In live mode api.js uses the Flask API. */
function setUpPostRequest() {
  const form = document.getElementById("post-form");
  if (!form) return;
  const profile = loadProfile();
  const inPerson = form.querySelector("[data-in-person-only]");
  // Deadline: the latest date the task should be done by (cannot be in the past).
  // The date the request is created is saved by the server, not typed by the user.
  const date = form.querySelector("#req-deadline");
  if (profile.postcode) form.querySelector("#req-postcode").value = profile.postcode;
  if (profile.area) form.querySelector("#req-area").value = profile.area;
  date.min = new Date().toISOString().slice(0, 10);

  form.querySelectorAll("[name=req-mode]").forEach((r) => r.addEventListener("change", () => {
    inPerson.hidden = r.value !== "in_person";
  }));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = form.querySelector("#req-title");
    const description = form.querySelector("#req-description");
    const inPersonNow = (form.querySelector("[name=req-mode]:checked") || {}).value === "in_person";
    const problem = checkRequired(form, [
      [title.value.trim().length <= 60, "Please keep the title to 60 characters or fewer."],
      [!inPersonNow || isPostcode(form.querySelector("#req-postcode").value), "Please enter a valid UK postcode, for example E8 1AB."],
      [description.value.trim().length >= 20, "Please add a little more detail to the description (at least 20 characters)."],
      [form.querySelector("#req-confirm").checked, "Please confirm the task is small and safe."],
    ]);
    if (problem) { showError(form, problem); return; }
    showError(form, null);
    const done = document.getElementById("post-done");
    done.querySelector("[data-done-title]").textContent = `“${title.value.trim()}”`;
    form.hidden = true;
    done.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

/* Close a request (My requests and Request pages). A posted request cannot be edited. Live: PATCH /api/tasks/<id>/cancel */
function setUpCloseRequest() {
  document.querySelectorAll("[data-close-request]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.confirm !== "yes") {
        btn.dataset.confirm = "yes";
        btn.textContent = "Click again to close";
        return;
      }
      const row = btn.closest(".row-card") || document;
      const label = row.querySelector("[data-status-label], [data-request-status]");
      if (label) { label.textContent = "Closed"; label.className = "status status--closed"; }
      if (row.dataset) row.dataset.status = "closed";
      btn.replaceWith(Object.assign(document.createElement("span"), { className: "muted", textContent: "Request closed" }));
      document.querySelectorAll("[data-offer-actions]").forEach((a) => { a.hidden = true; });
    });
  });
}

/* Accept or decline volunteer offers. Live: PATCH /api/applications/<id>/decision */
function setUpOffers() {
  const cards = document.querySelectorAll("[data-offer]");
  if (!cards.length) return;
  const status = document.querySelector("[data-request-status]");
  const result = (card, text) => { const r = card.querySelector("[data-offer-result]"); r.hidden = false; r.textContent = text; };

  cards.forEach((card) => {
    const name = card.querySelector("[data-offer-name]").textContent;
    card.querySelector("[data-accept]").addEventListener("click", () => {
      cards.forEach((other) => {
        other.querySelector("[data-offer-actions]").hidden = true;
        if (other === card) {
          other.classList.add("is-accepted");
          result(other, `You accepted ${name}. We have shared the address with them and sent you both a confirmation.`);
        } else {
          other.classList.add("is-declined");
          result(other, "Not chosen this time. We have let them know.");
        }
      });
      status.textContent = `Accepted · ${name}`;
      status.className = "status status--accepted";
      document.querySelector("[data-complete-link]").hidden = false;
    });
    card.querySelector("[data-decline]").addEventListener("click", () => {
      card.classList.add("is-declined");
      card.querySelector("[data-offer-actions]").hidden = true;
      result(card, `You declined ${name}'s offer.`);
    });
  });
}

/* Withdraw an offer (My tasks). In live mode api.js uses the Flask API. */
function setUpWithdraw() {
  // A withdrawn offer is deleted, so it disappears from the list (it is not recorded).
  document.querySelectorAll("[data-withdraw]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.confirm !== "yes") {
        btn.dataset.confirm = "yes";
        btn.textContent = "Click again to withdraw";
        return;
      }
      const row = btn.closest(".row-card, .trow");
      const section = row.closest(".tsec");
      row.remove();
      if (section) {
        const pill = section.querySelector(".count-pill");
        const left = section.querySelectorAll(".trow").length;
        if (pill) pill.textContent = left;
        if (!left) {
          const list = section.querySelector(".trow-list");
          if (list) list.innerHTML = '<li class="muted">Nothing here right now.</li>';
        }
      }
    });
  });
}

/* Activity history count (My tasks). In live mode api.js uses the Flask API. */
function setUpHistory() {
  // Activity history: completed tasks only, no hours (the admin keeps the count).
  const box = document.querySelector("[data-history]");
  if (!box) return;
  const section = box.closest(".tsec");
  const pill = section && section.querySelector(".count-pill");
  if (pill) pill.textContent = box.querySelectorAll(".trow").length;
}

/* Confirm completed and review. In live mode api.js uses the Flask API. */
function setUpReview() {
  const form = document.getElementById("review-form");
  if (!form) return;
  const params = new URLSearchParams(window.location.search);
  const task = DEMO_TASKS[params.get("task")];
  const asSeeker = params.get("as") === "seeker";
  if (task) form.querySelector("[data-review-task]").textContent = task.title;
  if (asSeeker) form.querySelector("[data-review-person]").textContent = "your volunteer";
  else if (task) form.querySelector("[data-review-person]").textContent = task.who;
  // Both people must confirm (US-10). The other person is the volunteer or the requester.
  const other = asSeeker ? "your volunteer" : (task ? task.who : "the other person");
  form.querySelector("[data-review-other]").textContent = other;

  const yesNote = form.querySelector("[data-hours-note]");
  const noNote = form.querySelector("[data-no-note]");
  const fields = form.querySelector("[data-review-fields]");
  form.querySelectorAll("[name=happened]").forEach((r) => r.addEventListener("change", () => {
    const yes = r.value === "yes";
    yesNote.hidden = !yes;
    noNote.hidden = yes;
    fields.hidden = !yes;
  }));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const happened = (form.querySelector("[name=happened]:checked") || {}).value;
    const rated = form.querySelector("[name=rating]:checked");
    const problem = checkRequired(form, [[happened !== "yes" || rated, "Please choose a star rating."]]);
    if (problem) { showError(form, problem); return; }
    const done = document.getElementById("review-done");
    if (happened === "yes") {
      // Prototype: remember this person's confirmation (live: PATCH /api/tasks/<id>/complete)
      // and Flask marks the task Completed only when both confirmations are saved.
      const taskId = params.get("task") || "2";
      saveConfirmation(taskId, asSeeker ? "seeker" : "volunteer");
      done.querySelector("[data-done-heading]").textContent = "Confirmation sent";
      done.querySelector("[data-done-text]").textContent =
        `Thank you. Your review is saved. We are now waiting for ${other} to confirm. ` +
        "When you have both confirmed, the task is completed and added to your activity histories.";
    } else {
      done.querySelector("[data-done-text]").textContent =
        "Thanks for letting us know. The task has not been marked as completed.";
    }
    form.hidden = true;
    done.hidden = false;
  });
}

/* Profile. In live mode api.js uses the Flask API. */
function setUpProfile() {
  const form = document.getElementById("profile-form");
  if (!form) return;
  const profile = loadProfile();
  const roleNames = { help_seeker: "Asking for help", volunteer: "Giving help", both: "Asking and giving help" };
  const fill = () => {
    const p = loadProfile();
    document.querySelector("[data-profile-name]").textContent = p.name || "Your name";
    document.querySelector("[data-profile-area]").textContent = p.area ? `${p.area}, up to ${p.distance || 3} miles` : "Not set";
    document.querySelector("[data-profile-role]").textContent = roleNames[p.role] || "Not set";
    if (p.since) document.querySelector("[data-profile-since]").textContent = p.since;
    showVerification(p.verification);
  };
  // First and last name (older saved profiles only have one name, so split it once)
  const parts = (profile.name || "").trim().split(/\s+/);
  form.firstname.value = profile.firstName || (parts[0] || "");
  form.lastname.value = profile.lastName || parts.slice(1).join(" ");
  if (profile.email) form.email.value = profile.email;
  if (profile.bio) form.bio.value = profile.bio;
  if (profile.postcode) form.postcode.value = profile.postcode;
  if (profile.area) form.area.value = profile.area;
  const check = (name, value) => { const el = form.querySelector(`[name=${name}][value="${value}"]`); if (el) el.checked = true; };
  if (profile.distance) check("distance", profile.distance);
  if (profile.role) check("role", profile.role);
  if (profile.mode) check("mode", profile.mode);
  (profile.skills || []).forEach((v) => check("skills", v));
  (profile.days || []).forEach((v) => check("days", v));
  (profile.times || []).forEach((v) => check("times", v));
  form.bio.dispatchEvent(new Event("input"));
  fill();

  const volunteerOnly = form.querySelector("[data-volunteer-only]");
  const toggle = () => { volunteerOnly.hidden = (form.querySelector("[name=role]:checked") || {}).value === "help_seeker"; };
  form.querySelectorAll("[name=role]").forEach((r) => r.addEventListener("change", toggle));
  toggle();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const success = form.querySelector(".form-success");
    success.classList.remove("is-visible");
    const postcodeOk = isPostcode(form.postcode.value);
    // At least one skill is needed (it is how we match tasks and introduce you)
    const problem = checkRequired(form, [[postcodeOk, "Please enter a valid UK postcode, for example E8 1AB."]]);
    if (!postcodeOk) markInvalid(form.postcode, true);
    if (problem) { showError(form, problem); return; }
    showError(form, null);
    const values = (name) => Array.from(form.querySelectorAll(`[name=${name}]:checked`)).map((b) => b.value);
    const role = form.querySelector("[name=role]:checked").value;
    const updated = {
      ...loadProfile(),
      firstName: form.firstname.value.trim(),
      lastName: form.lastname.value.trim(),
      name: `${form.firstname.value.trim()} ${form.lastname.value.trim()}`,
      email: form.email.value.trim(),
      bio: form.bio.value.trim(),
      postcode: form.postcode.value.trim().toUpperCase(),
      area: form.area.value.trim(),
      distance: form.querySelector("[name=distance]:checked").value,
      role,
      skills: values("skills"),
      mode: role === "help_seeker" ? (loadProfile().mode || "any") : form.querySelector("[name=mode]:checked").value,
      days: values("days"),
      times: values("times"),
      skipped: false,
      onboarded: true,
    };
    // Live: PATCH /api/users/me in api.js, and our team is notified
    saveProfile(updated);
    fill();
    setUpLogout();
    success.textContent = "Your changes have been saved.";
    success.classList.add("is-visible");
  });

  // Optional verification with an ID document (live: POST /api/verifications, file upload)
  const verifyForm = document.getElementById("verify-form");
  if (verifyForm) verifyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const file = verifyForm.document.files[0];
    const problem = checkDocument(file);
    if (problem) { showError(verifyForm, problem); return; }
    showError(verifyForm, null);
    saveProfile({ ...loadProfile(), verification: "pending" });
    fill();
  });
}

/* Check an ID document before it is sent: JPG, PNG or PDF up to 5 MB */
function checkDocument(file) {
  if (!file) return "Please choose a photo or scan of your ID document.";
  if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) return "Please choose a JPG, PNG or PDF file.";
  if (file.size > 5 * 1024 * 1024) return "The file must be 5 MB or smaller.";
  return null;
}

/* Verification status on the profile page and the badge on the profile picture */
function showVerification(status) {
  const badge = document.querySelector("[data-verify-status]");
  const state = document.querySelector("[data-verify-state]");
  const verifyForm = document.getElementById("verify-form");
  const avatar = document.querySelector("[data-profile-avatar]");
  const shield = '<img src="assets/icons/shield.svg" alt="" width="16" height="16">';
  const texts = {
    approved: "Your profile is verified. The badge shows on your profile picture.",
    pending: "Your ID document is with our team. We will send you a notification when it has been checked.",
    rejected: "We could not verify your last document. You can send a clearer copy.",
  };
  if (badge) {
    badge.classList.toggle("verified--none", status !== "approved");
    badge.innerHTML = status === "approved" ? `${shield}Verified member` : status === "pending" ? "Verification pending" : "Not verified";
  }
  if (state) {
    state.textContent = texts[status] || "You have not asked for verification yet.";
    state.classList.toggle("is-verified", status === "approved");
  }
  if (verifyForm) verifyForm.hidden = status === "approved" || status === "pending";
  if (avatar) avatar.classList.toggle("is-verified", status === "approved");
}

/* Report a concern. In live mode api.js uses the Flask API. */
function setUpReport() {
  const form = document.getElementById("report-form");
  if (!form) return;
  const task = DEMO_TASKS[new URLSearchParams(window.location.search).get("task")];
  if (task) {
    form.querySelector("[data-report-about]").hidden = false;
    form.querySelector("[data-report-task]").textContent = task.title;
    form.querySelector("[name=about][value=task]").checked = true;
  }
  // "Something else" asks what the report is about (saved as other_details)
  const otherBox = form.querySelector("[data-other-only]");
  const toggleOther = () => {
    otherBox.hidden = (form.querySelector("[name=about]:checked") || {}).value !== "other";
  };
  form.querySelectorAll("[name=about]").forEach((r) => r.addEventListener("change", toggleOther));
  toggleOther();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const details = form.querySelector("#report-details");
    const problem = checkRequired(form, [[details.value.trim().length >= 20, "Please tell us a little more (at least 20 characters)."]]);
    if (problem) { showError(form, problem); return; }
    // Live: POST /api/reports with target_type, other_details and contact_allowed
    const done = document.getElementById("report-done");
    done.querySelector("[data-report-ref]").textContent = `QV-${1000 + Math.floor(Math.random() * 9000)}`;
    form.hidden = true;
    done.hidden = false;
  });
}

/* Admin: verify accounts and review concerns. In live mode api.js uses the Flask API. */
function setUpAdmin() {
  const admin = document.querySelector("[data-admin]");
  if (!admin) return;
  const tabs = admin.querySelectorAll(".dash-tab");
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    admin.querySelectorAll(".dash-panel").forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  }));
  const countAccounts = admin.querySelector("[data-count-accounts]");
  const countConcerns = admin.querySelector("[data-count-concerns]");
  const countChanges = admin.querySelector("[data-count-changes]");
  const minus = (el) => { if (el) el.textContent = Math.max(0, Number(el.textContent) - 1); };
  const setStatus = (box, text, cls) => { const l = box.querySelector("[data-status-label]"); l.textContent = text; l.className = `status status--${cls}`; };

  // ID documents: approve or reject, then the document is deleted
  admin.querySelectorAll("[data-admin-row]").forEach((row) => {
    const finish = (text, cls) => {
      setStatus(row, text, cls);
      row.querySelector(".cell-actions").innerHTML = '<span class="muted">Done</span>';
      const doc = row.querySelector("[data-view-document]");
      if (doc) doc.outerHTML = '<span class="muted">Deleted after the check</span>';
      minus(countAccounts);
    };
    row.querySelector("[data-approve]").addEventListener("click", () => finish("Verified", "accepted"));
    row.querySelector("[data-reject]").addEventListener("click", () => finish("Rejected", "declined"));
    const doc = row.querySelector("[data-view-document]");
    if (doc) doc.addEventListener("click", (e) => { e.preventDefault(); doc.textContent = "Demo only: no file"; });
  });
  // Members: suspend or reactivate an account
  admin.querySelectorAll("[data-member-row]").forEach((row) => {
    const btn = row.querySelector("[data-toggle-account]");
    btn.addEventListener("click", () => {
      const suspended = btn.textContent === "Suspend";
      setStatus(row, suspended ? "Suspended" : "Active", suspended ? "declined" : "accepted");
      btn.textContent = suspended ? "Reactivate" : "Suspend";
    });
  });
  // Profile changes: mark as checked
  admin.querySelectorAll("[data-change-card]").forEach((card) => {
    card.querySelector("[data-mark-checked]").addEventListener("click", (e) => {
      setStatus(card, "Checked", "done");
      e.currentTarget.replaceWith(Object.assign(document.createElement("span"), { className: "muted", textContent: "Checked" }));
      minus(countChanges);
    });
  });
  admin.querySelectorAll("[data-concern]").forEach((card) => {
    const finish = (text, cls) => {
      setStatus(card, text, cls);
      card.querySelector("[data-concern-actions]").innerHTML = `<span class="muted">${text}</span>`;
      minus(countConcerns);
    };
    card.querySelector("[data-resolve]").addEventListener("click", () => finish("Reviewed", "done"));
    // Suspend, then allow the admin to reactivate the account (US-12)
    card.querySelector("[data-suspend]").addEventListener("click", () => {
      finish("Account suspended", "declined");
      const actions = card.querySelector("[data-concern-actions]");
      actions.innerHTML = '<span class="muted">Account suspended</span><button class="btn btn--outline btn--small" type="button" data-reactivate>Reactivate account</button>';
      actions.querySelector("[data-reactivate]").addEventListener("click", () => {
        setStatus(card, "Reactivated", "accepted");
        actions.innerHTML = '<span class="muted">Account reactivated</span>';
      });
    });
    card.querySelector("[data-dismiss]").addEventListener("click", () => finish("Dismissed", "closed"));
  });
  // Reviews: hide a review from the member's profile, or restore it. Live: PATCH /api/admin/reviews/<id>/moderation
  const countHidden = admin.querySelector("[data-count-hidden]");
  admin.querySelectorAll("[data-review-card]").forEach((card) => {
    const hideBtn = card.querySelector("[data-hide-review]");
    const restoreBtn = card.querySelector("[data-restore-review]");
    const set = (hidden) => {
      setStatus(card, hidden ? "Hidden" : "Visible", hidden ? "declined" : "accepted");
      card.classList.toggle("is-hidden-review", hidden);
      hideBtn.hidden = hidden;
      restoreBtn.hidden = !hidden;
      if (countHidden) countHidden.textContent = admin.querySelectorAll(".is-hidden-review").length;
    };
    hideBtn.addEventListener("click", () => set(true));
    restoreBtn.addEventListener("click", () => set(false));
  });
}

/* Contact and forgot password forms. In live mode api.js uses the Flask API. */
function setUpSimpleForms() {
  [["contact-form", "Thank you. Your message has been sent and we will reply by email.", "#c-message"],
   ["forgot-form", "If an account uses that email, a reset link is on its way. Check your inbox.", null]].forEach(([id, message, minField]) => {
    const form = document.getElementById(id);
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const success = form.querySelector(".form-success");
      success.classList.remove("is-visible");
      const extra = minField ? [[form.querySelector(minField).value.trim().length >= 20, "Please write at least 20 characters."]] : [];
      const problem = checkRequired(form, extra);
      if (problem) { showError(form, problem); return; }
      showError(form, null);
      success.textContent = message;
      success.classList.add("is-visible");
      form.reset();
      form.querySelectorAll("[data-counter-for]").forEach((c) => { c.textContent = `0 / ${document.getElementById(c.dataset.counterFor).maxLength}`; });
    });
  });
}

/* Copy each column heading onto its cells so tables can stack as cards on phones */
function setUpTables() {
  document.querySelectorAll(".data-table").forEach((table) => {
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
    table.querySelectorAll("tbody tr").forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => { if (heads[i]) td.setAttribute("data-label", heads[i]); });
    });
  });
}

/* Both people confirm a task (US-10). Prototype only: confirmations are kept in the browser.
   Later: GET /api/me/tasks returns seeker_confirmed and volunteer_confirmed for each task. */
const CONFIRM_KEY = "qv_confirmations";
function loadConfirmations() {
  try { return JSON.parse(localStorage.getItem(CONFIRM_KEY)) || {}; } catch (e) { return {}; }
}
function saveConfirmation(taskId, who) {
  const all = loadConfirmations();
  all[taskId] = Array.from(new Set([...(all[taskId] || []), who]));
  try { localStorage.setItem(CONFIRM_KEY, JSON.stringify(all)); } catch (e) { /* storage blocked */ }
}
function setUpConfirmations() {
  const all = loadConfirmations();
  document.querySelectorAll("[data-confirm-task]").forEach((row) => {
    const done = all[row.dataset.confirmTask] || [];
    if (!done.length) return;
    const label = row.querySelector("[data-status-label]");
    const actions = row.querySelector(".trow__actions");
    if (done.length >= 2) {
      label.textContent = "Completed";
      label.className = "status status--done";
      if (actions) actions.innerHTML = "";
    } else {
      label.textContent = `Waiting for ${row.dataset.other || "the other person"} to confirm`;
      label.className = "status status--pending";
      if (actions) actions.innerHTML = '<span class="muted">You confirmed</span>';
    }
  });
}

/* Skills matching (US-13). A task matches when one of the skills it needs is one of
   the member's skills. Only shown when the member has chosen skills.
   The live site gives each card the task's skills from GET /api/tasks/<id>/skills. */
function hasSkills(profile) {
  return profile.role !== "help_seeker" && Array.isArray(profile.skills) && profile.skills.length > 0;
}
function markMatches() {
  const profile = loadProfile();
  const on = hasSkills(profile);
  document.querySelectorAll("[data-needs-skills]").forEach((el) => { el.hidden = !on; });
  document.querySelectorAll(".task-card").forEach((card) => {
    const needs = (card.dataset.skills || "").split(",").filter(Boolean);
    const match = on && needs.some((k) => profile.skills.includes(k));
    card.dataset.match = String(match);
    card.classList.toggle("task-card--match", match);
    const old = card.querySelector(".match-ribbon");
    if (old) old.remove();
    if (match) {
      const ribbon = document.createElement("p");
      ribbon.className = "match-ribbon";
      ribbon.innerHTML = '<img src="assets/icons/check.svg" alt="" width="16" height="16">Matches your skills';
      card.prepend(ribbon);
    }
  });
}

/* Distances (approximate), worked out in the browser from postcode districts.
   js/postcode-districts.js holds the centre point of each district, for example E8.
   No postcode is sent anywhere to do this. */
const isPostcode = (value) => /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test((value || "").trim());
function districtOf(postcode) {
  if (!postcode || !window.QV_DISTRICTS) return null;
  const compact = String(postcode).toUpperCase().replace(/\s+/g, "");
  const outward = compact.length > 4 ? compact.slice(0, -3) : compact;
  return window.QV_DISTRICTS[outward] ? outward : null;
}
function milesBetween(a, b) {
  const p = window.QV_DISTRICTS[a];
  const q = window.QV_DISTRICTS[b];
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(q[0] - p[0]) / 2) ** 2 +
    Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(rad(q[1] - p[1]) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
function taskMiles(card, profile) {
  const home = districtOf(profile.postcode);
  const there = districtOf(card.dataset.postcode);
  if (!home || !there || card.dataset.mode !== "in_person") return null;
  return Math.round(milesBetween(home, there) * 10) / 10;
}
function showDistances(root) {
  root.querySelectorAll(".task-card").forEach((card) => {
    const slot = card.querySelector("[data-distance]");
    if (!slot) return;
    const miles = card.dataset.miles;
    slot.textContent = miles === "" || miles == null ? "" : (Number(miles) < 0.5 ? "under half a mile away" : `about ${miles} miles away`);
  });
}
const escapeHtml = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Ask for Help: logged-in members go straight to Post a help request; visitors go to Sign up
   with a short explanation. Later: Flask knows who is logged in and sends the right link. */
function isLoggedIn() {
  const p = loadProfile();
  return !!(p.loggedIn || p.email || p.name);
}
function setUpAskLinks() {
  if (isLoggedIn()) {
    document.querySelectorAll('a[href="signup.html?from=ask"]').forEach((a) => { a.href = "post-request.html"; });
  }
  const note = document.querySelector("[data-ask-note]");
  if (note && new URLSearchParams(window.location.search).get("from") === "ask") note.hidden = false;
}

/* Public pages carry both header versions; show the logged in one when the visitor is logged in */
function setUpAuthHeader() {
  const p = loadProfile();
  const inNow = !!(p.loggedIn || p.email || p.name);
  document.querySelectorAll("[data-auth]").forEach((el) => {
    el.hidden = (el.dataset.auth === "in") !== inNow;
  });
}
