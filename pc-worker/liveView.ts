// Live view for Hands: while a task is running and you are watching on the
// dashboard, this records the PC screen and sends it to the Jarvis server.
//
// It never captures on its own. Every 2 seconds it asks the server what the
// dashboard wants (control = off, video or screenshots) and starts or stops
// accordingly, so closing the dashboard or pressing Off stops the capture within
// a couple of seconds. Video is recorded with ffmpeg as a stream the browser can
// play live; screenshots are single pictures every 2 seconds, taken with ffmpeg,
// or with PowerShell if ffmpeg isn't installed. Any failure here is swallowed:
// the live view must never get in the way of the task itself.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";

export type ScreenMode = "off" | "video" | "screenshots";
export interface LiveSettings { server: string; token: string; ffmpegBin?: string; }
export interface LiveDeps {
  fetch?: typeof fetch; spawn?: typeof nodeSpawn; ffmpeg?: string | null; pollMs?: number; frameMs?: number;
  /** The main monitor's size; null means "record the whole desktop". Looked up from Windows when not given. */
  area?: { width: number; height: number } | null;
}

const VIDEO_WIDTH = 1280, FRAME_WIDTH = 1000, FPS = 10;
const even = (width: number) => `scale='trunc(min(${width},iw)/2)*2':-2:flags=fast_bilinear`;
export interface Area { width: number; height: number; }

/** What ffmpeg should record: the main monitor (always at 0,0) if its size is known, otherwise the whole desktop. */
function input(area: Area | undefined, framerate: number): string[] {
  return ["-f", "gdigrab", "-framerate", String(framerate), "-draw_mouse", "1",
    ...(area ? ["-offset_x", "0", "-offset_y", "0", "-video_size", `${area.width}x${area.height}`] : []), "-i", "desktop"];
}

/** ffmpeg arguments for the live video: H.264 at up to 10 frames a second, a keyframe every second of real time, streamed as fragmented MP4. */
export function videoArgs(area?: Area): string[] {
  return ["-hide_banner", "-loglevel", "error", ...input(area, FPS),
    "-vf", even(VIDEO_WIDTH) + ",format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "32",
    "-profile:v", "baseline", "-g", "300", "-force_key_frames", "expr:gte(t,n_forced*1)", "-bf", "0", "-an",
    "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"];
}

/** ffmpeg arguments for one JPEG screenshot written to stdout. */
export function frameArgs(area?: Area): string[] {
  return ["-hide_banner", "-loglevel", "error", ...input(area, 1), "-frames:v", "1",
    "-vf", even(FRAME_WIDTH), "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"];
}

/** Reads "1920x1080" style text, e.g. what the size lookup prints. */
export function parseArea(text: string): Area | undefined {
  const m = /^\s*(\d{3,5})x(\d{3,5})\s*$/m.exec(text);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/** The main monitor's real pixel size, asked of Windows once (the DPI line stops Windows from reporting a scaled-down size). */
const POWERSHELL_SIZE = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i); }'
[void][W]::SetProcessDPIAware(); [Console]::Out.Write(([W]::GetSystemMetrics(0)).ToString() + 'x' + ([W]::GetSystemMetrics(1)).ToString())`;

/** One JPEG of the main screen using only Windows' own PowerShell, for PCs without ffmpeg. */
const POWERSHELL_FRAME = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$full=New-Object System.Drawing.Bitmap $s.Width,$s.Height
$g=[System.Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($s.Location,[System.Drawing.Point]::Empty,$s.Size)
$w=[Math]::Min(${FRAME_WIDTH},$s.Width); $h=[int]($s.Height*$w/$s.Width)
$small=New-Object System.Drawing.Bitmap $full,$w,$h
$ms=New-Object IO.MemoryStream
$small.Save($ms,[System.Drawing.Imaging.ImageFormat]::Jpeg)
$out=[Console]::OpenStandardOutput(); $bytes=$ms.ToArray(); $out.Write($bytes,0,$bytes.Length); $out.Flush()`;

/** Finds ffmpeg: the saved setting, then ~/.jarvis/live-view.json, then the PATH. Undefined if it isn't installed. */
export function findFfmpeg(settings?: { ffmpegBin?: string }, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | undefined {
  const candidates: string[] = [];
  if (settings?.ffmpegBin) candidates.push(settings.ffmpegBin);
  try { candidates.push(JSON.parse(readFileSync(join(homedir(), ".jarvis", "live-view.json"), "utf8").replace(/^﻿/, "")).ffmpegBin); } catch { /* no saved path */ }
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) if (dir) candidates.push(join(dir, "ffmpeg.exe"));
  return candidates.find(p => typeof p === "string" && exists(p));
}

