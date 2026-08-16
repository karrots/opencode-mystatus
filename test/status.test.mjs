import assert from "node:assert/strict";
import test from "node:test";

process.env.LANG = "en_US.UTF-8";

const { formatStatusResults, getStatusText } = await import(
  "../dist/plugin/lib/status.js"
);

test("formatStatusResults combines successful providers and failures", () => {
  const output = formatStatusResults([
    { title: "## Provider One", result: { success: true, output: "quota ok" } },
    { title: "## Provider Two", result: null },
    { title: "## Provider Three", result: { success: false, error: "failed" } },
  ]);

  assert.match(output, /## Provider One/);
  assert.match(output, /quota ok/);
  assert.match(output, /Failed to query accounts/);
  assert.match(output, /failed/);
});

test("formatStatusResults reports no accounts when every provider is skipped", () => {
  const output = formatStatusResults([
    { title: "## Provider One", result: null },
    { title: "## Provider Two", result: null },
  ]);

  assert.match(output, /No configured accounts found/);
});

test("getStatusText reads auth and passes provider-specific auth data", async () => {
  const calls = [];
  const output = await getStatusText({
    readAuthFile: async () =>
      JSON.stringify({
        openai: { type: "oauth", access: "openai-token" },
        "zhipuai-coding-plan": { type: "api", key: "zhipu-key" },
        "zai-coding-plan": { type: "api", key: "zai-key" },
        synthetic: { type: "api", key: "synthetic-key" },
        "github-copilot": { type: "oauth", refresh: "copilot-refresh" },
      }),
    queryOpenAI: async (authData) => {
      calls.push(["openai", authData?.access]);
      return { success: true, output: "openai quota" };
    },
    queryZhipu: async (authData) => {
      calls.push(["zhipu", authData?.key]);
      return null;
    },
    queryZai: async (authData) => {
      calls.push(["zai", authData?.key]);
      return null;
    },
    querySynthetic: async (authData) => {
      calls.push(["synthetic", authData?.key]);
      return null;
    },
    queryGoogle: async () => {
      calls.push(["google", undefined]);
      return null;
    },
    queryCopilot: async (authData) => {
      calls.push(["copilot", authData?.refresh]);
      return null;
    },
  });

  assert.match(output, /OpenAI Account Quota/);
  assert.match(output, /openai quota/);
  assert.deepEqual(calls, [
    ["openai", "openai-token"],
    ["zhipu", "zhipu-key"],
    ["zai", "zai-key"],
    ["synthetic", "synthetic-key"],
    ["google", undefined],
    ["copilot", "copilot-refresh"],
  ]);
});
