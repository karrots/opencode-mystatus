#!/usr/bin/env bash

set -euo pipefail

OPENCODE_DIR="${HOME}/.config/opencode"
PLUGINS_DIR="${OPENCODE_DIR}/plugins"
OLD_PLUGIN_DIR="${OPENCODE_DIR}/plugin"
OLD_COMMAND_DIR="${OPENCODE_DIR}/command"
OLD_LOCAL_PLUGIN_DIR="${PLUGINS_DIR}/opencode-mystatus"

# Remove from ~/.config/opencode/plugins/
rm -f "${PLUGINS_DIR}/mystatus.ts"
rm -f "${PLUGINS_DIR}/mystatus-tui.tsx"
rm -f "${PLUGINS_DIR}/lib/openai.ts"
rm -f "${PLUGINS_DIR}/lib/zhipu.ts"
rm -f "${PLUGINS_DIR}/lib/google.ts"
rm -f "${PLUGINS_DIR}/lib/copilot.ts"
rm -f "${PLUGINS_DIR}/lib/synthetic.ts"
rm -f "${PLUGINS_DIR}/lib/types.ts"
rm -f "${PLUGINS_DIR}/lib/utils.ts"
rm -f "${PLUGINS_DIR}/lib/i18n.ts"
rm -f "${PLUGINS_DIR}/lib/status.ts"

# Remove legacy locations
rm -f "${OLD_PLUGIN_DIR}/mystatus.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/openai.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/zhipu.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/google.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/copilot.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/synthetic.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/types.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/utils.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/i18n.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/status.ts"
rm -f "${OLD_COMMAND_DIR}/mystatus.md"
rm -rf "${OLD_LOCAL_PLUGIN_DIR}"

printf 'Removed local mystatus plugin files from %s\n' "${OPENCODE_DIR}"
printf 'Ensure "opencode-mystatus" is present in ~/.config/opencode/opencode.json plugin array, then restart OpenCode.\n'