export function startLiveView(settings: LiveSettings, deps: LiveDeps = {}): () => void {
  const request = deps.fetch ?? fetch, spawn = deps.spawn ?? nodeSpawn;
  const ffmpeg = deps.ffmpeg === undefined ? findFfmpeg(settings) : deps.ffmpeg ?? undefined;
  const auth = { Authorization: "Bearer " + settings.token };
  const url = (path: string) => new URL(path, settings.server);
  let mode: ScreenMode = "off", lastOk = Date.now(), stopped = false, capturing = false;
  let child: ChildProcess | undefined, upload: AbortController | undefined, frameTimer: ReturnType<typeof setInterval> | undefined;
  let area: Area | null | undefined = deps.area;

  /** The main monitor's size, looked up once. Recording only that monitor keeps the video fast on multi-monitor desktops. */
  async function mainArea(): Promise<Area | undefined> {
    if (area !== undefined) return area ?? undefined;
    try {
      const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SIZE], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let text = "";
      proc.stdout!.on("data", (c: Buffer) => { text += c; });
      await new Promise<void>(resolve => { const t = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(); }, 5000); proc.on("exit", () => { clearTimeout(t); resolve(); }); proc.on("error", () => { clearTimeout(t); resolve(); }); });
      area = parseArea(text) ?? null;
    } catch { area = null; }
    return area ?? undefined;
  }

  function stopCapture(): void {
    if (frameTimer) clearInterval(frameTimer); frameTimer = undefined;
    upload?.abort(); upload = undefined;
    try { child?.kill(); } catch { /* already gone */ }
    child = undefined;
  }

  async function startVideo(): Promise<void> {
    if (!ffmpeg) return;
    const size = await mainArea();
    if (stopped || mode !== "video" || child) return; // the viewer left, or another start won, while Windows was asked
    const controller = new AbortController(); upload = controller;
    const proc = spawn(ffmpeg, videoArgs(size), { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    child = proc;
    proc.on("error", () => { if (child === proc) { child = undefined; upload?.abort(); } });
    proc.on("exit", () => { if (child === proc) { child = undefined; } });
    void request(url("/api/pc/screen/ingest/video"), {
      method: "POST", headers: { ...auth, "Content-Type": "video/mp4" }, signal: controller.signal, redirect: "error",
      body: Readable.toWeb(proc.stdout!) as unknown as BodyInit, duplex: "half",
    } as RequestInit).catch(() => {}).finally(() => { if (child === proc) { try { proc.kill(); } catch { /* gone */ } child = undefined; } });
  }

  /** Takes one screenshot and uploads it; skipped if the last one is still in flight. */
  async function sendFrame(): Promise<void> {
    if (capturing || stopped) return;
    capturing = true;
    try {
      const proc = ffmpeg ? spawn(ffmpeg, frameArgs(await mainArea()), { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
        : spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_FRAME], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      const chunks: Buffer[] = [];
      const done = new Promise<void>(resolve => { proc.on("exit", () => resolve()); proc.on("error", () => resolve()); });
      proc.stdout!.on("data", (c: Buffer) => chunks.push(c));
      const timeout = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 6000);
      await done; clearTimeout(timeout);
      const frame = Buffer.concat(chunks);
      if (frame.length > 4 && frame[0] === 0xff && frame[1] === 0xd8 && mode === "screenshots")
        await request(url("/api/pc/screen/ingest/frame"), { method: "POST", headers: { ...auth, "Content-Type": "image/jpeg" }, body: frame, redirect: "error", signal: AbortSignal.timeout(8000) }).catch(() => {});
    } catch { /* a missed picture is fine */ } finally { capturing = false; }
  }

  function apply(next: ScreenMode): void {
    if (next === mode && (next === "off" || child || frameTimer)) return;
    stopCapture(); mode = next;
    if (next === "video") void startVideo();
    if (next === "screenshots") { void sendFrame(); frameTimer = setInterval(() => void sendFrame(), deps.frameMs ?? 2000); frameTimer.unref?.(); }
  }

  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      const response = await request(url("/api/pc/screen/control"), { headers: auth, redirect: "error", signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error("control refused");
      const { mode: wanted } = await response.json() as { mode?: ScreenMode };
      lastOk = Date.now();
      apply(wanted === "video" || wanted === "screenshots" ? wanted : "off");
    } catch {
      // If the server can't be reached for 10 seconds, stop recording rather than keep going blind.
      if (Date.now() - lastOk > 10_000) apply("off");
    }
  }

  const timer = setInterval(() => void poll(), deps.pollMs ?? 2000);
  timer.unref?.();
  void poll();
  return () => { stopped = true; clearInterval(timer); stopCapture(); mode = "off"; };
}
