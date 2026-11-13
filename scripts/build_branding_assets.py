#!/usr/bin/env python3
"""
Generate all Oxygen Browser branding assets (raster icons, monochrome masks,
SVG, and Chromium Skia .icon files) from the user-supplied Oxygen logo.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent
RESOURCES_DIR = REPO_ROOT / "resources"
BRANDING_DIR = RESOURCES_DIR / "branding"
DEFAULT_SOURCE = BRANDING_DIR / "source_logo.jpg"


def create_squircle_mask(size: int, radius: int) -> Image.Image:
    """Create an anti-aliased rounded-square mask at 4x supersampling."""
    scale = 4
    hi = size * scale
    mask = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, hi - 1, hi - 1), radius=radius * scale, fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def find_logo_bbox(gray: Image.Image, threshold: int = 16) -> tuple[int, int, int, int]:
    """Detect bounding box of the silver emblem on the black canvas."""
    mask = gray.point(lambda p: 255 if p > threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return (0, 0, gray.width, gray.height)
    pad = int(gray.width * 0.06)
    x0 = max(0, bbox[0] - pad)
    y0 = max(0, bbox[1] - pad)
    x1 = min(gray.width, bbox[2] + pad)
    y1 = min(gray.height, bbox[3] + pad)
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    half = side // 2
    return (
        max(0, cx - half),
        max(0, cy - half),
        min(gray.width, cx + half),
        min(gray.height, cy + half),
    )


def build_app_badge(src: Image.Image, size: int = 1024) -> Image.Image:
    """Render the emblem centered inside a sleek obsidian squircle badge."""
    gray = src.convert("L")
    bbox = find_logo_bbox(gray)
    cropped = src.crop(bbox).convert("RGBA")

    # Fill outer canvas with pure obsidian matching the logo background
    canvas = Image.new("RGBA", (size, size), (6, 7, 10, 255))
    inner_size = int(size * 0.86)
    emblem = cropped.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
    offset = (size - inner_size) // 2
    canvas.paste(emblem, (offset, offset))

    # Apply rounded-square alpha mask matching Chromium/Helium app icon style
    mask = create_squircle_mask(size, radius=int(size * 0.24))
    canvas.putalpha(mask)
    return canvas


def build_transparent_white_mark(src: Image.Image, size: int) -> Image.Image:
    """Extract the bright silver emblem onto a clean transparent alpha mask."""
    gray = src.convert("L")
    bbox = find_logo_bbox(gray)
    cropped_gray = gray.crop(bbox).resize((size, size), Image.Resampling.LANCZOS)
    # Suppress JPEG compression noise below level 18, boost highlights cleanly
    alpha = cropped_gray.point(lambda p: 0 if p < 18 else min(255, int((p - 18) * 255 / 210)))
    white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    white.putalpha(alpha)
    return white


def build_svg() -> str:
    """Crisp vector SVG faithful to the Oxygen 8-spoke metallic star & ring emblem."""
    return """<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ox-metal" x1="36" y1="24" x2="220" y2="232" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="50%" stop-color="#D4D8DF"/>
      <stop offset="100%" stop-color="#8C939E"/>
    </linearGradient>
    <radialGradient id="ox-ring" cx="50%" cy="50%" r="50%">
      <stop offset="72%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#A8B0BC"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" rx="62" fill="#07080B"/>
  <circle cx="128" cy="128" r="88" stroke="url(#ox-ring)" stroke-width="8"/>
  <g stroke="url(#ox-metal)" stroke-width="11" stroke-linecap="round">
    <line x1="128" y1="62" x2="128" y2="194"/>
    <line x1="62" y1="128" x2="194" y2="128"/>
    <line x1="81.3" y1="81.3" x2="174.7" y2="174.7"/>
    <line x1="174.7" y1="81.3" x2="81.3" y2="174.7"/>
  </g>
  <circle cx="128" cy="128" r="14" fill="#F4F6FA"/>
</svg>
"""


def build_chromium_vector_icon() -> str:
    """Chromium Skia vector icon (.icon) matching the Oxygen emblem."""
    return """// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

CANVAS_DIMENSIONS, 56,
STROKE, 2.6f,
CIRCLE, 28, 28, 21.5f,
STROKE, 3.2f,
CAP_ROUND,
MOVE_TO, 28, 12,
LINE_TO, 28, 44,
MOVE_TO, 12, 28,
LINE_TO, 44, 28,
MOVE_TO, 16.7f, 16.7f,
LINE_TO, 39.3f, 39.3f,
MOVE_TO, 39.3f, 16.7f,
LINE_TO, 16.7f, 39.3f,
"""


def generate_scaled_icons(raw_icon_path: Path) -> None:
    """Generate all PNG sizes listed in resources/generate_resources.txt."""
    spec = RESOURCES_DIR / "generate_resources.txt"
    for raw_line in spec.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        in_rel, size_str, out_rel = parts[0], parts[1], parts[2]
        src_path = RESOURCES_DIR / in_rel
        dst_path = RESOURCES_DIR / out_rel
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        size = int(size_str)
        with Image.open(src_path).convert("RGBA") as img:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(dst_path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Oxygen Browser branding assets")
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Path to source logo image (defaults to resources/branding/source_logo.jpg)",
    )
    args = parser.parse_args()

    BRANDING_DIR.mkdir(parents=True, exist_ok=True)
    (BRANDING_DIR / "app_icon").mkdir(parents=True, exist_ok=True)

    if args.source.resolve() != DEFAULT_SOURCE.resolve():
        shutil.copyfile(args.source, DEFAULT_SOURCE)

    src = Image.open(DEFAULT_SOURCE).convert("RGB")

    # Primary squircle badge app icon + product logos
    raw_badge = build_app_badge(src, size=1024)
    raw_path = BRANDING_DIR / "app_icon" / "raw.png"
    raw_badge.save(raw_path, optimize=True)

    raw_badge.resize((256, 256), Image.Resampling.LANCZOS).save(
        BRANDING_DIR / "product_logo.png", optimize=True
    )
    raw_badge.resize((512, 512), Image.Resampling.LANCZOS).save(
        BRANDING_DIR / "product_logo_200.png", optimize=True
    )

    # Transparent monochrome / white logos for browser UI surfaces
    build_transparent_white_mark(src, 256).save(
        BRANDING_DIR / "product_logo_white.png", optimize=True
    )
    build_transparent_white_mark(src, 512).save(
        BRANDING_DIR / "product_logo_white_200.png", optimize=True
    )
    build_transparent_white_mark(src, 22).save(
        BRANDING_DIR / "product_logo_22_mono.png", optimize=True
    )

    # Vector assets
    (BRANDING_DIR / "product_logo.svg").write_text(build_svg(), encoding="utf-8")
    icon_data = build_chromium_vector_icon()
    (BRANDING_DIR / "product_logo.icon").write_text(icon_data, encoding="utf-8")
    (BRANDING_DIR / "product_logo_color.icon").write_text(icon_data, encoding="utf-8")

    generate_scaled_icons(raw_path)
    print(f"Generated Oxygen branding assets in {RESOURCES_DIR}")


if __name__ == "__main__":
    main()
