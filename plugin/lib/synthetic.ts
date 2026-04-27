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

function formatQuotaSection(
  title: string,
  remainPercent: number,
  amountLabel: string,
  amountText: string,
  resetAt: string | undefined,
): string[] {
  const progressBar = createProgressBar(remainPercent);
  const renewCountdown = getRenewCountdown(resetAt);
  const renewsAt = resetAt || t.unknown;

  return [
    title,
    `${progressBar} ${t.remaining(remainPercent)}`,
    `${amountLabel}: ${amountText}`,
    `${t.quotaResets}: ${renewCountdown} (${renewsAt})`,
  ];
}

function getRenewCountdown(renewsAt: string | undefined): string {
  if (!renewsAt) return t.unknown;

  const renewTime = new Date(renewsAt).getTime();
  if (Number.isNaN(renewTime)) return t.unknown;

  const seconds = Math.max(0, Math.floor((renewTime - Date.now()) / 1000));
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
    const remaining = Math.max(0, rollingLimit.remaining);
    const limit = Math.max(0, rollingLimit.max);
    const used = Math.max(0, limit - remaining);
    const remainPercent =
      limit > 0 ? formatRemainPercent((remaining / limit) * 100) : 0;
    lines.push(
      ...formatQuotaSection(
        t.syntheticRollingLimit,
        remainPercent,
        t.used,
        `${used} / ${limit}`,
        rollingLimit.nextTickAt,
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
    const remainPercent = formatRemainPercent(weeklyLimit.percentRemaining);
    lines.push(
      ...formatQuotaSection(
        t.syntheticWeeklyLimit,
        remainPercent,
        t.remainingLabel,
        `${weeklyLimit.remainingCredits} / ${weeklyLimit.maxCredits}`,
        weeklyLimit.nextRegenAt,
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
