import type { WorkerSettings } from "./agents.ts";
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
    "-c", 'mcp_servers.jarvis-windows.env.ANONYMIZED_TELEMETRY="false"',
    "-c", 'mcp_servers.jarvis-windows.env.WINDOWS_MCP_WATCHDOG="false"',
    "-c", "mcp_servers.jarvis-windows.startup_timeout_sec=45", "-c", "mcp_servers.jarvis-windows.tool_timeout_sec=120"];
}
