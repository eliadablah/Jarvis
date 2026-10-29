import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { findFfmpeg, frameArgs, parseArea, parseWindowRect, readCaptureTarget, sameArea, startLiveView, videoArgs } from "./liveView.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 0xff, 0xd9]);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const settings = { server: "https://jarvis.test", token: "secret-token" };

/** A pretend ffmpeg/PowerShell process that prints some bytes and exits. */
function fakeProcess(output: Buffer, exitAfterOutput = true) {
  const child: EventEmitter & { stdout: Readable; killed: boolean; kill(): void } =
    Object.assign(new EventEmitter(), { stdout: Readable.from([output]), killed: false, kill() { child.killed = true; child.emit("exit", 0); } });
  if (exitAfterOutput) child.stdout.on("end", () => setImmediate(() => child.emit("exit", 0)));
  return child;
}

function harness(modeOf: () => string, spawned: { command: string; args: string[]; child: ReturnType<typeof fakeProcess> }[], output = JPEG, exits = true) {
  const calls: { url: string; method: string; auth: string | null; body?: unknown }[] = [];
  const fetcher = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input), headers = new Headers(init.headers);
    calls.push({ url, method: init.method ?? "GET", auth: headers.get("authorization"), body: init.body });
    if (url.endsWith("/control")) return Response.json({ mode: modeOf() });
    if (url.endsWith("/ingest/video")) return new Promise<Response>(() => {}); // an upload that stays open
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const spawn = ((command: string, args: string[]) => { const child = fakeProcess(output, exits); spawned.push({ command, args, child }); return child; }) as never;
  return { calls, fetcher, spawn };
}

test("ffmpeg commands record the desktop as streamable H.264 and one JPEG at a time", () => {
  const video = videoArgs().join(" ");
  assert.match(video, /-f gdigrab/);
  assert.match(video, /libx264/);
  assert.match(video, /frag_keyframe\+empty_moov\+default_base_moof/);
  assert.match(video, /-force_key_frames expr:gte\(t,n_forced\*1\)/, "a keyframe every second of real time, so a viewer can join quickly even when the PC is slow");
  assert.equal(videoArgs().at(-1), "pipe:1");
  const frame = frameArgs().join(" ");
  assert.match(frame, /-frames:v 1/);
  assert.match(frame, /image2pipe/);
});

test("with the main monitor's size, only that monitor is recorded; otherwise the whole desktop", () => {
  const area = { width: 3440, height: 1440 };
  for (const args of [videoArgs(area), frameArgs(area)]) {
    const text = args.join(" ");
    assert.match(text, /-offset_x 0 -offset_y 0 -video_size 3440x1440 -i desktop/);
  }
  assert.doesNotMatch(videoArgs().join(" "), /-video_size/);
  assert.deepEqual(parseArea("3440x1440"), area);
  assert.deepEqual(parseArea("\r\n1920x1080\r\n"), { width: 1920, height: 1080 });
  assert.equal(parseArea("error: no display"), undefined);
});

test("video uses the monitor size Windows reports", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  const h = harness(() => "video", spawned, Buffer.from("fake mp4"), false);
  const stop = startLiveView(settings, { fetch: h.fetcher, spawn: h.spawn, ffmpeg: "ffmpeg.exe", area: { width: 2560, height: 1440 }, target: "screen", pollMs: 15 });
  await wait(100); stop();
  assert.deepEqual(spawned[0]!.args, videoArgs({ width: 2560, height: 1440 }));
});

test("ffmpeg is found from a saved setting or the PATH, and its absence is reported as undefined", () => {
  const exists = (p: string) => p === "C:\\tools\\bin\\ffmpeg.exe" || p === "D:\\mine\\ffmpeg.exe";
  assert.equal(findFfmpeg({ ffmpegBin: "D:\\mine\\ffmpeg.exe" }, { PATH: "C:\\tools\\bin" }, exists), "D:\\mine\\ffmpeg.exe");
  assert.equal(findFfmpeg({}, { PATH: "C:\\Windows;C:\\tools\\bin" }, exists), "C:\\tools\\bin\\ffmpeg.exe");
  assert.equal(findFfmpeg({}, { PATH: "C:\\Windows" }, () => false), undefined);
});

test("nothing is recorded unless the dashboard asks", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  const h = harness(() => "off", spawned);
  const stop = startLiveView(settings, { fetch: h.fetcher, spawn: h.spawn, ffmpeg: "ffmpeg.exe", area: null, target: "screen", pollMs: 15, frameMs: 15 });
  await wait(120); stop();
  assert.equal(spawned.length, 0);
  assert.ok(h.calls.every(c => c.url.endsWith("/control") && c.auth === "Bearer secret-token"), "only asks the server, always with the token");
});

test("screenshots: takes a picture and uploads it with the token while watched, and stops when stopped", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  const h = harness(() => "screenshots", spawned);
  const stop = startLiveView(settings, { fetch: h.fetcher, spawn: h.spawn, ffmpeg: "ffmpeg.exe", area: null, target: "screen", pollMs: 15, frameMs: 20 });
  await wait(200);
  const uploads = h.calls.filter(c => c.url.endsWith("/ingest/frame"));
  assert.ok(uploads.length >= 1, "uploaded at least one picture");
  assert.equal(uploads[0]!.method, "POST");
  assert.equal(uploads[0]!.auth, "Bearer secret-token");
  assert.ok((uploads[0]!.body as Buffer).equals(JPEG));
  assert.equal(spawned[0]!.command, "ffmpeg.exe");
  stop();
  const after = h.calls.length;
  await wait(100);
  assert.equal(h.calls.length, after, "no more requests after stop");
});

