import type { RGBA } from "@opentui/core";

export interface QuotaTheme {
  text: RGBA | undefined;
  muted: RGBA | undefined;
  border: RGBA | undefined;
  success: RGBA | undefined;
  warning: RGBA | undefined;
  error: RGBA | undefined;
}

interface ColorTokens {
  base?: RGBA;
  default?: RGBA;
}

interface V2TextTokens extends ColorTokens {
  muted?: RGBA;
  subdued?: RGBA;
  feedback?: {
    success?: ColorTokens;
    warning?: ColorTokens;
    error?: ColorTokens;
  };
}

type RawThemeTokens = {
  text?: V2TextTokens | RGBA;
  border?: ColorTokens | RGBA;
  textMuted?: RGBA;
  success?: RGBA;
  warning?: RGBA;
  error?: RGBA;
};

/** Never pass a token group to OpenTUI's color parser. */
function resolveColor(value: unknown): RGBA | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tokens = value as ColorTokens;
  const color = tokens.base ?? tokens.default ?? value;
  if (!color || typeof color !== "object") return undefined;
  const channels = color as RGBA;
  return [channels.r, channels.g, channels.b, channels.a].every(
    (channel) => typeof channel === "number" && Number.isFinite(channel),
  ) ? channels : undefined;
}

/** Normalize V1 flat colors and both generations of V2 semantic tokens. */
export function resolveQuotaTheme(api: unknown): QuotaTheme {
  const host = api as { theme?: unknown } | undefined;
  const raw =
    (host?.theme as { current?: unknown } | undefined)?.current ?? host?.theme;
  const t = raw as RawThemeTokens | undefined;
  const text = t?.text as V2TextTokens | undefined;
  return {
    text: resolveColor(t?.text),
    muted: resolveColor(text?.muted ?? text?.subdued ?? t?.textMuted),
    border: resolveColor(t?.border),
    success: resolveColor(text?.feedback?.success ?? t?.success),
    warning: resolveColor(text?.feedback?.warning ?? t?.warning),
    error: resolveColor(text?.feedback?.error ?? t?.error),
  };
}
