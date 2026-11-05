import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { t } from "./i18n.js";
import { queryCopilotUsage } from "./copilot.js";
import { queryGoogleUsage } from "./google.js";
import { queryOpenAIUsage } from "./openai.js";
import { querySyntheticUsage } from "./synthetic.js";
import { type AuthData, type QueryResult } from "./types.js";
import { queryZaiUsage, queryZhipuUsage } from "./zhipu.js";
import { type ProviderStatus, queryResultSchema } from "./quota.js";
import { formatStatusResults } from "./quota-view.js";
export { formatStatusResults } from "./quota-view.js";
export type { ProviderStatus } from "./quota.js";

export interface StatusQueryDependencies {
  readAuthFile: (path: string) => Promise<string>;
  queryOpenAI: (authData: AuthData["openai"]) => Promise<QueryResult | null>;
  queryZhipu: (authData: AuthData["zhipuai-coding-plan"]) => Promise<QueryResult | null>;
  queryZai: (authData: AuthData["zai-coding-plan"]) => Promise<QueryResult | null>;
  querySynthetic: (authData: AuthData["synthetic"]) => Promise<QueryResult | null>;
  queryGoogle: () => Promise<QueryResult | null>;
  queryCopilot: (authData: AuthData["github-copilot"]) => Promise<QueryResult | null>;
}

const defaultDependencies: StatusQueryDependencies = {
  readAuthFile: (path) => readFile(path, "utf-8"),
  queryOpenAI: queryOpenAIUsage, queryZhipu: queryZhipuUsage,
  queryZai: queryZaiUsage, querySynthetic: querySyntheticUsage,
  queryGoogle: queryGoogleUsage, queryCopilot: queryCopilotUsage,
};

export async function getStatusText(overrides: Partial<StatusQueryDependencies> = {}): Promise<string> {
  return formatStatusResults(await getProviderStatuses(overrides));
}

/** Shared acquisition for the dialog and sidebar. */
export async function getProviderStatuses(overrides: Partial<StatusQueryDependencies> = {}): Promise<ProviderStatus[]> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const authPath = join(homedir(), ".local/share/opencode/auth.json");
  let authData: AuthData = {};
  let configurationError: ProviderStatus | undefined;
  try {
    authData = await readStatusAuthData(authPath, dependencies.readAuthFile);
  } catch {
    // Parsing errors may quote credentials. Independent sources can still run.
    configurationError = { id: "configuration", result: { success: false, error: t.authError(authPath, "Check file permissions and JSON configuration.") } };
  }
  const statuses = await queryProviderStatuses(authData, dependencies);
  return configurationError ? [...statuses, configurationError] : statuses;
}

export async function queryProviderStatuses(authData: AuthData, overrides: Partial<StatusQueryDependencies> = {}): Promise<ProviderStatus[]> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const queries: [ProviderStatus["id"], () => Promise<QueryResult | null>][] = [
    ["openai", () => dependencies.queryOpenAI(authData.openai)],
    ["zhipu", () => dependencies.queryZhipu(authData["zhipuai-coding-plan"])],
    ["zai", () => dependencies.queryZai(authData["zai-coding-plan"])],
    ["synthetic", () => dependencies.querySynthetic(authData.synthetic)],
    ["google", () => dependencies.queryGoogle()],
    ["copilot", () => dependencies.queryCopilot(authData["github-copilot"])],
  ];
  return Promise.all(queries.map(async ([id, query]): Promise<ProviderStatus> => {
    try {
      const result = await query();
      if (result === null) return { id, result };
      const validated = queryResultSchema.safeParse(result);
      return { id, result: validated.success ? validated.data : { success: false, error: "Invalid quota response. Update MyStatus and retry." } };
    } catch {
      return { id, result: { success: false, error: "Quota request failed. Check the provider connection and retry." } };
    }
  }));
}

/** V2 credentials may exist only in the server store, with no legacy file. */
export async function readStatusAuthData(path: string, read: (path: string) => Promise<string> = (path) => readFile(path, "utf-8")): Promise<AuthData> {
  try {
    const data: unknown = JSON.parse(await read(path));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid auth configuration");
    return data as AuthData;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}
