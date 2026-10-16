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
    claude: {
      bin: source.CLAUDE_BIN?.trim() || "claude",
      model: source.CLAUDE_MODEL?.trim() || "opus",
      personaPath: source.JARVIS_PERSONA_PATH?.trim() || "persona/jarvis.md",
      workDir: source.JARVIS_WORKDIR?.trim() || process.cwd(),
      timeoutMs: parsePositiveInt(source.CHAT_TIMEOUT_MS, 5 * 60 * 1000),
    },
  };
}