test("screenshots without ffmpeg fall back to PowerShell", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  const h = harness(() => "screenshots", spawned);
  const stop = startLiveView(settings, { fetch: h.fetcher, spawn: h.spawn, ffmpeg: null, area: null, target: "screen", pollMs: 15, frameMs: 20 });
  await wait(150); stop();
  assert.equal(spawned[0]!.command, "powershell.exe");
  assert.ok(h.calls.some(c => c.url.endsWith("/ingest/frame")));
});

test("video: starts ffmpeg and a streaming upload, and ends the recording as soon as the viewer leaves", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  let mode = "video";
  const h = harness(() => mode, spawned, Buffer.from("fake mp4"), false);
  const stop = startLiveView(settings, { fetch: h.fetcher, spawn: h.spawn, ffmpeg: "ffmpeg.exe", area: null, target: "screen", pollMs: 15 });
  await wait(100);
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0]!.args, videoArgs());
  const upload = h.calls.find(c => c.url.endsWith("/ingest/video"))!;
  assert.equal(upload.method, "POST");
  assert.equal(upload.auth, "Bearer secret-token");
  mode = "off";
  await wait(100);
  assert.equal(spawned[0]!.child.killed, true, "ffmpeg is stopped when the dashboard stops watching");
  stop();
});

test("a window rectangle is recorded at its own offset, including a second monitor to the left", () => {
  const text = videoArgs({ x: -1920, y: 40, width: 1280, height: 720 }).join(" ");
  assert.match(text, /-offset_x -1920 -offset_y 40 -video_size 1280x720 -i desktop/);
  assert.deepEqual(parseWindowRect("-1920,40,1280,720"), { x: -1920, y: 40, width: 1280, height: 720 });
  assert.deepEqual(parseWindowRect("\r\n100,0,1500,900\r\n"), { x: 100, y: 0, width: 1500, height: 900 });
  assert.equal(parseWindowRect(""), undefined, "no Chrome window found");
  assert.equal(parseWindowRect("garbage"), undefined);
});

test("small window wobble does not restart the recording, a real move does", () => {
  const a = { x: 100, y: 50, width: 1200, height: 800 };
  assert.equal(sameArea(a, { ...a, x: 110, width: 1210 }), true);
  assert.equal(sameArea(a, { ...a, x: 400 }), false);
  assert.equal(sameArea(a, { ...a, height: 600 }), false);
  assert.equal(sameArea(a, undefined), false);
  assert.equal(sameArea(undefined, undefined), true);
});

test("the Chrome window view is on unless the saved settings ask for the whole screen", () => {
  assert.equal(readCaptureTarget(() => { throw new Error("no file"); }), "chrome");
  assert.equal(readCaptureTarget(() => "{}"), "chrome");
  assert.equal(readCaptureTarget(() => '{"capture":"screen"}'), "screen");
  assert.equal(readCaptureTarget(() => '﻿{"capture":"screen"}'), "screen");
});

test("video records the agent's Chrome window, not the whole monitor", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  const h = harness(() => "video", spawned, Buffer.from("fake mp4"), false);
  const win = { x: 200, y: 30, width: 1400, height: 900 };
  const stop = startLiveView(settings, { fetch: h.fetcher, spawn: h.spawn, ffmpeg: "ffmpeg.exe", area: { width: 2560, height: 1440 }, target: "chrome", window: async () => win, pollMs: 15, followMs: 15 });
  await wait(120); stop();
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0]!.args, videoArgs(win));
});

test("with no Chrome window the main monitor is recorded; when the window moves the recording follows it", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  const h = harness(() => "video", spawned, Buffer.from("fake mp4"), false);
  const monitor = { width: 2560, height: 1440 };
  let win: { x: number; y: number; width: number; height: number } | undefined;
  const stop = startLiveView(settings, { fetch: h.fetcher, spawn: h.spawn, ffmpeg: "ffmpeg.exe", area: monitor, target: "chrome", window: async () => win, pollMs: 15, followMs: 15 });
  await wait(80);
  assert.deepEqual(spawned[0]!.args, videoArgs(monitor), "no window yet, so the monitor");
  win = { x: 300, y: 0, width: 1200, height: 800 };
  await wait(120);
  assert.equal(spawned[0]!.child.killed, true, "the old recording is stopped");
  assert.deepEqual(spawned.at(-1)!.args, videoArgs(win), "the new recording follows the Chrome window");
  stop();
});

test("a dead server connection for 10 seconds stops the recording rather than recording blind", async () => {
  const spawned: Parameters<typeof harness>[1] = [];
  let up = true;
  const h = harness(() => "screenshots", spawned);
  const flaky = (async (input: unknown, init?: RequestInit) => { if (!up) throw new Error("offline"); return h.fetcher(input as never, init); }) as typeof fetch;
  const realNow = Date.now; let now = realNow();
  Date.now = () => now;
  try {
    const stop = startLiveView(settings, { fetch: flaky, spawn: h.spawn, ffmpeg: "ffmpeg.exe", area: null, target: "screen", pollMs: 15, frameMs: 20 });
    await wait(80);
    up = false; now += 11_000;
    await wait(80);
    const count = h.calls.length;
    await wait(80);
    assert.equal(h.calls.length, count, "no pictures are sent once the connection is lost");
    stop();
  } finally { Date.now = realNow; }
});
