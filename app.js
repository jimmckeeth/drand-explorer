import { API_BASE, fetchJson } from './drand.js';
import { ALL_NETWORKS, NETWORKS, expectedRound, fetchRound, fetchSummary, listBeacons, networkFor, nextRoundTime, roundTime, urlsFor } from './providers.js';

const STORE_KEY = 'drand-explorer:v1';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const sidebarEl = document.querySelector('.sidebar');
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

const OTHERS = ALL_NETWORKS.filter((n) => n.kind !== 'drand'); // NIST, INMETRO: always listed
const DRAND_GROUPS = NETWORKS.filter((g) => g.items[0].kind === 'drand');
const LISTS = { drand: $('listDrand'), nist: $('listNist'), inmetro: $('listInmetro') };

const endpoint0 = networkFor(saved.endpoint || API_BASE).kind === 'drand' ? saved.endpoint || API_BASE : API_BASE;

const state = {
  endpoint: endpoint0, // the selected drand network
  // per-network: { beacons, savedAt }
  data: saved.data || (Array.isArray(saved.beacons) ? { [API_BASE]: { beacons: saved.beacons, savedAt: saved.savedAt } } : {}),
  sel: saved.sel?.net && saved.sel?.id ? saved.sel : { net: endpoint0, id: 'default' }, // selected beacon
  history: saved.history || {}, // `${network}|${beaconId}` -> round being browsed
  outputMode: saved.outputMode || 'url',
  theme: saved.theme || 'auto',
  animate: saved.animate !== false,
  view: saved.view === 'accumulator' ? 'accumulator' : 'beacon',
  // Accumulator: `off` = deselected sources, `log` = appended entropy, `seen` = last round taken per source.
  acc: { off: saved.acc?.off || [], log: saved.acc?.log || [], seen: saved.acc?.seen || {} },
  historyData: null,
  historyPending: null
};

const activeUrls = () => [state.endpoint, ...OTHERS.map((n) => n.url)];
// Drop a stale selection (e.g. a drand network that is no longer the active one).
if (!activeUrls().includes(state.sel.net)) state.sel = networkFor(state.sel.net).kind === 'drand' ? { net: state.endpoint, id: state.sel.id } : { net: state.endpoint, id: 'default' };

const netStatus = {}; // url -> { count } | { error }
const runtime = new Map(); // transient per-beacon flags (never persisted)
const rt = (url, b) => {
  const key = `${url}|${b.id}`;
  if (!runtime.has(key)) runtime.set(key, {});
  return runtime.get(key);
};

const net = () => networkFor(state.sel.net); // network of the selected beacon
const storeFor = (url) => (state.data[url] ??= { beacons: [], savedAt: null });
const beaconsFor = (url) => storeFor(url).beacons;
const selectedBeacon = () => beaconsFor(state.sel.net).find((b) => b.id === state.sel.id);
const histKey = (b) => `${state.sel.net}|${b.id}`;
const histRound = (b) => state.history[histKey(b)];
// The round shown in the history box: the saved position, else follow the latest round.
const curRound = (b) => histRound(b) || b.latest?.round || 0;
const cdKey = (url, b) => `${url}|${b.id}`;

function persist() {
  try {
    const { endpoint, data, sel, history, outputMode, theme, animate, view, acc } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ endpoint, data, sel, history, outputMode, theme, animate, view, acc }));
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
      const base = `--url ${state.sel.net.replace(/\/v2$/, '')} --chain-hash ${b.hash || '<chain-hash>'}`;
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

// ---- accumulator -----------------------------------------------------------------------
const ACC_MAX = 500; // entries kept
const accKey = (url, b) => `${url}|${b.id}`;
const accName = (url, b) => `${networkFor(url).kind === 'drand' ? 'drand' : networkFor(url).name.replace(' Beacon', '')}/${b.id}`;
const accHex = () => state.acc.log.map((e) => e.hex).join('');

