import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import type { PcReport } from "../app/src/pcTasks/protocol.ts";
import type { ClaimedTask, Cooldowns } from "./agents.ts";
export interface PendingReport { task: ClaimedTask; reportId: string; report: PcReport }
export interface LocalState { workerId: string; recoveryHold?: boolean; active?: ClaimedTask; outbox?: PendingReport; cooldowns: Cooldowns }
export async function readState(dir: string): Promise<LocalState> {
  try {
    const state = JSON.parse(await readFile(join(dir, "pc-worker-state.json"), "utf8"));
    if (typeof state.workerId !== "string" || !state.cooldowns || typeof state.cooldowns !== "object") throw new Error("Invalid local worker state; recover it before running more tasks.");
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { workerId: randomUUID(), cooldowns: {} };
    throw e;
  }
}
export async function saveState(dir: string, state: LocalState): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, "pc-worker-state-" + randomUUID() + ".tmp");
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await rename(temp, join(dir, "pc-worker-state.json"));
}
/** OS-owned lock disappears on exit; no stale lock files or PID reuse races. */
export function acquireWorkerLock(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => socket.destroy());
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
