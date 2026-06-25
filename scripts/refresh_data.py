#!/usr/bin/env python3
"""Refresh every dashboard dataset without touching the running website."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTER = ROOT / "ethereum_pr_counter.py"
NETWORKS = (
    ("ethereum", "ethereum"),
    ("bitcoin", "bitcoin"),
    ("aave", "aave"),
    ("uniswap", "uniswap"),
    ("ripple", "ripple"),
    ("bnb", "bnb"),
    ("dogecoin", "doge"),
    ("hyperliquid-dex", "hype"),
    ("tronprotocol", "tron"),
    ("cardano-foundation", "cardano"),
    ("stellar", "stellar"),
    ("smartcontractkit", "link"),
    ("solana-labs", "solana"),
)


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
        help="Incremental lookback window. Default: 48",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.1,
        help="Pause between GitHub API requests. Default: 0.1",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for org, filename_prefix in NETWORKS:
        output = ROOT / "data" / f"{filename_prefix}_merged_prs.csv"
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
        ]
        if not args.full:
            command.extend(
                ["--incremental", "--overlap-hours", str(args.overlap_hours)]
            )

        print(f"\n=== Refreshing {filename_prefix} ({org}) ===", flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)
        if result.returncode:
            print(
                f"Refresh failed for {org} with exit code {result.returncode}.",
                file=sys.stderr,
            )
            return result.returncode

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
