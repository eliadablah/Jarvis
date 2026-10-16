// Copies the non-TypeScript browser files into dist/public at build time:
// the stylesheet, and the self-hosted voice engine (Kokoro's browser build
// plus the exact ONNX Runtime files it was built against), so Jarvis never
// loads code from a CDN at runtime.

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(appDir, "dist", "public");
const voiceOut = join(out, "voice");
mkdirSync(voiceOut, { recursive: true });

const copy = (from, to) => {
  copyFileSync(join(appDir, from), to);
  console.log(`copied ${from}`);
};

copy("public/app.css", join(out, "app.css"));
for (const file of ['dashboard.js','dashboard-live.css','viewSchedule.js','dashboard.css','dashboard-b.css','dashboard-c.css','manifest.webmanifest','jarvis-icon.svg','jarvis-192.png','jarvis-512.png']) copy('public/'+file, join(out,file));
copy("node_modules/kokoro-js/dist/kokoro.web.js", join(voiceOut, "kokoro.web.js"));

// Kokoro's browser build bundles ONNX Runtime; its WebAssembly files must
// come from the same ONNX Runtime version, or the engine won't start.
const ortVersion = JSON.parse(readFileSync(join(appDir, "node_modules/onnxruntime-web/package.json"), "utf8")).version;
const bundled = readFileSync(join(appDir, "node_modules/kokoro-js/dist/kokoro.web.js"), "utf8");
if (!bundled.includes(ortVersion)) {
  throw new Error(`onnxruntime-web ${ortVersion} doesn't match the version bundled in kokoro.web.js`);
}
for (const file of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  copy(`node_modules/onnxruntime-web/dist/${file}`, join(voiceOut, file));
}
