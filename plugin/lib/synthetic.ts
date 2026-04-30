/**
 * Synthetic quota query module
 *
 * [Input]: API key
 * [Output]: Formatted quota usage information
 * [Location]: Called by mystatus.ts to handle Synthetic accounts
 * [Sync]: mystatus.ts, types.ts, utils.ts, i18n.ts
 */

import { t } from "./i18n";
import { type QueryResult, type ZhipuAuthData } from "./types";
import { createProgressBar, fetchWithTimeout, formatDuration } from "./utils";

interface SyntheticQuotaResponse {
  subscription?: {
    limit?: number;
    requests?: number;
    renewsAt?: string;
  };
  search?: {
    hourly?: {
      limit?: number;
      requests?: number;
      renewsAt?: string;
    };
  };
  weeklyTokenLimit?: {
    nextRegenAt?: string;
    percentRemaining?: number;
    maxCredits?: string;
    remainingCredits?: string;
    nextRegenCredits?: string;
  };
  rollingFiveHourLimit?: {
    nextTickAt?: string;
    tickPercent?: number;
    remaining?: number;
    max?: number;
    limited?: boolean;
  };
}

const SYNTHETIC_QUOTA_URL = "https://api.synthetic.new/v2/quotas";

function formatRemainPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function formatLocalTime(resetAt: string | undefined): string {
  return resetAt
    ? new Date(resetAt).toLocaleString(undefined, { timeZoneName: "short" })
    : t.unknown;
}

function getTimeUntil(resetAt: string | undefined): number | null {
  if (!resetAt) return null;

  const resetTime = new Date(resetAt).getTime();
  if (Number.isNaN(resetTime)) return null;

  return Math.max(0, Math.floor((resetTime - Date.now()) / 1000));
}

function parseNumericValue(value: string | undefined): number {
  if (!value) return Number.NaN;

  const normalized = value.replace(/[^0-9.-]+/g, "");
  return Number(normalized);
}

function getFullRecovery(
  resetAt: string | undefined,
  used: number,
  max: number,
  tickPercent: number,
): string | null {
  const secondsUntilReset = getTimeUntil(resetAt);
  if (secondsUntilReset === null || max <= 0 || tickPercent <= 0) return null;

  const multiplier = used / (max * tickPercent);
  const fullRecoverySeconds = Math.max(0, Math.round(secondsUntilReset * multiplier));
  const fullRecoveryAt = new Date(Date.now() + fullRecoverySeconds * 1000).toISOString();

  return `${t.fullRecoveryLabel}: ${formatDuration(fullRecoverySeconds)} (${formatLocalTime(fullRecoveryAt)})`;
}

function formatQuotaSection(
  title: string,
  remainPercent: number,
  amountLabel: string,
  amountText: string,
  resetLabel: string,
  resetAt: string | undefined,
  fullRecoveryLine?: string,
): string[] {
  const progressBar = createProgressBar(remainPercent);
  const renewCountdown = getRenewCountdown(resetAt);
  const renewsAt = formatLocalTime(resetAt);

  const lines = [
    title,
    `${progressBar} ${t.remaining(remainPercent)}`,
    `${amountLabel}: ${amountText}`,
    `${resetLabel}: ${renewCountdown} (${renewsAt})`,
  ];

  if (fullRecoveryLine) lines.push(fullRecoveryLine);

  return lines;
}

function getRenewCountdown(renewsAt: string | undefined): string {
  const seconds = getTimeUntil(renewsAt);
  if (seconds === null) return t.unknown;

  return formatDuration(seconds);
}

async function fetchSyntheticUsage(apiKey: string): Promise<SyntheticQuotaResponse> {
  const response = await fetchWithTimeout(SYNTHETIC_QUOTA_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "OpenCode-Status-Plugin/1.0",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(t.syntheticApiError(response.status, errorText));
  }

  return response.json() as Promise<SyntheticQuotaResponse>;
}

