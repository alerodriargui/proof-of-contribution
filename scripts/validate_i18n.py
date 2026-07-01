"""Validate locale key parity for the static dashboard i18n files."""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCALE_DIR = ROOT / "app" / "locales"
SOURCE_LOCALE = "en.json"
LANDING_PAGE = ROOT / "index.html"


LANDING_TEXT_ALLOWLIST = {
    "Proof of Contribution",
    "GitHub",
    "Ethereum",
    "Bitcoin",
    "Binance",
    "Uniswap",
    "Ripple",
    "Aave",
    "Dogecoin",
    "Hyperliquid",
    "Tron",
    "Cardano",
    "Stellar",
    "Chainlink",
    "Solana",
    "Avalanche",
    "Arbitrum",
    "Polygon",
    "NEAR",
    "Sui",
}


class LandingI18nParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[dict[str, object]] = []
        self.issues: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {name: value or "" for name, value in attrs}
        parent = self.stack[-1] if self.stack else {}
        parent_translated = bool(parent.get("translated"))
        parent_hidden = bool(parent.get("hidden"))
        translated = parent_translated or any(
            key in attr_map
            for key in ("data-i18n", "data-i18n-html", "data-i18n-attr")
        )
        hidden = parent_hidden or attr_map.get("aria-hidden") == "true" or tag in {"head", "script", "style", "svg", "title"}
        self.stack.append({"tag": tag, "translated": translated, "hidden": hidden})

    def handle_endtag(self, tag: str) -> None:
        while self.stack:
            item = self.stack.pop()
            if item.get("tag") == tag:
                return

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text or self._is_allowed(text):
            return
        current = self.stack[-1] if self.stack else {}
        if current.get("hidden") or current.get("translated"):
            return
        self.issues.append(text)

    @staticmethod
    def _is_allowed(text: str) -> bool:
        if text in LANDING_TEXT_ALLOWLIST:
            return True
        if not re.search(r"[A-Za-z]", text):
            return True
        if re.fullmatch(r"[A-Z0-9+]{1,6}", text):
            return True
        return False


def flatten_keys(value: object, prefix: str = "") -> set[str]:
    if isinstance(value, dict):
        keys: set[str] = set()
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else key
            keys.update(flatten_keys(child, child_prefix))
        return keys
    return {prefix}


def load_json(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def validate_landing_page_i18n() -> list[str]:
    parser = LandingI18nParser()
    parser.feed(LANDING_PAGE.read_text(encoding="utf-8"))
    return parser.issues


def main() -> int:
    source_path = LOCALE_DIR / SOURCE_LOCALE
    source_keys = flatten_keys(load_json(source_path))
    failed = False

    locale_paths = sorted(LOCALE_DIR.glob("*.json"))
    if not locale_paths:
        print("No locale files found.")
        return 1

    for path in locale_paths:
        keys = flatten_keys(load_json(path))
        missing = sorted(source_keys - keys)
        extra = sorted(keys - source_keys)
        if missing or extra:
            failed = True
            print(f"{path.relative_to(ROOT)} is not aligned with {SOURCE_LOCALE}")
            if missing:
                print("  Missing keys:")
                for key in missing:
                    print(f"    - {key}")
            if extra:
                print("  Extra keys:")
                for key in extra:
                    print(f"    - {key}")

    landing_issues = validate_landing_page_i18n()
    if landing_issues:
        failed = True
        print(f"{LANDING_PAGE.relative_to(ROOT)} has visible Home page text outside the i18n layer")
        for text in landing_issues:
            print(f"  - {text}")

    if failed:
        return 1

    print(f"Validated {len(locale_paths)} locale files with {len(source_keys)} keys each.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
