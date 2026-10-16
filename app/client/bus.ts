// Jarvis's live state, in the exact shape ai-visualizer faces read from
// their local /state endpoint: state, level, 64 waveform samples, alert,
// loading. The face frame reads it through window.__jarvisBus (see
// faceBus.ts); everything else in the page writes it through these helpers.

export type BusState = "idle" | "listening" | "thinking" | "speaking";

export interface JarvisBus {
  state: BusState;
  /** 0..1 loudness while speaking. */
  level: number;
  /** 64 signed samples on the int16 scale the faces expect. */
  samples: number[];
  alert: boolean;
  /** True while a thinking sound should stay quiet (the face plays its own otherwise). */
  loading: boolean;
}

const SILENCE = (): number[] => new Array<number>(64).fill(0);

export const bus: JarvisBus = { state: "idle", level: 0, samples: SILENCE(), alert: false, loading: false };

declare global {
  interface Window {
    __jarvisBus?: JarvisBus;
  }
}
window.__jarvisBus = bus;

/** Sets the state; anything but speaking clears the waveform. */
export function setState(state: BusState): void {
  bus.state = state;
  if (state !== "speaking") {
    bus.level = 0;
    bus.samples = SILENCE();
  }
}

/** Publishes one frame of playing audio (float samples in -1..1). */
export function setWaveform(frame: Float32Array): void {
  const out = new Array<number>(64);
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const v = (frame[Math.floor((i * (frame.length - 1)) / 63)] ?? 0) * 32768;
    out[i] = v;
    sum += Math.abs(v);
  }
  bus.samples = out;
  // Same loudness formula the visualizer's own server uses.
  bus.level = Math.min(1, sum / 64 / 3000);
}
