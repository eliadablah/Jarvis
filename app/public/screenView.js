// The live screen viewer inside the live island. Video is the main way:
// the server relays a live H.264 stream from Hands and this plays it with
// Media Source Extensions. Screenshots (a new picture every ~2 seconds) are the
// other way, and the automatic fallback if video can't start or the browser
// can't play it. While you watch, the page tells the server every few seconds;
// when you stop (or close the page) the PC stops recording within moments.

// Video arrives in one-second chunks. Staying about a second behind live gives playback a cushion so a late chunk doesn't freeze it.
const PING_MS = 4000, FRAME_MS = 1500, FIRST_PICTURE_MS = 14000, KEEP_SECONDS = 20, LIVE_LAG = 2.5, LIVE_CUSHION = 1.0;

export function createScreenView({ api, toast }) {
  const el = document.createElement('div');
  el.className = 'island-screen'; el.hidden = true;
  el.innerHTML = `<div class="screen-bar"><div class="screen-tabs" role="group" aria-label="How to watch">
<button type="button" data-screen="video">Video <em>recommended</em></button><button type="button" data-screen="screenshots">Screenshots</button><button type="button" data-screen="off">Hide</button></div>
<span class="screen-status" role="status" aria-live="polite"></span></div>
<div class="screen-stage"><video muted playsinline autoplay hidden></video><img alt="Live screenshot of your PC" hidden></div>`;
  const video = el.querySelector('video'), image = el.querySelector('img'), status = el.querySelector('.screen-status');
  let mode = 'off', pingTimer, frameTimer, watchdog, abort, mediaUrl, frameUrl, session = 0;

  const say = text => { status.textContent = text; };
  const mark = () => el.querySelectorAll('[data-screen]').forEach(b => b.classList.toggle('on', b.dataset.screen === mode));

  async function ping() {
    try { await api('/api/pc/screen/watch', 'POST', { mode }); } catch (e) { if (mode !== 'off') toast(e.message); }
  }

  function stopViewer() {
    session += 1;
    clearInterval(frameTimer); clearTimeout(watchdog); frameTimer = watchdog = undefined;
    abort?.abort(); abort = undefined;
    video.pause?.(); video.removeAttribute('src'); video.load?.(); video.hidden = true;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl); mediaUrl = undefined;
    image.hidden = true; image.removeAttribute('src');
    if (frameUrl) URL.revokeObjectURL(frameUrl); frameUrl = undefined;
  }

  /** Switches viewing mode. "off" hides everything and tells the server to stop the PC recording. */
  function setMode(next, reason) {
    if (next === mode && !reason) return;
    stopViewer(); clearInterval(pingTimer); pingTimer = undefined;
    mode = next; mark();
    if (next === 'off') { el.hidden = true; say(''); void api('/api/pc/screen/watch', 'POST', { mode: 'off' }).catch(() => {}); return; }
    el.hidden = false; say(reason || 'Starting…');
    void ping(); pingTimer = setInterval(() => void ping(), PING_MS);
    if (next === 'video') startVideo(); else startFrames();
  }

  function fallback(message) {
    if (mode !== 'video') return;
    toast(message);
    setMode('screenshots', message);
  }

  function startFrames() {
    const mine = session; let busy = false;
    say('Waiting for the first screenshot…');
    const tick = async () => {
      if (busy || mine !== session) return; busy = true;
      try {
        const response = await fetch('/api/pc/screen/frame', { cache: 'no-store' });
        if (mine !== session) return;
        if (response.status === 200) {
          const url = URL.createObjectURL(await response.blob());
          if (frameUrl) URL.revokeObjectURL(frameUrl);
          frameUrl = url; image.src = url; image.hidden = false; say('Live · screenshots every 2 seconds');
        } else say('Waiting for the PC’s next screenshot…');
      } catch { if (mine === session) say('Connection lost. Retrying…'); } finally { busy = false; }
    };
    void tick(); frameTimer = setInterval(() => void tick(), FRAME_MS);
  }

  function startVideo() {
    const mine = session;
    if (!('MediaSource' in window)) { fallback('This browser can’t play live video, so I switched to screenshots.'); return; }
    say('Connecting to the PC…');
    const source = new MediaSource();
    mediaUrl = URL.createObjectURL(source); video.src = mediaUrl; video.hidden = false;
    watchdog = setTimeout(() => { if (mine === session) fallback('The PC didn’t start sending video, so I switched to screenshots.'); }, FIRST_PICTURE_MS);
    source.addEventListener('sourceopen', async () => {
      if (mine !== session) return;
      abort = new AbortController();
      try {
        const response = await fetch('/api/pc/screen/video', { cache: 'no-store', signal: abort.signal });
        if (mine !== session) return;
        const codec = response.headers.get('X-Video-Codec');
        const type = `video/mp4; codecs="${codec}"`;
        if (!response.ok || !codec || !MediaSource.isTypeSupported(type)) { fallback('Live video isn’t available right now, so I switched to screenshots.'); return; }
        const buffer = source.addSourceBuffer(type);
        buffer.mode = 'sequence';
        const reader = response.body.getReader();
        const queue = []; let first = true;
        const pump = () => {
          if (mine !== session || buffer.updating || !queue.length) return;
          try { buffer.appendBuffer(queue.shift()); } catch { fallback('The video stopped working, so I switched to screenshots.'); }
        };
        buffer.addEventListener('updateend', () => {
          if (mine !== session) return;
          if (first && video.buffered.length) { first = false; clearTimeout(watchdog); say('Live video'); void video.play().catch(() => {}); }
          if (video.buffered.length) {
            const end = video.buffered.end(video.buffered.length - 1);
            if (end - video.currentTime > LIVE_LAG) video.currentTime = end - LIVE_CUSHION;
            const start = video.buffered.start(0);
            if (end - start > KEEP_SECONDS && !buffer.updating) { try { buffer.remove(start, end - KEEP_SECONDS / 2); } catch { /* keep going */ } }
          }
          pump();
        });
        for (;;) {
          const { value, done } = await reader.read();
          if (mine !== session) return;
          if (done) break;
          queue.push(value); pump();
        }
        // The PC stopped sending (a task ended or the recorder restarted). Reconnect while you're still watching.
        if (mine === session && mode === 'video') { say('Stream ended. Reconnecting…'); setTimeout(() => { if (mine === session && mode === 'video') setMode('video', 'Reconnecting…'); }, 2000); }
      } catch (e) {
        if (mine === session && e.name !== 'AbortError') fallback('The live video connection dropped, so I switched to screenshots.');
      }
    }, { once: true });
  }

  el.addEventListener('click', event => {
    const choice = event.target.closest('[data-screen]')?.dataset.screen;
    if (choice) setMode(choice, choice === mode ? 'Restarting…' : undefined);
  });

  return { el, setMode, mode: () => mode };
}
