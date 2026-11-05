import assert from "node:assert/strict";
import test from "node:test";
import plugin from "../dist/plugin/mystatus.js";
import { quotaRpc, remoteSyntheticQuery, quotaDependencies } from "../dist/plugin/lib/openai-rpc.js";
import { getProviderStatuses, getStatusText } from "../dist/plugin/lib/status.js";
import { sidebarProviders } from "../dist/plugin/lib/quota-view.js";

async function register(connection) {
  let handlers;
  let definition;
  let disposed = false;
  const cleanup = await plugin.setup({
    command: { transform() {} },
    integration: { connection },
    rpc: { register: async (schema, implementation) => {
      definition = schema;
      handlers = implementation;
      return { dispose: async () => { disposed = true; } };
    } },
  });
  return { handlers, definition, cleanup, disposed: () => disposed };
}

const quotaResponse = {
  subscription: { limit: 100, requests: 25, renewsAt: "2026-11-02T09:17:08.241Z" },
};

test("Synthetic quota RPC resolves the active server API key on each refresh", async (t) => {
  let account = "first";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization });
    return Response.json(quotaResponse);
  });
  const host = await register({
    active: async (id) => {
      assert.equal(id, "synthetic");
      return { id: account };
    },
    resolve: async (connection) => ({ type: "key", key: `secret-${connection.id}` }),
  });
  assert.equal(host.definition, quotaRpc);
  assert.ok(host.definition.methods.synthetic);
  const result = await host.handlers.synthetic({ version: 2 });
  assert.equal(result.success, true);
  assert.equal(result.accounts[0].windows[0].remainingPercent, 75);
  assert.doesNotMatch(JSON.stringify(result), /secret-/);
  account = "second";
  await host.handlers.synthetic({ version: 2 });
  assert.deepEqual(requests, ["first", "second"].map((id) => ({
    url: "https://api.synthetic.new/v2/quotas",
    authorization: `Bearer secret-${id}`,
  })));
  await host.cleanup();
  assert.equal(host.disposed(), true);
});

test("Synthetic missing account is skipped; broken credentials are actionable and sanitized", async () => {
  const absent = await register({ active: async () => undefined, resolve: async () => { throw new Error("must not resolve"); } });
  assert.equal(await absent.handlers.synthetic({ version: 2 }), null);
  for (const credential of [undefined, { type: "oauth", access: "secret-token" }, { type: "key", key: " " }]) {
    const host = await register({ active: async () => ({ id: "active" }), resolve: async () => credential });
    const result = await host.handlers.synthetic({ version: 2 });
    assert.equal(result.success, false);
    assert.match(result.error, /Synthetic.*\/connect/);
    assert.doesNotMatch(result.error, /secret-token/);
  }
  const broken = await register({ active: async () => ({ id: "active" }), resolve: async () => { throw new Error("secret-host-detail"); } });
  const result = await broken.handlers.synthetic({ version: 2 });
  assert.equal(result.success, false);
  assert.match(result.error, /Synthetic.*\/connect/);
  assert.doesNotMatch(result.error, /secret-host-detail/);
});

