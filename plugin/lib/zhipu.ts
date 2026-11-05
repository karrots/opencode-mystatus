/**
 * 智谱 AI 额度查询模块
 *
 * [输入]: API Key
 * [输出]: 格式化的额度使用情况
 * [定位]: 被 mystatus.ts 调用，处理智谱 AI 账号
 * [同步]: mystatus.ts, types.ts, utils.ts, i18n.ts
 */

import { t } from "./i18n.js";
import {
  type QueryResult,
  type ZhipuAuthData,
  HIGH_USAGE_THRESHOLD,
} from "./types.js";
import {
  fetchWithTimeout,
  safeMax,
  maskString,
} from "./utils.js";
import { nonnegative, remainingPercent, reportedAt, type QuotaAccount, type QuotaWindow } from "./quota.js";

// ============================================================================
// 类型定义
// ============================================================================

interface UsageLimitItem {
  /** 限制类型：TOKENS_LIMIT(Token) / TIME_LIMIT(MCP搜索次数) */
  type: "TIME_LIMIT" | "TOKENS_LIMIT";
  /** 总配额/限制数 */
  usage: number;
  /** 当前已使用 */
  currentValue: number;
  /** 使用百分比 */
  percentage: number;
  /** 下次重置时间戳 (ms，仅 TOKENS_LIMIT 有效) */
  nextResetTime?: number;
}

interface QuotaLimitResponse {
  code: number;
  msg: string;
  data: {
    limits: UsageLimitItem[];
  };
  success: boolean;
}

interface PlatformConfig {
  apiUrl: string;
  apiError: (status: number, text: string) => string;
  accountLabel: string;
}

// ============================================================================
// API 调用
// ============================================================================

const ZHIPU_QUOTA_QUERY_URL =
  "https://bigmodel.cn/api/monitor/usage/quota/limit";
const ZAI_QUOTA_QUERY_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

const ZHIPU_CONFIG: PlatformConfig = {
  apiUrl: ZHIPU_QUOTA_QUERY_URL,
  apiError: t.zhipuApiError,
  accountLabel: t.zhipuAccountName,
};

const ZAI_CONFIG: PlatformConfig = {
  apiUrl: ZAI_QUOTA_QUERY_URL,
  apiError: t.zaiApiError,
  accountLabel: t.zaiAccountName,
};

/**
 * 获取智谱/Z.ai 使用情况
 */
async function fetchUsage(
  apiKey: string,
  config: PlatformConfig,
): Promise<QuotaLimitResponse> {
  const response = await fetchWithTimeout(config.apiUrl, {
    method: "GET",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      "User-Agent": "OpenCode-Status-Plugin/1.0",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(config.apiError(response.status, errorText));
  }

  const data = (await response.json()) as QuotaLimitResponse;

  if (!data.success || data.code !== 200) {
    throw new Error(config.apiError(data.code, data.msg || "Unknown error"));
  }

  return data;
}

// ============================================================================
// 格式化输出
// ============================================================================

/**
 * 格式化智谱 AI 使用情况
 */
function zhipuAccount(
  data: QuotaLimitResponse,
  apiKey: string,
  accountLabel: string,
): QuotaAccount {
  const limits = data.data.limits ?? [];
  const windows: QuotaWindow[] = [];
  for (const [type, kind] of [["TOKENS_LIMIT", "tokens"], ["TIME_LIMIT", "mcp"]] as const) {
    const limit = limits.find((item) => item.type === type);
    if (!limit) continue;
    windows.push({
      id: type, kind, unlimited: false,
      remainingPercent: remainingPercent(limit.percentage),
      used: nonnegative(limit.currentValue), total: nonnegative(limit.usage),
      unit: kind === "tokens" ? "tokens" : "requests",
      times: kind === "tokens" ? [{ kind: "reset", at: reportedAt(limit.nextResetTime) }] : [],
    });
  }
  return {
    id: accountLabel, name: maskString(apiKey), plan: accountLabel,
    observedAt: Date.now(), windows,
    warning: safeMax(limits.map((limit) => limit.percentage)) >= HIGH_USAGE_THRESHOLD,
  };
}

// ============================================================================
// 导出接口
// ============================================================================

export type { ZhipuAuthData };

async function queryUsage(
  authData: ZhipuAuthData | undefined,
  config: PlatformConfig,
): Promise<QueryResult | null> {
  // 检查账号是否存在且有效
  if (authData === undefined) return null;
  if (!authData || authData.type !== "api" || typeof authData.key !== "string" || !authData.key.trim()) {
    return { success: false, error: `${config.accountLabel} requires an API key. Update the provider connection.` };
  }

  try {
    const usage = await fetchUsage(authData.key, config);
    return {
      success: true,
      accounts: [zhipuAccount(usage, authData.key, config.accountLabel)],
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 查询智谱 AI 账号额度
 * @param authData 智谱认证数据
 * @returns 查询结果，如果账号不存在或无效返回 null
 */
export async function queryZhipuUsage(
  authData: ZhipuAuthData | undefined,
): Promise<QueryResult | null> {
  return queryUsage(authData, ZHIPU_CONFIG);
}

/**
 * 查询 Z.ai 账号额度
 * @param authData Z.ai 认证数据
 * @returns 查询结果，如果账号不存在或无效返回 null
 */
export async function queryZaiUsage(
  authData: ZhipuAuthData | undefined,
): Promise<QueryResult | null> {
  return queryUsage(authData, ZAI_CONFIG);
}
