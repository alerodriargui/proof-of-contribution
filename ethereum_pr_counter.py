#!/usr/bin/env python3
"""Count merged pull request authors across public repositories in GitHub orgs."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from collections import Counter, defaultdict
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


class GitHubAPIError(RuntimeError):
    """Raised for GitHub API errors that should be reported cleanly."""


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
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read().decode("utf-8")
                response_headers = response.headers
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
    org: str, repo: str, headers: dict[str, str], sleep_seconds: float
) -> list[dict[str, Any]]:
    url = f"{API_ROOT}/repos/{org}/{repo}/pulls"
    return github_get_paginated(
        url,
        headers,
        sleep_seconds,
        params={"state": "closed", "sort": "updated", "direction": "desc"},
    )


def count_merged_pr_authors(
    org: str,
    repositories: list[dict[str, Any]],
    headers: dict[str, str],
    sleep_seconds: float,
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
            pulls = fetch_closed_pull_requests(org, repo_name, headers, sleep_seconds)
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
                merged_prs.append(
                    {
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
                )

    return counts, avatar_urls, merged_prs, processed, sum(counts.values())


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
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    rows.sort(
        key=lambda row: (
            str(row["merged_at"]),
            str(row["org"]),
            str(row["proyecto"]).lower(),
            int(row["pr_number"] or 0),
        ),
        reverse=True,
    )

    with open(output_path, "w", newline="", encoding="utf-8") as csv_file:
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
        ]
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def output_path_for_org(template: str, org: str) -> str:
    return template.format(org=org)


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

    for org in orgs:
        all_counts: dict[str, Counter[tuple[str, str]]] = {}
        all_avatar_urls: dict[str, dict[str, str]] = {}
        all_merged_prs: list[dict[str, int | str]] = []
        print(f"Fetching repositories from {org}...", flush=True)
        try:
            repositories = fetch_repositories(org, headers, args.sleep)
        except GitHubAPIError as exc:
            print(f"Failed to fetch repositories for {org}: {exc}", file=sys.stderr)
            continue

        if args.max_repos is not None:
            repositories = repositories[: args.max_repos]

        print(f"Found {len(repositories)} repositories.", flush=True)

        counts, avatar_urls, merged_prs, processed_repos, total_prs = count_merged_pr_authors(
            org,
            repositories,
            headers,
            args.sleep,
        )
        all_counts[org] = counts
        all_avatar_urls[org] = avatar_urls
        all_merged_prs.extend(merged_prs)
        total_processed_repos += processed_repos
        total_merged_prs += total_prs
        processed_any = True

        pr_output = output_path_for_org(args.pr_output, org)
        write_pr_csv(pr_output, all_merged_prs)

        if args.events_only:
            print(f"Wrote {pr_output}", flush=True)
            continue

        write_summary_csv(args.output, all_counts, all_avatar_urls)
        write_project_csv(args.project_output, all_counts, all_avatar_urls)

        print(f"Wrote {args.output}", flush=True)
        print(f"Wrote {args.project_output}", flush=True)
        print(f"Wrote {pr_output}", flush=True)

    if not processed_any:
        print("No organizations were processed successfully.", file=sys.stderr)
        return 1

    print("Done.", flush=True)
    print(f"Total repositories processed: {total_processed_repos}", flush=True)
    print(f"Total merged PRs counted: {total_merged_prs}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
