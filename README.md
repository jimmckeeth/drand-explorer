# drand-explorer

A real-time explorer of the League of Entropy's Distributed Randomness beacon (drand), built as a static web app for GitHub Pages.

## Features

- Lists all drand v2 beacon chains from `https://api.drand.sh/v2/chains`
- Shows per-chain info, health, latest round values, and a live countdown to the next period
- Refreshes latest rounds automatically with a quick scramble animation on updates
- Supports browsing historical rounds per chain
- Provides copyable retrieval commands in **URL**, **CLI**, or **cURL** formats

## Local run

Because this is a static app, serve the repository root with any static server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

This repository is GitHub Pages-ready:

- `index.html` is at repository root
- Static assets (`app.js`, `style.css`) are root-relative

Enable Pages to deploy from the default branch root.
