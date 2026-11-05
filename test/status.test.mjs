import assert from "node:assert/strict";
import test from "node:test";

process.env.LANG = "en_US.UTF-8";

const { formatStatusResults, getStatusText } =
  await import("../dist/plugin/lib/status.js");

const account = { id: "fixture", name: "quota account", observedAt: 0, windows: [] };

test("formatStatusResults combines successful providers and failures", () => {
  const output = formatStatusResults([
    { id: "openai", result: { success: true, accounts: [account] } },
    { id: "zhipu", result: null },
    { id: "google", result: { success: false, error: "failed" } },
  ]);

  assert.match(output, /## OpenAI/);
  assert.match(output, /quota account/);
  assert.match(output, /Failed to query accounts/);
  assert.match(output, /failed/);
});

test("formatStatusResults reports no accounts when every provider is skipped", () => {
  const output = formatStatusResults([
    { id: "openai", result: null },
    { id: "google", result: null },
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
      return { success: true, accounts: [account] };
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
  assert.match(output, /quota account/);
  assert.deepEqual(calls, [
    ["openai", "openai-token"],
    ["zhipu", "zhipu-key"],
    ["zai", "zai-key"],
    ["synthetic", "synthetic-key"],
    ["google", undefined],
    ["copilot", "copilot-refresh"],
  ]);
});

test("plugin module exports conforms to OpenCode v2 PluginModule structure", async () => {
  const mystatusModule = await import("../dist/plugin/mystatus.js");

  assert.equal(typeof mystatusModule.MyStatusPlugin, "function");
  assert.equal(typeof mystatusModule.setup, "function");
  assert.equal(typeof mystatusModule.server, "function");
  assert.equal(mystatusModule.server, mystatusModule.MyStatusPlugin);
  assert.equal(mystatusModule.setup, mystatusModule.MyStatusPlugin);

  assert.equal(typeof mystatusModule.default, "object");
  assert.equal(mystatusModule.default.id, "opencode-mystatus");
  assert.equal(typeof mystatusModule.default.setup, "function");
  assert.equal(typeof mystatusModule.default.server, "function");
});

test("package.json declares oc-plugin targets and entry points", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf-8"),
  );

  assert.deepEqual(pkg["oc-plugin"], ["server", "tui"]);
  assert.equal(pkg.exports["."].import, "./dist/plugin/mystatus.js");
  assert.equal(pkg.exports["./tui"].import, "./dist/plugin/mystatus-tui.jsx");
});

test("tui module compiled declaration confirms TuiPluginModule structure", async () => {
  const { readFile } = await import("node:fs/promises");
  const dts = await readFile(
    new URL("../dist/plugin/mystatus-tui.d.ts", import.meta.url),
    "utf-8",
  );

  assert.match(dts, /export declare const setup: TuiPlugin;/);
  assert.match(dts, /export declare const tui: TuiPlugin;/);
  assert.match(dts, /setup:\s*TuiPlugin;/);
  assert.match(dts, /tui:\s*TuiPlugin;/);
  assert.match(dts, /export default _default;/);
});
