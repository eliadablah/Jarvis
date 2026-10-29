// Tech news card: headlines from DevOps and cloud sources, loaded from
// /api/news (the server keeps a 30-minute cache). Links open in a new tab.

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function ago(iso, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

export function mountNews({ api, safe, icon }) {
  const grid = document.querySelector('.dashboard-grid');
  const card = document.createElement('section');
  card.className = 'card news'; card.dataset.section = 'news';
  card.innerHTML = `<div class="card-head"><div><div class="eyebrow">STAY CURRENT</div><h2>Tech news <span id="news-updated"></span></h2></div><button class="text-btn" id="news-refresh" type="button">${icon('arrow')} Refresh</button></div><div class="news-list" id="news-list" aria-live="polite"><p class="task-meta">Loading headlines…</p></div><div class="card-foot"><span id="news-sources">AWS, Kubernetes, Docker, HashiCorp, GitHub and more</span><button class="text-btn" id="news-more" type="button" hidden>Show all</button></div>`;
  grid.append(card);
  const list = card.querySelector('#news-list'), more = card.querySelector('#news-more');
  let items = [], showAll = false;

  function render() {
    const shown = showAll ? items : items.slice(0, 6);
    list.innerHTML = shown.length ? shown.map(item => /^https?:\/\//.test(item.url)
      ? `<a class="news-row" href="${safe(item.url)}" target="_blank" rel="noopener noreferrer"><span class="news-title">${safe(item.title)}</span><span class="news-meta">${safe(item.source)} · ${safe(ago(item.at))}</span></a>` : '').join('')
      : '<p class="task-meta">No headlines yet. Try Refresh in a moment.</p>';
    more.hidden = items.length <= 6;
    more.textContent = showAll ? 'Show fewer' : `Show all ${items.length}`;
  }
  async function load() {
    try {
      const data = await api('/api/news');
      items = Array.isArray(data.items) ? data.items : [];
      card.querySelector('#news-updated').textContent = data.failed?.length ? `${data.failed.length} source${data.failed.length === 1 ? '' : 's'} unavailable` : '';
    } catch { card.querySelector('#news-updated').textContent = 'unavailable right now'; }
    render();
  }
  card.querySelector('#news-refresh').onclick = load;
  more.onclick = () => { showAll = !showAll; render(); };
  void load();
  setInterval(() => { if (!document.hidden) void load(); }, 30 * 60000);
  return { reload: load };
}
