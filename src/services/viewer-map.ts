import { accessibility as A, viewerEngine as V, jobs } from "./engine";
import type { ViewerStore } from "./viewer-store";
import type { YandexMapHost } from "../components/YandexMap";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export class ViewerMap {
  private map: any;
  private layer: any;
  private markers: any;
  private rendered = new Set<any>();
  private token = 0;
  private release?: () => void;
  constructor(
    private api: any,
    private host: YandexMapHost,
    private store: ViewerStore,
  ) {
    this.map = host.create(
      api,
      {
        center: [53.95, 37.2],
        zoom: 8,
        controls: ["zoomControl", "typeSelector"],
      },
      { suppressMapOpenBlock: true },
    );
    this.layer = new api.GeoObjectCollection();
    this.markers = new api.GeoObjectCollection();
    this.map.geoObjects.add(this.layer).add(this.markers);
    this.fit();
    this.release = host.onDestroy?.(() => {
      this.token++;
      this.rendered.clear();
      this.map = null;
    });
  }
  fit = () =>
    this.map?.setBounds(
      [
        [52.7, 35.8],
        [54.85, 38.6],
      ],
      { checkZoomRange: true, zoomMargin: 45 },
    );
  resize() {
    this.map?.container.fitToViewport();
  }
  async draw() {
    if (!this.map) return;
    const token = ++this.token,
      state = this.store.getSnapshot();
    const cancelled = () => token !== this.token;
    await jobs.chunks(
      [...this.rendered],
      (shape) => {
        this.layer.remove(shape);
        this.rendered.delete(shape);
      },
      { budget: 4, cancelled },
    );
    if (cancelled()) return;
    this.markers.removeAll();
    const hospital = (id: string) => state.hospitals.find((h) => h.id === id)!;
    const color = (id: string) => {
      const h = hospital(id);
      return state.mode === "load" ? V.COLORS[V.loadBand(h.per1000)] : h.color;
    };
    for (const h of state.hospitals) {
      const marker = new this.api.Placemark(
        h.coords,
        { hintContent: escape(h.name) },
        { preset: "islands#dotIcon", iconColor: color(h.id), zIndex: 500 },
      );
      marker.events.add("click", () => this.store.select(h.id));
      this.markers.add(marker);
    }
    const items =
      state.mode === "travel"
        ? this.store.cells
        : [...this.store.zones].flatMap(([organizationId, parts]) =>
            parts.map((geometry) => ({ organizationId, geometry, id: "" })),
          );
    await jobs.chunks(
      items,
      (item) => {
        const h = hospital(item.organizationId),
          value = state.mode === "travel"
            ? this.store.times.get(item.id)?.[state.transport]
            : undefined,
          seconds =
            state.mode === "travel"
              ? (value?.seconds ?? null)
              : null;
        const c =
          state.mode === "travel"
            ? A.COLORS[A.displayBand(state.transport, seconds)]
            : color(h.id);
        const shape = new this.api.Polygon(
          item.geometry.map((ring) => ring.map(([lon, lat]) => [lat, lon])),
          {
            hintContent: escape(
              state.mode === "travel"
                ? h.name + " - " +
                  (value && ["neighbor", "distance"].includes(value.source) ? "≈ " : "") +
                  V.minutes(seconds) +
                  (value?.source === "neighbor" ? " (по соседям)" :
                    value?.source === "distance" ? " (по расстоянию)" : "")
                : h.name,
            ),
          },
          {
            fillColor: c,
            fillOpacity: state.mode === "travel" ? 0.5 : 0.4,
            strokeColor: c,
            strokeWidth: state.mode === "travel" ? 0.4 : 1,
            strokeOpacity: 0.8,
            zIndex: 100,
          },
        );
        shape.events.add("click", () => this.store.select(h.id));
        this.layer.add(shape);
        this.rendered.add(shape);
      },
      { budget: 4, cancelled },
    );
  }
  dispose() {
    this.token++;
    this.rendered.clear();
    this.release?.();
    this.host.destroy();
    this.map = null;
  }
}
