# drand-explorer

A real-time explorer of the League of Entropy's Distributed Randomness beacon (drand), built as a static web app for GitHub Pages.

## Features

- Lists drand v2 **beacons by name** (`default`, `quicknet`, …) from `https://api.drand.sh/v2/beacons`; the chain hash is shown as a detail
- Starts populated: the deploy workflow caches the beacon list and basic info into `data/beacons.json`, and each browser also keeps its last-seen data in `localStorage`
- Then refreshes live from the API, with a countdown to the next round and a health indicator
- Browse historical rounds; the selected beacon and the round you were browsing per beacon are remembered
- Light/dark theme (follows the system, toggle in the header) and copyable URL / cURL / wget commands

## Local run

```bash
python -m http.server 8000   # then open http://localhost:8000
node scripts/build-cache.mjs # optional: refresh data/beacons.json
```

## GitHub Pages

In **Settings → Pages**, set the source to **GitHub Actions**. `.github/workflows/pages.yml` runs `scripts/build-cache.mjs`
and deploys on every push to `main`, hourly, and on manual dispatch. All asset paths are relative, so it works under
`https://<user>.github.io/drand-explorer/`.
