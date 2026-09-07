import type { Hooks, Plugin } from "@opencode-ai/plugin";

import { getStatusText } from "./lib/status.js";

// ============================================================================
// 插件导出（直接执行模式，绕过 LLM）
// ============================================================================

export const MyStatusPlugin: Plugin = async (ctx) => {
  const v2Ctx = ctx as unknown as {
    command?: {
      transform?: unknown;
    };
  };

  if (typeof v2Ctx.command?.transform === "function") {
    // OpenCode V2: the /mystatus slash command and the quota sidebar are
    // provided by the TUI entrypoint (plugin/mystatus-tui.tsx). V2 plugins
    // cannot inject new commands or intercept command execution, so there is
    // no server-side work to do. V2 setup only accepts void or a cleanup
    // function, so return nothing (the cast only satisfies the V1 Plugin
    // signature below).
    return undefined as unknown as Hooks;
  }

  // OpenCode V1: register the command in config and intercept its execution
  // to inject the status text without an LLM round trip.
  return {
    config: async (cfg) => {
      cfg.command ??= {};
      cfg.command.mystatus = {
        description: "Query quota usage for all AI accounts",
        template: "",
      };
    },
    "command.execute.before": async (input, output) => {
      if (input.command !== "mystatus") return;

      output.parts = [];
      (output as typeof output & { noReply?: boolean }).noReply = true;

      await ctx.client.session.prompt({
        path: { id: input.sessionID },
        body: {
          noReply: true,
          parts: [
            {
              type: "text",
              text: await getStatusText(),
              ignored: true,
            },
          ],
        },
      });
    },
  };
};

export const setup: Plugin = MyStatusPlugin;
export const server: Plugin = MyStatusPlugin;

const pluginModule = {
  id: "opencode-mystatus",
  setup: MyStatusPlugin,
  server: MyStatusPlugin,
  // The TUI entrypoint (plugin/mystatus-tui.tsx) ships with this package;
  // OpenCode V2 loads its `./tui` export when this flag is set.
  tui: true,
};

export default pluginModule;
