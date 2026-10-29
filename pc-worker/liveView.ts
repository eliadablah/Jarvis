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
export type CaptureTarget = "chrome" | "screen";
export interface LiveDeps {
  fetch?: typeof fetch; spawn?: typeof nodeSpawn; ffmpeg?: string | null; pollMs?: number; frameMs?: number;
  /** The main monitor's size; null means "record the whole desktop". Looked up from Windows when not given. */
  area?: { width: number; height: number } | null;
  /** "chrome" records just the browser window the agent works in (falling back to the screen); "screen" always records the main monitor. */
  target?: CaptureTarget;
  /** Finds the Chrome window to record. Looked up from Windows when not given. */
  window?: () => Promise<Area | undefined>;
  /** How often to check that the recorded window hasn't moved (default 10 seconds). */
  followMs?: number;
}

const VIDEO_WIDTH = 1280, FRAME_WIDTH = 1000, FPS = 10;
const even = (width: number) => `scale='trunc(min(${width},iw)/2)*2':-2:flags=fast_bilinear`;
/** A screen rectangle in physical pixels; x and y default to the top-left corner of the desktop. */
export interface Area { width: number; height: number; x?: number; y?: number; }

/** What ffmpeg should record: the given rectangle if its size is known, otherwise the whole desktop. */
function input(area: Area | undefined, framerate: number): string[] {
  return ["-f", "gdigrab", "-framerate", String(framerate), "-draw_mouse", "1",
    ...(area ? ["-offset_x", String(area.x ?? 0), "-offset_y", String(area.y ?? 0), "-video_size", `${area.width}x${area.height}`] : []), "-i", "desktop"];
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

/** Reads "x,y,width,height", e.g. what the Chrome window lookup prints (x and y may be negative on a second monitor). */
export function parseWindowRect(text: string): Area | undefined {
  const m = /^\s*(-?\d{1,6}),(-?\d{1,6}),(\d{3,5}),(\d{3,5})\s*$/m.exec(text);
  return m ? { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) } : undefined;
}

/** True when two rectangles are close enough that the recording doesn't need to restart (a few pixels of wobble is fine). */
export function sameArea(a: Area | undefined, b: Area | undefined, slack = 24): boolean {
  if (!a || !b) return a === b;
  return Math.abs((a.x ?? 0) - (b.x ?? 0)) <= slack && Math.abs((a.y ?? 0) - (b.y ?? 0)) <= slack
    && Math.abs(a.width - b.width) <= slack && Math.abs(a.height - b.height) <= slack;
}

/**
 * The topmost visible, un-minimized Google Chrome window that is not showing the Jarvis dashboard, as "x,y,width,height" in
 * physical pixels, trimmed to the desktop. Prints nothing if there isn't one. Only reads window positions and titles.
 */
export const POWERSHELL_CHROME =`Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices;
public class C {
  public delegate bool P(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, R2, B; }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  public static void Aware() { try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { } SetProcessDPIAware(); }
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool EnumWindows(P f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static string Find() {
    string found = "";
    EnumWindows((h, l) => {
      if (found != "" || !IsWindowVisible(h) || IsIconic(h)) return true;
      StringBuilder c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "Chrome_WidgetWin_1") return true;
      StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
      string title = t.ToString();
      if (title.IndexOf(" - Google Chrome", StringComparison.Ordinal) < 0 || title.IndexOf("Jarvis", StringComparison.OrdinalIgnoreCase) >= 0) return true;
      R r; GetWindowRect(h, out r);
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
      int left = Math.Max(r.L, vx), top = Math.Max(r.T, vy), right = Math.Min(r.R2, vx + vw), bottom = Math.Min(r.B, vy + vh);
      if (right - left < 300 || bottom - top < 200) return true;
      found = left + "," + top + "," + (right - left) + "," + (bottom - top);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}'
[C]::Aware(); [Console]::Out.Write([C]::Find())`;

/** Which thing to record, from ~/.jarvis/live-view.json ({"capture": "screen"} turns the Chrome-window view off). Chrome by default. */
export function readCaptureTarget(read: () => string = () => readFileSync(join(homedir(), ".jarvis", "live-view.json"), "utf8")): CaptureTarget {
  try { return JSON.parse(read().replace(/^﻿/, "")).capture === "screen" ? "screen" : "chrome"; } catch { return "chrome"; }
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
  let area: Area | null | undefined = deps.area, videoArea: Area | undefined;
  const target = deps.target ?? readCaptureTarget();

  /** Runs a short PowerShell lookup and returns what it printed (empty if it failed or took over 5 seconds). */
  async function ask(script: string): Promise<string> {
    try {
      const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let text = "";
      proc.stdout!.on("data", (c: Buffer) => { text += c; });
      await new Promise<void>(resolve => { const t = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(); }, 5000); proc.on("exit", () => { clearTimeout(t); resolve(); }); proc.on("error", () => { clearTimeout(t); resolve(); }); });
      return text;
    } catch { return ""; }
  }

  /** The main monitor's size, looked up once. Recording only that monitor keeps the video fast on multi-monitor desktops. */
  async function mainArea(): Promise<Area | undefined> {
    if (area !== undefined) return area ?? undefined;
    area = parseArea(await ask(POWERSHELL_SIZE)) ?? null;
    return area ?? undefined;
  }

  /** The agent's Chrome window, looked up at most every 8 seconds (each lookup starts PowerShell and takes about 2 to 3 seconds of CPU). Undefined when there is none (or in "screen" mode). */
  let windowCache: { at: number; area: Area | undefined } | undefined;
  async function chromeWindow(): Promise<Area | undefined> {
    if (target !== "chrome" && !deps.window) return undefined;
    if (!deps.window && windowCache && Date.now() - windowCache.at < 8000) return windowCache.area;
    const found = deps.window ? await deps.window().catch(() => undefined) : parseWindowRect(await ask(POWERSHELL_CHROME));
    windowCache = { at: Date.now(), area: found };
    return found;
  }

  /** What to record right now: the Chrome window if there is one, otherwise the main monitor. */
  async function captureArea(): Promise<Area | undefined> { return (await chromeWindow()) ?? (await mainArea()); }

  function stopVideoProcess(): void {
    upload?.abort(); upload = undefined;
    try { child?.kill(); } catch { /* already gone */ }
    child = undefined;
  }

  function stopCapture(): void {
    if (frameTimer) clearInterval(frameTimer); frameTimer = undefined;
    stopVideoProcess();
  }

  async function startVideo(): Promise<void> {
    if (!ffmpeg) return;
    const size = await captureArea();
    if (stopped || mode !== "video" || child) return; // the viewer left, or another start won, while Windows was asked
    videoArea = size;
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
      const proc = ffmpeg ? spawn(ffmpeg, frameArgs(await captureArea()), { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
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

  /** While recording video, restarts the recording if the Chrome window moved or was resized, or appeared or went away. */
  async function follow(): Promise<void> {
    if (stopped || mode !== "video" || !child || (target !== "chrome" && !deps.window)) return;
    const wanted = await captureArea();
    if (stopped || mode !== "video" || !child || sameArea(wanted, videoArea)) return;
    stopVideoProcess();
    void startVideo(); // the dashboard reconnects to the new recording by itself
  }

  const timer = setInterval(() => void poll(), deps.pollMs ?? 2000);
  const followTimer = setInterval(() => void follow().catch(() => {}), deps.followMs ?? 10_000);
  timer.unref?.(); followTimer.unref?.();
  void poll();
  return () => { stopped = true; clearInterval(timer); clearInterval(followTimer); stopCapture(); mode = "off"; };
}
