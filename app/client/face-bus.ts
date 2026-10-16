// Runs INSIDE each ai-visualizer face page, loaded just before its core.js.
// The faces normally poll a local Python server for /state and /config;
// this answers both from Jarvis's page (the frame's parent) instead, so the
// face code runs unchanged and performs the live chat and voice.

(() => {
  const realFetch = window.fetch.bind(window);

  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

  const config = { name: "JARVIS", badge: "", face: "board", thinking_sound: true, faces: [] };

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, location.href).pathname;

    if (path === "/state") {
      // Same-origin parent: read its live bus. Idle if it's not there.
      let bus: unknown;
      try {
        bus = (window.parent as Window & { __jarvisBus?: unknown }).__jarvisBus;
      } catch {
        bus = undefined;
      }
      return Promise.resolve(json(bus ?? { state: "idle", level: 0, samples: [], alert: false, loading: false }));
    }
    if (path === "/config") return Promise.resolve(json(config));
    return realFetch(input, init);
  };
})();
