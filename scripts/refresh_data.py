#!/usr/bin/env python3
"""Refresh every dashboard dataset without touching the running website.

Supports per-ecosystem configuration, rate-limit monitoring with checkpoint
persistence, and structured run-summary output for safe incremental cadences.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COUNTER = ROOT / "ethereum_pr_counter.py"
CHECKPOINT_DIR = ROOT / "data" / "checkpoints"
SUMMARY_OUTPUT = ROOT / "data" / "run-summary.json"

# (github_org, filename_prefix, config_override)
# config keys: overlap_hours (optional), rate_limit_threshold (optional)
NETWORKS: list[tuple[str, str, dict[str, Any]]] = [
    ("ethereum", "ethereum", {}),
    ("bitcoin", "bitcoin", {}),
    ("aave", "aave", {}),
    ("uniswap", "uniswap", {}),
    ("ripple", "ripple", {}),
    ("bnb-chain", "bnb", {}),
    ("dogecoin", "doge", {}),
    ("hyperliquid-dex", "hype", {}),
    ("tronprotocol", "tron", {}),
    ("cardano-foundation", "cardano", {}),
    ("stellar", "stellar", {}),
    ("smartcontractkit", "link", {}),
    ("solana-labs", "solana", {}),
    ("ava-labs", "avalanche", {}),
    ("OffchainLabs", "arbitrum", {}),
    ("0xPolygon", "polygon", {}),
    ("near", "near", {}),
    ("MystenLabs", "sui", {}),
]


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--full",
        action="store_true",
        help="Ignore existing CSV files and perform a full historical scan.",
    )
    parser.add_argument(
        "--overlap-hours",
        type=float,
        default=48,
        help="Default incremental lookback window. Default: 48",
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
        help="Minimum remaining API requests before pausing. Default: 100",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ecosystem_summaries: list[dict[str, Any]] = []

    for org, filename_prefix, config in NETWORKS:
        output = ROOT / "data" / f"{filename_prefix}_merged_prs.csv"
        ecosystem_summary = ROOT / "data" / f"run-summary-{filename_prefix}.json"

        command = [
            sys.executable,
            str(COUNTER),
            "--org",
            org,
            "--events-only",
            "--pr-output",
            str(output),
            "--sleep",
            str(args.sleep),
            "--checkpoint-dir",
            str(CHECKPOINT_DIR),
            "--run-summary-output",
            str(ecosystem_summary),
            "--rate-limit-threshold",
            str(config.get("rate_limit_threshold", args.rate_limit_threshold)),
        ]

        if not args.full:
            overlap = config.get("overlap_hours", args.overlap_hours)
            command.extend(["--incremental", "--overlap-hours", str(overlap)])

        print(f"\n=== Refreshing {filename_prefix} ({org}) ===", flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)

        # Collect the per-ecosystem run summary
        if ecosystem_summary.exists():
            try:
                summary = json.loads(ecosystem_summary.read_text(encoding="utf-8"))
                ecosystem_summaries.append(summary)
            except (json.JSONDecodeError, OSError) as exc:
                print(f"Warning: could not read {ecosystem_summary}: {exc}", file=sys.stderr)

        if result.returncode:
            print(
                f"Refresh failed for {org} with exit code {result.returncode}.",
                file=sys.stderr,
            )
            return result.returncode

    summary_command = [sys.executable, str(ROOT / "scripts" / "build_dashboard_summary.py")]
    print("\n=== Building dashboard summary ===", flush=True)
    result = subprocess.run(summary_command, cwd=ROOT, check=False)
    if result.returncode:
        print(
            f"Dashboard summary build failed with exit code {result.returncode}.",
            file=sys.stderr,
        )
        return result.returncode

    # Write aggregated run summary
    report = {
        "schema": "refresh-run-summary.v1",
        "generated_at": iso_now(),
        "full_refresh": args.full,
        "default_overlap_hours": args.overlap_hours,
        "rate_limit_threshold": args.rate_limit_threshold,
        "ecosystems": ecosystem_summaries,
    }
    SUMMARY_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_OUTPUT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {SUMMARY_OUTPUT.relative_to(ROOT)}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
