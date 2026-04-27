#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="${HOME}/.config/opencode"
PLUGIN_DIR="${OPENCODE_DIR}/plugin"
COMMAND_DIR="${OPENCODE_DIR}/command"

mkdir -p "${PLUGIN_DIR}/lib" "${COMMAND_DIR}"

cp "${SCRIPT_DIR}/plugin/mystatus.ts" "${PLUGIN_DIR}/"
cp "${SCRIPT_DIR}/plugin/lib/"*.ts "${PLUGIN_DIR}/lib/"
cp "${SCRIPT_DIR}/command/mystatus.md" "${COMMAND_DIR}/"

printf 'Local plugin files copied to %s\n' "${OPENCODE_DIR}"
printf 'Remove "opencode-mystatus" from ~/.config/opencode/opencode.json plugin array if present, then restart OpenCode.\n'
