#!/usr/bin/env bash

set -euo pipefail

OPENCODE_DIR="${HOME}/.config/opencode"
PLUGIN_DIR="${OPENCODE_DIR}/plugin"
COMMAND_DIR="${OPENCODE_DIR}/command"

rm -f "${PLUGIN_DIR}/mystatus.ts"
rm -f "${PLUGIN_DIR}/lib/openai.ts"
rm -f "${PLUGIN_DIR}/lib/zhipu.ts"
rm -f "${PLUGIN_DIR}/lib/google.ts"
rm -f "${PLUGIN_DIR}/lib/copilot.ts"
rm -f "${PLUGIN_DIR}/lib/synthetic.ts"
rm -f "${PLUGIN_DIR}/lib/types.ts"
rm -f "${PLUGIN_DIR}/lib/utils.ts"
rm -f "${PLUGIN_DIR}/lib/i18n.ts"
rm -f "${COMMAND_DIR}/mystatus.md"

printf 'Removed local mystatus plugin files from %s\n' "${OPENCODE_DIR}"
printf 'Ensure "opencode-mystatus" is present in ~/.config/opencode/opencode.json plugin array, then restart OpenCode.\n'
