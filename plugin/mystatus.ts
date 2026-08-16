import type { Plugin } from "@opencode-ai/plugin";

import { getStatusText } from "./lib/status.js";

// ============================================================================
// 插件导出（直接执行模式，绕过 LLM）
// ============================================================================

export const MyStatusPlugin: Plugin = async (ctx) => {
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

export default MyStatusPlugin;
