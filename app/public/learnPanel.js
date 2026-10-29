// DevOps teacher card: today's question with an explanation after you answer,
// a streak, and topic progress. "Quiz me" and the topic chips open the quiz
// popup (quizModal.js). The server picks the questions and only reveals an
// answer after you've given yours.

import { openQuiz } from './quizModal.js';

const LETTERS = ['A', 'B', 'C', 'D'];

export function mountLearn({ api, safe, toast, modal }) {
  const grid = document.querySelector('.dashboard-grid');
  const card = document.createElement('section');
  card.className = 'card learn'; card.dataset.section = 'learn';
  grid.append(card);
  let today = null, busy = false;

  const tag = (text, extra = '') => `<span class="tag ${extra}">${safe(text)}</span>`;
  const head = () => {
    const streak = today?.streak ?? 0;
    return `<div class="card-head"><div><div class="eyebrow">ONE QUESTION A DAY</div><h2>DevOps teacher</h2></div>${tag(streak ? `${streak}-day streak` : 'Start a streak', streak ? 'gold' : '')}</div>`;
  };

  function render() {
    if (!today) { card.innerHTML = head() + '<p class="task-meta">Loading today’s question…</p>'; return; }
    const d = today.daily, result = d.answered ? { answer: d.answer, choice: d.choice, correct: d.correct, why: d.why } : null;
    const choices = d.choices.map((text, i) => {
      const state = !result ? '' : i === result.answer ? ' is-right' : i === result.choice ? ' is-wrong' : ' is-dim';
      return `<button type="button" class="learn-choice${state}" data-choice="${i}" ${result ? 'disabled' : ''}><b>${LETTERS[i]}</b><span>${safe(text)}</span></button>`;
    }).join('');
    const why = result ? `<div class="learn-why ${result.correct ? 'is-right' : 'is-wrong'}"><strong>${result.correct ? 'Correct.' : 'Not quite.'}</strong> ${safe(result.why)}</div>` : '';
    const topics = (today.byTopic || []).map(t => `<button type="button" class="learn-topic" data-topic="${safe(t.topic)}" title="Quiz me on ${safe(t.topic)}: ${t.correct} right out of ${t.attempted} tried, ${t.total} questions">${safe(t.topic)} <b>${t.attempted}/${t.total}</b></button>`).join('');
    card.innerHTML = `${head()}<div class="learn-progress">${tag(d.topic)}<span>${d.answered ? 'Answered for today' : 'Today’s question'}</span></div><p class="learn-q">${safe(d.q)}</p><div class="learn-choices">${choices}</div>${why}<div class="learn-topics" aria-label="Quiz me on a topic">${topics}</div><div class="card-foot"><span>${today.answeredToday} answered today${today.accuracy == null ? '' : ` · ${today.accuracy}% right lately`}</span><button class="text-btn" data-action="quiz" type="button">Quiz me: 5 questions ↗</button></div>`;
  }

  async function refresh() { today = await api('/api/learn'); render(); }

  async function answer(index) {
    if (busy) return; busy = true;
    try { await api('/api/learn/answer', 'POST', { id: today.daily.id, choice: index, mode: 'daily' }); await refresh(); }
    catch (e) { toast(e.message); } finally { busy = false; }
  }

  card.addEventListener('click', event => {
    const choice = event.target.closest('[data-choice]');
    if (choice) { void answer(Number(choice.dataset.choice)); return; }
    const topic = event.target.closest('[data-topic]');
    if (topic) { void openQuiz({ api, safe, modal, toast, topic: topic.dataset.topic }); return; }
    if (event.target.closest('[data-action="quiz"]')) void openQuiz({ api, safe, modal, toast });
  });
  // A finished quiz round updates the streak and counts here.
  document.addEventListener('jarvis:learn-updated', () => { void refresh().catch(() => {}); });

  render();
  refresh().catch(() => { card.innerHTML = head() + '<p class="task-meta">The teacher couldn’t load right now. It will retry when you reopen the dashboard.</p>'; });
  return { render };
}
