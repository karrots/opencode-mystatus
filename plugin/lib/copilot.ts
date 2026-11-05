/**
 * GitHub Copilot Premium Requests Quota Module
 *
 * [Input]: GitHub token from ~/.local/share/opencode/auth.json (github-copilot provider)
 * [Output]: Formatted quota usage information with progress bars
 * [Location]: Called by mystatus.ts to handle GitHub Copilot accounts
 * [Sync]: mystatus.ts, types.ts, utils.ts, i18n.ts
 *
 * [Updated]: Jan 2026 - Handle new OpenCode official partnership auth flow
 * The new OAuth tokens (gho_) need to be exchanged for Copilot session tokens
 * before calling the internal quota API.
 */

import { t } from "./i18n.js";
import {
  type QueryResult,
  type CopilotAuthData,
  type CopilotQuotaConfig,
  type CopilotTier,
} from "./types.js";
import { fetchWithTimeout } from "./utils.js";
import { nonnegative, percent, reportedAt, type QuotaAccount, type QuotaWindow } from "./quota.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// Type Definitions
// ============================================================================

interface QuotaDetail {
  entitlement: number;
  overage_count: number;
  overage_permitted: boolean;
  percent_remaining: number;
  quota_id: string;
  quota_remaining: number;
  remaining: number;
  unlimited: boolean;
}

interface QuotaSnapshots {
  chat?: QuotaDetail;
  completions?: QuotaDetail;
  premium_interactions?: QuotaDetail;
}

// Free/Limited plan quota structure - simple number quotas (not objects)
interface LimitedUserQuotas {
  chat: number;
  completions: number;
}

interface CopilotUsageResponse {
  access_type_sku: string;
  analytics_tracking_id: string;
  assigned_date: string;
  can_signup_for_limited: boolean;
  chat_enabled: boolean;
  copilot_plan: string;
  organization_login_list: unknown[];
  organization_list: unknown[];
  quota_reset_date?: string;
  limited_user_reset_date?: string;
  quota_snapshots?: QuotaSnapshots;
  monthly_quotas?: Record<string, number>;
  limited_user_quotas?: LimitedUserQuotas;
}

interface CopilotTokenResponse {
  token: string;
  expires_at: number;
  refresh_in: number;
  endpoints: {
    api: string;
  };
}

// Public Billing API response types
interface BillingUsageItem {
  product: string;
  sku: string;
  model?: string;
  unitType: string;
  grossQuantity: number;
  netQuantity: number;
  limit?: number;
}

interface BillingUsageResponse {
  timePeriod: { year: number; month?: number };
  user: string;
  usageItems: BillingUsageItem[];
}

// ============================================================================
// Constants
// ============================================================================

const GITHUB_API_BASE_URL = "https://api.github.com";

// Config file path for user's fine-grained PAT
const COPILOT_QUOTA_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "copilot-quota-token.json",
);

// Updated to match current VS Code Copilot extension version
const COPILOT_VERSION = "0.35.0";
const EDITOR_VERSION = "vscode/1.107.0";
const EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`;
const USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`;

// Headers matching opencode-copilot-auth plugin (required for token exchange)
const COPILOT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Editor-Version": EDITOR_VERSION,
  "Editor-Plugin-Version": EDITOR_PLUGIN_VERSION,
  "Copilot-Integration-Id": "vscode-chat",
};

// ============================================================================
// Token Exchange (New auth flow for official OpenCode partnership)
// ============================================================================

/**
 * Read optional Copilot quota config from user's config file
 * Only a missing file means unconfigured; invalid configuration is actionable.
 */
