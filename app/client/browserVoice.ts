// Fallback mouth: the browser's own speech (instant, no download). Used when
// Kokoro is too slow on this device to keep up with Jarvis's answers. Picks
// a British male voice when the device has one, and fakes a speech-shaped
// waveform for the face, since the browser doesn't expose this audio.

import { setWaveform } from "./bus.js";

let finishCurrent: (() => void) | undefined;

const PREFERRED = [/uk english male/i, /\bdaniel\b/i, /\bgeorge\b/i, /\bryan\b/i, /\barthur\b/i, /\boliver\b/i];

/** Best available voice: British male first, then any British, then default. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  for (const pattern of PREFERRED) {
    const match = voices.find((v) => v.lang.startsWith("en-GB") && pattern.test(v.name));
    if (match) return match;
  }
  return voices.find((v) => v.lang.startsWith("en-GB")) ?? voices.find((v) => v.lang.startsWith("en"));
}

export function browserVoiceSupported(): boolean {
  return "speechSynthesis" in window;
}

/** Speaks one sentence; resolves when it's finished (or failed). */
export function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-GB";
    utterance.rate = 1.02;

    // Speech-like motion for the face while the browser talks.
    let speaking = true;
    const frame = new Float32Array(64);
    const start = performance.now();
    const pump = () => {
      if (!speaking) return;
      const t = (performance.now() - start) / 1000;
      const cadence = Math.max(0, Math.sin(t * 7.3) * 0.6 + Math.sin(t * 3.1) * 0.4);
      for (let i = 0; i < 64; i++) frame[i] = Math.sin(i * 0.55 + t * 9) * 0.18 * cadence;
      setWaveform(frame);
      requestAnimationFrame(pump);
    };

    const done = () => {
      if (!speaking) return;
      speaking = false;
      if (finishCurrent === done) finishCurrent = undefined;
      resolve();
    };
    finishCurrent = done;
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
    requestAnimationFrame(pump);
  });
}

export function stopBrowserVoice(): void {
  finishCurrent?.();
  if (browserVoiceSupported()) speechSynthesis.cancel();
}
