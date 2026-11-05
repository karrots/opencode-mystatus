/**
 * OpenAI 额度查询模块
 *
 * [输入]: OAuth access token
 * [输出]: 格式化的额度使用情况
 * [定位]: 被 mystatus.ts 调用，处理 OpenAI 账号
 * [同步]: mystatus.ts, types.ts, utils.ts, i18n.ts
 */

import { t } from "./i18n.js";
import { type QueryResult, type OpenAIAuthData } from "./types.js";
import { fetchWithTimeout } from "./utils.js";
import { nonnegative, remainingPercent, relativeReset, type QuotaAccount, type QuotaWindow } from "./quota.js";

// ============================================================================
// 类型定义
// ============================================================================

interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
}

interface OpenAIUsageResponse {
  plan_type: string;
  rate_limit: {
    limit_reached: boolean;
    primary_window: RateLimitWindow;
    secondary_window: RateLimitWindow | null;
  } | null;
}

// ============================================================================
// JWT 解析
// ============================================================================

interface JwtPayload {
  "https://api.openai.com/profile"?: {
    email?: string;
  };
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

/**
 * Base64URL 解码
 */
function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  return Buffer.from(padded, "base64").toString("utf8");
}

/**
 * 解析 JWT token，提取 payload
 */
function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadJson = base64UrlDecode(parts[1]);
    return JSON.parse(payloadJson) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 从 JWT 中提取用户邮箱
 */
function getEmailFromJwt(token: string): string | null {
  const payload = parseJwt(token);
  return payload?.["https://api.openai.com/profile"]?.email ?? null;
}

/**
 * 从 JWT 中提取 ChatGPT 账号 ID（用于团队/组织账号）
 */
function getAccountIdFromJwt(token: string): string | null {
  const payload = parseJwt(token);
  return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 将窗口时长（秒）转换为可读的窗口名称
 */
function quotaWindow(window: RateLimitWindow, id: string, observedAt: number): QuotaWindow {
  return {
    id, kind: "window",
    durationSeconds: nonnegative(window.limit_window_seconds) || undefined,
    remainingPercent: remainingPercent(window.used_percent),
    unlimited: false,
    times: [{ kind: "reset", at: relativeReset(window.reset_after_seconds, observedAt) }],
  };
}

// ============================================================================
// API 调用
// ============================================================================

class OpenAIUsageError extends Error {}

const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
/**
 * 获取 OpenAI 使用情况
 */
async function fetchOpenAIUsage(
  accessToken: string,
  accountID?: string,
): Promise<OpenAIUsageResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "OpenCode-Status-Plugin/1.0",
  };

  const accountId = accountID ?? getAccountIdFromJwt(accessToken);
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  const response = await fetchWithTimeout(OPENAI_USAGE_URL, {
    headers,
  });

  if (!response.ok) {
    throw new OpenAIUsageError(
      t.apiError(
        response.status,
        response.status === 401
          ? "Reconnect OpenAI with /connect."
          : "OpenAI quota request failed.",
      ),
    );
  }

  return response.json() as Promise<OpenAIUsageResponse>;
}

// ============================================================================
// 格式化输出
// ============================================================================

/**
 * 格式化 OpenAI 使用情况
 */
function openAIAccount(
  data: OpenAIUsageResponse,
  email: string | null,
  id: string,
): QuotaAccount {
  const { plan_type, rate_limit } = data;
  const observedAt = Date.now();
  const windows: QuotaWindow[] = [];
  if (rate_limit?.primary_window) {
    windows.push(quotaWindow(rate_limit.primary_window, "primary", observedAt));
  }
  if (rate_limit?.secondary_window) {
    windows.push(quotaWindow(rate_limit.secondary_window, "secondary", observedAt));
  }
  return { id, name: email ?? "OpenAI", plan: plan_type, observedAt, windows, warning: rate_limit?.limit_reached ?? false };
}

// ============================================================================
// 导出接口
// ============================================================================

export type { OpenAIAuthData };

/**
 * 查询 OpenAI 账号额度
 * @param authData OpenAI 认证数据
 * @returns 查询结果，如果账号不存在或无效返回 null
 */
export async function queryOpenAIUsage(
  authData: OpenAIAuthData | undefined,
): Promise<QueryResult | null> {
  // 检查账号是否存在且有效
  if (authData === undefined) return null;
  if (!authData || authData.type !== "oauth" || typeof authData.access !== "string" || !authData.access.trim()) {
    return { success: false, error: "OpenAI quota requires a ChatGPT OAuth connection. Reconnect with /connect." };
  }

  try {
    const email = getEmailFromJwt(authData.access);
    const usage = await fetchOpenAIUsage(
      authData.access,
      authData.metadata?.accountID,
    );
    return {
      success: true,
      accounts: [openAIAccount(usage, email, authData.metadata?.accountID ?? getAccountIdFromJwt(authData.access) ?? email ?? "openai")],
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof OpenAIUsageError
          ? err.message
          : "OpenAI quota request failed. Check the connection and try again.",
    };
  }
}
