import { API_BASE, fetchJson } from './drand.js';
import { NETWORKS, expectedRound, fetchRound, fetchSummary, listBeacons, networkFor, nextRoundTime, roundTime, urlsFor } from './providers.js';

const STORE_KEY = 'drand-explorer:v1';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  historyData: null,
  historyPending: null
};

const runtime = new Map(); // transient per-beacon flags (never persisted)
const rt = (b) => {
  const key = `${state.endpoint}|${b.id}`;
  if (!runtime.has(key)) runtime.set(key, {});
  return runtime.get(key);
};

const net = () => networkFor(state.endpoint);
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
const timeOf = (b, r, round) => r?.time || roundTime(b, round);

function health(b) {
  const cur = b.latest?.round;
  const exp = expectedRound(b);
  if (!cur || !exp) return { text: 'Unknown', cls: 'warn' };
  const behind = exp - cur;
  if (behind <= 1) return { text: 'Healthy', cls: 'ok' };
  return { text: `Behind ${behind}`, cls: behind <= 3 ? 'warn' : 'bad' };
}

const secondsLeft = (b, now = Date.now() / 1000) => Math.max(0, Math.ceil(nextRoundTime(b, now) - now));
const countdownText = (b) => (b.period ? `${secondsLeft(b)}s (${b.period}s)` : '—');

// The drand CLI only makes sense for drand networks; fall back to plain URLs elsewhere.
const effectiveMode = () => (state.outputMode === 'cli' && net().kind !== 'drand' ? 'url' : state.outputMode);

// kind: 'info' | 'round'; round: number or 'latest'. Returns { text, url } (url only if text contains it).
function command(b, kind, round) {
  const urls = urlsFor(net(), b);
  const url = kind === 'info' ? urls.info : urls.round(round);
  switch (effectiveMode()) {
    case 'curl':
      return { text: `curl -s "${url}"`, url };
    case 'wget':
      return { text: `wget -qO- "${url}"`, url };
    case 'cli': {
      const base = `--url ${state.endpoint.replace(/\/v2$/, '')} --chain-hash ${b.hash || '<chain-hash>'}`;
      return { text: kind === 'info' ? `drand get chain-info ${base}` : `drand get public ${base}${round === 'latest' ? '' : ` --round ${round}`}` };
    }
    default:
      return { text: url, url };
  }
}

