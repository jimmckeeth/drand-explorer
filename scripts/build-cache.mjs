// Fetches the beacon list and basic info for every network and writes data/beacons.json.
// Run during deploy so the site starts populated. Never fails the deploy: a network that is
// unreachable keeps its previous cache and the browser falls back to live data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ALL_NETWORKS, fetchSummary, listBeacons } from '../providers.js';

const OUT = new URL('../data/beacons.json', import.meta.url);

let old = {};
try {
  old = JSON.parse(await readFile(OUT, 'utf8')).networks || {};
} catch {
  /* first run */
}

const networks = {};
await Promise.all(
  ALL_NETWORKS.map(async (net) => {
    const prev = old[net.url] || [];
    try {
      const ids = await listBeacons(net);
      const results = await Promise.allSettled(ids.map((id) => fetchSummary(net, id)));
      networks[net.url] = results.flatMap((r, i) => {
        if (r.status === 'fulfilled') return [r.value];
        console.warn(`${net.url} ${ids[i]} failed: ${r.reason?.message}`);
        return prev.filter((b) => b.id === ids[i]);
      });
    } catch (error) {
      console.warn(`${net.url} failed, keeping previous cache: ${error.message}`);
      networks[net.url] = prev;
    }
    console.log(`${net.url}: ${networks[net.url].map((b) => b.id).join(', ') || '(none)'}`);
  })
);

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), networks }, null, 2) + '\n');
