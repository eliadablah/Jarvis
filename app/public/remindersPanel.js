// Reminders: tasks tagged "Reminder" that carry a time. They live in their own
// card, sorted by time, and are kept out of the plain to-do list. While the
// dashboard is open, a reminder that comes due shows a notice once.

export const isReminder = task => task?.tag === 'Reminder' && typeof task.remindAt === 'string';

const time = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "In 23 min", "Today 3:00 PM", "Tomorrow 9:00 AM", "Overdue 2h", with a state for styling. */
export function dueLabel(remindAt, now = new Date()) {
  const when = new Date(remindAt);
  if (Number.isNaN(when.valueOf())) return { text: 'No time set', state: 'later' };
  const diff = when.getTime() - now.getTime();
  const minutes = Math.round(Math.abs(diff) / 60000);
  if (diff < 0) return { text: minutes < 60 ? `Overdue ${Math.max(minutes, 1)} min` : minutes < 1440 ? `Overdue ${Math.round(minutes / 60)} h` : `Overdue · ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, state: 'overdue' };
  if (minutes < 60) return { text: `In ${Math.max(minutes, 1)} min`, state: 'soon' };
  const days = Math.round((dayStart(when) - dayStart(now)) / 86400000);
  if (days === 0) return { text: `Today ${time(when)}`, state: 'today' };
  if (days === 1) return { text: `Tomorrow ${time(when)}`, state: 'later' };
  return { text: `${when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${time(when)}`, state: 'later' };
}

/** Open reminders first, soonest first; finished ones sink to the bottom. */
export function sortReminders(list) {
  return [...list].sort((a, b) => (a.done - b.done) || Date.parse(a.remindAt) - Date.parse(b.remindAt));
}

const localInputValue = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function mountReminders({ api, safe, modal, toast, icon, getTasks, setTasks, onChange }) {
  const grid = document.querySelector('.dashboard-grid');
  const card = document.createElement('section');
  card.className = 'card reminders'; card.dataset.section = 'reminders';
  card.innerHTML = `<div class="card-head"><div><div class="eyebrow">DON’T LET IT SLIP</div><h2>Reminders <span id="reminder-count"></span></h2></div><button class="text-btn" id="add-reminder" type="button">${icon('plus')} Add reminder</button></div><div class="reminder-list" id="reminder-list" aria-live="polite"></div><div class="card-foot">Saved on your private server <span>Notices appear while Jarvis is open</span></div>`;
  grid.append(card);
  const list = card.querySelector('#reminder-list');
  const seen = new Set();
  try { JSON.parse(localStorage.getItem('jarvis.remindersSeen') || '[]').forEach(id => seen.add(id)); } catch { /* start fresh */ }

  function render() {
    const reminders = sortReminders(getTasks().filter(isReminder));
    const open = reminders.filter(r => !r.done).length;
    card.querySelector('#reminder-count').textContent = open ? `${open} open` : '';
    list.innerHTML = reminders.length ? reminders.map(r => {
      const due = dueLabel(r.remindAt);
      return `<div class="reminder-row ${r.done ? 'is-done' : ''}" data-state="${r.done ? 'done' : due.state}"><button class="task-check ${r.done ? 'checked' : ''}" data-reminder-check="${safe(r.id)}" aria-label="${r.done ? 'Reopen' : 'Complete'} ${safe(r.title)}" aria-pressed="${!!r.done}">${r.done ? icon('check') : ''}</button><div class="task-copy"><div class="task-title">${safe(r.title)}</div><div class="task-meta">${safe(due.text)}</div></div></div>`;
    }).join('') : '<p class="task-meta">Nothing to remember yet. Add one, with the time you want to see it.</p>';
  }

  function notifyDue() {
    for (const r of getTasks().filter(isReminder)) {
      if (r.done || seen.has(r.id) || Date.parse(r.remindAt) > Date.now()) continue;
      seen.add(r.id);
      try { localStorage.setItem('jarvis.remindersSeen', JSON.stringify([...seen].slice(-200))); } catch { /* not remembered */ }
      toast(`Reminder: ${r.title}`);
    }
    render();
  }

  card.addEventListener('click', async event => {
    const check = event.target.closest('[data-reminder-check]');
    if (!check) return;
    const task = getTasks().find(t => t.id === check.dataset.reminderCheck);
    if (!task) return;
    try { setTasks((await api(`/api/dashboard/tasks/${task.id}`, 'PATCH', { done: !task.done })).tasks); onChange(); toast('Saved.'); }
    catch (e) { toast(e.message); }
  });

  card.querySelector('#add-reminder').onclick = () => {
    const soon = new Date(Date.now() + 3600000); soon.setMinutes(0, 0, 0);
    modal('New reminder', `<label for="new-reminder">What should I remind you about?</label><input class="modal-input" id="new-reminder" maxlength="300" placeholder="Call the dentist"><label for="new-reminder-time">When</label><input class="modal-input" id="new-reminder-time" type="datetime-local" value="${localInputValue(soon)}"><button class="primary-btn" id="save-reminder" type="button">Save reminder</button>`);
    document.querySelector('#new-reminder').focus();
    document.querySelector('#save-reminder').onclick = async () => {
      const title = document.querySelector('#new-reminder').value.trim();
      const when = new Date(document.querySelector('#new-reminder-time').value);
      if (!title) { toast('Say what to remind you about.'); return; }
      if (Number.isNaN(when.valueOf())) { toast('Pick a date and time.'); return; }
      const button = document.querySelector('#save-reminder'); button.disabled = true;
      try { setTasks((await api('/api/dashboard/tasks', 'POST', { title, remindAt: when.toISOString() })).tasks); document.querySelector('#modal-root').replaceChildren(); onChange(); toast('Reminder saved.'); }
      catch (e) { toast(e.message); button.disabled = false; }
    };
  };

  setInterval(() => { if (!document.hidden) notifyDue(); }, 30000);
  return { render, notifyDue };
}
