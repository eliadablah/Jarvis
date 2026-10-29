import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppConfig } from "../src/config.ts";
import { Mp4Splitter, codecFromInit } from "../src/screen/mp4.ts";
import { ScreenHub } from "../src/screen/hub.ts";
import { handleScreen } from "../src/screen/api.ts";

const box = (type: string, payload: Buffer = Buffer.alloc(0)) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(8 + payload.length, 0); head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
};
const INIT = Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", Buffer.concat([Buffer.from("avcC"), Buffer.from([1, 0x42, 0xe0, 0x1f])]))]);
const fragment = (n: number) => Buffer.concat([box("moof", Buffer.from([n])), box("mdat", Buffer.from("frame" + n))]);
const TOKEN = "t".repeat(40);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

test("the splitter finds the init piece and whole fragments, even when bytes arrive in odd pieces", () => {
  const stream = Buffer.concat([INIT, fragment(1), fragment(2)]);
  const splitter = new Mp4Splitter();
  const init: Buffer[] = [], fragments: Buffer[] = [];
  for (let at = 0; at < stream.length; at += 7) {
    const pieces = splitter.push(stream.subarray(at, at + 7));
    if (pieces.init) init.push(pieces.init);
    fragments.push(...pieces.fragments);
  }
  assert.equal(init.length, 1);
  assert.ok(init[0]!.equals(INIT));
  assert.deepEqual(fragments.map(f => f.toString("latin1").includes("frame")), [true, true]);
  assert.ok(fragments[0]!.equals(fragment(1)) && fragments[1]!.equals(fragment(2)));
  assert.equal(codecFromInit(INIT), "avc1.42e01f");
  assert.equal(codecFromInit(Buffer.from("not video")), undefined);
});

test("a corrupt stream is rejected instead of buffering forever", () => {
  assert.throws(() => new Mp4Splitter().push(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x01, 0x02, 0x03])), /not valid/);
});

test("the hub only records what a recent viewer asked for, and Off clears everything", () => {
  let now = 1_000_000;
  const hub = new ScreenHub(() => now);
  assert.equal(hub.modeNow(), "off");
  hub.want("screenshots"); hub.setFrame(JPEG);
  assert.equal(hub.modeNow(), "screenshots");
  assert.ok(hub.frame());
  now += 13_000;
  assert.equal(hub.modeNow(), "off", "a viewer who stops checking in is forgotten");
  assert.equal(hub.frame(), undefined, "old pictures are not shown as live");
  hub.want("screenshots"); hub.setFrame(JPEG); hub.want("off");
  assert.equal(hub.frame(), undefined);
  hub.want("video"); hub.setInit(INIT);
  assert.equal(hub.status().videoLive, true);
  hub.want("screenshots");
  assert.equal(hub.hasInit(), false, "switching away from video drops the stream");
});

async function withServer(run: (base: string, hub: ScreenHub) => Promise<void>) {
  const hub = new ScreenHub();
  const config = { pcWorkerToken: TOKEN } as AppConfig;
  const server: Server = createServer((req, res) => { handleScreen(req, res, new URL(req.url!, "http://x").pathname, config, hub).catch(() => res.end()); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run("http://127.0.0.1:" + (server.address() as AddressInfo).port, hub); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const viewer = { "Content-Type": "application/json", "X-Jarvis-Chat": "1" };
const worker = { Authorization: "Bearer " + TOKEN };

test("screenshots: the PC is told what to do, uploads a JPEG, and the viewer gets it", async () => {
  await withServer(async base => {
    assert.equal((await fetch(base + "/api/pc/screen/control")).status, 401, "the worker token is required");
    assert.deepEqual(await (await fetch(base + "/api/pc/screen/control", { headers: worker })).json(), { mode: "off" });
    assert.equal((await fetch(base + "/api/pc/screen/ingest/frame", { method: "POST", headers: worker, body: JPEG })).status, 409, "nobody is watching");

    assert.equal((await fetch(base + "/api/pc/screen/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"mode":"screenshots"}' })).status, 403, "the page header is required");
    assert.equal((await fetch(base + "/api/pc/screen/watch", { method: "POST", headers: viewer, body: '{"mode":"cinema"}' })).status, 400);
    await fetch(base + "/api/pc/screen/watch", { method: "POST", headers: viewer, body: '{"mode":"screenshots"}' });
    assert.deepEqual(await (await fetch(base + "/api/pc/screen/control", { headers: worker })).json(), { mode: "screenshots" });

    assert.equal((await fetch(base + "/api/pc/screen/frame")).status, 204, "no picture yet");
    assert.equal((await fetch(base + "/api/pc/screen/ingest/frame", { method: "POST", headers: worker, body: Buffer.from("not a jpeg") })).status, 400);
    assert.equal((await fetch(base + "/api/pc/screen/ingest/frame", { method: "POST", headers: worker, body: JPEG })).status, 204);
    const got = await fetch(base + "/api/pc/screen/frame");
    assert.equal(got.headers.get("content-type"), "image/jpeg");
    assert.ok(Buffer.from(await got.arrayBuffer()).equals(JPEG));

    await fetch(base + "/api/pc/screen/watch", { method: "POST", headers: viewer, body: '{"mode":"off"}' });
    assert.equal((await fetch(base + "/api/pc/screen/frame")).status, 204, "Off clears the picture");
  });
});

test("video: the PC streams, the viewer receives the init piece then each fragment, and nothing is stored", async () => {
  await withServer(async (base, hub) => {
    await fetch(base + "/api/pc/screen/watch", { method: "POST", headers: viewer, body: '{"mode":"video"}' });
    const watching = fetch(base + "/api/pc/screen/video").then(async response => ({ response, body: Buffer.from(await response.arrayBuffer()) }));
    // The PC starts sending a moment later; the viewer waits for it.
    await new Promise(resolve => setTimeout(resolve, 300));
    const upload = fetch(base + "/api/pc/screen/ingest/video", {
      method: "POST", headers: worker, duplex: "half",
      body: new ReadableStream({
        async start(controller) {
          controller.enqueue(INIT.subarray(0, 10)); controller.enqueue(INIT.subarray(10));
          await new Promise(resolve => setTimeout(resolve, 150));
          controller.enqueue(fragment(1)); await new Promise(resolve => setTimeout(resolve, 100));
          controller.enqueue(fragment(2)); await new Promise(resolve => setTimeout(resolve, 100));
          controller.close();
        },
      }),
    } as RequestInit);
    const { response, body } = await watching;
    await upload;
    assert.equal(response.headers.get("x-video-codec"), "avc1.42e01f");
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.ok(body.equals(Buffer.concat([INIT, fragment(1), fragment(2)])), "viewer got init + both fragments in order");
    assert.equal(hub.hasInit(), false, "the stream is dropped once the PC stops sending");
  });
});
