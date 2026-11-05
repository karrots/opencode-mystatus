import { currentLang, getTranslations, type Language } from "./i18n.js";
import { createProgressBar, formatDuration, formatTokens } from "./utils.js";
import type { ProviderID, ProviderStatus, QuotaAccount, QuotaTime, QuotaWindow } from "./quota.js";

export interface PresentationOptions {
  now?: number;
  language?: Language;
  timeZone?: string;
}
interface Presentation {
  now: number;
  language: Language;
  timeZone?: string;
}
export interface QuotaLine {
  text: string;
  tone: "normal" | "muted" | "success" | "warning" | "error";
}
export interface SidebarProvider {
  id: ProviderID;
  title: string;
  accounts: { id: string; name: string; lines: QuotaLine[] }[];
  error?: string;
}

function presentation(options: PresentationOptions): Presentation {
  return { now: options.now ?? Date.now(), language: options.language ?? currentLang, timeZone: options.timeZone };
}

function providerTitle(id: ProviderID, language: Language): string {
  const t = getTranslations(language);
  return {
    openai: t.openaiTitle, zhipu: t.zhipuTitle, zai: t.zaiTitle,
    synthetic: t.syntheticTitle, google: t.googleTitle, copilot: t.copilotTitle,
    configuration: t.configurationTitle,
  }[id];
}

function windowLabel(window: QuotaWindow, language: Language, compact: boolean): string {
  const t = getTranslations(language);
  if (window.kind === "model") return window.name ?? t.unknown;
  if (window.kind === "window") {
    const seconds = window.durationSeconds;
    if (!seconds) return t.unknown;
    const days = Math.round(seconds / 86400);
    const hours = Math.round(seconds / 3600);
    return compact ? (days >= 1 ? `${days}d` : `${hours}h`) : (days >= 1 ? t.dayLimit(days) : t.hourLimit(hours));
  }
  if (compact) return {
    tokens: "5h", mcp: "MCP", search: "Sch", subscription: "Sub",
    premium: "Prem", chat: "Chat", completions: "Comp",
  }[window.kind];
  return {
    tokens: t.zhipuTokensLimit, mcp: t.zhipuMcpLimit,
    search: t.syntheticSearchLimit, subscription: t.syntheticSubscriptionLimit,
    premium: t.premiumRequests, chat: t.chatQuota, completions: t.completionsQuota,
  }[window.kind];
}

function localTime(at: number, view: Presentation): string {
  return new Intl.DateTimeFormat(view.language === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZoneName: "short", timeZone: view.timeZone,
  }).format(at);
}

function timeText(time: QuotaTime, view: Presentation, compact: boolean): string {
  const t = getTranslations(view.language);
  const label = time.kind === "reset" ? t.quotaResets : time.kind === "next-recovery" ? t.nextRecoveryLabel : t.fullRecoveryLabel;
  if (time.at === null) return `${label}: ${t.unknown}`;
  const countdown = time.at <= view.now ? t.awaitingRefresh : formatDuration(Math.ceil((time.at - view.now) / 1000), view.language);
  const relative = time.kind === "reset" && time.at > view.now ? t.resetIn(countdown) : `${label}: ${countdown}`;
  return compact ? relative : `${relative} · ${localTime(time.at, view)}`;
}

function isStale(account: QuotaAccount, view: Presentation): boolean {
  return account.stale === true || account.windows.some((window) => window.times.some((time) => time.at !== null && time.at <= view.now));
}

function accountName(account: QuotaAccount): string {
  return account.plan ? `${account.name} (${account.plan})` : account.name;
}

function accountLines(account: QuotaAccount, view: Presentation, compact: boolean): QuotaLine[] {
  const t = getTranslations(view.language);
  const lines: QuotaLine[] = [];
  const stale = isStale(account, view);
  const add = (text: string, tone: QuotaLine["tone"] = "normal") => lines.push({ text, tone });
  if (account.error) add(`⚠ ${account.error}`, "error");
  if (stale) add(`${t.staleQuota} · ${t.awaitingRefresh}`, "muted");
  if (!account.windows.length && !account.error) add(t.noQuotaData, "muted");
  for (const window of account.windows) {
    const label = windowLabel(window, view.language, compact);
    const remaining = window.remainingPercent;
    const value = window.unlimited ? t.unlimited : remaining === null ? t.noQuotaData
      : `${createProgressBar(remaining, compact ? 8 : 30)} ${compact ? `${remaining}%` : t.remaining(remaining)}`;
    const tone = stale || remaining === null || window.unlimited ? "muted" : remaining > 50 ? "success" : remaining > 20 ? "warning" : "error";
    if (compact) add(`${label} ${value}`, tone);
    else { if (lines.length) add(""); add(label); add(value, tone); }
    if (!compact && (window.used !== undefined || window.total !== undefined)) {
      const count = (n: number | undefined) => n === undefined ? t.unknown : window.unit === "tokens" ? formatTokens(n) : String(n);
      add(`${t.used}: ${count(window.used)} / ${count(window.total)}`);
    }
    if (window.overage) add(`${t.overage}: ${window.overage} ${t.overageRequests}`, "warning");
    for (const time of window.times) add(timeText(time, view, compact), "muted");
  }
  if (account.warning) add(t.limitReached, "warning");
  if (!compact) {
    if (account.modelUsage?.length) {
      add(""); add(t.modelBreakdown);
      for (const item of account.modelUsage) add(`  ${item.name}: ${item.used} ${item.unit}`);
    }
    if (account.billingPeriod) add(`${t.billingPeriod}: ${account.billingPeriod}`);
  }
  return lines;
}

/** Full text and compact display are adapters over the same quota meaning. */
export function formatStatusResults(statuses: ProviderStatus[], options: PresentationOptions = {}): string {
  const view = presentation(options);
  const t = getTranslations(view.language);
  const sections: string[] = [];
  for (const { id, result } of statuses) {
    if (!result) continue;
    const lines = [providerTitle(id, view.language), ""];
    if (!result.success) lines.push(`${t.queryFailed}${result.error}`);
    else if (!result.accounts.length) lines.push(t.noQuotaData);
    else for (const account of result.accounts) {
      lines.push(`${t.account}        ${accountName(account)}`, "", ...accountLines(account, view, false).map((line) => line.text), "");
    }
    sections.push(lines.join("\n").trimEnd());
  }
  return sections.length ? sections.join("\n\n") : t.noAccounts;
}

export function sidebarProviders(statuses: ProviderStatus[], options: PresentationOptions = {}): SidebarProvider[] {
  const view = presentation(options);
  return statuses.flatMap(({ id, result }) => {
    if (!result) return [];
    const title = providerTitle(id, view.language).replace(/^##\s*/, "");
    if (!result.success) return [{ id, title, accounts: [], error: result.error }];
    const accounts = result.accounts.map((account) => ({ id: account.id, name: accountName(account), lines: accountLines(account, view, true) }));
    if (!accounts.length) accounts.push({ id: "no-data", name: "", lines: [{ text: getTranslations(view.language).noQuotaData, tone: "muted" }] });
    return [{ id, title, accounts }];
  });
}