// Append a beacon's newest randomness once per round, if its source is selected.
function accumulate(url, b) {
  const r = b.latest;
  const key = accKey(url, b);
  if (!r?.randomness || state.acc.off.includes(key) || state.acc.seen[key] === r.round) return;
  state.acc.seen[key] = r.round;
  state.acc.log.push({ src: accName(url, b), round: r.round, hex: r.randomness });
  if (state.acc.log.length > ACC_MAX) state.acc.log.splice(0, state.acc.log.length - ACC_MAX);
  persist();
  updateAccLog();
}

function updateAccLog() {
  const log = $('accLog');
  if (log) {
    const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    log.innerHTML = state.acc.log.length
      ? state.acc.log.map((e) => `<span class="src">${esc(e.src)} #${e.round}</span> ${esc(e.hex)}`).join('\n')
      : 'Waiting for new rounds from the selected sources…';
    if (pinned) log.scrollTop = log.scrollHeight;
  }
  const stats = $('accStats');
  if (stats) stats.textContent = `${state.acc.log.length} batch${state.acc.log.length === 1 ? '' : 'es'} · ${accHex().length / 2} bytes`;
  const item = $('accItem');
  if (item) item.querySelector('.beacon-meta').textContent = `${accHex().length / 2} bytes`;
}

function renderAccumulator() {
  const groups = activeUrls()
    .map((url) => {
      const list = beaconsFor(url);
      if (!list.length) return '';
      const n = networkFor(url);
      const title = n.kind === 'drand' ? 'drand' : n.name.replace(' Beacon', '');
      return `<h4>${esc(title)}</h4>${list.map((b) => `<label><input type="checkbox" data-acc-key="${esc(accKey(url, b))}"${state.acc.off.includes(accKey(url, b)) ? '' : ' checked'} /> ${esc(b.id)}</label>`).join('')}`;
    })
    .join('');
  detailEl.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Accumulator</h3><div class="acc-actions"><button type="button" data-action="acc-copy">Copy</button><button type="button" data-action="acc-clear">Clear</button></div></div>
      <p class="muted" id="accStats"></p>
      <p class="hint">Collects the randomness of every new round from the selected beacons. Copy returns the hex concatenated in arrival order.</p>
    </section>
    <section class="card"><h3>Sources</h3><div class="acc-sources">${groups || '<p class="muted">Loading…</p>'}</div></section>
    <section class="card"><h3>Entropy</h3><pre id="accLog" class="acc-log"></pre></section>`;
  updateAccLog();
  const log = $('accLog');
  log.scrollTop = log.scrollHeight;
}

// ---- rendering -------------------------------------------------------------------------
function syncModeControl() {
  const cliOption = outputModeEl.querySelector('[value="cli"]');
  cliOption.disabled = net().kind !== 'drand';
  cliOption.title = cliOption.disabled ? 'The drand CLI only works with drand networks' : '';
  outputModeEl.value = effectiveMode();
}

function renderEndpoints() {
  const groups = [...DRAND_GROUPS];
  if (!groups.some((g) => g.items.some((n) => n.url === state.endpoint))) groups.push({ group: 'Custom', items: [networkFor(state.endpoint)] });
  endpointEl.innerHTML = groups
    .map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((n) => `<option value="${esc(n.url)}"${n.url === state.endpoint ? ' selected' : ''}>${esc(n.label)}</option>`).join('')}</optgroup>`)
    .join('');
}