function readQuotaConfig(): CopilotQuotaConfig | null {
  try {
    const content = fs.readFileSync(COPILOT_QUOTA_CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as CopilotQuotaConfig;

    // Validate required fields
    if (!config || typeof config.token !== "string" || !config.token.trim() || typeof config.username !== "string" || !config.username.trim() || !config.tier) {
      throw new Error("Invalid config");
    }

    // Validate tier is valid
    const validTiers: CopilotTier[] = [
      "free",
      "pro",
      "pro+",
      "business",
      "enterprise",
    ];
    if (!validTiers.includes(config.tier)) {
      throw new Error("Invalid tier");
    }

    return config;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw new Error("Invalid or unreadable copilot-quota-token.json. Set token, username and a supported tier (free, pro, pro+, business, enterprise).");
  }
}

/**
 * Fetch quota using the public GitHub REST API
 * Requires a fine-grained PAT with "Plan" read permission
 */
async function fetchPublicBillingUsage(
  config: CopilotQuotaConfig,
): Promise<BillingUsageResponse> {
  const response = await fetchWithTimeout(
    `${GITHUB_API_BASE_URL}/users/${config.username}/settings/billing/premium_request/usage`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(t.copilotApiError(response.status, errorText));
  }

  return response.json() as Promise<BillingUsageResponse>;
}

/**
 * Exchange OAuth token for a Copilot session token
 * Required for the new OpenCode official partnership auth flow (Jan 2026+)
 */
async function exchangeForCopilotToken(
  oauthToken: string,
): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${oauthToken}`,
          ...COPILOT_HEADERS,
        },
      },
    );

    if (!response.ok) {
      // Token exchange failed - might be old token format or API change
      return null;
    }

    const tokenData: CopilotTokenResponse = await response.json();
    return tokenData.token;
  } catch {
    return null;
  }
}

// ============================================================================
// API Call
// ============================================================================

/**
 * Build headers for GitHub API requests (quota endpoint)
 */
function buildGitHubHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...COPILOT_HEADERS,
  };
}

/**
 * Build headers for legacy token format
 */
function buildLegacyHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `token ${token}`,
    ...COPILOT_HEADERS,
  };
}

/**
 * Fetch GitHub Copilot usage data
 * Tries multiple authentication methods to handle both old and new token formats
 */
async function fetchCopilotUsage(
  authData: CopilotAuthData,
): Promise<CopilotUsageResponse> {
  // Use refresh token as the OAuth token (required)
  // In new auth flow, access === refresh (both are the OAuth token)
  const oauthToken = authData.refresh || authData.access;
  if (!oauthToken) {
    throw new Error("No OAuth token found in auth data");
  }

  const cachedAccessToken = authData.access;
  const tokenExpiry = authData.expires || 0;

  // Strategy 1: If we have a valid cached access token (from previous exchange), use it
  if (
    cachedAccessToken &&
    cachedAccessToken !== oauthToken &&
    tokenExpiry > Date.now()
  ) {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE_URL}/copilot_internal/user`,
      { headers: buildGitHubHeaders(cachedAccessToken) },
    );

    if (response.ok) {
      return response.json() as Promise<CopilotUsageResponse>;
    }
  }

  // Strategy 2: Try direct call with OAuth token (works with older token formats)
  const directResponse = await fetchWithTimeout(
    `${GITHUB_API_BASE_URL}/copilot_internal/user`,
    { headers: buildLegacyHeaders(oauthToken) },
  );

  if (directResponse.ok) {
    return directResponse.json() as Promise<CopilotUsageResponse>;
  }

  // Strategy 3: Exchange OAuth token for Copilot session token (new auth flow)
  const copilotToken = await exchangeForCopilotToken(oauthToken);

  if (copilotToken) {
    const exchangedResponse = await fetchWithTimeout(
      `${GITHUB_API_BASE_URL}/copilot_internal/user`,
      { headers: buildGitHubHeaders(copilotToken) },
    );

    if (exchangedResponse.ok) {
      return exchangedResponse.json() as Promise<CopilotUsageResponse>;
    }

    const errorText = await exchangedResponse.text();
    throw new Error(t.copilotApiError(exchangedResponse.status, errorText));
  }

  // All strategies failed - likely due to OpenCode's OAuth token lacking copilot scope
  // The new OpenCode partnership uses a different OAuth client that doesn't grant
  // access to the /copilot_internal/* endpoints
  throw new Error(
    t.copilotQuotaUnavailable + "\n\n" + t.copilotQuotaWorkaround,
  );
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a single quota line
 */
function copilotAccount(data: CopilotUsageResponse): QuotaAccount {
  const windows: QuotaWindow[] = [];
  for (const [key, kind] of [["premium_interactions", "premium"], ["chat", "chat"], ["completions", "completions"]] as const) {
    const quota = data.quota_snapshots?.[key];
    if (!quota) continue;
    const total = nonnegative(quota.entitlement);
    const remaining = nonnegative(quota.remaining);
    windows.push({
      id: key, kind, unlimited: quota.unlimited === true,
      remainingPercent: quota.unlimited ? null : percent(quota.percent_remaining),
      total, used: total !== undefined && remaining !== undefined ? Math.max(0, total - remaining) : undefined,
      unit: "requests", overage: kind === "premium" ? nonnegative(quota.overage_count) : undefined,
      times: quota.unlimited ? [] : [{ kind: "reset", at: reportedAt(data.quota_reset_date) }],
    });
  }
  return { id: "copilot", name: "GitHub Copilot", plan: data.copilot_plan, observedAt: Date.now(), windows };
}

