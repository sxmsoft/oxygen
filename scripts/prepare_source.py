#!/usr/bin/env python3
"""
Applies Oxygen Browser native components, Svelte Control Center assets,
branding icons, and Oxygen patches on top of a prepared Helium Chromium tree.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
UPSTREAM_LINUX = REPO_ROOT / "upstream" / "helium-linux"
HELIUM_REPO = UPSTREAM_LINUX / "helium-chromium"
DEFAULT_SRC = UPSTREAM_LINUX / "build" / "src"


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def apply_oxygen_overlay(src_dir: Path, low_ram: bool) -> None:
    if not src_dir.exists():
        raise FileNotFoundError(
            f"Prepared Helium Chromium source tree not found at {src_dir}. "
            "Run './scripts/oxygen.sh prepare' first."
        )

    cc_dist = REPO_ROOT / "control-center" / "dist"
    if not (cc_dist / "index.html").exists():
        raise FileNotFoundError(
            "control-center/dist/index.html missing. Run './scripts/oxygen.sh build-ui' first."
        )

    # 1. Native C++ Chromium components
    for comp in ("oxygen_core", "oxygen_theme", "oxygen_control_center"):
        copy_tree(
            REPO_ROOT / "native" / "components" / comp,
            src_dir / "components" / comp,
        )

    copy_tree(cc_dist, src_dir / "components" / "oxygen_control_center" / "resources")

    # 2. Oxygen branding assets (generated from user's logo)
    subprocess.run(
        [
            sys.executable,
            str(HELIUM_REPO / "utils" / "replace_resources.py"),
            str(REPO_ROOT / "resources" / "oxygen_resources.txt"),
            str(REPO_ROOT / "resources"),
            str(src_dir),
        ],
        check=True,
    )

    # 3. Apply Oxygen patches on top of Helium
    stamp = src_dir / ".oxygen_patched.stamp"
    if not stamp.exists():
        subprocess.run(
            [
                sys.executable,
                str(HELIUM_REPO / "utils" / "patches.py"),
                "apply",
                str(src_dir),
                str(REPO_ROOT / "patches"),
            ],
            check=True,
        )
        stamp.touch()

    # 4. Append Oxygen GN flags (and optional low-RAM linker profile)
    args_gn = src_dir / "out" / "Default" / "args.gn"
    args_gn.parent.mkdir(parents=True, exist_ok=True)
    existing = args_gn.read_text(encoding="utf-8") if args_gn.exists() else ""
    extra_parts = [(REPO_ROOT / "flags.oxygen.gn").read_text(encoding="utf-8")]
    if low_ram:
        extra_parts.append((REPO_ROOT / "flags.lowram.gn").read_text(encoding="utf-8"))
    marker = "# --- OXYGEN GN OVERLAY ---"
    if marker not in existing:
        with open(args_gn, "a", encoding="utf-8") as fh:
            fh.write(f"\n{marker}\n")
            fh.write("\n".join(extra_parts))

    print(f"Oxygen overlay successfully applied to {src_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply Oxygen overlay onto Helium Chromium source")
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC, help="Chromium src directory")
    parser.add_argument(
        "--low-ram",
        action="store_true",
        help="Append low-RAM GN flags (concurrent_links=1, symbol_level=0) for <=16GB hosts",
    )
    args = parser.parse_args()
    apply_oxygen_overlay(args.src, low_ram=args.low_ram)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
