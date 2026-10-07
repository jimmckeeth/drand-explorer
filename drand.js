// Shared by the browser app and the deploy-time cache builder (scripts/build-cache.mjs).
export const API_BASE = 'https://api.drand.sh/v2';

export async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// /v2/beacons returns a list of human-readable beacon ids (e.g. "default", "quicknet").
// Tolerate a bare array or an object wrapper.
export function parseBeaconIds(data) {
  const list = Array.isArray(data) ? data : data?.beacons;
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item) => (typeof item === 'string' ? item : item?.id || item?.beaconID || item?.beacon_id))
    .filter(Boolean);
}

export function summarizeInfo(id, info = {}) {
  return {
    id,
    hash: info.hash || info.chain_hash || info.chainHash || info.metadata?.chain_hash || info.metadata?.chainHash || '',
    groupHash: info.groupHash || info.group_hash || '',
    scheme: info.schemeID || info.scheme_id || info.scheme || '',
    period: Number(info.period) || 0,
    genesisTime: Number(info.genesis_time ?? info.genesisTime) || 0,
    publicKey: info.public_key || info.publicKey || ''
  };
}

// drand randomness is defined as SHA-256(signature), so derive it when the API omits it.
export async function sha256Hex(hex) {
  const bytes = Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function summarizeRound(round = {}) {
  const signature = round.signature || '';
  let randomness = round.randomness || '';
  if (!randomness && /^([0-9a-f]{2})+$/i.test(signature)) {
    try {
      randomness = await sha256Hex(signature);
    } catch {
      /* subtle crypto unavailable (insecure context) */
    }
  }
  return { round: Number(round.round) || 0, randomness, signature };
}

// Some responses don't carry the chain hash; find it by matching beacon id across /v2/chains.
let chainIndex;
async function resolveChainHash(id) {
  chainIndex ??= (async () => {
    const data = await fetchJson(`${API_BASE}/chains`);
    const hashes = (Array.isArray(data) ? data : data?.chains || []).map((c) => (typeof c === 'string' ? c : c?.hash));
    const infos = await Promise.allSettled(hashes.filter(Boolean).map((h) => fetchJson(`${API_BASE}/chains/${h}/info`).then((i) => [h, i])));
    const map = {};
    for (const r of infos) {
      if (r.status !== 'fulfilled') continue;
      const [h, i] = r.value;
      const name = i?.metadata?.beaconID || i?.metadata?.beacon_id || i?.beaconID || i?.beacon_id;
      if (name) map[name] = i?.hash || h;
    }
    return map;
  })().catch(() => ({}));
  return (await chainIndex)[id] || '';
}

export const beaconUrl = (id, resource = '') => `${API_BASE}/beacons/${encodeURIComponent(id)}${resource}`;

export async function fetchBeaconSummary(id) {
  const [info, latest] = await Promise.allSettled([
    fetchJson(beaconUrl(id, '/info')),
    fetchJson(beaconUrl(id, '/rounds/latest'))
  ]);
  if (info.status !== 'fulfilled' && latest.status !== 'fulfilled') {
    throw info.reason;
  }
  const summary = summarizeInfo(id, info.status === 'fulfilled' ? info.value : {});
  if (!summary.hash) summary.hash = await resolveChainHash(id);
  return { ...summary, latest: latest.status === 'fulfilled' ? await summarizeRound(latest.value) : null };
}

export function roundTime(beacon, round) {
  if (!beacon.genesisTime || !beacon.period || !round) {
    return 0;
  }
  return beacon.genesisTime + (round - 1) * beacon.period;
}

export function expectedRound(beacon, nowSec = Date.now() / 1000) {
  if (!beacon.genesisTime || !beacon.period || nowSec < beacon.genesisTime) {
    return 0;
  }
  return Math.floor((nowSec - beacon.genesisTime) / beacon.period) + 1;
}
