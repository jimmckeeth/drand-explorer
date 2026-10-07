import {
  beaconUrl,
  expectedRound,
  fetchBeaconSummary,
  fetchJson,
  parseBeaconIds,
  roundTime,
  summarizeRound,
  API_BASE
} from './drand.js';

const STORE_KEY = 'drand-explorer:v1';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const listEl = $('beaconList');
const detailEl = $('detail');
const outputModeEl = $('outputMode');

// ---- persisted per-browser state -------------------------------------------------------
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
})();

const state = {
  beacons: Array.isArray(saved.beacons) ? saved.beacons : [],
  selected: saved.selected || null,
  history: saved.history || {}, // beacon id -> round being browsed
  outputMode: saved.outputMode || 'url',
  theme: saved.theme || 'auto',
  savedAt: saved.savedAt || null,
  historyData: null // { id, round, data | error }
};

function persist() {
  try {
    const { beacons, selected, history, outputMode, theme } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ beacons, selected, history, outputMode, theme, savedAt: state.savedAt }));
  } catch {
    /* storage unavailable or full: the app still works */
  }
}

// ---- helpers ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : '—');
const short = (h, n = 10) => (h && h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h || '—');
const byId = (id) => state.beacons.find((b) => b.id === id);
const selectedBeacon = () => byId(state.selected);

function health(b) {
  const cur = b.latest?.round;
  const exp = expectedRound(b);
  if (!cur || !exp) return { text: 'Unknown', cls: 'warn' };
  const behind = exp - cur;
  if (behind <= 1) return { text: 'Healthy', cls: 'ok' };
  if (behind <= 3) return { text: `Behind ${behind}`, cls: 'warn' };
  return { text: `Behind ${behind}`, cls: 'bad' };
}

// kind: 'info' | 'round'; round: number or 'latest'
function command(b, kind, round) {
  const url = beaconUrl(b.id, kind === 'info' ? '/info' : `/rounds/${round}`);
  if (state.outputMode === 'curl') return `curl -s "${url}"`;
  if (state.outputMode === 'cli') {
    const base = `--url ${API_BASE.replace(/\/v2$/, '')} --chain-hash ${b.hash || '<chain-hash>'}`;
    return kind === 'info' ? `drand get chain-info ${base}` : `drand get public ${base}${round === 'latest' ? '' : ` --round ${round}`}`;
  }
  return url;
}

function commandRow(b, label, kind, round) {
  const cmd = command(b, kind, round);
  return `<div class="kv"><span class="k">${esc(label)}</span><code class="v wrap">${esc(cmd)}</code>
    <button type="button" class="copy" data-copy="${esc(cmd)}">Copy</button></div>`;
}

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = `statusbar ${cls}`;
}

