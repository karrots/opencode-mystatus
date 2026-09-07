/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { RGBA } from "@opentui/core";
import { createSignal, For, Show, onCleanup } from "solid-js";
import {
  getStatusText,
  queryProviderStatuses,
  type ProviderStatus,
} from "./lib/status.js";
import type { AuthData } from "./lib/types.js";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const REFRESH_INTERVAL_MS = 60_000;
const AUTH_PATH = join(homedir(), ".local/share/opencode/auth.json");

// ============================================================================
// 主题（兼容 OpenCode V1 / V2 两种主题结构）
// ============================================================================

interface QuotaTheme {
  text: RGBA | undefined;
  muted: RGBA | undefined;
  border: RGBA | undefined;
  success: RGBA | undefined;
  warning: RGBA | undefined;
  error: RGBA | undefined;
}

/** Nested (V2) shape of the `text` token group in a ResolvedTheme. */
interface V2TextTokens {
  default: RGBA;
  subdued: RGBA;
  feedback: {
    success: { default: RGBA };
    warning: { default: RGBA };
    error: { default: RGBA };
  };
}

/** Union of the flat (V1) and nested (V2) raw theme shapes. */
type RawThemeTokens = {
  text?: V2TextTokens | RGBA;
  border?: { default: RGBA } | RGBA;
  textMuted?: RGBA;
  success?: RGBA;
  warning?: RGBA;
  error?: RGBA;
};

/**
 * Normalizes host theme tokens to the colors used by the sidebar.
 *
 * OpenCode V1 exposes a flat theme on `api.theme.current` (`text`,
 * `textMuted`, `success`, ...). OpenCode V2 exposes nested resolved tokens on
 * `ctx.theme` (`text.default`, `text.subdued`, `text.feedback.success.default`,
 * ...). Both resolve to opentui RGBA colors.
 */
function resolveQuotaTheme(api: unknown): QuotaTheme {
  const host = api as { theme?: unknown } | undefined;
  const raw =
    (host?.theme as { current?: unknown } | undefined)?.current ?? host?.theme;
  const t = raw as RawThemeTokens | undefined;
  const text = t?.text;
  const border = t?.border;
  const borderValue = border && "default" in border ? border.default : border;

  if (text && "default" in text) {
    // OpenCode V2: nested ResolvedTheme tokens
    return {
      text: text.default,
      muted: text.subdued,
      border: borderValue,
      success: text.feedback.success.default,
      warning: text.feedback.warning.default,
      error: text.feedback.error.default,
    };
  }
  // OpenCode V1: flat theme tokens
  return {
    text,
    muted: t?.textMuted,
    border: borderValue,
    success: t?.success,
    warning: t?.warning,
    error: t?.error,
  };
}

function statusColor(theme: QuotaTheme, percent: number): RGBA | undefined {
  if (percent > 50) return theme.success;
  if (percent > 20) return theme.warning;
  return theme.error;
}

// ============================================================================
// 数据解析
// ============================================================================

