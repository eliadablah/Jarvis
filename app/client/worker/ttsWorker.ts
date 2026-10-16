// Background thread that runs the Kokoro voice model (bm_lewis, the same
// British voice as Jarvis's local backtalk), so generating speech never
// freezes the face's animation.
//
// Messages in:  {type: "load"} | {type: "speak", id, text}
// Messages out: {type: "progress", percent} | {type: "ready"} |
//               {type: "audio", id, samples, rate, ms} | {type: "error", id?, message}
// ms is how long generating that sentence took, so the page can tell
// whether this device keeps up in real time.

import type * as Kokoro from "kokoro-js";

type KokoroTTS = Kokoro.KokoroTTS;

// Kokoro's browser build, served by Jarvis itself (copied from kokoro-js
// 1.2.1 at build time). Typed with the package's own definitions.
// Imported on first use, NOT at the top level: a top-level await would
// delay the message listener below, and the page's first message would
// arrive with nobody listening.
const KOKORO_URL: string = "/voice/kokoro.web.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "bm_lewis";

let tts: KokoroTTS | undefined;
let loading: Promise<KokoroTTS> | undefined;

/** Imports the engine, then loads the model once, reporting download progress. */
function load(): Promise<KokoroTTS> {
  if (tts) return Promise.resolve(tts);
  if (!loading) {
    loading = (import(KOKORO_URL) as Promise<typeof Kokoro>).then(({ KokoroTTS, env }) => {
      // The speech engine's runtime files are served by Jarvis itself, not a CDN.
      env.wasmPaths = "/voice/";
      return KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
        progress_callback: (p: { status: string; file?: string; progress?: number }) => {
          if (p.status === "progress" && typeof p.progress === "number" && p.file?.endsWith(".onnx")) {
            postMessage({ type: "progress", percent: Math.round(p.progress) });
          }
        },
      });
    }).then((model: KokoroTTS) => {
      tts = model;
      postMessage({ type: "ready" });
      return model;
    });
  }
  return loading;
}

// Speak requests run one at a time, in order.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<{ type: "load" } | { type: "speak"; id: number; text: string }>) => {
  const msg = event.data;
  if (msg.type === "load") {
    load().catch((err: unknown) => postMessage({ type: "error", message: String(err) }));
    return;
  }

  queue = queue.then(async () => {
    try {
      const model = await load();
      const started = performance.now();
      const audio = await model.generate(msg.text, { voice: VOICE });
      const samples = audio.audio;
      const ms = performance.now() - started;
      postMessage({ type: "audio", id: msg.id, samples, rate: audio.sampling_rate, ms }, [samples.buffer]);
    } catch (err) {
      postMessage({ type: "error", id: msg.id, message: String(err) });
    }
  });
};
