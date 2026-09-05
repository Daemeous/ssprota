(() => {
  "use strict";
  const CFG = window.SSP_CONFIG || {};
  const APPS_SCRIPT_URL = CFG.APPS_SCRIPT_URL;
  const LEVELS = ["available", "maybe", "reluctant", "unavailable", "forced"];
  const LEVEL_LABEL = { available: "Available", maybe: "Maybe", reluctant: "Prefer not to", unavailable: "Unavailable", forced: "Locked in" };
  const DEFAULT_LEVEL = "unavailable";
  const LS_TOKEN_KEY = "sspRotaSessionToken";

  const state = {
    sessionToken: localStorage.getItem(LS_TOKEN_KEY) || null,
    signedInAs: null,
    people: [],
    month: currentMonthString(),
    dutyDates: new Set(),      // active duty dates for `month`, as ISO strings
    availability: {},          // date -> personId -> level
    candidates: [],
    assignments: {},           // date -> [personId,...] (committed)
  };

  document.getElementById("appTitle").textContent = CFG.TITLE || "SSP Rota";
  document.getElementById("loginTitle").textContent = CFG.TITLE || "SSP Rota";

  // ── API helper ───────────────────────────────────────────────────────────
  async function api(action, payload) {
    const body = Object.assign({ action }, payload || {});
    if (state.sessionToken && !["loginGoogle", "loginPassword"].includes(action)) {
      body.sessionToken = state.sessionToken;
    }
    const res = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok && data.error === "Not signed in") signOut();
    return data;
  }

  function showMsg(elId, text, kind) {
    const el = document.getElementById(elId);
    el.innerHTML = text ? `<div class="msg ${kind || "error"}">${escapeHtml(text)}</div>` : "";
    if (text) setTimeout(() => { if (el.innerHTML.includes(escapeHtml(text))) el.innerHTML = ""; }, 6000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ── Date helpers ─────────────────────────────────────────────────────────
  function currentMonthString() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function monthBounds(month) {
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return { year: y, mon: m, daysInMonth, start: `${month}-01`, end: `${month}-${String(daysInMonth).padStart(2, "0")}` };
  }
  function isoDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function formatDateLabel(iso) {
    const d = new Date(iso + "T00:00:00");
    const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
    return `${weekday} ${ordinal(d.getDate())}`;
  }
  function monthLabel(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  function shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  // Every Friday/Saturday in the month, used purely to render "No Duty" rows
  // for weekend nights that weren't picked — matches how the rota is normally read.
  function weekendDatesOf(month) {
    const { year, mon, daysInMonth } = monthBounds(month);
    const out = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, mon - 1, d);
      if (date.getDay() === 5 || date.getDay() === 6) out.push(isoDate(date));
    }
    return out;
  }
  function displayDatesOf(month, dutyDatesSet) {
    const set = new Set(weekendDatesOf(month));
    dutyDatesSet.forEach(d => set.add(d));
    return [...set].sort();
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  function initAuthUI() {
    if (CFG.GOOGLE_CLIENT_ID && window.google && google.accounts) {
      google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onGoogleCredential });
      google.accounts.id.renderButton(document.getElementById("googleSignIn"), { theme: "outline", size: "large" });
    } else {
      document.getElementById("googleSignIn").classList.add("hidden");
    }
  }

  async function onGoogleCredential(resp) {
    const data = await api("loginGoogle", { idToken: resp.credential });
    if (!data.ok) return showMsg("loginMsg", data.error, "error");
    completeSignIn(data.sessionToken);
  }

  document.getElementById("passwordSignInBtn").addEventListener("click", async () => {
    const password = document.getElementById("passwordInput").value;
    const data = await api("loginPassword", { password });
    if (!data.ok) return showMsg("loginMsg", data.error, "error");
    completeSignIn(data.sessionToken);
  });
  document.getElementById("passwordInput").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("passwordSignInBtn").click();
  });

  function completeSignIn(token) {
    state.sessionToken = token;
    localStorage.setItem(LS_TOKEN_KEY, token);
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    document.getElementById("signedInAs").textContent = "Signed in";
    boot();
  }

  function signOut() {
    if (state.sessionToken) api("logout", {});
    state.sessionToken = null;
    localStorage.removeItem(LS_TOKEN_KEY);
    document.getElementById("app").classList.add("hidden");
    document.getElementById("loginScreen").classList.remove("hidden");
  }
  document.getElementById("signOutBtn").addEventListener("click", signOut);

  // ── Tabs ─────────────────────────────────────────────────────────────────
  document.querySelectorAll("nav.tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("nav.tabs button").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("view-" + btn.dataset.view).classList.add("active");
      if (btn.dataset.view === "availability") renderAvailability();
      if (btn.dataset.view === "rota") loadRota();
    });
  });

  // ── People ───────────────────────────────────────────────────────────────
  async function loadPeople() {
    const data = await api("getPeople", {});
    if (!data.ok) return showMsg("globalMsg", data.error, "error");
    state.people = data.people;
    renderPeopleTable();
  }

  function renderPeopleTable() {
    const tbody = document.querySelector("#peopleTable tbody");
    tbody.innerHTML = "";
    state.people.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.gender || "")}</td>
        <td><input type="checkbox" ${p.isLeader ? "checked" : ""} data-field="isLeader"></td>
        <td><input type="checkbox" ${p.isDriver ? "checked" : ""} data-field="isDriver"></td>
        <td><input type="checkbox" ${p.active ? "checked" : ""} data-field="active"></td>
        <td><button class="btn danger" data-action="delete">Remove</button></td>
      `;
      tr.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.addEventListener("change", async () => {
          const patch = Object.assign({}, p, { [cb.dataset.field]: cb.checked });
          const data = await api("savePerson", { person: patch });
          if (!data.ok) return showMsg("globalMsg", data.error, "error");
          loadPeople();
        });
      });
      tr.querySelector("[data-action=delete]").addEventListener("click", async () => {
        if (!confirm(`Remove ${p.name}?`)) return;
        const data = await api("deletePerson", { id: p.id });
        if (!data.ok) return showMsg("globalMsg", data.error, "error");
        loadPeople();
      });
      tbody.appendChild(tr);
    });
  }

  document.getElementById("addPersonBtn").addEventListener("click", async () => {
    const name = document.getElementById("personName").value.trim();
    if (!name) return;
    const person = {
      name,
      gender: document.getElementById("personGender").value,
      isLeader: document.getElementById("personLeader").checked,
      isDriver: document.getElementById("personDriver").checked,
      active: true,
    };
    const data = await api("savePerson", { person });
    if (!data.ok) return showMsg("globalMsg", data.error, "error");
    document.getElementById("personName").value = "";
    document.getElementById("personGender").value = "";
    document.getElementById("personLeader").checked = false;
    document.getElementById("personDriver").checked = false;
    loadPeople();
  });

  // ── Duty Days ────────────────────────────────────────────────────────────
  document.getElementById("dutyPrevMonth").addEventListener("click", () => { state.month = shiftMonth(state.month, -1); loadDutyDays(); });
  document.getElementById("dutyNextMonth").addEventListener("click", () => { state.month = shiftMonth(state.month, 1); loadDutyDays(); });

  async function loadDutyDays() {
    document.getElementById("dutyMonthLabel").textContent = monthLabel(state.month);
    const saved = await api("getDutyDays", { month: state.month });
    if (saved.ok && saved.dutyDays.length) {
      state.dutyDates = new Set(saved.dutyDays.filter(d => d.active).map(d => d.date));
    } else {
      const def = await api("getDefaultDutyDays", { month: state.month });
      state.dutyDates = new Set(def.ok ? def.dates : []);
    }
    renderDutyCalendar();
  }

  function renderDutyCalendar() {
    const el = document.getElementById("dutyCalendar");
    const { year, mon, daysInMonth } = monthBounds(state.month);
    const firstDow = new Date(year, mon - 1, 1).getDay();
    el.innerHTML = "";
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(d => {
      const div = document.createElement("div");
      div.className = "dow"; div.textContent = d;
      el.appendChild(div);
    });
    for (let i = 0; i < firstDow; i++) {
      const div = document.createElement("div");
      div.className = "day empty";
      el.appendChild(div);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDate(new Date(year, mon - 1, d));
      const div = document.createElement("div");
      div.className = "day" + (state.dutyDates.has(iso) ? " duty" : "");
      div.innerHTML = `<div class="num">${d}</div>`;
      div.addEventListener("click", () => {
        if (state.dutyDates.has(iso)) state.dutyDates.delete(iso); else state.dutyDates.add(iso);
        renderDutyCalendar();
      });
      el.appendChild(div);
    }
  }

  document.getElementById("saveDutyDaysBtn").addEventListener("click", async () => {
    const data = await api("saveDutyDays", { month: state.month, dates: [...state.dutyDates] });
    showMsg("globalMsg", data.ok ? "Duty days saved." : data.error, data.ok ? "success" : "error");
  });

  // ── Availability ─────────────────────────────────────────────────────────
  async function renderAvailability() {
    if (!state.dutyDates.size) await loadDutyDays();
    const data = await api("getAvailability", { month: state.month });
    state.availability = {};
    if (data.ok) data.availability.forEach(r => {
      state.availability[r.date] = state.availability[r.date] || {};
      state.availability[r.date][r.personId] = r.level;
    });

    const dates = [...state.dutyDates].sort();
    const table = document.getElementById("availTable");
    if (!dates.length) { table.innerHTML = "<tr><td>No duty days selected for this month yet — set them on the Duty Days tab first.</td></tr>"; return; }

    let thead = "<thead><tr><th>Name</th>" + dates.map(d => `<th>${formatDateLabel(d)}</th>`).join("") + "</tr></thead>";
    let tbody = "<tbody>";
    state.people.filter(p => p.active).forEach(p => {
      tbody += `<tr><td>${escapeHtml(p.name)}</td>`;
      dates.forEach(date => {
        const level = (state.availability[date] && state.availability[date][p.id]) || DEFAULT_LEVEL;
        const options = LEVELS.map(l => `<option value="${l}" ${l === level ? "selected" : ""}>${LEVEL_LABEL[l]}</option>`).join("");
        tbody += `<td><select class="avail-cell lvl-${level}" data-person="${p.id}" data-date="${date}">${options}</select></td>`;
      });
      tbody += "</tr>";
    });
    tbody += "</tbody>";
    table.innerHTML = thead + tbody;

    table.querySelectorAll(".avail-cell").forEach(cell => {
      cell.addEventListener("change", () => {
        const date = cell.dataset.date, person = cell.dataset.person, next = cell.value;
        state.availability[date] = state.availability[date] || {};
        state.availability[date][person] = next;
        cell.className = `avail-cell lvl-${next}`;
      });
    });
  }

  document.getElementById("saveAvailabilityBtn").addEventListener("click", async () => {
    // Read every rendered cell, not just state.availability — that only holds
    // entries loaded from the server plus ones the admin touched this
    // session, but an untouched cell's on-screen default (unavailable) needs
    // saving too, or it silently reverts to "maybe" server-side next load.
    const entries = [];
    document.querySelectorAll("#availTable .avail-cell").forEach(cell => {
      entries.push({ date: cell.dataset.date, personId: cell.dataset.person, level: cell.value });
    });
    const data = await api("saveAvailability", { month: state.month, entries });
    showMsg("globalMsg", data.ok ? "Availability saved." : data.error, data.ok ? "success" : "error");
  });

  // ── Generate rota ────────────────────────────────────────────────────────
  document.getElementById("generateBtn").addEventListener("click", async () => {
    if (!state.dutyDates.size) await loadDutyDays();
    const dates = [...state.dutyDates].sort();
    const maxPerMonth = Number(document.getElementById("maxPerMonth").value) || 2;
    document.getElementById("candidatesList").innerHTML = "Generating…";
    const data = await api("generateRota", { month: state.month, dates, maxPerMonth, count: 5 });
    if (!data.ok) { document.getElementById("candidatesList").innerHTML = ""; return showMsg("globalMsg", data.error, "error"); }
    state.candidates = data.candidates;
    renderCandidates();
  });

  function renderCandidates() {
    const el = document.getElementById("candidatesList");
    if (!state.candidates.length) { el.innerHTML = "<p>No candidates could be generated — check availability and duty days.</p>"; return; }
    el.innerHTML = state.candidates.map((c, i) => {
      const issues = c.issues.length ? `<div class="issues">⚠ ${c.issues.map(x => `${formatDateLabel(x.date)}: ${escapeHtml(x.problem)}`).join(" · ")}</div>` : "";
      const rows = displayDatesOf(state.month, new Set(c.dates.map(d => d.date))).map(date => {
        const match = c.dates.find(d => d.date === date);
        const names = match && match.people.length ? match.people.map(p => p.name).join(", ") : null;
        return `<div class="rota-list-row ${names ? "" : "no-duty"}"><span>${formatDateLabel(date)}</span><span class="names">${names || "No Duty"}</span></div>`;
      }).join("");
      return `<div class="candidate-card">
        <h3>Option ${i + 1}${i === 0 ? " (best fit)" : ""}</h3>
        <div class="meta">Suitability score: ${c.penalty.toFixed(1)} (lower is better)</div>
        ${issues}
        ${rows}
        <button class="btn" style="margin-top:0.75rem" data-commit="${i}">Commit this rota</button>
      </div>`;
    }).join("");
    el.querySelectorAll("[data-commit]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const candidate = state.candidates[Number(btn.dataset.commit)];
        const assignments = [];
        candidate.dates.forEach(d => d.people.forEach(p => assignments.push({ date: d.date, personId: p.id, source: "solver" })));
        const data = await api("commitAssignments", { assignments });
        showMsg("globalMsg", data.ok ? "Rota committed." : data.error, data.ok ? "success" : "error");
        if (data.ok) document.querySelector('nav.tabs button[data-view="rota"]').click();
      });
    });
  }

  // ── Committed rota ───────────────────────────────────────────────────────
  async function loadRota() {
    const { start, end } = monthBounds(state.month);
    document.getElementById("rotaHeading").textContent = monthLabel(state.month) + " Rota";
    const data = await api("getAssignments", { monthStart: start, monthEnd: end });
    state.assignments = {};
    if (data.ok) data.assignments.forEach(a => {
      state.assignments[a.date] = state.assignments[a.date] || [];
      state.assignments[a.date].push(a.personId);
    });
    renderRotaList();
    renderRotaCalendar();
  }

  function personName(id) {
    const p = state.people.find(x => x.id === id);
    return p ? p.name : "?";
  }

  function renderRotaList() {
    const dates = displayDatesOf(state.month, new Set(Object.keys(state.assignments)));
    document.getElementById("rotaList").innerHTML = dates.map(date => {
      const ids = state.assignments[date] || [];
      const names = ids.length ? ids.map(personName).join(", ") : null;
      let editor = "";
      if (ids.length) {
        editor = `<div class="slot-editor">` + ids.map(id => `
          <select data-date="${date}" data-old="${id}">
            ${state.people.filter(p => p.active).map(p => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        `).join("") + `</div>`;
      }
      return `<div class="rota-list-row ${names ? "" : "no-duty"}"><span>${formatDateLabel(date)}${editor}</span><span class="names">${names || "No Duty"}</span></div>`;
    }).join("");

    document.querySelectorAll("#rotaList select").forEach(sel => {
      sel.addEventListener("change", async () => {
        const data = await api("setAssignment", { date: sel.dataset.date, oldPersonId: sel.dataset.old, newPersonId: sel.value });
        showMsg("globalMsg", data.ok ? "Updated." : data.error, data.ok ? "success" : "error");
        if (data.ok) loadRota();
      });
    });
  }

  function renderRotaCalendar() {
    const el = document.getElementById("rotaCalendar");
    const { year, mon, daysInMonth } = monthBounds(state.month);
    const firstDow = new Date(year, mon - 1, 1).getDay();
    el.innerHTML = "";
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(d => {
      const div = document.createElement("div"); div.className = "dow"; div.textContent = d; el.appendChild(div);
    });
    for (let i = 0; i < firstDow; i++) { const div = document.createElement("div"); div.className = "day empty"; el.appendChild(div); }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDate(new Date(year, mon - 1, d));
      const ids = state.assignments[iso];
      const div = document.createElement("div");
      div.className = "day" + (ids && ids.length ? " duty" : " no-duty");
      div.innerHTML = `<div class="num">${d}</div><div class="names">${ids && ids.length ? ids.map(personName).join(", ") : ""}</div>`;
      el.appendChild(div);
    }
  }

  // ── Copy for email ───────────────────────────────────────────────────────
  document.getElementById("copyRotaListBtn").addEventListener("click", () => {
    const dates = displayDatesOf(state.month, new Set(Object.keys(state.assignments)));
    const text = `${monthLabel(state.month)} Rota\n\n` + dates.map(date => {
      const ids = state.assignments[date] || [];
      return `${formatDateLabel(date)}\n${ids.length ? ids.map(personName).join(", ") : "No Duty"}`;
    }).join("\n\n");
    copyPlainText(text);
  });

  document.getElementById("copyRotaCalendarBtn").addEventListener("click", () => {
    const html = buildRotaEmailHtml();
    copyRichText(html, htmlToPlainText(html));
  });

  function buildRotaEmailHtml() {
    const { year, mon, daysInMonth } = monthBounds(state.month);
    const firstDow = new Date(year, mon - 1, 1).getDay();
    let cells = "";
    for (let i = 0; i < firstDow; i++) cells += `<td style="border:1px solid #ccc;padding:6px"></td>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDate(new Date(year, mon - 1, d));
      const ids = state.assignments[iso];
      const names = ids && ids.length ? ids.map(personName).join("<br>") : "";
      cells += `<td style="border:1px solid #ccc;padding:6px;vertical-align:top;min-width:90px"><b>${d}</b><br>${names}</td>`;
      if ((firstDow + d) % 7 === 0) cells += "</tr><tr>";
    }
    return `<h2 style="font-family:sans-serif">${monthLabel(state.month)} Rota</h2>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
        <tr>${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => `<th style="border:1px solid #ccc;padding:6px;background:#f0f0f0">${d}</th>`).join("")}</tr>
        <tr>${cells}</tr>
      </table>`;
  }

  function htmlToPlainText(html) {
    const div = document.createElement("div");
    div.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/tr>/gi, "\n").replace(/<\/td>|<\/th>/gi, "\t");
    return div.textContent.replace(/[ \t]+\n/g, "\n").trim();
  }

  async function copyPlainText(text) {
    try { await navigator.clipboard.writeText(text); showMsg("globalMsg", "Copied to clipboard.", "success"); }
    catch (e) { showMsg("globalMsg", "Couldn't copy automatically — please select and copy manually.", "error"); }
  }

  async function copyRichText(html, plain) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      showMsg("globalMsg", "Calendar copied — paste into your email.", "success");
    } catch (e) {
      copyPlainText(plain);
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  async function boot() {
    await loadPeople();
    await loadDutyDays();
  }

  initAuthUI();
  if (state.sessionToken) {
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    document.getElementById("signedInAs").textContent = "Signed in";
    boot();
  }
})();
