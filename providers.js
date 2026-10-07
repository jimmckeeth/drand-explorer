// Network registry plus a small provider layer so the UI can treat drand and
// NIST-style (Beacon 2.0 pulse) randomness beacons the same way.
import { API_BASE, beaconUrl, expectedRound as drandExpected, fetchBeaconSummary, fetchJson, parseBeaconIds, roundTime, summarizeRound } from './drand.js';

const NIST = 'https://beacon.nist.gov/beacon/2.0';
const INMETRO = 'https://beacon.inmetro.gov.br/beacon/2.1';

const drand = (url) => ({ url, kind: 'drand', label: url.replace(/^https:\/\//, '') });

export const NETWORKS = [
  { group: 'drand mainnet', items: [API_BASE, 'https://api2.drand.sh/v2', 'https://api3.drand.sh/v2'].map(drand) },
  { group: 'drand Protocol Labs testnet', items: ['https://pl-us.testnet.drand.sh/v2', 'https://pl-eu.testnet.drand.sh/v2'].map(drand) },
  { group: 'drand Cloudflare testnet', items: [drand('https://testnet-api.drand.cloudflare.com')] },
  {
    group: 'Other randomness beacons',
    items: [
      { url: NIST, kind: 'nist', label: 'NIST Beacon 2.0 (USA)', name: 'NIST Beacon', bases: [NIST] },
      // INMETRO publishes the NIST 2.x interface; try 2.1 first, then 2.0.
      { url: INMETRO, kind: 'nist', label: 'INMETRO Beacon (Brazil)', name: 'INMETRO Beacon', bases: [INMETRO, INMETRO.replace('/2.1', '/2.0')] }
    ]
  }
];

export const ALL_NETWORKS = NETWORKS.flatMap((g) => g.items);
export const networkFor = (url) => ALL_NETWORKS.find((n) => n.url === url) || drand(url);

// ---- NIST-style pulses -----------------------------------------------------------------
function pulseToRound(p = {}) {
  return {
    round: Number(p.pulseIndex) || 0,
    randomness: p.outputValue || '',
    signature: p.signatureValue || '',
    time: Date.parse(p.timeStamp) / 1000 || 0
  };
}

async function fetchPulse(net, b, path) {
  let error;
  for (const base of b.base ? [b.base] : net.bases) {
    try {
      const data = await fetchJson(base + path);
      return { pulse: data.pulse || data, base };
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

// ---- provider interface ----------------------------------------------------------------
export async function listBeacons(net) {
  if (net.kind === 'nist') return [net.name];
  return parseBeaconIds(await fetchJson(`${net.url}/beacons`));
}

export async function fetchSummary(net, id) {
  if (net.kind === 'nist') {
    const { pulse, base } = await fetchPulse(net, {}, '/pulse/last');
    return {
      id,
      base,
      chainIndex: pulse.chainIndex,
      certificateId: pulse.certificateId || '',
      scheme: pulse.cipherSuite !== undefined ? `Cipher suite ${pulse.cipherSuite}` : '',
      period: (Number(pulse.period) || 0) / 1000,
      genesisTime: 0,
      hash: '',
      publicKey: '',
      latest: pulseToRound(pulse)
    };
  }
  const summary = await fetchBeaconSummary(id, net.url);
  if (summary.latest) summary.latest.time = roundTime(summary, summary.latest.round);
  return summary;
}

export async function fetchRound(net, b, round) {
  if (net.kind === 'nist') {
    const path = round === 'latest' ? '/pulse/last' : `/chain/${b.chainIndex}/pulse/${round}`;
    return pulseToRound((await fetchPulse(net, b, path)).pulse);
  }
  const r = await summarizeRound(await fetchJson(beaconUrl(net.url, b.id, `/rounds/${round}`)));
  r.time = roundTime(b, r.round);
  return r;
}

export function urlsFor(net, b) {
  if (net.kind === 'nist') {
    const base = b.base || net.bases[0];
    return { info: `${base}/chain/${b.chainIndex}`, round: (r) => (r === 'latest' ? `${base}/pulse/last` : `${base}/chain/${b.chainIndex}/pulse/${r}`) };
  }
  return { info: beaconUrl(net.url, b.id, '/info'), round: (r) => beaconUrl(net.url, b.id, `/rounds/${r}`) };
}

// Round that should exist by now, and when the next one is due.
export function expectedRound(b, now = Date.now() / 1000) {
  if (b.genesisTime) return drandExpected(b, now);
  if (!b.latest?.time || !b.period) return 0;
  return b.latest.round + Math.floor(Math.max(0, now - b.latest.time) / b.period);
}

export function nextRoundTime(b, now = Date.now() / 1000) {
  if (b.genesisTime) return b.genesisTime + drandExpected(b, now) * b.period;
  if (!b.latest?.time) return 0;
  return b.latest.time + b.period * (Math.floor(Math.max(0, now - b.latest.time) / b.period) + 1);
}

export { roundTime };
