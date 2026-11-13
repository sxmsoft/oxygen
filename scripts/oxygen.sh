#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_LINUX="${ROOT_DIR}/upstream/helium-linux"
# Low-priority, resource-capped container runtime (see scripts/lowprio/docker)
export PATH="${ROOT_DIR}/scripts/lowprio:${PATH}"
OXYGEN_JOBS="${OXYGEN_JOBS:-4}"

usage() {
  cat <<EOF
Oxygen Browser Alpha 0.1 CLI

Usage: ./scripts/oxygen.sh <command> [options]

Commands:
  status            Show pinned Helium upstream revisions and verify Oxygen patches
  sync [args]       Sync upstream Helium revisions (supports --dry-run)
  branding [img]    Regenerate Oxygen PNG/SVG/.icon assets from logo image
  build-ui          Typecheck and build the Svelte Control Center (oxygen://settings)
  test              Run all Oxygen Core, SDK, Control Center, patch, and benchmark tests
  prepare [--low-ram]
                    Build UI + fetch Chromium/Helium sources, apply Helium & Oxygen patches
  build [--low-ram] Compile Oxygen Browser inside the Debian Docker/Podman builder
  run               Launch compiled Oxygen binary with isolated dev profile
  benchmark <helium_bin> <oxygen_bin>
                    Run RAM/CPU/startup comparison benchmark (Helium vs Oxygen)
EOF
}

cmd_build_ui() {
  echo "==> Building Svelte Control Center (oxygen://settings)..."
  (cd "${ROOT_DIR}/control-center" && npm run check && npm run build)
}

cmd_test() {
  echo "==> Verifying upstream & Oxygen patch series..."
  python3 "${ROOT_DIR}/scripts/sync_upstream.py" verify-patches

  echo "==> Building & testing Oxygen Core + SDK + Obsidian Theme Module..."
  (cd "${ROOT_DIR}/oxygen-core" && npm run build && npm test)

  echo "==> Typechecking & building Svelte Control Center..."
  cmd_build_ui

  echo "==> Running benchmark infrastructure tests..."
  (cd "${ROOT_DIR}" && python3 -m unittest discover -s benchmarks/tests -v)

  echo "All Oxygen Browser Alpha 0.1 verification checks passed."
}

cmd_prepare() {
  local low_ram_flag=""
  if [[ "${1:-}" == "--low-ram" ]]; then
    low_ram_flag="--low-ram"
  fi

  cmd_build_ui

  echo "==> Running Helium upstream fetch & patch preparation inside container..."
  _prepare_only=1 bash "${UPSTREAM_LINUX}/scripts/docker-build.sh"

  echo "==> Applying Oxygen native components, Control Center, branding, and patches..."
  python3 "${ROOT_DIR}/scripts/prepare_source.py" ${low_ram_flag}
  python3 "${ROOT_DIR}/scripts/oxygen_name_sub.py" -t "${UPSTREAM_LINUX}/build/src"
}

cmd_build() {
  local low_ram_flag=""
  if [[ "${1:-}" == "--low-ram" ]]; then
    low_ram_flag="--low-ram"
  fi

  cmd_prepare ${low_ram_flag}

  echo "==> Compiling Oxygen Browser (target: chrome)..."
  docker run --rm -i \
    -u "$(id -u):$(id -g)" \
    -v "${UPSTREAM_LINUX}:/repo" \
    -e OXYGEN_JOBS="${OXYGEN_JOBS}" \
    chromium-builder:trixie-slim \
    bash -lc '
      cd /repo/build/src &&
      ./buildtools/linux64/gn gen out/Default --fail-on-unused-args &&
      ./third_party/depot_tools/autoninja.py -j "${OXYGEN_JOBS}" -C out/Default chrome
    '
}

cmd_run() {
  local bin="${UPSTREAM_LINUX}/build/src/out/Default/oxygen"
  if [[ ! -x "${bin}" ]]; then
    echo "Oxygen binary not found at ${bin}. Run './scripts/oxygen.sh build' first." >&2
    exit 1
  fi
  exec "${bin}" \
    --user-data-dir="${HOME}/.config/org.oxygenbrowser.oxygen.dev" \
    "oxygen://settings" "$@"
}

case "${1:-}" in
  status) shift; python3 "${ROOT_DIR}/scripts/sync_upstream.py" status "$@";;
  sync) shift; python3 "${ROOT_DIR}/scripts/sync_upstream.py" sync "$@";;
  branding)
    shift
    if [[ -n "${1:-}" ]]; then
      python3 "${ROOT_DIR}/scripts/build_branding_assets.py" --source "$1"
    else
      python3 "${ROOT_DIR}/scripts/build_branding_assets.py"
    fi
    ;;
  build-ui) cmd_build_ui;;
  test) cmd_test;;
  prepare) shift; cmd_prepare "$@";;
  build) shift; cmd_build "$@";;
  run) shift; cmd_run "$@";;
  benchmark)
    shift
    if [[ $# -lt 2 ]]; then
      echo "Usage: ./scripts/oxygen.sh benchmark <helium_binary> <oxygen_binary>" >&2
      exit 1
    fi
    python3 "${ROOT_DIR}/benchmarks/benchmark_browser.py" --helium "$1" --oxygen "$2"
    ;;
  *) usage; exit 1;;
esac
