# KML Viewer

Visor web de rutas KML para escritorio y móvil. Funciona en **GitHub Pages** sin API keys de mapas de pago.

## Funciones

- Carga de archivos `.kml` (o la muestra incluida)
- Carga remota vía parámetro GET `?url=` (KML público con CORS)
- Mapa con capas **Carretera**, **Satélite** e **Híbrida** (OpenStreetMap + Esri)
- Barra deslizante para recorrer cada punto de la ruta
- Popup / panel con latitud, longitud, elevación y distancia acumulada
- Botón **Inferir dirección** (geocodificación inversa gratuita vía BigDataCloud / Nominatim OSM)
- Perfil de elevación (Chart.js). Si el KML no trae alturas, se consultan con [Open-Meteo Elevation](https://open-meteo.com/en/docs/elevation-api) (sin API key)

## Muestra incluida

| Archivo | Descripción |
|---------|-------------|
| `data/VID_20251121_030905_00_005.kml` | Datos demo (carga por defecto) |

También puedes abrir cualquier `.kml` local con **Abrir KML**.

## Cargar por URL

Pasa un KML público en el parámetro `url` (debe estar URL-encoded):

```
https://miguelcarrascoq.github.io/kml-viewer/?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmiguelcarrascoq%2Fkml-viewer%2Fmain%2Fdata%2FVID_20251121_030905_00_005.kml
```

El servidor del KML debe permitir CORS (`Access-Control-Allow-Origin`). Enlaces públicos de Google Drive se convierten a descarga directa cuando es posible, pero Drive suele bloquear el `fetch` desde el navegador.

## Uso local

Sirve la carpeta con cualquier servidor estático (necesario por `fetch` de los KML):

```bash
python3 -m http.server 8080
```

Abre http://localhost:8080

## GitHub Pages

Publicado en: https://miguelcarrascoq.github.io/kml-viewer/

Branch `main`, carpeta raíz.
