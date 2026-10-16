// Splits Jarvis's streamed answer into sentences as it arrives, so the
// voice can start speaking the first sentence while the rest is still
// being written. Also strips markdown symbols that sound silly read aloud.
// No browser APIs, so it's tested directly in Node.

/** Collects streamed text and hands back each finished sentence. */
export class SentenceSplitter {
  private buffer = "";

  /** Adds text; returns any sentences it completed. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    // A sentence ends at . ! ? followed by whitespace, or at a line break.
    // A dot inside "2.1" or "notes.md" isn't followed by a space, so it's skipped.
    const pattern = /[\s\S]*?(?:[.!?]+["')\]]*(?=\s)|\n+)/y;
    let consumed = 0;
    for (;;) {
      pattern.lastIndex = consumed;
      const match = pattern.exec(this.buffer);
      if (!match || match[0].length === 0) break;
      consumed = pattern.lastIndex;
      const sentence = match[0].trim();
      if (sentence) out.push(sentence);
    }
    this.buffer = this.buffer.slice(consumed);
    return out;
  }

  /** Returns whatever is left once the answer has finished. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

/** Turns markdown into plain words for speaking. Returns "" if nothing speakable is left. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~>|#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
