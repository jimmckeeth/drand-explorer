import {
  API_BASE,
  ENDPOINTS,
  beaconUrl,
  expectedRound,
  fetchBeaconSummary,
  fetchJson,
  parseBeaconIds,
  roundTime,
  summarizeRound
} from './drand.js';

const STORE_KEY = 'drand-explorer:v1';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const listEl = $('beaconList');
const detailEl = $('detail');
const outputModeEl = $('outputMode');
const endpointEl = $('endpointSelect');

// ---- persisted per-browser state -------------------------------------------------------
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
})();

const state = {
  endpoint: saved.endpoint || API_BASE,
  // per-endpoint: { beacons, savedAt, selected }
  data: saved.data || (Array.isArray(saved.beacons) ? { [API_BASE]: { beacons: saved.beacons, savedAt: saved.savedAt, selected: saved.selected } } : {}),
  history: saved.history || {}, // `${endpoint}|${beaconId}` -> round being browsed
  outputMode: saved.outputMode || 'url',
  theme: saved.theme || 'auto',
  historyData: null
};

const store = () => (state.data[state.endpoint] ??= { beacons: [], savedAt: null, selected: null });
const beacons = () => store().beacons;
const byId = (id) => beacons().find((b) => b.id === id);
const selectedBeacon = () => byId(store().selected);
const histKey = (b) => `${state.endpoint}|${b.id}`;
const histRound = (b) => state.history[histKey(b)];

function persist() {
  try {
    const { endpoint, data, history, outputMode, theme } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ endpoint, data, history, outputMode, theme }));
  } catch {
    /* storage unavailable or full: the app still works */
  }
}

// ---- helpers ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : '—');

function health(b) {
  const cur = b.latest?.round;
  const exp = expectedRound(b);
  if (!cur || !exp) return { text: 'Unknown', cls: 'warn' };
  const behind = exp - cur;
  if (behind <= 1) return { text: 'Healthy', cls: 'ok' };
  return { text: `Behind ${behind}`, cls: behind <= 3 ? 'warn' : 'bad' };
}

// kind: 'info' | 'round'; round: number or 'latest'
function command(b, kind, round) {
  const url = beaconUrl(state.endpoint, b.id, kind === 'info' ? '/info' : `/rounds/${round}`);
  if (state.outputMode === 'curl') return `curl -s "${url}"`;
  if (state.outputMode === 'cli') {
    const base = `--url ${state.endpoint.replace(/\/v2$/, '')} --chain-hash ${b.hash || '<chain-hash>'}`;
    return kind === 'info' ? `drand get chain-info ${base}` : `drand get public ${base}${round === 'latest' ? '' : ` --round ${round}`}`;
  }
  return url;
}

const copyBtn = (text, label = 'Copy') =>
  text ? `<button type="button" class="copy" data-copy="${esc(text)}">${label}</button>` : '';

function field(label, value) {
  return `<div class="kv"><span class="k">${esc(label)}</span><code class="v">${esc(value || '—')}</code>${copyBtn(value)}</div>`;
}

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = `statusbar ${cls}`;
}

