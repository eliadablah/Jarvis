// Runtime settings, read once from environment variables.
// The deploy sets APP_ENV and APP_VERSION so each page shows which
// environment and which commit it's running; the CLAUDE_* settings control
// how the chat talks to Claude Code.

export type AppEnv = "local" | "dev" | "prod";

export interface ClaudeConfig {
  /** Path or name of the Claude Code program. */
  bin: string;
  /** Model alias or full model name passed to --model. */
  model: string;
  /** File appended to Claude Code's system prompt (the Jarvis persona). */
  personaPath: string;
  /** Folder Claude Code runs in. Empty for now; the vault goes here later. */
  workDir: string;
  /** Hard stop for one answer, in milliseconds. */
  timeoutMs: number;
}

export interface AppConfig {
  port: number;
  env: AppEnv;
  version: string;
  /** Folder holding the ai-visualizer files (core.js, faces/, assets/). */
  visualizerDir: string;
  claude: ClaudeConfig;
  codex?: CodexConfig;
  gemini?: GeminiConfig;
  /** Shared secret for the PC worker (pc-worker/). Empty turns PC errands off. */
  pcWorkerToken: string;
  /** Read-only Google Sheets job tracker. Off until both the sheet ID and the service account key are set. */
  jobTracker: { sheetId: string; range: string; serviceAccountB64: string };
  /** The daily morning job run queued by the server (see schedules/morning.ts). */
  morningRun: { time: string; count: number; timezone: string };
}

export interface CodexConfig { enabled: boolean; bin: string; model: string; connectorsEnabled?: boolean; }

export interface GeminiConfig {
  /** On only when an API key is present (and not switched off). */
  enabled: boolean;
  apiKey: string;
  model: string;
  /** Tried once when the main model is overloaded or rate-limited (HTTP 429/500/503). */
  fallbackModel: string;
  /** Send vault excerpts and dashboard tasks to Gemini. Off by default: on Google's free tier, prompts may be used for training. */
  shareVault: boolean;
}

const APP_ENVS: readonly AppEnv[] = ["local", "dev", "prod"];

/** Parses APP_ENV, falling back to "local" for anything unexpected. */
function parseEnv(value: string | undefined): AppEnv {
  return APP_ENVS.find((env) => env === value) ?? "local";
}

/** Parses a positive integer, falling back to a default. */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

/** Builds the config from process.env (or a stand-in, for tests). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePositiveInt(source.PORT, 3000),
    env: parseEnv(source.APP_ENV),
    version: source.APP_VERSION?.trim() || "unknown",
    visualizerDir: source.VISUALIZER_DIR?.trim() || "visualizer",
    codex: { connectorsEnabled: source.CODEX_CONNECTORS_ENABLED === "true", enabled: source.CODEX_ENABLED === "true", bin: source.CODEX_BIN?.trim() || "codex", model: source.CODEX_MODEL?.trim() || "" },
    gemini: {
      enabled: Boolean(source.GEMINI_API_KEY?.trim()) && source.GEMINI_ENABLED !== "false",
      apiKey: source.GEMINI_API_KEY?.trim() || "",
      model: source.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      fallbackModel: source.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.5-flash-lite",
      shareVault: source.GEMINI_SHARE_VAULT === "true",
    },
    pcWorkerToken: source.PC_WORKER_TOKEN?.trim() || "",
    morningRun: {
      time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(source.MORNING_RUN_TIME?.trim() ?? "") ? source.MORNING_RUN_TIME!.trim() : "07:00",
      // 25 is the most one PC task may submit.
      count: Math.min(25, parsePositiveInt(source.MORNING_RUN_COUNT, 10)),
      timezone: source.MORNING_RUN_TZ?.trim() || "America/Chicago",
    },
    jobTracker: {
      sheetId: source.JOB_TRACKER_SHEET_ID?.trim() || "",
      // No tab name means "the first tab", so renaming the tab can't break it.
      range: source.JOB_TRACKER_RANGE?.trim() || "A1:L1000",
      serviceAccountB64: source.GOOGLE_SERVICE_ACCOUNT_B64?.trim() || "",
    },
    claude: {
      bin: source.CLAUDE_BIN?.trim() || "claude",
      model: source.CLAUDE_MODEL?.trim() || "opus",
      personaPath: source.JARVIS_PERSONA_PATH?.trim() || "persona/jarvis.md",
      workDir: source.JARVIS_WORKDIR?.trim() || process.cwd(),
      timeoutMs: parsePositiveInt(source.CHAT_TIMEOUT_MS, 5 * 60 * 1000),
    },
  };
}
