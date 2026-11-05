import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const home = await mkdtemp("/tmp/opencode/quota-test-");
const oldHome = process.env.HOME;
process.env.HOME = home;
process.env.LANG = "en_US.UTF-8";
await mkdir(join(home, ".config/opencode"), { recursive: true });
after(async () => {
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  await rm(home, { recursive: true, force: true });
});
const { queryOpenAIUsage } = await import("../dist/plugin/lib/openai.js");
const { formatStatusResults, sidebarProviders } = await import("../dist/plugin/lib/quota-view.js");
const { queryResultSchema } = await import("../dist/plugin/lib/quota.js");

test("OpenAI retains reported usage and anchors its relative reset to observation time", async (t) => {
  const now = Date.UTC(2026, 8, 13, 12);
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: 3600 },
      secondary_window: null,
      limit_reached: false,
    },
  }));
  const result = await queryOpenAIUsage({ type: "oauth", access: "fixture" });
  assert.equal(result.success, true);
  assert.equal(result.accounts[0].observedAt, now);
  const window = result.accounts[0].windows[0];
  assert.equal(window.remainingPercent, 75);
  assert.equal(window.times[0].at, Date.UTC(2026, 8, 13, 13));
  assert.equal(window.times[0].kind, "reset");
  assert.equal(result.output, undefined);
});

test("Google preserves account identity, missing quota and partial failures", async (t) => {
  const { queryGoogleUsage } = await import("../dist/plugin/lib/google.js");
  await writeFile(join(home, ".config/opencode/antigravity-accounts.json"), JSON.stringify({
    accounts: [
      { email: "first@example.test", refreshToken: "one", projectId: "one" },
      { email: "second@example.test", refreshToken: "two", projectId: "two" },
      { email: "empty@example.test", refreshToken: "three", projectId: "three" },
    ],
  }));
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("oauth2")) return Response.json({ access_token: "fixture" });
    const project = JSON.parse(options.body).project;
    if (project === "two") return new Response("failure", { status: 503 });
    return Response.json({ models: project === "three" ? {} : {
      "gemini-3-pro-high": { quotaInfo: { remainingFraction: 0.75, resetTime: "2026-09-14T00:00:00Z" } },
      "gemini-3-flash": {},
    } });
  });
  const result = await queryGoogleUsage();
  assert.equal(result.success, true);
  assert.equal(result.accounts.length, 3);
  assert.equal(result.accounts[0].name, "first@example.test");
  assert.equal(result.accounts[0].windows[0].remainingPercent, 75);
  assert.equal(result.accounts[0].windows[1].remainingPercent, null);
  assert.match(result.accounts[1].error, /503/);
  assert.deepEqual(result.accounts[2].windows, []);
  for (const language of ["en", "zh"]) {
    const statuses = [{ id: "google", result }];
    assert.match(formatStatusResults(statuses, { language }), /75%/);
    assert.match(JSON.stringify(sidebarProviders(statuses, { language })), /75%/);
  }
  assert.ok(queryResultSchema.safeParse(result).success);
});

test("Synthetic keeps reported recovery times without estimating full recovery", async (t) => {
  const { querySyntheticUsage } = await import("../dist/plugin/lib/synthetic.js");
  t.mock.method(globalThis, "fetch", async () => Response.json({
    subscription: { limit: 500, requests: 125, renewsAt: "2026-11-02T09:17:08.241Z" },
    planWeeklyLimit: { nextRegenAt: "2026-11-02T05:17:44.000Z", percentRemaining: 27.882715276190478, nextRegenPercent: 2 },
    search: { hourly: { requests: 2, limit: 10, renewsAt: "2026-11-02T05:17:08.242Z" } },
  }));
  const result = await querySyntheticUsage({ type: "api", key: "fixture" });
  const windows = result.accounts[0].windows;
  assert.deepEqual(windows.map((window) => window.kind), ["subscription"]);
  assert.equal(windows[0].remainingPercent, 27.9);
  assert.equal(windows[0].used, undefined);
  assert.equal(windows[0].total, undefined);
  assert.deepEqual(windows[0].times, [{ kind: "next-recovery", at: Date.UTC(2026, 10, 2, 5, 17, 44) }]);
  assert.ok(windows.every((window) => window.times.every((time) => time.kind !== "full-recovery")));
  for (const language of ["en", "zh"]) {
    const text = formatStatusResults([{ id: "synthetic", result }], { language });
    assert.match(text, /27\.9%/);
    assert.doesNotMatch(text, /125 \/ 500/);
  }
});

test("Synthetic falls back to subscription requests when no weekly percentage is reported", async (t) => {
  const { querySyntheticUsage } = await import("../dist/plugin/lib/synthetic.js");
  t.mock.method(globalThis, "fetch", async () => Response.json({
    subscription: { limit: 500, requests: 125, renewsAt: "2026-11-02T09:17:08.241Z" },
    search: { hourly: { requests: 2, limit: 10 } },
  }));
  const result = await querySyntheticUsage({ type: "api", key: "fixture" });
  const [window] = result.accounts[0].windows;
  assert.equal(result.accounts[0].windows.length, 1);
  assert.equal(window.remainingPercent, 75);
  assert.equal(window.used, 125);
  assert.equal(window.total, 500);
  assert.equal(window.unit, "requests");
  assert.deepEqual(window.times, [{ kind: "reset", at: Date.UTC(2026, 10, 2, 9, 17, 8, 241) }]);
});

test("Synthetic without a subscription or weekly allowance reports no quota data", async (t) => {
  const { querySyntheticUsage } = await import("../dist/plugin/lib/synthetic.js");
  t.mock.method(globalThis, "fetch", async () => Response.json({
    search: { hourly: { requests: 2, limit: 10 } },
  }));
  const result = await querySyntheticUsage({ type: "api", key: "fixture" });
  assert.deepEqual(result.accounts[0].windows, []);
});

