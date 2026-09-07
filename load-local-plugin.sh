#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="${HOME}/.config/opencode"
PLUGIN_DIR="${OPENCODE_DIR}/plugins"
V2_PLUGIN_DIR="${PLUGIN_DIR}/opencode-mystatus"
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
rm -f "${OLD_PLUGIN_DIR}/lib/status.ts"
rm -rf "${OLD_PLUGIN_DIR}"
rm -f "${OLD_COMMAND_DIR}/mystatus.md"
# V2 resolves local plugins as directories with a `tui` entrypoint.
mkdir -p "${V2_PLUGIN_DIR}/lib"
cp "${SCRIPT_DIR}/plugin/mystatus-tui.tsx" "${V2_PLUGIN_DIR}/tui.tsx"
cp "${SCRIPT_DIR}/plugin/lib/"*.ts "${V2_PLUGIN_DIR}/lib/"

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

# OpenCode V2 (opencode2) reads the TUI plugin entry from cli.json
CLI_CONFIG="${OPENCODE_DIR}/cli.json"

python3 - "${CLI_CONFIG}" <<'PYCONFIG'
import json
import sys
from pathlib import Path

config = Path(sys.argv[1])
d = json.loads(config.read_text()) if config.exists() else {}
old = "./plugins/mystatus-tui.tsx"
new = "./plugins/opencode-mystatus"
entries = []
for entry in d.get("plugins", []):
    if entry == old:
        entry = new
    elif isinstance(entry, dict) and entry.get("package") == old:
        entry = {**entry, "package": new}
    if entry not in entries:
        entries.append(entry)
if not any(entry == new or isinstance(entry, dict) and entry.get("package") == new for entry in entries):
    entries.append(new)
d["plugins"] = entries
config.write_text(json.dumps(d, indent=2) + "\n")
PYCONFIG
printf 'Configured MyStatus TUI directory in %s\n' "${CLI_CONFIG}"

CONFIG_PKG="${OPENCODE_DIR}/package.json"

if [ -f "${CONFIG_PKG}" ]; then
  python3 -c "
import json
with open('${CONFIG_PKG}') as f:
    d = json.load(f)
deps = d.setdefault('dependencies', {})
# @opentui versions must match the OpenCode V2 host (>= 0.5.x); always refresh
# them because older 0.2.x releases are incompatible with the V2 renderer.
deps['@opentui/core'] = '^0.5.6'
deps['@opentui/solid'] = '^0.5.6'
deps.setdefault('solid-js', '^1.9.12')
deps.setdefault('@opencode-ai/plugin', '^1.15.10')
with open('${CONFIG_PKG}', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
"
  printf 'Updated %s with TUI dependencies\n' "${CONFIG_PKG}"
  (cd "${OPENCODE_DIR}" && npm install --no-audit --no-fund --loglevel=error)
fi

printf 'Local opencode-mystatus plugin copied to %s\n' "${PLUGIN_DIR}"
printf 'Remove "opencode-mystatus" from ~/.config/opencode/opencode.json plugin array if present.\n'
printf 'Remove any ~/.config/opencode/opencode.json command.mystatus entry.\n'
printf 'Quit and reopen the OpenCode TUI to reload the sidebar plugin.\n'
