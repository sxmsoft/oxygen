#!/usr/bin/env bash
# Oxygen launcher: starts stock Helium with the Oxygen extension and ONE theme
# pack in an isolated profile. Your normal Helium profile is never touched.
#
# Usage: scripts/oxygen-launch.sh [--theme obsidian|graphite|midnight|none] [--profile DIR] [helium args...]
#
# Env:   HELIUM_BIN      Helium binary/wrapper (default: helium-browser, then /opt/helium-browser-bin/helium)
#        OXYGEN_HOME     dir containing extension/ and themes/<variant>/ (default: <repo>/dist)
#        OXYGEN_PROFILE  user data dir (default: ~/.config/oxygen)
#
# Chromium keeps a single browser theme installed, so the theme pack is chosen
# here; the choice is remembered in ~/.config/oxygen-launcher/theme.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OXYGEN_HOME="${OXYGEN_HOME:-${ROOT_DIR}/dist}"
PROFILE="${OXYGEN_PROFILE:-${XDG_CONFIG_HOME:-$HOME/.config}/oxygen}"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/oxygen-launcher"
THEME_FILE="${STATE_DIR}/theme"

if [[ -z "${HELIUM_BIN:-}" ]]; then
  HELIUM_BIN="$(command -v helium-browser || true)"
  [[ -n "${HELIUM_BIN}" ]] || HELIUM_BIN=/opt/helium-browser-bin/helium
fi

theme="$(cat "${THEME_FILE}" 2>/dev/null || echo obsidian)"
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --theme) theme="$2"; mkdir -p "${STATE_DIR}"; echo "${theme}" > "${THEME_FILE}"; shift 2;;
    --profile) PROFILE="$2"; shift 2;;
    *) args+=("$1"); shift;;
  esac
done

case "${theme}" in
  obsidian|graphite|midnight|none) ;;
  *) echo "Unknown theme '${theme}' (obsidian|graphite|midnight|none)" >&2; exit 2;;
esac

ext="${OXYGEN_HOME}/extension"
[[ -f "${ext}/manifest.json" ]] || { echo "Oxygen extension not built: ${ext} (run ./scripts/oxygen.sh build)" >&2; exit 1; }
load="${ext}"
if [[ "${theme}" != none ]]; then
  [[ -f "${OXYGEN_HOME}/themes/${theme}/manifest.json" ]] || { echo "Theme pack missing: ${OXYGEN_HOME}/themes/${theme}" >&2; exit 1; }
  load="${load},${OXYGEN_HOME}/themes/${theme}"
fi

exec "${HELIUM_BIN}" \
  --user-data-dir="${PROFILE}" \
  --load-extension="${load}" \
  --class=oxygen \
  --no-default-browser-check \
  "${args[@]}"
