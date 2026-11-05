import assert from "node:assert/strict";
import test from "node:test";
import { resolveQuotaTheme } from "../dist/plugin/lib/quota-theme.js";

const color = (n) => ({ r: n, g: n, b: n, a: 1 });
const colors = {
  text: color(0.9), muted: color(0.5), border: color(0.4),
  success: color(0.8), warning: color(0.6), error: color(0.2),
};

test("sidebar resolves OpenCode 2.0.20 base/muted tokens to colors, not token groups", () => {
  const theme = {
    text: {
      base: colors.text, muted: colors.muted,
      feedback: {
        success: { base: colors.success },
        warning: { base: colors.warning },
        error: { base: colors.error },
      },
    },
    border: { base: colors.border },
  };
  const resolved = resolveQuotaTheme({ theme });
  assert.equal(resolved.border, colors.border, "a border token group freezes the live sidebar renderer");
  assert.deepEqual(resolved, colors);
});

test("sidebar supports the older default/subdued V2 token names", () => {
  assert.deepEqual(resolveQuotaTheme({ theme: {
    text: {
      default: colors.text, subdued: colors.muted,
      feedback: {
        success: { default: colors.success },
        warning: { default: colors.warning },
        error: { default: colors.error },
      },
    },
    border: { default: colors.border },
  } }), colors);
});

test("sidebar supports flat V1 theme.current colors", () => {
  assert.deepEqual(resolveQuotaTheme({ theme: { current: {
    text: colors.text, textMuted: colors.muted, border: colors.border,
    success: colors.success, warning: colors.warning, error: colors.error,
  } } }), colors);
});

test("missing or unfamiliar token groups fall back without reaching the color parser", () => {
  const empty = Object.fromEntries(Object.keys(colors).map((key) => [key, undefined]));
  assert.deepEqual(resolveQuotaTheme(undefined), empty);
  assert.deepEqual(resolveQuotaTheme({ theme: {
    text: { base: {}, muted: "invalid", feedback: { error: {} } },
    border: { active: colors.border },
  } }), empty);
});

test("partial V2 themes resolve available tokens without requiring feedback groups", () => {
  const resolved = resolveQuotaTheme({ theme: { text: { base: colors.text }, border: { base: colors.border } } });
  assert.equal(resolved.text, colors.text);
  assert.equal(resolved.border, colors.border);
  assert.equal(resolved.error, undefined);
});
