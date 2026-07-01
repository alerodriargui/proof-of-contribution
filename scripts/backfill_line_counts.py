#!/usr/bin/env python3
"""Backfill additions/deletions for existing PR CSV files.

This is intentionally separate from the normal refresh. Historical enrichment can
need one GitHub PR-detail request per missing row, so it must be resumable and
rate-limit aware.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ethereum_pr_counter import (  # noqa: E402
    GitHubAPIError,
    build_headers,
    fetch_pull_request_detail,
    get_api_request_count,
    get_rate_limit_remaining,
    line_count_fields,
    load_dotenv,
)
from refresh_data import NETWORKS  # noqa: E402


LINE_COLUMNS = ["additions", "deletions", "changed_lines"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--ecosystem",
        action="append",
        help="Filename prefix to backfill, e.g. ethereum or solana. Repeatable.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum rows to enrich in this run. Useful for rate-limit chunks.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.1,
        help="Pause between GitHub API requests. Default: 0.1",
    )
    parser.add_argument(
        "--rate-limit-threshold",
        type=int,
        default=100,
        help="Stop before GitHub remaining requests drop below this value.",
    )
    parser.add_argument(
        "--checkpoint-dir",
        default=str(ROOT / "data" / "line-count-checkpoints"),
        help="Directory for resumable backfill checkpoints.",
    )
    return parser.parse_args()


def selected_networks(raw_ecosystems: list[str] | None) -> list[tuple[str, str, dict[str, Any]]]:
    if not raw_ecosystems:
        return NETWORKS
    selected = {value.strip().lower() for raw in raw_ecosystems for value in raw.split(",")}
    return [network for network in NETWORKS if network[1].lower() in selected]


def has_line_counts(row: dict[str, str]) -> bool:
    return bool(row.get("additions") and row.get("deletions"))


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_rows(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        with tmp.open("w", newline="", encoding="utf-8") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def backfill_file(
    org: str,
    prefix: str,
    headers: dict[str, str],
    args: argparse.Namespace,
    remaining_limit: int | None,
) -> int:
    path = ROOT / "data" / f"{prefix}_merged_prs.csv"
    if not path.exists():
        print(f"Skipping {prefix}: {path.name} not found", file=sys.stderr)
        return 0

    with path.open(newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file)
        if not reader.fieldnames:
            print(f"Skipping {prefix}: invalid header", file=sys.stderr)
            return 0
        fieldnames = list(reader.fieldnames)
        for column in LINE_COLUMNS:
            if column not in fieldnames:
                fieldnames.append(column)
        rows = [{key: value or "" for key, value in row.items()} for row in reader]

    cp_path = Path(args.checkpoint_dir) / f"{prefix}.json"
    checkpoint = load_checkpoint(cp_path)
    start_index = int(checkpoint.get("next_index") or 0)
    enriched = 0
    next_index = start_index

    for index in range(start_index, len(rows)):
        next_index = index + 1
        if remaining_limit is not None and enriched >= remaining_limit:
            next_index = index
            break
        remaining_requests = get_rate_limit_remaining()
        if remaining_requests is not None and remaining_requests < args.rate_limit_threshold:
            print(f"Stopping {prefix}: rate limit below threshold", flush=True)
            next_index = index
            break

        row = rows[index]
        if has_line_counts(row):
            continue

        repo = row.get("proyecto") or ""
        number = row.get("pr_number") or ""
        if not repo or not number:
            save_checkpoint(cp_path, {"next_index": index + 1, "updated": enriched})
            continue

        try:
            detail = fetch_pull_request_detail(org, repo, number, headers, args.sleep)
        except GitHubAPIError as exc:
            print(f"{prefix} {repo}#{number}: {exc}", file=sys.stderr, flush=True)
            save_checkpoint(cp_path, {"next_index": index + 1, "updated": enriched})
            continue

        row.update(line_count_fields(detail))
        enriched += 1
        if enriched % 100 == 0:
            write_rows(path, fieldnames, rows)
            save_checkpoint(cp_path, {"next_index": index + 1, "updated": enriched})
            print(f"{prefix}: enriched {enriched} rows", flush=True)

    write_rows(path, fieldnames, rows)
    save_checkpoint(
        cp_path,
        {
            "next_index": next_index,
            "row_count": len(rows),
            "updated": enriched,
            "api_request_count": get_api_request_count(),
        },
    )
    print(f"{prefix}: enriched {enriched} rows")
    return enriched


def main() -> int:
    args = parse_args()
    load_dotenv()
    headers = build_headers(os.environ.get("GITHUB_TOKEN"))

    total = 0
    for org, prefix, _ in selected_networks(args.ecosystem):
        remaining = None if args.limit is None else max(args.limit - total, 0)
        if remaining == 0:
            break
        total += backfill_file(org, prefix, headers, args, remaining)

    print(f"Updated {total} rows with line-count data")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
