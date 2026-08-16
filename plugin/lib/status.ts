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

export interface ProviderStatus {
  title: string;
  result: QueryResult | null;
}

export interface StatusQueryDependencies {
  readAuthFile: (path: string) => Promise<string>;
  queryOpenAI: (authData: AuthData["openai"]) => Promise<QueryResult | null>;
  queryZhipu: (
    authData: AuthData["zhipuai-coding-plan"],
  ) => Promise<QueryResult | null>;
  queryZai: (
    authData: AuthData["zai-coding-plan"],
  ) => Promise<QueryResult | null>;
  querySynthetic: (
    authData: AuthData["synthetic"],
  ) => Promise<QueryResult | null>;
  queryGoogle: () => Promise<QueryResult | null>;
  queryCopilot: (
    authData: AuthData["github-copilot"],
  ) => Promise<QueryResult | null>;
}

const defaultDependencies: StatusQueryDependencies = {
  readAuthFile: (path) => readFile(path, "utf-8"),
  queryOpenAI: queryOpenAIUsage,
  queryZhipu: queryZhipuUsage,
  queryZai: queryZaiUsage,
  querySynthetic: querySyntheticUsage,
  queryGoogle: queryGoogleUsage,
  queryCopilot: queryCopilotUsage,
};

export async function getStatusText(
  dependencies: StatusQueryDependencies = defaultDependencies,
): Promise<string> {
  try {
    const authPath = join(homedir(), ".local/share/opencode/auth.json");
    let authData: AuthData;

    try {
      authData = JSON.parse(await dependencies.readAuthFile(authPath)) as AuthData;
    } catch (err) {
      return t.authError(authPath, err instanceof Error ? err.message : String(err));
    }

    const results = await queryProviderStatuses(authData, dependencies);
    return formatStatusResults(results);
  } catch (error) {
    return `Error fetching status: ${(error as Error).message}`;
  }
}

export async function queryProviderStatuses(
  authData: AuthData,
  dependencies: StatusQueryDependencies = defaultDependencies,
): Promise<ProviderStatus[]> {
  const [openai, zhipu, zai, synthetic, google, copilot] = await Promise.all([
    dependencies.queryOpenAI(authData.openai),
    dependencies.queryZhipu(authData["zhipuai-coding-plan"]),
    dependencies.queryZai(authData["zai-coding-plan"]),
    dependencies.querySynthetic(authData.synthetic),
    dependencies.queryGoogle(),
    dependencies.queryCopilot(authData["github-copilot"]),
  ]);

  return [
    { title: t.openaiTitle, result: openai },
    { title: t.zhipuTitle, result: zhipu },
    { title: t.zaiTitle, result: zai },
    { title: t.syntheticTitle, result: synthetic },
    { title: t.googleTitle, result: google },
    { title: t.copilotTitle, result: copilot },
  ];
}

export function formatStatusResults(statuses: ProviderStatus[]): string {
  const results: string[] = [];
  const errors: string[] = [];

  for (const status of statuses) {
    collectResult(status.result, status.title, results, errors);
  }

  if (results.length === 0 && errors.length === 0) {
    return t.noAccounts;
  }

  let output = results.join("\n");

  if (errors.length > 0) {
    if (output) output += "\n\n";
    output += t.queryFailed + errors.join("\n");
  }

  return output;
}

function collectResult(
  result: QueryResult | null,
  title: string,
  results: string[],
  errors: string[],
): void {
  if (!result) return;

  if (result.success && result.output) {
    if (results.length > 0) results.push("");
    results.push(title);
    results.push("");
    results.push(result.output);
  } else if (result.error) {
    errors.push(result.error);
  }
}
