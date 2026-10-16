// Bounded, credential-free status probe shared with the restart helper.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function readWorkerActivity(server: string, request: typeof fetch = fetch) {
  const url = new URL(server);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid worker server URL.");
  const response = await request(new URL("/api/pc/tasks", url), { redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Status returned HTTP " + response.status + ".");
  const value = await response.json();
  const statuses = ["queued", "running", "cancelling", "completed", "partial", "needs_input", "needs_attention", "failed", "cancelled", "done"];
  if (!value || value.protocol !== 2 || typeof value.workerOnline !== "boolean" || !Array.isArray(value.tasks) ||
      (value.workerSeenAt != null && (typeof value.workerSeenAt !== "string" || !Number.isFinite(Date.parse(value.workerSeenAt)))) ||
      !value.tasks.every((task: unknown) => task && typeof task === "object" && statuses.includes((task as {status:string}).status)))
    throw new Error("Invalid worker status; refusing to restart.");
  return { protocol: value.protocol, workerOnline: value.workerOnline, workerSeenAt: value.workerSeenAt,
    tasks: value.tasks.map((task: {status:string}) => ({ status: task.status })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const settings = JSON.parse((await readFile(join(homedir(), ".jarvis", "pc-worker.json"), "utf8")).replace(/^\uFEFF/, ""));
    console.log(JSON.stringify(await readWorkerActivity(settings.server)));
  } catch {
    console.error("Cannot reach Jarvis dev status. Check the Tailscale connection and try again. No restart was confirmed.");
    process.exitCode = 1;
  }
}
