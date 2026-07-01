# Proof of Contribution

> Open-source data infrastructure and dashboards for making GitHub contribution histories visible across crypto ecosystems.

Proof of Contribution tracks merged pull requests from public GitHub organizations, stores reproducible CSV datasets, builds pre-aggregated JSON for fast browsing, and publishes the result as a static site.

## Live Deployments

- **Landing Page**: [contributionproof.com](https://contributionproof.com/)
- **Interactive Dashboard**: [contributionproof.com/app/](https://contributionproof.com/app/)
- **Statistics**: [contributionproof.com/app/stats.html](https://contributionproof.com/app/stats.html)
- **Documentation**: [contributionproof.com/app/docs.html](https://contributionproof.com/app/docs.html)
- **Contributor Profiles**: `https://contributionproof.com/contributors/{github-login}`

## Architecture Overview

- **Data Scraper** (`ethereum_pr_counter.py`): Python CLI tool that queries the GitHub API for merged pull requests. It supports full scans, incremental scans, checkpointing, run summaries, optional line-count collection, and local `.env` token loading.
- **Automated Data Pipeline** (`.github/workflows/refresh-data.yml`): scheduled GitHub Actions workflow that refreshes datasets, validates output, rebuilds pre-aggregated JSON, and commits changed files under `data/`.
- **Dashboard Summary** (`scripts/build_dashboard_summary.py`): builds `data/dashboard-summary.json` and `data/dashboard-meta.json` so the dashboard can render without parsing every raw CSV on first load.
- **Statistics Aggregation** (`scripts/build_stats_aggregation.py`): builds `data/stats-aggregation.json` for the statistics page.
- **Line-Count Backfill** (`scripts/backfill_line_counts.py`): resumable helper for enriching existing PR rows with `additions`, `deletions`, and `changed_lines`.
- **Frontend App** (`app/`): static dashboard, statistics, docs, contributor profile UI, localization files, styles, and assets.
- **Hosting**: deployed as a static site on Render. The public domain points to the Render deployment.

## Current Data Model

The tracked ecosystems are defined in `scripts/refresh_data.py` and mirrored by the frontend.

Current ecosystem set:

```text
ethereum
bitcoin
aave
uniswap
ripple
bnb
doge
hype
tron
cardano
stellar
link
solana
avalanche
arbitrum
polygon
near
sui
```

Each ecosystem has a raw PR file under `data/`, for example:

```text
data/ethereum_merged_prs.csv
data/solana_merged_prs.csv
data/sui_merged_prs.csv
```

The current `data/dashboard-meta.json` snapshot contains 18 ecosystem files, 392,609 raw PR rows, and 33,221 dashboard summary rows. That metadata file is the quickest way to check the committed dataset version, generation time, source files, and per-ecosystem row counts.

Raw CSV columns:

```csv
org,proyecto,usuario,avatar_url,pr_number,pr_title,merged_at,merged_date,url
```

Newer scans can also include:

```csv
additions,deletions,changed_lines
```

Empty line-count values mean unknown, not zero. Existing historical rows can be enriched with `scripts/backfill_line_counts.py`.

## Local Development

Create a local `.env` file if you want authenticated GitHub API access:

```env
GITHUB_TOKEN=your_github_token_here
```

The `.env` file is ignored by git. If GitHub returns `Bad credentials`, regenerate the token and make sure it was copied without extra characters.

Serve the repository root:

```powershell
python -m http.server 8000
```

Open:

```text
http://localhost:8000/
http://localhost:8000/app/
http://localhost:8000/app/stats.html
```

## Frontend Routes

- `/` serves the public landing page.
- `/app/` serves the searchable contribution dashboard.
- `/app/stats.html` serves charts and KPIs from `data/stats-aggregation.json`.
- `/app/docs.html` serves the methodology and usage docs.
- `/app/user.html` supports legacy profile URLs.
- `/contributors/{github-login}` is the canonical contributor profile route, rewritten to `contributors/index.html`.

The dashboard first reads:

```text
data/dashboard-meta.json
data/dashboard-summary.json
```

Raw CSV files remain available and are loaded when detailed contributor history is needed. If the summary files are missing, the dashboard falls back to the older CSV-loading path.

## Refresh Data

Run the normal incremental refresh:

```powershell
python .\scripts\refresh_data.py
python .\scripts\validate_data.py
python .\scripts\build_stats_aggregation.py
```

Run a full historical refresh:

```powershell
python .\scripts\refresh_data.py --full
python .\scripts\validate_data.py
python .\scripts\build_stats_aggregation.py
```

The incremental refresh overlaps the latest 48 hours by default, merges rows by pull-request key, writes CSVs atomically, updates checkpoints, regenerates dashboard summary files, and writes `data/run-summary.json`.

Useful options:

```powershell
python .\scripts\refresh_data.py --sleep 0.2 --rate-limit-threshold 250
python .\scripts\refresh_data.py --full --sleep 0.1
```

## Backfill Line Counts

Newly discovered PRs can collect additions/deletions during refreshes. Existing CSV rows can be enriched separately with a resumable, rate-limit-aware backfill:

```powershell
python .\scripts\backfill_line_counts.py --ecosystem ethereum --limit 1000
```

Backfill multiple ecosystems:

```powershell
python .\scripts\backfill_line_counts.py --ecosystem ethereum,solana --limit 2000 --rate-limit-threshold 250
```

The backfill stores checkpoints in:

```text
data/line-count-checkpoints/
```

After a backfill chunk, rebuild and validate the generated JSON files:

```powershell
python .\scripts\build_dashboard_summary.py
python .\scripts\build_stats_aggregation.py
python .\scripts\validate_data.py
```

## Smoke Test

To verify the scraper without scanning every repository:

```powershell
python .\ethereum_pr_counter.py --org ethereum --max-repos 1 --events-only --pr-output smoke_prs.csv
```

Use `--skip-line-counts` if you want to avoid PR-detail calls during a smoke test:

```powershell
python .\ethereum_pr_counter.py --org ethereum --max-repos 1 --events-only --skip-line-counts --pr-output smoke_prs.csv
```

## Automation

GitHub Actions workflow:

```text
.github/workflows/refresh-data.yml
```

It can be started manually with `workflow_dispatch` and is scheduled with:

```text
17 */2 * * *
```

That means GitHub tries to refresh the data every two hours at minute 17 UTC. The job:

1. Checks out the repository.
2. Sets up Python 3.12.
3. Runs `scripts/refresh_data.py`.
4. Runs `scripts/validate_data.py`.
5. Runs `scripts/build_stats_aggregation.py`.
6. Commits and pushes changed files under `data/`.

Add a repository secret named `DATA_GITHUB_TOKEN` for higher GitHub API rate limits. The workflow falls back to the built-in `github.token` when the secret is absent.

## Deploy on Render

This repo is a static site. The included `render.yaml` publishes the repository root:

```yaml
runtime: static
buildCommand: echo "No build step required"
staticPublishPath: .
```

If you create a Static Site manually, use:

```text
Build Command: echo "No build step required"
Publish Directory: .
```

Do not set the publish directory to `app`, because the dashboard reads datasets from `data/` and the landing page is served from `/`.

Render serves the committed files. When GitHub Actions commits refreshed data, Render auto-deploys the new static snapshot while the previous deployment remains online.

## Contributing

- Read [CONTRIBUTING.md](CONTRIBUTING.md).
- Browse [docs/starter_issues.md](docs/starter_issues.md).
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Report security concerns through [SECURITY.md](SECURITY.md).
