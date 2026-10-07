// Fetches the beacon list and basic info for each beacon and writes data/beacons.json.
// Run during deploy so the site starts populated. Never fails the deploy: if the API is
// unreachable the previous cache (or an empty one) is kept and the browser falls back to live data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { API_BASE, fetchBeaconSummary, fetchJson, parseBeaconIds } from '../drand.js';

const OUT = new URL('../data/beacons.json', import.meta.url);

async function previous() {
  try {
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return { beacons: [] };
  }
}

const old = await previous();
let beacons = [];
try {
  const ids = parseBeaconIds(await fetchJson(`${API_BASE}/beacons`));
  const results = await Promise.allSettled(ids.map((id) => fetchBeaconSummary(id, API_BASE)));
  beacons = results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return [r.value];
    console.warn(`beacon ${ids[i]} failed: ${r.reason?.message}`);
    return old.beacons.filter((b) => b.id === ids[i]);
  });
} catch (error) {
  console.warn(`beacon list failed, keeping previous cache: ${error.message}`);
  beacons = old.beacons;
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), beacons }, null, 2) + '\n');
console.log(`Cached ${beacons.length} beacon(s): ${beacons.map((b) => b.id).join(', ')}`);
