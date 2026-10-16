// Turns a job-hunting chat message into a queued PC errand and the reply
// Jarvis gives straight away. The actual work happens on my PC.

import { randomUUID } from "node:crypto";
import type { ChatEvent } from "../brain/events.ts";
import { enqueuePcTask, readPcTasks, workerOnline } from "./store.ts";

export async function* handOffJobErrand(dir: string, message: string, sessionId: string | undefined): AsyncGenerator<ChatEvent> {
  const online = workerOnline(await readPcTasks(dir));
  await enqueuePcTask(dir, message);
  yield {
    type: "text",
    text: online
      ? "On it, sir. I've handed this to your PC. It's working in your Chrome now, using your profile, answer bank and tracker. Ask me \"how did the job applying go?\" for the report."
      : "Queued, sir. Your PC worker looks offline right now, so this starts as soon as your PC is on and you're signed in. Ask me \"how did the job applying go?\" later for the report.",
  };
  yield { type: "done", sessionId: sessionId ?? randomUUID() };
}
