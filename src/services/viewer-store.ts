import { accessibility as A, routing } from "./engine";
import {
  unpackSnapshot,
  ViewerRouteStorage,
  readViewerSettings,
  writeViewerSettings,
} from "./viewer-data";
import { runAccessibilityTask } from "./worker-client";
import { runRoutes } from "./route-runner";
import type {
  Cell,
  CompletedTime,
  Hospital,
  MapMode,
  Polygon,
  RouteRecord,
  TravelMode,
  ViewerSettings,
  ViewerSnapshot,
  YandexPoint,
} from "../types/domain";

export interface ViewerState extends ViewerSettings {
  page: "map" | "table";
  hospitals: Hospital[];
  selected: string | null;
  loading: boolean;
  busy: boolean;
  gridBusy: boolean;
  error: string | null;
  count: number;
  total: number;
  status: string;
  revision: number;
}
export class ViewerStore {
  private state: ViewerState = {
    ...readViewerSettings(window.HospitalViewerData.checksum),
    page: "map",
    hospitals: [],
    selected: null,
    loading: true,
    busy: false,
    gridBusy: false,
    error: null,
    count: 0,
    total: 0,
    status: "",
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = false;
  private gridController?: AbortController;
  private fillController?: AbortController;
  private calculation?: AbortController;
  private storage = new ViewerRouteStorage(window.HospitalViewerData.checksum);
  private snapshot?: ViewerSnapshot;
  readonly records = new Map<string, RouteRecord>();
  destinations = new Map<string, YandexPoint>();
  zones = new Map<string, Polygon[]>();
  cells: Cell[] = [];
  times = new Map<string, Record<TravelMode, CompletedTime>>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(patch: Partial<ViewerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private save() {
    const { mode, transport, step, checksum } = this.state;
    writeViewerSettings({ mode, transport, step, checksum });
  }
  async start() {
    this.active = true;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const snapshot = await unpackSnapshot(window.HospitalViewerData);
      if (generation !== this.generation) return;
      this.snapshot = snapshot;
      const hospitals = snapshot.hospitals
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      this.destinations = new Map(hospitals.map((h) => [h.id, h.coords]));
      this.zones = new Map(snapshot.zones);
      this.records.clear();
      snapshot.routes.forEach((record) => this.records.set(record.key, record));
      try {
        const known = new Set(hospitals.map((h) => h.id));
        const local = await this.storage.read();
        if (generation !== this.generation) return;
        for (const record of local) {
          const valid = A.record(record, known);
          if (
            valid &&
            Object.values(snapshot.services).includes(valid.routingService!) &&
            this.destinations
              .get(valid.organizationId)
              ?.every((value, i) => value === valid.destination[i])
          )
            this.records.set(valid.key, valid);
        }
      } catch {
        /* Снимок остаётся доступен при недоступном IndexedDB. */
      }
      if (generation !== this.generation) return;
      this.update({ hospitals });
      await this.changeGrid(this.state.step);
      if (generation === this.generation) this.update({ loading: false });
    } catch (error) {
      if (generation === this.generation)
        this.update({
          loading: false,
          error: String((error as Error).message),
        });
    }
  }
  dispose() {
    this.active = false;
    this.generation++;
    this.gridController?.abort();
    this.fillController?.abort();
    this.calculation?.abort();
    // Дать runner записать последнюю неполную порцию после abort.
    if (!this.calculation) this.storage.close();
  }
  setPage(page: ViewerState["page"]) {
    this.update({ page });
  }
  setMode(mode: MapMode) {
    this.update({ mode, revision: this.state.revision + 1 });
    this.save();
  }
  setTransport(transport: TravelMode) {
    this.update({ transport, revision: this.state.revision + 1 });
    this.save();
  }
  select(selected: string | null) {
    this.update({ selected, ...(selected ? { page: "map" as const } : {}) });
  }
  clearError() {
    this.update({ error: null });
  }
  private async fill() {
    if (!this.snapshot) return;
    this.fillController?.abort();
    const controller = new AbortController();
    this.fillController = controller;
    const all = new Map(this.snapshot.cells.map((cell) => [cell.id, cell]));
    this.cells.forEach((cell) => all.set(cell.id, cell));
    const result = await runAccessibilityTask<{
      values: Map<string, Record<TravelMode, CompletedTime>>;
    }>(
      "complete",
      {
        cells: [...all.values()],
        destinations: this.destinations,
        records: this.records,
        services: this.snapshot.services,
      },
      controller.signal,
    );
    this.times = new Map(
      this.cells.map((cell) => [cell.id, result.values.get(cell.id)!]),
    );
    this.update({ revision: this.state.revision + 1 });
  }
  async changeGrid(step: number) {
    if (!this.snapshot || this.state.busy) return;
    this.gridController?.abort();
    const controller = new AbortController();
    this.gridController = controller;
    this.update({ step, gridBusy: true, error: null });
    this.save();
    try {
      const result =
        step === this.snapshot.step
          ? { cells: this.snapshot.cells }
          : await runAccessibilityTask<{ cells: Cell[] }>(
              "grid",
              { zones: this.zones, step },
              controller.signal,
            );
      if (controller.signal.aborted) return;
      this.cells = result.cells;
      await this.fill();
    } catch (error) {
      if (!controller.signal.aborted)
        this.update({
          error: "Не удалось построить сетку. " + (error as Error).message,
        });
    } finally {
      if (!controller.signal.aborted) this.update({ gridBusy: false });
    }
  }
  stop = () => this.calculation?.abort();
  async calculate() {
    if (!this.snapshot || this.calculation || this.state.gridBusy) return;
    const generation = this.generation,
      controller = new AbortController();
    this.calculation = controller;
    this.update({ busy: true, error: null, status: "" });
    try {
      const jobs = A.pending(
        this.cells,
        this.destinations,
        new Map(),
        ["auto", "pedestrian"],
        this.snapshot.services,
      );
      const result = await runRoutes({
        jobs,
        records: this.records,
        knownIds: new Set(this.state.hospitals.map((h) => h.id)),
        services: this.snapshot.services,
        signal: controller.signal,
        saveBatch: (batch) => this.storage.write(batch),
        requestRoute: routing.requestRoute,
        normalize: A.record,
        onProgress: (count, total) => {
          if (generation === this.generation)
            this.update({
              count,
              total,
              status: `${count.toLocaleString("ru-RU")} / ${total.toLocaleString("ru-RU")} · ${Math.round((count / Math.max(total, 1)) * 100)}%`,
            });
        },
      });
      if (generation === this.generation)
        this.update({
          status: result.stopped ? "Остановлено" : "Готово · 100%",
        });
    } catch (error) {
      if (generation === this.generation)
        this.update({
          status: "Расчёт приостановлен. Результаты доступны на карте.",
          error:
            "Не удалось завершить расчёт. Проверьте локальные OSRM. " +
            (error as Error).message,
        });
    } finally {
      this.calculation = undefined;
      if (!this.active) this.storage.close();
      if (generation === this.generation) {
        this.update({ busy: false });
        try {
          await this.fill();
        } catch (error) {
          if ((error as Error).name !== "AbortError")
            this.update({ error: "Не удалось обновить карту." });
        }
      }
    }
  }
}
