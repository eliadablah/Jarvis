// Jarvis's mouth in the browser. Sentences go to the Kokoro worker one by
// one; the audio plays in order through an analyser that feeds the face
// its live waveform, exactly like backtalk feeds the local face.

import { setState, setWaveform } from "./bus.js";

type WorkerMessage =
  | { type: "progress"; percent: number }
  | { type: "ready" }
  | { type: "audio"; id: number; samples: Float32Array; rate: number }
  | { type: "error"; id?: number; message: string };

export type VoiceStatus = { kind: "loading"; percent: number } | { kind: "ready" } | { kind: "failed" };

export class VoiceOut {
  private worker: Worker | undefined;
  private ctx: AudioContext | undefined;
  private analyser: AnalyserNode | undefined;
  private frame = new Float32Array(512);
  private nextId = 1;
  private pending = new Map<number, (audio: { samples: Float32Array; rate: number } | undefined) => void>();
  private playChain: Promise<void> = Promise.resolve();
  private current: AudioBufferSourceNode | undefined;
  private generation = 0;
  private outstanding = 0;
  private failed = false;
  enabled = true;

  constructor(private readonly onStatus: (status: VoiceStatus) => void) {}

  /** Starts loading the model in the background (first visit downloads ~92 MB, then it's cached). */
  load(): void {
    if (this.worker || this.failed) return;
    try {
      this.worker = new Worker("/worker/ttsWorker.js", { type: "module" });
    } catch {
      this.fail();
      return;
    }
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
    this.worker.onerror = () => this.fail();
    this.onStatus({ kind: "loading", percent: 0 });
    this.worker.postMessage({ type: "load" });
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
    if (!this.enabled || this.failed || !this.worker || !text) return;
    const generation = this.generation;
    const id = this.nextId++;
    this.outstanding++;

    const audioReady = new Promise<{ samples: Float32Array; rate: number } | undefined>((resolve) => {
      this.pending.set(id, resolve);
    });
    this.worker.postMessage({ type: "speak", id, text });

    this.playChain = this.playChain
      .then(async () => {
        const audio = await audioReady;
        if (audio && generation === this.generation && this.enabled) await this.play(audio);
      })
      .finally(() => {
        this.outstanding--;
        if (this.outstanding === 0) onAllDone();
      });
  }

  /** Stops speaking right away and drops anything queued. */
  stop(): void {
    this.generation++;
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
  }

  private play(audio: { samples: Float32Array; rate: number }): Promise<void> {
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
    else if (msg.type === "ready") this.onStatus({ kind: "ready" });
    else if (msg.type === "audio") this.settle(msg.id, { samples: msg.samples, rate: msg.rate });
    else if (msg.id !== undefined) this.settle(msg.id, undefined);
    else this.fail();
  }

  private settle(id: number, audio: { samples: Float32Array; rate: number } | undefined): void {
    this.pending.get(id)?.(audio);
    this.pending.delete(id);
  }

  private fail(): void {
    this.failed = true;
    for (const resolve of this.pending.values()) resolve(undefined);
    this.pending.clear();
    this.onStatus({ kind: "failed" });
  }
}
