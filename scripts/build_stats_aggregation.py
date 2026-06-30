#!/usr/bin/env python3
"""Pre-aggregate CSV data into a single JSON for the Statistics page.

The Statistics page in the browser was loading and parsing all 13 CSV files
(270k+ rows) on every visit. This script precomputes the aggregated data
(PRs per day per org, user metadata) so the browser only fetches one JSON file.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from refresh_data import NETWORKS, ROOT


DATA_DIR = ROOT / "data"
OUTPUT_PATH = DATA_DIR / "stats-aggregation.json"

BOT_RE = re.compile(r"\[bot\]$|bot$", re.IGNORECASE)


def is_bot(login: str) -> bool:
    return bool(BOT_RE.search(login))


def is_ghost(login: str) -> bool:
    return login.strip().lower() == "ghost"


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main() -> int:
    aggregated_prs: dict[str, dict[str, int]] = {}
    aggregated_prs_ex_bots: dict[str, dict[str, int]] = {}
    users: dict[str, dict] = {}
    total_rows = 0

    for org, filename_prefix, _ in NETWORKS:
        path = DATA_DIR / f"{filename_prefix}_merged_prs.csv"
        if not path.exists():
            print(f"Skipping {path.name}: not found", file=sys.stderr)
            continue

        org_days: dict[str, int] = {}
        org_days_ex_bots: dict[str, int] = {}

        with path.open(newline="", encoding="utf-8-sig") as csv_file:
            reader = csv.DictReader(csv_file)
            for row in reader:
                usuario = (row.get("usuario") or row.get("user") or "").strip()
                if not usuario:
                    continue

                raw_date = row.get("merged_at") or row.get("merged_date") or ""
                try:
                    d = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                    day_key = d.strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    continue

                total_rows += 1
                bot = is_bot(usuario)
                ghost = is_ghost(usuario)

                # Per-org daily PR counts
                org_days[day_key] = org_days.get(day_key, 0) + 1
                if not bot:
                    org_days_ex_bots[day_key] = org_days_ex_bots.get(day_key, 0) + 1

                # User metadata
                user = users.get(usuario)
                if user is None:
                    users[usuario] = {
                        "login": usuario,
                        "first_seen": day_key,
                        "orgs": [filename_prefix],
                        "pr_count": 1,
                        "active_days": {filename_prefix: {day_key: 1}},
                        "is_bot": bot,
                        "is_ghost": ghost,
                    }
                else:
                    if day_key < user["first_seen"]:
                        user["first_seen"] = day_key
                    if filename_prefix not in user["orgs"]:
                        user["orgs"].append(filename_prefix)
                    user["pr_count"] += 1
                    org_activity = user.setdefault("active_days", {}).setdefault(filename_prefix, {})
                    org_activity[day_key] = org_activity.get(day_key, 0) + 1

        aggregated_prs[filename_prefix] = org_days
        aggregated_prs_ex_bots[filename_prefix] = org_days_ex_bots

    payload = {
        "schema": "stats-aggregation.v1",
        "generated_at": iso_now(),
        "total_rows": total_rows,
        "user_count": len(users),
        "aggregated_prs": aggregated_prs,
        "aggregated_prs_ex_bots": aggregated_prs_ex_bots,
        "users": list(users.values()),
    }

    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {OUTPUT_PATH.relative_to(ROOT)} "
        f"({total_rows:,} rows, {len(users):,} users)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
