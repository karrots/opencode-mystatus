/** Synthetic quota acquisition. Recovery times are reported, never estimated. */
import { t } from "./i18n.js";
import { type QueryResult, type ZhipuAuthData } from "./types.js";
import { fetchWithTimeout } from "./utils.js";
import { nonnegative, percent, reportedAt, type QuotaAccount, type QuotaWindow } from "./quota.js";

interface RequestQuota {
  limit?: number;
  requests?: number;
  renewsAt?: string;
}
interface PlanWeeklyLimit {
  nextRegenAt?: string;
  percentRemaining?: number;
  nextRegenPercent?: number;
}
interface SyntheticQuotaResponse {
  // The current API reports one subscription allowance. The former
  // rollingFiveHourLimit / weeklyTokenLimit windows are gone; the weekly
  // percentage now lives in planWeeklyLimit.
  subscription?: RequestQuota;
  planWeeklyLimit?: PlanWeeklyLimit;
}

const SYNTHETIC_QUOTA_URL = "https://api.synthetic.new/v2/quotas";

/** The subscription row shows the weekly percentage, like the old weekly graph. */
function subscriptionWindow(quota: RequestQuota | undefined, weekly: PlanWeeklyLimit | undefined): QuotaWindow {
  const weeklyRemaining = percent(weekly?.percentRemaining);
  if (weeklyRemaining !== null) {
    return {
      id: "subscription", kind: "subscription", unlimited: false,
      remainingPercent: weeklyRemaining,
      times: [{ kind: "next-recovery", at: reportedAt(weekly?.nextRegenAt) }],
    };
  }
  const total = nonnegative(quota?.limit);
  const used = nonnegative(quota?.requests);
  return {
    id: "subscription", kind: "subscription", unlimited: false, used, total, unit: "requests",
    remainingPercent: total && used !== undefined ? percent((total - used) / total * 100) : null,
    times: [{ kind: "reset", at: reportedAt(quota?.renewsAt) }],
  };
}

function syntheticAccount(data: SyntheticQuotaResponse): QuotaAccount {
  const hasWeekly = percent(data.planWeeklyLimit?.percentRemaining) !== null;
  const windows: QuotaWindow[] = data.subscription || hasWeekly
    ? [subscriptionWindow(data.subscription, data.planWeeklyLimit)]
    : [];
  return { id: "synthetic", name: "Synthetic", plan: "API", observedAt: Date.now(), windows };
}

export async function querySyntheticUsage(authData: ZhipuAuthData | undefined): Promise<QueryResult | null> {
  if (authData === undefined) return null;
  if (!authData || authData.type !== "api" || typeof authData.key !== "string" || !authData.key.trim()) {
    return { success: false, error: "Synthetic requires an API key. Update the provider connection." };
  }
  try {
    const response = await fetchWithTimeout(SYNTHETIC_QUOTA_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${authData.key}`, "User-Agent": "OpenCode-Status-Plugin/1.0" },
    });
    if (!response.ok) return { success: false, error: t.syntheticApiError(response.status, "Quota request failed.") };
    return { success: true, accounts: [syntheticAccount(await response.json())] };
  } catch {
    return { success: false, error: "Synthetic quota request failed. Check the connection and try again." };
  }
}
