// Spoken-reply caption: while Jarvis talks, the sentence being spoken shows
// in the middle of the screen and each word lights up as it's said, instead
// of a reply panel covering the dashboard.
//
// speakWithCaption(text, rate) speaks through the browser voice. Word timing
// comes from the voice's "boundary" events; voices that don't send them get
// an estimate from word length and speaking rate.
// showThinking() shows a small pulse while an answer is on its way.
// hideCaption() clears it (also on click or Escape).

const FADE_AFTER_MS = 1400;

let root;
let line;
let hideTimer;
let fallbackTimer;
let run = 0;

function ensureRoot() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'speech-caption';
  root.setAttribute('aria-live', 'polite');
  line = document.createElement('p');
  line.className = 'speech-caption-line';
  root.append(line);
  root.onclick = hideCaption;
  document.body.append(root);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCaption(); });
}

/** Splits text into sentences of words, keeping each word's position in the text. */
export function splitSentences(text) {
  const sentences = [];
  let current = [];
  for (const match of text.matchAll(/\S+/g)) {
    current.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    if (/[.!?…:]["')\]]*$/.test(match[0]) || current.length >= 18) { sentences.push(current); current = []; }
  }
  if (current.length) sentences.push(current);
  return sentences;
}

function show() {
  clearTimeout(hideTimer);
  root.classList.add('visible');
}

export function hideCaption() {
  if (!root) return;
  run++;
  clearTimeout(hideTimer);
  clearTimeout(fallbackTimer);
  root.classList.remove('visible', 'thinking');
}

export function showThinking() {
  ensureRoot();
  run++;
  clearTimeout(fallbackTimer);
  root.classList.add('thinking');
  line.replaceChildren(...[0, 1, 2].map(() => Object.assign(document.createElement('span'), { className: 'speech-caption-dot' })));
  show();
}

export function speakWithCaption(text, rate) {
  ensureRoot();
  const id = ++run;
  clearTimeout(fallbackTimer);
  root.classList.remove('thinking');
  const sentences = splitSentences(text);
  const words = sentences.flat();
  if (!words.length) { hideCaption(); return; }

  let shownSentence = -1;
  let spans = [];
  // --- Render the sentence holding word i and light that word up ---
  const highlight = i => {
    if (id !== run || i < 0 || i >= words.length) return;
    const sentenceIndex = sentences.findIndex(s => s.includes(words[i]));
    if (sentenceIndex !== shownSentence) {
      shownSentence = sentenceIndex;
      spans = sentences[sentenceIndex].map(w => Object.assign(document.createElement('span'), { className: 'speech-caption-word', textContent: w.word }));
      line.replaceChildren(...spans.flatMap((s, k) => k ? [document.createTextNode(' '), s] : [s]));
      line.classList.remove('enter'); void line.offsetWidth; line.classList.add('enter');
    }
    const offset = i - sentences.slice(0, sentenceIndex).reduce((n, s) => n + s.length, 0);
    spans.forEach((s, k) => { s.classList.toggle('spoken', k < offset); s.classList.toggle('current', k === offset); });
  };

  // --- Estimated timing, used until (unless) the voice sends word boundaries ---
  let boundaries = false;
  const estimate = i => {
    if (boundaries || id !== run || i >= words.length) return;
    highlight(i);
    const ms = (170 + words[i].word.length * 55) / rate + (/[.!?,;:]$/.test(words[i].word) ? 220 / rate : 0);
    fallbackTimer = setTimeout(() => estimate(i + 1), ms);
  };

  const finish = () => {
    if (id !== run) return;
    clearTimeout(fallbackTimer);
    spans.forEach(s => { s.classList.add('spoken'); s.classList.remove('current'); });
    hideTimer = setTimeout(() => { if (id === run) root.classList.remove('visible'); }, FADE_AFTER_MS);
  };

  show();
  highlight(0);
  if (!('speechSynthesis' in window)) { estimate(0); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.onstart = () => { if (!boundaries) estimate(0); };
  utterance.onboundary = e => {
    if (e.name !== 'word') return;
    boundaries = true;
    clearTimeout(fallbackTimer);
    highlight(words.findIndex(w => e.charIndex >= w.start && e.charIndex < w.end + 1));
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}
