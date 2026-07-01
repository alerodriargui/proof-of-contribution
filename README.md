# Proof of Contribution

> Open-source data infrastructure and dashboards for making GitHub contribution histories visible across crypto ecosystems.

## Live Deployments

- 🌐 **Landing Page**: [contributionproof.com](https://contributionproof.com/)
- 📊 **Interactive Dashboard**: [contributionproof.com/app/](https://contributionproof.com/app/)

## Architecture Overview

- **Data Scraper** (`ethereum_pr_counter.py`): A Python CLI tool that queries the GitHub API to pull public repository PRs and identify merged contributions. It supports full and incremental scans to manage API rate limits efficiently.
- **Automated Data Pipelines**: Scheduled GitHub Actions workflows ([refresh-data.yml](file:///.github/workflows/refresh-data.yml)) refresh datasets every 12 hours. All output datasets are validated automatically before being committed.
- **Frontend App** ([/app](file:///app)): A fast, lightweight static web app designed with rich visuals. It pre-loads aggregated contributor stats from [dashboard-summary.json](file:///data/dashboard-summary.json) for snappy rendering, loading raw logs dynamically as requested.
- **Hosting**: Deployed on Render. Render auto-deploys updates whenever new scans are committed to the repository.

## Contributing

We welcome contributions from the community!
- Get started by reading the [Contributing Guidelines](CONTRIBUTING.md).
- Browse our [Starter Issues](docs/starter_issues.md) for excellent entry points (e.g. adding new ecosystem configurations, improving dashboard visuals, etc.).
- Refer to our [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md) to keep collaboration healthy and safe.

---

## Local Scans

The current workflow is intentionally split into two independent scans:

```powershell
python .\ethereum_pr_counter.py --org ethereum --events-only --pr-output ethereum_merged_prs.csv
python .\ethereum_pr_counter.py --org bitcoin --events-only --pr-output bitcoin_merged_prs.csv
python .\ethereum_pr_counter.py --org aave --events-only --pr-output aave_merged_prs.csv
python .\ethereum_pr_counter.py --org uniswap --events-only --pr-output uniswap_merged_prs.csv
python .\ethereum_pr_counter.py --org ripple --events-only --pr-output ripple_merged_prs.csv
python .\ethereum_pr_counter.py --org bnb-chain --events-only --pr-output bnb_merged_prs.csv
python .\ethereum_pr_counter.py --org dogecoin --events-only --pr-output doge_merged_prs.csv
python .\ethereum_pr_counter.py --org hyperliquid-dex --events-only --pr-output hype_merged_prs.csv
python .\ethereum_pr_counter.py --org tronprotocol --events-only --pr-output tron_merged_prs.csv
python .\ethereum_pr_counter.py --org cardano-foundation --events-only --pr-output cardano_merged_prs.csv
python .\ethereum_pr_counter.py --org stellar --events-only --pr-output stellar_merged_prs.csv
python .\ethereum_pr_counter.py --org smartcontractkit --events-only --pr-output link_merged_prs.csv
python .\ethereum_pr_counter.py --org solana-labs --events-only --pr-output solana_merged_prs.csv
```

That gives you thirteen CSV files:

```text
ethereum_merged_prs.csv
bitcoin_merged_prs.csv
aave_merged_prs.csv
uniswap_merged_prs.csv
ripple_merged_prs.csv
bnb_merged_prs.csv
doge_merged_prs.csv
hype_merged_prs.csv
tron_merged_prs.csv
cardano_merged_prs.csv
stellar_merged_prs.csv
link_merged_prs.csv
solana_merged_prs.csv
```

Each row is one merged PR, including `merged_at` and `merged_date`. Those raw
CSV files remain the reproducible source of truth.

## Token

Create a local `.env` file:

```env
GITHUB_TOKEN=your_github_token_here
```

The `.env` file is ignored by git. If GitHub returns `Bad credentials`, the token
in `.env` is invalid, expired, revoked, or copied with an extra character.

## Dashboard

Serve the repository root:

```powershell
python -m http.server 8000
```

Open:

```text
http://localhost:8000/
```

The repository root serves the public landing page. The interactive dashboard is at:

```text
http://localhost:8000/app/
```

The dashboard's normal startup path reads `data/dashboard-meta.json` and the
cache-versioned `data/dashboard-summary.json`. The summary is pre-aggregated by
`org`, `project`, and `user`, so the first render does not parse the complete raw
PR history in the browser. The raw CSV files remain available and are loaded on
demand for detailed contributor history. If the summary files are missing, the
dashboard falls back to the older CSV loading path.

## Deploy on Render

This repo is a static site. The included `render.yaml` publishes the repository
root. The landing page is served from `/` and the dashboard from `/app/`.

In the Render dashboard, create a new Blueprint from this repository. If you
create a Static Site manually instead, use:

```text
Build Command: echo "No build step required"
Publish Directory: .
```

Do not set the publish directory to `app`, because the dashboard loads CSV files
from `data/`.

The deployed app will be available at:

```text
https://proof-of-contribution.onrender.com/
https://proof-of-contribution.onrender.com/app/
```

Render serves the CSV files committed in `data/`. The GitHub Actions workflow
`.github/workflows/refresh-data.yml` refreshes them every 12 hours, validates
all thirteen files, and creates a commit only when every step succeeds. Render's
Auto-Deploy then publishes that commit while the previous deployment stays
online. The scheduled runs start at 00:17 and 12:17 UTC.

In GitHub, create an Actions repository secret named `DATA_GITHUB_TOKEN` with a
fine-grained token that can read public repositories. This is recommended
because the built-in Actions token has a lower API rate limit for this scan.
The workflow falls back to the built-in token when the secret is absent.

You can also run the same incremental batch locally:

```powershell
python .\scripts\refresh_data.py
python .\scripts\validate_data.py
```

To rebuild the complete history instead:

```powershell
python .\scripts\refresh_data.py --full
```

The incremental refresh overlaps the latest 48 hours, merges rows by pull
request ID, and replaces each CSV atomically. It never edits files being served
by the live Render deployment.

`scripts/refresh_data.py` also regenerates `data/dashboard-summary.json` and
`data/dashboard-meta.json` after the CSV refresh succeeds. To rebuild just the
optimized dashboard files from existing CSVs, run:

```powershell
python .\scripts\build_dashboard_summary.py
```

## Smoke Test

To verify the script without scanning every repository:

```powershell
python .\ethereum_pr_counter.py --org ethereum --max-repos 1 --events-only --pr-output smoke_prs.csv
```

## PR CSV Format

```csv
org,proyecto,usuario,pr_number,pr_title,merged_at,merged_date,url
ethereum,go-ethereum,alice,1234,Fix thing,2026-06-18T12:00:00Z,2026-06-18,https://github.com/ethereum/go-ethereum/pull/1234
```
