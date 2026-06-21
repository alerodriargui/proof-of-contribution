/* ====================================================
   stats.js — Statistics page logic
   Loads the per-network CSV files and renders 4 charts:
     1. Merged PRs per network over time (multi-line)
     2. New contributors per period (bar)
     3. Cumulative total contributors (line)
     4. Cumulative total PRs (line)
   ==================================================== */

// ── Network definitions ──────────────────────────────
const NETWORKS = [
  { id: "ethereum", label: "Ethereum",    color: "#3b82f6" },
  { id: "bitcoin",  label: "Bitcoin",     color: "#f59e0b" },
  { id: "bnb",      label: "Binance",     color: "#e3a00d" },
  { id: "uniswap",  label: "Uniswap",     color: "#a855f7" },
  { id: "ripple",   label: "Ripple",      color: "#0ea5e9" },
  { id: "aave",     label: "Aave",        color: "#8b5cf6" },
  { id: "doge",     label: "Dogecoin",    color: "#ca8a04" },
  { id: "hype",     label: "Hyperliquid", color: "#06b6d4" },
  { id: "tron",     label: "Tron",        color: "#ef4444" },
  { id: "cardano",  label: "Cardano",     color: "#0033ad" },
  { id: "stellar",  label: "Stellar",     color: "#000000" },
  { id: "link",     label: "Chainlink",   color: "#2a5ada" },
  { id: "solana",   label: "Solana",      color: "#14f195" },
];

// ── Data sources (same as app.js) ────────────────────
const PULL_SOURCES = NETWORKS.map((net) => ({
  url: `../data/${net.id}_merged_prs.csv`,
  org: net.id,
}));

// ── State ─────────────────────────────────────────────
const statsState = {
  // aggregated PR counts: Map<orgId, Map<dayKey, number>>
  aggregatedPrs: new Map(),
  // aggregated projects: Map<orgId, Map<dayKey, Map<projectName, number>>>
  projectActivity: new Map(),
  // user data: Map<usuario, { firstSeen: Date, orgs: Set }>
  userData: new Map(),
  // which orgs are currently visible
  activeOrgs: new Set(NETWORKS.map((n) => n.id)),
  // selected time range in days, or "all"
  range: "all",
  // granularity: "day" | "week" | "month"
  gran: "month",
};

// ── Chart instances ───────────────────────────────────
let chartMergedPrs = null;
let chartNewContrib = null;
let chartTotalContrib = null;
let chartTotalPrs = null;
let chartContribTiers = null;
let chartNetworkShare = null;
let chartMultiNetwork = null;
let chartDayOfWeek = null;

// ── DOM helpers ───────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── CSV parser (minimal, repeated for self-containment) ──
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"' && quoted && n === '"') { value += '"'; i++; }
    else if (c === '"') { quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ""; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && n === '\n') i++;
      row.push(value);
      if (row.some((v) => v.trim())) rows.push(row);
      row = []; value = "";
    } else { value += c; }
  }
  if (value || row.length) { row.push(value); rows.push(row); }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? "").trim(); });
    return obj;
  });
}

async function fetchCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseCsvRows(await res.text());
}

// ── Date bucketing ────────────────────────────────────
function parseDate(row) {
  const raw = row.merged_date || row.merged_at || "";
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function bucketKey(date, gran) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  if (gran === "month") return `${y}-${m}`;
  if (gran === "week") {
    // ISO week start (Monday)
    const t = Date.UTC(y, date.getUTCMonth(), date.getUTCDate());
    const dow = new Date(t).getUTCDay(); // 0=Sun
    const diff = (dow === 0 ? -6 : 1 - dow);
    const monday = new Date(t + diff * 86400000);
    return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  }
  return `${y}-${m}-${d}`;
}