// Compact label mapping
function abbreviateLabel(label: string): string {
  const lower = label.toLowerCase();
  // OpenAI
  if (lower.includes("7-day") || lower.includes("7天")) return "7d";
  if (lower.includes("5-hour") || lower.includes("5小时")) return "5h";
  if (lower.includes("hour") && !lower.includes("day"))
    return lower.includes("5") ? "5h" : "Hr";
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
          const resetMatch = next.match(/^(?:Resets? in|重置)[：:]\s*(.+)/im);
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
      setErrorMsg(err instanceof Error ? err.message : String(err));
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

// ============================================================================
// 侧边栏 UI
// ============================================================================

function ProviderBlock(props: { theme: QuotaTheme; info: ProviderInfo }) {
  const theme = props.theme;
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

function QuotaSidebarContent(props: { host: unknown }) {
  const { providers, loading, errorMsg } = useQuotaData();
  const theme = resolveQuotaTheme(props.host);

  return (
    <box gap={0} padding={0}>
      <Show when={loading()}>
        <text fg={theme.muted}>Loading…</text>
      </Show>
      <Show when={!loading() && errorMsg()}>
        <text fg={theme.error}>⚠ {errorMsg()}</text>
      </Show>
      <Show when={!loading() && !errorMsg() && providers().length === 0}>
        <text fg={theme.muted}>No accounts</text>
      </Show>
      <Show when={!loading() && providers().length > 0}>
        <For each={providers()}>
          {(info) => <ProviderBlock theme={theme} info={info} />}
        </For>
      </Show>
    </box>
  );
}

// ============================================================================
// OpenCode V2 (opencode2) 插件入口
// ============================================================================

/**
 * Structural view of the OpenCode V2 TUI plugin context. Only the members
 * used by this plugin are declared; the V2 API is still beta and may change.
 */
interface V2TuiContext {
  theme: unknown;
  ui: {
    slot: (claim: {
      append: string;
      render: (input: { sessionID?: string }) => unknown;
    }) => () => void;
    toast: {
      show: (options: {
        title?: string;
        message: string;
        variant?: "info" | "success" | "warning" | "error";
      }) => void;
    };
    router: {
      current: () => { type: string; sessionID?: string };
    };
  };
  keymap?: {
    layer: (input: () => unknown) => unknown;
  };
  client: {
    session: {
      synthetic: (input: {
        sessionID: string;
        text: { text: string };
      }) => Promise<unknown>;
    };
  };
}

/**
 * Invisible component that keeps the /mystatus keymap layer alive.
 *
 * `ctx.keymap.layer` is a Solid hook: it reads the host's Keymap.Provider
 * context, so it may only be called from inside a component mounted in the
 * app tree — never from `setup`. Claiming the always-mounted root `app` slot
 * keeps the command available for the whole TUI lifetime (claiming only
 * `sidebar.content` would drop it whenever the sidebar is not shown).
 */
function MystatusCommandLayer(props: { ctx: V2TuiContext }) {
  const ctx = props.ctx;
  // Runs the local quota query and posts the result as a synthetic session
  // message (no LLM round trip, no token cost).
  const release = ctx.keymap?.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "mystatus.run",
        title: "MyStatus",
        description: "Query quota usage for all AI accounts",
        slash: { name: "mystatus" },
        run: async () => {
          const route = ctx.ui.router.current();
          if (!route || route.type !== "session" || !route.sessionID) {
            ctx.ui.toast.show({
              variant: "warning",
              title: "MyStatus",
              message: "Open a session first, then run /mystatus.",
            });
            return false;
          }
          try {
            const text = await getStatusText();
            await ctx.client.session.synthetic({
              sessionID: route.sessionID,
              text: { text },
            });
          } catch (err) {
            ctx.ui.toast.show({
              variant: "error",
              title: "MyStatus",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        },
      },
    ],
  }));
  onCleanup(() => {
    if (typeof release === "function") {
      try {
        (release as () => void)();
      } catch {
        // A failed release must not break unmount
      }
    }
  });
  return <box visible={false} />;
}

function setupV2(ctx: V2TuiContext): (() => void) | void {
  const releases: Array<() => void> = [];

  // /mystatus slash command, mounted on the always-visible root `app` slot.
  if (typeof ctx.keymap?.layer === "function") {
    releases.push(
      ctx.ui.slot({
        append: "app",
        render: () => <MystatusCommandLayer ctx={ctx} />,
      }),
    );
  }

  // Quota sidebar, appended to the session sidebar content slot.
  releases.push(
    ctx.ui.slot({
      append: "sidebar.content",
      render: () => <QuotaSidebarContent host={ctx} />,
    }),
  );

  return () => {
    for (const release of releases) {
      try {
        release();
      } catch {
        // A failed release must not break plugin unload
      }
    }
  };
}

// ============================================================================
// OpenCode V1 (opencode) 插件入口
// ============================================================================

function setupV1(api: TuiPluginApi): void {
  if (!api.slots?.register) return;

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx: unknown, _props: { session_id: string }) {
        return <QuotaSidebarContent host={api} />;
      },
    },
  });
}

// ============================================================================
// 插件导出（直接执行模式，绕过 LLM）
// ============================================================================

/**
 * TUI plugin entry for both OpenCode versions.
 *
 * - OpenCode V2 (`opencode2`): the default export is `{ id, setup }`; `setup`
 *   receives the V2 context, claims `sidebar.content` and `app` via
 *   `ctx.ui.slot`, and registers the `/mystatus` slash command from a
 *   component mounted on the root `app` slot (keymap layers are Solid
 *   context hooks and cannot be created inside `setup`).
 * - OpenCode V1 (`opencode`): `setup` receives the V1 `TuiPluginApi` and
 *   registers the sidebar via `api.slots.register`.
 *
 * The setup function must never throw for an unknown host: a failing TUI
 * plugin aborts TUI startup.
 */
export const tui: TuiPlugin = (async (api: TuiPluginApi) => {
  if (!api) return;
  const host = api as unknown as {
    ui?: { slot?: unknown };
    slots?: { register?: unknown };
  };

  if (typeof host.ui?.slot === "function") {
    return setupV2(api as unknown as V2TuiContext);
  }

  if (typeof host.slots?.register === "function") {
    setupV1(api);
  }
}) as unknown as TuiPlugin;

export const setup: TuiPlugin = tui;

export default {
  id: "opencode-mystatus-sidebar",
  setup: tui,
  tui,
};
