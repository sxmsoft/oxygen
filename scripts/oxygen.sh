#!/usr/bin/env bash
# Oxygen CLI — Oxygen runs as an MV3 extension on top of stock Helium.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${ROOT_DIR}/dist"
KEYS_DIR="${OXYGEN_KEYS_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/oxygen-keys}"
LOWPRIO=(nice -n 19 ionice -c3)
VARIANTS=(obsidian graphite midnight)

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
  verify            Headless end-to-end checks on Helium: theme sync + every feature module
                    (throwaway profiles, local fixture server, screenshots in dist/e2e)
  run [--theme T]   Start Helium + Oxygen with dev profile ~/.config/oxygen-dev (T: obsidian|graphite|midnight|none)
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
  echo "==> Theme packs -> dist/themes"
  "${LOWPRIO[@]}" node "${ROOT_DIR}/scripts/build_themes.mjs" "${DIST}/themes"
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
  zip_dir "${DIST}/extension" "${out}/oxygen-${ver}.zip"
  pack_crx "${DIST}/extension" "${KEYS_DIR}/oxygen.pem" "${out}/oxygen-${ver}.crx"
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
