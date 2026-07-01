#!/usr/bin/env python3
"""Build cacheable dashboard summary files from the raw Contribution CSV files."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from refresh_data import NETWORKS, ROOT


DATA_DIR = ROOT / "data"
SUMMARY_PATH = DATA_DIR / "dashboard-summary.json"
META_PATH = DATA_DIR / "dashboard-meta.json"

ORG_ALIASES = {
    "bnb-chain": "bnb",
    "dogecoin": "doge",
    "hyperliquid-dex": "hype",
    "tronprotocol": "tron",
    "cardano-foundation": "cardano",
    "smartcontractkit": "link",
    "solana-labs": "solana",
    "ava-labs": "avalanche",
    "offchainlabs": "arbitrum",
    "0xpolygon": "polygon",
    "mystenlabs": "sui",
}


def canonical_org(org: str) -> str:
    key = org.strip().lower()
    return ORG_ALIASES.get(key, key)


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def optional_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def read_source(path: Path, fallback_org: str) -> tuple[list[dict[str, object]], int]:
    aggregates: dict[tuple[str, str, str], dict[str, object]] = {}
    source_count = 0

    if not path.exists():
        return [], source_count

    with path.open(newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            org = canonical_org(row.get("org") or fallback_org)
            project = (row.get("proyecto") or "").strip()
            user = (row.get("usuario") or row.get("user") or "").strip()
            if not org or not project or not user:
                continue

            source_count += 1
            key = (org, project, user)
            item = aggregates.setdefault(
                key,
                {
                    "org": org,
                    "project": project,
                    "user": user,
                    "avatar_url": (row.get("avatar_url") or row.get("avatar") or "").strip(),
                    "merged_pr_count": 0,
                    "total_additions": 0,
                    "total_deletions": 0,
                    "total_changed_lines": 0,
                    "unknown_line_count": 0,
                    "first_merged_at": "",
                    "latest_merged_at": "",
                },
            )

            item["merged_pr_count"] = int(item["merged_pr_count"]) + 1
            additions = optional_int(row.get("additions"))
            deletions = optional_int(row.get("deletions"))
            changed_lines = optional_int(row.get("changed_lines"))
            if additions is None or deletions is None:
                item["unknown_line_count"] = int(item["unknown_line_count"]) + 1
            else:
                item["total_additions"] = int(item["total_additions"]) + additions
                item["total_deletions"] = int(item["total_deletions"]) + deletions
                item["total_changed_lines"] = (
                    int(item["total_changed_lines"])
                    + (changed_lines if changed_lines is not None else additions + deletions)
                )
            if not item["avatar_url"]:
                item["avatar_url"] = (row.get("avatar_url") or row.get("avatar") or "").strip()

            merged_at = (row.get("merged_at") or row.get("merged_date") or "").strip()
            if merged_at:
                first = str(item["first_merged_at"])
                latest = str(item["latest_merged_at"])
                if not first or merged_at < first:
                    item["first_merged_at"] = merged_at
                if not latest or merged_at > latest:
                    item["latest_merged_at"] = merged_at

    rows = sorted(
        aggregates.values(),
        key=lambda item: (
            str(item["org"]),
            str(item["project"]).lower(),
            str(item["user"]).lower(),
        ),
    )
    return rows, source_count


def read_checkpoint(org: str) -> str | None:
    cp_path = DATA_DIR / "checkpoints" / f"{org}.json"
    if not cp_path.exists():
        return None
    try:
        data = json.loads(cp_path.read_text(encoding="utf-8"))
        return data.get("last_run_at") or None
    except (json.JSONDecodeError, OSError):
        return None


def main() -> int:
    generated_at = iso_now()
    rows: list[dict[str, object]] = []
    source_files: list[dict[str, object]] = []
    source_pr_count = 0

    for org, filename_prefix, _ in NETWORKS:
        path = DATA_DIR / f"{filename_prefix}_merged_prs.csv"
        file_rows, file_source_count = read_source(path, filename_prefix)
        rows.extend(file_rows)
        source_pr_count += file_source_count
        last_updated = read_checkpoint(filename_prefix)
        source_files.append(
            {
                "path": f"data/{path.name}",
                "org": filename_prefix,
                "raw_pr_count": file_source_count,
                "summary_row_count": len(file_rows),
                "last_updated": last_updated,
            },
        )

    content_for_hash = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    version = hashlib.sha256(content_for_hash.encode("utf-8")).hexdigest()[:16]

    summary = {
        "schema": "dashboard-summary.v1",
        "version": version,
        "generated_at": generated_at,
        "source_pr_count": source_pr_count,
        "row_count": len(rows),
        "rows": rows,
    }
    meta = {
        "schema": "dashboard-meta.v1",
        "version": version,
        "generated_at": generated_at,
        "summary_path": "data/dashboard-summary.json",
        "source_pr_count": source_pr_count,
        "row_count": len(rows),
        "source_files": source_files,
    }

    SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {SUMMARY_PATH.relative_to(ROOT)} ({len(rows):,} rows, version {version})")
    print(f"Wrote {META_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
