const API_BASE = 'https://api.drand.sh/v2';

const statusEl = document.getElementById('status');
const chainGridEl = document.getElementById('chainGrid');
const chainTemplate = document.getElementById('chainTemplate');
const outputModeEl = document.getElementById('outputMode');

const state = {
  outputMode: 'url',
  chains: []
};

function endpointFor(hash, resource) {
  return `${API_BASE}/chains/${hash}${resource}`;
}

function formatTime(tsSeconds) {
  if (!Number.isFinite(tsSeconds) || tsSeconds <= 0) {
    return '—';
  }
  return new Date(tsSeconds * 1000).toLocaleString();
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildCommand(url) {
  switch (state.outputMode) {
    case 'curl':
      return `curl -s "${url}"`;
    case 'cli':
      return `wget -qO- "${url}"`;
    case 'url':
    default:
      return url;
  }
}

function classifyHealth(health) {
  const current = Number(health?.current);
  const expected = Number(health?.expected);

  if (!Number.isFinite(current) || !Number.isFinite(expected)) {
    return { text: 'Unknown', className: 'warning' };
  }

  const delta = expected - current;
  if (delta <= 0) {
    return { text: 'Healthy', className: 'healthy' };
  }

  if (delta === 1) {
    return { text: 'Slightly behind', className: 'warning' };
  }

  return { text: `Behind by ${delta}`, className: 'unhealthy' };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed ${response.status} for ${url}`);
  }
  return response.json();
}

function estimateNextRoundTime(chain) {
  const period = Number(chain.info?.period);
  const latestRound = Number(chain.latest?.round);
  const genesis = Number(chain.info?.genesis_time);

  if (!Number.isFinite(period) || period <= 0) {
    return null;
  }

  if (Number.isFinite(genesis) && genesis > 0 && Number.isFinite(latestRound) && latestRound > 0) {
    return genesis + (latestRound + 1) * period;
  }

  return Math.floor(Date.now() / 1000) + period;
}

function scrambleToValue(el, finalValue) {
  if (!el) {
    return;
  }

  const chars = 'abcdef0123456789';
  const target = String(finalValue || '—');
  let frame = 0;
  const maxFrames = 6;

  el.classList.add('scramble');
  const id = window.setInterval(() => {
    frame += 1;
    if (frame >= maxFrames) {
      window.clearInterval(id);
      el.textContent = target;
      el.classList.remove('scramble');
      return;
    }

    const scrambled = target
      .split('')
      .map((char) => {
        if (!/[a-f0-9]/i.test(char)) {
          return char;
        }
        return chars[Math.floor(Math.random() * chars.length)];
      })
      .join('');
    el.textContent = scrambled;
  }, 50);
}

function renderCommands(chain, historyRound) {
  const endpoints = [
    { label: 'Chain info', url: endpointFor(chain.hash, '') },
    { label: 'Health', url: endpointFor(chain.hash, '/health') },
    { label: 'Latest', url: endpointFor(chain.hash, '/rounds/latest') },
    {
      label: `Round ${historyRound || Number(chain.latest?.round) || '?'}`,
      url: endpointFor(chain.hash, `/rounds/${historyRound || Number(chain.latest?.round) || 'latest'}`)
    }
  ];

  return endpoints;
}

function updateCountdown(chain) {
  if (!chain.elements?.countdown) {
    return;
  }

  const nextTs = estimateNextRoundTime(chain);
  if (!nextTs) {
    chain.elements.countdown.textContent = 'Unknown';
    return;
  }

  const nowTs = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, nextTs - nowTs);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  chain.elements.countdown.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;

  if (remaining === 0 && !chain.refreshingLatest) {
    chain.refreshingLatest = true;
    refreshLatest(chain)
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        chain.refreshingLatest = false;
      });
  }
}

function fillField(parent, field, value) {
  const el = parent.querySelector(`[data-field="${field}"]`);
  if (el) {
    el.textContent = value;
  }
  return el;
}

function renderCommandList(chain) {
  const listEl = chain.elements?.commands;
  if (!listEl) {
    return;
  }

  listEl.innerHTML = '';
  const historyRound = toPositiveInt(chain.elements.historyInput?.value) || Number(chain.latest?.round);

  for (const endpoint of renderCommands(chain, historyRound)) {
    const li = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = endpoint.label;

    const code = document.createElement('code');
    code.textContent = buildCommand(endpoint.url);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || '');
        copyBtn.textContent = 'Copied';
        window.setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 1000);
      } catch {
        copyBtn.textContent = 'Denied';
      }
    });

    li.append(label, code, copyBtn);
    listEl.appendChild(li);
  }
}

async function loadHistorical(chain, round) {
  if (!round) {
    return;
  }

  try {
    const data = await fetchJson(endpointFor(chain.hash, `/rounds/${round}`));
    fillField(chain.elements.card, 'historyRound', data.round ?? '—');
    fillField(chain.elements.card, 'historyRandomness', data.randomness ?? '—');
    fillField(chain.elements.card, 'historySignature', data.signature ?? '—');
    fillField(chain.elements.card, 'historyTime', formatTime(data.round_timestamp || data.timestamp));
    renderCommandList(chain);
  } catch (error) {
    fillField(chain.elements.card, 'historyRound', 'Not found');
    fillField(chain.elements.card, 'historyRandomness', '—');
    fillField(chain.elements.card, 'historySignature', '—');
    fillField(chain.elements.card, 'historyTime', '—');
    console.error(error);
  }
}

async function refreshLatest(chain) {
  const latest = await fetchJson(endpointFor(chain.hash, '/rounds/latest'));
  const previousRound = Number(chain.latest?.round);

  chain.latest = latest;

  if (chain.elements?.latestRound) {
    chain.elements.latestRound.textContent = String(latest.round ?? '—');
  }

  if (Number(latest.round) !== previousRound) {
    scrambleToValue(chain.elements.latestRandomness, latest.randomness ?? '—');
    scrambleToValue(chain.elements.latestSignature, latest.signature ?? '—');
  } else {
    fillField(chain.elements.card, 'latestRandomness', latest.randomness ?? '—');
    fillField(chain.elements.card, 'latestSignature', latest.signature ?? '—');
  }

  fillField(chain.elements.card, 'latestTime', formatTime(latest.round_timestamp || latest.timestamp));
  renderCommandList(chain);
}

function attachHistoryHandlers(chain) {
  const { card, historyInput } = chain.elements;

  const loadCurrent = () => {
    const round = toPositiveInt(historyInput.value);
    if (!round) {
      return;
    }
    loadHistorical(chain, round);
  };

  card.querySelector('[data-action="loadRound"]')?.addEventListener('click', loadCurrent);
  historyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      loadCurrent();
    }
  });

  card.querySelector('[data-action="prevRound"]')?.addEventListener('click', () => {
    const current = toPositiveInt(historyInput.value) || 1;
    historyInput.value = String(Math.max(1, current - 1));
    loadCurrent();
  });

  card.querySelector('[data-action="nextRound"]')?.addEventListener('click', () => {
    const current = toPositiveInt(historyInput.value) || 1;
    historyInput.value = String(current + 1);
    loadCurrent();
  });
}

function renderChainCard(chain, index) {
  const fragment = chainTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.chain-card');

  const period = Number(chain.info?.period);
  const healthClass = classifyHealth(chain.health);

  fillField(card, 'name', chain.info?.metadata?.beacon_name || chain.info?.beacon_id || `Chain ${index + 1}`);
  fillField(card, 'hash', chain.hash);
  fillField(card, 'period', Number.isFinite(period) ? `${period}s` : 'Unknown');
  fillField(card, 'scheme', chain.info?.schemeID || chain.info?.scheme_id || 'Unknown');
  fillField(card, 'beaconId', chain.info?.beaconID || chain.info?.beacon_id || 'default');
  fillField(card, 'publicKey', chain.info?.public_key || chain.info?.publicKey || 'Unknown');

  fillField(card, 'healthCurrent', chain.health?.current ?? '—');
  fillField(card, 'healthExpected', chain.health?.expected ?? '—');

  const healthStatus = fillField(card, 'healthStatus', healthClass.text);
  if (healthStatus) {
    healthStatus.classList.add(healthClass.className);
  }

  const latestRound = fillField(card, 'latestRound', chain.latest?.round ?? '—');
  const latestRandomness = fillField(card, 'latestRandomness', chain.latest?.randomness ?? '—');
  const latestSignature = fillField(card, 'latestSignature', chain.latest?.signature ?? '—');
  fillField(card, 'latestTime', formatTime(chain.latest?.round_timestamp || chain.latest?.timestamp));

  const historyInput = card.querySelector('[data-field="historyInput"]');
  historyInput.value = String(chain.latest?.round || 1);
  fillField(card, 'historyRound', chain.latest?.round ?? '—');
  fillField(card, 'historyRandomness', chain.latest?.randomness ?? '—');
  fillField(card, 'historySignature', chain.latest?.signature ?? '—');
  fillField(card, 'historyTime', formatTime(chain.latest?.round_timestamp || chain.latest?.timestamp));

  const commands = card.querySelector('[data-field="commands"]');

  chain.elements = {
    card,
    latestRound,
    latestRandomness,
    latestSignature,
    historyInput,
    countdown: card.querySelector('[data-field="countdown"]'),
    commands
  };

  attachHistoryHandlers(chain);
  renderCommandList(chain);
  updateCountdown(chain);

  return fragment;
}

async function loadChains() {
  statusEl.textContent = 'Loading chains…';
  chainGridEl.innerHTML = '';

  try {
    const chainsData = await fetchJson(`${API_BASE}/chains`);
    const chains = Array.isArray(chainsData?.chains) ? chainsData.chains : [];

    const fullChains = await Promise.all(
      chains.map(async (hash) => {
        const [info, health, latest] = await Promise.allSettled([
          fetchJson(endpointFor(hash, '')),
          fetchJson(endpointFor(hash, '/health')),
          fetchJson(endpointFor(hash, '/rounds/latest'))
        ]);

        return {
          hash,
          info: info.status === 'fulfilled' ? info.value : {},
          health: health.status === 'fulfilled' ? health.value : {},
          latest: latest.status === 'fulfilled' ? latest.value : {}
        };
      })
    );

    state.chains = fullChains;

    fullChains.forEach((chain, index) => {
      chainGridEl.appendChild(renderChainCard(chain, index));
    });

    statusEl.textContent = `Loaded ${fullChains.length} chain${fullChains.length === 1 ? '' : 's'}.`;
  } catch (error) {
    statusEl.textContent = `Failed to load chains: ${error.message}`;
  }
}

outputModeEl.addEventListener('change', () => {
  state.outputMode = outputModeEl.value;
  state.chains.forEach((chain) => {
    renderCommandList(chain);
  });
});

window.setInterval(() => {
  state.chains.forEach((chain) => {
    updateCountdown(chain);
  });
}, 1000);

loadChains();
