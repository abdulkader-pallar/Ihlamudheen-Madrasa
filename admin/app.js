/* ============================================================================
   Ihlamudheen Madrasa — Accounts portal logic
   Talks to Supabase (Auth + Postgres). All access is enforced server-side by
   Row Level Security; this file only shapes the UI.
   ========================================================================== */
(function () {
  "use strict";

  // ---------- tiny DOM helpers ----------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- formatting ----------
  const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
  const fmt = (n) => money.format(Number(n) || 0);
  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const monthKey = (d) => d.slice(0, 7);
  const monthLabel = (k) => new Date(k + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // ---------- theme ----------
  (function theme() {
    const root = document.documentElement;
    const saved = localStorage.getItem("acc-theme");
    if (saved) root.setAttribute("data-theme", saved);
    const isDark = () => { const t = root.getAttribute("data-theme"); return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#theme-btn")) return;
      const next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("acc-theme", next);
      if (state.session) renderDashboard(); // recolor charts
    });
  })();

  // ---------- toast ----------
  let toastT;
  function toast(msg, isErr) {
    const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!isErr); t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
  }

  // ---------- app state ----------
  const state = { sb: null, session: null, profile: null, categories: [], funds: [], transactions: [], charts: {} };
  const isEditor = () => state.profile && (state.profile.role === "admin" || state.profile.role === "accountant");

  // ============================================================
  //  Boot
  // ============================================================
  async function boot() {
    const cfg = window.SUPABASE_CONFIG || {};
    const configured = cfg.url && cfg.anonKey && !/PASTE_YOUR/.test(cfg.anonKey);
    if (!window.supabase) { fatal("Could not load Supabase library (check your internet connection)."); return; }
    if (!configured) {
      $("#boot").classList.add("hidden");
      show("#login-view");
      showBanner('Not configured yet — paste your Supabase public anon key into admin/config.js, then reload.');
      $("#login-btn").disabled = true;
      return;
    }
    state.sb = window.supabase.createClient(cfg.url, cfg.anonKey);

    state.sb.auth.onAuthStateChange((_evt, session) => {
      state.session = session;
      if (!session) { showLogin(); }
    });

    const { data: { session } } = await state.sb.auth.getSession();
    state.session = session;
    $("#boot").classList.add("hidden");
    if (session) { await enterApp(); } else { showLogin(); }
  }

  function fatal(msg) { $("#boot").innerHTML = '<div class="login-card" style="text-align:center">' + esc(msg) + "</div>"; }
  function show(sel) { ["#login-view", "#app-view"].forEach(s => $(s).classList.add("hidden")); $(sel).classList.remove("hidden"); }
  function showLogin() { show("#login-view"); }
  function showBanner(text) {
    let b = $("#cfg-banner");
    if (!b) { b = el("div", "banner"); b.id = "cfg-banner"; document.body.prepend(b); }
    b.textContent = text;
  }

  // ============================================================
  //  Auth
  // ============================================================
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#login-msg"); msg.textContent = ""; msg.className = "form-msg err";
    const btn = $("#login-btn"); btn.disabled = true; btn.textContent = "Signing in…";
    const { error } = await state.sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#password").value });
    btn.disabled = false; btn.textContent = "Sign in";
    if (error) { msg.textContent = error.message || "Sign in failed."; return; }
    await enterApp();
  });

  $("#logout-btn").addEventListener("click", async () => { await state.sb.auth.signOut(); location.reload(); });

  async function enterApp() {
    // fetch this user's profile (role). RLS lets a user read their own row.
    const { data, error } = await state.sb.from("profiles").select("full_name, role").eq("id", state.session.user.id).single();
    if (error || !data) {
      // Profile row missing — the account exists but has no access yet.
      showLogin();
      $("#login-msg").textContent = "Your account has no access profile yet. Ask an admin to enable it.";
      await state.sb.auth.signOut();
      return;
    }
    state.profile = data;
    const name = data.full_name || state.session.user.email;
    $("#u-name").textContent = name;
    $("#u-role").textContent = data.role;
    $("#u-av").textContent = (name[0] || "?").toUpperCase();
    // toggle editor-only controls
    $$(".editor-only").forEach(n => n.classList.toggle("hidden", !isEditor()));
    show("#app-view");
    await loadAll();
    navigate("dashboard");
  }

  // ============================================================
  //  Data loading
  // ============================================================
  async function loadAll() {
    const [c, f, t] = await Promise.all([
      state.sb.from("categories").select("*").order("kind").order("name"),
      state.sb.from("funds").select("*").order("name"),
      state.sb.from("transactions").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false })
    ]);
    if (c.error || f.error || t.error) { toast("Failed to load data: " + (c.error || f.error || t.error).message, true); return; }
    state.categories = c.data || [];
    state.funds = f.data || [];
    state.transactions = t.data || [];
    catName = Object.fromEntries(state.categories.map(x => [x.id, x.name]));
    fundName = Object.fromEntries(state.funds.map(x => [x.id, x.name]));
    fillFilterSelects();
    renderManage();
  }
  let catName = {}, fundName = {};

  // ============================================================
  //  Navigation
  // ============================================================
  const titles = { dashboard: "Dashboard", transactions: "Transactions", reports: "Reports", manage: "Categories & Funds" };
  function navigate(view) {
    $$(".nav-item[data-view]").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
    $("#page-title").textContent = titles[view] || "";
    $("#sidebar").classList.remove("open");
    if (view === "dashboard") renderDashboard();
    if (view === "transactions") renderTransactions();
    if (view === "reports") runReport();
  }
  $$(".nav-item[data-view]").forEach(n => n.addEventListener("click", () => navigate(n.dataset.view)));
  $("#hamburger").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

  // ============================================================
  //  Dashboard
  // ============================================================
  function totals(list) {
    let income = 0, expense = 0;
    list.forEach(t => { if (t.type === "income") income += +t.amount; else expense += +t.amount; });
    return { income, expense, balance: income - expense };
  }
  function renderDashboard() {
    const T = totals(state.transactions);
    $("#stat-income").textContent = fmt(T.income);
    $("#stat-expense").textContent = fmt(T.expense);
    $("#stat-balance").textContent = fmt(T.balance);
    const mk = monthKey(todayISO());
    const mT = totals(state.transactions.filter(t => monthKey(t.occurred_on) === mk));
    const monthEl = $("#stat-month"); monthEl.textContent = fmt(mT.balance);
    monthEl.className = "s-val tnum " + (mT.balance >= 0 ? "income" : "expense");

    // recent
    const recent = state.transactions.slice(0, 6);
    $("#recent-list").innerHTML = recent.length ? "" : '<div class="empty">No transactions yet.</div>';
    if (recent.length) $("#recent-list").appendChild(miniTable(recent));

    drawCharts(T);
  }
  function miniTable(list) {
    const w = el("div", "table-wrap");
    const rows = list.map(t => `<tr>
      <td>${fmtDate(t.occurred_on)}</td>
      <td><span class="pill ${t.type}">${t.type}</span></td>
      <td>${esc(catName[t.category_id] || "—")}</td>
      <td>${esc(t.description || "")}</td>
      <td class="amount ${t.type}">${t.type === "expense" ? "−" : "+"}${fmt(t.amount)}</td></tr>`).join("");
    w.innerHTML = `<table style="min-width:520px"><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
    return w;
  }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function drawCharts(T) {
    if (!window.Chart) return;
    Chart.defaults.font.family = "Hanken Grotesk, sans-serif";
    Chart.defaults.color = css("--muted");
    const good = css("--good"), bad = css("--bad"), teal = css("--teal"), line = css("--line");

    // monthly last 6
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.toISOString().slice(0, 7)); }
    const inc = months.map(m => state.transactions.filter(t => monthKey(t.occurred_on) === m && t.type === "income").reduce((s, t) => s + +t.amount, 0));
    const exp = months.map(m => state.transactions.filter(t => monthKey(t.occurred_on) === m && t.type === "expense").reduce((s, t) => s + +t.amount, 0));
    if (state.charts.m) state.charts.m.destroy();
    state.charts.m = new Chart($("#chart-monthly"), {
      type: "bar",
      data: { labels: months.map(monthLabel), datasets: [
        { label: "Income", data: inc, backgroundColor: good, borderRadius: 5 },
        { label: "Expense", data: exp, backgroundColor: bad, borderRadius: 5 } ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: line }, ticks: { callback: v => "₹" + (v >= 1000 ? (v / 1000) + "k" : v) } } } }
    });

    // expense by category
    const byCat = {};
    state.transactions.filter(t => t.type === "expense").forEach(t => { const k = catName[t.category_id] || "Uncategorised"; byCat[k] = (byCat[k] || 0) + +t.amount; });
    const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const palette = ["#16807F", "#F0A82C", "#0E2E52", "#c0392b", "#8e44ad", "#2e86c1", "#27ae60", "#e67e22"];
    if (state.charts.c) state.charts.c.destroy();
    if (entries.length) {
      state.charts.c = new Chart($("#chart-cat"), {
        type: "doughnut",
        data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: palette, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } } } }
      });
    } else { $("#chart-cat").parentElement.innerHTML = '<div class="empty">No expenses recorded.</div>'; }
  }

  // ============================================================
  //  Transactions list
  // ============================================================
  function fillFilterSelects() {
    const opts = (arr) => '<option value="">All</option>' + arr.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
    $("#f-category").innerHTML = opts(state.categories);
    $("#f-fund").innerHTML = opts(state.funds);
  }
  function currentFilter() {
    return { search: $("#f-search").value.trim().toLowerCase(), type: $("#f-type").value, category: $("#f-category").value, fund: $("#f-fund").value, from: $("#f-from").value, to: $("#f-to").value };
  }
  function applyFilter(list, f) {
    return list.filter(t => {
      if (f.type && t.type !== f.type) return false;
      if (f.category && t.category_id !== f.category) return false;
      if (f.fund && t.fund_id !== f.fund) return false;
      if (f.from && t.occurred_on < f.from) return false;
      if (f.to && t.occurred_on > f.to) return false;
      if (f.search) { const hay = ((t.description || "") + " " + (t.reference || "")).toLowerCase(); if (!hay.includes(f.search)) return false; }
      return true;
    });
  }
  function renderTransactions() {
    const list = applyFilter(state.transactions, currentFilter());
    const body = $("#tx-body");
    if (!list.length) { body.innerHTML = `<tr><td colspan="7"><div class="empty">No transactions match.</div></td></tr>`; }
    else {
      body.innerHTML = list.map(t => `<tr>
        <td class="tnum">${fmtDate(t.occurred_on)}</td>
        <td><span class="pill ${t.type}">${t.type}</span></td>
        <td>${esc(catName[t.category_id] || "—")}</td>
        <td>${esc(fundName[t.fund_id] || "—")}</td>
        <td>${esc(t.description || "")}${t.reference ? ` <span style="color:var(--muted)">#${esc(t.reference)}</span>` : ""}</td>
        <td class="amount ${t.type} tnum">${t.type === "expense" ? "−" : "+"}${fmt(t.amount)}</td>
        <td class="editor-only" style="text-align:right"><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${t.id}">Delete</button>
        </div></td></tr>`).join("");
    }
    $$(".editor-only", body).forEach(n => n.classList.toggle("hidden", !isEditor()));
    const T = totals(list);
    $("#tx-count").textContent = `${list.length} transaction${list.length === 1 ? "" : "s"}`;
    $("#tx-sum").innerHTML = `Income ${fmt(T.income)} · Expense ${fmt(T.expense)} · Net <b>${fmt(T.balance)}</b>`;
    body.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openTxModal(state.transactions.find(x => x.id === b.dataset.edit)));
    body.querySelectorAll("[data-del]").forEach(b => b.onclick = () => deleteTx(b.dataset.del));
  }
  ["f-search", "f-type", "f-category", "f-fund", "f-from", "f-to"].forEach(id => {
    const ev = id === "f-search" ? "input" : "change";
    $("#" + id).addEventListener(ev, renderTransactions);
  });
  $("#f-clear").onclick = () => { ["f-search", "f-type", "f-category", "f-fund", "f-from", "f-to"].forEach(id => $("#" + id).value = ""); renderTransactions(); };
  $("#tx-export").onclick = () => exportCSV(applyFilter(state.transactions, currentFilter()), "transactions");

  // ============================================================
  //  Transaction add / edit modal
  // ============================================================
  $("#add-tx-btn").onclick = () => openTxModal(null);
  function openTxModal(tx) {
    if (!isEditor()) return;
    const editing = !!tx;
    let type = tx ? tx.type : "income";
    const catOptions = (kind) => state.categories.filter(c => c.kind === kind).map(c => `<option value="${c.id}" ${tx && tx.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    const fundOptions = '<option value="">— none —</option>' + state.funds.map(f => `<option value="${f.id}" ${tx && tx.fund_id === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("");
    const m = modal(`
      <h3>${editing ? "Edit entry" : "New entry"}</h3>
      <form id="tx-form">
        <div class="field"><label>Type</label>
          <div class="seg" id="type-seg">
            <button type="button" data-t="income" class="${type === "income" ? "on-i" : ""}">Income</button>
            <button type="button" data-t="expense" class="${type === "expense" ? "on-e" : ""}">Expense</button>
          </div>
        </div>
        <div class="field"><label>Amount (₹)</label><input type="number" id="tx-amount" step="0.01" min="0.01" required value="${tx ? tx.amount : ""}" placeholder="0.00" /></div>
        <div class="field"><label>Date</label><input type="date" id="tx-date" required value="${tx ? tx.occurred_on : todayISO()}" /></div>
        <div class="field"><label>Category</label><select id="tx-cat" required>${catOptions(type)}</select></div>
        <div class="field"><label>Fund / account</label><select id="tx-fund">${fundOptions}</select></div>
        <div class="field"><label>Description</label><input type="text" id="tx-desc" value="${tx ? esc(tx.description || "") : ""}" placeholder="e.g. October fees — Class 3" /></div>
        <div class="field"><label>Reference / voucher no. (optional)</label><input type="text" id="tx-ref" value="${tx ? esc(tx.reference || "") : ""}" /></div>
        <p class="form-msg err" id="tx-msg"></p>
        <div class="m-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="tx-save">${editing ? "Save changes" : "Add entry"}</button>
        </div>
      </form>`);
    // segmented type switch re-populates categories
    m.querySelectorAll("#type-seg button").forEach(b => b.onclick = () => {
      type = b.dataset.t;
      m.querySelector("#type-seg button[data-t=income]").className = type === "income" ? "on-i" : "";
      m.querySelector("#type-seg button[data-t=expense]").className = type === "expense" ? "on-e" : "";
      $("#tx-cat", m).innerHTML = catOptions(type);
    });
    $("#tx-form", m).addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        type, amount: parseFloat($("#tx-amount", m).value), occurred_on: $("#tx-date", m).value,
        category_id: $("#tx-cat", m).value || null, fund_id: $("#tx-fund", m).value || null,
        description: $("#tx-desc", m).value.trim() || null, reference: $("#tx-ref", m).value.trim() || null
      };
      if (!(payload.amount > 0)) { $("#tx-msg", m).textContent = "Enter a valid amount."; return; }
      const save = $("#tx-save", m); save.disabled = true; save.textContent = "Saving…";
      let res;
      if (editing) res = await state.sb.from("transactions").update(payload).eq("id", tx.id);
      else res = await state.sb.from("transactions").insert(payload);
      if (res.error) { $("#tx-msg", m).textContent = res.error.message; save.disabled = false; save.textContent = editing ? "Save changes" : "Add entry"; return; }
      closeModal();
      toast(editing ? "Entry updated" : "Entry added");
      await loadAll(); renderTransactions(); renderDashboard();
    });
  }
  async function deleteTx(id) {
    if (!isEditor()) return;
    const t = state.transactions.find(x => x.id === id);
    confirmModal(`Delete this ${t.type} of ${fmt(t.amount)}?`, "This cannot be undone.", async () => {
      const { error } = await state.sb.from("transactions").delete().eq("id", id);
      if (error) { toast(error.message, true); return; }
      toast("Entry deleted");
      await loadAll(); renderTransactions(); renderDashboard();
    });
  }

  // ============================================================
  //  Manage categories & funds
  // ============================================================
  function renderManage() {
    const editor = isEditor();
    const cl = $("#cat-list");
    cl.innerHTML = state.categories.map(c => `<div class="chip"><span>${esc(c.name)} <span class="k ${c.kind}">${c.kind}</span></span>${editor ? `<button class="btn btn-danger btn-sm" data-delcat="${c.id}">✕</button>` : ""}</div>`).join("") || '<div class="empty">No categories.</div>';
    const fl = $("#fund-list");
    fl.innerHTML = state.funds.map(f => `<div class="chip"><span>${esc(f.name)}${f.description ? ` <span style="color:var(--muted);font-size:12px">— ${esc(f.description)}</span>` : ""}</span>${editor ? `<button class="btn btn-danger btn-sm" data-delfund="${f.id}">✕</button>` : ""}</div>`).join("") || '<div class="empty">No funds.</div>';
    cl.querySelectorAll("[data-delcat]").forEach(b => b.onclick = () => removeRow("categories", b.dataset.delcat, "Category removed"));
    fl.querySelectorAll("[data-delfund]").forEach(b => b.onclick = () => removeRow("funds", b.dataset.delfund, "Fund removed"));
  }
  async function removeRow(table, id, msg) {
    confirmModal("Remove this " + (table === "funds" ? "fund" : "category") + "?", "Existing transactions keep their record but lose this link.", async () => {
      const { error } = await state.sb.from(table).delete().eq("id", id);
      if (error) { toast(error.message, true); return; }
      toast(msg); await loadAll();
    });
  }
  $("#add-cat").onclick = () => {
    const m = modal(`<h3>Add category</h3><form id="cat-form">
      <div class="field"><label>Name</label><input id="c-name" required placeholder="e.g. Library Fund Income" /></div>
      <div class="field"><label>Type</label><select id="c-kind"><option value="income">Income</option><option value="expense">Expense</option></select></div>
      <p class="form-msg err" id="c-msg"></p>
      <div class="m-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary">Add</button></div></form>`);
    $("#cat-form", m).onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await state.sb.from("categories").insert({ name: $("#c-name", m).value.trim(), kind: $("#c-kind", m).value });
      if (error) { $("#c-msg", m).textContent = error.message; return; }
      closeModal(); toast("Category added"); await loadAll();
    };
  };
  $("#add-fund").onclick = () => {
    const m = modal(`<h3>Add fund / account</h3><form id="fund-form">
      <div class="field"><label>Name</label><input id="fd-name" required placeholder="e.g. Ramadan Fund" /></div>
      <div class="field"><label>Description (optional)</label><input id="fd-desc" /></div>
      <p class="form-msg err" id="fd-msg"></p>
      <div class="m-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary">Add</button></div></form>`);
    $("#fund-form", m).onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await state.sb.from("funds").insert({ name: $("#fd-name", m).value.trim(), description: $("#fd-desc", m).value.trim() || null });
      if (error) { $("#fd-msg", m).textContent = error.message; return; }
      closeModal(); toast("Fund added"); await loadAll();
    };
  };

  // ============================================================
  //  Reports
  // ============================================================
  $("#r-run").onclick = runReport;
  $("#r-print").onclick = () => window.print();
  $("#r-csv").onclick = () => exportReportCSV();
  function reportRange() { return { from: $("#r-from").value, to: $("#r-to").value, group: $("#r-group").value }; }
  function reportData() {
    const r = reportRange();
    let list = state.transactions.slice();
    if (r.from) list = list.filter(t => t.occurred_on >= r.from);
    if (r.to) list = list.filter(t => t.occurred_on <= r.to);
    const groups = {};
    list.forEach(t => {
      let key = r.group === "month" ? monthLabel(monthKey(t.occurred_on)) : r.group === "fund" ? (fundName[t.fund_id] || "— No fund —") : (catName[t.category_id] || "— Uncategorised —");
      groups[key] = groups[key] || { income: 0, expense: 0 };
      groups[key][t.type] += +t.amount;
    });
    return { r, list, groups };
  }
  function runReport() {
    const { r, list, groups } = reportData();
    const T = totals(list);
    const rangeTxt = (r.from || r.to) ? `${r.from ? fmtDate(r.from) : "start"} → ${r.to ? fmtDate(r.to) : "today"}` : "All time";
    const rows = Object.entries(groups).sort((a, b) => (b[1].income + b[1].expense) - (a[1].income + a[1].expense)).map(([k, v]) => `<tr>
      <td>${esc(k)}</td><td class="amount income tnum">${fmt(v.income)}</td><td class="amount expense tnum">${fmt(v.expense)}</td>
      <td class="amount tnum">${fmt(v.income - v.expense)}</td></tr>`).join("");
    $("#report-out").innerHTML = `
      <div class="panel" style="margin-bottom:16px">
        <h3 style="display:block">Income &amp; Expenditure Statement</h3>
        <div style="color:var(--muted);font-size:13.5px;margin-top:-6px">Ihlamudheen Madrasa · ${esc(rangeTxt)} · grouped by ${esc(r.group)}</div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="s-label"><span class="dot i"></span>Total Income</div><div class="s-val income tnum">${fmt(T.income)}</div></div>
        <div class="stat-card"><div class="s-label"><span class="dot e"></span>Total Expense</div><div class="s-val expense tnum">${fmt(T.expense)}</div></div>
        <div class="stat-card"><div class="s-label"><span class="dot b"></span>Net Balance</div><div class="s-val tnum">${fmt(T.balance)}</div></div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>${r.group === "month" ? "Month" : r.group === "fund" ? "Fund" : "Category"}</th>
          <th style="text-align:right">Income</th><th style="text-align:right">Expense</th><th style="text-align:right">Net</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4"><div class="empty">No data in this range.</div></td></tr>`}</tbody>
          <tfoot><tr style="font-weight:800"><td style="padding:13px 14px;border-top:2px solid var(--line)">Total</td>
            <td class="amount income tnum" style="border-top:2px solid var(--line)">${fmt(T.income)}</td>
            <td class="amount expense tnum" style="border-top:2px solid var(--line)">${fmt(T.expense)}</td>
            <td class="amount tnum" style="border-top:2px solid var(--line)">${fmt(T.balance)}</td></tr></tfoot>
        </table>
      </div>`;
  }

  // ============================================================
  //  CSV export
  // ============================================================
  function downloadCSV(filename, rows) {
    const csv = rows.map(r => r.map(cell => { const s = String(cell == null ? "" : cell); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = el("a"); a.href = URL.createObjectURL(blob); a.download = filename + "_" + todayISO() + ".csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  function exportCSV(list, name) {
    const rows = [["Date", "Type", "Category", "Fund", "Description", "Reference", "Amount"]];
    list.forEach(t => rows.push([t.occurred_on, t.type, catName[t.category_id] || "", fundName[t.fund_id] || "", t.description || "", t.reference || "", t.amount]));
    downloadCSV(name, rows); toast("CSV downloaded");
  }
  function exportReportCSV() {
    const { r, groups } = reportData();
    const rows = [[r.group === "month" ? "Month" : r.group === "fund" ? "Fund" : "Category", "Income", "Expense", "Net"]];
    Object.entries(groups).forEach(([k, v]) => rows.push([k, v.income, v.expense, v.income - v.expense]));
    downloadCSV("report", rows); toast("CSV downloaded");
  }

  // ============================================================
  //  Modal helpers
  // ============================================================
  function modal(html) {
    const back = el("div", "modal-back"); const m = el("div", "modal", html); back.appendChild(m);
    back.addEventListener("mousedown", (e) => { if (e.target === back) closeModal(); });
    m.querySelectorAll("[data-close]").forEach(b => b.onclick = closeModal);
    $("#modal-root").appendChild(back);
    const first = m.querySelector("input,select,button"); if (first) setTimeout(() => first.focus(), 30);
    return m;
  }
  function closeModal() { $("#modal-root").innerHTML = ""; }
  function confirmModal(title, body, onYes) {
    const m = modal(`<h3>${esc(title)}</h3><p style="color:var(--muted);margin:-6px 0 18px">${esc(body)}</p>
      <div class="m-actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="yes">Yes, continue</button></div>`);
    $("#yes", m).onclick = async () => { $("#yes", m).disabled = true; await onYes(); closeModal(); };
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // go
  boot();
})();
