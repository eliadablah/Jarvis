// Jarvis's ears in the browser: hold-to-talk speech recognition using the
// browser's built-in engine (Chrome, Edge, Safari). Start on press, stop
// on release, then hand back everything that was heard.

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

/** The browser's speech recognition class, if it has one. */
function recognitionClass(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechInSupported(): boolean {
  return recognitionClass() !== undefined;
}

/** One hold-to-talk session: start() on press, finish() on release. */
export class HoldToTalk {
  private recognition: Recognition | undefined;
  private finalText = "";
  private interimText = "";
  private ended: Promise<void> = Promise.resolve();

  constructor(private readonly onInterim: (text: string) => void) {}

  start(): void {
    const Ctor = recognitionClass();
    if (!Ctor) throw new Error("Speech recognition isn't available.");

    this.finalText = "";
    this.interimText = "";
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) this.finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      this.interimText = interim;
      this.onInterim(`${this.finalText}${interim}`.trim());
    };
    rec.onerror = () => {
      /* "no-speech" and "aborted" just mean nothing to send */
    };
    this.ended = new Promise((resolve) => {
      rec.onend = () => resolve();
    });

    this.recognition = rec;
    rec.start();
  }

  /** Stops listening and returns what was heard (may be empty). */
  async finish(): Promise<string> {
    const rec = this.recognition;
    this.recognition = undefined;
    if (!rec) return "";
    rec.stop();
    // Final results arrive just before "end"; don't wait forever.
    await Promise.race([this.ended, new Promise((r) => setTimeout(r, 2000))]);
    return `${this.finalText}${this.interimText}`.trim();
  }
}
