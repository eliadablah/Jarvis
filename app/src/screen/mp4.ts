// Splits a live fragmented-MP4 stream (what ffmpeg writes to a pipe) into the
// pieces a browser video player needs: one "init" piece (ftyp + moov) that
// describes the video, then a series of fragments (moof + mdat), each starting
// at a keyframe. The server relays these pieces and never stores them.

const MAX_BOX_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_BYTES = 16 * 1024 * 1024;

export interface Mp4Pieces { init?: Buffer; fragments: Buffer[]; }

export class Mp4Splitter {
  private pending: Buffer = Buffer.alloc(0);
  private initParts: Buffer[] = [];
  private initDone = false;
  private moof: Buffer | undefined;

  /** Feeds more bytes; returns whatever whole pieces they completed. Throws on a corrupt stream. */
  push(chunk: Buffer): Mp4Pieces {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    if (this.pending.length > MAX_PENDING_BYTES) throw new Error("Video stream is not valid.");
    const out: Mp4Pieces = { fragments: [] };
    for (;;) {
      if (this.pending.length < 8) break;
      let size = this.pending.readUInt32BE(0);
      const type = this.pending.toString("latin1", 4, 8);
      let header = 8;
      if (size === 1) {
        if (this.pending.length < 16) break;
        size = Number(this.pending.readBigUInt64BE(8)); header = 16;
      }
      if (size < header || size > MAX_BOX_BYTES || !/^[\x20-\x7e]{4}$/.test(type)) throw new Error("Video stream is not valid.");
      if (this.pending.length < size) break;
      const box = this.pending.subarray(0, size);
      this.pending = this.pending.subarray(size);
      if (!this.initDone) {
        if (type === "ftyp" || type === "moov") this.initParts.push(box);
        if (type === "moov") { this.initDone = true; out.init = Buffer.concat(this.initParts); this.initParts = []; }
      } else if (type === "moof") this.moof = box;
      else if (type === "mdat" && this.moof) { out.fragments.push(Buffer.concat([this.moof, box])); this.moof = undefined; }
    }
    return out;
  }
}

/** The codec string the browser needs ("avc1.42e01f") read from the init piece, or undefined if it isn't H.264. */
export function codecFromInit(init: Buffer): string | undefined {
  const at = init.indexOf("avcC", 0, "latin1");
  if (at < 0 || at + 8 > init.length) return undefined;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return "avc1." + hex(init[at + 5]!) + hex(init[at + 6]!) + hex(init[at + 7]!);
}
