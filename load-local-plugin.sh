#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="${HOME}/.config/opencode"
PLUGIN_DIR="${OPENCODE_DIR}/plugins"
OLD_LOCAL_PLUGIN_DIR="${PLUGIN_DIR}/opencode-mystatus"
OLD_PLUGIN_DIR="${OPENCODE_DIR}/plugin"
OLD_COMMAND_DIR="${OPENCODE_DIR}/command"
TUI_CONFIG="${OPENCODE_DIR}/tui.json"

mkdir -p "${PLUGIN_DIR}/lib"

cp "${SCRIPT_DIR}/plugin/mystatus.ts" "${PLUGIN_DIR}/"
cp "${SCRIPT_DIR}/plugin/mystatus-tui.tsx" "${PLUGIN_DIR}/"
cp "${SCRIPT_DIR}/plugin/lib/"*.ts "${PLUGIN_DIR}/lib/"

rm -f "${OLD_PLUGIN_DIR}/mystatus.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/openai.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/zhipu.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/google.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/copilot.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/synthetic.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/types.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/utils.ts"
rm -f "${OLD_PLUGIN_DIR}/lib/i18n.ts"
rm -f "${OLD_COMMAND_DIR}/mystatus.md"
rm -rf "${OLD_LOCAL_PLUGIN_DIR}"

TUI_PLUGIN_PATH="./plugins/mystatus-tui.tsx"

if [ ! -f "${TUI_CONFIG}" ]; then
  printf '{"$schema":"https://opencode.ai/tui.json","plugin":["%s"]}\n' "${TUI_PLUGIN_PATH}" > "${TUI_CONFIG}"
  printf 'Created %s\n' "${TUI_CONFIG}"
else
  if ! grep -q 'mystatus-tui' "${TUI_CONFIG}"; then
    EXISTING="$(cat "${TUI_CONFIG}")"
    printf '%s\n' "$(echo "${EXISTING}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
d.setdefault('plugin', [])
if '${TUI_PLUGIN_PATH}' not in d['plugin']:
    d['plugin'].append('${TUI_PLUGIN_PATH}')
print(json.dumps(d, indent=2))
")" > "${TUI_CONFIG}"
    printf 'Added mystatus-tui.tsx to %s\n' "${TUI_CONFIG}"
  fi
fi

CONFIG_PKG="${OPENCODE_DIR}/package.json"

if [ -f "${CONFIG_PKG}" ]; then
  python3 -c "
import sys, json
with open('${CONFIG_PKG}') as f:
    d = json.load(f)
deps = d.setdefault('dependencies', {})
for name, version in [
    ('@opencode-ai/plugin', '^1.15.10'),
    ('@opentui/core', '^0.2.15'),
    ('@opentui/solid', '^0.2.15'),
    ('solid-js', '^1.9.12'),
]:
    if name not in deps:
        deps[name] = version
with open('${CONFIG_PKG}', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
"
  printf 'Updated %s with TUI dependencies\n' "${CONFIG_PKG}"
fi

printf 'Local opencode-mystatus plugin copied to %s\n' "${PLUGIN_DIR}"
printf 'Remove "opencode-mystatus" from ~/.config/opencode/opencode.json plugin array if present.\n'
printf 'Remove any ~/.config/opencode/opencode.json command.mystatus entry, then restart OpenCode.\n'
