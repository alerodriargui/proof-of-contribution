const SUMMARY_URL = "../data/dashboard-summary.json";
const META_URL = "../data/dashboard-meta.json";

const RAW_SOURCES = [
  { url: "../data/ethereum_merged_prs.csv", kind: "pulls", org: "ethereum" },
  { url: "../data/bitcoin_merged_prs.csv", kind: "pulls", org: "bitcoin" },
  { url: "../data/aave_merged_prs.csv", kind: "pulls", org: "aave" },
  { url: "../data/uniswap_merged_prs.csv", kind: "pulls", org: "uniswap" },
  { url: "../data/ripple_merged_prs.csv", kind: "pulls", org: "ripple" },
  { url: "../data/bnb_merged_prs.csv", kind: "pulls", org: "bnb" },
  { url: "../data/doge_merged_prs.csv", kind: "pulls", org: "doge" },
  { url: "../data/hype_merged_prs.csv", kind: "pulls", org: "hype" },
  { url: "../data/tron_merged_prs.csv", kind: "pulls", org: "tron" },
  { url: "../data/cardano_merged_prs.csv", kind: "pulls", org: "cardano" },
  { url: "../data/stellar_merged_prs.csv", kind: "pulls", org: "stellar" },
  { url: "../data/link_merged_prs.csv", kind: "pulls", org: "link" },
  { url: "../data/solana_merged_prs.csv", kind: "pulls", org: "solana" },
];

const FALLBACK_SOURCES = [
  ...RAW_SOURCES,
  { url: "../data/crypto_merged_prs.csv", kind: "pulls" },
  { url: "../data/crypto_merged_pr_authors_by_project.csv", kind: "project" },
  { url: "../data/crypto_merged_pr_authors.csv", kind: "summary" },
  { url: "../data/ethereum_merged_pr_authors.csv", kind: "legacy", org: "ethereum" },
  { url: "../data/bitcoin_merged_pr_authors.csv", kind: "legacy", org: "bitcoin" },
  { url: "../data/aave_merged_pr_authors.csv", kind: "legacy", org: "aave" },
  { url: "../data/base_merged_pr_authors.csv", kind: "legacy", org: "base" },
];

const DEFAULT_HIDE_BOTS = true;
const HIDE_BOTS_STORAGE_KEY = "poc.hideBots";
const DEFAULT_HIDE_GHOST = true;
const HIDE_GHOST_STORAGE_KEY = "poc.hideGhost";

function preferredHideBots() {
  try {
    const stored = localStorage.getItem(HIDE_BOTS_STORAGE_KEY);
    return stored === null ? DEFAULT_HIDE_BOTS : stored === "true";
  } catch (error) {
    return DEFAULT_HIDE_BOTS;
  }
}

function saveHideBotsPreference(value) {
  try {
    localStorage.setItem(HIDE_BOTS_STORAGE_KEY, String(value));
  } catch (error) {
    // Keep the in-memory filter state if browser storage is unavailable.
  }
}

function preferredHideGhost() {
  try {
    const stored = localStorage.getItem(HIDE_GHOST_STORAGE_KEY);
    return stored === null ? DEFAULT_HIDE_GHOST : stored === "true";
  } catch (error) {
    return DEFAULT_HIDE_GHOST;
  }
}

function saveHideGhostPreference(value) {
  try {
    localStorage.setItem(HIDE_GHOST_STORAGE_KEY, String(value));
  } catch (error) {
  }
}

const state = {
  rows: [],
  dataVersion: "",
  org: "all",
  project: "all",
  query: "",
  sort: "prs",
  hideBots: preferredHideBots(),
  hideGhost: preferredHideGhost(),
  page: 1,
  pageSize: 100,
};

const els = {
  dataStatus: document.querySelector("#dataStatus"),
  userSearch: document.querySelector("#userSearch"),
  orgFilter: document.querySelector("#orgFilter"),
  projectFilter: document.querySelector("#projectFilter"),
  sortMode: document.querySelector("#sortMode"),
  hideBots: document.querySelector("#hideBots"),
  hideGhost: document.querySelector("#hideGhost"),
  metricPrs: document.querySelector("#metricPrs"),
  metricUsers: document.querySelector("#metricUsers"),
  metricProjects: document.querySelector("#metricProjects"),
  metricOrgs: document.querySelector("#metricOrgs"),
  resultCount: document.querySelector("#resultCount"),
  developerRows: document.querySelector("#developerRows"),
  pageSize: document.querySelector("#pageSize"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
  pageInfo: document.querySelector("#pageInfo"),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = (cells[index] ?? "").trim();
    });
    return item;
  });
}

