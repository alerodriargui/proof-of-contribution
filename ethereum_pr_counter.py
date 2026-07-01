#!/usr/bin/env python3
"""
Count merged pull request authors across public repositories in GitHub orgs.

Includes rate-limit monitoring, checkpoint persistence, retry with jitter,
and structured run-summary output for safe incremental refresh cadences.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from http.client import IncompleteRead
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_ROOT = "https://api.github.com"
DEFAULT_ORGS = ("ethereum",)
DEFAULT_OUTPUT = "data/crypto_merged_pr_authors.csv"
DEFAULT_PROJECT_OUTPUT = "data/crypto_merged_pr_authors_by_project.csv"
DEFAULT_PR_OUTPUT = "data/{org}_merged_prs.csv"
ENV_FILE = ".env"
MAX_HTTP_ATTEMPTS = 5
RETRYABLE_HTTP_CODES = {500, 502, 503, 504}
DEFAULT_CHECKPOINT_DIR = "data/checkpoints"
DEFAULT_RATE_LIMIT_THRESHOLD = 100


class GitHubAPIError(RuntimeError):
    """Raised for GitHub API errors that should be reported cleanly."""


# Global request counter for observability
_api_request_count: int = 0


def get_api_request_count() -> int:
    global _api_request_count
    return _api_request_count


def increment_api_request_count() -> None:
    global _api_request_count
    _api_request_count += 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Count merged PR authors across public GitHub repositories."
    )
    parser.add_argument(
        "--org",
        dest="orgs",
        action="append",
        help=(
            "GitHub organization to scan. Repeat it to scan several orgs, "
            "but separate runs are recommended for large orgs. "
            f"Default: {', '.join(DEFAULT_ORGS)}"
        ),
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Summary CSV output path. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--project-output",
        default=DEFAULT_PROJECT_OUTPUT,
        help=f"Project-level CSV output path. Default: {DEFAULT_PROJECT_OUTPUT}",
    )
    parser.add_argument(
        "--pr-output",
        default=DEFAULT_PR_OUTPUT,
        help=(
            "PR-level CSV output path for charts. "
            "Use {org} to include the org name. Default: {org}_merged_prs.csv"
        ),
    )
    parser.add_argument(
        "--events-only",
        action="store_true",
        help="Only write the PR-level CSV. Useful for one CSV per org.",
    )
    parser.add_argument(
        "--max-repos",
        type=int,
        default=None,
        help="Process only the first N repositories. Useful for smoke tests.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.1,
        help="Seconds to pause between API requests. Default: 0.1",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help=(
            "Keep the existing PR CSV and fetch only recently updated pull requests. "
            "Falls back to a full scan when the output file does not exist."
        ),
    )
    parser.add_argument(
        "--overlap-hours",
        type=float,
        default=48,
        help=(
            "Hours to look back from the newest existing merged PR in incremental mode. "
            "Default: 48"
        ),
    )
    parser.add_argument(
        "--rate-limit-threshold",
        type=int,
        default=DEFAULT_RATE_LIMIT_THRESHOLD,
        help=(
            "Minimum remaining API requests before the job pauses. "
            "Default: %(default)s"
        ),
    )
    parser.add_argument(
        "--checkpoint-dir",
        default=DEFAULT_CHECKPOINT_DIR,
        help="Directory for per-org checkpoint JSON files. Default: %(default)s",
    )
    parser.add_argument(
        "--run-summary-output",
        default=None,
        help="Write a machine-readable run summary JSON to this path.",
    )
    parser.add_argument(
        "--skip-line-counts",
        action="store_true",
        help=(
            "Do not fetch PR detail payloads for additions/deletions. Existing "
            "line-count values are preserved during incremental merges."
        ),
    )
    return parser.parse_args()


def selected_orgs(raw_orgs: list[str] | None) -> list[str]:
    if not raw_orgs:
        return list(DEFAULT_ORGS)

    orgs: list[str] = []
    seen: set[str] = set()
    for raw_org in raw_orgs:
        for org in raw_org.split(","):
            normalized = org.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            orgs.append(normalized)
    return orgs


def parse_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_dotenv(path: str = ENV_FILE) -> None:
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = parse_env_value(value)


def build_headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "proof-of-contribution",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def parse_link_header(link_header: str | None) -> dict[str, str]:
    links: dict[str, str] = {}
    if not link_header:
        return links

    for part in link_header.split(","):
        section = part.strip().split(";")
        if len(section) < 2:
            continue
        url = section[0].strip()
        if not (url.startswith("<") and url.endswith(">")):
            continue
        rel = None
        for param in section[1:]:
            param = param.strip()
            if param.startswith('rel="') and param.endswith('"'):
                rel = param[5:-1]
                break
        if rel:
            links[rel] = url[1:-1]
    return links


# Latest rate-limit info captured from the most recent API response
_latest_rate_limit_remaining: str | None = None
_latest_rate_limit_reset: str | None = None


def get_rate_limit_info(headers: Any | None = None) -> tuple[str | None, str | None]:
    global _latest_rate_limit_remaining, _latest_rate_limit_reset
    if headers is not None:
        rem = headers.get("X-RateLimit-Remaining")
        rst = headers.get("X-RateLimit-Reset")
        if rem is not None:
            _latest_rate_limit_remaining = rem
        if rst is not None:
            _latest_rate_limit_reset = rst
    return _latest_rate_limit_remaining, _latest_rate_limit_reset


def get_rate_limit_remaining(headers: Any | None = None) -> int | None:
    rem, _ = get_rate_limit_info(headers)
    if rem is None:
        return None
    try:
        return int(rem)
    except (ValueError, TypeError):
        return None


def seconds_until_rate_reset(headers: Any) -> float:
    reset = headers.get("X-RateLimit-Reset")
    if reset:
        try:
            return max(int(reset) - int(time.time()), 0) + 1
        except ValueError:
            pass

    retry_after = headers.get("Retry-After")
    if retry_after:
        try:
            return max(float(retry_after), 0)
        except ValueError:
            pass

    retry_date = headers.get("Date")
    if retry_date:
        try:
            return max(parsedate_to_datetime(retry_date).timestamp() - time.time(), 0)
        except (TypeError, ValueError, OverflowError):
            pass

    return 60


def maybe_wait_for_rate_limit(headers: Any) -> None:
    remaining = headers.get("X-RateLimit-Remaining")
    if remaining != "0":
        return

    wait_seconds = seconds_until_rate_reset(headers)
    print(f"GitHub rate limit reached. Sleeping for {wait_seconds:.0f}s...", flush=True)
    time.sleep(wait_seconds)


def sleep_before_retry(
    attempt: int, sleep_seconds: float, headers: Any | None = None
) -> None:
    if headers and headers.get("Retry-After"):
        delay = seconds_until_rate_reset(headers)
    else:
        delay = min(2**attempt, 30)

    delay = max(delay, sleep_seconds)
    jitter = random.uniform(0.5, 1.5)
    delay = delay * jitter
    print(
        f"Temporary GitHub API read error. Retrying in {delay:.1f}s "
        f"(attempt {attempt + 1}/{MAX_HTTP_ATTEMPTS})...",
        file=sys.stderr,
        flush=True,
    )
    time.sleep(delay)


def github_get_json(url: str, headers: dict[str, str], sleep_seconds: float) -> Any:
    attempt = 0
    while True:
        request = Request(url, headers=headers)
        increment_api_request_count()
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read().decode("utf-8")
                response_headers = response.headers
                get_rate_limit_info(response_headers)
                maybe_wait_for_rate_limit(response_headers)
                time.sleep(sleep_seconds)
                return json.loads(payload), response_headers
        except HTTPError as exc:
            maybe_wait_for_rate_limit(exc.headers)
            if exc.code in {403, 429} and exc.headers.get("X-RateLimit-Remaining") == "0":
                continue
            if exc.code in RETRYABLE_HTTP_CODES and attempt < MAX_HTTP_ATTEMPTS - 1:
                sleep_before_retry(attempt, sleep_seconds, exc.headers)
                attempt += 1
                continue

            detail = exc.read().decode("utf-8", errors="replace")
            raise GitHubAPIError(f"HTTP {exc.code} for {url}: {detail}") from exc
        except URLError as exc:
            if attempt < MAX_HTTP_ATTEMPTS - 1:
                sleep_before_retry(attempt, sleep_seconds)
                attempt += 1
                continue
            raise GitHubAPIError(f"Network error for {url}: {exc.reason}") from exc
        except (IncompleteRead, TimeoutError, ConnectionError) as exc:
            if attempt < MAX_HTTP_ATTEMPTS - 1:
                sleep_before_retry(attempt, sleep_seconds)
                attempt += 1
                continue
            raise GitHubAPIError(f"Incomplete response for {url}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise GitHubAPIError(f"Invalid JSON from {url}: {exc}") from exc


def with_query(url: str, params: dict[str, Any]) -> str:
    return f"{url}?{urlencode(params)}"


def github_get_paginated(
    url: str,
    headers: dict[str, str],
    sleep_seconds: float,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    next_url = with_query(url, {"per_page": 100, **(params or {})})

    while next_url:
        payload, response_headers = github_get_json(next_url, headers, sleep_seconds)
        if not isinstance(payload, list):
            raise GitHubAPIError(f"Expected list response from {next_url}")

        items.extend(payload)
        next_url = parse_link_header(response_headers.get("Link")).get("next")

    return items


def parse_github_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def fetch_repositories(
    org: str, headers: dict[str, str], sleep_seconds: float
) -> list[dict[str, Any]]:
    url = f"{API_ROOT}/orgs/{org}/repos"
    return github_get_paginated(
        url,
        headers,
        sleep_seconds,
        params={"type": "public", "sort": "full_name", "direction": "asc"},
    )


def fetch_closed_pull_requests(
    org: str,
    repo: str,
    headers: dict[str, str],
    sleep_seconds: float,
    updated_since: datetime | None = None,
) -> list[dict[str, Any]]:
    url = f"{API_ROOT}/repos/{org}/{repo}/pulls"
    pulls: list[dict[str, Any]] = []
    next_url = with_query(
        url,
        {
            "per_page": 100,
            "state": "closed",
            "sort": "updated",
            "direction": "desc",
        },
    )

    while next_url:
        payload, response_headers = github_get_json(next_url, headers, sleep_seconds)
        if not isinstance(payload, list):
            raise GitHubAPIError(f"Expected list response from {next_url}")

        pulls.extend(payload)
        if updated_since and payload:
            oldest_updated_at = payload[-1].get("updated_at")
            if (
                isinstance(oldest_updated_at, str)
                and parse_github_datetime(oldest_updated_at) < updated_since
            ):
                break

        next_url = parse_link_header(response_headers.get("Link")).get("next")

    return pulls


def fetch_pull_request_detail(
    org: str,
    repo: str,
    number: str | int,
    headers: dict[str, str],
    sleep_seconds: float,
) -> dict[str, Any]:
    url = f"{API_ROOT}/repos/{org}/{repo}/pulls/{number}"
    payload, _ = github_get_json(url, headers, sleep_seconds)
    if not isinstance(payload, dict):
        raise GitHubAPIError(f"Expected pull request object from {url}")
    return payload


def csv_number(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        return str(int(value))
    except (TypeError, ValueError):
        return ""


def line_count_fields(payload: dict[str, Any]) -> dict[str, str]:
    additions = csv_number(payload.get("additions"))
    deletions = csv_number(payload.get("deletions"))
    if additions and deletions:
        changed_lines = str(int(additions) + int(deletions))
    else:
        changed_lines = ""
    return {
        "additions": additions,
        "deletions": deletions,
        "changed_lines": changed_lines,
    }


def has_line_counts(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    return bool(str(row.get("additions") or "") and str(row.get("deletions") or ""))


def pr_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(row.get("org", "")),
        str(row.get("proyecto", "")),
        str(row.get("pr_number", "")),
    )


def make_pr_row(
    org: str,
    repo_name: str,
    pull_request: dict[str, Any],
    login: str,
    avatar_url: str,
    existing_row: dict[str, int | str] | None,
    collect_line_counts: bool,
    headers: dict[str, str],
    sleep_seconds: float,
) -> dict[str, int | str]:
    merged_at = pull_request.get("merged_at") or ""
    row: dict[str, int | str] = {
        "org": org,
        "proyecto": repo_name,
        "usuario": login,
        "avatar_url": avatar_url,
        "pr_number": pull_request.get("number") or "",
        "pr_title": pull_request.get("title") or "",
        "merged_at": merged_at,
        "merged_date": str(merged_at).split("T", 1)[0],
        "url": pull_request.get("html_url") or "",
    }

    if has_line_counts(existing_row):
        row.update(line_count_fields(existing_row or {}))
    else:
        row.update(line_count_fields(pull_request))

    if collect_line_counts and not has_line_counts(row) and row["pr_number"]:
        try:
            detail = fetch_pull_request_detail(
                org, repo_name, row["pr_number"], headers, sleep_seconds
            )
            row.update(line_count_fields(detail))
        except GitHubAPIError as exc:
            print(
                f"Could not fetch line counts for {org}/{repo_name}#{row['pr_number']}: {exc}",
                file=sys.stderr,
                flush=True,
            )

    return row


def count_merged_pr_authors(
    org: str,
    repositories: list[dict[str, Any]],
    headers: dict[str, str],
    sleep_seconds: float,
    updated_since: datetime | None = None,
    existing_projects: set[str] | None = None,
    existing_rows_by_key: dict[tuple[str, str, str], dict[str, int | str]] | None = None,
    collect_line_counts: bool = True,
) -> tuple[Counter[tuple[str, str]], dict[str, str], list[dict[str, int | str]], int, int]:
    counts: Counter[tuple[str, str]] = Counter()
    avatar_urls: dict[str, str] = {}
    merged_prs: list[dict[str, int | str]] = []
    processed = 0
    total_repos = len(repositories)

    for index, repo in enumerate(repositories, start=1):
        repo_name = repo.get("name")
        if not repo_name:
            print(f"Skipping repo {index}/{total_repos}: missing name", file=sys.stderr)
            continue

        print(f"Processing repo {index}/{total_repos}: {repo_name}", flush=True)
        try:
            repo_updated_since = (
                updated_since
                if existing_projects is None or repo_name in existing_projects
                else None
            )
            pulls = fetch_closed_pull_requests(
                org,
                repo_name,
                headers,
                sleep_seconds,
                updated_since=repo_updated_since,
            )
        except GitHubAPIError as exc:
            print(f"Error processing {repo_name}: {exc}", file=sys.stderr, flush=True)
            continue

        processed += 1
        for pull_request in pulls:
            merged_at = pull_request.get("merged_at")
            if merged_at is None:
                continue
            user = pull_request.get("user") or {}
            login = user.get("login")
            if login:
                avatar_url = user.get("avatar_url") or ""
                counts[(repo_name, login)] += 1
                if avatar_url:
                    avatar_urls[login] = avatar_url
                key = (org, repo_name, str(pull_request.get("number") or ""))
                merged_prs.append(
                    make_pr_row(
                        org,
                        repo_name,
                        pull_request,
                        login,
                        avatar_url,
                        existing_rows_by_key.get(key) if existing_rows_by_key else None,
                        collect_line_counts,
                        headers,
                        sleep_seconds,
                    )
                )

    return counts, avatar_urls, merged_prs, processed, sum(counts.values())


def load_pr_csv(output_path: str) -> list[dict[str, int | str]]:
    path = Path(output_path)
    if not path.exists():
        return []

    rows: list[dict[str, int | str]] = []
    with path.open(newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file)
        required = {
            "org",
            "proyecto",
            "usuario",
            "pr_number",
            "pr_title",
            "merged_at",
            "merged_date",
            "url",
        }
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise GitHubAPIError(f"Existing CSV has an invalid header: {output_path}")

        for row in reader:
            row.setdefault("avatar_url", "")
            row.setdefault("additions", "")
            row.setdefault("deletions", "")
            row.setdefault("changed_lines", "")
            rows.append({key: value or "" for key, value in row.items()})

    return rows


def incremental_cutoff(
    existing_rows: list[dict[str, int | str]], overlap_hours: float
) -> datetime | None:
    merged_dates = [
        parse_github_datetime(str(row["merged_at"]))
        for row in existing_rows
        if row.get("merged_at")
    ]
    if not merged_dates:
        return None
    return max(merged_dates) - timedelta(hours=max(overlap_hours, 0))


def merge_pr_rows(
    existing_rows: list[dict[str, int | str]],
    fresh_rows: list[dict[str, int | str]],
) -> list[dict[str, int | str]]:
    merged: dict[tuple[str, str, str], dict[str, int | str]] = {}
    for row in [*existing_rows, *fresh_rows]:
        merged[pr_key(row)] = row
    return list(merged.values())


def summarize_user_counts(
    all_counts: dict[str, Counter[tuple[str, str]]],
    all_avatar_urls: dict[str, dict[str, str]],
) -> list[dict[str, int | str]]:
    totals: dict[tuple[str, str], int] = defaultdict(int)
    projects_by_user: dict[tuple[str, str], set[str]] = defaultdict(set)

    for org, counts in all_counts.items():
        for (project, login), n_prs in counts.items():
            totals[(org, login)] += n_prs
            projects_by_user[(org, login)].add(project)

    rows = [
        {
            "org": org,
            "usuario": login,
            "avatar_url": all_avatar_urls.get(org, {}).get(login, ""),
            "n_prs": n_prs,
            "n_projects": len(projects_by_user[(org, login)]),
        }
        for (org, login), n_prs in totals.items()
    ]
    rows.sort(key=lambda row: (-int(row["n_prs"]), str(row["org"]), str(row["usuario"])))
    return rows


def write_summary_csv(
    output_path: str,
    all_counts: dict[str, Counter[tuple[str, str]]],
    all_avatar_urls: dict[str, dict[str, str]],
) -> None:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as csv_file:
        fieldnames = ["org", "usuario", "avatar_url", "n_prs", "n_projects"]
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(summarize_user_counts(all_counts, all_avatar_urls))


def write_project_csv(
    output_path: str,
    all_counts: dict[str, Counter[tuple[str, str]]],
    all_avatar_urls: dict[str, dict[str, str]],
) -> None:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, int | str]] = []
    for org, counts in all_counts.items():
        for (project, login), n_prs in counts.items():
            rows.append(
                {
                    "org": org,
                    "proyecto": project,
                    "usuario": login,
                    "avatar_url": all_avatar_urls.get(org, {}).get(login, ""),
                    "n_prs": n_prs,
                }
            )

    rows.sort(
        key=lambda row: (
            str(row["org"]),
            str(row["proyecto"]).lower(),
            -int(row["n_prs"]),
            str(row["usuario"]).lower(),
        )
    )

    with open(output_path, "w", newline="", encoding="utf-8") as csv_file:
        fieldnames = ["org", "proyecto", "usuario", "avatar_url", "n_prs"]
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_pr_csv(output_path: str, rows: list[dict[str, int | str]]) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rows.sort(
        key=lambda row: (
            str(row["merged_at"]),
            str(row["org"]),
            str(row["proyecto"]).lower(),
            int(row["pr_number"] or 0),
        ),
        reverse=True,
    )

    temporary_path = path.with_name(f".{path.name}.tmp")
    fieldnames = [
        "org",
        "proyecto",
        "usuario",
        "avatar_url",
        "pr_number",
        "pr_title",
        "merged_at",
        "merged_date",
        "url",
        "additions",
        "deletions",
        "changed_lines",
    ]
    try:
        with temporary_path.open("w", newline="", encoding="utf-8") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def output_path_for_org(template: str, org: str) -> str:
    return template.format(org=org)


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_checkpoint(checkpoint_dir: str, org: str) -> dict[str, Any]:
    path = Path(checkpoint_dir) / f"{org}.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_checkpoint(
    checkpoint_dir: str, org: str, data: dict[str, Any]
) -> None:
    path = Path(checkpoint_dir) / f"{org}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def make_run_summary(
    org: str,
    incremental: bool,
    overlap_hours: float,
    total_repos: int,
    processed_repos: int,
    prs_found: int,
    prs_after_merge: int,
    request_count: int,
    rate_limit_remaining: str | None,
    rate_limit_reset: str | None,
    start_time: float,
    end_time: float,
    skipped_repos: list[str],
    errors: list[str],
    checkpoint: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "org": org,
        "incremental": incremental,
        "overlap_hours": overlap_hours,
        "total_repos": total_repos,
        "processed_repos": processed_repos,
        "prs_found": prs_found,
        "prs_after_merge": prs_after_merge,
        "api_request_count": request_count,
        "rate_limit_remaining": rate_limit_remaining,
        "rate_limit_reset": rate_limit_reset,
        "started_at": datetime.fromtimestamp(start_time, tz=timezone.utc).isoformat(),
        "finished_at": datetime.fromtimestamp(end_time, tz=timezone.utc).isoformat(),
        "duration_seconds": round(end_time - start_time, 2),
        "skipped_repos": skipped_repos,
        "errors": errors,
        "checkpoint": checkpoint,
    }


def main() -> int:
    args = parse_args()
    orgs = selected_orgs(args.orgs)
    load_dotenv()
    token = os.environ.get("GITHUB_TOKEN")

    if not token:
        print(
            "Warning: GITHUB_TOKEN is not set. Unauthenticated GitHub API rate limits are low.",
            file=sys.stderr,
        )

    headers = build_headers(token)
    total_processed_repos = 0
    total_merged_prs = 0
    processed_any = False
    run_summaries: list[dict[str, Any]] = []

    for org in orgs:
        org_request_count_before = get_api_request_count()
        org_start = time.time()
        checkpoint = load_checkpoint(args.checkpoint_dir, org)
        pr_output = output_path_for_org(args.pr_output, org)
        existing_prs = load_pr_csv(pr_output) if args.incremental else []
        updated_since = incremental_cutoff(existing_prs, args.overlap_hours)
        if updated_since:
            cutoff_label = updated_since.astimezone(timezone.utc).isoformat().replace(
                "+00:00", "Z"
            )
            print(
                f"Incremental refresh from {cutoff_label}; "
                f"keeping {len(existing_prs)} existing rows.",
                flush=True,
            )

        print(f"Fetching repositories from {org}...", flush=True)
        try:
            repositories = fetch_repositories(org, headers, args.sleep)
        except GitHubAPIError as exc:
            print(f"Failed to fetch repositories for {org}: {exc}", file=sys.stderr)
            run_summaries.append(
                make_run_summary(
                    org, args.incremental, args.overlap_hours,
                    0, 0, 0, 0,
                    get_api_request_count() - org_request_count_before,
                    None, None,
                    org_start, time.time(),
                    [], [str(exc)], checkpoint,
                )
            )
            continue

        if args.max_repos is not None:
            repositories = repositories[: args.max_repos]

        print(f"Found {len(repositories)} repositories.", flush=True)

        skipped_repos: list[str] = []
        org_errors: list[str] = []
        all_counts: dict[str, Counter[tuple[str, str]]] = {}
        all_avatar_urls: dict[str, dict[str, str]] = {}
        all_merged_prs: list[dict[str, int | str]] = []
        existing_projects = {
            str(row["proyecto"])
            for row in existing_prs
            if row.get("proyecto")
        } if args.incremental else None
        existing_rows_by_key = {pr_key(row): row for row in existing_prs}

        counts: Counter[tuple[str, str]] = Counter()
        avatar_urls: dict[str, str] = {}
        merged_prs: list[dict[str, int | str]] = []
        processed_repos = 0
        total_prs = 0
        total_repos = len(repositories)

        for index, repo in enumerate(repositories, start=1):
            repo_name = repo.get("name")
            if not repo_name:
                print(f"Skipping repo {index}/{total_repos}: missing name", file=sys.stderr)
                continue

            print(f"Processing repo {index}/{total_repos}: {repo_name}", flush=True)
            try:
                repo_updated_since = (
                    updated_since
                    if existing_projects is None or repo_name in existing_projects
                    else None
                )
                pulls = fetch_closed_pull_requests(
                    org,
                    repo_name,
                    headers,
                    args.sleep,
                    updated_since=repo_updated_since,
                )
            except GitHubAPIError as exc:
                print(f"Error processing {repo_name}: {exc}", file=sys.stderr, flush=True)
                skipped_repos.append(repo_name)
                org_errors.append(f"{repo_name}: {exc}")
                continue

            processed_repos += 1
            for pull_request in pulls:
                merged_at = pull_request.get("merged_at")
                if merged_at is None:
                    continue
                user = pull_request.get("user") or {}
                login = user.get("login")
                if login:
                    avatar_url_val = user.get("avatar_url") or ""
                    counts[(repo_name, login)] += 1
                    if avatar_url_val:
                        avatar_urls[login] = avatar_url_val
                    key = (org, repo_name, str(pull_request.get("number") or ""))
                    merged_prs.append(
                        make_pr_row(
                            org,
                            repo_name,
                            pull_request,
                            login,
                            avatar_url_val,
                            existing_rows_by_key.get(key),
                            not args.skip_line_counts,
                            headers,
                            args.sleep,
                        )
                    )

            # Check rate-limit budget after each repo
            budget = get_rate_limit_remaining(headers)
            if budget is not None and budget < args.rate_limit_threshold:
                print(
                    f"Rate limit remaining ({budget}) below threshold "
                    f"({args.rate_limit_threshold}). Pausing {org}.",
                    flush=True,
                )
                break

        total_prs = sum(counts.values())
        all_counts[org] = counts
        all_avatar_urls[org] = avatar_urls
        all_merged_prs.extend(merge_pr_rows(existing_prs, merged_prs))
        total_processed_repos += processed_repos
        total_merged_prs += total_prs
        processed_any = True

        write_pr_csv(pr_output, all_merged_prs)

        if not args.events_only:
            write_summary_csv(args.output, all_counts, all_avatar_urls)
            write_project_csv(args.project_output, all_counts, all_avatar_urls)
            print(f"Wrote {args.output}", flush=True)
            print(f"Wrote {args.project_output}", flush=True)

        print(f"Wrote {pr_output}", flush=True)

        # Persist checkpoint
        last_merged = max(
            (str(r["merged_at"]) for r in all_merged_prs if r.get("merged_at")),
            default=None,
        )
        cp_data = {
            "org": org,
            "last_merged_at": last_merged,
            "last_run_at": iso_now(),
            "total_prs": len(all_merged_prs),
            "incremental": args.incremental,
            "overlap_hours": args.overlap_hours,
        }
        save_checkpoint(args.checkpoint_dir, org, cp_data)

        # Build run summary for this org
        rate_limit_remaining, rate_limit_reset = get_rate_limit_info(headers)
        run_summaries.append(
            make_run_summary(
                org, args.incremental, args.overlap_hours,
                total_repos, processed_repos, total_prs, len(all_merged_prs),
                get_api_request_count() - org_request_count_before,
                rate_limit_remaining, rate_limit_reset,
                org_start, time.time(),
                skipped_repos, org_errors, cp_data,
            )
        )

    if not processed_any:
        print("No organizations were processed successfully.", file=sys.stderr)
        return 1

    print("Done.", flush=True)
    print(f"Total repositories processed: {total_processed_repos}", flush=True)
    print(f"Total merged PRs counted: {total_merged_prs}", flush=True)

    # Write aggregated run summary
    if args.run_summary_output:
        summary_path = Path(args.run_summary_output)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "schema": "run-summary.v1",
            "generated_at": iso_now(),
            "total_repos_processed": total_processed_repos,
            "total_merged_prs": total_merged_prs,
            "ecosystems": run_summaries,
        }
        summary_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {args.run_summary_output}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
