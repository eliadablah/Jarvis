// The quiz popup. Saying or typing "quiz me" (or "quiz me on Docker") opens a
// window with five multiple-choice questions you click through, with instant
// feedback, a progress bar, and a score at the end. Keys A-D or 1-4 pick an
// answer; Enter moves on. Answers are checked and saved by the server.

export const QUIZ_TOPICS = ['Networking', 'Linux', 'Git', 'Docker', 'Kubernetes', 'CI/CD', 'Terraform', 'AWS'];

const ALIASES = [
  [/\b(?:network(?:ing)?|net\s?\+|network\s?\+|tcp|subnet\w*|dns|osi)\b/, 'Networking'],
  [/\b(?:linux|bash|shell|unix)\b/, 'Linux'],
  [/\b(?:git|github|version control)\b(?!\s+actions)/, 'Git'],
  [/\b(?:docker|containers?|dockerfiles?)\b/, 'Docker'],
  [/\b(?:kubernetes|k8s|kube\w*|pods?)\b/, 'Kubernetes'],
  [/\b(?:ci\s?\/?\s?cd|pipelines?|github actions|jenkins|devops pipelines?)\b/, 'CI/CD'],
  [/\b(?:terraform|iac|infrastructure as code)\b/, 'Terraform'],
  [/\b(?:aws|amazon|cloud|iam|s3|ec2)\b/, 'AWS'],
];

/** "quiz me" -> {topic: null}; "quiz me on k8s" -> {topic: 'Kubernetes'}; unknown subject -> {unknown}; anything else -> null. */
export function parseQuizCommand(text) {
  if (typeof text !== 'string') return null;
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = /^(?:(?:hey |ok |okay |so )?jarvis )?(?:(?:can|could|would) you |please |go ahead and |let's |lets |i want to |i'd like to )*(?:quiz me|test me|give me a (?:quick )?(?:quiz|test)|start a (?:quick )?quiz|run a quiz|(?:ask|give) me (?:a |some )?(?:devops |tech |practice )?(?:quiz )?questions?)(?: for me)?(?: (?:on|about|for|in)(?: the)? (.+?))?(?: please)?$/.exec(t);
  if (!match) return null;
  const subject = match[1];
  if (!subject) return { topic: null };
  const hit = ALIASES.find(([pattern]) => pattern.test(subject));
  return hit ? { topic: hit[1] } : { unknown: subject };
}

/** "4 of 5", with a short comment on the score. */
export function scoreLine(correct, total) {
  const comment = correct === total ? 'Perfect round.' : correct >= total * 0.6 ? 'Solid. Review the ones you missed.' : 'Keep going. Missed questions come back.';
  return `${correct} of ${total}. ${comment}`;
}

const LETTERS = ['A', 'B', 'C', 'D'];

