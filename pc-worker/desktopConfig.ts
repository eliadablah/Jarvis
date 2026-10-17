import type { WorkerSettings } from "./agents.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
/** Pinned private stdio server. Nothing listens on a network port. */
export const WINDOWS_TOOLS = ["ControlStatus", "App", "Snapshot", "Screenshot", "Click", "Type", "Scroll", "Move", "Shortcut", "Wait", "WaitFor", "MultiSelect", "MultiEdit", "Clipboard", "FileSystem", "PowerShell", "Process", "Notification"];
export function desktopMcp(settings?: WorkerSettings) {
  if (!settings?.windowsMcpCommand) return undefined;
  return { command: settings.windowsMcpCommand, alwaysLoad: true, args: ["serve", "--transport", "stdio", "--exclude-tools", "Registry,DisplayInventory,Scrape"],
    env: { ANONYMIZED_TELEMETRY: "false", WINDOWS_MCP_WATCHDOG: "false" } };
}
export function desktopCodexArgs(settings?: WorkerSettings): string[] {
  const server = desktopMcp(settings); if (!server) return [];
  return ["-c", "mcp_servers.jarvis-windows.command=" + JSON.stringify(server.command),
    "-c", "mcp_servers.jarvis-windows.args=" + JSON.stringify(server.args),
    "-c", "mcp_servers.jarvis-windows.enabled_tools=" + JSON.stringify(WINDOWS_TOOLS),
    "-c", "mcp_servers.jarvis-windows.required=true",
    "-c", 'mcp_servers.jarvis-windows.env.ANONYMIZED_TELEMETRY="false"',
    "-c", 'mcp_servers.jarvis-windows.env.WINDOWS_MCP_WATCHDOG="false"',
    "-c", "mcp_servers.jarvis-windows.startup_timeout_sec=45", "-c", "mcp_servers.jarvis-windows.tool_timeout_sec=120"];
}

/** Claude Code 2.1.301's internal stdio bridge; recheck on CLI upgrades. */
export const CHROME_TOOLS = ["read_page", "find", "form_input", "computer", "browser_batch", "navigate", "get_page_text", "tabs_context_mcp", "tabs_create_mcp", "tabs_close_mcp", "file_upload", "list_connected_browsers", "select_browser", "switch_browser"];
export function chromeCodexArgs(settings?: WorkerSettings): string[] {
  if (!settings?.claudeBin) return [];
  const command = settings.chromeMcpPython ?? settings.claudeBin;
  const args = settings.chromeMcpPython ? [fileURLToPath(new URL("./chrome_bridge.py", import.meta.url)), "--claude-bin", settings.claudeBin,
    "--upload-root", join(homedir(), "Desktop", "Resumes"), "--upload-root", join(settings.jobsDir, "documents", "cv"), "--enabled-tools", JSON.stringify(CHROME_TOOLS)] : ["--claude-in-chrome-mcp"];
  return ["-c", "mcp_servers.jarvis-chrome.command=" + JSON.stringify(command),
    "-c", "mcp_servers.jarvis-chrome.args=" + JSON.stringify(args),
    "-c", "mcp_servers.jarvis-chrome.enabled_tools=" + JSON.stringify(CHROME_TOOLS),
    "-c", "mcp_servers.jarvis-chrome.required=true",
    "-c", "mcp_servers.jarvis-chrome.startup_timeout_sec=30",
    "-c", "mcp_servers.jarvis-chrome.tool_timeout_sec=120"];
}