// Copilot plan limits (premium requests per month)
// Source: https://docs.github.com/en/copilot/about-github-copilot/subscription-plans-for-github-copilot
const COPILOT_PLAN_LIMITS: Record<CopilotTier, number> = {
  free: 50, // Copilot Free: 50 premium requests/month
  pro: 300, // Copilot Pro: 300 premium requests/month
  "pro+": 1500, // Copilot Pro+: 1500 premium requests/month
  business: 300, // Copilot Business: 300 premium requests/month
  enterprise: 1000, // Copilot Enterprise: 1000 premium requests/month
};

/**
 * Format public billing API response
 * Different structure from internal API - aggregates usage items
 * Uses grossQuantity (total requests made) since netQuantity shows post-discount amount
 */
function publicBillingAccount(
  data: BillingUsageResponse,
  tier: CopilotTier,
): QuotaAccount {
  // Aggregate all premium request usage (sum grossQuantity across all models)
  const premiumItems = data.usageItems.filter(
    (item) =>
      item.sku === "Copilot Premium Request" || item.sku.includes("Premium"),
  );

  const totalUsed = premiumItems.reduce(
    (sum, item) => sum + item.grossQuantity,
    0,
  );

  // Get limit from tier
  const limit = COPILOT_PLAN_LIMITS[tier];

  // Show model breakdown
  const modelItems = data.usageItems.filter(
    (item) => item.model && item.grossQuantity > 0,
  );

  // Time period info
  const period = data.timePeriod;
  const periodStr = period.month
    ? `${period.year}-${String(period.month).padStart(2, "0")}`
    : `${period.year}`;
  return {
    id: data.user, name: `@${data.user}`, plan: tier, observedAt: Date.now(),
    windows: [{
      id: "premium", kind: "premium", unlimited: false,
      remainingPercent: nonnegative(totalUsed) === undefined ? null : percent((limit - totalUsed) / limit * 100),
      used: nonnegative(totalUsed), total: limit, unit: "requests", times: [],
    }],
    billingPeriod: periodStr,
    modelUsage: [...modelItems].sort((a, b) => b.grossQuantity - a.grossQuantity).slice(0, 5)
      .filter((item) => nonnegative(item.grossQuantity) !== undefined)
      .map((item) => ({ name: item.model!, used: item.grossQuantity, unit: item.unitType })),
  };
}

// ============================================================================
// Export Interface
// ============================================================================

export type { CopilotAuthData };

/**
 * Query GitHub Copilot account quota
 * @param authData GitHub Copilot authentication data (optional if using PAT config)
 * @returns Query result, null if no account configured
 */
export async function queryCopilotUsage(
  authData: CopilotAuthData | undefined,
): Promise<QueryResult | null> {
  // Strategy 1: Try public billing API with user's fine-grained PAT
  let quotaConfig: CopilotQuotaConfig | null;
  try {
    quotaConfig = readQuotaConfig();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Invalid Copilot quota configuration." };
  }
  if (quotaConfig) {
    try {
      const billingUsage = await fetchPublicBillingUsage(quotaConfig);
      return {
        success: true,
        accounts: [publicBillingAccount(billingUsage, quotaConfig.tier)],
      };
    } catch (err) {
      // PAT config exists but failed - report the error
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Strategy 2: Try internal API with OAuth token (legacy, may not work with new OpenCode auth)
  // Check if account exists and has a refresh token (the GitHub OAuth token)
  if (authData === undefined) return null;
  const token = authData?.refresh || authData?.access;
  if (!authData || authData.type !== "oauth" || typeof token !== "string" || !token.trim()) {
    return { success: false, error: "Copilot requires OAuth credentials or a valid copilot-quota-token.json. Update the connection." };
  }

  try {
    const usage = await fetchCopilotUsage(authData);
    return {
      success: true,
      accounts: [copilotAccount(usage)],
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
