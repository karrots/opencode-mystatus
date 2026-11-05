import assert from "node:assert/strict";
import test from "node:test";
import plugin from "../dist/plugin/mystatus.js";

test("V2 quota RPC uses the current host credential and never returns tokens", async (t) => {
  let handlers;
  let account = "first";
  let resolves = 0;
  let disposed = false;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, headers: options.headers });
    return Response.json({
      plan_type: "plus",
      rate_limit: {
        limit_reached: false,
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 18000,
          reset_after_seconds: 60,
        },
        secondary_window: null,
      },
    });
  });
  const cleanup = await plugin.setup({
    command: { transform() {} },
    integration: {
      connection: {
        active: async (id) => {
          assert.equal(id, "openai");
          return { id: account };
        },
        resolve: async (connection) => {
          resolves++;
          return {
            type: "oauth",
            access: `secret-${connection.id}`,
            refresh: "secret-refresh",
            metadata: { accountID: `account-${connection.id}` },
          };
        },
      },
    },
    rpc: {
      register: async (_definition, implementation) => {
        handlers = implementation;
        return {
          dispose: async () => {
            disposed = true;
          },
        };
      },
    },
  });
  assert.equal(
    typeof handlers?.openai,
    "function",
    "V2 must register an OpenAI quota RPC",
  );
  const result = await handlers.openai({ version: 2 });
  assert.equal(result.success, true);
  assert.equal(result.accounts[0].windows[0].remainingPercent, 75);
  assert.doesNotMatch(JSON.stringify(result), /secret-/);
  assert.equal(calls[0].headers.Authorization, "Bearer secret-first");
  assert.equal(calls[0].headers["ChatGPT-Account-Id"], "account-first");
  account = "second";
  await handlers.openai({ version: 2 });
  assert.equal(resolves, 2);
  assert.equal(calls[1].headers.Authorization, "Bearer secret-second");
  await cleanup();
  assert.equal(disposed, true);
});

test("V2 credential errors are visible without disclosing host error details", async () => {
  let handlers;
  await plugin.setup({
    command: { transform() {} },
    integration: {
      connection: {
        active: async () => {
          throw new Error("secret-refresh");
        },
        resolve: async () => undefined,
      },
    },
    rpc: {
      register: async (_definition, implementation) => {
        handlers = implementation;
        return { dispose: async () => {} };
      },
    },
  });
  assert.equal(typeof handlers?.openai, "function");
  const result = await handlers.openai({ version: 2 });
  assert.equal(result.success, false);
  assert.match(result.error, /OpenAI/);
  assert.doesNotMatch(result.error, /secret-refresh/);
});

test("sidebar and command queries use server OAuth even when auth.json is absent", async () => {
  const { remoteOpenAIQuery, quotaRpc } =
    await import("../dist/plugin/lib/openai-rpc.js");
  const { getStatusText } = await import("../dist/plugin/lib/status.js");
  const queryOpenAI = remoteOpenAIQuery(
    {
      rpc(definition) {
        assert.equal(definition, quotaRpc);
        return {
          async openai(input, options) {
            assert.deepEqual(input, { version: 2 });
            assert.deepEqual(options.location, { directory: "/project" });
            return {
              success: true,
              accounts: [{ id: "active", name: "active server account", observedAt: Date.now(), windows: [
                { id: "primary", kind: "window", durationSeconds: 18000, unlimited: false, remainingPercent: 75, times: [] },
              ] }],
            };
          },
        };
      },
    },
    () => ({ directory: "/project" }),
  );
  const skip = async () => null;
  const output = await getStatusText({
    readAuthFile: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    queryOpenAI,
    queryZhipu: skip,
    queryZai: skip,
    querySynthetic: skip,
    queryGoogle: skip,
    queryCopilot: skip,
  });
  assert.match(output, /75% remaining/);
});

test("old TUI receives an explicit mismatch and new TUI rejects old prose", async () => {
  const { registerOpenAIQuota, remoteOpenAIQuery } = await import("../dist/plugin/lib/openai-rpc.js");
  let handlers;
  await registerOpenAIQuota({
    integration: { connection: { active: async () => { throw new Error("must not resolve credentials"); }, resolve: async () => undefined } },
    rpc: { register: async (_definition, implementation) => { handlers = implementation; return { dispose: async () => {} }; } },
  });
  const oldClientResult = await handlers.openai({});
  assert.equal(oldClientResult.success, false);
  assert.match(oldClientResult.error, /incompatible.*server.*TUI/i);
  const query = remoteOpenAIQuery({ rpc: () => ({ openai: async () => ({ success: true, output: "75% remaining" }) }) }, () => undefined);
  const oldServerResult = await query();
  assert.equal(oldServerResult.success, false);
  assert.match(oldServerResult.error, /incompatible.*server.*TUI/i);
});

test("RPC failure reports unavailable instead of using a stale local token", async () => {
  const { remoteOpenAIQuery } =
    await import("../dist/plugin/lib/openai-rpc.js");
  const query = remoteOpenAIQuery(
    {
      rpc() {
        throw new Error("secret-host-detail");
      },
    },
    () => undefined,
  );
  const result = await query();
  assert.equal(result.success, false);
  assert.match(result.error, /service unavailable/);
  assert.doesNotMatch(JSON.stringify(result), /secret-host-detail/);
});

test("HTTP errors do not echo provider response bodies into quota RPC", async (t) => {
  const { queryOpenAIUsage } = await import("../dist/plugin/lib/openai.js");
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("secret-token-echo", { status: 401 }),
  );
  const result = await queryOpenAIUsage({ type: "oauth", access: "fixture" });
  assert.equal(result.success, false);
  assert.match(result.error, /401/);
  assert.doesNotMatch(result.error, /secret-token-echo/);
});