function commandHtml({ text, url }) {
  const t = esc(text);
  if (!url) return t;
  const u = esc(url);
  return t.replace(u, () => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

function commandRow(b, label, kind, round) {
  const c = command(b, kind, round);
  return `<div class="kv"><span class="k">${esc(label)}</span><code class="v">${commandHtml(c)}</code>${copyBtn(c.text)}</div>`;
}

const copyBtn = (text, label = 'Copy') => (text ? `<button type="button" class="copy" data-copy="${esc(text)}">${label}</button>` : '');

function field(label, value, { flip = false } = {}) {
  const attrs = flip && value ? ` data-flip="${esc(value)}"` : '';
  return `<div class="kv"><span class="k">${esc(label)}</span><code class="v"${attrs}>${esc(value || '—')}</code>${copyBtn(value)}</div>`;
}

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = `statusbar ${cls}`;
}

// ---- rendering -------------------------------------------------------------------------
function syncModeControl() {
  const cliOption = outputModeEl.querySelector('[value="cli"]');
  cliOption.disabled = net().kind !== 'drand';
  cliOption.title = cliOption.disabled ? 'The drand CLI only works with drand networks' : '';
  outputModeEl.value = effectiveMode();
}

function renderEndpoints() {
  const groups = [...NETWORKS];
  if (!groups.some((g) => g.items.some((n) => n.url === state.endpoint))) groups.push({ group: 'Custom', items: [net()] });
  endpointEl.innerHTML = groups
    .map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((n) => `<option value="${esc(n.url)}"${n.url === state.endpoint ? ' selected' : ''}>${esc(n.label)}</option>`).join('')}</optgroup>`)
    .join('');
}

function renderList() {
  listEl.innerHTML = beacons().length
    ? beacons()
        .map((b) => {
          const h = health(b);
          return `<li><button type="button" class="beacon-item${b.id === store().selected ? ' active' : ''}" data-id="${esc(b.id)}">
        <span class="dot ${h.cls}" title="${esc(h.text)}"></span>
        <span class="beacon-name">${esc(b.id)}</span>
        <span class="beacon-meta"><span class="cd" data-cd="${esc(b.id)}">${countdownText(b)}</span>${b.latest?.round ? ` · #${b.latest.round}` : ''}</span>
      </button></li>`;
        })
        .join('')
    : '<li class="muted pad">No beacons loaded yet.</li>';
}

function roundBody(b, r, round, opts) {
  return `${field('Randomness', r?.randomness, opts)}${field('Signature', r?.signature, opts)}
    <div class="kv"><span class="k">Time</span><span class="v">${fmtTime(timeOf(b, r, round))}</span></div>`;
}

function historyBody(b) {
  const round = histRound(b);
  const h = state.historyData;
  if (!h || h.key !== histKey(b) || h.round !== round) return '<p class="muted">Loading…</p>';
  if (h.error) return `<p class="error">Round ${round} not available (${esc(h.error)}).</p>`;
  return roundBody(b, h.data, round);
}

function endpointsBody(b) {
  const round = histRound(b) || b.latest?.round || 'latest';
  return commandRow(b, 'Info', 'info') + commandRow(b, 'Latest', 'round', 'latest') + commandRow(b, `Round ${round}`, 'round', round);
}

function renderDetail() {
  const b = selectedBeacon();
  if (!b) {
    detailEl.innerHTML = '<div class="empty">Select a beacon to explore its rounds.</div>';
    return;
  }
  const h = health(b);
  const hr = histRound(b) || b.latest?.round || 1;
  const drandNet = net().kind === 'drand';
  detailEl.innerHTML = `
    <section class="card hero">
      <div class="hero-head">
        <h2>${esc(b.id)}</h2>
        <span class="pill ${h.cls}">${esc(h.text)}</span>
        <dl class="stats">
          <div><dt>Next round (period)</dt><dd class="cd" data-cd="${esc(b.id)}">${countdownText(b)}</dd></div>
          <div><dt>${drandNet ? 'Scheme' : 'Cipher'}</dt><dd>${esc(b.scheme || '—')}</dd></div>
          ${b.genesisTime ? `<div><dt>Genesis</dt><dd>${fmtTime(b.genesisTime)}</dd></div>` : ''}
        </dl>
      </div>
      ${drandNet ? field('Chain hash', b.hash) + field('Public key', b.publicKey) : field('Chain index', b.chainIndex) + field('Certificate', b.certificateId)}
    </section>

    <div class="pair">
      <section class="card">
        <div class="card-head"><h3>Latest round <span class="round-no">${b.latest?.round ? `#${b.latest.round}` : ''}</span></h3>${copyBtn(command(b, 'round', 'latest').text, 'Copy command')}</div>
        ${roundBody(b, b.latest, b.latest?.round, { flip: true })}
      </section>

      <section class="card">
        <div class="card-head"><h3>History</h3><span id="historyCopy">${histRound(b) ? copyBtn(command(b, 'round', histRound(b)).text, 'Copy command') : ''}</span></div>
        <div class="history-controls">
          <button type="button" data-action="prev" aria-label="Previous round">◀</button>
          <input type="number" id="historyInput" min="1" step="1" value="${hr}" aria-label="Round number" />
          <button type="button" data-action="next" aria-label="Next round">▶</button>
          <button type="button" class="primary" data-action="load">Load</button>
          <button type="button" data-action="first" title="First round (Home)">⏮</button>
          <button type="button" data-action="latest" title="Latest round (End)">⏭</button>
        </div>
        <div id="historyBody">${historyBody(b)}</div>
        <p class="hint">← → ±1 round · PgUp/PgDn ±1 day · Alt+PgUp/PgDn ±1 week · Home first · End latest</p>
      </section>
    </div>

    <details class="card endpoints" open>
      <summary>API commands</summary>
      <div id="commands">${endpointsBody(b)}</div>
    </details>`;
  // Restore the saved history position without waiting for the user to press Load.
  const hd = state.historyData;
  if (histRound(b) && !(hd && hd.key === histKey(b) && hd.round === histRound(b)) && state.historyPending !== `${histKey(b)}|${histRound(b)}`) loadHistory(b);
}

function renderAll() {
  renderList();
  renderDetail();
}

// ---- countdown + auto refresh ----------------------------------------------------------
function tick() {
  const now = Date.now() / 1000;
  for (const b of beacons()) {
    if (!b.period) continue;
    const left = secondsLeft(b, now);
    const text = `${left}s (${b.period}s)`;
    for (const el of document.querySelectorAll(`[data-cd="${CSS.escape(b.id)}"]`)) {
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('imminent', left <= 3); // warn just before the new round lands
    }
    const flags = rt(b);
    if (b.latest?.round < expectedRound(b, now) && !flags.refreshing && Date.now() - (flags.lastTry || 0) > 4000) {
      flags.refreshing = true;
      flags.lastTry = Date.now();
      refreshLatest(b).finally(() => (flags.refreshing = false));
    }
  }
}

const HEX = '0123456789abcdef';
// Quickly flip random characters, settling left to right on the real value.
function flip(el) {
  const target = el.dataset.flip;
  if (!target || reducedMotion) return;
  const frames = 16;
  let frame = 0;
  el.classList.add('flipping');
  const timer = setInterval(() => {
    frame += 1;
    if (frame >= frames) {
      clearInterval(timer);
      el.textContent = target;
      el.classList.remove('flipping');
      return;
    }
    const settled = Math.floor((target.length * frame) / frames);
    el.textContent = target.slice(0, settled) + Array.from(target.slice(settled), (c) => (/[0-9a-f]/i.test(c) ? HEX[Math.floor(Math.random() * 16)] : c)).join('');
  }, 40);
}

// ---- data ------------------------------------------------------------------------------
async function refreshLatest(b) {
  const endpoint = state.endpoint;
  try {
    const prev = b.latest?.round;
    const latest = await fetchRound(net(), b, 'latest');
    if (endpoint !== state.endpoint) return;
    b.latest = latest;
    store().savedAt = Date.now();
    persist();
    renderList();
    if (b.id === store().selected) {
      renderDetail();
      if (prev && latest.round !== prev) detailEl.querySelectorAll('.pair .card:first-child [data-flip]').forEach(flip);
    }
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
  if (beacons().length) return;
  const endpoint = state.endpoint;
  try {
    const data = await fetchJson('data/beacons.json');
    const cached = data.networks?.[endpoint];
    if (endpoint === state.endpoint && Array.isArray(cached) && cached.length && !beacons().length) {
      store().beacons = cached;
      setStatus(`Showing deploy-time cache from ${new Date(data.generatedAt).toLocaleString()} — refreshing…`);
      afterBeaconsChanged();
    }
  } catch {
    /* no bundled cache (e.g. local dev) */
  }
}

async function refreshBeacons() {
  const endpoint = state.endpoint;
  const network = net();
  setStatus(`Loading beacons from ${network.label}…`);
  try {
    const ids = await listBeacons(network);
    if (!ids.length) throw new Error('empty beacon list');
    const results = await Promise.allSettled(ids.map((id) => fetchSummary(network, id)));
    if (endpoint !== state.endpoint) return;
    const old = beacons();
    store().beacons = ids.map((id, i) => {
      const prev = old.find((b) => b.id === id) || {};
      return results[i].status === 'fulfilled' ? { ...prev, ...results[i].value, latest: results[i].value.latest || prev.latest } : prev.id ? prev : { id };
    });
    store().savedAt = Date.now();
    afterBeaconsChanged();
    setStatus(`${ids.length} beacon${ids.length === 1 ? '' : 's'} · live data updated ${new Date().toLocaleTimeString()}`, 'ok');
  } catch (error) {
    if (endpoint !== state.endpoint) return;
    console.error(error);
    setStatus(beacons().length ? `Network unavailable — showing cached data (${error.message})` : `Could not load beacons from ${network.label}: ${error.message}`, 'bad');
  }
}

async function loadHistory(b) {
  const round = histRound(b);
  const key = histKey(b);
  if (!round) return;
  state.historyPending = `${key}|${round}`;
  try {
    state.historyData = { key, round, data: await fetchRound(net(), b, round) };
  } catch (error) {
    state.historyData = { key, round, error: error.message };
  }
  if (state.historyPending === `${key}|${round}`) state.historyPending = null;
  const cur = selectedBeacon();
  if (cur && key === histKey(cur) && histRound(cur) === round) {
    $('historyBody').innerHTML = historyBody(cur);
    refreshHistoryExtras(cur);
  }
}

function refreshHistoryExtras(b) {
  $('commands').innerHTML = endpointsBody(b);
  $('historyCopy').innerHTML = histRound(b) ? copyBtn(command(b, 'round', histRound(b)).text, 'Copy command') : '';
}

function setHistoryRound(b, round, { load = true } = {}) {
  const max = b.latest?.round || Infinity;
  const n = Math.min(max, Math.max(1, Math.floor(Number(round)) || 1));
  state.history[histKey(b)] = n;
  $('historyInput').value = n;
  persist();
  if (load) loadHistory(b);
  else refreshHistoryExtras(b);
}

function switchEndpoint(url) {
  state.endpoint = url;
  state.historyData = null;
  state.historyPending = null;
  persist();
  syncModeControl();
  renderAll();
  loadStaticCache().then(refreshBeacons);
}

// ---- events ----------------------------------------------------------------------------
endpointEl.addEventListener('change', () => {
  endpointEl.blur();
  switchEndpoint(endpointEl.value);
});

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
  else if (action === 'first') setHistoryRound(b, 1);
  else if (action === 'latest' && b.latest?.round) setHistoryRound(b, b.latest.round);
});

detailEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'historyInput') {
    setHistoryRound(selectedBeacon(), e.target.value);
    e.target.blur(); // so the navigation keys work again
  }
});

detailEl.addEventListener('change', (e) => {
  // Remember the round even if the user edits it without loading.
  if (e.target.id === 'historyInput') setHistoryRound(selectedBeacon(), e.target.value, { load: false });
});

// Keyboard navigation through rounds.
document.addEventListener('keydown', (e) => {
  const b = selectedBeacon();
  if (!b || e.ctrlKey || e.metaKey || e.target.closest('input, select, textarea, [contenteditable]')) return;
  const day = Math.max(1, Math.round(86400 / (b.period || 30)));
  const cur = histRound(b) || b.latest?.round || 1;
  let target;
  if (e.key === 'ArrowLeft' && !e.altKey) target = cur - 1;
  else if (e.key === 'ArrowRight' && !e.altKey) target = cur + 1;
  else if (e.key === 'PageUp') target = cur - (e.altKey ? 7 * day : day);
  else if (e.key === 'PageDown') target = cur + (e.altKey ? 7 * day : day);
  else if (e.key === 'Home' && !e.altKey) target = 1;
  else if (e.key === 'End' && !e.altKey) target = b.latest?.round || cur;
  else return;
  e.preventDefault();
  setHistoryRound(b, target);
});

outputModeEl.addEventListener('change', () => {
  outputModeEl.blur();
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
applyTheme();
renderEndpoints();
syncModeControl();
if (beacons().length) {
  setStatus(`Showing data saved ${new Date(store().savedAt || Date.now()).toLocaleString()} — refreshing…`);
  afterBeaconsChanged();
} else {
  renderAll();
}
loadStaticCache().then(refreshBeacons);
setInterval(tick, 1000);
