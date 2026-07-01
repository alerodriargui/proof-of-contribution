/* ====================================================
   user.js — Contributor profile page logic
   ==================================================== */

const SUMMARY_URL = "../data/dashboard-summary.json";
const RAW_SOURCES = [
  { url: "../data/ethereum_merged_prs.csv", org: "ethereum" },
  { url: "../data/bitcoin_merged_prs.csv", org: "bitcoin" },
  { url: "../data/aave_merged_prs.csv", org: "aave" },
  { url: "../data/uniswap_merged_prs.csv", org: "uniswap" },
  { url: "../data/ripple_merged_prs.csv", org: "ripple" },
  { url: "../data/bnb_merged_prs.csv", org: "bnb" },
  { url: "../data/doge_merged_prs.csv", org: "doge" },
  { url: "../data/hype_merged_prs.csv", org: "hype" },
  { url: "../data/tron_merged_prs.csv", org: "tron" },
  { url: "../data/cardano_merged_prs.csv", org: "cardano" },
  { url: "../data/stellar_merged_prs.csv", org: "stellar" },
  { url: "../data/link_merged_prs.csv", org: "link" },
  { url: "../data/solana_merged_prs.csv", org: "solana" },
  { url: "../data/avalanche_merged_prs.csv", org: "avalanche" },
  { url: "../data/arbitrum_merged_prs.csv", org: "arbitrum" },
  { url: "../data/polygon_merged_prs.csv", org: "polygon" },
  { url: "../data/near_merged_prs.csv", org: "near" },
  { url: "../data/sui_merged_prs.csv", org: "sui" },
];

const ORG_LABELS = {
  ethereum: "Ethereum", bitcoin: "Bitcoin", bnb: "Binance",
  "bnb-chain": "Binance", uniswap: "Uniswap", ripple: "Ripple",
  aave: "Aave", doge: "Dogecoin", hype: "Hyperliquid",
  "hyperliquid-dex": "Hyperliquid", tron: "Tron", tronprotocol: "Tron",
  cardano: "Cardano", "cardano-foundation": "Cardano", base: "Base",
  stellar: "Stellar", link: "Chainlink", smartcontractkit: "Chainlink",
  solana: "Solana", "solana-labs": "Solana",
  avalanche: "Avalanche", "ava-labs": "Avalanche",
  arbitrum: "Arbitrum", offchainlabs: "Arbitrum",
  polygon: "Polygon", "0xpolygon": "Polygon",
  near: "NEAR", sui: "Sui", mystenlabs: "Sui",
};

const ORG_ALIASES = {
  "bnb-chain": "bnb",
  dogecoin: "doge",
  "hyperliquid-dex": "hype",
  tronprotocol: "tron",
  "cardano-foundation": "cardano",
  smartcontractkit: "link",
  "solana-labs": "solana",
  "ava-labs": "avalanche",
  offchainlabs: "arbitrum",
  "0xpolygon": "polygon",
  mystenlabs: "sui",
};

function canonicalOrg(org) {
  const key = (org || "").toLowerCase();
  return ORG_ALIASES[key] || key;
}

