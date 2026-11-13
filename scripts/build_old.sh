#!/usr/bin/env bash
# Builds the extension as it was at an older commit (default: c9e1c36, the 0.2.0
# Enes first installed), for the upgrade e2e. Output: dist/e2e-old/<ref>/extension
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:-c9e1c36}"
OUT="${ROOT}/dist/e2e-old/${REF}"
[[ -f "${OUT}/extension/manifest.json" ]] && { echo "${OUT}/extension"; exit 0; }
WT="$(mktemp -d /tmp/oxygen-old-XXXXXX)"
trap 'git -C "${ROOT}" worktree remove --force "${WT}" >/dev/null 2>&1 || rm -rf "${WT}"' EXIT
git -C "${ROOT}" worktree add --detach "${WT}" "${REF}" >/dev/null 2>&1
ln -s "${ROOT}/control-center/node_modules" "${WT}/control-center/node_modules"
ln -s "${ROOT}/oxygen-core/node_modules" "${WT}/oxygen-core/node_modules"
(cd "${WT}/oxygen-core" && nice -n 19 npm run --silent build >/dev/null)
(cd "${WT}/control-center" && nice -n 19 npm run --silent build:extension >/dev/null)
mkdir -p "${OUT}" && cp -r "${WT}/dist/extension" "${OUT}/extension"
echo "${OUT}/extension"
