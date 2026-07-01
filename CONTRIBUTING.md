# Contributing to Proof of Contribution

Thank you for your interest in contributing to Proof of Contribution! This project aims to make GitHub contribution histories visible across decentralized ecosystems.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Getting Started

### Prerequisites

- **Python 3.12+**
- A modern web browser.
- The scraper and scripts only use the Python standard library. No external `pip` packages are required!

### Local Development Setup

1. **Fork and Clone the Repository**
   Fork the repository on GitHub and clone it locally:
   ```powershell
   git clone https://github.com/your-username/proof-of-contribution.git
   cd proof-of-contribution
   ```

2. **Configure Your GitHub Token**
   To avoid GitHub API rate limits, you will need a GitHub Personal Access Token (classic or fine-grained) with public repository read access.
   Create a `.env` file in the root of the project:
   ```env
   GITHUB_TOKEN=your_personal_access_token_here
   ```
   *Note: `.env` is ignored by Git to keep your credentials secure.*

---

## Working with Scrapers and Data

### Running a Scraper for a Single Org
You can scan a specific organization and output a Contribution CSV file by running the core script directly:
```powershell
python .\ethereum_pr_counter.py --org ethereum --events-only --pr-output data/ethereum_merged_prs.csv
```

### Refreshing All Datasets
To incrementally fetch new Contributions for all configured ecosystems (the last 48 hours is scanned by default, merging rows and replacing files atomically):
```powershell
python .\scripts\refresh_data.py
```

To run a full historical rebuild instead:
```powershell
python .\scripts\refresh_data.py --full
```

### Rebuilding the Dashboard Optimization Files
To rebuild `data/dashboard-summary.json` and `data/dashboard-meta.json` from the existing CSVs without re-scraping:
```powershell
python .\scripts\build_dashboard_summary.py
```

### Validating the Datasets
Before submitting any changes to data or scraper code, run the validator to ensure all CSV and JSON schema and constraints are satisfied:
```powershell
python .\scripts\validate_data.py
```

---

## Translation Workflow

Proof of Contribution uses a lightweight i18n layer with one JSON file per supported locale in `app/locales/`.

- `app/locales/en.json` is the canonical source locale.
- Supported locale files are `en.json`, `es.json`, `pt.json`, `ru.json`, `zh-Hans.json`, and `hi.json`.
- Use stable translation keys in HTML and JavaScript through `data-i18n`, `data-i18n-attr`, or `window.pocI18n.t(key, params)`.
- Keep dynamic values as interpolation parameters, for example `{count}`, so translators can move values to the right place for each language.
- When adding or renaming a key in `en.json`, keep the same key structure in every locale file.

Validate locale parity before opening a Contribution:
```powershell
python .\scripts\validate_i18n.py
```

The CI workflow runs the same validation so missing or extra locale keys are caught automatically.

---

## Running the Dashboard Locally

You can serve the landing page and dashboard using Python's built-in HTTP server:
```powershell
python -m http.server 8000
```
Then open your browser to:
- **Landing Page**: [http://localhost:8000/](http://localhost:8000/)
- **Dashboard**: [http://localhost:8000/app/](http://localhost:8000/app/)

---

## Contribution Workflow

1. **Search/Create an Issue**: Check if there's an existing issue for your work. If not, open a bug report or feature request issue.
2. **Create a Branch**: Create a feature or bugfix branch:
   ```powershell
   git checkout -b feature/my-new-feature
   ```
3. **Write Code**: Ensure your code fits the style and guidelines. Keep Python scripts simple and avoid adding external dependencies.
4. **Test & Validate**: Make sure the scripts run cleanly and `python scripts/validate_data.py` passes successfully.
5. **Commit**: Use clear and descriptive commit messages (e.g., `feat: add search filter`, `fix: handle empty state`).
6. **Submit a Contribution**: Push your branch to GitHub and open a Contribution using the Contribution template.

## Coding Expectations

- **Python**: Use Python 3.12 features and syntax. Keep imports to standard library unless there is a strong reason to add a dependency.
- **Frontend**: Keep the HTML, CSS, and JS clean and responsive. Avoid frameworks for the static dashboard unless requested.
- **Comments & Docstrings**: Document functions and clarify complex logic. Keep existing docstrings intact.