function orgLabel(org) {
  const key = canonicalOrg(org);
  return ORG_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

const ORG_COLORS = {
  ethereum: "#3b82f6", bitcoin: "#f59e0b", bnb: "#e3a00d",
  uniswap: "#a855f7", ripple: "#0ea5e9", aave: "#8b5cf6",
  doge: "#ca8a04", hype: "#06b6d4", tron: "#ef4444",
  cardano: "#0033ad", stellar: "#000000", link: "#2a5ada",
  solana: "#14f195",
  avalanche: "#e84142", arbitrum: "#28a0f0",
  polygon: "#8247e5", near: "#000000", sui: "#4da2ff",
};

function orgColor(org) {
  return ORG_COLORS[canonicalOrg(org)] || "#6366f1";
}

const $ = (id) => document.getElementById(id);

function localizeProfileDom() {
  const textSelectors = [
    ["#backLink", "nav.dashboard"],
    ["#loadState span", "profile.loading"],
    ["#userNotFound h2", "profile.notFoundTitle"],
    ["#userNotFound p", "profile.notFoundCopy"],
    ["#userNotFound .btn", "profile.backToDashboard"],
    ["#ghProfileLink", "profile.githubProfile"],
    [".hero-stat:nth-child(1) .hero-stat-label", "profile.prsMerged"],
    [".hero-stat:nth-child(2) .hero-stat-label", "common.projects"],
    [".hero-stat:nth-child(3) .hero-stat-label", "common.ecosystems"],
    [".profile-stat-card:nth-child(1) .pstat-label", "profile.firstContribution"],
    [".profile-stat-card:nth-child(2) .pstat-label", "profile.latestContribution"],
    [".profile-stat-card:nth-child(3) .pstat-label", "profile.activityStatus"],
    [".profile-stat-card:nth-child(4) .pstat-label", "profile.experienceTier"],
    ["#recentPrList .project-empty", "profile.noRecentPrs"],
  ];
  textSelectors.forEach(([selector, key]) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = t(key);
  });

  const chartTitles = document.querySelectorAll(".chart-card-header h3");
  const chartSubtitles = document.querySelectorAll(".chart-card-header span");
  if (chartTitles[0]) chartTitles[0].textContent = t("profile.prsByEcosystem");
  if (chartTitles[1]) chartTitles[1].textContent = t("profile.topProjects");
  if (chartSubtitles[0]) chartSubtitles[0].textContent = t("profile.ecosystemDistribution");
  if (chartSubtitles[1]) chartSubtitles[1].textContent = t("profile.topProjectsSubtitle");

  const sectionTitles = document.querySelectorAll(".ps-head h3");
  if (sectionTitles[0]) sectionTitles[0].textContent = t("profile.monthlyTrend");
  if (sectionTitles[1]) sectionTitles[1].textContent = t("profile.recentPrs");
}

function formatNumber(n) {
  return window.pocI18n ? window.pocI18n.formatNumber(n) : new Intl.NumberFormat("en-US").format(n);
}

