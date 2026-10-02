# KML Viewer

Visor web de rutas KML para escritorio y móvil. Funciona en **GitHub Pages** sin API keys de mapas de pago.

## Funciones

- Carga de archivos `.kml` (o la muestra incluida)
- Mapa con capas **Carretera**, **Satélite** e **Híbrida** (OpenStreetMap + Esri)
- Barra deslizante para recorrer cada punto de la ruta
- Popup / panel con latitud, longitud, elevación y distancia acumulada
- Botón **Inferir dirección** (geocodificación inversa gratuita vía BigDataCloud / Nominatim OSM)
- Perfil de elevación (Chart.js). Si el KML no trae alturas, se consultan con [Open-Meteo Elevation](https://open-meteo.com/en/docs/elevation-api) (sin API key)

## Muestra incluida

| Archivo | Descripción |
|---------|-------------|
| `data/VID_20251121_030905_00_005.kml` | Muestra Insta360 (carga por defecto) |

También puedes abrir cualquier `.kml` local con **Abrir KML**.

## Uso local

Sirve la carpeta con cualquier servidor estático (necesario por `fetch` de los KML):

```bash
python3 -m http.server 8080
```

Abre http://localhost:8080

## GitHub Pages

Publicado en: https://miguelcarrascoq.github.io/kml-viewer/

Branch `main`, carpeta raíz.
