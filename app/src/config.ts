// Runtime settings, read once from environment variables.
// The deploy sets APP_ENV and APP_VERSION so each page shows which
// environment and which commit it's running.

export type AppEnv = "local" | "dev" | "prod";

export interface AppConfig {
  port: number;
  env: AppEnv;
  version: string;
}

const APP_ENVS: readonly AppEnv[] = ["local", "dev", "prod"];

/** Parses APP_ENV, falling back to "local" for anything unexpected. */
function parseEnv(value: string | undefined): AppEnv {
  return APP_ENVS.find((env) => env === value) ?? "local";
}

/** Builds the config from process.env (or a stand-in, for tests). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(source.PORT ?? "3000", 10);

  return {
    port: Number.isNaN(port) ? 3000 : port,
    env: parseEnv(source.APP_ENV),
    version: source.APP_VERSION?.trim() || "unknown",
  };
}
