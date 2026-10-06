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
    hash: info.hash || '',
    groupHash: info.groupHash || info.group_hash || '',
    scheme: info.schemeID || info.scheme_id || info.scheme || '',
    period: Number(info.period) || 0,
    genesisTime: Number(info.genesis_time ?? info.genesisTime) || 0,
    publicKey: info.public_key || info.publicKey || ''
  };
}

export function summarizeRound(round = {}) {
  return {
    round: Number(round.round) || 0,
    randomness: round.randomness || '',
    signature: round.signature || ''
  };
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
  return {
    ...summarizeInfo(id, info.status === 'fulfilled' ? info.value : {}),
    latest: latest.status === 'fulfilled' ? summarizeRound(latest.value) : null
  };
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
