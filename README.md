# KML Viewer

Visor web de rutas KML para escritorio y móvil. Funciona en **GitHub Pages** sin API keys de mapas de pago.

## Funciones

- Carga de archivos `.kml` (o muestras incluidas)
- Mapa con capas **Carretera**, **Satélite** e **Híbrida** (OpenStreetMap + Esri)
- Barra deslizante para recorrer cada punto de la ruta
- Popup / panel con latitud, longitud, elevación y distancia acumulada
- Perfil de elevación (Chart.js). Si el KML no trae alturas, se consultan con [OpenTopoData](https://www.opentopodata.org/) (ASTER 30 m)

## Muestras incluidas

| Archivo | Descripción |
|---------|-------------|
| `data/ruta-completa-30-09-2026.kml` | Demo al abrir la página (ruta vehículo) |
| `data/VID_20251121_030905_00_005.kml` | Muestra Insta360 con elevación en el KML |

## Uso local

Sirve la carpeta con cualquier servidor estático (necesario por `fetch` de los KML):

```bash
python3 -m http.server 8080
```

Abre http://localhost:8080

## GitHub Pages

Publicado en: https://miguelcarrascoq.github.io/kml-viewer/

Branch `main`, carpeta raíz.
