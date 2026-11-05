import { z } from "zod";

// This is also the wire contract. Credentials and raw provider responses never
// belong here; strict objects reject accidental additions on the remote seam.
const timestamp = z.number().min(0).max(8.64e15);
const timeSchema = z.strictObject({
  kind: z.enum(["reset", "next-recovery", "full-recovery"]),
  at: timestamp.nullable(),
});
const windowSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["window", "tokens", "mcp", "search", "subscription", "premium", "chat", "completions", "model"]),
  name: z.string().optional(),
  durationSeconds: z.number().positive().optional(),
  remainingPercent: z.number().min(0).max(100).nullable(),
  unlimited: z.boolean(),
  used: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  unit: z.enum(["tokens", "requests"]).optional(),
  overage: z.number().nonnegative().optional(),
  times: z.array(timeSchema),
});
const accountSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  plan: z.string().optional(),
  observedAt: timestamp,
  windows: z.array(windowSchema),
  error: z.string().optional(),
  stale: z.boolean().optional(),
  warning: z.boolean().optional(),
  billingPeriod: z.string().optional(),
  modelUsage: z.array(z.strictObject({
    name: z.string(), used: z.number().nonnegative(), unit: z.string(),
  })).optional(),
});
export const queryResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), accounts: z.array(accountSchema) }),
  z.strictObject({ success: z.literal(false), error: z.string() }),
]);
export type QuotaTime = z.infer<typeof timeSchema>;
export type QuotaWindow = z.infer<typeof windowSchema>;
export type QuotaAccount = z.infer<typeof accountSchema>;
export type QuotaResult = z.infer<typeof queryResultSchema>;
export type ProviderID = "openai" | "zhipu" | "zai" | "synthetic" | "google" | "copilot" | "configuration";
export interface ProviderStatus {
  id: ProviderID;
  result: QuotaResult | null;
}

/** Missing/nonfinite values are unknown, never an exhausted allowance. */
export function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value * 10) / 10))
    : null;
}

export function remainingPercent(used: unknown): number | null {
  return typeof used === "number" && Number.isFinite(used) ? percent(100 - used) : null;
}

export function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Absolute timestamps use milliseconds everywhere, including RPC. */
export function reportedAt(value: unknown): number | null {
  const millis = typeof value === "string" ? Date.parse(value) : value;
  return typeof millis === "number" && Number.isFinite(millis) && millis >= 0 && millis <= 8.64e15 ? millis : null;
}

export function relativeReset(seconds: unknown, observedAt: number): number | null {
  const value = nonnegative(seconds);
  return value === undefined ? null : reportedAt(observedAt + value * 1000);
}

/** Retain failed readings only as stale history; successful reads replace them. */
export function applyQuotaRefresh(previous: ProviderStatus[], next: ProviderStatus[]): ProviderStatus[] {
  return next.map((status) => {
    const old = previous.find((item) => item.id === status.id)?.result;
    const result = status.result;
    if (!old?.success || !result) return status;
    if (!result.success) {
      if (!old.accounts.length) return status;
      return { ...status, result: { success: true, accounts: old.accounts.map((account) => ({ ...account, stale: true, error: result.error })) } };
    }
    return { ...status, result: { success: true, accounts: result.accounts.map((account) => {
      if (!account.error) return account;
      const last = old.accounts.find((item) => item.id === account.id);
      return last ? { ...last, error: account.error, stale: true } : account;
    }) } };
  });
}
