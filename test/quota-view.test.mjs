import assert from "node:assert/strict";
import test from "node:test";

test("both presentations retain Google quota and explicit states in English and Chinese", async () => {
  const { formatStatusResults, sidebarProviders } = await import("../dist/plugin/lib/quota-view.js");
  const now = Date.UTC(2026, 8, 13, 12);
  const statuses = [{ id: "google", result: { success: true, accounts: [
    { id: "one", name: "one@example.test", observedAt: now, windows: [
      { id: "pro", kind: "model", name: "G3 Pro", unlimited: false, remainingPercent: 75, times: [{ kind: "reset", at: now + 3600000 }] },
      { id: "claude", kind: "model", name: "Claude", unlimited: true, remainingPercent: null, times: [] },
    ] },
    { id: "two", name: "two@example.test", observedAt: now, windows: [], error: "Account refresh failed" },
    { id: "three", name: "three@example.test", observedAt: now, windows: [] },
  ] } }];
  for (const language of ["en", "zh"]) {
    const options = { now, language, timeZone: "UTC" };
    const text = formatStatusResults(statuses, options);
    const sidebar = sidebarProviders(statuses, options);
    const compact = JSON.stringify(sidebar);
    assert.match(text, /75%/);
    assert.match(compact, /75%/);
    assert.match(text, /G3 Pro/);
    assert.match(compact, /G3 Pro/);
    assert.match(text, /13:00|1:00/);
    assert.doesNotMatch(compact, /13:00|1:00/);
    for (const value of ["one@example.test", "two@example.test", "three@example.test", "Account refresh failed"]) {
      assert.ok(text.includes(value));
      assert.ok(compact.includes(value));
    }
    assert.match(text, language === "en" ? /Unlimited/ : /无限/);
    assert.match(compact, language === "en" ? /No quota data/ : /暂无配额数据/);
  }
});

test("elapsed time never resets usage and failed refreshes retain explicitly stale readings", async () => {
  const { applyQuotaRefresh } = await import("../dist/plugin/lib/quota.js");
  const { formatStatusResults, sidebarProviders } = await import("../dist/plugin/lib/quota-view.js");
  const now = Date.UTC(2026, 8, 13, 12);
  const original = [{ id: "openai", result: { success: true, accounts: [{
    id: "account", name: "Old account", observedAt: now,
    windows: [{ id: "primary", kind: "window", durationSeconds: 18000, remainingPercent: 0, unlimited: false, times: [{ kind: "reset", at: now + 60000 }] }],
  }] } }];
  const snapshot = structuredClone(original);
  const options = { now: now + 120000, language: "en", timeZone: "UTC" };
  const expired = formatStatusResults(original, options);
  assert.match(expired, /0% remaining/);
  assert.match(expired, /Awaiting refresh/);
  assert.doesNotMatch(expired, /100%/);
  const failed = applyQuotaRefresh(original, [{ id: "openai", result: { success: false, error: "Connection failed" } }]);
  const sidebar = JSON.stringify(sidebarProviders(failed, options));
  assert.match(sidebar, /Connection failed/);
  assert.match(sidebar, /Stale/);
  assert.equal(failed[0].result.accounts[0].observedAt, now);
  assert.equal(failed[0].result.accounts[0].windows[0].remainingPercent, 0);
  assert.deepEqual(original, snapshot);
  const fresh = [{ id: "openai", result: { success: true, accounts: [{ id: "new-account", name: "New account", observedAt: now + 180000, windows: [] }] } }];
  assert.deepEqual(applyQuotaRefresh(failed, fresh), fresh);
  assert.deepEqual(applyQuotaRefresh(failed, [{ id: "openai", result: null }]), [{ id: "openai", result: null }]);
});
