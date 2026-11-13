#!/usr/bin/env python3
"""
Applies Oxygen Browser string branding over Helium-substituted GRD/XTB files
inside the prepared Chromium source tree (Helium -> Oxygen, helium:// -> oxygen://).
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

REPLACEMENTS = [
    (re.compile(r"\bhelium://"), "oxygen://"),
    (re.compile(r"\bThe Helium Authors\b"), "The Oxygen Browser Authors"),
    (re.compile(r"\bHelium\b"), "Oxygen"),
]

IGNORE_DIRS = {".pc", "out", "third_party", "chromeos", "remoting", "ash", "testdata"}


def substitute_file(path: Path, dry_run: bool) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False

    updated = text
    for pattern, repl in REPLACEMENTS:
        updated = pattern.sub(repl, updated)

    if updated == text:
        return False

    if not dry_run:
        path.write_text(updated, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Oxygen GRD/XTB string branding")
    parser.add_argument("-t", "--tree", type=Path, required=True, help="Chromium src tree")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    changed = 0
    for root, dirs, files in os.walk(args.tree):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]
        for filename in files:
            ext = Path(filename).suffix.lower()
            if ext not in {".grd", ".grdp", ".xtb"}:
                continue
            if substitute_file(Path(root) / filename, dry_run=args.dry_run):
                changed += 1

    print(f"Oxygen string substitution updated {changed} files (dry_run={args.dry_run}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
