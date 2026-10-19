import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { WorkerSettings } from "./agents.ts";
export const JOB_FILE_TOOLS = ["read_text", "read_pdf", "list_files", "append_application_log"];
export function jobFilesMcp(settings?: WorkerSettings, action = "search") {
  if (!settings?.jobsDir) return undefined;
  return { command: process.execPath, args: [fileURLToPath(new URL("./job-files-server.ts", import.meta.url))], env: {
    JARVIS_JOBS_ROOT: settings.jobsDir, JARVIS_RESUMES_ROOT: join(homedir(), "Desktop", "Resumes"),
    JARVIS_PDF_RUNTIME: join(homedir(), ".jarvis", "job-files"),
    JARVIS_JOB_ACTION: action,
  } };
}
export function jobFilesCodexArgs(settings?: WorkerSettings, action = "search"): string[] {
  const server = jobFilesMcp(settings, action); if (!server) return [];
  return ["-c", "mcp_servers.jarvis-job-files.command=" + JSON.stringify(server.command),
    "-c", "mcp_servers.jarvis-job-files.args=" + JSON.stringify(server.args),
    ...Object.entries(server.env).flatMap(([key, value]) => ["-c", "mcp_servers.jarvis-job-files.env." + key + "=" + JSON.stringify(value)]),
    "-c", "mcp_servers.jarvis-job-files.enabled_tools=" + JSON.stringify(JOB_FILE_TOOLS.filter(name => name !== "append_application_log" || action === "submit")),
    "-c", "mcp_servers.jarvis-job-files.required=true"];
}
