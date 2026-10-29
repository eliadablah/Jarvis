// In-memory state for the live screen view: what the viewer asked for, the
// current video init piece, the people watching, and the newest screenshot.
// Nothing here is written to disk, and everything is dropped when you stop
// watching or the PC stops sending.

import type { ServerResponse } from "node:http";
import { codecFromInit } from "./mp4.ts";

export type ScreenMode = "off" | "video" | "screenshots";
export const SCREEN_MODES: ScreenMode[] = ["off", "video", "screenshots"];

const WANT_TTL_MS = 12_000;      // a viewer must check in at least this often
const FRAME_TTL_MS = 8_000;      // a screenshot older than this is not shown as live
const MAX_VIEWERS = 3;
const MAX_VIEWER_BACKLOG = 3_000_000; // bytes a slow viewer may lag before it's dropped

interface Viewer { res: ServerResponse; }

export class ScreenHub {
  private wanted: { mode: ScreenMode; at: number } = { mode: "off", at: 0 };
  private init: Buffer | undefined;
  private codecValue: string | undefined;
  private viewers = new Set<Viewer>();
  private newest: { buf: Buffer; at: number } | undefined;
  private lastFragmentAt = 0;
  private clock: () => number;

  constructor(clock: () => number = Date.now) { this.clock = clock; }

  /** A viewer says what they want to watch. "off" clears everything at once. */
  want(mode: ScreenMode): void {
    this.wanted = { mode, at: this.clock() };
    if (mode !== "video") this.endVideo();
    if (mode === "off") this.newest = undefined;
  }

  /** What the PC should be capturing right now: whatever a recent viewer asked for, else nothing. */
  modeNow(): ScreenMode {
    return this.clock() - this.wanted.at < WANT_TTL_MS ? this.wanted.mode : "off";
  }

  status() {
    const now = this.clock();
    return {
      mode: this.modeNow(),
      videoLive: !!this.init && now - this.lastFragmentAt < 5_000,
      frameAt: this.newest && now - this.newest.at < FRAME_TTL_MS ? new Date(this.newest.at).toISOString() : null,
      viewers: this.viewers.size,
    };
  }

  // --- Video ---
  get codec(): string | undefined { return this.codecValue; }
  hasInit(): boolean { return !!this.init; }

  setInit(init: Buffer): void {
    this.init = init; this.codecValue = codecFromInit(init); this.lastFragmentAt = this.clock();
  }

  /** Sends the start of the video to a new viewer; false if there are already too many. */
  addViewer(res: ServerResponse): boolean {
    if (this.viewers.size >= MAX_VIEWERS || !this.init) return false;
    const viewer: Viewer = { res };
    this.viewers.add(viewer);
    res.on("close", () => this.viewers.delete(viewer));
    res.write(this.init);
    return true;
  }

  fragment(piece: Buffer): void {
    this.lastFragmentAt = this.clock();
    for (const viewer of this.viewers) {
      // A viewer who can't keep up is dropped instead of piling up memory on this small server.
      if (viewer.res.writableLength > MAX_VIEWER_BACKLOG) { viewer.res.destroy(); this.viewers.delete(viewer); continue; }
      viewer.res.write(piece);
    }
  }

  endVideo(): void {
    this.init = undefined; this.codecValue = undefined;
    for (const viewer of this.viewers) viewer.res.end();
    this.viewers.clear();
  }

  // --- Screenshots ---
  setFrame(buf: Buffer): void { this.newest = { buf, at: this.clock() }; }
  frame(): { buf: Buffer; at: number } | undefined {
    return this.newest && this.clock() - this.newest.at < FRAME_TTL_MS ? this.newest : undefined;
  }
}

export const screenHub = new ScreenHub();
