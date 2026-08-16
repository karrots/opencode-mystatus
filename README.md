# opencode-mystatus

[![npm version](https://img.shields.io/npm/v/opencode-mystatus.svg)](https://www.npmjs.com/package/opencode-mystatus)
[![npm downloads](https://img.shields.io/npm/dt/opencode-mystatus)](https://www.npmjs.com/package/opencode-mystatus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance, native OpenCode plugin to query and display your AI account quota usage instantly — without routing through an LLM.

Running `/mystatus` directly executes local queries against your accounts, bypassing the AI inference queue for zero-latency, context-free status updates.

## Features

- **Zero-Latency:** Immediate updates instead of waiting on LLM reasoning and generation.
- **Local TUI Display:** Renders beautiful progress bars directly inside your terminal session.
- **No Token Overhead:** Saves API cost and prevents system status data from polluting your AI chat history buffer.
- **Multi-Platform:** Supports OpenAI, Zhipu AI, Z.ai, Synthetic, Google Antigravity, and GitHub Copilot.

## Installation & Setup

### 1. Copy the Local Plugin

Run the local loader from this repository:

```bash
./load-local-plugin.sh
```

The loader copies `plugin/mystatus.ts` and `plugin/lib/*.ts` into `~/.config/opencode/plugins`, where OpenCode auto-discovers local `*.ts` plugins. It also removes stale files from the old `~/.config/opencode/plugin` and `~/.config/opencode/command` locations.

Do not add `opencode-mystatus` to the `plugin` array for local development. Do not configure `command.mystatus` in `~/.config/opencode/opencode.json`; the plugin registers `/mystatus` itself.

### 2. Provide Credentials

The local scripts fetch data using configurations found at these paths:

- **OpenAI Keys:** Configured in `~/.local/share/opencode/auth.json`
- **Copilot / Antigravity Accounts:** Configured in `~/.config/opencode/antigravity-accounts.json`

### 3. Restart OpenCode

OpenCode loads plugins and commands during startup. Fully quit and restart OpenCode after copying or changing this plugin:

```bash
opencode restart
```

## Usage

Simply type `/mystatus` in any active OpenCode session to instantly fetch and print your real-time quota balances!

## Output Example

```
## OpenAI Account Quota

Account:        user@example.com (team)

3-hour limit
██████████████████████████████ 85% remaining
Resets in: 2h 30m

## GitHub Copilot Account Quota

Account:        GitHub Copilot (individual)

Premium        ████░░░░░░░░░░░░░░░░ 24% (229/300)

Quota resets: 19d 0h (2026-02-01)

## Google Cloud Account Quota

### user@gmail.com

G3 Pro     4h 59m     ████████████████████ 100%
G3 Image   4h 59m     ████████████████████ 100%
G3 Flash   4h 59m     ████████████████████ 100%
Claude     2d 9h      ░░░░░░░░░░░░░░░░░░░░ 0%
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT
