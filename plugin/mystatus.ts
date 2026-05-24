import type { Plugin } from "@opencode-ai/plugin";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { t } from "./lib/i18n";
import { type AuthData } from "./lib/types";
import { queryOpenAIUsage } from "./lib/openai";
import { querySyntheticUsage } from "./lib/synthetic";
import { queryZaiUsage, queryZhipuUsage } from "./lib/zhipu";
import { queryGoogleUsage } from "./lib/google";
import { queryCopilotUsage } from "./lib/copilot";

// ============================================================================
// 插件导出（直接执行模式，绕过 LLM）
// ============================================================================

export const MyStatusPlugin: Plugin = async (ctx) => {
  return {
    event: async ({ event }) => {
      // Intercept the /mystatus slash command
      if (
        event.type === "tui.command.execute" &&
        "properties" in event &&
        (event.properties as { command?: string }).command === "mystatus"
      ) {
        // Show a native loading toast in the OpenCode TUI
        await ctx.client.tui.showToast({
          body: {
            message: "Fetching AI Quotas...",
            variant: "info",
          },
        });

        try {
          // 1. Read auth.json
          const authPath = join(homedir(), ".local/share/opencode/auth.json");
          let authData: AuthData;

          try {
            const content = await readFile(authPath, "utf-8");
            authData = JSON.parse(content);
          } catch (err) {
            process.stderr.write(
              `\n${t.authError(authPath, err instanceof Error ? err.message : String(err))}\n`,
            );
            return;
          }

          // 2. Parallel query all platforms (Google does not depend on authData)
          const [
            openaiResult,
            zhipuResult,
            zaiResult,
            syntheticResult,
            googleResult,
            copilotResult,
          ] = await Promise.all([
            queryOpenAIUsage(authData.openai),
            queryZhipuUsage(authData["zhipuai-coding-plan"]),
            queryZaiUsage(authData["zai-coding-plan"]),
            querySyntheticUsage(authData.synthetic),
            queryGoogleUsage(),
            queryCopilotUsage(authData["github-copilot"]),
          ]);

          // 3. Collect results
          const results: string[] = [];
          const errors: string[] = [];

          collectResult(openaiResult, t.openaiTitle, results, errors);
          collectResult(zhipuResult, t.zhipuTitle, results, errors);
          collectResult(zaiResult, t.zaiTitle, results, errors);
          collectResult(syntheticResult, t.syntheticTitle, results, errors);
          collectResult(googleResult, t.googleTitle, results, errors);
          collectResult(copilotResult, t.copilotTitle, results, errors);

          // 4. Output directly to stdout, bypassing the LLM stream
          if (results.length === 0 && errors.length === 0) {
            process.stdout.write("\n" + t.noAccounts + "\n");
            return;
          }

          let output = results.join("\n");

          if (errors.length > 0) {
            if (output) output += "\n\n";
            output += t.queryFailed + errors.join("\n");
          }

          process.stdout.write("\n" + output + "\n");
        } catch (error) {
          process.stderr.write(
            `\nError fetching status: ${(error as Error).message}\n`,
          );
        }
      }
    },
  };
};

export default MyStatusPlugin;

// ============================================================================
// Internal helpers
// ============================================================================

function collectResult(
  result: import("./lib/types").QueryResult | null,
  title: string,
  results: string[],
  errors: string[],
): void {
  if (!result) return;

  if (result.success && result.output) {
    if (results.length > 0) results.push(""); // separator
    results.push(title);
    results.push("");
    results.push(result.output);
  } else if (result.error) {
    errors.push(result.error);
  }
}
