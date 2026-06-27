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
];

const ORG_LABELS = {
  ethereum: "Ethereum", bitcoin: "Bitcoin", bnb: "Binance",
  "bnb-chain": "Binance", uniswap: "Uniswap", ripple: "Ripple",
  aave: "Aave", doge: "Dogecoin", hype: "Hyperliquid",
  "hyperliquid-dex": "Hyperliquid", tron: "Tron", tronprotocol: "Tron",
  cardano: "Cardano", "cardano-foundation": "Cardano", base: "Base",
  stellar: "Stellar", link: "Chainlink", smartcontractkit: "Chainlink",
  solana: "Solana", "solana-labs": "Solana",
};

function orgLabel(org) {
  const key = (org || "").toLowerCase();
  return ORG_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

const $ = (id) => document.getElementById(id);

function formatNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pluralizePr(n) {
  return n === 1 ? "PR" : "PRs";
}

function parseDate(raw) {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(raw) {
  const d = parseDate(raw);
  if (!d) return raw || "Unknown";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function monthKey(raw) {
  const d = parseDate(raw);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
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
};

// ── URL params ────────────────────────────────────────
function parseParams() {
  const p = new URLSearchParams(window.location.search);
  state.username = (p.get("username") || "").trim().toLowerCase();
  return { org: p.get("org") || "all", project: p.get("project") || "all" };
}

// ── Data loading ──────────────────────────────────────
async function loadSummary() {
  const summary = await loadJson(SUMMARY_URL);
  if (!summary || !Array.isArray(summary.rows)) {
    throw new Error("Invalid dashboard-summary.json");
  }
  return summary.rows.map(row => ({
    org: (row.org || "unknown").toLowerCase(),
    proyecto: row.project || row.proyecto || "",
    usuario: row.user || row.usuario || "",
    avatar_url: row.avatar_url || "",
    n_prs: Number(row.merged_pr_count || row.n_prs || 0),
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
  let avatarUrl = "";
  let firstDate = null;
  let latestDate = null;
  userRows.forEach(r => {
    orgs.add(r.org);
    const p = r.proyecto || "unknown";
    projects.set(p, (projects.get(p) || 0) + r.n_prs);
    totalPrs += r.n_prs;
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
    n_projects: projects.size,
    orgs: [...orgs].sort(),
    top_project: topProject ? topProject[0] : "",
    firstDate: firstDate ? formatDate(firstDate) : "Unknown",
    latestDate: latestDate ? formatDate(latestDate) : "Unknown",
    projects,
  };
}

// ── Render ────────────────────────────────────────────
function showNotFound() {
  $("loadState").hidden = true;
  $("userNotFound").hidden = false;
  $("breadcrumbUser").textContent = "Not found";
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
    ? `Multi-ecosystem contributor across ${orgLabels.join(", ")}`
    : `Active in ${orgLabels[0] || "this ecosystem"}`;
  $("heroPrs").textContent = formatNumber(user.n_prs);
  $("heroProjects").textContent = formatNumber(user.n_projects);
  $("heroOrgs").textContent = formatNumber(user.orgs.length);
  $("breadcrumbUser").textContent = user.usuario;
}

function renderStatCards(user) {
  $("firstContrib").textContent = user.firstDate;
  $("latestContrib").textContent = user.latestDate;
  $("totalPrsStat").textContent = formatNumber(user.n_prs);
  const orgLinks = user.orgs.map(o => `<span class="tag ${escapeHtml(o)}">${escapeHtml(orgLabel(o))}</span>`).join(" ");
  $("orgsList").innerHTML = orgLinks;
}

// ── Detail loading ────────────────────────────────────
async function ensureDetails(user) {
  const sources = user.orgs
    .filter(org => !state.detailRows.has(org) && !state.orgsLoaded.has(org))
    .map(org => RAW_SOURCES.find(s => s.org === org))
    .filter(Boolean);
  if (sources.length === 0) return;

  sources.forEach(s => state.orgsLoaded.add(s.org));
  showRepoLoading();

  const results = await Promise.allSettled(sources.map(s =>
    fetchCsv(s.url).then(rows => ({ org: s.org, rows }))
  ));

  results.forEach(result => {
    if (result.status === "fulfilled") {
      const { org, rows } = result.value;
      const normalized = rows.map(row => ({
        org: (row.org || org).toLowerCase(),
        proyecto: row.proyecto || "",
        usuario: row.usuario || row.user || "",
        avatar_url: row.avatar_url || "",
        pr_number: row.pr_number || "",
        pr_title: row.pr_title || row.title || "",
        url: row.url || row.link || "",
        merged_at: row.merged_at || "",
        merged_date: row.merged_date || "",
      })).filter(r => r.usuario && r.usuario.toLowerCase() === state.username);
      state.detailRows.set(org, normalized);
    }
  });

  renderDetails(user);
}

function userPullRows(user) {
  const all = [];
  state.detailRows.forEach(rows => all.push(...rows));
  return all.sort((a, b) => {
    const aT = Date.parse(a.merged_at || a.merged_date || "0") || 0;
    const bT = Date.parse(b.merged_at || b.merged_date || "0") || 0;
    return bT - aT || Number(b.pr_number) - Number(a.pr_number);
  });
}

function projectBreakdown(pullRows, user) {
  const counts = new Map();
  pullRows.filter(r => r.usuario.toLowerCase() === user.usuario).forEach(r => {
    const p = r.proyecto || "All projects";
    if (!counts.has(p)) counts.set(p, { nPrs: 0, orgs: new Set() });
    const item = counts.get(p);
    item.nPrs += 1;
    if (r.org) item.orgs.add(r.org);
  });
  return [...counts.entries()]
    .map(([project, item]) => ({ project, nPrs: item.nPrs, orgs: [...item.orgs].sort() }))
    .sort((a, b) => b.nPrs - a.nPrs || a.project.localeCompare(b.project));
}

function showRepoLoading() {
  $("repoList").innerHTML = `<div class="project-empty">Loading detailed data…</div>`;
}

function renderDetails(user) {
  const pulls = userPullRows(user);
  const dated = pulls.filter(r => r.merged_at || r.merged_date);
  const firstPR = dated.at(-1);
  const lastPR = dated[0];

  const timelineCounts = new Map();
  dated.forEach(r => {
    const key = monthKey(r.merged_at || r.merged_date);
    if (key) timelineCounts.set(key, (timelineCounts.get(key) || 0) + 1);
  });
  const timeline = [...timelineCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b)).slice(-12)
    .map(([key, count]) => ({ key, count }));
  const maxCount = Math.max(...timeline.map(t => t.count), 1);

  // Timeline
  const yAxis = $("timelineYAxis");
  const bars = $("timelineBars");
  const empty = $("timelineEmpty");
  if (timeline.length > 0) {
    empty.hidden = true;
    yAxis.hidden = false;
    yAxis.innerHTML = `<span>${formatNumber(maxCount)}</span><span>${formatNumber(Math.ceil(maxCount / 2))}</span><span>0</span>`;
    bars.hidden = false;
    bars.style.gridTemplateColumns = `repeat(${timeline.length}, minmax(0, 1fr))`;
    bars.innerHTML = timeline.map(item => {
      const label = monthLabel(item.key);
      const val = `${formatNumber(item.count)} ${pluralizePr(item.count)}`;
      return `<button type="button" class="timeline-bar" aria-label="${escapeHtml(label + ': ' + val)}" data-tooltip="${escapeHtml(label + ': ' + val)}">
        <span class="timeline-track">
          <span class="timeline-fill" style="height: ${Math.max((item.count / maxCount) * 100, 8)}%"></span>
        </span>
        <span class="timeline-label">${escapeHtml(label)}</span>
      </button>`;
    }).join("");
  } else {
    empty.hidden = false;
    yAxis.hidden = true;
    bars.hidden = true;
  }

  // Recent PRs
  const recentEl = $("recentPrList");
  const recent = pulls.slice(0, 6);
  $("recentPrCount").textContent = `${formatNumber(pulls.length)} total`;
  if (recent.length > 0) {
    recentEl.innerHTML = recent.map(pr =>
      `<a class="recent-pr-link" href="${escapeHtml(pr.url)}" target="_blank" rel="noreferrer">
        <span class="recent-pr-title">#${escapeHtml(pr.pr_number)} ${escapeHtml(pr.pr_title || "Untitled PR")}</span>
        <span class="recent-pr-meta">${escapeHtml(orgLabel(pr.org))} / ${escapeHtml(pr.proyecto || "unknown")} - ${escapeHtml(pr.merged_date || pr.merged_at || "")}</span>
      </a>`
    ).join("");
  } else {
    recentEl.innerHTML = `<div class="project-empty">No recent PRs found.</div>`;
  }

  // Repos
  const projects = projectBreakdown(pulls, user);
  $("repoCount").textContent = `${formatNumber(projects.length)} repos`;
  const repoEl = $("repoList");
  if (projects.length > 0) {
    repoEl.innerHTML = projects.map(({ project, nPrs, orgs }) =>
      `<div class="project-item expanded">
        <div class="project-toggle" aria-expanded="true">
          <span>
            <span class="detail-name">${escapeHtml(project)}</span>
            <span class="detail-meta">${escapeHtml(orgs.map(orgLabel).join(", "))}</span>
          </span>
          <span class="project-summary">
            <span class="detail-prs">${formatNumber(nPrs)} ${pluralizePr(nPrs)}</span>
          </span>
        </div>
        <div class="project-pr-list">
          ${pulls.filter(r => r.proyecto === project).slice(0, 20).map(pr =>
            `<a class="project-pr-link" href="${escapeHtml(pr.url)}" target="_blank" rel="noreferrer">
              <span class="project-pr-title">#${escapeHtml(pr.pr_number)} ${escapeHtml(pr.pr_title || "Untitled PR")}</span>
              <span class="project-pr-meta">${escapeHtml(pr.merged_date || pr.merged_at || "")}</span>
            </a>`
          ).join("")}
          ${pulls.filter(r => r.proyecto === project).length > 20
            ? `<div class="project-empty">+ ${formatNumber(pulls.filter(r => r.proyecto === project).length - 20)} more PRs</div>`
            : ""}
        </div>
      </div>`
    ).join("");
  } else {
    repoEl.innerHTML = `<div class="project-empty">No PR detail data available.</div>`;
  }
}

// ── Init ──────────────────────────────────────────────
async function init() {
  const filterParams = parseParams();
  if (!state.username) {
    showNotFound();
    return;
  }

  // Build back-link preserving filter context
  const backLink = $("backLink");
  const bp = new URLSearchParams();
  if (filterParams.org !== "all") bp.set("org", filterParams.org);
  if (filterParams.project !== "all") bp.set("project", filterParams.project);
  const qs = bp.toString();
  backLink.href = `./${qs ? "?" + qs : ""}`;

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
