#!/usr/bin/env bash
# Oxygen CLI — Oxygen runs as an MV3 extension on top of stock Helium.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${ROOT_DIR}/dist"
KEYS_DIR="${OXYGEN_KEYS_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/oxygen-keys}"
LOWPRIO=(nice -n 19 ionice -c3)
VARIANTS=(obsidian graphite midnight)
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
IMPORT_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/oxygen/imported-shortcuts.json"
FLAGS_CONF="${XDG_CONFIG_HOME}/helium-browser-flags.conf"
FLAGS_BAK="${FLAGS_CONF}.bak-oxygen"
FLAGS_MARK="# Oxygen extension (added by oxygen.sh install; remove with oxygen.sh uninstall)"
DESKTOP_OVERRIDE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/helium.desktop"

helium_bin() {
  if [[ -n "${HELIUM_BIN:-}" ]]; then echo "${HELIUM_BIN}"; return; fi
  # Real binary (not the wrapper) for headless/packaging so user flags don't apply.
  if [[ -x /opt/helium-browser-bin/helium ]]; then echo /opt/helium-browser-bin/helium; return; fi
  command -v helium-browser || command -v helium || { echo "Helium not found; set HELIUM_BIN" >&2; exit 1; }
}

usage() {
  cat <<USAGE
Oxygen CLI (Helium extension edition)

Usage: ./scripts/oxygen.sh <command> [options]

Commands:
  build             Build oxygen-core, the extension (dist/extension) and theme packs (dist/themes)
  test              Core unit tests, Control Center typecheck, benchmark tests
  verify            Headless end-to-end checks on Helium: theme sync, every feature module, Helium import
                    (throwaway profiles, local fixture server, screenshots in dist/e2e)
  run [--theme T]   Start Helium + Oxygen with dev profile ~/.config/oxygen-dev (T: obsidian|graphite|midnight|none)
  install [--theme T]
                    Load Oxygen whenever Helium starts normally (menu, dock, helium-browser):
                    adds --load-extension=dist/extension to ${FLAGS_CONF}
                    (backup: ${FLAGS_BAK}). Idempotent. --theme adds a theme pack too (optional).
  uninstall         Remove exactly what install added (restores the backup when nothing else changed)
  import-shortcuts [--profile DIR]
                    Copy Helium's new-tab shortcuts into Oxygen quick links (reads a copy of
                    <profile>/Preferences; default ~/.config/net.imput.helium/Default)
  package           Zip + signed .crx for the extension and theme packs into dist/packages
                    (keys in ${KEYS_DIR}, never in the repo)
  benchmark [N]     Bare Helium vs Helium + Oxygen, N iterations (default 3), headless, low priority
  branding [img]    Regenerate branding PNG/SVG assets from the logo image
USAGE
}

cmd_build() {
  echo "==> oxygen-core (tsc)"
  (cd "${ROOT_DIR}/oxygen-core" && "${LOWPRIO[@]}" npm run --silent build)
  echo "==> Control Center + service worker -> dist/extension"
  (cd "${ROOT_DIR}/control-center" && "${LOWPRIO[@]}" npm run --silent build:extension)
  # New code => new manifest version, or Chromium keeps the old service worker (see the script).
  node "${ROOT_DIR}/scripts/stamp_version.mjs" "${DIST}/extension" "${DIST}/.build-state.json"
  echo "==> Theme packs -> dist/themes"
  "${LOWPRIO[@]}" node "${ROOT_DIR}/scripts/build_themes.mjs" "${DIST}/themes"
  # vite empties dist/extension; keep a previous Helium shortcut import in the build.
  if [[ -f "${IMPORT_FILE}" ]]; then
    install -m 600 "${IMPORT_FILE}" "${DIST}/extension/imported-shortcuts.json"
    echo "==> kept Helium shortcut import (${IMPORT_FILE})"
  fi
}

cmd_import_shortcuts() {
  [[ -f "${ROOT_DIR}/oxygen-core/dist/extension/src/logic/shortcuts.js" ]] || (cd "${ROOT_DIR}/oxygen-core" && "${LOWPRIO[@]}" npm run --silent build)
  "${LOWPRIO[@]}" node "${ROOT_DIR}/scripts/import_shortcuts.mjs" --out "${IMPORT_FILE}" --dist "${DIST}/extension" "$@"
  echo "Oxygen picks it up on its next start (or Control Center / quick links: \"Import from Helium\")."
}

# Quotes a flag value for the wrapper's `eval set --` parser only when needed.
flag_arg() {
  if [[ "$1" =~ [[:space:]\"\'\\] ]]; then printf '"%s"' "${1//\"/\\\"}"; else printf '%s' "$1"; fi
}

# Desktop entries must go through the wrapper (it is what reads the flags file).
desktop_check() {
  local f bad=()
  for f in /usr/share/applications/helium*.desktop; do
    [[ -f "$f" ]] || continue
    if grep -E '^Exec=' "$f" | grep -vqE '^Exec=(/usr/bin/)?helium-browser( |$)'; then bad+=("$f"); fi
  done
  if ((${#bad[@]} == 0)); then
    echo "    desktop launcher(s) already use helium-browser (the wrapper)"
    return
  fi
  for f in "${bad[@]}"; do
    mkdir -p "$(dirname "${DESKTOP_OVERRIDE}")"
    { echo "# Oxygen override (oxygen.sh install): launch through the helium-browser wrapper"
      sed -E 's#^Exec=[^ ]+#Exec=helium-browser#' "$f"; } > "${DESKTOP_OVERRIDE}"
    echo "    wrote ${DESKTOP_OVERRIDE} (Exec via helium-browser)"
  done
}

cmd_install() {
  local theme=""
  while (($#)); do case "$1" in --theme) theme="${2:-}"; shift 2;; *) echo "unknown option $1" >&2; exit 2;; esac; done
  [[ -f "${DIST}/extension/manifest.json" ]] || cmd_build
  local value="${DIST}/extension"
  if [[ -n "${theme}" ]]; then
    [[ -f "${DIST}/themes/${theme}/manifest.json" ]] || { echo "no theme pack ${theme} in dist/themes" >&2; exit 2; }
    value+=",${DIST}/themes/${theme}"
  fi
  # The wrapper escapes `~` with ${line//~/\\~}; bash tilde-expands that pattern, so every
  # literal "$HOME" in a flags line becomes a literal "~" Chromium can't resolve. Spell
  # $HOME with a doubled slash ("/home//user"), which the wrapper leaves alone and the
  # kernel/Chromium resolve to the same directory.
  if [[ -n "${HOME:-}" && "${HOME}" == /*/* ]]; then
    value="${value//"${HOME}"/"${HOME%/*}//${HOME##*/}"}"
  fi
  local line="--load-extension=$(flag_arg "${value}")"
  mkdir -p "$(dirname "${FLAGS_CONF}")"
  if [[ -f "${FLAGS_CONF}" && ! -f "${FLAGS_BAK}" ]]; then
    cp -p "${FLAGS_CONF}" "${FLAGS_BAK}"
    echo "    backup: ${FLAGS_BAK}"
  fi
  touch "${FLAGS_CONF}"
  if grep -Fxq "${FLAGS_MARK}" "${FLAGS_CONF}"; then
    # Replace our previous line (e.g. theme changed); other lines stay byte-identical.
    python3 - "${FLAGS_CONF}" "${FLAGS_MARK}" "${line}" <<'PY'
import sys
path, mark, line = sys.argv[1:]
lines = open(path, encoding="utf-8").read().split("\n")
out, i = [], 0
while i < len(lines):
    if lines[i] == mark:
        out += [mark, line]; i += 2; continue
    out.append(lines[i]); i += 1
open(path, "w", encoding="utf-8").write("\n".join(out))
PY
  else
    if grep -Eq '^[[:space:]]*--load-extension' "${FLAGS_CONF}"; then
      echo "    warning: ${FLAGS_CONF} already has another --load-extension line; Chromium uses only the last one" >&2
    fi
    [[ -s "${FLAGS_CONF}" && "$(tail -c1 "${FLAGS_CONF}" | od -An -c | tr -d ' ')" != '\n' ]] && printf '\n' >> "${FLAGS_CONF}"
    printf '%s\n%s\n' "${FLAGS_MARK}" "${line}" >> "${FLAGS_CONF}"
  fi
  echo "==> ${FLAGS_CONF}: ${line}"
  desktop_check
  echo "Restart Helium (fully quit it first) to load Oxygen."
}

cmd_uninstall() {
  if [[ -f "${FLAGS_CONF}" ]] && grep -Fxq "${FLAGS_MARK}" "${FLAGS_CONF}"; then
    python3 - "${FLAGS_CONF}" "${FLAGS_MARK}" <<'PY'
import sys
path, mark = sys.argv[1:]
lines = open(path, encoding="utf-8").read().split("\n")
out, i = [], 0
while i < len(lines):
    if lines[i] == mark:
        i += 2; continue
    out.append(lines[i]); i += 1
open(path, "w", encoding="utf-8").write("\n".join(out))
PY
    echo "==> removed Oxygen line from ${FLAGS_CONF}"
  else
    echo "    ${FLAGS_CONF}: nothing to remove"
  fi
  if [[ -f "${FLAGS_BAK}" ]]; then
    if cmp -s "${FLAGS_BAK}" "${FLAGS_CONF}"; then
      mv -f "${FLAGS_BAK}" "${FLAGS_CONF}"  # identical: restore (keeps original mtime/mode)
      echo "    restored ${FLAGS_CONF} from backup"
    else
      echo "    ${FLAGS_CONF} differs from ${FLAGS_BAK} (edited since install); kept both" >&2
    fi
  fi
  if [[ -f "${DESKTOP_OVERRIDE}" ]] && head -1 "${DESKTOP_OVERRIDE}" | grep -q '^# Oxygen override'; then
    rm -f "${DESKTOP_OVERRIDE}"
    echo "    removed ${DESKTOP_OVERRIDE}"
  fi
  echo "Restart Helium to unload Oxygen."
}

cmd_test() {
  echo "==> Oxygen Core + SDK + Obsidian module tests"
  (cd "${ROOT_DIR}/oxygen-core" && npm run --silent build && npm test)
  echo "==> Control Center typecheck"
  (cd "${ROOT_DIR}/control-center" && npm run --silent check)
  echo "==> Benchmark infrastructure tests"
  (cd "${ROOT_DIR}" && python3 -m unittest discover -s benchmarks/tests -v)
  echo "All Oxygen checks passed."
}

cmd_verify() {
  cmd_build
  "${LOWPRIO[@]}" node "${ROOT_DIR}/tests/e2e/verify_extension.mjs" --binary "$(helium_bin)" "$@"
  "${LOWPRIO[@]}" node "${ROOT_DIR}/tests/e2e/verify_features.mjs" --binary "$(helium_bin)" "$@"
  "${LOWPRIO[@]}" node "${ROOT_DIR}/tests/e2e/verify_import.mjs" --binary "$(helium_bin)" "$@"
  "${LOWPRIO[@]}" node "${ROOT_DIR}/tests/e2e/verify_upgrade.mjs" --binary "$(helium_bin)" "$@"
  "${LOWPRIO[@]}" node "${ROOT_DIR}/tests/e2e/verify_layout.mjs" --binary "$(helium_bin)" "$@"
}

cmd_run() {
  [[ -f "${DIST}/extension/manifest.json" ]] || cmd_build
  OXYGEN_PROFILE="${OXYGEN_PROFILE:-${XDG_CONFIG_HOME:-$HOME/.config}/oxygen-dev}" \
    exec "${ROOT_DIR}/scripts/oxygen-launch.sh" "$@"
}

# Signs one unpacked dir into a .crx using an isolated throwaway profile.
pack_crx() {
  local dir="$1" key="$2" out="$3" tmp
  if [[ ! -f "${key}" ]]; then
    mkdir -p "${KEYS_DIR}" && chmod 700 "${KEYS_DIR}"
    (umask 077 && openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "${key}" 2>/dev/null)
    echo "    generated new key ${key} (ID will differ from manifest key)" >&2
  fi
  tmp="$(mktemp -d /tmp/oxygen-pack-XXXXXX)"
  cp -r "${dir}" "${tmp}/pkg"
  "${LOWPRIO[@]}" "$(helium_bin)" --headless=new --user-data-dir="${tmp}/profile" \
    --pack-extension="${tmp}/pkg" --pack-extension-key="${key}" >/dev/null 2>&1 || true
  [[ -f "${tmp}/pkg.crx" ]] || { rm -rf "${tmp}"; echo "crx packing failed for ${dir}" >&2; return 1; }
  mv "${tmp}/pkg.crx" "${out}" && chmod 644 "${out}"
  rm -rf "${tmp}"
}

zip_dir() {
  python3 - "$1" "$2" <<'PY'
import sys, zipfile, pathlib
src, out = pathlib.Path(sys.argv[1]), sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(src.rglob("*")):
        if f.is_file():
            z.write(f, f.relative_to(src))
PY
}

cmd_package() {
  cmd_build
  local ver out
  ver="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "${DIST}/extension/manifest.json")"
  out="${DIST}/packages"
  rm -rf "${out}" && mkdir -p "${out}"
  echo "==> oxygen-${ver}"
  # Never ship the personal shortcut import (URLs can contain share keys).
  local stage
  stage="$(mktemp -d /tmp/oxygen-stage-XXXXXX)"
  cp -r "${DIST}/extension" "${stage}/extension"
  rm -f "${stage}/extension/imported-shortcuts.json"
  zip_dir "${stage}/extension" "${out}/oxygen-${ver}.zip"
  pack_crx "${stage}/extension" "${KEYS_DIR}/oxygen.pem" "${out}/oxygen-${ver}.crx"
  rm -rf "${stage}"
  for v in "${VARIANTS[@]}"; do
    echo "==> oxygen-theme-${v}-${ver}"
    zip_dir "${DIST}/themes/${v}" "${out}/oxygen-theme-${v}-${ver}.zip"
    pack_crx "${DIST}/themes/${v}" "${KEYS_DIR}/theme-${v}.pem" "${out}/oxygen-theme-${v}-${ver}.crx"
  done
  ls -l "${out}"
}

cmd_benchmark() {
  local n="${1:-3}"
  [[ -f "${DIST}/extension/manifest.json" ]] || cmd_build
  "${LOWPRIO[@]}" python3 "${ROOT_DIR}/benchmarks/benchmark_browser.py" \
    --helium "$(helium_bin)" \
    --extension "${DIST}/extension" --extension "${DIST}/themes/obsidian" \
    --iterations "${n}"
}

case "${1:-}" in
  build) cmd_build;;
  test) cmd_test;;
  verify) shift; cmd_verify "$@";;
  run) shift; cmd_run "$@";;
  package) cmd_package;;
  install) shift; cmd_install "$@";;
  uninstall) cmd_uninstall;;
  import-shortcuts) shift; cmd_import_shortcuts "$@";;
  benchmark) shift; cmd_benchmark "$@";;
  branding)
    shift
    if [[ -n "${1:-}" ]]; then
      python3 "${ROOT_DIR}/scripts/build_branding_assets.py" --source "$1"
    else
      python3 "${ROOT_DIR}/scripts/build_branding_assets.py"
    fi
    ;;
  *) usage; exit 1;;
esac