// ---- rendering -------------------------------------------------------------------------
function renderList() {
  listEl.innerHTML = state.beacons
    .map((b) => {
      const h = health(b);
      return `<li><button type="button" class="beacon-item${b.id === state.selected ? ' active' : ''}" data-id="${esc(b.id)}">
        <span class="dot ${h.cls}" title="${esc(h.text)}"></span>
        <span class="beacon-name">${esc(b.id)}</span>
        <span class="beacon-meta">${b.period ? `${b.period}s` : ''}${b.latest?.round ? ` · #${b.latest.round}` : ''}</span>
      </button></li>`;
    })
    .join('');
}

function copyRow(label, value, { raw = false } = {}) {
  return `<div class="kv"><span class="k">${esc(label)}</span><code class="v${raw ? ' wrap' : ''}">${esc(value || '—')}</code>${
    value ? `<button type="button" class="copy" data-copy="${esc(value)}">Copy</button>` : ''
  }</div>`;
}

function renderHistoryResult(b) {
  const h = state.historyData;
  const round = state.history[b.id];
  if (!h || h.id !== b.id || h.round !== round) {
    return '<p class="muted">Press Load to fetch this round.</p>';
  }
  if (h.error) return `<p class="error">Round ${round} not available (${esc(h.error)}).</p>`;
  return `${copyRow('Randomness', h.data.randomness, { raw: true })}
    ${copyRow('Signature', h.data.signature, { raw: true })}
    <div class="kv"><span class="k">Time</span><span class="v">${fmtTime(roundTime(b, round))}</span></div>
    ${commandRow(b, 'Command', 'round', round)}`;
}

function renderCommands(b) {
  const round = state.history[b.id] || b.latest?.round || 'latest';
  return [commandRow(b, 'Info', 'info'), commandRow(b, 'Latest', 'round', 'latest'), commandRow(b, `Round ${round}`, 'round', round)].join('');
}

function renderDetail() {
  const b = selectedBeacon();
  if (!b) {
    detailEl.innerHTML = '<div class="empty">Select a beacon to explore its rounds.</div>';
    return;
  }
  const h = health(b);
  const histRound = state.history[b.id] || b.latest?.round || 1;
  detailEl.innerHTML = `
    <section class="card hero">
      <div class="hero-head">
        <h2>${esc(b.id)}</h2>
        <span class="pill ${h.cls}">${esc(h.text)}</span>
      </div>
      <dl class="stats">
        <div><dt>Period</dt><dd>${b.period ? `${b.period}s` : '—'}</dd></div>
        <div><dt>Scheme</dt><dd>${esc(b.scheme || '—')}</dd></div>
        <div><dt>Genesis</dt><dd>${fmtTime(b.genesisTime)}</dd></div>
        <div><dt>Next round in</dt><dd id="countdown">—</dd></div>
      </dl>
      ${copyRow('Chain hash', b.hash, { raw: true })}
      ${copyRow('Public key', b.publicKey, { raw: true })}
    </section>

    <section class="card">
      <h3>Latest round <span class="round-no" id="latestNo">${b.latest?.round ? `#${b.latest.round}` : ''}</span></h3>
      <div id="latestBody">
        ${copyRow('Randomness', b.latest?.randomness, { raw: true })}
        ${copyRow('Signature', b.latest?.signature, { raw: true })}
        <div class="kv"><span class="k">Time</span><span class="v">${fmtTime(roundTime(b, b.latest?.round))}</span></div>
        ${commandRow(b, 'Command', 'round', 'latest')}
      </div>
    </section>

    <section class="card">
      <h3>Browse history</h3>
      <div class="history-controls">
        <button type="button" data-action="prev" aria-label="Previous round">◀</button>
        <input type="number" id="historyInput" min="1" step="1" value="${histRound}" aria-label="Round number" />
        <button type="button" data-action="next" aria-label="Next round">▶</button>
        <button type="button" class="primary" data-action="load">Load</button>
        <button type="button" data-action="latest">Latest</button>
      </div>
      <div id="historyBody">${renderHistoryResult(b)}</div>
    </section>

    <section class="card">
      <h3>API endpoints</h3>
      <div id="commands">${renderCommands(b)}</div>
    </section>`;
  updateCountdown();
}

function renderAll() {
  renderList();
  renderDetail();
}

function updateCountdown() {
  const el = $('countdown');
  const b = selectedBeacon();
  if (!el || !b || !b.period || !b.genesisTime) return;
  const next = b.genesisTime + expectedRound(b) * b.period;
  const left = Math.max(0, Math.ceil(next - Date.now() / 1000));
  el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  if (b.latest?.round < expectedRound(b) && !b.refreshing && Date.now() - (b.lastTry || 0) > 3000) {
    b.refreshing = true;
    b.lastTry = Date.now();
    refreshLatest(b).finally(() => (b.refreshing = false));
  }
}

// ---- data ------------------------------------------------------------------------------
async function refreshLatest(b) {
  try {
    const data = await fetchJson(beaconUrl(b.id, '/rounds/latest'));
    b.latest = await summarizeRound(data);
    state.savedAt = Date.now();
    persist();
    renderList();
    if (b.id === state.selected) renderDetail();
  } catch (error) {
    console.error(error);
  }
}

function merge(fresh) {
  // Keep cached values for anything the fresh fetch could not provide.
  const old = byId(fresh.id) || {};
  return { ...old, ...fresh, latest: fresh.latest || old.latest };
}

async function loadStaticCache() {
  try {
    const data = await fetchJson('data/beacons.json');
    if (Array.isArray(data.beacons) && data.beacons.length && !state.beacons.length) {
      state.beacons = data.beacons;
      setStatus(`Showing deploy-time cache from ${new Date(data.generatedAt).toLocaleString()} — refreshing…`);
      afterBeaconsChanged();
    }
  } catch {
    /* no bundled cache (e.g. local dev) */
  }
}

function afterBeaconsChanged() {
  if (!byId(state.selected)) state.selected = state.beacons[0]?.id || null;
  persist();
  renderAll();
}

async function refreshBeacons() {
  try {
    const ids = parseBeaconIds(await fetchJson(`${API_BASE}/beacons`));
    if (!ids.length) throw new Error('empty beacon list');
    const results = await Promise.allSettled(ids.map(fetchBeaconSummary));
    state.beacons = ids.map((id, i) => (results[i].status === 'fulfilled' ? merge(results[i].value) : byId(id) || { id }));
    state.savedAt = Date.now();
    afterBeaconsChanged();
    setStatus(`${ids.length} beacons · live data updated ${new Date().toLocaleTimeString()}`, 'ok');
  } catch (error) {
    console.error(error);
    setStatus(
      state.beacons.length
        ? `Offline or API unavailable — showing cached data (${error.message})`
        : `Could not load beacons: ${error.message}`,
      'bad'
    );
  }
}

async function loadHistory(b) {
  const round = state.history[b.id];
  if (!round) return;
  try {
    const data = await fetchJson(beaconUrl(b.id, `/rounds/${round}`));
    state.historyData = { id: b.id, round, data: await summarizeRound(data) };
  } catch (error) {
    state.historyData = { id: b.id, round, error: error.message };
  }
  if (b.id === state.selected && state.history[b.id] === round) {
    $('historyBody').innerHTML = renderHistoryResult(b);
    $('commands').innerHTML = renderCommands(b);
  }
}

function setHistoryRound(b, round, { load = true } = {}) {
  const n = Math.max(1, Math.floor(Number(round)) || 1);
  state.history[b.id] = n;
  $('historyInput').value = n;
  persist();
  if (load) loadHistory(b);
  else $('commands').innerHTML = renderCommands(b);
}

// ---- events ----------------------------------------------------------------------------
listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  state.selected = btn.dataset.id;
  persist();
  renderAll();
  if (state.history[state.selected]) loadHistory(selectedBeacon());
  if (window.matchMedia('(max-width: 800px)').matches) detailEl.scrollIntoView({ behavior: 'smooth' });
});

detailEl.addEventListener('click', async (e) => {
  const b = selectedBeacon();
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Denied';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 1000);
    return;
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action || !b) return;
  const current = Number($('historyInput').value) || b.latest?.round || 1;
  if (action === 'prev') setHistoryRound(b, current - 1);
  else if (action === 'next') setHistoryRound(b, current + 1);
  else if (action === 'load') setHistoryRound(b, current);
  else if (action === 'latest' && b.latest?.round) setHistoryRound(b, b.latest.round);
});

detailEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'historyInput') setHistoryRound(selectedBeacon(), e.target.value);
});

detailEl.addEventListener('change', (e) => {
  // Remember the round even if the user edits it without loading.
  if (e.target.id === 'historyInput') setHistoryRound(selectedBeacon(), e.target.value, { load: false });
});

outputModeEl.addEventListener('change', () => {
  state.outputMode = outputModeEl.value;
  persist();
  renderDetail();
});

function applyTheme() {
  if (state.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
}
$('themeToggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  state.theme = dark ? 'light' : 'dark';
  applyTheme();
  persist();
});

// ---- start -----------------------------------------------------------------------------
outputModeEl.value = state.outputMode;
applyTheme();
if (state.beacons.length) {
  setStatus(`Showing data saved ${new Date(state.savedAt || Date.now()).toLocaleString()} — refreshing…`);
  afterBeaconsChanged();
  if (state.history[state.selected]) loadHistory(selectedBeacon());
} else {
  renderAll();
}
loadStaticCache().then(refreshBeacons);
setInterval(updateCountdown, 1000);
// Keep every beacon's latest round in the sidebar fresh.
setInterval(() => state.beacons.forEach((b) => b.id !== state.selected && refreshLatest(b)), 60000);
