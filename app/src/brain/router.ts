// Routing uses the task and observed refusals. Neither CLI exposes account
// token balances, so remainingTokens deliberately stays unknown.
import type { AppConfig } from "../config.ts";
import type { ChatRequest } from "../api/chatRequest.ts";
import { askClaude } from "./claudeCode.ts";
import { askCodex } from "./codex.ts";
import { askGemini } from "./gemini.ts";
import { CHAT_PROVIDERS, type ChatEvent, type ChatFailureCode, type ChatProvider } from "./events.ts";
import { connectorScope } from "./connectorConfig.ts";

export interface ChatEngine {
  enabled: boolean;
  /** This adapter may read the user's live Gmail/Calendar account. */
  accountAccess?: boolean;
  ask(message: string, sessionId: string | undefined, signal: AbortSignal, serverContext?: string): AsyncIterable<ChatEvent>;
}

export interface RoutingStatus {
  provider: ChatProvider;
  state: "ready" | "disabled" | "cooldown";
  available: boolean;
  reason: string;
  retryAt?: string;
  remainingTokens: null;
}

interface FailureState { code: ChatFailureCode; until: number; }
interface RoutingOptions {
  now?: () => number;
  quotaCooldownMs?: number;
  failureCooldownMs?: number;
}

const LABELS: Record<ChatProvider, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
const label = (provider: ChatProvider): string => LABELS[provider];
/** Order Auto tries the remaining engines in after its first choice. Gemini is the last resort. */
const FALLBACK_ORDER: readonly ChatProvider[] = ["claude", "codex", "gemini"];

/** Classify the refusal without returning CLI diagnostics or credentials. */
export function classifyProviderFailure(message: string): ChatFailureCode {
  if (/quota|rate.?limit|usage.?limit|insufficient_quota|limit.{0,24}(reached|exceeded)|out of.{0,12}(usage|credits)|too many requests|429|hit your.{0,12}limit/i.test(message)) return "quota";
  if (/authenticat|unauthori[sz]ed|sign.?in|log.?in|invalid.{0,12}(token|credential)|token.{0,12}expired|401|403/i.test(message)) return "authentication";
  return "unavailable";
}

/** A transparent task preference, with live refusal state checked separately. */
export function preferredProvider(message: string): { provider: ChatProvider; reason: string } {
  if (requiresAccountAccess(message)) return { provider: "codex", reason: "Codex selected for connected account reads." };
  if (/\b(jobs?|apply|applying|application|resume|cv|cover letter|interview|linkedin|career|hiring)\b/i.test(message)) {
    return { provider: "claude", reason: "Claude selected for job search and applications." };
  }
  if (/\b(code|coding|debug|typescript|javascript|python|repository|repo|deploy|terraform|docker|api|implement|refactor|tests?)\b/i.test(message)) {
    return { provider: "codex", reason: "Codex selected for technical work." };
  }
  if (/\b(email|inbox|summari[sz]e|rewrite|writing|draft|plan|planning|schedule|calendar|brief|research|compare)\b/i.test(message)) {
    return { provider: "claude", reason: "Claude selected for writing and planning." };
  }
  return { provider: "codex", reason: "Codex selected for everyday assistance." };
}

/** A provider without account tools cannot silently replace one that has them. */
export function requiresAccountAccess(message: string): boolean {
  return connectorScope(message) !== "none";
}

function failureMessage(provider: ChatProvider, code: ChatFailureCode, partial: boolean): string {
  if (partial) return `${label(provider)} stopped before finishing its answer. Please try again.`;
  if (code === "quota") return `${label(provider)} reported a usage limit. Try again later or choose another engine.`;
  if (code === "authentication") return `${label(provider)} needs its server sign-in renewed. Choose another engine for now.`;
  return `${label(provider)} could not answer. Please try again or choose another engine.`;
}

/** Cooldowns are bounded, and a manual selection can explicitly retry early. */
export class ChatRouter {
  private readonly engines: Partial<Record<ChatProvider, ChatEngine>>;
  private readonly failures = new Map<ChatProvider, FailureState>();
  private readonly now: () => number;
  private readonly quotaCooldownMs: number;
  private readonly failureCooldownMs: number;

  constructor(engines: Partial<Record<ChatProvider, ChatEngine>>, options: RoutingOptions = {}) {
    this.engines = engines;
    this.now = options.now ?? Date.now;
    this.quotaCooldownMs = options.quotaCooldownMs ?? 15 * 60_000;
    this.failureCooldownMs = options.failureCooldownMs ?? 60_000;
  }

  status(): RoutingStatus[] {
    return CHAT_PROVIDERS.filter(provider => this.engines[provider]).map(provider => {
      if (!this.engines[provider]!.enabled) return { provider, state: "disabled", available: false,
        reason: "Not enabled on this server.", remainingTokens: null };
      const failure = this.failures.get(provider);
      if (failure && failure.until > this.now()) return { provider, state: "cooldown", available: false,
        reason: failure.code === "quota" ? "Usage limit reported; waiting before retrying."
          : failure.code === "authentication" ? "Server sign-in needs attention." : "Recent request failed; retrying shortly.",
        retryAt: new Date(failure.until).toISOString(), remainingTokens: null };
      this.failures.delete(provider);
      return { provider, state: "ready", available: true,
        reason: "No recent refusal. Remaining account tokens are not exposed by this CLI.", remainingTokens: null };
    });
  }

  private markFailure(provider: ChatProvider, code: ChatFailureCode): void {
    this.failures.set(provider, { code, until: this.now() + (code === "quota" ? this.quotaCooldownMs : this.failureCooldownMs) });
  }