test("Zhipu and Z.ai preserve counts and millisecond resets without inventing unknown usage", async (t) => {
  const { queryZhipuUsage, queryZaiUsage } = await import("../dist/plugin/lib/zhipu.js");
  t.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, code: 200, data: { limits: [
      { type: "TOKENS_LIMIT", usage: 100000, currentValue: 25000, percentage: 25, nextResetTime: Date.UTC(2026, 8, 14) },
      { type: "TIME_LIMIT", usage: 100, currentValue: 0 },
    ] },
  }));
  for (const query of [queryZhipuUsage, queryZaiUsage]) {
    const result = await query({ type: "api", key: "fixture-secret-key" });
    const [tokens, mcp] = result.accounts[0].windows;
    assert.equal(tokens.remainingPercent, 75);
    assert.equal(tokens.used, 25000);
    assert.equal(tokens.times[0].at, Date.UTC(2026, 8, 14));
    assert.equal(mcp.remainingPercent, null);
    assert.equal(mcp.used, 0);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret-key/);
  }
});

test("Copilot exposes unlimited allowances, overage and shared reset without prose parsing", async (t) => {
  const { queryCopilotUsage } = await import("../dist/plugin/lib/copilot.js");
  t.mock.method(globalThis, "fetch", async () => Response.json({
    copilot_plan: "pro", quota_reset_date: "2026-10-01T00:00:00Z",
    quota_snapshots: {
      premium_interactions: { entitlement: 300, remaining: 240, percent_remaining: 80, overage_count: 2 },
      chat: { unlimited: true },
      completions: { entitlement: 100 },
    },
  }));
  const result = await queryCopilotUsage({ type: "oauth", refresh: "fixture" });
  const [premium, chat, completions] = result.accounts[0].windows;
  assert.equal(premium.remainingPercent, 80);
  assert.equal(premium.used, 60);
  assert.equal(premium.overage, 2);
  assert.equal(premium.times[0].at, Date.UTC(2026, 9, 1));
  assert.equal(chat.unlimited, true);
  assert.equal(chat.remainingPercent, null);
  assert.equal(completions.remainingPercent, null);
  const statuses = [{ id: "copilot", result }];
  assert.match(formatStatusResults(statuses), /80%/);
  assert.match(JSON.stringify(sidebarProviders(statuses)), /80%/);
  assert.ok(queryResultSchema.safeParse(result).success);
});

test("Copilot PAT billing retains gross usage, model breakdown and period", async (t) => {
  const { queryCopilotUsage } = await import("../dist/plugin/lib/copilot.js");
  const file = join(home, ".config/opencode/copilot-quota-token.json");
  await writeFile(file, JSON.stringify({ token: "fixture-pat", username: "fixture", tier: "pro" }));
  t.after(() => rm(file, { force: true }));
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /premium_request\/usage/);
    return Response.json({ user: "fixture", timePeriod: { year: 2026, month: 9 }, usageItems: [
      { sku: "Copilot Premium Request", model: "Model A", grossQuantity: 40, netQuantity: 0, unitType: "requests" },
      { sku: "Copilot Premium Request", model: "Model B", grossQuantity: 20, netQuantity: 0, unitType: "requests" },
    ] });
  });
  const result = await queryCopilotUsage({ type: "oauth", refresh: "unused" });
  const account = result.accounts[0];
  assert.equal(account.windows[0].used, 60);
  assert.equal(account.windows[0].total, 300);
  assert.equal(account.windows[0].remainingPercent, 80);
  assert.deepEqual(account.windows[0].times, []);
  assert.equal(account.billingPeriod, "2026-09");
  assert.deepEqual(account.modelUsage, [
    { name: "Model A", used: 40, unit: "requests" },
    { name: "Model B", used: 20, unit: "requests" },
  ]);
  const text = formatStatusResults([{ id: "copilot", result }]);
  assert.match(text, /Model A: 40 requests/);
  assert.match(text, /2026-09/);
  assert.match(JSON.stringify(sidebarProviders([{ id: "copilot", result }])), /80%/);
  assert.ok(queryResultSchema.safeParse(result).success);
});

test("absent providers are omitted but explicitly incomplete credentials remain visible", async (t) => {
  const { queryZhipuUsage, queryZaiUsage } = await import("../dist/plugin/lib/zhipu.js");
  const { querySyntheticUsage } = await import("../dist/plugin/lib/synthetic.js");
  const { queryCopilotUsage } = await import("../dist/plugin/lib/copilot.js");
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not fetch"); });
  for (const query of [queryOpenAIUsage, queryZhipuUsage, queryZaiUsage, querySyntheticUsage, queryCopilotUsage]) {
    assert.equal(await query(undefined), null);
    for (const credential of [null, {}, { type: "unsupported" }]) {
      const result = await query(credential);
      assert.equal(result?.success, false);
      assert.ok(result.error);
    }
  }
});

test("invalid Copilot PAT configuration is an error, not an absent account or OAuth fallback", async (t) => {
  const { queryCopilotUsage } = await import("../dist/plugin/lib/copilot.js");
  const file = join(home, ".config/opencode/copilot-quota-token.json");
  await writeFile(file, '{"token":"secret-do-not-print", "tier":"other"}');
  t.after(() => rm(file, { force: true }));
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not fetch"); });
  const result = await queryCopilotUsage();
  assert.equal(result.success, false);
  assert.match(result.error, /copilot-quota-token.json/);
  assert.doesNotMatch(result.error, /secret-do-not-print/);
});