function bucketLabel(key, gran) {
  if (gran === "month") {
    const [y, m] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d || 1);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Range filter ──────────────────────────────────────
function cutoffDate(range) {
  if (range === "all") return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Number(range));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Data processing ───────────────────────────────────
function buildTimeSeries() {
  const { aggregatedPrs, userData, activeOrgs, range, gran } = statsState;
  const cutoff = cutoffDate(range);

  const allKeys = new Set();
  const orgBuckets = new Map();

  aggregatedPrs.forEach((days, org) => {
    if (!activeOrgs.has(org)) return;
    const buckets = new Map();
    orgBuckets.set(org, buckets);

    days.forEach((count, dayKey) => {
      const [y, m, d] = dayKey.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (cutoff && date < cutoff) return;
      
      const key = bucketKey(date, gran);
      allKeys.add(key);
      buckets.set(key, (buckets.get(key) || 0) + count);
    });
  });

  const sortedKeys = [...allKeys].sort();
  const labels = sortedKeys.map((k) => bucketLabel(k, gran));

  const mergedPrsDatasets = [];
  NETWORKS.forEach((net) => {
    if (!activeOrgs.has(net.id)) return;
    const buckets = orgBuckets.get(net.id) || new Map();
    mergedPrsDatasets.push({
      label: net.label,
      data: sortedKeys.map((k) => buckets.get(k) || 0),
      borderColor: net.color,
      backgroundColor: net.color + "22",
      borderWidth: 2,
      pointRadius: sortedKeys.length > 60 ? 0 : 3,
      pointHoverRadius: 5,
      tension: 0, // Performance: Straight lines are faster to draw
      fill: false,
    });
  });

  const newContribBuckets = new Map();
  let totalContribBeforeCutoff = 0;
  userData.forEach((data) => {
    const { firstSeen } = data;
    if (cutoff && firstSeen < cutoff) {
      totalContribBeforeCutoff++;
      return;
    }
    const key = bucketKey(firstSeen, gran);
    if (!allKeys.has(key)) return;
    newContribBuckets.set(key, (newContribBuckets.get(key) || 0) + 1);
  });

  const newContribData = sortedKeys.map((k) => newContribBuckets.get(k) || 0);

  let runningContrib = totalContribBeforeCutoff;
  const cumulContribData = sortedKeys.map((k) => {
    runningContrib += newContribBuckets.get(k) || 0;
    return runningContrib;
  });

  const totalPrPerBucket = new Map();
  let runningPrs = 0;

  aggregatedPrs.forEach((days, org) => {
    if (!activeOrgs.has(org)) return;
    days.forEach((count, dayKey) => {
      const [y, m, d] = dayKey.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (cutoff && date < cutoff) {
        runningPrs += count;
        return;
      }
      const key = bucketKey(date, gran);
      if (!allKeys.has(key)) return;
      totalPrPerBucket.set(key, (totalPrPerBucket.get(key) || 0) + count);
    });
  });

  const cumulPrsData = sortedKeys.map((k) => {
    runningPrs += totalPrPerBucket.get(k) || 0;
    return runningPrs;
  });

  // ── 5. Contributor Tiers (Experience) ────────────────
  const userPrCounts = new Map();
  statsState.projectActivity.forEach((days, org) => {
    if (!activeOrgs.has(org)) return;
    days.forEach((projectCounts) => {
      // Note: projectActivity doesn't track users per project per day yet.
      // I'll use a simpler approach: calculate PRs per user overall.
    });
  });

  // Refined approach: use the userData which already tracks firstSeen and orgs.
  // Wait, userData doesn't track total PRs per user. Let's fix loadAll first.
  
  const tiers = { "1 PR": 0, "2-5 PRs": 0, "6-20 PRs": 0, "21+ PRs": 0 };
  statsState.userData.forEach(u => {
    const count = u.prCount || 0;
    if (count >= 21) tiers["21+ PRs"]++;
    else if (count >= 6)  tiers["6-20 PRs"]++;
    else if (count >= 2)  tiers["2-5 PRs"]++;
    else if (count >= 1)  tiers["1 PR"]++;
  });

  const tierData = Object.keys(tiers).map(k => ({ label: k, value: tiers[k] }));

  // ── 6. Developers by Network ─────────────────────────
  const networkShare = NETWORKS.map(net => {
    if (!activeOrgs.has(net.id)) return { label: net.label, value: 0, color: net.color };
    let developers = 0;
    statsState.userData.forEach((data) => {
      if (data.orgs.has(net.id)) developers++;
    });
    return { label: net.label, value: developers, color: net.color };
  }).filter(n => n.value > 0);

  // ── 7. Loyalty (Multi-network) ───────────────────────
  let singleNet = 0, multiNet = 0;
  statsState.userData.forEach(data => {
    // Only count if at least one of their orgs is active
    const activeUserOrgs = [...data.orgs].filter(o => activeOrgs.has(o));
    if (activeUserOrgs.length === 1) singleNet++;
    else if (activeUserOrgs.length > 1) multiNet++;
  });

  // ── 8. Day of Week ───────────────────────────────────
  const dowCounts = new Array(7).fill(0);
  aggregatedPrs.forEach((days, org) => {
    if (!activeOrgs.has(org)) return;
    days.forEach((count, dayKey) => {
      const [y, m, d] = dayKey.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      dowCounts[dow] += count;
    });
  });

  return {
    labels,
    mergedPrsDatasets,
    newContribData,
    cumulContribData,
    cumulPrsData,
    tierData,
    networkShare,
    loyalty: [singleNet, multiNet],
    dowCounts
  };
}

// ── Number formatter ──────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

// ── Chart.js shared defaults ──────────────────────────
function sharedOptions(labels, yLabel) {
  const isDark = document.documentElement.classList.contains("dark");
  const textColor = isDark ? "#94a3b8" : "#687586";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.05)" : "#f0f0f0";

  return {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 1.8,
    animation: false, // Performance: Disable all animations
    normalized: true, // Performance hint
    spanGaps: true,   // Performance hint
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "start",
        labels: {
          boxWidth: 12,
          boxHeight: 12,
          borderRadius: 6,
          useBorderRadius: true,
          font: { size: 12, weight: "700" },
          color: "#687586",
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: "rgba(17, 24, 39, 0.95)",
        titleColor: "#f9fafb",
        bodyColor: "#d1d5db",
        padding: 12,
        cornerRadius: 10,
        titleFont: { weight: "800" },
        bodyFont: { size: 12 },
        callbacks: {
          label(ctx) {
            return ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(209, 224, 232, 0.5)" },
        ticks: {
          color: "#687586",
          font: { size: 10, weight: "500" },
          maxRotation: 45,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
          callback: function(value) {
            const label = this.getLabelForValue(value);
            // Compact: "Jun 18, 2026" -> "18 Jun"
            // Compact Month: "Jun 2026" -> "Jun '26"
            if (!label.includes(",")) {
               return label.replace(/(\w+) (\d+)/, "$1 '$2"); // Jun 2026 -> Jun '26
            }
            return label.split(",")[0]; // Jun 18, 2026 -> Jun 18
          }
        },
      },
      y: {
        grid: { color: "rgba(209, 224, 232, 0.5)" },
        ticks: {
          color: "#687586",
          font: { size: 11 },
          callback: (v) => fmt(v),
        },
        title: {
          display: !!yLabel,
          text: yLabel ?? "",
          color: "#687586",
          font: { size: 11, weight: "700" },
        },
      },
    },
  };
}

// ── Render charts ─────────────────────────────────────
function renderCharts() {
  const { labels, mergedPrsDatasets, newContribData, cumulContribData, cumulPrsData, tierData, networkShare, loyalty, dowCounts } = buildTimeSeries();

  const totalMergedPrs = mergedPrsDatasets.reduce((sum, ds) => sum + ds.data.reduce((s, v) => s + v, 0), 0);
  const totalNewContribs = newContribData.reduce((s, v) => s + v, 0);
  const peakContribs = cumulContribData.at(-1) ?? 0;
  const peakPrs = cumulPrsData.at(-1) ?? 0;

  $("badgeMergedPrs").textContent   = fmt(totalMergedPrs) + " PRs";
  $("badgeNewContrib").textContent  = fmt(totalNewContribs) + " new";
  $("badgeTotalContrib").textContent = fmt(peakContribs) + " total";
  $("badgeTotalPrs").textContent    = fmt(peakPrs) + " cumul.";

  if (chartMergedPrs) { chartMergedPrs.destroy(); }
  chartMergedPrs = new Chart($("chartMergedPrs").getContext("2d"), {
    type: "line",
    data: { labels, datasets: mergedPrsDatasets },
    options: {
      ...sharedOptions(labels, "PRs merged"),
      plugins: {
        ...sharedOptions(labels, "PRs merged").plugins,
        legend: { display: false },
      },
    },
  });

  if (chartNewContrib) { chartNewContrib.destroy(); }
  chartNewContrib = new Chart($("chartNewContrib").getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "New contributors",
        data: newContribData,
        backgroundColor: "rgba(79, 70, 229, 0.72)",
        borderRadius: 4,
      }],
    },
    options: {
      ...sharedOptions(labels, "New contributors"),
      plugins: {
        ...sharedOptions(labels).plugins,
        legend: { display: false },
        tooltip: {
          ...sharedOptions(labels).plugins.tooltip,
          callbacks: {
            label(ctx) { return ` ${fmt(ctx.parsed.y)} new contributors`; },
          },
        },
      },
    },
  });

  if (chartTotalContrib) { chartTotalContrib.destroy(); }
  chartTotalContrib = new Chart($("chartTotalContrib").getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Total contributors",
        data: cumulContribData,
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.12)",
        borderWidth: 2,
        tension: 0.1,
        fill: true,
        pointRadius: labels.length > 60 ? 0 : 3,
      }],
    },
    options: {
      ...sharedOptions(labels, "Contributors"),
      plugins: {
        ...sharedOptions(labels).plugins,
        legend: { display: false },
        tooltip: {
          ...sharedOptions(labels).plugins.tooltip,
          callbacks: {
            label(ctx) { return ` ${fmt(ctx.parsed.y)} contributors`; },
          },
        },
      },
    },
  });

  if (chartTotalPrs) { chartTotalPrs.destroy(); }
  chartTotalPrs = new Chart($("chartTotalPrs").getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Total merged PRs",
        data: cumulPrsData,
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245, 158, 11, 0.1)",
        borderWidth: 2,
        tension: 0.1,
        fill: true,
        pointRadius: labels.length > 60 ? 0 : 3,
      }],
    },
    options: {
      ...sharedOptions(labels, "Merged PRs"),
      plugins: {
        ...sharedOptions(labels).plugins,
        legend: { display: false },
        tooltip: {
          ...sharedOptions(labels).plugins.tooltip,
          callbacks: {
            label(ctx) { return ` ${fmt(ctx.parsed.y)} total PRs`; },
          },
        },
      },
    },
  });

  // ── 5. Contributor Tiers ───────────────────────────
  if (chartContribTiers) { chartContribTiers.destroy(); }
  chartContribTiers = new Chart($("chartContribTiers").getContext("2d"), {
    type: "bar",
    data: {
      labels: tierData.map(t => t.label),
      datasets: [{
        label: "Developers",
        data: tierData.map(t => t.value),
        backgroundColor: ["#94a3b8", "#6366f1", "#4f46e5", "#3730a3"],
        borderRadius: 4,
      }]
    },
    options: {
      ...sharedOptions([], "Developers"),
      aspectRatio: 1.5,
      plugins: { ...sharedOptions().plugins, legend: { display: false } }
    }
  });

  // ── Chart 6: Network Share ──────────────────────────
  if (chartNetworkShare) { chartNetworkShare.destroy(); }
  chartNetworkShare = new Chart($("chartNetworkShare").getContext("2d"), {
    type: "doughnut",
    data: {
      labels: networkShare.map(n => n.label),
      datasets: [{
        data: networkShare.map(n => n.value),
        backgroundColor: networkShare.map(n => n.color),
        borderWidth: 0,
      }]
    },
    options: {
      aspectRatio: 1.5,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const label = ctx.label || "";
              const value = ctx.parsed || 0;
              return ` ${label}: ${fmt(value)} developers`;
            },
          },
        },
      }
    }
  });

  // ── Chart 7: Loyalty ────────────────────────────────
  if (chartMultiNetwork) { chartMultiNetwork.destroy(); }
  chartMultiNetwork = new Chart($("chartMultiNetwork").getContext("2d"), {
    type: "pie",
    data: {
      labels: ["Single Network", "Multi-network"],
      datasets: [{
        data: loyalty,
        backgroundColor: ["#4f46e5", "#10b981"],
        borderWidth: 0,
      }]
    },
    options: {
      aspectRatio: 1.5,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } }
      }
    }
  });

  // ── Chart 8: Day of Week ────────────────────────────
  const dowLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (chartDayOfWeek) { chartDayOfWeek.destroy(); }
  chartDayOfWeek = new Chart($("chartDayOfWeek").getContext("2d"), {
    type: "bar",
    data: {
      labels: dowLabels,
      datasets: [{
        label: "Total activity",
        data: dowCounts,
        backgroundColor: "rgba(79, 70, 229, 0.7)",
        borderRadius: 4,
      }]
    },
    options: {
      ...sharedOptions(dowLabels, "Total PRs"),
      aspectRatio: 1.5,
      plugins: { ...sharedOptions().plugins, legend: { display: false } }
    }
  });
}

