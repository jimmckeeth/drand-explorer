# Entropy Beacon Explorer

A real-time explorer of public randomness beacons — [drand](https://drand.love) (League of Entropy), the [NIST Beacon](https://csrc.nist.gov/projects/interoperable-randomness-beacons/beacon-20) and Brazil's [INMETRO Beacon](https://beacon.inmetro.gov.br/) — built as a static web app for [GitHub Pages](https://jimmckeeth.github.io/entropy-beacon-explorer/). 

<a href="https://drand.love"><img height="150" alt="drand logo" src="https://github.com/user-attachments/assets/79b6b45e-31e7-45cd-a657-c84ffee6bb8d" /></a><a href="https://csrc.nist.gov/projects/interoperable-randomness-beacons/beacon-20"><img height="150" alt="NIST Logo" src="https://github.com/user-attachments/assets/06375838-9d37-4ade-8a32-656319284c22" /></a><a href="https://beacon.inmetro.gov.br/"><img height="150" alt="Flag of Brazil" src="https://github.com/user-attachments/assets/f01f77d7-cc52-4d80-9625-2319eeee63c5" />

<a href="https://jimmckeeth.github.io/entropy-beacon-explorer/"><img width="50%" alt="Preview" src="https://github.com/user-attachments/assets/accbb621-0bb0-4627-a7c9-00c1b6ac96cf" /></a>


## Features

- The sidebar lists drand, NIST and INMETRO beacons
  - The network selector chooses which drand network (mainnet mirrors, Protocol Labs and Cloudflare testnets) is shown. `default` is the initially selected beacon. Each network's data is cached separately
- Keyboard:
  - **↑/↓** cycle through beacons
  - **←/→** ±1 round
  - `PgUp/PgDn` ±1 day
  - `Alt+PgUp/PgDn` ±1 week
  - `Home` first
  - `End` latest
- Countdown shows `next round (period)`, warns just before a round lands, and the new values flip in with a short animation (the **Animate** checkbox in the Latest box turns animation off)
- Lists drand v2 **beacons by name** (`default`, `quicknet`, …) from `https://api.drand.sh/v2/beacons`; the chain hash is shown as a detail
- Starts populated: the deploy workflow caches the beacon list and basic info into `data/beacons.json`, and each browser also keeps its last-seen data in `localStorage`
- Refreshes live from the API, with a countdown to the next round and a health indicator
- Browse historical rounds; the selected beacon and the round you were browsing per beacon are remembered
- Light/dark theme (follows the system, toggle in the header) and copyable `URL` / `cURL` / `wget` / `drand CLI` commands (CLI only for drand networks)

## Local run

```bash
python -m http.server 8000   # then open http://localhost:8000
node scripts/build-cache.mjs # optional: refresh data/beacons.json
```

## GitHub Pages

In **Settings → Pages**, set the source to **GitHub Actions**. `.github/workflows/pages.yml` runs `scripts/build-cache.mjs`
and deploys on every push to `main`, hourly, and on manual dispatch. All asset paths are relative, so it works under
`https://<user>.github.io/entropy-beacon-explorer/`.

## Copyright and License

Copyright © 2026 by James "Jim" McKeeth licensed under [MIT](LICENSE.md) 