function t(key, params = {}) {
  return window.pocI18n ? window.pocI18n.t(key, params) : key;
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pluralizePr(n) {
  return n === 1 ? t("common.pr") : t("common.prs");
}

const CONTRIBUTOR_TIERS = [
  { id: "1", label: "Newcomer", range: "1 merged Contribution", min: 1, max: 1 },
  { id: "2", label: "Explorer", range: "2 merged Contributions", min: 2, max: 2 },
  { id: "3-5", label: "Regular", range: "3–5 merged Contributions", min: 3, max: 5 },
  { id: "6-10", label: "Builder", range: "6–10 merged Contributions", min: 6, max: 10 },
  { id: "11-20", label: "Experienced", range: "11–20 merged Contributions", min: 11, max: 20 },
  { id: "21-50", label: "Core", range: "21–50 merged Contributions", min: 21, max: 50 },
  { id: "51-100", label: "Veteran", range: "51–100 merged Contributions", min: 51, max: 100 },
  { id: "101-500", label: "Elite", range: "101–500 merged Contributions", min: 101, max: 500 },
  { id: "501-1000", label: "Legend", range: "501–1000 merged Contributions", min: 501, max: 1000 },
  { id: "1000-plus", label: "Icon", range: "More than 1000 merged Contributions", min: 1001, max: Infinity },
];

function contributorTier(prCount) {
  return CONTRIBUTOR_TIERS.find((tier) => prCount >= tier.min && prCount <= tier.max) || CONTRIBUTOR_TIERS[0];
}

function contributorTierMarkup(prCount) {
  const tier = contributorTier(prCount);
  return `<span class="tier-badge tier-${tier.id}" title="${escapeHtml(t(`tier.range${tier.id}`))}">${escapeHtml(t(`tier.${tier.id}`))}</span>`;
}

function activityStatus(latestContributionDate) {
  if (!latestContributionDate) {
    return { key: "inactive", label: t("profile.inactive"), tone: "inactive" };
  }
  const inactiveAfter = new Date();
  inactiveAfter.setMonth(inactiveAfter.getMonth() - 3);
  const active = latestContributionDate >= inactiveAfter;
  return active
    ? { key: "active", label: t("profile.active"), tone: "active" }
    : { key: "inactive", label: t("profile.inactive"), tone: "inactive" };
}

function activityStatusMarkup(latestContributionDate) {
  const status = activityStatus(latestContributionDate);
  return `<span class="activity-status activity-status-${status.tone}">
    <span class="activity-dot" aria-hidden="true"></span>
    <span>${escapeHtml(status.label)}</span>
  </span>`;
}

function parseDate(raw) {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(raw) {
  const d = parseDate(raw);
  if (!d) return raw || t("common.unknown");
  return d.toLocaleDateString(window.pocI18n?.locale || "en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(raw) {
  const d = parseDate(raw);
  if (!d) return "";
  const diffMs = Date.now() - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("profile.timeAgoJustNow");
  if (diffMin < 60) return t("profile.timeAgoMin", { n: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("profile.timeAgoHour", { n: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return t("profile.timeAgoDay", { n: diffDay });
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return t("profile.timeAgoWeek", { n: diffWeek });
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return t("profile.timeAgoMonth", { n: diffMonth });
  return t("profile.timeAgoYear", { n: Math.floor(diffDay / 365) });
}

function groupPrsByTime(pulls) {
  const now = Date.now();
  const groups = { month: [], quarter: [], older: [] };
  pulls.forEach(pr => {
    const d = parseDate(pr.merged_at || pr.merged_date);
    if (!d) { groups.older.push(pr); return; }
    const diffDay = (now - d) / 86400000;
    if (diffDay <= 31) groups.month.push(pr);
    else if (diffDay <= 93) groups.quarter.push(pr);
    else groups.older.push(pr);
  });
  return groups;
}

function monthKey(raw) {
  const d = parseDate(raw);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(window.pocI18n?.locale || "en-US", {
    month: "short", year: "2-digit", timeZone: "UTC",
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && quoted && n === '"') { value += '"'; i++; }
    else if (c === '"') { quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && n === "\n") i++;
      row.push(value);
      if (row.some(v => v.trim())) rows.push(row);
      row = []; value = "";
    } else { value += c; }
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? "").trim(); });
    return obj;
  });
}

async function fetchCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ── State ─────────────────────────────────────────────
const state = {
  username: "",
  summaryRows: [],
  summaryUser: null,
  detailRows: new Map(),
  orgsLoaded: new Set(),
  charts: [],
};

// ── URL params (query string OR pathname) ────────────
function parseParams() {
  const p = new URLSearchParams(window.location.search);
  let username = (p.get("username") || "").trim().toLowerCase();
  if (!username) {
    const match = window.location.pathname.match(/\/contributors\/([^/]+)/i);
    if (match) {
      username = decodeURIComponent(match[1]).trim().toLowerCase();
    }
  }
  state.username = username;
  const orgs = p.get("orgs") || p.get("org") || "";
  const projects = p.get("projects") || p.get("project") || "";
  return { org: orgs || "all", project: projects || "all", orgs, projects };
}

function updateOgMeta(user) {
  const title = `${user.usuario} – Contributor Profile | Proof of Contribution`;
  const desc = `${user.usuario} contributed ${formatNumber(user.n_prs)} Contributions across ${user.orgs.length} ecosystem(s). View their full contribution profile.`;
  document.title = title;
  const set = (q, v) => { const el = document.querySelector(q); if (el) el.setAttribute("content", v); };
  set('meta[property="og:title"]', title);
  set('meta[name="description"]', desc);
  set('meta[property="og:description"]', desc);
  set('meta[name="twitter:title"]', title);
  set('meta[name="twitter:description"]', desc);
  set('meta[property="og:url"]', window.location.href);
}

// ── Data loading ──────────────────────────────────────
async function loadSummary() {
  const summary = await loadJson(SUMMARY_URL);
  if (!summary || !Array.isArray(summary.rows)) {
    throw new Error("Invalid dashboard-summary.json");
  }
  return summary.rows.map(row => ({
    org: canonicalOrg(row.org || "unknown"),
    proyecto: row.project || row.proyecto || "",
    usuario: row.user || row.usuario || "",
    avatar_url: row.avatar_url || "",
    n_prs: Number(row.merged_pr_count || row.n_prs || 0),
    total_additions: Number(row.total_additions || 0),
    total_deletions: Number(row.total_deletions || 0),
    total_changed_lines: Number(row.total_changed_lines || 0),
    unknown_line_count: Number(row.unknown_line_count || 0),
    merged_at: row.latest_merged_at || "",
    merged_date: row.latest_merged_at || "",
    first_merged_at: row.first_merged_at || "",
  })).filter(r => r.usuario && Number.isFinite(r.n_prs) && r.n_prs > 0);
}

function buildUserFromSummary(rows) {
  const userRows = rows.filter(r => r.usuario.toLowerCase() === state.username);
  if (userRows.length === 0) return null;
  const orgs = new Set();
  const projects = new Map();
  let totalPrs = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  let totalChangedLines = 0;
  let unknownLineCount = 0;
  let avatarUrl = "";
  let firstDate = null;
  let latestDate = null;
  userRows.forEach(r => {
    orgs.add(r.org);
    const p = r.proyecto || "unknown";
    projects.set(p, (projects.get(p) || 0) + r.n_prs);
    totalPrs += r.n_prs;
    totalAdditions += r.total_additions || 0;
    totalDeletions += r.total_deletions || 0;
    totalChangedLines += r.total_changed_lines || 0;
    unknownLineCount += r.unknown_line_count || 0;
    if (r.avatar_url) avatarUrl = r.avatar_url;
    const fd = parseDate(r.first_merged_at);
    if (fd && (!firstDate || fd < firstDate)) firstDate = fd;
    const ld = parseDate(r.merged_at || r.merged_date);
    if (ld && (!latestDate || ld > latestDate)) latestDate = ld;
  });
  const topProject = [...projects.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    usuario: state.username,
    avatar_url: avatarUrl,
    n_prs: totalPrs,
    total_additions: totalAdditions,
    total_deletions: totalDeletions,
    total_changed_lines: totalChangedLines,
    unknown_line_count: unknownLineCount,
    n_projects: projects.size,
    orgs: [...orgs].sort(),
    top_project: topProject ? topProject[0] : "",
    firstDate: firstDate ? formatDate(firstDate) : t("common.unknown"),
    latestDate: latestDate ? formatDate(latestDate) : t("common.unknown"),
    latestContributionDate: latestDate,
    experience_tier: contributorTier(totalPrs),
    projects,
  };
}

// ── Render ────────────────────────────────────────────
function showNotFound() {
  $("loadState").hidden = true;
  $("userNotFound").hidden = false;
  $("breadcrumbUser").textContent = t("profile.notFoundBreadcrumb");
}

function renderHero(user) {
  const avatarEl = $("avatarImg");
  const src = user.avatar_url || `https://github.com/${encodeURIComponent(user.usuario)}.png?size=128`;
  avatarEl.src = src;
  avatarEl.onerror = function () { this.remove(); };
  $("profileUsername").textContent = user.usuario;
  $("ghProfileLink").href = `https://github.com/${encodeURIComponent(user.usuario)}`;
  const orgLabels = user.orgs.map(orgLabel);
  $("profileEcosystem").textContent = user.orgs.length > 1
    ? t("profile.multiEcosystem", { ecosystems: orgLabels.join(", ") })
    : t("profile.activeIn", { ecosystem: orgLabels[0] || t("profile.thisEcosystem") });
  $("heroPrs").textContent = formatNumber(user.n_prs);
  $("heroProjects").textContent = formatNumber(user.n_projects);
  $("heroOrgs").textContent = formatNumber(user.orgs.length);
  $("breadcrumbUser").textContent = user.usuario;
  updateOgMeta(user);
}

function renderStatCards(user) {
  $("firstContrib").textContent = user.firstDate;
  $("latestContrib").textContent = user.latestDate;
  const totalPrsEl = $("totalPrsStat");
  if (totalPrsEl) totalPrsEl.textContent = formatNumber(user.n_prs);
  const activityStatusEl = $("activityStatus");
  if (activityStatusEl) activityStatusEl.innerHTML = activityStatusMarkup(user.latestContributionDate);
  const changedLinesEl = $("changedLinesStat");
  if (changedLinesEl) changedLinesEl.textContent = user.total_changed_lines
    ? formatNumber(user.total_changed_lines)
    : t("common.unknown");
  const unknownLineCountEl = $("unknownLineCountStat");
  if (unknownLineCountEl) {
    unknownLineCountEl.textContent = user.unknown_line_count
      ? formatNumber(user.unknown_line_count)
      : "0";
  }
  const tierEl = $("experienceTier");
  if (tierEl) tierEl.innerHTML = contributorTierMarkup(user.n_prs);
  const orgsListEl = $("orgsList");
  if (orgsListEl) {
    const orgLinks = user.orgs.map(o => {
      const c = orgColor(o);
      return `<span class="tag"><span class="tag-dot" style="background:${c}"></span>${escapeHtml(orgLabel(o))}</span>`;
    }).join(" ");
    orgsListEl.innerHTML = orgLinks;
  }
}

// ── Detail loading ────────────────────────────────────
async function ensureDetails(user) {
  const sources = user.orgs
    .filter(org => !state.detailRows.has(org) && !state.orgsLoaded.has(org))
    .map(org => RAW_SOURCES.find(s => s.org === canonicalOrg(org)))
    .filter(Boolean);
  if (sources.length === 0) return;

  sources.forEach(s => state.orgsLoaded.add(s.org));

  const results = await Promise.allSettled(sources.map(s =>
    fetchCsv(s.url).then(rows => ({ org: s.org, rows }))
  ));

  results.forEach(result => {
    if (result.status === "fulfilled") {
      const { org, rows } = result.value;
      const normalized = rows.map(row => ({
        org: canonicalOrg(row.org || org),
        proyecto: row.proyecto || "",
        usuario: row.usuario || row.user || "",
        avatar_url: row.avatar_url || "",
        pr_number: row.pr_number || "",
        pr_title: row.pr_title || row.title || "",
        url: row.url || row.link || "",
        merged_at: row.merged_at || "",
        merged_date: row.merged_date || "",
        additions: row.additions || "",
        deletions: row.deletions || "",
        changed_lines: row.changed_lines || "",
      })).filter(r => r.usuario && r.usuario.toLowerCase() === state.username);
      state.detailRows.set(org, normalized);
    }
  });

  renderDetails(user);
}

function userPullRows() {
  const all = [];
  state.detailRows.forEach(rows => all.push(...rows));
  return all.sort((a, b) => {
    const aT = Date.parse(a.merged_at || a.merged_date || "0") || 0;
    const bT = Date.parse(b.merged_at || b.merged_date || "0") || 0;
    return bT - aT || Number(b.pr_number) - Number(a.pr_number);
  });
}

function destroyCharts() {
  state.charts.forEach(c => c.destroy());
  state.charts = [];
}

function renderCharts(pulls, user) {
  destroyCharts();

  const isDark = document.documentElement.classList.contains("dark");
  const textColor = isDark ? "#94a3b8" : "#687586";
  const gridColor = isDark ? "rgba(255,255,255,0.05)" : "#f0f0f0";
  const tooltipOpts = {
    enabled: true,
    backgroundColor: isDark ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.95)",
    titleColor: isDark ? "#f9fafb" : "#111827",
    bodyColor: isDark ? "#d1d5db" : "#4b5563",
    borderColor: isDark ? "#374151" : "#e5e7eb",
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
  };

  // ── 1. Doughnut: Contributions by ecosystem ────────────────
  const orgCounts = new Map();
  pulls.forEach(r => {
    const o = r.org || "other";
    orgCounts.set(o, (orgCounts.get(o) || 0) + 1);
  });
  const orgEntries = [...orgCounts.entries()].sort((a, b) => b[1] - a[1]);
  const ecoCtx = document.getElementById("chartEcosystems");
  if (orgEntries.length > 0 && ecoCtx) {
    state.charts.push(new Chart(ecoCtx, {
      type: "doughnut",
      data: {
        labels: orgEntries.map(([org]) => orgLabel(org)),
        datasets: [{
          data: orgEntries.map(([, c]) => c),
          backgroundColor: orgEntries.map(([org]) => orgColor(org)),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "55%",
        plugins: {
          legend: {
            position: "right",
            labels: { color: textColor, boxWidth: 12, padding: 12, font: { size: 11 } },
          },
          tooltip: {
            ...tooltipOpts,
            callbacks: {
              label: ctx => ` ${ctx.label}: ${formatNumber(ctx.parsed)} ${pluralizePr(ctx.parsed)}`,
            },
          },
        },
      },
    }));
  }

  // ── 2. Horizontal bar: Top 10 projects ────────────
  const projectCounts = new Map();
  pulls.forEach(r => {
    const p = r.proyecto || "unknown";
    projectCounts.set(p, (projectCounts.get(p) || 0) + 1);
  });
  const topProjects = [...projectCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10);
  const projCtx = document.getElementById("chartProjects");
  if (topProjects.length > 0 && projCtx) {
    state.charts.push(new Chart(projCtx, {
      type: "bar",
      data: {
        labels: topProjects.map(([p]) => p),
        datasets: [{
          data: topProjects.map(([, c]) => c),
          backgroundColor: topProjects.map(() => (isDark ? "#6366f1" : "#4f46e5")),
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOpts,
            callbacks: {
              label: ctx => ` ${formatNumber(ctx.parsed.x)} ${pluralizePr(ctx.parsed.x)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 } },
            beginAtZero: true,
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 10 } },
          },
        },
      },
    }));
  }

  // ── 3. Line: Monthly trend ────────────────────────
  const dated = pulls.filter(r => r.merged_at || r.merged_date);
  const monthBuckets = new Map();
  dated.forEach(r => {
    const key = monthKey(r.merged_at || r.merged_date);
    if (key) monthBuckets.set(key, (monthBuckets.get(key) || 0) + 1);
  });
  const sortedMonths = [...monthBuckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  const trendCtx = document.getElementById("chartTrend");
  if (sortedMonths.length > 0 && trendCtx) {
    const lineColor = isDark ? "#818cf8" : "#4f46e5";
    const fillColor = isDark ? "rgba(99,102,241,0.15)" : "rgba(79,70,229,0.12)";
    const pointColor = isDark ? "#a5b4fc" : "#6366f1";
    state.charts.push(new Chart(trendCtx, {
      type: "line",
      data: {
        labels: sortedMonths.map(([k]) => monthLabel(k)),
        datasets: [{
          data: sortedMonths.map(([, c]) => c),
          borderColor: lineColor,
          backgroundColor: fillColor,
          fill: true,
          tension: 0.25,
          pointBackgroundColor: pointColor,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBorderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOpts,
            callbacks: {
              label: ctx => ` ${formatNumber(ctx.parsed.y)} ${pluralizePr(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { size: 10 },
              maxTicksLimit: 12,
            },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { size: 10 },
              precision: 0,
            },
            beginAtZero: true,
          },
        },
      },
    }));
  }
}

function renderRecentPrs(pulls) {
  const recentEl = $("recentPrList");
  $("recentPrCount").textContent = `${formatNumber(pulls.length)} ${t("common.total")}`;
  if (pulls.length === 0) {
    recentEl.innerHTML = `<div class="project-empty">${escapeHtml(t("profile.noRecentPrs"))}</div>`;
    return;
  }
  const groups = groupPrsByTime(pulls);
  const groupOrder = [
    { key: "month", label: t("profile.recentPrGroupMonth") },
    { key: "quarter", label: t("profile.recentPrGroupQuarter") },
    { key: "older", label: t("profile.recentPrGroupOlder") },
  ];
  let html = "";
  for (const g of groupOrder) {
    const items = groups[g.key];
    if (items.length === 0) continue;
    html += `<div class="recent-pr-group">
      <div class="recent-pr-group-head">
        <span class="recent-pr-group-label">${escapeHtml(g.label)}</span>
        <span class="recent-pr-group-count">${formatNumber(items.length)}</span>
      </div>`;
    html += items.map(pr =>
      `<a class="recent-pr-link" href="${escapeHtml(pr.url)}" target="_blank" rel="noreferrer">
        <span class="recent-pr-dot" style="--dot-c:${orgColor(pr.org)}"></span>
        <span class="recent-pr-body">
          <span class="recent-pr-title">#${escapeHtml(pr.pr_number)} ${escapeHtml(pr.pr_title || "")}</span>
          <span class="recent-pr-meta">
            <span class="recent-pr-org" style="--org-c:${orgColor(pr.org)}">${escapeHtml(orgLabel(pr.org))}</span>
            <span class="recent-pr-project">${escapeHtml(pr.proyecto || "unknown")}</span>
            <span class="recent-pr-date">· ${escapeHtml(timeAgo(pr.merged_at || pr.merged_date))}</span>
          </span>
        </span>
      </a>`
    ).join("");
    html += `</div>`;
  }
  recentEl.innerHTML = html;
}

function renderDetails(user) {
  const pulls = userPullRows();
  const dated = pulls.filter(r => r.merged_at || r.merged_date);

  // Update timeline info
  $("timelineInfo").textContent = `${formatNumber(pulls.length)} ${t("common.total")} ${t("common.prs")}`;

  // Charts
  renderCharts(pulls, user);

  // Recent Contributions
  renderRecentPrs(pulls);
}

// ── Init ──────────────────────────────────────────────
function refreshProfileLocale() {
  localizeProfileDom();

  if (!state.username) {
    return;
  }

  if (state.summaryRows.length > 0) {
    const user = buildUserFromSummary(state.summaryRows);
    if (!user) {
      showNotFound();
      return;
    }
    state.summaryUser = user;
    renderHero(user);
    renderStatCards(user);
    renderDetails(user);
  }
}

window.addEventListener("poc:locale-ready", refreshProfileLocale);

async function init() {
  if (window.pocI18n) {
    await window.pocI18n.ready;
  }
  localizeProfileDom();
  const filterParams = parseParams();
  if (!state.username) {
    showNotFound();
    return;
  }

  // Build back-link preserving filter context
  const backLink = $("backLink");
  const bp = new URLSearchParams();
  if (filterParams.orgs) bp.set("orgs", filterParams.orgs);
  if (filterParams.projects) bp.set("projects", filterParams.projects);
  const qs = bp.toString();
  backLink.href = `../app/${qs ? "?" + qs : ""}`;

  try {
    state.summaryRows = await loadSummary();
    const user = buildUserFromSummary(state.summaryRows);
    if (!user) {
      showNotFound();
      return;
    }
    state.summaryUser = user;

    $("loadState").hidden = true;
    $("profileContent").hidden = false;

    renderHero(user);
    renderStatCards(user);

    // Load detail CSVs in background
    ensureDetails(user);

    // Re-render charts on theme toggle
    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        setTimeout(() => {
          const pulls = userPullRows();
          if (pulls.length > 0) renderCharts(pulls, state.summaryUser);
        }, 80);
      });
    }
  } catch (err) {
    $("loadState").hidden = true;
    const statusEl = $("dataStatus");
    if (statusEl) {
      statusEl.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`;
    }
    console.error(err);
  }
}

init().catch(err => console.error(err));