function renderList() {
  const accItem = $('accItem');
  accItem.classList.toggle('active', state.view === 'accumulator');
  accItem.innerHTML = `<span class="dot ok"></span><span class="beacon-name">Accumulator</span><span class="beacon-meta"></span>`;
  updateAccLog();
  const groups = [
    [state.endpoint, LISTS.drand],
    [OTHERS[0].url, LISTS.nist],
    [OTHERS[1].url, LISTS.inmetro]
  ];
  for (const [url, ul] of groups) {
    const list = beaconsFor(url);
    ul.innerHTML = list.length
      ? list
          .map((b) => {
            const h = health(b);
            const active = state.view === 'beacon' && url === state.sel.net && b.id === state.sel.id;
            return `<li><button type="button" class="beacon-item${active ? ' active' : ''}" data-net="${esc(url)}" data-id="${esc(b.id)}">
        <span class="dot ${h.cls}" title="${esc(h.text)}"></span>
        <span class="beacon-name">${esc(b.id)}</span>
        <span class="beacon-meta"><span class="cd" data-cd="${esc(cdKey(url, b))}">${countdownText(b)}</span>${b.latest?.round ? ` · #${b.latest.round}` : ''}</span>
      </button></li>`;
          })
          .join('')
      : `<li class="muted pad">${netStatus[url]?.error ? `Unavailable (${esc(netStatus[url].error)})` : 'Loading…'}</li>`;
  }
}

function roundBody(b, r, round, opts) {
  return `${field('Randomness', r?.randomness, opts)}${field('Signature', r?.signature, opts)}
    <div class="kv"><span class="k">Time</span><span class="v">${fmtTime(timeOf(b, r, round))}</span></div>`;
}

function historyBody(b) {
  const round = curRound(b);
  const h = state.historyData;
  if (h && h.key === histKey(b) && h.round !== round && h.data) return `<div class="stale">${roundBody(b, h.data, h.round)}</div>`; // keep old values until the new round arrives
  if (!h || h.key !== histKey(b) || h.round !== round) return '<p class="muted">Loading…</p>';
  if (h.error) return `<p class="error">Round ${round} not available (${esc(h.error)}).</p>`;
  return roundBody(b, h.data, round);
}

function endpointsBody(b) {
  const round = curRound(b) || 'latest';
  return commandRow(b, 'Info', 'info') + commandRow(b, 'Latest', 'round', 'latest') + commandRow(b, `Round ${round}`, 'round', round);
}

function renderDetail() {
  if (state.view === 'accumulator') return renderAccumulator();
  const b = selectedBeacon();
  if (!b) {
    detailEl.innerHTML = '<div class="empty">Select a beacon to explore its rounds.</div>';
    return;
  }
  const h = health(b);
  const hr = curRound(b) || 1;
  const drandNet = net().kind === 'drand';
  detailEl.innerHTML = `
    <section class="card hero">
      <div class="hero-head">
        <h2>${esc(b.id)}</h2>
        <span class="pill ${h.cls}">${esc(h.text)}</span>
        <dl class="stats">
          <div><dt>Next round (period)</dt><dd class="cd" data-cd="${esc(cdKey(state.sel.net, b))}">${countdownText(b)}</dd></div>
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
        <label class="animate-toggle"><input type="checkbox" id="animateToggle"${state.animate ? ' checked' : ''} /> Animate</label>
      </section>

      <section class="card">
        <div class="card-head"><h3>History</h3><span id="historyCopy">${curRound(b) ? copyBtn(command(b, 'round', curRound(b)).text, 'Copy command') : ''}</span></div>
        <div class="history-controls">
          <button type="button" data-action="prev" aria-label="Previous round">◀</button>
          <input type="number" id="historyInput" min="1" step="1" value="${hr}" aria-label="Round number" />
          <button type="button" data-action="next" aria-label="Next round">▶</button>
          <button type="button" data-action="first" title="First round (Home)">⏮</button>
          <button type="button" data-action="latest" title="Latest round (End)">⏭</button>
        </div>
        <div id="historyBody">${historyBody(b)}</div>
        <p class="hint">↑ ↓ beacon · ← → ±1 round · PgUp/PgDn ±1 day · Alt+PgUp/PgDn ±1 week · Home first · End latest</p>
      </section>
    </div>

    <details class="card endpoints" open>
      <summary>API commands</summary>
      <div id="commands">${endpointsBody(b)}</div>
    </details>`;
  // Restore the saved history position without waiting for the user to press Load.
  const hd = state.historyData;
  const want = curRound(b);
  if (want && !(hd && hd.key === histKey(b) && hd.round === want) && state.historyPending !== `${histKey(b)}|${want}`) loadHistory(b);
}

function renderAll() {
  syncModeControl();
  renderList();
  renderDetail();
}

// ---- countdown + auto refresh ----------------------------------------------------------
function tick() {
  const now = Date.now() / 1000;
  for (const url of activeUrls()) {
    for (const b of beaconsFor(url)) {
      if (!b.period) continue;
      const left = secondsLeft(b, now);
      const text = `${left}s (${b.period}s)`;
      for (const el of document.querySelectorAll(`[data-cd="${CSS.escape(cdKey(url, b))}"]`)) {
        if (el.textContent !== text) el.textContent = text;
        el.classList.toggle('imminent', left <= 3); // warn just before the new round lands
      }
      const flags = rt(url, b);
      if ((b.latest?.round || 0) < expectedRound(b, now) && !flags.refreshing && Date.now() - (flags.lastTry || 0) > 4000) {
        flags.refreshing = true;
        flags.lastTry = Date.now();
        refreshLatest(url, b).finally(() => (flags.refreshing = false));
      }
    }
  }
}

const HEX = '0123456789abcdef';
// Quickly flip random characters, settling left to right on the real value.
function flip(el) {
  const target = el.dataset.flip;
  if (!target || reducedMotion || !state.animate) return;
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
async function refreshLatest(url, b) {
  try {
    const prev = b.latest?.round;
    const network = networkFor(url);
    let latest = await fetchRound(network, b, 'latest');
    // The "latest" endpoint can lag the clock (or be served stale by a cache): ask for the round
    // we know is due by number instead of waiting for the next retry.
    const due = expectedRound(b);
    if (latest.round < due) latest = await fetchRound(network, b, due).catch(() => latest);
    const cur = activeUrls().includes(url) && beaconsFor(url).find((x) => x.id === b.id);
    if (!cur) return;
    cur.latest = latest;
    accumulate(url, cur);
    storeFor(url).savedAt = Date.now();
    persist();
    renderList();
    if (state.view === 'beacon' && url === state.sel.net && b.id === state.sel.id) {
      renderDetail();
      if (prev && latest.round !== prev) detailEl.querySelectorAll('.pair .card:first-child [data-flip]').forEach(flip);
    }
  } catch (error) {
    console.error(error);
  }
}

// Choose a sensible beacon ("default" first) when the selection is empty or has vanished.
function ensureSelection() {
  const list = beaconsFor(state.sel.net);
  if (!list.length || list.some((b) => b.id === state.sel.id)) return; // nothing to fix yet
  for (const url of [state.sel.net, ...activeUrls()]) {
    const l = beaconsFor(url);
    const pick = l.find((b) => b.id === 'default') || l[0];
    if (pick) {
      state.sel = { net: url, id: pick.id };
      return;
    }
  }
}

function afterBeaconsChanged() {
  ensureSelection();
  persist();
  renderAll();
}

async function loadStaticCache() {
  const empty = activeUrls().filter((u) => !beaconsFor(u).length);
  if (!empty.length) return;
  try {
    const data = await fetchJson('data/beacons.json');
    let used = false;
    for (const url of empty) {
      const cached = data.networks?.[url];
      if (activeUrls().includes(url) && Array.isArray(cached) && cached.length && !beaconsFor(url).length) {
        storeFor(url).beacons = cached;
        used = true;
      }
    }
    if (used) {
      setStatus(`Showing deploy-time cache from ${new Date(data.generatedAt).toLocaleString()} — refreshing…`);
      afterBeaconsChanged();
    }
  } catch {
    /* no bundled cache (e.g. local dev) */
  }
}

function updateStatus() {
  const parts = activeUrls().map((url) => {
    const n = networkFor(url);
    const s = netStatus[url];
    const name = n.kind === 'drand' ? 'drand' : n.name.replace(' Beacon', '');
    return `${name}: ${s?.error ? 'unavailable' : s ? `${s.count} beacon${s.count === 1 ? '' : 's'}` : 'loading…'}`;
  });
  const errors = activeUrls().filter((u) => netStatus[u]?.error);
  const done = activeUrls().every((u) => netStatus[u]);
  statusEl.textContent = `${parts.join(' · ')}${done && errors.length < activeUrls().length ? ` · updated ${new Date().toLocaleTimeString()}` : ''}`;
  statusEl.title = errors.map((u) => `${networkFor(u).label}: ${netStatus[u].error}`).join('\n');
  statusEl.className = `statusbar ${done ? (errors.length ? 'bad' : 'ok') : ''}`;
}

async function refreshBeacons(url) {
  const network = networkFor(url);
  delete netStatus[url];
  updateStatus();
  try {
    const ids = await listBeacons(network);
    if (!ids.length) throw new Error('empty beacon list');
    const results = await Promise.allSettled(ids.map((id) => fetchSummary(network, id)));
    if (!activeUrls().includes(url)) return;
    if (results.every((r) => r.status === 'rejected')) throw results[0].reason; // e.g. NIST/INMETRO unreachable
    const old = beaconsFor(url);
    storeFor(url).beacons = ids.map((id, i) => {
      const prev = old.find((b) => b.id === id) || {};
      return results[i].status === 'fulfilled' ? { ...prev, ...results[i].value, latest: results[i].value.latest || prev.latest } : prev.id ? prev : { id };
    });
    storeFor(url).savedAt = Date.now();
    beaconsFor(url).forEach((b) => accumulate(url, b));
    netStatus[url] = { count: ids.length };
    afterBeaconsChanged();
  } catch (error) {
    if (!activeUrls().includes(url)) return;
    console.error(error);
    netStatus[url] = { error: error.message };
    renderList();
  }
  updateStatus();
}

const refreshAll = (urls = activeUrls()) => Promise.all(urls.map(refreshBeacons));

async function loadHistory(b) {
  const round = curRound(b);
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
  if (cur && key === histKey(cur) && curRound(cur) === round) {
    $('historyBody').innerHTML = historyBody(cur);
    refreshHistoryExtras(cur);
  }
}

function refreshHistoryExtras(b) {
  $('commands').innerHTML = endpointsBody(b);
  $('historyCopy').innerHTML = curRound(b) ? copyBtn(command(b, 'round', curRound(b)).text, 'Copy command') : '';
}

function setHistoryRound(b, round, { load = true } = {}) {
  const max = b.latest?.round || Infinity;
  const n = Math.min(max, Math.max(1, Math.floor(Number(round)) || 1));
  state.history[histKey(b)] = n;
  if (Number($('historyInput').value) !== n) $('historyInput').value = n;
  persist();
  if (load) loadHistory(b);
  else refreshHistoryExtras(b);
}

function switchEndpoint(url) {
  const selectedIsDrand = net().kind === 'drand';
  state.endpoint = url;
  if (selectedIsDrand) state.sel = { net: url, id: state.sel.id };
  state.historyData = null;
  state.historyPending = null;
  ensureSelection();
  persist();
  renderAll();
  loadStaticCache().then(() => refreshAll([url]));
}

// ---- events ----------------------------------------------------------------------------
endpointEl.addEventListener('change', () => {
  endpointEl.blur();
  switchEndpoint(endpointEl.value);
});

function selectBeacon(url, id) {
  state.view = 'beacon';
  state.sel = { net: url, id };
  state.historyData = null;
  state.historyPending = null;
  persist();
  renderAll();
}

sidebarEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-view="accumulator"]')) {
    state.view = 'accumulator';
    persist();
    renderAll();
    return;
  }
  if (e.target.closest('#clearHistory')) return clearHistory();
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  selectBeacon(btn.dataset.net, btn.dataset.id);
  if (window.matchMedia('(max-width: 800px)').matches) detailEl.scrollIntoView({ behavior: 'smooth' });
});

// Forget browsing positions (every beacon follows its latest round again) and cached data for
// networks that are not active, leaving just the most recent round of each visible beacon.
function clearHistory() {
  state.history = {};
  state.historyData = null;
  state.historyPending = null;
  for (const url of Object.keys(state.data)) if (!activeUrls().includes(url)) delete state.data[url];
  persist();
  renderAll();
  setStatus('History cleared — showing only the most recent rounds.', 'ok');
}

// Up/Down cycle through every listed beacon (drand, then NIST, then INMETRO), wrapping around.
function cycleBeacon(step) {
  const all = activeUrls().flatMap((url) => beaconsFor(url).map((b) => ({ url, id: b.id })));
  if (!all.length) return;
  const i = all.findIndex((x) => x.url === state.sel.net && x.id === state.sel.id);
  const next = all[(i + step + all.length) % all.length];
  selectBeacon(next.url, next.id);
  sidebarEl.querySelector('.beacon-item.active')?.scrollIntoView({ block: 'nearest' });
}

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
  if (action === 'acc-clear') {
    state.acc.log = [];
    persist();
    updateAccLog();
    return;
  }
  if (action === 'acc-copy') {
    const btn = e.target.closest('[data-action]');
    try {
      await navigator.clipboard.writeText(accHex());
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Denied';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1000);
    return;
  }
  if (!action || !b) return;
  const current = Number($('historyInput').value) || b.latest?.round || 1;
  if (action === 'prev') setHistoryRound(b, current - 1);
  else if (action === 'next') setHistoryRound(b, current + 1);
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
  const key = e.target.dataset?.accKey;
  if (key) {
    const off = state.acc.off.filter((k) => k !== key);
    if (!e.target.checked) off.push(key);
    state.acc.off = off;
    persist();
    if (e.target.checked) {
      const [url, id] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
      const b = beaconsFor(url).find((x) => x.id === id);
      if (b) accumulate(url, b);
    }
    return;
  }
  if (e.target.id === 'animateToggle') {
    state.animate = e.target.checked;
    applyAnimate();
    persist();
    return;
  }
  // Typing a round loads it as soon as the box is committed (blur/Enter)...
  if (e.target.id === 'historyInput') {
    clearTimeout(typingTimer);
    setHistoryRound(selectedBeacon(), e.target.value);
  }
});

// ...or shortly after the user stops typing.
let typingTimer;
detailEl.addEventListener('input', (e) => {
  if (e.target.id !== 'historyInput') return;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    const b = selectedBeacon();
    if (b && Number(e.target.value) > 0) setHistoryRound(b, e.target.value);
  }, 500);
});

// Keyboard navigation through rounds.
document.addEventListener('keydown', (e) => {
  const b = selectedBeacon();
  if (!b || e.ctrlKey || e.metaKey || e.target.closest('input, select, textarea, [contenteditable]')) return;
  const day = Math.max(1, Math.round(86400 / (b.period || 30)));
  const cur = curRound(b) || 1;
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
    e.preventDefault();
    cycleBeacon(e.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (state.view === 'accumulator') return;
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

function applyAnimate() {
  document.documentElement.dataset.animate = state.animate ? 'on' : 'off';
}

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
applyAnimate();
renderEndpoints();
if (activeUrls().some((u) => beaconsFor(u).length)) {
  setStatus('Showing saved data — refreshing…');
  afterBeaconsChanged();
} else {
  renderAll();
}
loadStaticCache().then(() => refreshAll());
setInterval(tick, 1000);