  async *answer(chat: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    if (signal.aborted) { yield { type: "error", message: "Request cancelled." }; return; }
    const automatic = chat.provider === "auto";
    const preference = automatic ? preferredProvider(chat.message)
      : { provider: chat.provider ?? "claude", reason: "Selected by you." } as { provider: ChatProvider; reason: string };
    const needsAccountAccess = requiresAccountAccess(chat.message);
    const supportsTask = (provider: ChatProvider) => !needsAccountAccess || this.engines[provider]?.accountAccess === true;
    if (!automatic && !supportsTask(preference.provider)) {
      yield { type: "error", message: "Connected account reads need Codex with Gmail and Calendar enabled. Choose Auto or Codex." };
      return;
    }
    const statuses = this.status();
    const isReady = (provider: ChatProvider) => supportsTask(provider) && statuses.some(status => status.provider === provider && status.available);
    const others = FALLBACK_ORDER.filter(provider => provider !== preference.provider);
    const attempts: ChatProvider[] = automatic ? [preference.provider, ...others] : [preference.provider];
    let previousFailure: ChatProvider | undefined;
    let lastFailure: { provider: ChatProvider; code: ChatFailureCode } | undefined;

    for (const provider of attempts) {
      const engine = this.engines[provider];
      if (!engine || !supportsTask(provider) || !engine.enabled || (automatic && !isReady(provider))) continue;
      const reason = previousFailure ? `${label(previousFailure)} could not answer; switching to ${label(provider)}.`
        : provider !== preference.provider ? `${label(preference.provider)} is unavailable; using ${label(provider)}.` : preference.reason;
      yield { type: "engine", provider, reason };
      // Legacy sessionId belongs only to its explicit provider (or Claude
      // when no provider was sent), never to an automatic fallback.
      const sessionId = chat.sessions?.[provider]
        ?? (!automatic && provider === (chat.provider ?? "claude") ? chat.sessionId : undefined);
      let emittedText = false;
      let failure: ChatFailureCode | undefined;
      try {
        for await (const event of engine.ask(chat.message, sessionId, signal, chat.serverContext)) {
          if (signal.aborted) { yield { type: "error", message: "Request cancelled." }; return; }
          if (event.type === "text") {
            if (event.text) { emittedText = true; yield event; }
          } else if (event.type === "done") {
            this.failures.delete(provider);
            yield { ...event, provider };
            return;
          } else if (event.type === "error") {
            failure = event.code ?? classifyProviderFailure(event.message);
            break;
          }
        }
      } catch (error) {
        failure = classifyProviderFailure(error instanceof Error ? error.message : "");
      }
      if (signal.aborted) { yield { type: "error", message: "Request cancelled." }; return; }
      failure ??= "unavailable";
      this.markFailure(provider, failure);
      lastFailure = { provider, code: failure };
      if (emittedText || !automatic) {
        yield { type: "error", message: failureMessage(provider, failure, emittedText), code: failure };
        return;
      }
      previousFailure = provider;
    }

    if (lastFailure) yield { type: "error", message: failureMessage(lastFailure.provider, lastFailure.code, false), code: lastFailure.code };
    else yield { type: "error", message: this.nothingTriedMessage(needsAccountAccess, statuses) };
  }

  /** Explains why no engine was tried, instead of a generic sign-in hint. */
  private nothingTriedMessage(needsAccountAccess: boolean, statuses: RoutingStatus[]): string {
    const describe = (status: RoutingStatus): string => {
      const minutes = status.retryAt ? Math.max(1, Math.ceil((Date.parse(status.retryAt) - this.now()) / 60_000)) : undefined;
      const wait = minutes ? ` It will be tried again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` : "";
      return `${label(status.provider)} ${status.reason.charAt(0).toLowerCase()}${status.reason.slice(1).replace(/\.$/, "")}.${wait}`;
    };
    if (needsAccountAccess) {
      const accountStatus = statuses.find(status => this.engines[status.provider]?.accountAccess === true);
      if (!accountStatus) return "Gmail and Calendar aren't connected on this server.";
      const others = statuses.filter(status => status.provider !== accountStatus.provider).map(status => label(status.provider));
      const noAccess = others.length ? ` ${others.join(" and ")} can't read your accounts yet.` : "";
      return `Gmail and Calendar go through ${label(accountStatus.provider)}. ${describe(accountStatus)}${noAccess}`;
    }
    const unavailable = statuses.filter(status => !status.available);
    return unavailable.length ? unavailable.map(describe).join(" ") : "No chat engine is available right now. Try again shortly.";
  }
}

const routers = new WeakMap<AppConfig, ChatRouter>();

export function getChatRouter(config: AppConfig): ChatRouter {
  let router = routers.get(config);
  if (!router) {
    router = new ChatRouter({
      claude: { enabled: Boolean(config.claude.bin.trim()), ask: (message, sessionId, signal, serverContext) => askClaude(config.claude, message, sessionId, signal, serverContext) },
      codex: { enabled: Boolean(config.codex?.enabled), accountAccess: config.codex?.connectorsEnabled === true,
        ask: (message, sessionId, signal, serverContext) => askCodex(config.codex!, config.claude, message, sessionId, signal, serverContext) },
      gemini: { enabled: Boolean(config.gemini?.enabled),
        ask: (message, sessionId, signal, serverContext) => askGemini(config.gemini!, config.claude, message, sessionId, signal, serverContext) },
    });
    routers.set(config, router);
  }
  return router;
}

export function getRoutingStatus(config: AppConfig): RoutingStatus[] { return getChatRouter(config).status(); }
