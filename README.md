# KML Viewer

Web-based KML route viewer for desktop and mobile. Works on **GitHub Pages** with no paid map API keys.

![KML Viewer preview](docs/preview.jpg)

## Features

- Load `.kml` files (or the included sample)
- **Open URL** to load a public KML from a web address (validated before fetch; host must allow CORS)
- Remote load via GET parameter `?url=` (public KML with CORS)
- Map layers: **Road**, **Satellite**, and **Hybrid** (OpenStreetMap + Esri)
- Slider to scrub through each point on the route
- Popup / panel with latitude, longitude, elevation, and cumulative distance
- **Infer address** button (free reverse geocoding: Nominatim OSM → Photon → BigDataCloud; Nominatim ~1 req/s)
- Elevation profile (Chart.js). If the KML has no altitudes, they are fetched from [Open-Meteo Elevation](https://open-meteo.com/en/docs/elevation-api) (no API key)

## Included sample

| File | Description |
|------|-------------|
| `data/VID_20251121_030905_00_005.kml` | Demo data (loaded by default) |

You can open any local `.kml` with **Open KML**, or paste a public http/https link with **Open URL**.

## Load by URL

Use **Open URL** in the UI, or pass a public KML in the `url` parameter (must be URL-encoded):

```
https://miguelcarrascoq.github.io/kml-viewer/?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmiguelcarrascoq%2Fkml-viewer%2Fmain%2Fdata%2FVID_20251121_030905_00_005.kml
```

The KML host must allow CORS (`Access-Control-Allow-Origin`). Public Google Drive links are converted to a direct-download URL when possible, but Drive often blocks `fetch` from the browser.

## Local usage

Serve the folder with any static server (required for `fetch` of KML files):

```bash
python3 -m http.server 8080
```

Open http://localhost:8080

## GitHub Pages

Published at: https://miguelcarrascoq.github.io/kml-viewer/

Branch `main`, root folder.