// ---- rendering -------------------------------------------------------------------------
function renderEndpoints() {
  const known = ENDPOINTS.flatMap((g) => g.items);
  const groups = [...ENDPOINTS];
  if (!known.includes(state.endpoint)) groups.push({ group: 'Custom', items: [state.endpoint] });
  endpointEl.innerHTML = groups
    .map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((u) => `<option value="${esc(u)}"${u === state.endpoint ? ' selected' : ''}>${esc(u.replace(/^https:\/\//, ''))}</option>`).join('')}</optgroup>`)
    .join('');
}

function renderList() {
  listEl.innerHTML = beacons()
    .map((b) => {
      const h = health(b);
      return `<li><button type="button" class="beacon-item${b.id === store().selected ? ' active' : ''}" data-id="${esc(b.id)}">
        <span class="dot ${h.cls}" title="${esc(h.text)}"></span>
        <span class="beacon-name">${esc(b.id)}</span>
        <span class="beacon-meta">${b.period ? `${b.period}s` : ''}${b.latest?.round ? ` · #${b.latest.round}` : ''}</span>
      </button></li>`;
    })
    .join('');
  if (!beacons().length) listEl.innerHTML = '<li class="muted pad">No beacons loaded yet.</li>';
}

function roundBody(b, r, round) {
  return `${field('Randomness', r?.randomness)}${field('Signature', r?.signature)}
    <div class="kv"><span class="k">Time</span><span class="v">${fmtTime(roundTime(b, round))}</span></div>`;
}

function historyBody(b) {
  const round = histRound(b);
  const h = state.historyData;
  if (!h || h.key !== histKey(b) || h.round !== round) return '<p class="muted">Press Load to fetch this round.</p>';
  if (h.error) return `<p class="error">Round ${round} not available (${esc(h.error)}).</p>`;
  return roundBody(b, h.data, round);
}

function endpointsBody(b) {
  const round = histRound(b) || b.latest?.round || 'latest';
  const row = (label, kind, r) => {
    const cmd = command(b, kind, r);
    return `<div class="kv"><span class="k">${esc(label)}</span><code class="v">${esc(cmd)}</code>${copyBtn(cmd)}</div>`;
  };
  return row('Info', 'info') + row('Latest', 'round', 'latest') + row(`Round ${round}`, 'round', round);
}

function renderDetail() {
  const b = selectedBeacon();
  if (!b) {
    detailEl.innerHTML = '<div class="empty">Select a beacon to explore its rounds.</div>';
    return;
  }
  const h = health(b);
  const hr = histRound(b) || b.latest?.round || 1;
  const latestCmd = command(b, 'round', 'latest');
  detailEl.innerHTML = `
    <section class="card hero">
      <div class="hero-head">
        <h2>${esc(b.id)}</h2>
        <span class="pill ${h.cls}">${esc(h.text)}</span>
        <dl class="stats">
          <div><dt>Period</dt><dd>${b.period ? `${b.period}s` : '—'}</dd></div>
          <div><dt>Scheme</dt><dd>${esc(b.scheme || '—')}</dd></div>
          <div><dt>Genesis</dt><dd>${fmtTime(b.genesisTime)}</dd></div>
          <div><dt>Next round</dt><dd id="countdown">—</dd></div>
        </dl>
      </div>
      ${field('Chain hash', b.hash)}
      ${field('Public key', b.publicKey)}
    </section>

    <div class="pair">
      <section class="card">
        <div class="card-head"><h3>Latest round <span class="round-no">${b.latest?.round ? `#${b.latest.round}` : ''}</span></h3>${copyBtn(latestCmd, 'Copy command')}</div>
        ${roundBody(b, b.latest, b.latest?.round)}
      </section>

      <section class="card">
        <div class="card-head"><h3>History</h3><span id="historyCopy">${copyBtn(histRound(b) ? command(b, 'round', histRound(b)) : '', 'Copy command')}</span></div>
        <div class="history-controls">
          <button type="button" data-action="prev" aria-label="Previous round">◀</button>
          <input type="number" id="historyInput" min="1" step="1" value="${hr}" aria-label="Round number" />
          <button type="button" data-action="next" aria-label="Next round">▶</button>
          <button type="button" class="primary" data-action="load">Load</button>
          <button type="button" data-action="latest">Latest</button>
        </div>
        <div id="historyBody">${historyBody(b)}</div>
      </section>
    </div>

    <details class="card endpoints" open>
      <summary>API commands</summary>
      <div id="commands">${endpointsBody(b)}</div>
    </details>`;
  updateCountdown();
  // Restore the saved history position without waiting for the user to press Load.
  const hd = state.historyData;
  if (histRound(b) && !(hd && hd.key === histKey(b) && hd.round === histRound(b)) && state.historyPending !== `${histKey(b)}|${histRound(b)}`) loadHistory(b);
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
  const endpoint = state.endpoint;
  try {
    const latest = await summarizeRound(await fetchJson(beaconUrl(endpoint, b.id, '/rounds/latest')));
    if (endpoint !== state.endpoint) return;
    b.latest = latest;
    store().savedAt = Date.now();
    persist();
    renderList();
    if (b.id === store().selected) renderDetail();
  } catch (error) {
    console.error(error);
  }
}

function afterBeaconsChanged() {
  if (!byId(store().selected)) store().selected = beacons()[0]?.id || null;
  persist();
  renderAll();
}

async function loadStaticCache() {
  // The deploy-time cache only describes the default endpoint.
  if (state.endpoint !== API_BASE || beacons().length) return;
  try {
    const data = await fetchJson('data/beacons.json');
    if (state.endpoint === API_BASE && Array.isArray(data.beacons) && data.beacons.length && !beacons().length) {
      store().beacons = data.beacons;
      setStatus(`Showing deploy-time cache from ${new Date(data.generatedAt).toLocaleString()} — refreshing…`);
      afterBeaconsChanged();
    }
  } catch {
    /* no bundled cache (e.g. local dev) */
  }
}

async function refreshBeacons() {
  const endpoint = state.endpoint;
  setStatus(`Loading beacons from ${endpoint}…`);
  try {
    const ids = parseBeaconIds(await fetchJson(`${endpoint}/beacons`));
    if (!ids.length) throw new Error('empty beacon list');
    const results = await Promise.allSettled(ids.map((id) => fetchBeaconSummary(id, endpoint)));
    if (endpoint !== state.endpoint) return;
    const old = beacons();
    store().beacons = ids.map((id, i) => {
      const prev = old.find((b) => b.id === id) || {};
      return results[i].status === 'fulfilled' ? { ...prev, ...results[i].value, latest: results[i].value.latest || prev.latest } : prev.id ? prev : { id };
    });
    store().savedAt = Date.now();
    afterBeaconsChanged();
    setStatus(`${ids.length} beacons · live data updated ${new Date().toLocaleTimeString()}`, 'ok');
  } catch (error) {
    if (endpoint !== state.endpoint) return;
    console.error(error);
    setStatus(
      beacons().length ? `Endpoint unavailable — showing cached data (${error.message})` : `Could not load beacons from ${endpoint}: ${error.message}`,
      'bad'
    );
  }
}

async function loadHistory(b) {
  const round = histRound(b);
  const key = histKey(b);
  if (!round) return;
  state.historyPending = `${key}|${round}`;
  try {
    state.historyData = { key, round, data: await summarizeRound(await fetchJson(beaconUrl(state.endpoint, b.id, `/rounds/${round}`))) };
  } catch (error) {
    state.historyData = { key, round, error: error.message };
  }
  if (state.historyPending === `${key}|${round}`) state.historyPending = null;
  if (key === histKey(selectedBeacon() || {}) && histRound(b) === round) {
    $('historyBody').innerHTML = historyBody(b);
    refreshHistoryExtras(b);
  }
}

function refreshHistoryExtras(b) {
  $('commands').innerHTML = endpointsBody(b);
  $('historyCopy').innerHTML = copyBtn(histRound(b) ? command(b, 'round', histRound(b)) : '', 'Copy command');
}

function setHistoryRound(b, round, { load = true } = {}) {
  const n = Math.max(1, Math.floor(Number(round)) || 1);
  state.history[histKey(b)] = n;
  $('historyInput').value = n;
  persist();
  if (load) loadHistory(b);
  else refreshHistoryExtras(b);
}

function switchEndpoint(url) {
  state.endpoint = url;
  state.historyData = null;
  persist();
  renderEndpoints();
  renderAll();
  if (!beacons().length) setStatus(`Loading beacons from ${url}…`);
  loadStaticCache().then(refreshBeacons);
}

// ---- events ----------------------------------------------------------------------------
endpointEl.addEventListener('change', () => switchEndpoint(endpointEl.value));

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  store().selected = btn.dataset.id;
  persist();
  renderAll();
  if (window.matchMedia('(max-width: 800px)').matches) detailEl.scrollIntoView({ behavior: 'smooth' });
});

detailEl.addEventListener('click', async (e) => {
  const b = selectedBeacon();
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const label = copy.textContent;
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Denied';
    }
    setTimeout(() => (copy.textContent = label), 1000);
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
renderEndpoints();
if (beacons().length) {
  setStatus(`Showing data saved ${new Date(store().savedAt || Date.now()).toLocaleString()} — refreshing…`);
  afterBeaconsChanged();
} else {
  renderAll();
}
loadStaticCache().then(refreshBeacons);
setInterval(updateCountdown, 1000);
// Keep every beacon's latest round in the sidebar fresh.
setInterval(() => beacons().forEach((b) => b.id !== store().selected && refreshLatest(b)), 60000);
