#!/usr/bin/env python3
"""Validate generated CSV files before publishing them."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from refresh_data import NETWORKS, ROOT


REQUIRED_COLUMNS = {
    "org",
    "proyecto",
    "usuario",
    "pr_number",
    "pr_title",
    "merged_at",
    "merged_date",
    "url",
}


def validate(path: Path) -> tuple[int, list[str]]:
    errors: list[str] = []
    seen: set[tuple[str, str, str]] = set()
    row_count = 0

    if not path.exists():
        return 0, ["file does not exist"]

    with path.open(newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file)
        if not reader.fieldnames or not REQUIRED_COLUMNS.issubset(reader.fieldnames):
            return 0, [f"invalid header: {reader.fieldnames}"]

        for line_number, row in enumerate(reader, start=2):
            row_count += 1
            key = (row["org"], row["proyecto"], row["pr_number"])
            if not all(key):
                errors.append(f"line {line_number}: incomplete PR key")
            elif key in seen:
                errors.append(f"line {line_number}: duplicate PR {key}")
            seen.add(key)

            if not row["usuario"] or not row["merged_at"] or not row["url"]:
                errors.append(f"line {line_number}: missing required data")

            if len(errors) >= 20:
                errors.append("stopped after 20 errors")
                break

    if row_count == 0:
        errors.append("file contains no pull requests")
    return row_count, errors


def main() -> int:
    failed = False
    for _, filename_prefix in NETWORKS:
        path = ROOT / "data" / f"{filename_prefix}_merged_prs.csv"
        row_count, errors = validate(path)
        if errors:
            failed = True
            print(f"{path.name}: INVALID ({'; '.join(errors)})", file=sys.stderr)
        else:
            print(f"{path.name}: OK ({row_count:,} rows)")
    summary_path = ROOT / "data" / "dashboard-summary.json"
    meta_path = ROOT / "data" / "dashboard-meta.json"
    for path in (summary_path, meta_path):
        if not path.exists():
            failed = True
            print(f"{path.name}: INVALID (file does not exist)", file=sys.stderr)
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            failed = True
            print(f"{path.name}: INVALID ({error})", file=sys.stderr)
            continue
        if not payload.get("version"):
            failed = True
            print(f"{path.name}: INVALID (missing version)", file=sys.stderr)
        elif path.name == "dashboard-summary.json" and not isinstance(payload.get("rows"), list):
            failed = True
            print(f"{path.name}: INVALID (missing rows array)", file=sys.stderr)
        else:
            print(f"{path.name}: OK")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
