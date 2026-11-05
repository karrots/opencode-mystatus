/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { RGBA } from "@opentui/core";
import { createSignal, createMemo, For, Show, onCleanup } from "solid-js";
import {
  getStatusText,
  getProviderStatuses,
  type ProviderStatus,
} from "./lib/status.js";
import { quotaDependencies, type QuotaRpcClient } from "./lib/openai-rpc.js";
import { sidebarProviders, type SidebarProvider, type QuotaLine } from "./lib/quota-view.js";
import { applyQuotaRefresh } from "./lib/quota.js";
import { resolveQuotaTheme, type QuotaTheme } from "./lib/quota-theme.js";

const REFRESH_INTERVAL_MS = 60_000;

// ============================================================================
// 主题（兼容 OpenCode V1 / V2 两种主题结构）
// ============================================================================

function statusColor(theme: QuotaTheme, tone: QuotaLine["tone"]): RGBA | undefined {
  return tone === "normal" ? theme.text : theme[tone];
}

// ============================================================================
// 数据解析
// ============================================================================

function useQuotaData(host: unknown) {
  const [statuses, setStatuses] = createSignal<ProviderStatus[]>([]);
  const [now, setNow] = createSignal(Date.now());
  const providers = createMemo(() => sidebarProviders(statuses(), { now: now() }));
  const [loading, setLoading] = createSignal(true);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  let disposed = false;
  let loadVersion = 0;

  const refresh = async () => {
    const currentVersion = ++loadVersion;
    try {
      const statuses = await getProviderStatuses(quotaDependencies(host));
      if (disposed || currentVersion !== loadVersion) return;
      setStatuses((previous) => applyQuotaRefresh(previous, statuses));
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
  // Advance presentation time only. Quota values change on successful reads.
  const clock = setInterval(() => setNow(Date.now()), 1_000);

  onCleanup(() => {
    disposed = true;
    clearInterval(interval);
    clearInterval(clock);
  });

  return { providers, loading, errorMsg, refresh };
}

// ============================================================================
// 侧边栏 UI
// ============================================================================

function ProviderBlock(props: { theme: QuotaTheme; info: SidebarProvider }) {
  const theme = props.theme;

  return (
    <box gap={0} borderStyle="single" borderColor={theme.border} padding={0}>
      {/* Header row: provider name */}
      <text fg={theme.text}>
        <b>{props.info.title}</b>
      </text>

      <For each={props.info.accounts}>
        {(account) => <box gap={0} marginLeft={1}>
          <Show when={account.name}><text fg={theme.muted}>{account.name}</text></Show>
          <For each={account.lines}>{(line) => <text fg={statusColor(theme, line.tone)}>{line.text}</text>}</For>
        </box>}
      </For>

      <Show when={props.info.error}>
        <text fg={theme.error}>⚠ {props.info.error}</text>
      </Show>
    </box>
  );
}

function QuotaSidebarContent(props: { host: unknown }) {
  const { providers, loading, errorMsg } = useQuotaData(props.host);
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
    dialog: {
      alert: (options: { title: string; message: string }) => Promise<unknown>;
    };
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
  };
  keymap?: {
    layer: (input: () => unknown) => unknown;
  };
  client: QuotaRpcClient;
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
  // Runs the quota query and displays it without adding a session message.
  const release = ctx.keymap?.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "mystatus.run",
        title: "MyStatus",
        description: "Query quota usage for all AI accounts",
        slash: { name: "mystatus" },
        run: async () => {
          try {
            const text = await getStatusText(quotaDependencies(ctx));
            await ctx.ui.dialog.alert({
              title: "Usage",
              message: text,
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
