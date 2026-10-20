import type { TrackerSnapshot } from "./tracker.ts";

/** Shared reader cache; only data/status changes cause a browser notification. */
export function trackerChangeCheck(read: () => Promise<TrackerSnapshot>, notify: () => void) {
  let previous = "", running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      let current: string;
      try {
        const { summary, jobs, stale } = await read();
        current = JSON.stringify({ summary, jobs, stale: Boolean(stale) });
      } catch { current = "unavailable"; }
      if (current !== previous) { previous = current; notify(); }
    } finally { running = false; }
  };
}
