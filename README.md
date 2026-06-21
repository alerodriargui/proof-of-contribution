# Proof of Contribution

Local dashboard for exploring merged pull request authors in crypto GitHub orgs.

The current workflow is intentionally split into two independent scans:

```powershell
python .\ethereum_pr_counter.py --org ethereum --events-only --pr-output ethereum_merged_prs.csv
python .\ethereum_pr_counter.py --org bitcoin --events-only --pr-output bitcoin_merged_prs.csv
python .\ethereum_pr_counter.py --org aave --events-only --pr-output aave_merged_prs.csv
python .\ethereum_pr_counter.py --org uniswap --events-only --pr-output uniswap_merged_prs.csv
python .\ethereum_pr_counter.py --org ripple --events-only --pr-output ripple_merged_prs.csv
python .\ethereum_pr_counter.py --org bnb --events-only --pr-output bnb_merged_prs.csv
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

Each row is one merged PR, including `merged_at` and `merged_date`, so the app
can build user totals, project breakdowns, and time charts from the same source.

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
http://localhost:8000/app/
```

The app reads all thirteen CSV files when they exist and combines them in the UI:
`ethereum_merged_prs.csv`, `bitcoin_merged_prs.csv`, `aave_merged_prs.csv`,
`uniswap_merged_prs.csv`, `ripple_merged_prs.csv`, `bnb_merged_prs.csv`,
`doge_merged_prs.csv`, `hype_merged_prs.csv`, `tron_merged_prs.csv`,
`cardano_merged_prs.csv`, `stellar_merged_prs.csv`, `link_merged_prs.csv`, and
`solana_merged_prs.csv`.

## Deploy on Render

This repo is a static site. The included `render.yaml` publishes the repository
root and redirects `/` to `/app/`.

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
https://proof-of-contribution.onrender.com/app/
```

Render will serve the CSV files already committed in `data/`. To refresh the
data, regenerate the CSVs locally with `ethereum_pr_counter.py`, commit the new
files, and push. Render will redeploy from the new commit.

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
