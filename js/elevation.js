/**
 * Elevation chart + optional OpenTopoData enrichment for missing altitudes.
 */
(function (global) {
  "use strict";

  const OPENTOPO_URL = "https://api.opentopodata.org/v1/aster30m";
  const BATCH_SIZE = 90;
  const BATCH_DELAY_MS = 1100;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function needsElevationEnrichment(points) {
    if (!points.length) return false;
    const withElev = points.filter((p) => p.elev != null && Math.abs(p.elev) > 0.01);
    return withElev.length < points.length * 0.1;
  }

  async function fetchBatch(locations) {
    const loc = locations.map(([lat, lon]) => `${lat},${lon}`).join("|");
    const url = `${OPENTOPO_URL}?locations=${encodeURIComponent(loc)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenTopoData HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK" || !Array.isArray(data.results)) {
      throw new Error(data.error || "Respuesta OpenTopoData inválida");
    }
    return data.results.map((r) => (r && r.elevation != null ? r.elevation : null));
  }

  /**
   * Mutates point.elev when enrichment succeeds.
   * @returns {{ source: string, enriched: boolean }}
   */
  async function ensureElevations(points, onProgress) {
    if (!needsElevationEnrichment(points)) {
      return { source: "KML", enriched: false };
    }

    const locations = points.map((p) => [p.lat, p.lon]);
    const elevations = new Array(points.length).fill(null);

    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
      const slice = locations.slice(i, i + BATCH_SIZE);
      if (i > 0) await sleep(BATCH_DELAY_MS);
      if (onProgress) {
        onProgress(
          `Consultando elevación ${Math.min(i + slice.length, locations.length)}/${locations.length}…`
        );
      }
      const batch = await fetchBatch(slice);
      for (let j = 0; j < batch.length; j++) {
        elevations[i + j] = batch[j];
      }
    }

    let filled = 0;
    for (let i = 0; i < points.length; i++) {
      if (elevations[i] != null) {
        points[i].elev = elevations[i];
        filled++;
      } else if (points[i].elev == null) {
        points[i].elev = 0;
      }
    }

    if (filled === 0) {
      throw new Error("No se pudieron obtener elevaciones");
    }

    return { source: "OpenTopoData ASTER", enriched: true };
  }

  function createElevationChart(canvas, points) {
    const labels = points.map((p) => +(p.distanceM / 1000).toFixed(2));
    const data = points.map((p) => (p.elev != null ? p.elev : 0));

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Elevación (m)",
            data,
            borderColor: "#2dd4a8",
            backgroundColor: "rgba(45, 212, 168, 0.18)",
            fill: true,
            tension: 0.2,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title(items) {
                const i = items[0]?.dataIndex ?? 0;
                return `Punto ${i + 1} · ${labels[i]} km`;
              },
              label(ctx) {
                const v = ctx.parsed.y;
                return `Elevación: ${v != null ? v.toFixed(1) : "—"} m`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Distancia (km)", color: "#8b9aab" },
            ticks: {
              color: "#8b9aab",
              maxTicksLimit: 8,
              callback(value, index) {
                const label = this.getLabelForValue(value);
                return typeof label === "string" || typeof label === "number"
                  ? label
                  : index;
              },
            },
            grid: { color: "rgba(139,154,171,0.12)" },
          },
          y: {
            title: { display: true, text: "m", color: "#8b9aab" },
            ticks: { color: "#8b9aab" },
            grid: { color: "rgba(139,154,171,0.12)" },
          },
        },
        onClick(_evt, elements) {
          if (!elements.length || !chart._onSelectIndex) return;
          chart._onSelectIndex(elements[0].index);
        },
      },
      plugins: [
        {
          id: "activePoint",
          afterDraw(c) {
            const idx = c._activeIndex;
            if (idx == null || idx < 0) return;
            const meta = c.getDatasetMeta(0);
            const pt = meta.data[idx];
            if (!pt) return;
            const { ctx, chartArea } = c;
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "#f0c14a";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.moveTo(pt.x, chartArea.top);
            ctx.lineTo(pt.x, chartArea.bottom);
            ctx.stroke();
            ctx.beginPath();
            ctx.setLineDash([]);
            ctx.fillStyle = "#f0c14a";
            ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          },
        },
      ],
    });

    chart.setActiveIndex = (index) => {
      chart._activeIndex = index;
      chart.update("none");
    };

    chart.onSelectIndex = (fn) => {
      chart._onSelectIndex = fn;
    };

    return chart;
  }

  global.KmlViewer = global.KmlViewer || {};
  global.KmlViewer.ensureElevations = ensureElevations;
  global.KmlViewer.needsElevationEnrichment = needsElevationEnrichment;
  global.KmlViewer.createElevationChart = createElevationChart;
})(typeof window !== "undefined" ? window : globalThis);
