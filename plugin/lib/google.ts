/** Google Antigravity quota acquisition. Account outcomes remain independent. */
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { t } from "./i18n.js";
import { type QueryResult, type AntigravityAccount, type AntigravityAccountsFile, HIGH_USAGE_THRESHOLD } from "./types.js";
import { fetchWithTimeout } from "./utils.js";
import { percent, reportedAt, type QuotaAccount, type QuotaWindow } from "./quota.js";

interface GoogleQuotaResponse {
  models: Record<string, { quotaInfo?: { remainingFraction?: number; resetTime?: string } }>;
}

const GOOGLE_QUOTA_API_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const USER_AGENT = "antigravity/1.11.9 windows/amd64";
const MODELS_TO_DISPLAY = [
  { key: "gemini-3-pro-high", altKey: "gemini-3-pro-low", display: "G3 Pro" },
  { key: "gemini-3-pro-image", display: "G3 Image" },
  { key: "gemini-3-flash", display: "G3 Flash" },
  { key: "claude-opus-4-5-thinking", altKey: "claude-opus-4-5", display: "Claude" },
];

function getAntigravityAccountsPath(): string {
  const home = homedir();
  const configDir = process.platform === "win32"
    ? process.env.APPDATA || join(home, "AppData", "Roaming")
    : join(home, ".config");
  return join(configDir, "opencode", "antigravity-accounts.json");
}

const GOOGLE_TOKEN_REFRESH_URL = "https://oauth2.googleapis.com/token";
// OAuth application identifiers from opencode-antigravity-auth.
const GOOGLE_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";

function extractModelQuotas(data: GoogleQuotaResponse): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  for (const model of MODELS_TO_DISPLAY) {
    const info = data.models[model.key] ?? (model.altKey ? data.models[model.altKey] : undefined);
    if (!info) continue;
    const fraction = info.quotaInfo?.remainingFraction;
    windows.push({
      id: model.key, kind: "model", name: model.display,
      remainingPercent: percent(typeof fraction === "number" ? fraction * 100 : undefined),
      unlimited: false,
      times: [{ kind: "reset", at: reportedAt(info.quotaInfo?.resetTime) }],
    });
  }
  return windows;
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string }> {
  const response = await fetchWithTimeout(GOOGLE_TOKEN_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(t.googleApiError(response.status, "Token refresh failed."));
  return response.json();
}

async function fetchGoogleUsage(accessToken: string, projectId: string): Promise<GoogleQuotaResponse> {
  const response = await fetchWithTimeout(GOOGLE_QUOTA_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
    body: JSON.stringify({ project: projectId }),
  });
  if (!response.ok) throw new Error(t.googleApiError(response.status, "Quota request failed."));
  return response.json();
}

async function fetchAccountQuota(account: AntigravityAccount, index: number): Promise<QuotaAccount> {
  const identity = { id: account.email || `account-${index}`, name: account.email || `Google #${index + 1}` };
  try {
    if (!account.refreshToken) throw new Error("Missing Google refresh token. Reconnect the account.");
    const projectId = account.projectId || account.managedProjectId;
    if (!projectId) throw new Error(t.googleNoProjectId);
    const { access_token } = await refreshAccessToken(account.refreshToken);
    if (!access_token) throw new Error("Google token refresh returned no access token. Reconnect the account.");
    const windows = extractModelQuotas(await fetchGoogleUsage(access_token, projectId));
    return {
      ...identity, observedAt: Date.now(), windows,
      warning: windows.some((window) => window.remainingPercent !== null && 100 - window.remainingPercent >= HIGH_USAGE_THRESHOLD),
    };
  } catch (err) {
    return { ...identity, observedAt: Date.now(), windows: [], error: err instanceof Error ? err.message : "Google quota request failed." };
  }
}

export async function queryGoogleUsage(): Promise<QueryResult | null> {
  let content: string;
  try {
    content = await readFile(getAntigravityAccountsPath(), "utf-8");
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return null;
    return { success: false, error: "Cannot read antigravity-accounts.json. Check file permissions." };
  }
  try {
    const file = JSON.parse(content) as AntigravityAccountsFile;
    if (!file || !Array.isArray(file.accounts) || file.accounts.some((account) => !account || typeof account !== "object")) {
      return { success: false, error: "Invalid antigravity-accounts.json: expected an accounts array." };
    }
    return { success: true, accounts: await Promise.all(file.accounts.map(fetchAccountQuota)) };
  } catch {
    return { success: false, error: "Invalid antigravity-accounts.json. Check the account configuration." };
  }
}
