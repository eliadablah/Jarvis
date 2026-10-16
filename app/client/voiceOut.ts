// Jarvis's mouth in the browser. Each sentence is spoken in order by one of
// two engines:
//   Kokoro bm_lewis (the same voice as local backtalk), in a Web Worker,
//     with the real audio waveform driving the face
//   the browser's own British voice (browserVoice.ts), instantly
// Kokoro is used once it's loaded and as long as this device generates
// speech at least as fast as it plays. If a sentence takes too long, or
// generation is slower than real time, Jarvis switches to the browser
// voice so it never sits on "thinking". The verdict is remembered per
// device; turning the voice off and on in the menu tries Kokoro again.

import { setState, setWaveform } from "./bus.js";
import { browserVoiceSupported, speakWithBrowser, stopBrowserVoice } from "./browserVoice.js";

type Audio = { samples: Float32Array; rate: number; ms: number };

type WorkerMessage =
  | { type: "progress"; percent: number }
  | { type: "ready" }
  | ({ type: "audio"; id: number } & Audio)
  | { type: "error"; id?: number; message: string };

export type VoiceStatus = { kind: "loading"; percent: number } | { kind: "ready" } | { kind: "failed" };

/** A Kokoro sentence that isn't back within this time goes to the browser voice. */
const KOKORO_WAIT_MS = 6000;
/** Generation slower than this many times the audio length means "too slow". */
const MAX_REALTIME_FACTOR = 1.2;
const SLOW_KEY = "jarvis.kokoroSlow";

function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function remember(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

export class VoiceOut {
  private worker: Worker | undefined;
  private ctx: AudioContext | undefined;
  private analyser: AnalyserNode | undefined;
  private frame = new Float32Array(512);
  private nextId = 1;
  private pending = new Map<number, (audio: Audio | undefined) => void>();
  private playChain: Promise<void> = Promise.resolve();
  private current: AudioBufferSourceNode | undefined;
  private generation = 0;
  private outstanding = 0;
  private kokoroReady = false;
  private kokoroFailed = false;
  private kokoroSlow = remembered(SLOW_KEY);
  enabled = true;

  constructor(private readonly onStatus: (status: VoiceStatus) => void) {}

  /** Starts loading Kokoro in the background (first visit downloads ~92 MB, then it's cached). */
  load(): void {
    if (this.worker || this.kokoroFailed || this.kokoroSlow) return;
    try {
      this.worker = new Worker("/worker/ttsWorker.js", { type: "module" });
    } catch {
      this.failKokoro();
      return;
    }
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
    this.worker.onerror = () => this.failKokoro();
    this.onStatus({ kind: "loading", percent: 0 });
    this.worker.postMessage({ type: "load" });
  }

  /** Gives Kokoro another chance on this device (used when the voice is switched back on). */
  retryKokoro(): void {
    this.kokoroSlow = false;
    remember(SLOW_KEY, false);
    this.load();
  }

  /** Must be called from a click or key press: browsers only allow audio after one. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  /** True while sentences are still being generated or played. */
  get busy(): boolean {
    return this.outstanding > 0;
  }

  /** Queues one sentence to be spoken after the ones before it. */
  speak(text: string, onAllDone: () => void): void {
    if (!this.enabled || !text) return;
    const useKokoro = this.kokoroReady && !this.kokoroSlow && !this.kokoroFailed && !!this.worker;
    if (!useKokoro && !browserVoiceSupported()) return;

    const generation = this.generation;
    this.outstanding++;
    const kokoroAudio = useKokoro ? this.requestKokoro(text) : undefined;

    this.playChain = this.playChain
      .then(async () => {
        if (generation !== this.generation || !this.enabled) return;
        if (kokoroAudio) {
          const audio = await kokoroAudio;
          if (generation !== this.generation || !this.enabled) return;
          if (audio) {
            this.judgeSpeed(audio);
            await this.play(audio);
            return;
          }
          this.markSlow(); // didn't arrive in time
        }
        if (browserVoiceSupported()) {
          setState("speaking");
          await speakWithBrowser(text);
          if (generation === this.generation) setState("thinking");
        }
      })
      .finally(() => {
        this.outstanding--;
        if (generation === this.generation && this.outstanding === 0) onAllDone();
      });
  }

  /** Stops speaking right away and drops anything queued. */
  stop(): void {
    this.generation++;
    stopBrowserVoice();
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
  }

  /** Asks the worker for a sentence; undefined if it isn't back in time. */
  private requestKokoro(text: string): Promise<Audio | undefined> {
    const id = this.nextId++;
    return new Promise<Audio | undefined>((resolve) => {
      const timer = setTimeout(() => this.settle(id, undefined), KOKORO_WAIT_MS);
      this.pending.set(id, (audio) => {
        clearTimeout(timer);
        resolve(audio);
      });
      this.worker?.postMessage({ type: "speak", id, text });
    });
  }

  /** Switches to the browser voice if Kokoro can't keep up on this device. */
  private judgeSpeed(audio: Audio): void {
    const seconds = audio.samples.length / audio.rate;
    if (seconds > 0 && audio.ms / 1000 / seconds > MAX_REALTIME_FACTOR) this.markSlow();
  }

  private markSlow(): void {
    if (this.kokoroSlow) return;
    this.kokoroSlow = true;
    remember(SLOW_KEY, true);
    console.info("jarvis: Kokoro is slower than real time here; using the browser voice");
  }

  private play(audio: Audio): Promise<void> {
    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser) return Promise.resolve();

    const buffer = ctx.createBuffer(1, audio.samples.length, audio.rate);
    // The worker transfers a plain (non-shared) buffer, so this cast is safe.
    buffer.copyToChannel(audio.samples as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    this.current = source;
    setState("speaking");

    // Feed the face its waveform every animation frame while this plays.
    let playing = true;
    const pump = () => {
      if (!playing) return;
      analyser.getFloatTimeDomainData(this.frame);
      setWaveform(this.frame);
      requestAnimationFrame(pump);
    };

    return new Promise((resolve) => {
      source.onended = () => {
        playing = false;
        this.current = undefined;
        // Between sentences Jarvis is "thinking" until the next one is ready.
        setState("thinking");
        resolve();
      };
      source.start();
      requestAnimationFrame(pump);
    });
  }

  private handle(msg: WorkerMessage): void {
    if (msg.type === "progress") this.onStatus({ kind: "loading", percent: msg.percent });
    else if (msg.type === "ready") {
      this.kokoroReady = true;
      this.onStatus({ kind: "ready" });
    } else if (msg.type === "audio") this.settle(msg.id, { samples: msg.samples, rate: msg.rate, ms: msg.ms });
    else if (msg.id !== undefined) this.settle(msg.id, undefined);
    else this.failKokoro();
  }

  private settle(id: number, audio: Audio | undefined): void {
    this.pending.get(id)?.(audio);
    this.pending.delete(id);
  }

  private failKokoro(): void {
    this.kokoroFailed = true;
    for (const resolve of this.pending.values()) resolve(undefined);
    this.pending.clear();
    this.onStatus({ kind: "failed" });
  }
}
