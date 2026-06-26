const SOURCES = [
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

const state = {
  rows: [],
  org: "all",
  project: "all",
  query: "",
  sort: "prs",
  hideBots: preferredHideBots(),
  selectedUser: null,
  selectedProject: null,
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
  const response = await fetch(source.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${source.url} returned ${response.status}`);
  }
  return {
    ...source,
    rows: parseCsv(await response.text()),
  };
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

function selectedUserMatches(row) {
  return state.selectedUser && row.usuario === state.selectedUser.usuario;
}

function selectedProjectMatches(row, project) {
  return (
    state.selectedProject &&
    row.usuario === state.selectedProject.usuario &&
    project === state.selectedProject.proyecto
  );
}

function projectBreakdownRows(rows, user) {
  const projectCounts = new Map();
  rows
    .filter((row) => row.usuario === user.usuario)
    .forEach((row) => {
      const project = row.proyecto || "All projects";
      if (!projectCounts.has(project)) {
        projectCounts.set(project, { nPrs: 0, orgs: new Set() });
      }
      const item = projectCounts.get(project);
      item.nPrs += row.n_prs;
      if (row.org) {
        item.orgs.add(row.org);
      }
    });

  return [...projectCounts.entries()]
    .map(([project, item]) => ({
      project,
      nPrs: item.nPrs,
      orgs: [...item.orgs].sort(),
    }))
    .sort((a, b) => b.nPrs - a.nPrs || a.project.localeCompare(b.project));
}

function projectPullRows(rows, user, project) {
  return rows
    .filter(
      (row) =>
        row.usuario === user.usuario && row.proyecto === project,
    )
    .sort((a, b) => {
      const aTime = Date.parse(a.merged_at || a.merged_date || "0") || 0;
      const bTime = Date.parse(b.merged_at || b.merged_date || "0") || 0;
      return bTime - aTime || Number(b.pr_number) - Number(a.pr_number);
    });
}

function userPullRows(rows, user) {
  return rows
    .filter((row) => row.usuario === user.usuario)
    .sort((a, b) => {
      const aTime = Date.parse(a.merged_at || a.merged_date || "0") || 0;
      const bTime = Date.parse(b.merged_at || b.merged_date || "0") || 0;
      return bTime - aTime || Number(b.pr_number) - Number(a.pr_number);
    });
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

function monthKey(rawDate) {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) {
    return key;
  }
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function buildContributorProfile(rows, user) {
  const pullRows = userPullRows(rows, user);
  const datedRows = pullRows.filter((pull) => pull.merged_at || pull.merged_date);
  const firstPull = datedRows.at(-1);
  const lastPull = datedRows[0];
  const timelineCounts = new Map();

  datedRows.forEach((pull) => {
    const key = monthKey(pull.merged_at || pull.merged_date);
    if (key) {
      timelineCounts.set(key, (timelineCounts.get(key) || 0) + pull.n_prs);
    }
  });

  const allTimeline = [...timelineCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, count }));
  const timeline = allTimeline.slice(-12);
  const maxTimelineCount = Math.max(...timeline.map((item) => item.count), 1);

  return {
    pullRows,
    firstDate: firstPull ? formatDateLabel(firstPull.merged_at || firstPull.merged_date) : "Unknown",
    lastDate: lastPull ? formatDateLabel(lastPull.merged_at || lastPull.merged_date) : "Unknown",
    timeline,
    maxTimelineCount,
    recentPulls: pullRows.slice(0, 6),
  };
}

function pluralizePr(count) {
  return count === 1 ? "PR" : "PRs";
}

function renderProjectPullList(rows, user, project) {
  const pullRows = projectPullRows(rows, user, project);

  if (pullRows.length === 0) {
    return `<div class="project-empty">No PRs found for this project in the current data.</div>`;
  }

  return `
    <div class="project-pr-list">
      ${pullRows
        .map(
          (pr) => `
            <a class="project-pr-link" href="${escapeHtml(pr.url)}" target="_blank" rel="noreferrer">
              <span class="project-pr-title">#${escapeHtml(pr.pr_number)} ${escapeHtml(pr.pr_title || "Untitled PR")}</span>
              <span class="project-pr-meta">${escapeHtml(pr.merged_date || pr.merged_at || "")}</span>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderInlineDetail(row, rows) {
  const projectRows = projectBreakdownRows(rows, row);
  const profile = buildContributorProfile(rows, row);
  const profileAction = isBot(row.usuario) || isGhostUser(row.usuario)
    ? ""
    : `<a href="${githubProfileUrl(row.usuario)}" target="_blank" rel="noreferrer">GitHub</a>`;
  const orgLabels = row.orgs.map(orgLabel);
  const ecosystemText =
    row.orgs.length > 1
      ? `Multi-ecosystem contributor across ${orgLabels.join(", ")}`
      : `Active in ${orgLabels[0] || "this ecosystem"}`;
  const timelineContent =
    profile.timeline.length > 0
      ? `
        <div class="timeline-y-axis" aria-hidden="true">
          <span>${formatNumber(profile.maxTimelineCount)}</span>
          <span>${formatNumber(Math.ceil(profile.maxTimelineCount / 2))}</span>
          <span>0</span>
        </div>
        <div class="timeline-bars" style="grid-template-columns: repeat(${profile.timeline.length}, minmax(0, 1fr));">
          ${profile.timeline
            .map((item, index) => {
                const label = monthLabel(item.key);
                const valueLabel = `${formatNumber(item.count)} ${pluralizePr(item.count)}`;
                return `
                  <button
                    type="button"
                    class="timeline-bar"
                    aria-label="${escapeHtml(`${label}: ${valueLabel}`)}"
                    data-tooltip="${escapeHtml(`${label}: ${valueLabel}`)}"
                  >
                    <span class="timeline-track">
                      <span class="timeline-fill" style="height: ${Math.max((item.count / profile.maxTimelineCount) * 100, 8)}%"></span>
                    </span>
                    <span class="timeline-label">${escapeHtml(label)}</span>
                  </button>
                `;
              })
            .join("")}
        </div>
      `
      : `<div class="project-empty">No dated PRs found for this contributor.</div>`;
  const recentPulls =
    profile.recentPulls.length > 0
      ? profile.recentPulls
          .map(
            (pr) => `
              <a class="recent-pr-link" href="${escapeHtml(pr.url)}" target="_blank" rel="noreferrer">
                <span class="recent-pr-title">#${escapeHtml(pr.pr_number)} ${escapeHtml(pr.pr_title || "Untitled PR")}</span>
                <span class="recent-pr-meta">${escapeHtml(orgLabel(pr.org))} / ${escapeHtml(pr.proyecto || "unknown")} - ${escapeHtml(pr.merged_date || pr.merged_at || "")}</span>
              </a>
            `,
          )
          .join("")
      : `<div class="project-empty">No recent PRs found for this contributor.</div>`;
  const detailContent =
    projectRows.length > 0
      ? projectRows
          .map(
            ({ project, nPrs, orgs }) => {
              const expanded = selectedProjectMatches(row, project);
              return `
              <div class="project-item ${expanded ? "expanded" : ""}">
                <button
                  type="button"
                  class="project-toggle"
                  data-project-action="toggle"
                  data-project="${escapeHtml(project)}"
                  aria-expanded="${expanded ? "true" : "false"}"
                >
                  <span>
                    <span class="detail-name">${escapeHtml(project)}</span>
                    <span class="detail-meta">${escapeHtml(orgs.map(orgLabel).join(", "))}</span>
                  </span>
                  <span class="project-summary">
                    <span class="detail-prs">${formatNumber(nPrs)} ${pluralizePr(nPrs)}</span>
                    <span class="project-chevron">${expanded ? "Hide" : "View"}</span>
                  </span>
                </button>
                ${
                  expanded
                    ? renderProjectPullList(rows, row, project)
                    : ""
                }
              </div>
            `;
            },
          )
          .join("")
      : `<div class="empty">Run the project-level CSV to see this breakdown</div>`;

  return `
    <tr class="inline-detail-row" data-detail-for="${escapeHtml(row.usuario)}">
      <td colspan="5" class="inline-detail-cell">
        <div class="inline-detail">
          <div class="inline-detail-head">
            <div>
              <strong>${escapeHtml(row.usuario)}</strong>
              <span>${escapeHtml(ecosystemText)}</span>
            </div>
            <div class="detail-actions">
              ${profileAction}
              <button type="button" data-detail-action="close">Clear</button>
            </div>
          </div>
          <div class="contributor-profile">
            <div class="profile-stats" aria-label="Contributor summary">
              <div class="profile-stat">
                <span>First contribution</span>
                <strong>${escapeHtml(profile.firstDate)}</strong>
              </div>
              <div class="profile-stat">
                <span>Latest contribution</span>
                <strong>${escapeHtml(profile.lastDate)}</strong>
              </div>
              <div class="profile-stat">
                <span>Projects</span>
                <strong>${formatNumber(row.n_projects)}</strong>
              </div>
              <div class="profile-stat">
                <span>Ecosystems</span>
                <strong>${formatNumber(row.orgs.length)}</strong>
              </div>
            </div>
            <div class="profile-grid">
              <section class="profile-section profile-section-wide" aria-label="Activity timeline">
                <div class="profile-section-head">
                  <h3>Timeline</h3>
                  <span>Last 12 active months</span>
                </div>
                <div class="timeline-chart">${timelineContent}</div>
              </section>
              <section class="profile-section" aria-label="Recent pull requests">
                <div class="profile-section-head">
                  <h3>Recent PRs</h3>
                  <span>${formatNumber(profile.pullRows.length)} total</span>
                </div>
                <div class="recent-pr-list">${recentPulls}</div>
              </section>
              <section class="profile-section" aria-label="Repositories">
                <div class="profile-section-head">
                  <h3>Repositories</h3>
                  <span>${formatNumber(projectRows.length)} repos</span>
                </div>
                <div class="detail-list">${detailContent}</div>
              </section>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderDevelopers(developers, sourceRows) {
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
    els.developerRows.innerHTML = `<tr><td colspan="5" class="empty">No rows</td></tr>`;
    return;
  }

  els.developerRows.innerHTML = visibleRows
    .map((row) => {
      const selected = selectedUserMatches(row);
      const bot = isBot(row.usuario);
      const ghostUser = isGhostUser(row.usuario);
      let orgTags = "";
      if (row.orgs.length > 1) {
        const primaryOrg = row.orgs[0];
        const otherOrgs = row.orgs.slice(1).map(orgLabel).join(", ");
        orgTags = `<span class="tag ${escapeHtml(primaryOrg.toLowerCase())}">${escapeHtml(orgLabel(primaryOrg))}</span> ` +
                 `<span class="tag plus-tag" title="Also active in: ${escapeHtml(otherOrgs)}">+${row.orgs.length - 1}</span>`;
      } else {
        orgTags = row.orgs
          .map((org) => `<span class="tag ${escapeHtml(org.toLowerCase())}">${escapeHtml(orgLabel(org))}</span>`)
          .join(" ");
      }
      return `
        <tr
          class="${[
            selected ? "selected-row" : "",
            bot ? "bot-row" : "",
            ghostUser ? "ghost-user-row" : "",
          ].filter(Boolean).join(" ")}"
          data-user="${escapeHtml(row.usuario)}"
        >
          <td class="login">
            ${profileLinkMarkup(row)}
          </td>
          <td class="org-tags-cell"><div class="org-tags">${orgTags}</div></td>
          <td class="number">${formatNumber(row.n_prs)}</td>
          <td class="number">${formatNumber(row.n_projects)}</td>
          <td>${escapeHtml(row.top_project)}</td>
        </tr>
        ${selected ? renderInlineDetail(row, sourceRows) : ""}
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
  renderDevelopers(developers, visibleRows);
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
  return `<a class="profile-link" href="${githubProfileUrl(login)}" target="_blank" rel="noreferrer">${content}</a>`;
}

function bindEvents() {
  on(els.userSearch, "input", (event) => {
    state.query = event.target.value;
    state.selectedUser = null;
    state.selectedProject = null;
    state.orgMenuOpen = false;
    state.projectMenuOpen = false;
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
    state.selectedUser = null;
    state.selectedProject = null;
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
    const projectToggle = event.target.closest('[data-project-action="toggle"]');
    if (projectToggle) {
      const detailRow = projectToggle.closest("tr.inline-detail-row");
      if (!detailRow || !state.selectedUser) {
        return;
      }

      const nextProject = projectToggle.dataset.project;
      const sameProject =
        state.selectedProject &&
        state.selectedProject.usuario === state.selectedUser.usuario &&
        state.selectedProject.proyecto === nextProject;

      state.selectedProject = sameProject
        ? null
        : {
            usuario: state.selectedUser.usuario,
            proyecto: nextProject,
          };
      render();
      return;
    }

    if (event.target.closest('[data-detail-action="close"]')) {
      state.selectedUser = null;
      state.selectedProject = null;
      render();
      return;
    }

    if (event.target.closest("a")) {
      return;
    }

    if (event.target.closest(".inline-detail-row")) {
      return;
    }

    const row = event.target.closest("tr[data-user]");
    if (!row) {
      return;
    }

    const selected =
      state.selectedUser &&
      state.selectedUser.usuario === row.dataset.user;
    state.selectedUser = selected
      ? null
      : {
          usuario: row.dataset.user,
        };
    state.selectedProject = null;
    render();
  });
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
  bindEvents();
  if (els.dataStatus) {
    els.dataStatus.textContent = "Loading data...";
  }

  const loaded = await Promise.allSettled(SOURCES.map(loadCsv));
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
  const selectedRows =
    sourceGroups
      .map((sources) => sources.flatMap(normalizeRows))
      .find((rows) => rows.length > 0) || [];

  state.rows = selectedRows;

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
