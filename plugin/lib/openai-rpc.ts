import { queryOpenAIUsage } from "./openai.js";
import { querySyntheticUsage } from "./synthetic.js";
import type { OpenAIAuthData, QueryResult } from "./types.js";
import type { StatusQueryDependencies } from "./status.js";
import { z } from "zod";
import { queryResultSchema } from "./quota.js";

const INCOMPATIBLE = "MyStatus quota protocol is incompatible. Update the server plugin and TUI plugin together, then restart both.";

// Portable JSON Schema RPC definition; no V2 runtime import, so V1 can still
// load this package. Rpc.define returns this same structure in OpenCode V2.
export const quotaRpc = {
  id: "opencode-mystatus.quota",
  methods: {
    openai: {
      // Optional only so an old TUI gets an actionable error, never old prose.
      input: { type: "object", properties: { version: { const: 2, type: "number" } }, additionalProperties: false },
      output: z.toJSONSchema(queryResultSchema.nullable(), { target: "draft-07" }),
    },
    synthetic: {
      input: { type: "object", properties: { version: { const: 2, type: "number" } }, additionalProperties: false },
      output: z.toJSONSchema(queryResultSchema.nullable(), { target: "draft-07" }),
    },
  },
  events: {},
} as const;

type ServerQuotaCredential =
  | (Omit<OpenAIAuthData, "type"> & { type: "oauth" })
  | { type: "key"; key: string };

export interface OpenAIQuotaHost {
  integration: {
    connection: {
      active: (integrationID: string) => Promise<unknown>;
      resolve: (connection: unknown) => Promise<ServerQuotaCredential | undefined>;
    };
  };
  rpc: {
    register: (
      definition: typeof quotaRpc,
      handlers: Record<keyof typeof quotaRpc.methods, (input: { version?: number }) => Promise<QueryResult | null>>,
    ) => Promise<{ dispose: () => Promise<void> }>;
  };
}

export async function registerOpenAIQuota(host: OpenAIQuotaHost) {
  let pending: Promise<QueryResult | null> | undefined;
  const pendingSynthetic = new Map<string, Promise<QueryResult | null>>();
  const query = async (): Promise<QueryResult | null> => {
    try {
      const connection = await host.integration.connection.active("openai");
      if (!connection) return null;
      // The host owns token refresh, persistence, and active account selection.
      const credential = await host.integration.connection.resolve(connection);
      if (!credential) {
        return {
          success: false,
          error:
            "OpenAI connection could not be resolved. Reconnect OpenAI with /connect.",
        };
      }
      if (credential.type !== "oauth") {
        return {
          success: false,
          error:
            "OpenAI subscription quota requires a ChatGPT OAuth connection; the active connection uses an API key.",
        };
      }
      if (!credential.access) {
        return {
          success: false,
          error:
            "OpenAI connection has no access token. Reconnect OpenAI with /connect.",
        };
      }
      const result = await queryOpenAIUsage(credential);
      const validated = queryResultSchema.nullable().safeParse(result);
      return validated.success ? validated.data : { success: false, error: "OpenAI returned an invalid quota response. Update MyStatus and retry." };
    } catch {
      // Host errors may contain credentials. Only return an actionable summary.
      return {
        success: false,
        error:
          "Could not resolve OpenAI authentication. Reconnect OpenAI with /connect.",
      };
    }
  };
  const registration = await host.rpc.register(quotaRpc, {
    openai: (input) => {
      if (input?.version !== 2) return Promise.resolve({ success: false, error: INCOMPATIBLE });
      // Sidebar instances and /mystatus can overlap; share the refresh operation.
      pending ??= query().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    synthetic: (input) => {
      if (input?.version !== 2) return Promise.resolve({ success: false, error: INCOMPATIBLE });
      return querySyntheticQuota(host, pendingSynthetic);
    },
  });
  return () => registration.dispose();
}

async function querySyntheticQuota(host: OpenAIQuotaHost, pending: Map<string, Promise<QueryResult | null>>): Promise<QueryResult | null> {
  try {
    const connection = await host.integration.connection.active("synthetic");
    if (!connection) return null;
    const credential = await host.integration.connection.resolve(connection);
    if (!credential || credential.type !== "key" || typeof credential.key !== "string" || !credential.key.trim()) {
      return { success: false, error: "Synthetic requires an API-key connection. Reconnect Synthetic with /connect." };
    }
    // Resolve on every invocation so an account switch or key rotation cannot
    // reuse another account's request. Keys stay in transient server memory only.
    const key = credential.key;
    let request = pending.get(key);
    if (!request) {
      // V2 Credential.Key uses "key"; the legacy provider adapter expects "api".
      request = querySyntheticUsage({ type: "api", key }).then((result): QueryResult | null => {
        const validated = queryResultSchema.nullable().safeParse(result);
        return validated.success ? validated.data : { success: false, error: "Synthetic returned an invalid quota response. Update MyStatus and retry." };
      }).finally(() => { pending.delete(key); });
      pending.set(key, request);
    }
    return await request;
  } catch {
    return { success: false, error: "Could not resolve Synthetic authentication. Reconnect Synthetic with /connect." };
  }
}

export interface QuotaRpcClient {
  rpc: (definition: typeof quotaRpc) => Record<keyof typeof quotaRpc.methods, (
      input: { version: 2 },
      options?: { location?: unknown },
    ) => Promise<unknown>>;
}

export function remoteOpenAIQuery(
  client: QuotaRpcClient,
  location: () => unknown,
) {
  return remoteQuotaQuery(client, location, "openai");
}

export function remoteSyntheticQuery(client: QuotaRpcClient, location: () => unknown) {
  return remoteQuotaQuery(client, location, "synthetic");
}

function remoteQuotaQuery(client: QuotaRpcClient, location: () => unknown, provider: keyof typeof quotaRpc.methods) {
  const name = provider === "openai" ? "OpenAI" : "Synthetic";
  return async (): Promise<QueryResult | null> => {
    try {
      const result = await client.rpc(quotaRpc)[provider]({ version: 2 }, { location: location() });
      const validated = queryResultSchema.nullable().safeParse(result);
      return validated.success ? validated.data : { success: false, error: INCOMPATIBLE };
    } catch {
      return {
        success: false,
        error:
          `${name} quota service unavailable or incompatible. Install matching MyStatus server and TUI plugins, then restart both.`,
      };
    }
  };
}

/** Both V2 presentation paths use server credentials; V1 keeps local queries. */
export function quotaDependencies(host: unknown): Partial<StatusQueryDependencies> {
  const ctx = host as {
    ui?: { slot?: unknown };
    client: QuotaRpcClient;
    location?: unknown;
    data?: { location: { default: () => unknown } };
  };
  if (typeof ctx?.ui?.slot !== "function") return {};
  const location = () => ctx.location ?? ctx.data?.location.default();
  return {
    queryOpenAI: remoteOpenAIQuery(ctx.client, location),
    querySynthetic: remoteSyntheticQuery(ctx.client, location),
  };
}
