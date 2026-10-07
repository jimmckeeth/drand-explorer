# Entropy Beacon Explorer

A real-time explorer of public randomness beacons — [drand](https://drand.love) (League of Entropy), the [NIST Beacon](https://csrc.nist.gov/projects/interoperable-randomness-beacons/beacon-20) and Brazil's [INMETRO Beacon](https://beacon.inmetro.gov.br/) — built as a static web app for GitHub Pages. Source: <https://github.com/jimmckeeth/entropy-beacon-explorer>.

## Features

- The sidebar always lists drand, NIST and INMETRO beacons; the network selector only chooses which drand network (mainnet mirrors, Protocol Labs and Cloudflare testnets) is shown. `default` is the initially selected beacon. Each network's data is cached separately
- Keyboard: ↑/↓ cycle through beacons; ←/→ ±1 round, PgUp/PgDn ±1 day, Alt+PgUp/PgDn ±1 week, Home first, End latest
- Countdown shows `next round (period)`, warns just before a round lands, and the new values flip in with a short animation (the **Animate** checkbox in the Latest box turns animation off; the choice is remembered with the theme)
- Lists drand v2 **beacons by name** (`default`, `quicknet`, …) from `https://api.drand.sh/v2/beacons`; the chain hash is shown as a detail
- Starts populated: the deploy workflow caches the beacon list and basic info into `data/beacons.json`, and each browser also keeps its last-seen data in `localStorage`
- Then refreshes live from the API, with a countdown to the next round and a health indicator
- Browse historical rounds; the selected beacon and the round you were browsing per beacon are remembered
- Light/dark theme (follows the system, toggle in the header) and copyable URL / cURL / wget / drand CLI commands (CLI only for drand networks); URLs are clickable

## Local run

```bash
python -m http.server 8000   # then open http://localhost:8000
node scripts/build-cache.mjs # optional: refresh data/beacons.json
```

## GitHub Pages

In **Settings → Pages**, set the source to **GitHub Actions**. `.github/workflows/pages.yml` runs `scripts/build-cache.mjs`
and deploys on every push to `main`, hourly, and on manual dispatch. All asset paths are relative, so it works under
`https://<user>.github.io/entropy-beacon-explorer/`.
