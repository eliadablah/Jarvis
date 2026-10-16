import { spawnSync } from "node:child_process";
import { mkdir, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
export const WINDOWS_MCP_VERSION = "0.8.8";
export async function setupDesktop(): Promise<void> {
  if (process.platform !== "win32") throw new Error("The desktop worker runs on Windows.");
  const root = join(homedir(), ".jarvis"), command = join(root, "bin", "windows-mcp.exe");
  await mkdir(root, { recursive: true });
  let installed = true; try { await access(command); } catch { installed = false; }
  if (!installed) {
    const uv = join(homedir(), ".local", "bin", "uv.exe");
    await access(uv).catch(() => { throw new Error("Install the official uv package manager first, then rerun desktop setup."); });
    const result = spawnSync(uv, ["tool", "install", "--python", "3.14", "windows-mcp==" + WINDOWS_MCP_VERSION], {
      stdio: "inherit", windowsHide: true,
      env: { ...process.env, UV_CACHE_DIR: join(root, "uv-cache"), UV_TOOL_DIR: join(root, "windows-tools"), UV_TOOL_BIN_DIR: join(root, "bin"), UV_PYTHON_INSTALL_DIR: join(root, "python"), ANONYMIZED_TELEMETRY: "false" },
    });
    if (result.error || result.status !== 0) throw new Error("Windows desktop adapter installation failed.");
  }
  await access(command);
  await writeFile(join(root, "desktop-runtime.json"), JSON.stringify({ windowsMcpCommand: command, version: WINDOWS_MCP_VERSION, transport: "stdio", telemetry: false }, null, 2), { mode: 0o600 });
  console.log("Windows action tools installed and configured privately. Restart the idle PC worker to activate them.");
}
if (import.meta.main) await setupDesktop();
