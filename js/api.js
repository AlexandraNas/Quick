// QuickVolunteer · connection to the Flask API (MySQL)
//
// How it works
// - When the pages are served by Flask, /api/csrf-token answers and the site runs in
//   "live" mode: every form and list below talks to the real API.
// - When the pages are opened without Flask (GitHub Pages, Live Server, file://), the
//   check fails and the site keeps working as the demo prototype in main.js.
// - main.js does the shared work in the browser (filters, distances, suggestions);
//   this file fills the pages with real data and sends the forms to the API.
//
// Security: the session is a Flask cookie, every POST/PATCH/PUT/DELETE sends the CSRF
// token, and no password or database detail is ever stored in the browser.

(function () {
  "use strict";

  const QV = (window.QV = { live: false, me: null, profile: null, skills: [], mySkillIds: new Set() });
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const params = new URLSearchParams(location.search);
  let csrfToken = null;

  /* ---------- Small helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
  const monthYear = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "");
  const dayNum = (iso) => (iso ? new Date(iso).getDate() : "");
  const monthShort = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short" }) : "");
  const personName = (first, initial) => (first ? `${first}${initial ? " " + initial + "." : ""}` : "A neighbour");
  const completedText = (n) => `${n} completed task${n === 1 ? "" : "s"}`;
  const shield = (size = 14) => `<img src="assets/icons/shield.svg" alt="" width="${size}" height="${size}">`;

  function storeGet(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } }
  function storeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ } }

  // Show a message in a form's error box (or create one if the form has none)
  function formError(form, message) {
    if (!form) { if (message) window.alert(message); return; }
    let box = form.querySelector(".form-error");
    if (!box) {
      box = document.createElement("div");
      box.className = "form-error";
      box.setAttribute("role", "alert");
      box.innerHTML = '<img src="assets/icons/alert.svg" alt="" width="18" height="18"><span></span>';
      form.insertBefore(box, form.querySelector("[type=submit]") || null);
    }
    box.querySelector("span").textContent = message || "";
    box.classList.toggle("is-visible", !!message);
  }

  function busy(button, on, text) {
    if (!button) return;
    if (on) { button.dataset.label = button.textContent; button.disabled = true; if (text) button.textContent = text; }
    else { button.disabled = false; if (button.dataset.label) button.textContent = button.dataset.label; }
  }

  /* ---------- API calls ---------- */
  async function getCsrf() {
    const r = await fetch("/api/csrf-token", { credentials: "same-origin" });
    csrfToken = (await r.json()).csrf_token;
    return csrfToken;
  }

  // body: an object (sent as JSON) or FormData (file upload)
  async function api(method, path, body, options = {}) {
    const headers = { Accept: "application/json" };
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    if (method !== "GET") {
      headers["X-CSRFToken"] = csrfToken || (await getCsrf());
      if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    }
    const response = await fetch(path, {
      method, headers, credentials: "same-origin", keepalive: !!options.keepalive,
      body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
    });
    let data = {};
    try { data = await response.json(); } catch (e) { /* no JSON body */ }
    if (!response.ok) {
      // A stale CSRF token (for example after logging in) is refreshed once
      if (response.status === 400 && /csrf/i.test(JSON.stringify(data)) && !options.retried) {
        await getCsrf();
        return api(method, path, body, { ...options, retried: true });
      }
      const error = new Error(data.error || friendlyStatus(response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
  QV.api = api;

  function friendlyStatus(status) {
    if (status === 401) return "Please log in first.";
    if (status === 403) return "You do not have permission to do that.";
    if (status === 404) return "We could not find that.";
    if (status === 409) return "That has already been done or is no longer possible.";
    if (status === 413) return "The file is too large.";
    return "Something went wrong. Please try again.";
  }

  async function detectBackend() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const r = await fetch("/api/csrf-token", { credentials: "same-origin", signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) return false;
      csrfToken = (await r.json()).csrf_token || null;
      return !!csrfToken;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Who is logged in: keep qv_profile in step with MySQL ---------- */
  const PROTECTED = ["dashboard.html", "my-tasks.html", "my-requests.html", "post-request.html", "profile.html",
    "review.html", "request.html", "onboarding.html", "admin.html", "report.html"];
  const roleOf = () => (QV.me ? QV.me.account_type : null);
  const canVolunteer = () => ["volunteer", "both"].includes(roleOf());
  const canAsk = () => ["help_seeker", "both"].includes(roleOf());

  // Availability is saved as readable text, for example "Days: Mon, Sat. Times: Evenings."
  const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const TIME_LABELS = { morning: "Mornings", afternoon: "Afternoons", evening: "Evenings" };
  function availabilityText(days, times) {
    const d = (days || []).map((k) => DAY_LABELS[k]).filter(Boolean);
    const t = (times || []).map((k) => TIME_LABELS[k]).filter(Boolean);
    const parts = [];
    if (d.length) parts.push(`Days: ${d.join(", ")}.`);
    if (t.length) parts.push(`Times: ${t.join(", ")}.`);
    return parts.join(" ") || null;
  }
  function availabilityParse(text) {
    const pick = (labels) => Object.keys(labels).filter((k) => new RegExp(`\\b${labels[k]}\\b`).test(text || ""));
    return { days: pick(DAY_LABELS), times: pick(TIME_LABELS) };
  }

  async function loadMe() {
    try { QV.me = (await api("GET", "/api/me")).user; } catch (e) { QV.me = null; }
    if (!QV.me) {
      ["qv_profile", "qv_confirmations"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      refreshHeader();
      return;
    }
    let profile = {};
    try { profile = (await api("GET", "/api/users/me/profile")).profile; } catch (e) { /* ignore */ }
    QV.profile = profile;
    QV.mySkillIds = new Set((profile.skills || []).map((s) => s.skill_id));

    let verification = profile.verified ? "approved" : null;
    if (!verification && QV.me.account_type !== "admin") {
      try {
        const latest = ((await api("GET", "/api/verifications/me")).verifications || [])[0];
        verification = latest ? latest.status : null;
      } catch (e) { /* ignore */ }
    }
    const old = storeGet("qv_profile", {});
    const sameUser = old.userId === QV.me.user_id;
    const availability = availabilityParse(profile.availability_notes);
    storeSet("qv_profile", {
      ...(sameUser ? old : {}),
      userId: QV.me.user_id,
      firstName: QV.me.first_name,
      lastName: QV.me.last_name,
      name: `${QV.me.first_name} ${QV.me.last_name}`,
      email: QV.me.email,
      role: QV.me.account_type === "admin" ? "both" : QV.me.account_type,
      postcode: profile.postcode || "",
      area: profile.neighbourhood || "",
      distance: profile.max_distance_miles ? String(profile.max_distance_miles) : "",
      mode: profile.preferred_mode || "any",
      bio: profile.about_me || "",
      skills: (profile.skills || []).map((s) => s.skill_name),
      days: availability.days,
      times: availability.times,
      verification,
      since: monthYear(profile.created_at),
      onboarded: QV.me.skill_count > 0,
      loggedIn: true,
    });
    refreshHeader();
  }

  function refreshHeader() {
    ["setUpAuthHeader", "setUpLogout", "setUpAskLinks"].forEach((fn) => { if (typeof window[fn] === "function") window[fn](); });
  }

  async function loadSkills() {
    try { QV.skills = (await api("GET", "/api/skills")).skills || []; } catch (e) { QV.skills = []; }
  }
  const skillIdsFromNames = (names) => QV.skills.filter((s) => names.includes(s.skill_name)).map((s) => s.skill_id);

  // Replace the demo skill chips with the skills stored in MySQL
  function renderSkillChips(inputName) {
    const first = $(`[name="${inputName}"]`);
    if (!first || !QV.skills.length) return;
    const box = first.closest(".chips");
    const checked = new Set($$(`[name="${inputName}"]:checked`).map((b) => b.value));
    const mine = storeGet("qv_profile", {}).skills || [];
    box.innerHTML = QV.skills.map((s) => {
      const on = checked.has(s.skill_name) || (inputName === "skills" && mine.includes(s.skill_name));
      return `<label class="choice-chip"><input type="checkbox" name="${inputName}" value="${esc(s.skill_name)}" data-skill-id="${s.skill_id}"${on ? " checked" : ""}><span>${esc(s.skill_name)}</span></label>`;
    }).join("");
  }

  // Send a profile (onboarding, skip, profile page) to MySQL. Changes notify the admins.
  function profileToApi(p) {
    const body = {};
    if (p.firstName) body.first_name = p.firstName;
    if (p.lastName) body.last_name = p.lastName;
    if (p.postcode !== undefined) body.postcode = p.postcode || null;
    if (p.area !== undefined) body.neighbourhood = p.area || null;
    if (p.distance) body.max_distance_miles = Number(p.distance);
    if (p.mode) body.preferred_mode = p.mode;
    if (p.role && QV.me && QV.me.account_type !== "admin") body.account_type = p.role;
    if (p.bio !== undefined) body.about_me = p.bio || null;
    if (p.days || p.times) body.availability_notes = availabilityText(p.days, p.times);
    return body;
  }
  async function saveProfileLive(p, keepalive) {
    const calls = [api("PATCH", "/api/users/me", profileToApi(p), { keepalive })];
    const ids = skillIdsFromNames(p.skills || []);
    if (ids.length) calls.push(api("PUT", "/api/users/me/skills", { skill_ids: ids }, { keepalive }));
    return Promise.all(calls);
  }
  function wrapSaveProfile() {
    const original = window.saveProfile;
    if (typeof original !== "function") return;
    window.saveProfile = function (profile) {
      original(profile);
      if (!QV.live || !QV.me || QV.me.account_type === "admin") return;
      if (page === "onboarding.html") saveProfileLive(profile, true).catch(() => {});
    };
  }

  /* ---------- Task cards (same data attributes as the demo cards in main.js) ---------- */
  async function loadOpenTasks() {
    const tasks = await api("GET", "/api/tasks");
    await Promise.all(tasks.map(async (t) => {
      try { t.skills = (await api("GET", `/api/tasks/${t.task_id}/skills`)).skills || []; } catch (e) { t.skills = []; }
    }));
    return tasks;
  }

  function taskCard(t) {
    const remote = t.delivery_mode === "remote";
    const who = personName(t.creator_first_name, t.creator_last_initial);
    const when = fmtDate(t.deadline_at);
    const where = remote
      ? '<p class="meta"><img src="assets/icons/laptop-meta.svg" alt="" width="16" height="16">Online or by phone</p>'
      : `<p class="meta"><img src="assets/icons/pin-meta.svg" alt="" width="16" height="16"><span>${esc(t.location_text || "In person")}</span><span data-distance></span></p>`;
    const skills = (t.skills || []).map((s) => s.skill_name).join(",");
    return `<article class="task-card" data-id="${t.task_id}" data-mode="${remote ? "remote" : "in_person"}" data-minutes="${t.estimated_minutes}" data-match="false" data-category="${t.category_id || ""}" data-skills="${esc(skills)}" data-area="${esc(remote ? "" : t.location_text || "")}" data-postcode="${esc(t.postcode || "")}" data-verified="${t.creator_verified ? "true" : "false"}">
      <div class="task-card__top">${remote
        ? '<span class="tag tag--remote"><img src="assets/icons/laptop-tag.svg" alt="" width="14" height="14">Remote</span>'
        : '<span class="tag tag--in-person"><img src="assets/icons/pin-tag.svg" alt="" width="14" height="14">In person</span>'}<span class="time-badge"><img src="assets/icons/clock.svg" alt="" width="14" height="14">${t.estimated_minutes} min</span></div>
      <h2><a href="task.html?id=${t.task_id}">${esc(t.title)}</a></h2>
      <div class="requester"><span class="avatar avatar--xs${t.creator_verified ? " is-verified" : ""}">${esc(who.charAt(0))}</span><span>${esc(who)}</span>${t.creator_verified ? `<span class="verified-dot" title="Verified member">${shield(13)}Verified</span>` : ""}</div>
      <div class="task-card__meta">
        <p class="meta"><img src="assets/icons/cal.svg" alt="" width="16" height="16">Complete by ${esc(when || "")}</p>
        ${where}
      </div>
      <div class="task-card__spacer"></div>
      <div class="task-card__foot">
        <a class="report" href="report.html?task=${t.task_id}"><img src="assets/icons/flag.svg" alt="" width="14" height="14">Report</a>
        <a class="btn-view" href="task.html?id=${t.task_id}">View task <span aria-hidden="true">→</span></a>
      </div>
    </article>`;
  }

  // Member summary (same markup as member_box in the page generator)
  function memberBox(prefix, m) {
    const tags = (m.skills || []).map((k) => `<span class="skill-tag">${esc(k)}</span>`).join("");
    return `<div class="member-box">
      <div class="person-line">
        <span class="avatar avatar--sm${m.verified ? " is-verified" : ""}">${esc(m.display_name.charAt(0))}</span>
        <div>
          <p><strong data-${prefix}-name>${esc(m.display_name)}</strong> ${m.verified ? `<span class="verified">${shield()}Verified</span>` : ""}</p>
          <p class="muted small">Member since ${esc(monthYear(m.member_since))} · ${completedText(m.completed_tasks)}</p>
        </div>
      </div>
      <p class="quote">${esc(m.about_me || "")}</p>
      <div class="skill-tags">${tags}</div>
    </div>`;
  }

  /* ---------- Find a task ---------- */
  async function liveFindPage() {
    const list = $("#task-list");
    if (!list) return;
    list.innerHTML = '<p class="muted">Loading tasks…</p>';
    try {
      const [tasks, categories] = await Promise.all([loadOpenTasks(), api("GET", "/api/categories").catch(() => [])]);
      const typeBox = $("#task-type");
      if (typeBox && categories.length) {
        typeBox.innerHTML = '<option value="">All types</option>' +
          categories.map((c) => `<option value="${c.category_id}">${esc(c.category_name)}</option>`).join("");
      }
      // The member's own requests are not listed as tasks to help with
      const visible = tasks.filter((t) => !QV.me || t.creator_id !== QV.me.user_id);
      list.innerHTML = visible.map(taskCard).join("");
      if (typeof window.setUpTaskFilters === "function") window.setUpTaskFilters();
    } catch (e) {
      list.innerHTML = `<p class="muted">We could not load tasks right now. ${esc(e.message)}</p>`;
    }
  }

  /* ---------- Dashboard ---------- */
  async function liveDashboard() {
    if (typeof window.setUpDashboard === "function") window.setUpDashboard();
    const give = $('.dash-panel[data-panel="give"]');
    const ask = $('.dash-panel[data-panel="ask"]');
    if (give) {
      // Suggestions: main.js picks by skills, then location, or hides the section
      const list = $("[data-suggestion-list]", give);
      if (list) {
        try {
          const tasks = (await loadOpenTasks()).filter((t) => t.creator_id !== QV.me.user_id);
          list.innerHTML = tasks.map(taskCard).join("");
        } catch (e) { list.innerHTML = ""; }
        if (typeof window.updateSuggestions === "function") window.updateSuggestions();
      }
      const rows = $$(".list-rows", give)[0];
      const historyNote = $("[data-history-note]", give);
      if (canVolunteer()) {
        try {
          const apps = (await api("GET", "/api/my-applications")).applications || [];
          const active = apps.filter((a) => ["pending", "accepted"].includes(a.application_status) && ["open", "filled"].includes(a.task_status));
          if (rows) rows.innerHTML = active.length ? active.slice(0, 4).map((a) => `<li><span><strong>${esc(a.title)}</strong>${a.deadline_at ? " · by " + esc(fmtDate(a.deadline_at)) : ""}</span><span class="status ${a.application_status === "accepted" ? "status--accepted" : "status--pending"}">${a.application_status === "accepted" ? "Accepted" : "Offered · waiting"}</span></li>`).join("")
            : '<li><span class="muted">No tasks yet. Offer to help with a task to see it here.</span></li>';
          // Own history: the latest completed tasks (no hours or totals)
          const done = apps.filter((a) => a.application_status === "completed");
          if (historyNote && done.length) historyNote.textContent = `Latest: ${done.slice(0, 3).map((a) => a.title).join(" · ")}`;
        } catch (e) { /* not a volunteer */ }
      }
    }
    if (ask) {
      const rows = $(".list-rows", ask);
      if (rows && canAsk()) {
        try {
          const tasks = ((await api("GET", "/api/my-tasks")).tasks || []).filter((t) => ["open", "filled"].includes(t.status));
          rows.innerHTML = tasks.length ? tasks.slice(0, 4).map((t) => `<li><span><strong>${esc(t.title)}</strong> · Complete by ${esc(fmtDate(t.deadline_at))}</span><a class="status ${t.status === "filled" ? "status--accepted" : "status--pending"}" href="request.html?id=${t.task_id}">${t.status === "filled" ? "Volunteer accepted · view" : "Open · view offers"}</a></li>`).join("")
            : '<li><span class="muted">No requests yet. Post one when you need a hand.</span></li>';
        } catch (e) { /* not a help seeker */ }
      }
    }
    submitPendingReviews();
  }

  /* ---------- Task details: requester summary, offer and withdraw ---------- */
  async function liveTaskPage() {
    const pageEl = $("[data-task-page]");
    if (!pageEl) return;
    const id = Number(params.get("id"));
    let task = null;
    try { task = (await api("GET", "/api/tasks")).find((t) => t.task_id === id) || null; } catch (e) { /* ignore */ }
    let myApplication = null;
    if (QV.me && canVolunteer()) {
      try {
        myApplication = ((await api("GET", "/api/my-applications")).applications || []).find((a) => a.task_id === id) || null;
        if (!task && myApplication) task = { ...myApplication, task_id: id };
      } catch (e) { /* ignore */ }
    }
    const form = $("#offer-form");
    const sent = $("#offer-sent");
    if (!task) {
      $("[data-task-title]").textContent = "This task is no longer open";
      $("[data-task-description]").textContent = "Someone may already be helping, or the request was closed.";
      if (form) form.hidden = true;
      const who = $(".member-box", pageEl);
      if (who) who.closest(".detail-section").hidden = true;
      return;
    }
    const set = (sel, value) => $$(sel, pageEl).forEach((el) => { el.textContent = value; });
    const remote = task.delivery_mode === "remote";
    document.title = `${task.title} · QuickVolunteer`;
    set("[data-task-title]", task.title);
    set("[data-task-minutes]", task.estimated_minutes);
    set("[data-task-when]", fmtDate(task.deadline_at) || "");
    set("[data-task-where]", remote ? "Online or by phone" : (task.location_text || "In person"));
    set("[data-task-description]", task.description || "");
    const tag = $(".task-card__top [data-task-tag], .task-card__top .tag", pageEl);
    if (tag) tag.outerHTML = remote
      ? '<span class="tag tag--remote"><img src="assets/icons/laptop-tag.svg" alt="" width="14" height="14">Remote</span>'
      : '<span class="tag tag--in-person"><img src="assets/icons/pin-tag.svg" alt="" width="14" height="14">In person</span>';
    const report = $("[data-task-report]", pageEl);
    if (report) report.href = `report.html?task=${id}`;

    // What volunteers can see about the requester
    const creatorId = task.creator_id;
    const box = $(".member-box", pageEl);
    if (box && creatorId) {
      try {
        const member = (await api("GET", `/api/users/${creatorId}/summary`)).member;
        box.outerHTML = memberBox("requester", member);
      } catch (e) { box.closest(".detail-section").hidden = true; }
    }

    // Skills the task needs, highlighting the volunteer's own
    const skillBox = $("[data-task-skills]", pageEl);
    let skills = [];
    try { skills = (await api("GET", `/api/tasks/${id}/skills`)).skills || []; } catch (e) { /* ignore */ }
    if (skillBox) {
      skillBox.innerHTML = skills.length ? skills.map((s) => {
        const mine = QV.mySkillIds.has(s.skill_id);
        return `<span class="skill-tag${mine ? " skill-tag--match" : ""}">${esc(s.skill_name)}${s.importance === "required" ? " · needed" : ""}${mine ? " · your skill" : ""}</span>`;
      }).join("") : '<span class="muted">No particular skills needed.</span>';
    }
    const matched = skills.filter((s) => QV.mySkillIds.has(s.skill_id)).map((s) => s.skill_name);
    const matchBox = $("[data-task-match]", pageEl);
    if (matchBox) {
      matchBox.hidden = !matched.length;
      if (matched.length) $("[data-task-match-text]", pageEl).textContent = `It matches your skills: ${matched.join(", ")}.`;
    }

    const withdraw = $("#withdraw-offer");
    if (withdraw) {
      const fresh = withdraw.cloneNode(true);
      withdraw.replaceWith(fresh);
      fresh.hidden = !myApplication || !["pending", "accepted"].includes(myApplication.application_status);
      if (myApplication) fresh.dataset.liveWithdraw = myApplication.application_id;
    }
    if (myApplication && form && sent) {
      form.hidden = true;
      sent.hidden = false;
      const labels = { pending: "waiting for the requester", accepted: "accepted", rejected: "declined", completed: "completed" };
      $("[data-offer-status]", sent).textContent = `Your offer is ${labels[myApplication.application_status] || myApplication.application_status}.`;
    } else if (QV.me && task.creator_id === QV.me.user_id && form) {
      form.innerHTML = '<h2>This is your request</h2><p class="body">You can follow the offers from <a class="link-green" href="my-requests.html">My requests</a>.</p>';
    } else if (QV.me && !canVolunteer() && form) {
      form.innerHTML = '<h2>Offer to help</h2><p class="body">Your account is set up for asking for help only. You can change this in <a class="link-green" href="profile.html">your profile</a>.</p>';
    }
  }

  async function submitOffer(form) {
    const id = Number(params.get("id"));
    if (!QV.me) { location.href = `login.html?next=${encodeURIComponent("task.html?id=" + id)}`; return; }
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Sending…");
    try {
      const result = await api("POST", `/api/tasks/${id}/apply`);
      form.hidden = true;
      const sent = $("#offer-sent");
      const withdraw = $("#withdraw-offer");
      if (withdraw) { withdraw.hidden = false; withdraw.dataset.liveWithdraw = result.application_id; }
      if (sent) { sent.hidden = false; const h = $("h2", sent); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); } }
    } catch (e) {
      formError(form, e.message);
    } finally { busy(button, false); }
  }

  // Withdraw: the offer is deleted and the help seeker is told
  async function withdrawOffer(button) {
    if (!window.confirm("Withdraw your offer? The requester will be told.")) return;
    busy(button, true, "Withdrawing…");
    try {
      await api("DELETE", `/api/applications/${button.dataset.liveWithdraw}`);
      if (page === "task.html") {
        $("#offer-sent").hidden = true;
        const form = $("#offer-form");
        if (form) form.hidden = false;
      } else {
        await liveMyTasks();
      }
    } catch (e) { window.alert(e.message); busy(button, false); }
  }

  /* ---------- Post a help request ---------- */
  async function livePostPage() {
    const form = $("#post-form");
    if (!form) return;
    if (QV.me && !canAsk()) {
      form.innerHTML = '<h1 class="h-section">Post a help request</h1><p class="body">Your account is set up for giving help only. You can change this in <a class="link-green" href="profile.html">your profile</a>.</p>';
      return;
    }
    try {
      const categories = await api("GET", "/api/categories");
      const select = $("#req-category");
      if (select && categories.length) {
        select.innerHTML = '<option value="">Choose an option</option>' +
          categories.map((c) => `<option value="${c.category_id}">${esc(c.category_name)}</option>`).join("");
      }
    } catch (e) { /* keep the demo list */ }
    renderSkillChips("req-skills");
  }

  async function submitPost(form) {
    const title = $("#req-title", form);
    const description = $("#req-description", form);
    const deadline = $("#req-deadline", form);
    const mode = ($("[name=req-mode]:checked", form) || {}).value;
    const inPerson = mode === "in_person";
    const problem = window.checkRequired(form, [
      [title.value.trim().length <= 60, "Please keep the title to 60 characters or fewer."],
      [description.value.trim().length >= 20, "Please add a little more detail to the description (at least 20 characters)."],
      [!!deadline.value, "Please choose the date the task should be done by."],
      [$("#req-confirm", form).checked, "Please confirm the task is small and safe."],
    ]);
    if (problem) { formError(form, problem); return; }
    formError(form, null);
    const body = {
      title: title.value.trim(),
      description: description.value.trim(),
      category_id: Number($("#req-category", form).value),
      delivery_mode: mode,
      estimated_minutes: Number(($("[name=req-duration]:checked", form) || {}).value),
      deadline_at: `${deadline.value}T23:59:00`,
    };
    if (inPerson) {
      body.postcode = $("#req-postcode", form).value.trim();
      body.location_text = $("#req-area", form).value.trim();
    }
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Posting…");
    try {
      const created = await api("POST", "/api/tasks", body);
      const ids = $$("[name=req-skills]:checked", form).map((b) => Number(b.dataset.skillId)).filter(Boolean);
      if (ids.length) await api("PUT", `/api/tasks/${created.task_id}/skills`, { skill_ids: ids }).catch(() => {});
      const done = $("#post-done");
      $("[data-done-title]", done).textContent = `“${body.title}”`;
      form.hidden = true;
      done.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      formError(form, e.message);
    } finally { busy(button, false); }
  }

  /* ---------- My requests ---------- */
  async function loadMyTasksWithOffers() {
    const tasks = (await api("GET", "/api/my-tasks")).tasks || [];
    await Promise.all(tasks.map(async (t) => {
      try { t.applications = (await api("GET", `/api/tasks/${t.task_id}/applications`)).applications || []; } catch (e) { t.applications = []; }
    }));
    return tasks;
  }

  function requestStatus(t) {
    const pending = t.applications.filter((a) => a.status === "pending").length;
    const accepted = t.applications.find((a) => a.status === "accepted" || a.status === "completed");
    if (t.status === "open") return { group: "open", cls: "status--pending", text: pending ? `${pending} offer${pending > 1 ? "s" : ""}` : "No offers yet" };
    if (t.status === "filled") return { group: "accepted", cls: "status--accepted", text: `Accepted · ${accepted ? personName(accepted.first_name, accepted.last_initial) : "volunteer"}` };
    if (t.status === "completed") return { group: "completed", cls: "status--done", text: "Completed" };
    return { group: "closed", cls: "status--closed", text: "Closed" };
  }

  async function liveMyRequests() {
    const list = $("[data-rows]");
    if (!list) return;
    list.innerHTML = '<li class="muted">Loading your requests…</li>';
    try {
      const tasks = await loadMyTasksWithOffers();
      list.innerHTML = tasks.map((t) => {
        const s = requestStatus(t);
        const canClose = t.status === "open" || t.status === "filled";
        return `<li class="row-card" data-status="${s.group}">
          <div class="row-card__main">
            <h2><a href="request.html?id=${t.task_id}">${esc(t.title)}</a></h2>
            <p class="meta-line"><span>Complete by ${esc(fmtDate(t.deadline_at))}</span><span>${t.delivery_mode === "remote" ? "Remote" : "In person"}</span><span>${t.estimated_minutes} min</span></p>
          </div>
          <span class="status ${s.cls}" data-status-label>${esc(s.text)}</span>
          <div class="row-card__actions">
            <a class="btn btn--small ${t.status === "open" ? "btn--primary" : "btn--outline"}" href="request.html?id=${t.task_id}">${t.status === "open" ? "View offers" : "View details"}</a>
            ${canClose ? `<button class="link-button" type="button" data-live-close="${t.task_id}">Close request</button>` : ""}
          </div>
        </li>`;
      }).join("");
      const empty = $("[data-rows-empty]");
      if (empty) empty.classList.toggle("is-visible", !tasks.length);
      if (typeof window.setUpRowFilters === "function") window.setUpRowFilters();
    } catch (e) {
      list.innerHTML = `<li class="muted">${esc(e.message)}</li>`;
    }
    submitPendingReviews();
  }

  async function closeRequest(taskId, button) {
    if (!window.confirm("Close this request? Volunteers who offered will be told.")) return;
    busy(button, true, "Closing…");
    try {
      await api("PATCH", `/api/tasks/${taskId}/cancel`);
      if (page === "request.html") location.reload(); else liveMyRequests();
    } catch (e) { window.alert(e.message); busy(button, false); }
  }

  /* ---------- One request: volunteer offers with their summary ---------- */
  async function liveRequestPage() {
    const id = Number(params.get("id"));
    const card = $(".detail-card");
    if (!card) return;
    let task = null;
    try { task = (await loadMyTasksWithOffers()).find((t) => t.task_id === id) || null; } catch (e) { /* ignore */ }
    const section = $('[aria-labelledby="offers-title"]');
    if (!task) {
      $(".detail-title", card).textContent = "Request not found";
      $(".body", card).textContent = "This request does not exist or belongs to another account.";
      $$("[data-offer]").forEach((o) => o.remove());
      return;
    }
    const s = requestStatus(task);
    const remote = task.delivery_mode === "remote";
    document.title = `${task.title} · QuickVolunteer`;
    $(".detail-title", card).textContent = task.title;
    $(".body", card).textContent = task.description;
    const tag = $(".task-card__top .tag", card);
    if (tag) tag.outerHTML = remote
      ? '<span class="tag tag--remote"><img src="assets/icons/laptop-tag.svg" alt="" width="14" height="14">Remote</span>'
      : '<span class="tag tag--in-person"><img src="assets/icons/pin-tag.svg" alt="" width="14" height="14">In person</span>';
    const status = $("[data-request-status]", card);
    status.textContent = s.text;
    status.className = `status ${s.cls}`;
    const dd = $$(".detail-list dd", card);
    if (dd[0]) dd[0].textContent = fmtDate(task.deadline_at) || "";
    if (dd[1]) dd[1].textContent = remote ? "Online or by phone" : (task.location_text || "In person");
    if (dd[2]) dd[2].textContent = `${task.estimated_minutes} minutes`;
    // A posted request cannot be edited; the owner can close it
    const closeBtn = $("[data-close-request]", card);
    if (closeBtn) {
      const fresh = closeBtn.cloneNode(true);
      fresh.removeAttribute("data-close-request");
      fresh.hidden = !(task.status === "open" || task.status === "filled");
      fresh.addEventListener("click", () => closeRequest(id, fresh));
      closeBtn.replaceWith(fresh);
    }

    $$("[data-offer], [data-live-offer]", section).forEach((o) => o.remove());
    const offers = task.applications;
    if (!offers.length) {
      section.insertAdjacentHTML("beforeend", '<p class="empty-note" data-live-offer>No offers yet. We will send you a notification when a volunteer offers to help.</p>');
    }
    const labels = { pending: "Waiting for your answer", accepted: "Accepted", rejected: "Declined", completed: "Completed" };
    offers.forEach((a) => {
      const member = a.volunteer || { display_name: personName(a.first_name, a.last_initial), member_since: null, verified: false, completed_tasks: 0, skills: [], about_me: "" };
      section.insertAdjacentHTML("beforeend", `<article class="offer-card${a.status === "accepted" ? " is-accepted" : a.status === "rejected" ? " is-declined" : ""}" data-live-offer>
        ${memberBox("offer", member)}
        ${a.status === "pending" && task.status === "open" ? `<div class="offer-card__actions">
          <button class="btn btn--primary btn--small" type="button" data-live-decision="accepted" data-app="${a.application_id}">Accept</button>
          <button class="btn btn--outline btn--small" type="button" data-live-decision="rejected" data-app="${a.application_id}">Decline</button>
        </div>` : `<p class="offer-result">${esc(labels[a.status] || a.status)}</p>`}
        <a class="report report--left" href="report.html?user=${a.volunteer_id}&amp;task=${task.task_id}"><img src="assets/icons/flag.svg" alt="" width="14" height="14">Report this member</a>
      </article>`);
    });

    // Confirm completed: only once a volunteer has been accepted
    const accepted = offers.find((a) => a.status === "accepted");
    const link = $("[data-complete-link]");
    if (link) {
      link.hidden = !(task.status === "filled" && accepted && !accepted.help_seeker_completed_at);
      if (accepted) {
        const other = personName(accepted.first_name, accepted.last_initial);
        link.href = `review.html?task=${task.task_id}&app=${accepted.application_id}&as=seeker&other=${encodeURIComponent(other)}`;
      }
    }
  }

  async function decideOffer(button) {
    const decision = button.dataset.liveDecision;
    if (decision === "accepted" && !window.confirm("Accept this volunteer? The other offers will be declined.")) return;
    busy(button, true);
    try {
      await api("PATCH", `/api/applications/${button.dataset.app}/decision`, { decision });
      await liveRequestPage();
    } catch (e) { window.alert(e.message); busy(button, false); }
  }

  /* ---------- My tasks (volunteer): upcoming, waiting, own history (no hours) ---------- */
  async function liveMyTasks() {
    const sections = $$(".tsec");
    if (sections.length < 3) return;
    let apps = [];
    try { apps = (await api("GET", "/api/my-applications")).applications || []; } catch (e) {
      $(".trow-list", sections[0]).innerHTML = `<li class="muted">${esc(e.status === 403 ? "Your account is set up for asking for help only." : e.message)}</li>`;
      return;
    }
    const upcoming = apps.filter((a) => a.application_status === "accepted" && a.task_status === "filled");
    const waiting = apps.filter((a) => a.application_status === "pending" && a.task_status === "open");
    const done = apps.filter((a) => a.application_status === "completed");
    const row = (a, kind) => {
      const remote = a.delivery_mode === "remote";
      const confirmed = !!a.volunteer_completed_at;
      const who = personName(a.creator_first_name, a.creator_last_initial);
      let side = "";
      if (kind === "up") {
        side = confirmed
          ? `<span class="status status--pending">Waiting for ${esc(who)} to confirm</span>`
          : `<span class="status status--accepted">Accepted</span><div class="trow__actions"><a class="btn btn--green btn--small" href="review.html?task=${a.task_id}&amp;app=${a.application_id}&amp;as=volunteer&amp;other=${encodeURIComponent(who)}">Confirm completed</a><button class="link-button" type="button" data-live-withdraw="${a.application_id}">Withdraw</button></div>`;
      } else if (kind === "wait") {
        side = `<span class="status status--pending">Offer sent</span><div class="trow__actions"><button class="btn btn--outline btn--small" type="button" data-live-withdraw="${a.application_id}">Withdraw offer</button></div>`;
      } else {
        side = '<span class="status status--done">Completed</span>';
      }
      return `<li class="trow ${kind === "up" ? "trow--green" : kind === "wait" ? "trow--amber" : ""}">
        <div class="date-tile" aria-hidden="true"><span>${kind === "done" ? "On" : "By"}</span><strong>${dayNum(kind === "done" ? (a.help_seeker_completed_at || a.deadline_at) : a.deadline_at)}</strong><span>${esc(monthShort(kind === "done" ? (a.help_seeker_completed_at || a.deadline_at) : a.deadline_at))}</span></div>
        <div class="trow__main"><h3><a href="task.html?id=${a.task_id}">${esc(a.title)}</a></h3>
          <p class="trow__meta"><span><img src="assets/icons/clock.svg" alt="" width="16" height="16">${a.estimated_minutes} min</span><span><img src="assets/icons/${remote ? "laptop-meta" : "pin-meta"}.svg" alt="" width="16" height="16">${esc(remote ? "Online" : (a.location_text || "In person"))}</span><span><img src="assets/icons/line-people.svg" alt="" width="16" height="16">${esc(who)}</span></p></div>
        <div class="trow__side">${side}</div></li>`;
    };
    const fill = (section, items, kind, emptyText) => {
      const pill = $(".count-pill", section);
      if (pill) pill.textContent = items.length;
      let ul = $(".trow-list", section);
      if (!ul) { ul = document.createElement("ul"); ul.className = "trow-list"; section.appendChild(ul); }
      ul.innerHTML = items.length ? items.map((a) => row(a, kind)).join("") : `<li class="muted">${emptyText}</li>`;
    };
    fill(sections[0], upcoming, "up", "Nothing booked yet. When a help seeker accepts your offer, the task appears here.");
    fill(sections[1], waiting, "wait", "No offers waiting for a reply.");
    const pill = $(".count-pill", sections[2]);
    if (pill) pill.textContent = done.length;
    const history = $("[data-history]");
    if (history && done.length) {
      history.className = "history-list";
      history.innerHTML = `<ul class="trow-list">${done.map((a) => row(a, "done")).join("")}</ul>`;
    }
    submitPendingReviews();
  }

  /* ---------- Confirm completion and review ---------- */
  const PENDING_KEY = "qv_pending_reviews";
  async function submitPendingReviews() {
    const pending = storeGet(PENDING_KEY, {});
    for (const id of Object.keys(pending)) {
      try {
        await api("POST", "/api/reviews", { application_id: Number(id), rating: pending[id].rating, comment: pending[id].comment || "" });
        delete pending[id];
      } catch (e) {
        if ([403, 404, 409].includes(e.status)) delete pending[id]; // already reviewed or not allowed
      }
    }
    storeSet(PENDING_KEY, pending);
  }

  async function liveReviewPage() {
    const form = $("#review-form");
    if (!form) return;
    const taskId = Number(params.get("task"));
    const as = params.get("as");
    let title = null;
    try {
      if (as === "volunteer" && canVolunteer()) {
        const a = ((await api("GET", "/api/my-applications")).applications || []).find((x) => x.task_id === taskId);
        if (a) title = a.title;
      } else if (canAsk()) {
        const t = ((await api("GET", "/api/my-tasks")).tasks || []).find((x) => x.task_id === taskId);
        if (t) title = t.title;
      }
    } catch (e) { /* ignore */ }
    const other = params.get("other") || (as === "volunteer" ? "the person you helped" : "the volunteer");
    $$("[data-review-task]").forEach((el) => { el.textContent = title || "this task"; });
    $$("[data-review-person], [data-review-other]").forEach((el) => { el.textContent = other; });
    $$("[data-no-note] a").forEach((a) => { a.href = `report.html?task=${taskId}`; });
  }

  async function submitReview(form) {
    const taskId = Number(params.get("task"));
    const appId = Number(params.get("app"));
    const happened = ($("[name=happened]:checked", form) || {}).value;
    const rating = Number(($("[name=rating]:checked", form) || {}).value || 0);
    const comment = ($("#review-text", form) || {}).value || "";
    if (!happened) { formError(form, "Please tell us if the task happened."); return; }
    const done = $("#review-done");
    const finish = (heading, text) => {
      $("[data-done-heading]", done).textContent = heading;
      $("[data-done-text]", done).textContent = text;
      form.hidden = true;
      done.hidden = false;
    };
    if (happened === "no") {
      finish("Thanks for letting us know", "The task has not been marked as completed. If something went wrong, please report it so our team can help.");
      return;
    }
    if (!rating) { formError(form, "Please choose a star rating."); return; }
    formError(form, null);
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Sending…");
    let completed = false;
    try {
      completed = (await api("PATCH", `/api/tasks/${taskId}/complete`)).status === "completed";
    } catch (e) {
      if (/already completed/i.test(e.message)) completed = true;
      else if (!/already confirmed/i.test(e.message)) { formError(form, e.message); busy(button, false); return; }
    }
    if (completed && appId) {
      try {
        await api("POST", "/api/reviews", { application_id: appId, rating, comment });
        finish("Thank you", "You have both confirmed, so the task is completed and added to your activity histories. Your review is saved.");
      } catch (e) {
        finish("Task completed", `The task is completed. Your review was not saved: ${e.message}`);
      }
    } else {
      // Reviews are accepted once both people confirm: keep it and send it later
      if (appId) { const pending = storeGet(PENDING_KEY, {}); pending[appId] = { rating, comment }; storeSet(PENDING_KEY, pending); }
      finish("Confirmation sent", "Thank you. We have asked the other person to confirm too. When you have both confirmed, the task is completed and your review is posted.");
    }
    busy(button, false);
  }

  /* ---------- Report a concern: a member, a task or something else ---------- */
  async function liveReportPage() {
    const form = $("#report-form");
    if (!form) return;
    const taskId = Number(params.get("task"));
    const userId = Number(params.get("user"));
    if (taskId && !userId) {
      try {
        const t = (await api("GET", "/api/tasks")).find((x) => x.task_id === taskId);
        if (t) { $("[data-report-about]", form).hidden = false; $("[data-report-task]", form).textContent = t.title; }
      } catch (e) { /* ignore */ }
      const choice = $("[name=about][value=task]", form);
      if (choice) choice.checked = true;
    }
    if (userId) {
      const choice = $("[name=about][value=person]", form);
      if (choice) choice.checked = true;
    }
    $$("[name=about]", form).forEach((r) => r.dispatchEvent(new Event("change")));
  }

  async function submitReport(form) {
    if (!QV.me) { location.href = `login.html?next=${encodeURIComponent("report.html" + location.search)}`; return; }
    const details = $("#report-details", form);
    const about = ($("[name=about]:checked", form) || {}).value;
    const otherBox = $("#report-other", form);
    const problem = window.checkRequired(form, [[details.value.trim().length >= 20, "Please tell us a little more (at least 20 characters)."]]);
    if (problem) { formError(form, problem); return; }
    const taskId = Number(params.get("task")) || null;
    const userId = Number(params.get("user")) || null;
    const reasonBox = $("#reason", form);
    const reasonText = reasonBox && reasonBox.selectedIndex > 0 ? reasonBox.options[reasonBox.selectedIndex].text : "Concern";
    const body = {
      reason: `${reasonText}: ${details.value.trim()}`,
      contact_allowed: !!($("#contact-me", form) || {}).checked,
    };
    if (about === "person") {
      if (!userId) { formError(form, "To report a member, use the Report link next to their name on a request or task. Or choose Something else."); return; }
      body.target_type = "user";
      body.reported_user_id = userId;
    } else if (about === "task") {
      if (!taskId) { formError(form, "To report a task, use the Report link on the task. Or choose Something else."); return; }
      body.target_type = "task";
      body.task_id = taskId;
    } else {
      body.target_type = "other";
      body.other_details = otherBox.value.trim();
    }
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Sending…");
    try {
      const result = await api("POST", "/api/reports", body);
      const done = $("#report-done");
      $("[data-report-ref]", done).textContent = `QV-${result.report_id}`;
      form.hidden = true;
      done.hidden = false;
    } catch (e) { formError(form, e.message); }
    busy(button, false);
  }

  /* ---------- Profile and onboarding ---------- */
  async function liveProfilePage() {
    const form = $("#profile-form");
    if (!form) return;
    renderSkillChips("skills");
    const p = storeGet("qv_profile", {});
    // Fill the form again with what MySQL holds (main.js filled it before the live data arrived)
    form.firstname.value = p.firstName || "";
    form.lastname.value = p.lastName || "";
    form.email.value = p.email || "";
    form.email.readOnly = true;
    form.bio.value = p.bio || "";
    form.bio.dispatchEvent(new Event("input"));
    form.postcode.value = p.postcode || "";
    form.area.value = p.area || "";
    const check = (name, value) => { const el = form.querySelector(`[name=${name}][value="${value}"]`); if (el) el.checked = true; };
    if (p.distance) check("distance", p.distance);
    if (p.role) check("role", p.role);
    if (p.mode) check("mode", p.mode);
    $$("[name=days], [name=times]", form).forEach((b) => { b.checked = false; });
    (p.days || []).forEach((v) => check("days", v));
    (p.times || []).forEach((v) => check("times", v));
    $$("[name=role]", form).forEach((r) => r.dispatchEvent(new Event("change")));
    $("[data-profile-name]").textContent = p.name || "";
    $("[data-profile-since]").textContent = p.since || "";
    $("[data-profile-area]").textContent = p.area ? `${p.area}, up to ${p.distance || 3} miles` : "Not set";
    if (typeof window.showVerification === "function") window.showVerification(p.verification);

    // Reviews about me (visible ones only)
    try {
      const reviews = await api("GET", `/api/users/${QV.me.user_id}/reviews`);
      const dd = $$(".summary-list dd").slice(-1)[0];
      if (dd) dd.textContent = reviews.review_count ? `${reviews.average_rating} out of 5 (${reviews.review_count})` : "None yet";
      const panel = $('[aria-labelledby="rev-title"] .empty-panel');
      if (panel && reviews.review_count) {
        panel.outerHTML = `<div class="concern-list">${reviews.reviews.map((r) => `<article class="concern-card"><div class="concern-card__head"><p class="muted small">${esc(fmtDay(r.created_at))}</p><span class="review-stars" aria-label="${r.rating} out of 5 stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span></div><p class="quote">“${esc(r.comment || "")}”</p><p class="muted small">From ${esc(r.reviewer_first_name)}</p></article>`).join("")}</div>`;
      }
    } catch (e) { /* ignore */ }
  }

  async function submitProfile(form) {
    const success = $(".form-success", form);
    success.classList.remove("is-visible");
    const postcodeOk = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(form.postcode.value.trim());
    const problem = window.checkRequired(form, [[postcodeOk, "Please enter a valid UK postcode, for example E8 1AB."]]);
    if (problem) { formError(form, problem); return; }
    formError(form, null);
    const values = (name) => $$(`[name=${name}]:checked`, form).map((b) => b.value);
    const role = ($("[name=role]:checked", form) || {}).value;
    const p = {
      firstName: form.firstname.value.trim(),
      lastName: form.lastname.value.trim(),
      bio: form.bio.value.trim(),
      postcode: form.postcode.value.trim().toUpperCase(),
      area: form.area.value.trim(),
      distance: ($("[name=distance]:checked", form) || {}).value,
      role,
      mode: role === "help_seeker" ? undefined : ($("[name=mode]:checked", form) || {}).value,
      skills: values("skills"),
      days: values("days"),
      times: values("times"),
    };
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Saving…");
    try {
      await saveProfileLive(p, false);
      await loadMe();
      await liveProfilePage();
      success.textContent = "Your changes have been saved. Our team is told about profile changes to keep everyone safe.";
      success.classList.add("is-visible");
    } catch (e) { formError(form, e.message); }
    busy(button, false);
  }

  async function submitVerification(form) {
    const file = form.document.files[0];
    const problem = typeof window.checkDocument === "function" ? window.checkDocument(file) : (file ? null : "Please choose a file.");
    if (problem) { formError(form, problem); return; }
    formError(form, null);
    const data = new FormData();
    data.append("document", file);
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Sending…");
    try {
      await api("POST", "/api/verifications", data);
      const p = storeGet("qv_profile", {});
      p.verification = "pending";
      storeSet("qv_profile", p);
      form.reset();
      if (typeof window.showVerification === "function") window.showVerification("pending");
    } catch (e) { formError(form, e.message); }
    busy(button, false);
  }

  function liveOnboarding() {
    renderSkillChips("skills");
  }

  /* ---------- Log in, sign up and log out ---------- */
  function safeNext() {
    const next = params.get("next");
    return next && /^[a-z-]+\.html(\?[a-z]+=\d+(&[a-z]+=\d+)*)?$/.test(next) ? next : null;
  }

  async function submitLogin(form) {
    const email = $("#email", form);
    const password = $("#password", form);
    if (!email.value.trim() || !password.value) { formError(form, "Please enter your email and password."); return; }
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Logging in…");
    try {
      const result = await api("POST", "/api/login", { email: email.value.trim(), password: password.value });
      await getCsrf(); // new session, new token
      await loadMe();
      location.href = result.user.account_type === "admin" ? "admin.html" : (safeNext() || "dashboard.html");
    } catch (e) {
      formError(form, e.status === 401 ? "Email or password is incorrect." : e.message);
      busy(button, false);
    }
  }

  async function submitSignup(form) {
    const v = (id) => ($(`#${id}`, form) || {}).value || "";
    const first = v("firstname").trim();
    const last = v("lastname").trim();
    const email = v("email").trim();
    const password = v("password");
    let problem = null;
    if (!first) problem = "Please enter your first name.";
    else if (!last) problem = "Please enter your last name.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problem = "Please enter a valid email address.";
    else if (password.length < 12) problem = "Your password needs at least 12 characters.";
    else if (password !== v("confirm")) problem = "The passwords do not match.";
    else if (!$("#terms", form).checked) problem = "Please agree to the Terms of Use and Privacy Policy.";
    if (problem) { formError(form, problem); return; }
    formError(form, null);
    const button = form.querySelector("[type=submit]");
    busy(button, true, "Creating account…");
    try {
      // One account for everyone: "both" until the member chooses in onboarding
      await api("POST", "/api/register", { first_name: first, last_name: last, email, password, account_type: "both" });
      await api("POST", "/api/login", { email, password });
      await getCsrf();
      await loadMe();
      const success = $(".form-success", form);
      if (success) { success.textContent = "Account created. Next, tell us about your area and skills."; success.classList.add("is-visible"); }
      setTimeout(() => { location.href = "onboarding.html"; }, 600);
    } catch (e) {
      formError(form, e.status === 409 ? "An account with this email already exists. Try logging in." : e.message);
      busy(button, false);
    }
  }

  async function logout() {
    try { await api("POST", "/api/logout"); } catch (e) { /* already logged out */ }
    ["qv_profile", "qv_confirmations", PENDING_KEY].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    location.href = "index.html";
  }

  /* ---------- Notifications (bell) ---------- */
  async function liveNotifications() {
    if (!QV.me) return;
    let items = [];
    try { items = (await api("GET", "/api/notifications")).notifications || []; } catch (e) { return; }
    const unread = items.filter((n) => !n.read_at);
    $$("[data-notif]").forEach((box) => {
      const dot = $(".notif__dot", box);
      if (dot) dot.hidden = !unread.length;
      const btn = $(".notif__btn", box);
      if (btn) btn.setAttribute("aria-label", unread.length ? `Notifications, ${unread.length} new` : "Notifications");
      const panel = $(".notif__panel", box);
      if (!panel) return;
      $$(".notif__item[data-live]", panel).forEach((el) => el.remove());
      const emptyNote = $("[data-notif-empty]", panel);
      if (emptyNote) emptyNote.hidden = !!items.length || !$("[data-notif-profile]", panel)?.hidden;
      items.slice(0, 6).forEach((n) => {
        panel.insertAdjacentHTML("beforeend", `<div class="notif__item${n.read_at ? "" : " is-new"}" data-live><p><strong>${esc(n.title)}</strong></p><p>${esc(n.content)}</p><p class="muted small">${esc(fmtDate(n.created_at) || "")}</p></div>`);
      });
      if (btn) btn.addEventListener("click", () => {
        unread.forEach((n) => api("PATCH", `/api/notifications/${n.notification_id}/read`).catch(() => {}));
        if (dot) dot.hidden = true;
      }, { once: true });
    });
  }

  /* ---------- Admin page ---------- */
  async function liveAdmin() {
    const admin = $("[data-admin]");
    if (!admin) return;
    const count = (name, value) => { const el = $(`[data-count-${name}]`); if (el) el.textContent = value; };

    // 1. Verification: ID documents waiting to be checked
    const tbody = $('[data-panel="accounts"] tbody', admin);
    try {
      const list = (await api("GET", "/api/admin/verifications?status=pending")).verifications || [];
      count("accounts", list.length);
      const roles = { help_seeker: "Ask for help", volunteer: "Give help", both: "Both" };
      tbody.innerHTML = list.length ? list.map((v) => `<tr data-live-verification="${v.verification_id}">
        <td><strong>${esc(v.first_name)} ${esc(v.last_name)}</strong><br><span class="muted small">${esc(v.email)}</span></td>
        <td class="nowrap">${esc(fmtDay(v.submitted_at))}</td><td>${esc(roles[v.account_type] || v.account_type)}</td>
        <td>${v.has_document ? `<a class="link-green" href="/api/admin/verifications/${v.verification_id}/document" target="_blank" rel="noopener">View ID document</a>` : '<span class="muted">No file</span>'}</td>
        <td><span class="status status--pending" data-status-label>Pending</span></td>
        <td class="cell-actions"><button class="btn btn--primary btn--small" type="button" data-live-verify-decision="approved">Approve</button><button class="btn btn--outline btn--small" type="button" data-live-verify-decision="rejected">Reject</button></td></tr>`).join("")
        : '<tr><td colspan="6" class="muted">No ID documents waiting to be checked.</td></tr>';
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message)}</td></tr>`; }

    // 2. Members with completed task counts (only administrators see these)
    const members = $("[data-members-body]", admin);
    try {
      const list = (await api("GET", "/api/admin/members")).members || [];
      const roles = { help_seeker: "Ask for help", volunteer: "Give help", both: "Both" };
      members.innerHTML = list.length ? list.map((m) => {
        const suspended = m.account_status === "suspended";
        return `<tr data-live-member="${m.user_id}">
          <td><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong><br><span class="muted small">${esc(m.email)}</span></td>
          <td class="nowrap">${esc(fmtDay(m.created_at))}</td><td>${esc(roles[m.account_type] || m.account_type)}</td>
          <td>${m.verified ? `<span class="verified">${shield()}Verified</span>` : '<span class="muted">No</span>'}</td>
          <td class="nowrap"><strong>${m.completed_as_volunteer}</strong> helping · <strong>${m.completed_as_requester}</strong> asking</td>
          <td><span class="status ${suspended ? "status--declined" : "status--accepted"}" data-status-label>${suspended ? "Suspended" : "Active"}</span></td>
          <td class="cell-actions"><button class="btn btn--outline btn--small" type="button" data-live-account="${suspended ? "active" : "suspended"}">${suspended ? "Reactivate" : "Suspend"}</button></td></tr>`;
      }).join("") : '<tr><td colspan="7" class="muted">No members yet.</td></tr>';
    } catch (e) { members.innerHTML = `<tr><td colspan="7" class="muted">${esc(e.message)}</td></tr>`; }

    // 3. Reported concerns
    const concerns = $('[data-panel="concerns"] .concern-list', admin);
    try {
      const reports = (await api("GET", "/api/admin/reports")).reports || [];
      count("concerns", reports.filter((r) => r.status !== "closed").length);
      concerns.innerHTML = reports.length ? reports.map((r) => {
        const about = r.target_type === "user" ? `Member: ${esc(r.reported_user_name)}`
          : r.target_type === "task" ? `Task: <a class="link-green" href="task.html?id=${r.task_id}">${esc(r.task_title)}</a>`
          : `Something else: ${esc(r.other_details)}`;
        const suspend = r.target_type === "user" && r.reported_user_status !== "suspended" && r.status !== "closed"
          ? `<button class="btn btn--primary btn--small" type="button" data-live-suspend-user="${r.reported_user_id}">Suspend member</button>` : "";
        return `<article class="concern-card" data-live-report="${r.report_id}">
          <div class="concern-card__head"><p class="muted small">QV-${r.report_id} · ${esc(fmtDay(r.created_at))}</p><span class="status ${r.status === "closed" ? "status--closed" : "status--pending"}" data-status-label>${esc(r.status)}</span></div>
          <h3>${about}</h3>
          <p class="muted">Reported by ${esc(r.reporter_name)}${r.contact_allowed ? ` · can be contacted at <a class="link-green" href="mailto:${esc(r.reporter_email)}">${esc(r.reporter_email)}</a>` : " · does not want to be contacted"}</p>
          <p class="quote">“${esc(r.reason)}”</p>
          <div class="inline-actions">${r.status === "closed" ? '<span class="muted">Closed</span>'
            : `${r.status === "open" ? '<button class="btn btn--outline btn--small" type="button" data-live-report-status="reviewing">Start review</button>' : ""}${suspend}<button class="btn btn--outline btn--small" type="button" data-live-report-status="closed">Mark as resolved</button>`}</div>
        </article>`;
      }).join("") : '<p class="muted">No reports yet.</p>';
    } catch (e) { concerns.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }

    // 4. Profile changes to check (sent to administrators as notifications)
    const changes = $("[data-changes-list]", admin);
    try {
      const notes = ((await api("GET", "/api/notifications")).notifications || []).filter((n) => n.title === "Profile changes to check");
      count("changes", notes.filter((n) => !n.read_at).length);
      changes.innerHTML = notes.length ? notes.map((n) => `<article class="concern-card" data-live-change="${n.notification_id}">
          <div class="concern-card__head"><p class="muted small">${esc(fmtDay(n.created_at))}</p><span class="status ${n.read_at ? "status--done" : "status--pending"}" data-status-label>${n.read_at ? "Checked" : "To check"}</span></div>
          <h3>${esc(n.content)}</h3>
          <div class="inline-actions">${n.read_at ? '<span class="muted">Checked</span>' : '<button class="btn btn--outline btn--small" type="button" data-live-checked>Mark as checked</button>'}</div>
        </article>`).join("") : '<p class="muted">No profile changes to check.</p>';
    } catch (e) { changes.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }

    // 5. Reviews: hide or restore
    const reviews = $('[data-panel="reviews"] .concern-list', admin);
    try {
      const list = (await api("GET", "/api/admin/reviews")).reviews || [];
      count("hidden", list.filter((r) => r.moderation_status === "hidden").length);
      reviews.innerHTML = list.length ? list.map((r) => {
        const hidden = r.moderation_status === "hidden";
        return `<article class="concern-card${hidden ? " is-hidden-review" : ""}" data-live-review="${r.review_id}">
          <div class="concern-card__head"><p class="muted small">${esc(fmtDay(r.created_at))}</p><span class="status ${hidden ? "status--declined" : "status--accepted"}" data-status-label>${hidden ? "Hidden" : "Visible"}</span></div>
          <h3>${esc(r.task_title)}</h3>
          <p class="muted"><strong>${esc(r.reviewer_name)}</strong> reviewed <strong>${esc(r.reviewed_name)}</strong> · <span class="review-stars" aria-label="${r.rating} out of 5 stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span></p>
          <p class="quote">“${esc(r.comment || "")}”</p>
          <div class="inline-actions"><button class="btn ${hidden ? "btn--primary" : "btn--outline"} btn--small" type="button" data-live-moderate="${hidden ? "visible" : "hidden"}">${hidden ? "Restore review" : "Hide review"}</button></div>
        </article>`;
      }).join("") : '<p class="muted">No reviews yet.</p>';
    } catch (e) { reviews.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  async function adminAction(button, request) {
    busy(button, true);
    try { await request(); await liveAdmin(); } catch (e) { window.alert(e.message); busy(button, false); }
  }

  /* ---------- Events: forms and buttons ---------- */
  // Capture phase: in live mode these run before the demo handlers in main.js
  document.addEventListener("submit", (e) => {
    if (!QV.live) return;
    const form = e.target;
    const handlers = {
      "login-form": submitLogin, "signup-form": submitSignup, "offer-form": submitOffer,
      "post-form": submitPost, "review-form": submitReview, "report-form": submitReport,
      "profile-form": submitProfile, "verify-form": submitVerification,
    };
    const handler = handlers[form.id];
    if (!handler) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handler(form);
  }, true);

  document.addEventListener("click", (e) => {
    if (!QV.live) return;
    const t = e.target.closest("[data-logout], [data-live-close], [data-live-decision], [data-live-withdraw], [data-live-verify-decision], [data-live-report-status], [data-live-account], [data-live-suspend-user], [data-live-checked], [data-live-moderate]");
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (t.matches("[data-logout]")) logout();
    else if (t.matches("[data-live-close]")) closeRequest(Number(t.dataset.liveClose), t);
    else if (t.matches("[data-live-decision]")) decideOffer(t);
    else if (t.matches("[data-live-withdraw]")) withdrawOffer(t);
    else if (t.matches("[data-live-verify-decision]")) adminAction(t, () => api("PATCH", `/api/admin/verifications/${t.closest("[data-live-verification]").dataset.liveVerification}/decision`, { status: t.dataset.liveVerifyDecision }));
    else if (t.matches("[data-live-report-status]")) adminAction(t, () => api("PATCH", `/api/admin/reports/${t.closest("[data-live-report]").dataset.liveReport}/status`, { status: t.dataset.liveReportStatus }));
    else if (t.matches("[data-live-account]")) adminAction(t, () => api("PATCH", `/api/admin/users/${t.closest("[data-live-member]").dataset.liveMember}/status`, { status: t.dataset.liveAccount }));
    else if (t.matches("[data-live-suspend-user]")) {
      if (window.confirm("Suspend this member? They will not be able to log in until you reactivate the account.")) {
        adminAction(t, () => api("PATCH", `/api/admin/users/${t.dataset.liveSuspendUser}/status`, { status: "suspended" }));
      }
    }
    else if (t.matches("[data-live-checked]")) adminAction(t, () => api("PATCH", `/api/notifications/${t.closest("[data-live-change]").dataset.liveChange}/read`));
    else if (t.matches("[data-live-moderate]")) adminAction(t, () => api("PATCH", `/api/admin/reviews/${t.closest("[data-live-review]").dataset.liveReview}/moderation`,
      { status: t.dataset.liveModerate, reason: t.dataset.liveModerate === "hidden" ? "Breaks the community guidelines" : "Restored after review" }));
  }, true);

  /* ---------- Start ---------- */
  async function start() {
    QV.live = await detectBackend();
    if (!QV.live) return; // demo prototype: main.js does everything
    document.documentElement.classList.add("qv-live");
    wrapSaveProfile();
    await loadMe();

    // Pages that need an account
    if (PROTECTED.includes(page) && !QV.me) {
      location.replace(`login.html?next=${encodeURIComponent(page + location.search)}`);
      return;
    }
    if (page === "admin.html" && roleOf() !== "admin") { location.replace("dashboard.html"); return; }
    if (roleOf() === "admin" && page === "dashboard.html") { location.replace("admin.html"); return; }

    await loadSkills();
    liveNotifications();
    const pages = {
      "find-a-task.html": liveFindPage, "dashboard.html": liveDashboard, "task.html": liveTaskPage,
      "post-request.html": livePostPage, "my-requests.html": liveMyRequests, "request.html": liveRequestPage,
      "my-tasks.html": liveMyTasks, "review.html": liveReviewPage, "report.html": liveReportPage,
      "profile.html": liveProfilePage, "onboarding.html": liveOnboarding, "admin.html": liveAdmin,
    };
    if (pages[page]) await pages[page]();
    document.documentElement.classList.add("qv-ready");
  }

  QV.ready = new Promise((resolve) => {
    const go = () => start().then(resolve, resolve);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
    else go();
  });
})();
