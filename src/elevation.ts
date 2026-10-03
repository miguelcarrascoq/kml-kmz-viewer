import {
  Chart,
  type ChartTypeRegistry,
  type Plugin,
  type TooltipItem,
} from "chart.js/auto";
import type { ElevationMeta, TrackPoint } from "./types";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/elevation";
const BATCH_SIZE = 100;

export interface ElevationChart extends Chart {
  setActiveIndex(index: number): void;
  onSelectIndex(fn: (index: number) => void): void;
  _activeIndex?: number;
  _onSelectIndex?: (index: number) => void;
}

interface OpenMeteoElevationResponse {
  elevation?: number[];
}

export function needsElevationEnrichment(points: TrackPoint[]): boolean {
  if (!points.length) return false;
  const withElev = points.filter(
    (p) => p.elev != null && Math.abs(p.elev) > 0.01
  );
  return withElev.length < points.length * 0.1;
}

async function fetchBatch(locations: Array<[number, number]>): Promise<number[]> {
  const lats = locations.map(([lat]) => lat).join(",");
  const lons = locations.map(([, lon]) => lon).join(",");
  const url = `${OPEN_METEO_URL}?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lons)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = (await res.json()) as OpenMeteoElevationResponse;
  if (!Array.isArray(data.elevation)) {
    throw new Error("Invalid elevation response");
  }
  return data.elevation;
}

/**
 * Mutates point.elev when enrichment succeeds.
 */
export async function ensureElevations(
  points: TrackPoint[],
  onProgress?: (msg: string) => void
): Promise<ElevationMeta> {
  if (!needsElevationEnrichment(points)) {
    return { source: "KML", enriched: false };
  }

  const locations = points.map((p): [number, number] => [p.lat, p.lon]);
  const elevations: Array<number | null> = new Array(points.length).fill(null);

  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const slice = locations.slice(i, i + BATCH_SIZE);
    if (onProgress) {
      onProgress(
        `Fetching elevation ${Math.min(i + slice.length, locations.length)}/${locations.length}…`
      );
    }
    const batch = await fetchBatch(slice);
    for (let j = 0; j < batch.length; j++) {
      elevations[i + j] = batch[j] ?? null;
    }
  }

  let filled = 0;
  for (let i = 0; i < points.length; i++) {
    const elev = elevations[i];
    const point = points[i]!;
    if (elev != null && Number.isFinite(elev)) {
      point.elev = elev;
      filled++;
    } else if (point.elev == null) {
      point.elev = 0;
    }
  }

  if (filled === 0) {
    throw new Error("Could not fetch elevations");
  }

  return { source: "Open-Meteo", enriched: true };
}

export function createElevationChart(
  canvas: HTMLCanvasElement,
  points: TrackPoint[]
): ElevationChart {
  const labels = points.map((p) => +(p.distanceM / 1000).toFixed(2));
  const data = points.map((p) => (p.elev != null ? p.elev : 0));

  const activePointPlugin: Plugin<"line"> = {
    id: "activePoint",
    afterDraw(c) {
      const chart = c as ElevationChart;
      const idx = chart._activeIndex;
      if (idx == null || idx < 0) return;
      const meta = chart.getDatasetMeta(0);
      const pt = meta.data[idx];
      if (!pt) return;
      const { ctx, chartArea } = chart;
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
  };

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Elevation (m)",
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
            title(items: TooltipItem<keyof ChartTypeRegistry>[]) {
              const i = items[0]?.dataIndex ?? 0;
              return `Point ${i + 1} · ${labels[i]} km`;
            },
            label(ctx: TooltipItem<"line">) {
              const v = ctx.parsed.y;
              return `Elevation: ${v != null ? v.toFixed(1) : "—"} m`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Distance (km)", color: "#8b9aab" },
          ticks: {
            color: "#8b9aab",
            maxTicksLimit: 8,
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
        const elevationChart = chart as ElevationChart;
        if (!elements.length || !elevationChart._onSelectIndex) return;
        const first = elements[0];
        if (!first) return;
        elevationChart._onSelectIndex(first.index);
      },
    },
    plugins: [activePointPlugin],
  }) as ElevationChart;

  chart.setActiveIndex = (index: number) => {
    chart._activeIndex = index;
    chart.update("none");
  };

  chart.onSelectIndex = (fn: (index: number) => void) => {
    chart._onSelectIndex = fn;
  };

  return chart;
}
