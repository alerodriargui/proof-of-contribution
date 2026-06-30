"""Validate locale key parity for the static dashboard i18n files."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCALE_DIR = ROOT / "app" / "locales"
SOURCE_LOCALE = "en.json"


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

    if failed:
        return 1

    print(f"Validated {len(locale_paths)} locale files with {len(source_keys)} keys each.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