async function loadCsv(source) {
  const version = state.dataVersion ? `?v=${encodeURIComponent(state.dataVersion)}` : "";
  const response = await fetch(`${source.url}${version}`);
  if (!response.ok) {
    throw new Error(`${source.url} returned ${response.status}`);
  }
  return {
    ...source,
    rows: parseCsv(await response.text()),
  };
}

async function loadJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function loadDashboardMeta() {
  try {
    const meta = await loadJson(META_URL, { cache: "no-cache" });
    state.dataVersion = meta.version || "";
    return meta;
  } catch (error) {
    state.dataVersion = "";
    return null;
  }
}

async function loadDashboardSummary() {
  const meta = await loadDashboardMeta();
  const version = meta?.version ? `?v=${encodeURIComponent(meta.version)}` : "";
  const summary = await loadJson(`${SUMMARY_URL}${version}`);
  state.dataVersion = summary.version || state.dataVersion;
  return normalizeSummaryRows(summary);
}

function normalizeRows(source) {
  return source.rows
    .map((row) => ({
      org: (row.org || source.org || "unknown").toLowerCase(),
      proyecto: row.proyecto || "",
      usuario: row.usuario || row.user || "",
      avatar_url: row.avatar_url || row.avatar || "",
      pr_number: row.pr_number || row.number || "",
      pr_title: row.pr_title || row.title || "",
      url: row.url || row.link || "",
      n_prs: source.kind === "pulls" ? 1 : Number(row.n_prs || row.prs || 0),
      merged_at: row.merged_at || "",
      merged_date: row.merged_date || "",
      sourceKind: source.kind,
    }))
    .filter((row) => row.usuario && Number.isFinite(row.n_prs) && row.n_prs > 0);
}

