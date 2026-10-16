// Security headers for every response, in one place.
//
// The page loads only its own code. The one outside connection is the
// Kokoro voice model, fetched once from Hugging Face and then cached by the
// browser. 'wasm-unsafe-eval' lets the voice engine (WebAssembly) start; it
// does not allow JavaScript eval. The face pages ship inline scripts, so
// they get their own policy with 'unsafe-inline' for scripts.
//
// Deliberately NOT cross-origin isolated (no COEP): when isolated, the voice
// engine starts its own helper threads, and inside a Web Worker that hangs
// while loading the model (seen in Chrome, onnxruntime-web 1.22 dev). Not
// isolated, it runs single-threaded in the worker, which works and keeps the
// face animation smooth.

const MODEL_HOSTS = "https://huggingface.co https://*.huggingface.co https://*.hf.co";

const base: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
};

/** Headers for Jarvis's own pages, scripts, and voice files. */
export function appHeaders(): Record<string, string> {
  return {
    ...base,
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      `connect-src 'self' blob: ${MODEL_HOSTS}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
  };
}

/** Headers for the visualizer faces, which run inside Jarvis's page. */
export function faceHeaders(): Record<string, string> {
  return {
    ...base,
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'none'",
    ].join("; "),
  };
}
