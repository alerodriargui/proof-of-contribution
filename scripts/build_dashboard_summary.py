#!/usr/bin/env python3
"""Build cacheable dashboard summary files from the raw PR CSV files."""

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


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_source(path: Path, fallback_org: str) -> tuple[list[dict[str, object]], int]:
    aggregates: dict[tuple[str, str, str], dict[str, object]] = {}
    source_count = 0

    if not path.exists():
        return [], source_count

    with path.open(newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            org = (row.get("org") or fallback_org).strip().lower()
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
                    "first_merged_at": "",
                    "latest_merged_at": "",
                },
            )

            item["merged_pr_count"] = int(item["merged_pr_count"]) + 1
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


def main() -> int:
    generated_at = iso_now()
    rows: list[dict[str, object]] = []
    source_files: list[dict[str, object]] = []
    source_pr_count = 0

    for org, filename_prefix in NETWORKS:
        path = DATA_DIR / f"{filename_prefix}_merged_prs.csv"
        file_rows, file_source_count = read_source(path, filename_prefix)
        rows.extend(file_rows)
        source_pr_count += file_source_count
        source_files.append(
            {
                "path": f"data/{path.name}",
                "org": filename_prefix,
                "raw_pr_count": file_source_count,
                "summary_row_count": len(file_rows),
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
