# KML Viewer

Web-based KML route viewer for desktop and mobile. Works on **GitHub Pages** with no paid map API keys.

Built with **TypeScript + Vite** (no UI framework). Leaflet and Chart.js stay imperative for the map and elevation profile.

![KML Viewer preview](docs/preview.jpg)

## Features

- Load `.kml` files (or the included sample)
- Remote load via **Open URL** or GET parameter `?url=` (public KML with CORS)
- Map layers: **Road**, **Satellite**, and **Hybrid** (OpenStreetMap + Esri)
- Slider to scrub through each point on the route
- Popup / panel with latitude, longitude, elevation, and cumulative distance
- **Infer address** button (free reverse geocoding: Nominatim OSM → Photon → BigDataCloud; Nominatim ~1 req/s)
- Elevation profile (Chart.js). If the KML has no altitudes, they are fetched from [Open-Meteo Elevation](https://open-meteo.com/en/docs/elevation-api) (no API key)

## Included sample

| File | Description |
|------|-------------|
| `public/data/VID_20251121_030905_00_005.kml` | Demo data (loaded by default) |

You can also open any local `.kml` with **Open KML**.

## Load by URL

Pass a public KML in the `url` parameter (must be URL-encoded):

```
https://miguelcarrascoq.github.io/kml-viewer/?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmiguelcarrascoq%2Fkml-viewer%2Fmain%2Fpublic%2Fdata%2FVID_20251121_030905_00_005.kml
```

The KML host must allow CORS (`Access-Control-Allow-Origin`). Public Google Drive links are converted to a direct-download URL when possible, but Drive often blocks `fetch` from the browser.

If the host does not allow CORS, download the `.kml` yourself (the app shows an **Open / download file** link on failure) and load it with **Open KML**.

## Local usage

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually http://localhost:5173/kml-viewer/).

```bash
npm run build    # typecheck + production build → dist/
npm run preview  # serve dist locally
npm run typecheck
```

## GitHub Pages

Published at: https://miguelcarrascoq.github.io/kml-viewer/

CI builds with Vite and deploys `dist/` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). In the repo **Settings → Pages**, set the source to **GitHub Actions** (not “Deploy from a branch”).

## Project layout

```
src/
  main.ts        # app orchestration (map, UI, loaders)
  kml.ts         # KML parse + haversine
  elevation.ts   # Open-Meteo + Chart.js profile
  geocode.ts     # reverse geocoding providers
  types.ts       # Track / TrackPoint contracts
  styles.css
public/data/     # static KML samples
```
