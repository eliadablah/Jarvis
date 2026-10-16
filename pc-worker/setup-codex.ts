// Private, standalone Codex runtime for the Windows worker. Never writes the desktop app config.
import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { rootCertificates } from "node:tls";
const VERSION = "0.163.0";
export async function setupCodex(root = join(homedir(), ".jarvis")): Promise<{codexBin: string; codexHome: string}> {
  if (process.platform !== "win32" || !["x64", "arm64"].includes(process.arch)) throw new Error("This installer supports Windows x64/arm64.");
  const tools = join(root, "tools"), codexHome = join(root, "codex");
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const codexBin = join(tools, "node_modules", "@openai", "codex-win32-" + process.arch, "vendor", arch + "-pc-windows-msvc", "bin", "codex.exe");
  let installed = false;
  try { installed = JSON.parse(await readFile(join(tools, "node_modules", "@openai", "codex", "package.json"), "utf8")).version === VERSION; await access(codexBin); }
  catch { installed = false; }
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  if (!installed) {
    const npm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [npm, "install", "--prefix", tools, "--cache", join(root, "npm-cache"),
        "--no-audit", "--no-fund", "--ignore-scripts", "@openai/codex@" + VERSION], { stdio: "inherit", windowsHide: true });
      child.once("error", reject); child.once("close", resolve);
    });
    if (code !== 0) throw new Error("Standalone Codex installation failed.");
  }
  await writeFile(join(codexHome, "ca-bundle.pem"), rootCertificates.join("\n"), { mode: 0o600 });
  try { await access(join(codexHome, "auth.json")); }
  catch {
    // Same account, same official service. No credential is printed or committed.
    try { await copyFile(join(homedir(), ".codex", "auth.json"), join(codexHome, "auth.json")); }
    catch { console.log("Sign in to the isolated Codex runtime before using its worker adapter."); }
  }
  return { codexBin, codexHome };
}
if (import.meta.main) {
  const settingsPath = join(homedir(), ".jarvis", "pc-worker.json");
  const settings = JSON.parse((await readFile(settingsPath, "utf8")).replace(/^\uFEFF/, ""));
  Object.assign(settings, await setupCodex());
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  console.log("Standalone Codex configured. Existing worker token and workspace aliases preserved.");
}
