/** @jsxImportSource @opentui/solid */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui";
import { createSignal, For, Show, onCleanup } from "solid-js";
import {
  queryProviderStatuses,
  type ProviderStatus,
} from "./lib/status.js";
import type { AuthData } from "./lib/types.js";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const REFRESH_INTERVAL_MS = 60_000;
const AUTH_PATH = join(homedir(), ".local/share/opencode/auth.json");

// Compact label mapping
function abbreviateLabel(label: string): string {
  const lower = label.toLowerCase();
  // OpenAI
  if (lower.includes("7-day") || lower.includes("7天")) return "7d";
  if (lower.includes("5-hour") || lower.includes("5小时")) return "5h";
  if (lower.includes("hour") && !lower.includes("day")) return lower.includes("5") ? "5h" : "Hr";
  // Zhipu
  if (lower.includes("token") && lower.includes("5")) return "5h";
  if (lower.includes("mcp")) return "MCP";
  // Synthetic
  if (lower.includes("week") || lower.includes("每周")) return "Wk";
  if (lower.includes("search") || lower.includes("搜索")) return "Sch";
  if (lower.includes("subscription") || lower.includes("订阅")) return "Sub";
  if (lower.includes("rolling")) return "Roll";
  // Copilot
  if (lower.includes("premium")) return "Prem";
  if (lower.includes("chat")) return "Chat";
  if (lower.includes("comple") || lower.includes("补全")) return "Comp";
  if (lower.includes("overage") || lower.includes("超额")) return "+Ovg";
  // Google
  if (lower.includes("antigravity") || lower.includes("gemini")) return "Gem";
  if (lower.includes("token")) return "Tkn";
  return label.length > 6 ? label.slice(0, 6) : label;
}

function makeProgressBar(percent: number, width: number): string {
  const safe = Math.max(0, Math.min(100, percent));
  const filled = Math.round((safe / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function statusColor(theme: TuiThemeCurrent, percent: number) {
  if (percent > 50) return theme.success;
  if (percent > 20) return theme.warning;
  return theme.error;
}

interface QuotaWindow {
  label: string;
  displayLabel: string;
  remainPercent: number;
  resetText?: string;
}

interface ProviderInfo {
  name: string;
  windows: QuotaWindow[];
  error?: string;
}

function parseProviderStatuses(statuses: ProviderStatus[]): ProviderInfo[] {
  const result: ProviderInfo[] = [];

  for (const status of statuses) {
    const name = status.title.replace(/^##\s*/, "");
    if (!status.result) continue;

    if (!status.result.success && status.result.error) {
      result.push({ name, windows: [], error: status.result.error });
      continue;
    }

    const output = status.result.output || "";
    const windows: QuotaWindow[] = [];
    const lines = output.split("\n");
    let lastLabel = "";

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (
        trimmed &&
        !trimmed.includes("█") &&
        !trimmed.includes("░") &&
        !trimmed.match(/\d+(?:\.\d+)?%/)
      ) {
        if (
          !/^(Account|账号)[：:]/i.test(trimmed) &&
          !/^(Used|已用|Remaining|剩余)[：:]/i.test(trimmed) &&
          !/^(Resets? in|重置[：:])/i.test(trimmed) &&
          !/^(Next Recovery|下次恢复)[：:]/i.test(trimmed) &&
          !/^(Full Recovery|完全恢复)[：:]/i.test(trimmed) &&
          !trimmed.startsWith("⚠") &&
          !trimmed.startsWith("❌")
        ) {
          lastLabel = trimmed;
        }
      }

      const pctMatch = trimmed.match(
        /(\d+(?:\.\d+)?)%\s*(?:remaining|rem|剩余)/i,
      );
      if (pctMatch) {
        const remainPercent = parseFloat(pctMatch[1]);
        let resetText: string | undefined;

        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const next = lines[j].trim();
          if (!next) break;
          const resetMatch = next.match(
            /^(?:Resets? in|重置)[：:]\s*(.+)/im,
          );
          if (resetMatch) {
            resetText = resetMatch[1];
            break;
          }
          const nextRecMatch = next.match(
            /^(?:Next Recovery|下次恢复)[：:]\s*(.+)/im,
          );
          if (nextRecMatch) {
            resetText = nextRecMatch[1];
            break;
          }
        }

        windows.push({
          label: lastLabel,
          displayLabel: abbreviateLabel(lastLabel),
          remainPercent,
          resetText,
        });
      }
    }

    if (windows.length > 0) {
      result.push({ name, windows });
    }
  }

  return result;
}

function useQuotaData() {
  const [providers, setProviders] = createSignal<ProviderInfo[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  let disposed = false;
  let loadVersion = 0;

  const refresh = async () => {
    const currentVersion = ++loadVersion;
    try {
      const raw = await readFile(AUTH_PATH, "utf-8");
      const authData = JSON.parse(raw) as AuthData;
      const statuses = await queryProviderStatuses(authData);
      if (disposed || currentVersion !== loadVersion) return;
      setProviders(parseProviderStatuses(statuses));
      setErrorMsg(null);
    } catch (err) {
      if (disposed || currentVersion !== loadVersion) return;
      setErrorMsg(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      if (!disposed && currentVersion === loadVersion) {
        setLoading(false);
      }
    }
  };

  refresh();
  const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

  onCleanup(() => {
    disposed = true;
    clearInterval(interval);
  });

  return { providers, loading, errorMsg, refresh };
}

function ProviderBlock(props: {
  api: TuiPluginApi;
  info: ProviderInfo;
}) {
  const theme = props.api.theme.current;
  const BAR_WIDTH = 8;

  return (
    <box gap={0} borderStyle="single" borderColor={theme.border} padding={0}>
      {/* Header row: provider name */}
      <text fg={theme.text}>
        <b>{props.info.name}</b>
      </text>

      <For each={props.info.windows}>
        {(w) => {
          const bar = makeProgressBar(w.remainPercent, BAR_WIDTH);
          const pct = `${w.remainPercent}%`;
          const reset = w.resetText ? ` ${w.resetText}` : "";
          const line = `${w.displayLabel} ${bar} ${pct}${reset}`;
          return (
            <text fg={statusColor(theme, w.remainPercent)} marginLeft={1}>
              {line}
            </text>
          );
        }}
      </For>

      <Show when={props.info.error}>
        <text fg={theme.error}>⚠ {props.info.error}</text>
      </Show>
    </box>
  );
}

function QuotaSidebarContent(props: { api: TuiPluginApi }) {
  const { providers, loading, errorMsg } = useQuotaData();
  const theme = props.api.theme.current;

  return (
    <box gap={0} padding={0}>
      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading…</text>
      </Show>
      <Show when={!loading() && errorMsg()}>
        <text fg={theme.error}>⚠ {errorMsg()}</text>
      </Show>
      <Show when={!loading() && !errorMsg() && providers().length === 0}>
        <text fg={theme.textMuted}>No accounts</text>
      </Show>
      <Show when={!loading() && providers().length > 0}>
        <For each={providers()}>
          {(info) => (
            <ProviderBlock api={props.api} info={info} />
          )}
        </For>
      </Show>
    </box>
  );
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(
        _ctx: unknown,
        _props: { session_id: string },
      ) {
        return <QuotaSidebarContent api={api} />;
      },
    },
  });
};

export default { id: "opencode-mystatus-sidebar", tui } satisfies TuiPluginModule;