// ── Network toggle UI ─────────────────────────────────
function renderNetworkToggles() {
  const wrap = $("networkToggles");
  wrap.innerHTML = NETWORKS.map((net) => {
    const active = statsState.activeOrgs.has(net.id);
    return `
      <button
        class="net-toggle ${active ? "active" : ""}"
        data-org="${net.id}"
        type="button"
        style="color: ${net.color};"
        aria-pressed="${active}"
      >
        <span class="net-dot" style="background:${net.color};"></span>
        ${net.label}
      </button>`;
  }).join("");

  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-org]");
    if (!btn) return;
    const org = btn.dataset.org;
    if (statsState.activeOrgs.has(org)) {
      if (statsState.activeOrgs.size <= 1) return; // keep at least one
      statsState.activeOrgs.delete(org);
    } else {
      statsState.activeOrgs.add(org);
    }
    renderNetworkToggles();
    renderCharts();
  });
}

// ── Time range buttons ────────────────────────────────
function bindTimeButtons() {
  document.querySelectorAll(".time-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".time-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      statsState.range = btn.dataset.range;
      renderCharts();
    });
  });
}

function bindGranButtons() {
  document.querySelectorAll(".gran-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".gran-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      statsState.gran = btn.dataset.gran;
      renderCharts();
    });
  });
}

// ── Data loading ──────────────────────────────────────
async function loadAll() {
  const loadState = $("statsLoadState");
  const chartsGrid = $("chartsGrid");
  const loadLabel = $("loadLabel");
  const statusEl = $("dataStatus");

  loadState.removeAttribute("hidden");
  chartsGrid.setAttribute("hidden", "");

  const results = await Promise.allSettled(
    PULL_SOURCES.map((src) =>
      fetchCsv(src.url).then((rows) => ({ org: src.org, rows })),
    ),
  );

  let loaded = 0;
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const { org, rows } = result.value;
      const days = new Map();
      const projectDays = new Map(); // dayKey -> Map<projectName, count>

      rows.forEach((row) => {
        const date = parseDate(row);
        const usuario = (row.usuario || row.user || "").trim();
        const project = (row.proyecto || "unknown").trim();
        if (!date || !usuario) return;

        const dayKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

        // 1. Aggregated PRs per day
        days.set(dayKey, (days.get(dayKey) || 0) + 1);

        // 2. Project activity per day
        if (!projectDays.has(dayKey)) projectDays.set(dayKey, new Map());
        const pMap = projectDays.get(dayKey);
        pMap.set(project, (pMap.get(project) || 0) + 1);

        // 3. User mapping
        if (!statsState.userData.has(usuario)) {
          statsState.userData.set(usuario, { firstSeen: date, orgs: new Set(), prCount: 0 });
        }
        const u = statsState.userData.get(usuario);
        if (date < u.firstSeen) u.firstSeen = date;
        u.orgs.add(org);
        u.prCount++;
      });

      statsState.aggregatedPrs.set(org, days);
      statsState.projectActivity.set(org, projectDays);
      loaded++;
    }
  });

  if (loaded === 0) {
    loadLabel.textContent = "";
    if (statusEl) {
      statusEl.innerHTML = `<span class="error">No CSV data found. Serve the repo root and refresh.</span>`;
    }
    return;
  }

  loadState.setAttribute("hidden", "");
  chartsGrid.removeAttribute("hidden");

  renderNetworkToggles();
  bindTimeButtons();
  bindGranButtons();
  renderCharts();

  // Re-render charts when theme changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === "class") {
        renderCharts();
      }
    });
  });
  observer.observe(document.documentElement, { attributes: true });
}

loadAll().catch((err) => {
  const statusEl = $("dataStatus");
  if (statusEl) {
    const msg = err.message || String(err);
    statusEl.innerHTML = `<span class="error">${msg}</span>`;
  }
  console.error(err);
});