test("Synthetic concurrent refreshes share one operation and reject old protocol versions", async (t) => {
  let resolves = 0;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json(quotaResponse); });
  const host = await register({
    active: async () => ({ id: "active" }),
    resolve: async () => { resolves++; return { type: "key", key: "secret-key" }; },
  });
  const incompatible = await host.handlers.synthetic({});
  assert.equal(incompatible.success, false);
  assert.match(incompatible.error, /incompatible/);
  assert.equal(resolves, 0);
  const [first, second] = await Promise.all([
    host.handlers.synthetic({ version: 2 }), host.handlers.synthetic({ version: 2 }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(resolves, 2, "each caller resolves the current active credential");
  assert.equal(requests, 1, "same-key concurrent requests coalesce");
  await host.handlers.synthetic({ version: 2 });
  assert.equal(resolves, 3);
  assert.equal(requests, 2);
});

test("V2 sidebar and command show Synthetic without legacy auth and ignore stale local keys", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quotaResponse));
  const host = await register({
    active: async (id) => id === "synthetic" ? { id: "active" } : undefined,
    resolve: async () => ({ type: "key", key: "server-secret" }),
  });
  const location = { directory: "/project" };
  const deps = quotaDependencies({
    ui: { slot() {} }, location,
    client: { rpc: (definition) => {
      assert.equal(definition, quotaRpc);
      return {
        openai: host.handlers.openai,
        synthetic: async (input, options) => {
          assert.deepEqual(input, { version: 2 });
          assert.deepEqual(options, { location });
          return host.handlers.synthetic(input);
        },
      };
    } },
  });
  const skip = async () => null;
  for (const readAuthFile of [
    async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    async () => JSON.stringify({ synthetic: { type: "api", key: "stale-secret" } }),
  ]) {
    const overrides = { ...deps, readAuthFile, queryZhipu: skip, queryZai: skip, queryGoogle: skip, queryCopilot: skip };
    const statuses = await getProviderStatuses(overrides);
    assert.equal(statuses.find((status) => status.id === "synthetic").result.success, true);
    const sidebar = sidebarProviders(statuses, { now: Date.now() });
    assert.ok(sidebar.some((provider) => provider.id === "synthetic"));
    const output = await getStatusText(overrides);
    assert.match(output, /Synthetic/);
    assert.match(output, /75%/);
    assert.doesNotMatch(output, /server-secret|stale-secret/);
  }
  assert.deepEqual(quotaDependencies({ slots: { register() {} } }), {}, "V1 retains local credential queries");
});

test("Synthetic account switches do not reuse another account's in-flight quota", async (t) => {
  let account = "first";
  let releaseFirst;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const authorization = options.headers.Authorization;
    requests.push(authorization);
    if (authorization === "Bearer secret-first") {
      markStarted();
      return firstResponse;
    }
    return Response.json({ subscription: { limit: 100, requests: 80 } });
  });
  const host = await register({
    active: async () => ({ id: account }),
    resolve: async (connection) => ({ type: "key", key: `secret-${connection.id}` }),
  });
  const first = host.handlers.synthetic({ version: 2 });
  await started;
  account = "second";
  const second = host.handlers.synthetic({ version: 2 });
  releaseFirst(Response.json(quotaResponse));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.accounts[0].windows[0].remainingPercent, 75);
  assert.equal(b.accounts[0].windows[0].remainingPercent, 20);
  assert.deepEqual(requests, ["Bearer secret-first", "Bearer secret-second"]);
});

test("Synthetic client rejects old prose and unavailable RPC without local fallback", async () => {
  for (const response of [{ success: true, output: "75% remaining" }, { success: true, accounts: [], key: "secret-key" }]) {
    const result = await remoteSyntheticQuery({ rpc: () => ({ synthetic: async () => response }) }, () => undefined)();
    assert.equal(result.success, false);
    assert.match(result.error, /incompatible/);
    assert.doesNotMatch(JSON.stringify(result), /secret-key/);
  }
  const unavailable = await remoteSyntheticQuery({ rpc: () => { throw new Error("secret-host-detail"); } }, () => undefined)();
  assert.equal(unavailable.success, false);
  assert.match(unavailable.error, /Synthetic.*unavailable/);
  assert.doesNotMatch(unavailable.error, /secret-host-detail/);
});

test("Synthetic quota RPC does not echo provider error bodies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("secret-key-echo", { status: 401 }));
  const host = await register({ active: async () => ({ id: "active" }), resolve: async () => ({ type: "key", key: "secret-key" }) });
  const result = await host.handlers.synthetic({ version: 2 });
  assert.equal(result.success, false);
  assert.match(result.error, /401/);
  assert.doesNotMatch(result.error, /secret-key/);
});