function formatSyntheticUsage(data: SyntheticQuotaResponse): string {
  const rollingLimit = data.rollingFiveHourLimit;
  const weeklyLimit = data.weeklyTokenLimit;
  const searchHourly = data.search?.hourly;
  const subscription = data.subscription;
  const lines = [`${t.account}        Synthetic (API)`, ""];
  let hasQuotaData = false;

  if (
    rollingLimit &&
    typeof rollingLimit.remaining === "number" &&
    typeof rollingLimit.max === "number"
  ) {
    const rawRemaining = Math.max(0, rollingLimit.remaining);
    const rawLimit = Math.max(0, rollingLimit.max);
    const rawUsed = Math.max(0, rawLimit - rawRemaining);
    const remaining = Math.round(rawRemaining);
    const limit = Math.round(rawLimit);
    const used = Math.max(0, Math.round(rawUsed));
    const displayLimit = Math.round(limit);
    const remainPercent =
      rawLimit > 0 ? formatRemainPercent((rawRemaining / rawLimit) * 100) : 0;
    const fullRecoveryLine =
      rawRemaining < rawLimit &&
      typeof rollingLimit.tickPercent === "number" &&
      rollingLimit.tickPercent > 0
        ? getFullRecovery(
            rollingLimit.nextTickAt,
            rawUsed,
            rawLimit,
            rollingLimit.tickPercent,
          )
        : null;
    lines.push(
      ...formatQuotaSection(
        t.syntheticRollingLimit,
        remainPercent,
        t.used,
        `${used} / ${displayLimit}`,
        t.nextRecoveryLabel,
        rollingLimit.nextTickAt,
        fullRecoveryLine ?? undefined,
      ),
    );
    hasQuotaData = true;

    if (rollingLimit.limited) {
      lines.push("");
      lines.push(t.limitReached);
    }
  }

  if (hasQuotaData) lines.push("");

  if (
    weeklyLimit &&
    typeof weeklyLimit.percentRemaining === "number" &&
    weeklyLimit.remainingCredits &&
    weeklyLimit.maxCredits
  ) {
    const remainingCredits = parseNumericValue(weeklyLimit.remainingCredits);
    const maxCredits = parseNumericValue(weeklyLimit.maxCredits);
    const nextRegenCredits = parseNumericValue(weeklyLimit.nextRegenCredits ?? "0");
    const remainPercent = formatRemainPercent(weeklyLimit.percentRemaining);
    const fullRecoveryLine =
      Number.isFinite(remainingCredits) &&
      Number.isFinite(maxCredits) &&
      Number.isFinite(nextRegenCredits) &&
      remainingCredits < maxCredits &&
      nextRegenCredits > 0
        ? getFullRecovery(
            weeklyLimit.nextRegenAt,
            Math.max(0, maxCredits - remainingCredits),
            maxCredits,
            nextRegenCredits / maxCredits,
          )
        : null;
    lines.push(
      ...formatQuotaSection(
        t.syntheticWeeklyLimit,
        remainPercent,
        t.remainingLabel,
        `${weeklyLimit.remainingCredits} / ${weeklyLimit.maxCredits} (+${weeklyLimit.nextRegenCredits ?? "0"})`,
        t.nextRecoveryLabel,
        weeklyLimit.nextRegenAt,
        fullRecoveryLine ?? undefined,
      ),
    );
    hasQuotaData = true;
    lines.push("");
  }

  if (
    searchHourly &&
    typeof searchHourly.limit === "number" &&
    typeof searchHourly.requests === "number"
  ) {
    const used = Math.max(0, searchHourly.requests);
    const limit = Math.max(0, searchHourly.limit);
    const remaining = Math.max(0, limit - used);
    const remainPercent =
      limit > 0 ? formatRemainPercent((remaining / limit) * 100) : 0;
    lines.push(
      ...formatQuotaSection(
        t.syntheticSearchLimit,
        remainPercent,
        t.used,
        `${used} / ${limit}`,
        t.fullResetLabel,
        searchHourly.renewsAt,
      ),
    );
    hasQuotaData = true;
    lines.push("");
  }

  if (hasQuotaData) {
    while (lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.join("\n");
  }

  if (
    !subscription ||
    typeof subscription.limit !== "number" ||
    typeof subscription.requests !== "number"
  ) {
    return t.noQuotaData;
  }

  const used = Math.max(0, subscription.requests);
  const limit = Math.max(0, subscription.limit);
  const remaining = Math.max(0, limit - used);
  const remainPercent =
    limit > 0 ? formatRemainPercent((remaining / limit) * 100) : 0;
  return [
    `${t.account}        Synthetic (API)`,
    "",
    ...formatQuotaSection(
      t.syntheticSubscriptionLimit,
      remainPercent,
      t.used,
      `${used} / ${limit}`,
      t.fullResetLabel,
      subscription.renewsAt,
    ),
  ].join("\n");
}

export async function querySyntheticUsage(
  authData: ZhipuAuthData | undefined,
): Promise<QueryResult | null> {
  if (!authData || authData.type !== "api" || !authData.key) {
    return null;
  }

  try {
    const usage = await fetchSyntheticUsage(authData.key);
    return {
      success: true,
      output: formatSyntheticUsage(usage),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
