#!/usr/bin/env python3
"""
Oxygen Browser Upstream Synchronization & Patch Verification System.

Tracks upstream Helium (`imputnet/helium` and `imputnet/helium-linux`),
detects patch file overlaps between Helium and Oxygen patches before touching
the Chromium source tree, and performs safe fetch/sync/lock updates.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
UPSTREAM_DIR = REPO_ROOT / "upstream" / "helium-linux"
HELIUM_DIR = UPSTREAM_DIR / "helium-chromium"
OXYGEN_PATCHES_DIR = REPO_ROOT / "patches"
LOCK_FILE = REPO_ROOT / "UPSTREAM.json"


def run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        capture_output=True,
        check=check,
    )


def load_lock() -> dict:
    return json.loads(LOCK_FILE.read_text(encoding="utf-8"))


def save_lock(data: dict) -> None:
    LOCK_FILE.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def parse_series(series_file: Path, patches_root: Path) -> list[Path]:
    result: list[Path] = []
    if not series_file.exists():
        return result
    for raw in series_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        result.append(patches_root / line)
    return result


def extract_touched_files(patch_path: Path) -> set[str]:
    files: set[str] = set()
    if not patch_path.exists():
        return files
    for line in patch_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("+++ b/"):
            files.add(line[6:].strip())
        elif line.startswith("--- a/"):
            p = line[6:].strip()
            if p != "/dev/null":
                files.add(p)
    return files


def verify_patches() -> int:
    """Verify Oxygen patch series integrity and report overlaps with Helium."""
    series = OXYGEN_PATCHES_DIR / "series"
    oxygen_patches = parse_series(series, OXYGEN_PATCHES_DIR)
    if not oxygen_patches:
        print("ERROR: patches/series is empty or missing", file=sys.stderr)
        return 1

    missing = [p for p in oxygen_patches if not p.exists()]
    if missing:
        for m in missing:
            print(f"ERROR: Missing patch listed in series: {m}", file=sys.stderr)
        return 1

    oxygen_files: dict[str, list[str]] = {}
    for patch in oxygen_patches:
        rel = str(patch.relative_to(OXYGEN_PATCHES_DIR))
        content = patch.read_text(encoding="utf-8")
        if "--- " not in content or "+++ " not in content:
            print(f"ERROR: Invalid unified diff header in {rel}", file=sys.stderr)
            return 1
        for f in extract_touched_files(patch):
            oxygen_files.setdefault(f, []).append(rel)

    helium_series = parse_series(HELIUM_DIR / "patches" / "series", HELIUM_DIR / "patches")
    linux_series = parse_series(UPSTREAM_DIR / "patches" / "series", UPSTREAM_DIR / "patches")

    upstream_files: dict[str, list[str]] = {}
    for patch in helium_series + linux_series:
        name = patch.name
        for f in extract_touched_files(patch):
            upstream_files.setdefault(f, []).append(name)

    overlaps = sorted(set(oxygen_files) & set(upstream_files))
    print(f"Oxygen patches verified: {len(oxygen_patches)} patches touching {len(oxygen_files)} files.")
    print(f"Helium upstream patches indexed: {len(helium_series) + len(linux_series)} patches.")
    if overlaps:
        print(f"Tracked overlap files (Oxygen patches apply AFTER Helium on these {len(overlaps)} files):")
        for f in overlaps:
            print(f"  - {f}: upstream={upstream_files[f]} | oxygen={oxygen_files[f]}")
    else:
        print("No file overlaps detected between Helium and Oxygen patches.")
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    lock = load_lock()
    linux_head = run_git(UPSTREAM_DIR, "rev-parse", "HEAD").stdout.strip()
    helium_head = run_git(HELIUM_DIR, "rev-parse", "HEAD").stdout.strip()
    chromium_ver = (HELIUM_DIR / "chromium_version.txt").read_text(encoding="utf-8").strip()

    print(f"Oxygen Version      : {lock.get('oxygen_version')}")
    print(f"Chromium Base       : {chromium_ver}")
    print(f"helium-linux HEAD   : {linux_head} (pinned: {lock['helium_linux']['commit']})")
    print(f"helium HEAD         : {helium_head} (pinned: {lock['helium']['commit']})")
    return verify_patches()


def cmd_fetch(_args: argparse.Namespace) -> int:
    print("Fetching upstream helium-linux and helium...")
    run_git(UPSTREAM_DIR, "fetch", "--tags", "origin")
    run_git(HELIUM_DIR, "fetch", "--tags", "origin")
    linux_remote = run_git(UPSTREAM_DIR, "rev-parse", "origin/main").stdout.strip()
    helium_remote = run_git(HELIUM_DIR, "rev-parse", "origin/main").stdout.strip()
    linux_local = run_git(UPSTREAM_DIR, "rev-parse", "HEAD").stdout.strip()
    helium_local = run_git(HELIUM_DIR, "rev-parse", "HEAD").stdout.strip()

    print(f"helium-linux: local={linux_local[:10]} remote={linux_remote[:10]}")
    print(f"helium      : local={helium_local[:10]} remote={helium_remote[:10]}")
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    cmd_fetch(args)
    target_linux = args.linux_ref or "origin/main"
    target_helium = args.helium_ref or "origin/main"

    if args.dry_run:
        linux_target_sha = run_git(UPSTREAM_DIR, "rev-parse", target_linux).stdout.strip()
        helium_target_sha = run_git(HELIUM_DIR, "rev-parse", target_helium).stdout.strip()
        print(f"[dry-run] Would advance helium-linux -> {linux_target_sha}")
        print(f"[dry-run] Would advance helium       -> {helium_target_sha}")
        return verify_patches()

    run_git(UPSTREAM_DIR, "checkout", "--detach", target_linux)
    run_git(HELIUM_DIR, "checkout", "--detach", target_helium)

    linux_head = run_git(UPSTREAM_DIR, "rev-parse", "HEAD").stdout.strip()
    helium_head = run_git(HELIUM_DIR, "rev-parse", "HEAD").stdout.strip()
    chromium_ver = (HELIUM_DIR / "chromium_version.txt").read_text(encoding="utf-8").strip()
    helium_ver = (HELIUM_DIR / "version.txt").read_text(encoding="utf-8").strip()
    helium_rev = (HELIUM_DIR / "revision.txt").read_text(encoding="utf-8").strip()

    lock = load_lock()
    lock["helium_linux"]["commit"] = linux_head
    lock["helium"]["commit"] = helium_head
    lock["helium"]["chromium_version"] = chromium_ver
    lock["helium"]["helium_version"] = helium_ver
    lock["helium"]["helium_revision"] = helium_rev
    lock["last_synced_utc"] = datetime.now(timezone.utc).isoformat()
    save_lock(lock)

    print(f"Synced UPSTREAM.json -> chromium={chromium_ver}, helium={helium_head[:10]}")
    return verify_patches()


def main() -> int:
    parser = argparse.ArgumentParser(description="Oxygen Browser Upstream Sync Tool")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Show pinned vs local upstream revisions and verify patches")
    sub.add_parser("fetch", help="Fetch latest upstream commits without modifying checkout")
    sub.add_parser("verify-patches", help="Verify Oxygen patch series and detect Helium overlaps")

    sync_p = sub.add_parser("sync", help="Sync upstream Helium revisions and update UPSTREAM.json")
    sync_p.add_argument("--dry-run", action="store_true", help="Preview upstream sync without mutating")
    sync_p.add_argument("--linux-ref", help="Git ref/SHA for helium-linux (default: origin/main)")
    sync_p.add_argument("--helium-ref", help="Git ref/SHA for helium (default: origin/main)")

    args = parser.parse_args()
    if args.command == "status":
        return cmd_status(args)
    if args.command == "fetch":
        return cmd_fetch(args)
    if args.command == "verify-patches":
        return verify_patches()
    if args.command == "sync":
        return cmd_sync(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
