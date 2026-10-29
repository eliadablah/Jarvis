// DevOps teacher card: one question a day with an explanation after you answer,
// a streak, and a "Quiz me" button for a five-question practice round. The
// server picks the questions and only reveals an answer after you've given yours.

const LETTERS = ['A', 'B', 'C', 'D'];

/** "4 of 5", with a short comment on the score. */
export function scoreLine(correct, total) {
  const comment = correct === total ? 'Perfect round.' : correct >= total * 0.6 ? 'Solid. Review the ones you missed.' : 'Keep going. Missed questions come back.';
  return `${correct} of ${total}. ${comment}`;
}

export function mountLearn({ api, safe, toast }) {
  const grid = document.querySelector('.dashboard-grid');
  const card = document.createElement('section');
  card.className = 'card learn'; card.dataset.section = 'learn';
  grid.append(card);
  // mode: 'daily' | 'quiz' | 'summary'
  let today = null, mode = 'daily', quiz = null, busy = false;

  const tag = (text, extra = '') => `<span class="tag ${extra}">${safe(text)}</span>`;

  function head() {
    const streak = today?.streak ?? 0;
    return `<div class="card-head"><div><div class="eyebrow">ONE QUESTION A DAY</div><h2>DevOps teacher</h2></div>${tag(streak ? `${streak}-day streak` : 'Start a streak', streak ? 'gold' : '')}</div>`;
  }
  function choices(q, result) {
    return `<div class="learn-choices">${q.choices.map((text, i) => {
      const state = !result ? '' : i === result.answer ? ' is-right' : i === result.choice ? ' is-wrong' : ' is-dim';
      return `<button type="button" class="learn-choice${state}" data-choice="${i}" ${result ? 'disabled' : ''}><b>${LETTERS[i]}</b><span>${safe(text)}</span></button>`;
    }).join('')}</div>`;
  }
  function feedback(result) {
    return result ? `<div class="learn-why ${result.correct ? 'is-right' : 'is-wrong'}"><strong>${result.correct ? 'Correct.' : 'Not quite.'}</strong> ${safe(result.why)}</div>` : '';
  }
  function topicChips() {
    return `<div class="learn-topics">${(today?.byTopic || []).map(t => `<span title="${t.correct} right out of ${t.attempted} tried, ${t.total} questions">${safe(t.topic)} <b>${t.attempted}/${t.total}</b></span>`).join('')}</div>`;
  }

  function render() {
    if (!today) { card.innerHTML = head() + '<p class="task-meta">Loading today’s question…</p>'; return; }
    let body;
    if (mode === 'summary') {
      body = `<div class="learn-summary"><h3>Round complete</h3><p>${safe(scoreLine(quiz.correct, quiz.questions.length))}</p><button class="primary-btn" data-action="back" type="button">Back to today’s question</button> <button class="text-btn" data-action="quiz" type="button">Another round</button></div>`;
    } else if (mode === 'quiz') {
      const q = quiz.questions[quiz.index], result = quiz.result;
      body = `<div class="learn-progress">${tag(q.topic)}<span>Question ${quiz.index + 1} of ${quiz.questions.length}</span></div><p class="learn-q">${safe(q.q)}</p>${choices(q, result)}${feedback(result)}${result ? `<button class="primary-btn" data-action="next" type="button">${quiz.index + 1 < quiz.questions.length ? 'Next question' : 'See my score'}</button>` : ''}`;
    } else {
      const d = today.daily, result = d.answered ? { answer: d.answer, choice: d.choice, correct: d.correct, why: d.why } : null;
      body = `<div class="learn-progress">${tag(d.topic)}<span>${d.answered ? 'Answered for today' : 'Today’s question'}</span></div><p class="learn-q">${safe(d.q)}</p>${choices(d, result)}${feedback(result)}`;
    }
    const foot = mode === 'quiz' ? '<button class="text-btn" data-action="back" type="button">Stop the round</button>'
      : mode === 'daily' ? '<button class="text-btn" data-action="quiz" type="button">Quiz me: 5 questions ↗</button>' : '';
    card.innerHTML = head() + body + topicChips() + `<div class="card-foot"><span>${today.answeredToday} answered today${today.accuracy == null ? '' : ` · ${today.accuracy}% right lately`}</span>${foot}</div>`;
  }

  async function refreshToday() { today = await api('/api/learn'); }
  async function answer(index) {
    if (busy) return; busy = true;
    try {
      const isQuiz = mode === 'quiz';
      const q = isQuiz ? quiz.questions[quiz.index] : today.daily;
      const r = await api('/api/learn/answer', 'POST', { id: q.id, choice: index, mode: isQuiz ? 'quiz' : 'daily' });
      if (isQuiz) { quiz.result = { ...r, choice: index }; if (r.correct) quiz.correct += 1; today = { ...today, streak: r.streak }; }
      else { await refreshToday(); }
      render();
    } catch (e) { toast(e.message); } finally { busy = false; }
  }
  async function startQuiz() {
    try {
      const data = await api('/api/learn/quiz');
      quiz = { questions: data.questions, index: 0, correct: 0, result: null }; mode = 'quiz'; render();
    } catch (e) { toast(e.message); }
  }

  card.addEventListener('click', async event => {
    const choice = event.target.closest('[data-choice]');
    if (choice) { await answer(Number(choice.dataset.choice)); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'quiz') await startQuiz();
    if (action === 'back') { mode = 'daily'; try { await refreshToday(); } catch { /* keep the old view */ } render(); }
    if (action === 'next') {
      if (quiz.index + 1 < quiz.questions.length) { quiz.index += 1; quiz.result = null; mode = 'quiz'; }
      else { mode = 'summary'; try { await refreshToday(); } catch { /* keep the old view */ } }
      render();
    }
  });

  render();
  refreshToday().then(render).catch(() => { card.innerHTML = head() + '<p class="task-meta">The teacher couldn’t load right now. It will retry when you reopen the dashboard.</p>'; });
  return { render };
}