export async function openQuiz({ api, safe, modal, toast, topic }) {
  modal(topic ? `Quiz: ${topic}` : 'Quiz time', '<div class="quiz-body" id="quiz-body"><p class="task-meta">Picking your questions…</p></div>');
  document.querySelector('.modal')?.classList.add('quiz-modal');
  // Each round only controls its own window, so a replaced or closed popup can't be answered by an older round.
  const element = document.querySelector('#quiz-body');
  const root = () => (document.querySelector('#quiz-body') === element ? element : null);

  let questions;
  try { questions = (await api('/api/learn/quiz' + (topic ? '?topic=' + encodeURIComponent(topic) : ''))).questions; }
  catch (e) { if (root()) root().innerHTML = `<p>${safe(e.message)}</p>`; return; }
  if (!questions.length) { root().innerHTML = '<p>No questions available right now.</p>'; return; }

  const s = { i: 0, correct: 0, result: null, marks: [], missed: [], busy: false };

  function steps() {
    return `<div class="quiz-steps" aria-hidden="true">${questions.map((_, k) => `<i class="${k < s.i ? s.marks[k] : k === s.i ? 'now' : ''}"></i>`).join('')}</div>`;
  }

  function render() {
    if (!root()) return;
    if (s.i >= questions.length) { renderSummary(); return; }
    const q = questions[s.i], r = s.result, last = s.i + 1 === questions.length;
    root().innerHTML = `${steps()}<div class="quiz-meta"><span class="tag">${safe(q.topic)}</span><span>Question ${s.i + 1} of ${questions.length}</span></div>
<div class="learn-q">${safe(q.q)}</div>
<div class="learn-choices" role="group" aria-label="Answers">${q.choices.map((text, i) => {
      const state = !r ? '' : i === r.answer ? ' is-right' : i === r.choice ? ' is-wrong' : ' is-dim';
      return `<button type="button" class="learn-choice${state}" data-quiz-choice="${i}" ${r ? 'disabled' : ''}><b>${LETTERS[i]}</b><span>${safe(text)}</span></button>`;
    }).join('')}</div>
${r ? `<div class="learn-why ${r.correct ? 'is-right' : 'is-wrong'}"><strong>${r.correct ? 'Correct.' : 'Not quite.'}</strong> ${safe(r.why)}</div><div class="quiz-actions"><button class="primary-btn" type="button" data-quiz-next>${last ? 'See my score' : 'Next question'}</button><small>Press Enter</small></div>` : '<div class="quiz-hint">Pick an answer, or press A, B, C or D.</div>'}`;
    root().querySelector('[data-quiz-next]')?.focus();
  }

  function renderSummary() {
    const total = questions.length;
    root().innerHTML = `${steps()}<div class="quiz-score"><b>${s.correct}</b><span>/ ${total}</span></div><p class="quiz-comment">${safe(scoreLine(s.correct, total))}</p>
${s.missed.length ? `<div class="quiz-missed"><h4>Review</h4>${s.missed.map(m => `<div class="quiz-miss"><div class="quiz-miss-q">${safe(m.q)}</div><div class="quiz-miss-a">Answer: ${safe(m.right)}</div><div class="quiz-miss-why">${safe(m.why)}</div></div>`).join('')}</div>` : ''}
<div class="quiz-actions"><button class="primary-btn" type="button" data-quiz-again>Another round</button><button class="text-btn" type="button" data-quiz-done>Done</button></div>`;
    document.dispatchEvent(new Event('jarvis:learn-updated'));
  }

  async function pick(index) {
    if (s.busy || s.result || s.i >= questions.length) return;
    s.busy = true;
    const q = questions[s.i];
    try {
      const r = await api('/api/learn/answer', 'POST', { id: q.id, choice: index, mode: 'quiz' });
      s.result = { ...r, choice: index };
      s.marks[s.i] = r.correct ? 'right' : 'wrong';
      if (r.correct) s.correct += 1; else s.missed.push({ q: q.q, right: q.choices[r.answer], why: r.why });
      render();
    } catch (e) { toast(e.message); } finally { s.busy = false; }
  }

  function next() {
    if (!s.result) return;
    s.i += 1; s.result = null; render();
  }

  function onKey(event) {
    if (!root()) { document.removeEventListener('keydown', onKey); return; }
    if (/^(?:input|textarea|select)$/i.test(event.target?.tagName || '') || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const index = 'abcd'.indexOf(key) >= 0 && key.length === 1 ? 'abcd'.indexOf(key) : '1234'.indexOf(key) >= 0 && key.length === 1 ? '1234'.indexOf(key) : -1;
    if (index >= 0 && !s.result) { event.preventDefault(); void pick(index); return; }
    if (event.key === 'Enter' && s.result && s.i < questions.length) { event.preventDefault(); next(); }
  }

  root().addEventListener('click', event => {
    const choice = event.target.closest('[data-quiz-choice]');
    if (choice) { void pick(Number(choice.dataset.quizChoice)); return; }
    if (event.target.closest('[data-quiz-next]')) { next(); return; }
    if (event.target.closest('[data-quiz-again]')) { void openQuiz({ api, safe, modal, toast, topic }); return; }
    if (event.target.closest('[data-quiz-done]')) document.querySelector('#modal-root')?.replaceChildren();
  });
  document.addEventListener('keydown', onKey);
  render();
}