function normalizeSummaryRows(summary) {
  if (!summary || !Array.isArray(summary.rows)) {
    throw new Error("dashboard-summary.json is missing rows");
  }

  return summary.rows
    .map((row) => ({
      org: (row.org || "unknown").toLowerCase(),
      proyecto: row.project || row.proyecto || "",
      usuario: row.user || row.usuario || "",
      avatar_url: row.avatar_url || "",
      pr_number: "",
      pr_title: "",
      url: "",
      n_prs: Number(row.merged_pr_count || row.n_prs || 0),
      merged_at: row.latest_merged_at || "",
      merged_date: row.latest_merged_at || "",
      first_merged_at: row.first_merged_at || "",
      sourceKind: "summary",
    }))
    .filter((row) => row.usuario && Number.isFinite(row.n_prs) && row.n_prs > 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function isBot(login) {
  return /\[bot\]$/i.test(login) || /bot$/i.test(login);
}

function isGhostUser(login) {
  return login.toLowerCase() === "ghost";
}

function aggregateDevelopers(rows) {
  const users = new Map();
  rows.forEach((row) => {
    const key = row.usuario;
    if (!users.has(key)) {
      users.set(key, {
        usuario: row.usuario,
        avatar_url: row.avatar_url,
        n_prs: 0,
        orgs: new Set(),
        projects: new Set(),
        projectCounts: new Map(),
      });
    }

    const item = users.get(key);
    item.n_prs += row.n_prs;
    if (!item.avatar_url && row.avatar_url) {
      item.avatar_url = row.avatar_url;
    }
    if (row.org) {
      item.orgs.add(row.org);
    }
    if (row.proyecto) {
      item.projects.add(row.proyecto);
      item.projectCounts.set(
        row.proyecto,
        (item.projectCounts.get(row.proyecto) || 0) + row.n_prs,
      );
    }
  });

  return [...users.values()].map((item) => {
    const topProject = [...item.projectCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      usuario: item.usuario,
      avatar_url: item.avatar_url,
      n_prs: item.n_prs,
      n_projects: item.projects.size || Number(Boolean(item.n_prs)),
      orgs: [...item.orgs].sort(),
      top_project: topProject ? topProject[0] : "",
    };
  });
}

function sortedDevelopers(rows) {
  const copy = [...rows];
  if (state.sort === "user") {
    copy.sort((a, b) => a.usuario.localeCompare(b.usuario));
  } else if (state.sort === "projects") {
    copy.sort((a, b) => b.n_projects - a.n_projects || b.n_prs - a.n_prs);
  } else {
    copy.sort((a, b) => b.n_prs - a.n_prs || a.usuario.localeCompare(b.usuario));
  }
  return copy;
}

function baseRows() {
  return state.rows.filter((row) => {
    if (state.org !== "all" && row.org !== state.org) {
      return false;
    }
    if (state.project !== "all" && row.proyecto !== state.project) {
      return false;
    }
    if (state.hideBots && isBot(row.usuario)) {
      return false;
    }
    if (state.hideGhost && isGhostUser(row.usuario)) {
      return false;
    }
    return true;
  });
}

function filteredDevelopers(rows) {
  const query = state.query.trim().toLowerCase();
  return aggregateDevelopers(rows).filter((row) => {
    if (!query) {
      return true;
    }
    return row.usuario.toLowerCase().includes(query);
  });
}

function filteredRowsByUserQuery(rows) {
  const query = state.query.trim().toLowerCase();
  if (!query) {
    return rows;
  }
  return rows.filter((row) => row.usuario.toLowerCase().includes(query));
}

function setOptions(select, values, selected, allLabel) {
  const options = [`<option value="all">${allLabel}</option>`]
    .concat(
      values.map((value) => {
        const escaped = escapeHtml(value);
        return `<option value="${escaped}">${escaped}</option>`;
      }),
    )
    .join("");
  select.innerHTML = options;
  select.value = values.includes(selected) ? selected : "all";
}

function orgLabel(org) {
  const labels = {
    ethereum: "Ethereum",
    bitcoin: "Bitcoin",
    bnb: "Binance",
    "bnb-chain": "Binance",
    uniswap: "Uniswap",
    ripple: "Ripple",
    aave: "Aave",
    doge: "Dogecoin",
    hype: "Hyperliquid",
    "hyperliquid-dex": "Hyperliquid",
    tron: "Tron",
    tronprotocol: "Tron",
    cardano: "Cardano",
    "cardano-foundation": "Cardano",
    base: "Base",
    stellar: "Stellar",
    link: "Chainlink",
    smartcontractkit: "Chainlink",
    solana: "Solana",
    "solana-labs": "Solana",
  };
  const key = (org || "").toLowerCase();
  return labels[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

const ORG_COLORS = {
  ethereum: "#3b82f6", bitcoin: "#f59e0b", bnb: "#e3a00d",
  uniswap: "#a855f7", ripple: "#0ea5e9", aave: "#8b5cf6",
  doge: "#ca8a04", hype: "#06b6d4", tron: "#ef4444",
  cardano: "#0033ad", stellar: "#000000", link: "#2a5ada",
  solana: "#14f195", base: "#0052ff",
};

function orgColor(org) {
  return ORG_COLORS[(org || "").toLowerCase()] || "#6366f1";
}

function orgTagMarkup(org) {
  const key = org.toLowerCase();
  const color = orgColor(key);
  return `<span class="tag"><span class="tag-dot" style="background:${color}"></span>${escapeHtml(orgLabel(org))}</span>`;
}

function orgTagClass(org) {
  return org === "all" ? "org-all" : org;
}

function refreshFilters() {
  const orgs = [...new Set(state.rows.map((row) => row.org))].sort();
  const currentOrg = state.org;

  els.orgFilter.innerHTML = '<option value="all">All organizations</option>';
  orgs.forEach((org) => {
    const opt = document.createElement("option");
    opt.value = org;
    opt.textContent = orgLabel(org);
    opt.selected = org === currentOrg;
    els.orgFilter.appendChild(opt);
  });

  const projects = [
    ...new Set(
      state.rows
        .filter((row) => state.org === "all" || row.org === state.org)
        .map((row) => row.proyecto)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  if (!projects.includes(state.project)) {
    state.project = "all";
  }

  els.projectFilter.innerHTML = '<option value="all">All projects</option>';
  projects.forEach((proj) => {
    const opt = document.createElement("option");
    opt.value = proj;
    opt.textContent = proj;
    opt.selected = proj === state.project;
    els.projectFilter.appendChild(opt);
  });
}

function renderMetrics(rows, developers) {
  els.metricPrs.textContent = formatNumber(
    developers.reduce((total, row) => total + row.n_prs, 0),
  );
  els.metricUsers.textContent = formatNumber(developers.length);
  els.metricProjects.textContent = formatNumber(
    new Set(rows.map((row) => row.proyecto).filter(Boolean)).size,
  );
  els.metricOrgs.textContent = formatNumber(new Set(rows.map((row) => row.org)).size);
}

function formatDateLabel(rawDate) {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return rawDate || "Unknown";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pluralizePr(count) {
  return count === 1 ? "PR" : "PRs";
}

function renderDevelopers(developers) {
  const rows = sortedDevelopers(developers);
  const totalPages = Math.max(Math.ceil(rows.length / state.pageSize), 1);
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  const start = (state.page - 1) * state.pageSize;
  const visibleRows = rows.slice(start, start + state.pageSize);
  const rangeStart = rows.length === 0 ? 0 : start + 1;
  const rangeEnd = start + visibleRows.length;

  els.resultCount.textContent = `${formatNumber(rangeStart)}-${formatNumber(rangeEnd)} of ${formatNumber(rows.length)} rows`;
  if (els.pageInfo) {
    els.pageInfo.textContent = `Page ${formatNumber(state.page)} of ${formatNumber(totalPages)}`;
  }
  if (els.prevPage) {
    els.prevPage.disabled = state.page <= 1;
  }
  if (els.nextPage) {
    els.nextPage.disabled = state.page >= totalPages;
  }

  if (rows.length === 0) {
    els.developerRows.innerHTML = `<tr><td colspan="6" class="empty">No rows</td></tr>`;
    return;
  }

  els.developerRows.innerHTML = visibleRows
    .map((row, index) => {
      const bot = isBot(row.usuario);
      const ghostUser = isGhostUser(row.usuario);
      const rank = start + index + 1;
      let orgTags = "";
      if (row.orgs.length > 1) {
        const primaryOrg = row.orgs[0];
        const otherOrgs = row.orgs.slice(1).map(orgLabel).join(", ");
        orgTags = `${orgTagMarkup(primaryOrg)} <span class="tag plus-tag" title="Also active in: ${escapeHtml(otherOrgs)}">+${row.orgs.length - 1}</span>`;
      } else {
        orgTags = row.orgs.map(orgTagMarkup).join(" ");
      }
      return `
        <tr
          class="${[
            bot ? "bot-row" : "",
            ghostUser ? "ghost-user-row" : "",
          ].filter(Boolean).join(" ")}"
          data-user="${escapeHtml(row.usuario)}"
        >
          <td class="rank">${rank}</td>
          <td class="login">
            ${profileLinkMarkup(row)}
          </td>
          <td class="org-tags-cell"><div class="org-tags">${orgTags}</div></td>
          <td class="number">${formatNumber(row.n_prs)}</td>
          <td class="number">${formatNumber(row.n_projects)}</td>
          <td>${escapeHtml(row.top_project)}</td>
        </tr>
      `;
    })
    .join("");
}

function render() {
  refreshFilters();
  const rows = baseRows();
  const visibleRows = filteredRowsByUserQuery(rows);
  const developers = aggregateDevelopers(visibleRows);
  renderMetrics(visibleRows, developers);
  renderDevelopers(developers);
  updateHelperText();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function githubProfileUrl(login) {
  return `https://github.com/${encodeURIComponent(login)}`;
}

function githubAvatarUrl(login) {
  return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
}

function avatarMarkup(row) {
  if (isBot(row.usuario) || isGhostUser(row.usuario)) {
    return "";
  }
  const source = row.avatar_url || githubAvatarUrl(row.usuario);
  return `<img class="avatar" src="${escapeHtml(source)}" alt="" loading="lazy" onerror="this.remove()" />`;
}

function profileLinkMarkup(row) {
  const login = row.usuario;
  const label = escapeHtml(login);
  const bot = isBot(login);
  const ghostUser = isGhostUser(login);
  const badge = bot
    ? `<span class="account-badge bot-badge">BOT</span>`
    : ghostUser
      ? `<span class="account-badge ghost-badge">GHOST</span>`
      : "";
  const content = `${avatarMarkup(row)}<span>${label}</span>${badge}`;
  if (bot || ghostUser) {
    return `<span class="profile-person">${content}</span>`;
  }
  const userUrl = `/contributors/${encodeURIComponent(login)}`;
  const ghLink = `<a class="gh-icon-link" href="${githubProfileUrl(login)}" target="_blank" rel="noreferrer" aria-label="GitHub profile">` +
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>`;
  return `<a class="profile-link" href="${userUrl}">${content}</a> ${ghLink}`;
}

function bindEvents() {
  on(els.userSearch, "input", (event) => {
    state.query = event.target.value;
    state.page = 1;
    render();
  });

  on(els.orgFilter, "change", (event) => {
    state.org = event.target.value;
    state.project = "all";
    state.page = 1;
    render();
  });

  on(els.projectFilter, "change", (event) => {
    state.project = event.target.value;
    state.page = 1;
    render();
  });

  on(els.sortMode, "change", (event) => {
    state.sort = event.target.value;
    state.page = 1;
    render();
  });

  on(els.hideBots, "change", (event) => {
    state.hideBots = event.target.checked;
    saveHideBotsPreference(state.hideBots);
    state.page = 1;
    render();
  });

  on(els.hideGhost, "change", (event) => {
    state.hideGhost = event.target.checked;
    saveHideGhostPreference(state.hideGhost);
    state.page = 1;
    render();
  });

  on(els.pageSize, "change", (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    render();
  });

  on(els.prevPage, "click", () => {
    state.page -= 1;
    render();
  });

  on(els.nextPage, "click", () => {
    state.page += 1;
    render();
  });

  on(els.developerRows, "click", (event) => {
    if (event.target.closest("a")) {
      return;
    }
    const row = event.target.closest("tr[data-user]");
    if (!row) {
      return;
    }
    const params = new URLSearchParams();
    if (state.org !== "all") params.set("org", state.org);
    if (state.project !== "all") params.set("project", state.project);
    const qs = params.toString();
    window.location.href = `/contributors/${encodeURIComponent(row.dataset.user)}${qs ? "?" + qs : ""}`;
  });
}

function updateHelperText() {
  const botItem = document.getElementById("legendBot");
  const ghostItem = document.getElementById("legendGhost");
  if (!botItem || !ghostItem) return;
  const hideB = state.hideBots;
  const hideG = state.hideGhost;
  if (!hideB && !hideG) {
    botItem.innerHTML = `<span class="legend-swatch bot-swatch" aria-hidden="true"></span> Bot accounts are marked as BOT.`;
    ghostItem.innerHTML = `<span class="legend-swatch ghost-swatch" aria-hidden="true"></span> GHOST is GitHub's placeholder for deleted or unavailable users.`;
  } else if (hideB && !hideG) {
    botItem.innerHTML = `<span class="legend-swatch bot-swatch" aria-hidden="true"></span> Bot accounts are hidden.`;
    ghostItem.innerHTML = `<span class="legend-swatch ghost-swatch" aria-hidden="true"></span> GHOST is GitHub's placeholder for deleted or unavailable users.`;
  } else if (!hideB && hideG) {
    botItem.innerHTML = `<span class="legend-swatch bot-swatch" aria-hidden="true"></span> Bot accounts are marked as BOT.`;
    ghostItem.innerHTML = `<span class="legend-swatch ghost-swatch" aria-hidden="true"></span> GHOST accounts are hidden.`;
  } else {
    botItem.innerHTML = `<span class="legend-swatch bot-swatch" aria-hidden="true"></span> Bot and GHOST accounts are hidden from this view.`;
    ghostItem.innerHTML = "";
  }
}

function on(element, eventName, handler) {
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

async function init() {
  if (els.hideBots) {
    els.hideBots.checked = state.hideBots;
  }
  if (els.hideGhost) {
    els.hideGhost.checked = state.hideGhost;
  }
  bindEvents();
  if (els.dataStatus) {
    els.dataStatus.textContent = "Loading summary...";
  }

  try {
    state.rows = await loadDashboardSummary();
  } catch (summaryError) {
    if (els.dataStatus) {
      els.dataStatus.textContent = "Loading CSV fallback...";
    }
    const loaded = await Promise.allSettled(FALLBACK_SOURCES.map(loadCsv));
    const successful = loaded
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const pullSources = successful.filter((source) => source.kind === "pulls");
    const projectSource = successful.find((source) => source.kind === "project");
    const summarySource = successful.find((source) => source.kind === "summary");
    const fallbackSources = successful.filter((source) => source.kind === "legacy");
    const sourceGroups = [
      pullSources,
      projectSource ? [projectSource] : [],
      summarySource ? [summarySource] : [],
      fallbackSources,
    ];
    state.rows =
      sourceGroups
        .map((sources) => sources.flatMap(normalizeRows))
        .find((rows) => rows.length > 0) || [];
  }

  if (state.rows.length === 0) {
    if (els.dataStatus) {
      els.dataStatus.innerHTML = `<span class="error">No CSV data found. Serve the repo root and refresh.</span>`;
    }
    render();
    return;
  }

  if (els.dataStatus) {
    els.dataStatus.textContent = "";
  }
  render();
}

init().catch((error) => {
  if (els.dataStatus) {
    els.dataStatus.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  }
});
