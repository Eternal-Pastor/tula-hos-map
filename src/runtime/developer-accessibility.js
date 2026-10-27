import { runAccessibilityTask } from "../services/worker-client";
import { createCompletionCache } from "./developer-completion.js";

/** Координатор расчётов. Состояние элементов публикуется в headless store. */
export function createDeveloperAccessibility(ui) {
  const root = window;
  ("use strict");
  const A = root.HospitalAccessibility,
    O = root.HospitalRoutingOSRM;
  const $ = ui.get,
    esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const minutes = (s) =>
    s === null
      ? "нет данных"
      : (s / 60).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " мин";
  const LOCAL_SERVICES = {
    auto: "http://localhost:5000/route/v1/driving",
    pedestrian: "http://localhost:5001/route/v1/foot",
  };
  function validateSettings(s = {}) {
    if (!s || typeof s !== "object")
      throw new Error("Некорректные настройки доступности.");
    let servers = { ...LOCAL_SERVICES };
    try {
      const next = O.config(s.osrm);
      if (
        Object.values(next).every((url) =>
          ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
        )
      )
        servers = next;
    } catch (_) {}
    return {
      gridPreset: "full-region-v2",
      routingPreset: "local-full-v2",
      source: "osrm",
      osrm: servers,
      model: { ...A.MODEL },
      enabled: true,
      mode: s.mode === "pedestrian" ? "pedestrian" : "auto",
      step: [5000, 10000, 20000].includes(s.step) ? s.step : 5000,
      scope: "all",
      shape: "cells",
      lines: false,
      fillMissing: "same-hospital-idw4-v1",
    };
  }
  function create({
    context,
    persist,
    notify,
    onChange,
    beforeRun = async () => {},
  }) {
    const records = new Map(),
      unsaved = new Map(),
      knownIds = new Set(context().organizations.map((o) => o.id));
    let options = validateSettings(),
      cells = [],
      gridStamp = "",
      failedStamp = "",
      gridPromise = null,
      gridError = "",
      recordRevision = 0;
    let disposed = false,
      cancelGrid = () => {},
      running = false,
      controller = null,
      message = "",
      stage = "",
      done = 0,
      total = 0,
      lastRun = false,
      worker = null,
      workerId = 0;
    let mapRef = null,
      cellLayer = null,
      lineLayer = null,
      drawStamp = "",
      drawToken = 0,
      selectedCell = null;
    const rendered = new Set();
    try {
      options = validateSettings(
        JSON.parse(localStorage.getItem("hospital-map-accessibility") || "{}"),
      );
    } catch (_) {}
    const save = () => {
      if (disposed) return;
      try {
        localStorage.setItem(
          "hospital-map-accessibility",
          JSON.stringify(options),
        );
      } catch (_) {}
    };
    const destinations = () =>
      new Map([...context().destinations].filter(([, p]) => A.validPoint(p)));
    const wantedGrid = () => JSON.stringify([context().revision, options.step]);
    const jobs = () => [
      ...new Map(
        A.pending(cells, destinations(), records, O.MODES, options.osrm).map(
          (j) => [j.key, j],
        ),
      ).values(),
    ];
    const emptyTimes = {
      values: new Map(),
      summary: Object.fromEntries(
        O.MODES.map((mode) => [
          mode,
          { measured: 0, neighbor: 0, distance: 0, missing: 0 },
        ]),
      ),
      method: "same-hospital-idw4-v1",
    };
    const fillCache = createCompletionCache({
      input: () => ({
        stamp: JSON.stringify([
          gridStamp,
          recordRevision,
          [...destinations()],
          options.osrm,
        ]),
        payload: {
          cells,
          destinations: destinations(),
          records,
          services: options.osrm,
        },
      }),
      run: (payload, signal) =>
        runAccessibilityTask("complete", payload, signal),
      onResult: () => {
        if (disposed) return;
        drawStamp = "";
        sync();
        draw();
        if (selectedCell && $("access-cell-dialog").open) showCell();
      },
      onError: () => {
        if (!disposed) sync();
      },
    });
    function completedTimes() {
      return cells.length ? fillCache.read() : emptyTimes;
    }
    function workerGrid(zones, step) {
      const id = ++workerId;
      return new Promise((resolve, reject) => {
        try {
          worker = new Worker(
            new URL("workers/accessibility.js", document.baseURI),
          );
        } catch (error) {
          return reject(error);
        }
        const own = worker,
          finish = () => {
            own.terminate();
            if (worker === own) worker = null;
            cancelGrid = () => {};
          };
        cancelGrid = () => {
          finish();
          reject(new DOMException("Остановлено", "AbortError"));
        };
        own.onerror = (event) => {
          event.preventDefault?.();
          finish();
          reject(
            new Error(
              "Не удалось построить сетку в фоне. Перезагрузите страницу через localhost.",
            ),
          );
        };
        own.onmessage = (event) => {
          if (event.data.id !== id) return;
          finish();
          event.data.error
            ? reject(new Error(event.data.error))
            : resolve(event.data.result);
        };
        own.postMessage({ id, task: "grid", payload: { zones, step } });
      });
    }
    async function ensureGrid() {
      if (disposed) return false;
      if (gridPromise) {
        await gridPromise;
        return gridStamp === wantedGrid() ? true : ensureGrid();
      }
      const stamp = wantedGrid(),
        c = context();
      if (gridStamp === stamp) return true;
      if (c.pending || !c.zones.size) return false;
      gridError = "";
      sync();
      gridPromise = (async () => {
        try {
          const result = await workerGrid(c.zones, options.step);
          if (disposed || stamp !== wantedGrid()) return false;
          cells = result.cells;
          gridStamp = stamp;
          failedStamp = "";
          selectedCell = null;
          fillCache.retry();
          drawStamp = "";
          return true;
        } catch (error) {
          failedStamp = stamp;
          gridError = error.message;
          throw error;
        }
      })();
      try {
        return await gridPromise;
      } finally {
        gridPromise = null;
        sync();
        draw();
      }
    }
    function sync() {
      if (disposed) return;
      $("access-step").value = options.step;
      $("access-step").disabled = running;
      $("access-calculate").disabled =
        running || (!context().zones.size && !context().pending);
      $("access-calculate").textContent = running
        ? "Выполняется полный расчёт…"
        : "Рассчитать всю область";
      $("access-stop").hidden = !running;
      $("access-progress").hidden = !running && !lastRun;
      const bar = $("access-progress");
      if (running && ["coverage", "grid"].includes(stage))
        bar.value = undefined;
      else {
        bar.max = Math.max(total, 1);
        bar.value = done;
      }
      const result = completedTimes(),
        s = (result || emptyTimes).summary;
      $("access-summary").textContent = cells.length
        ? `Ячеек: ${cells.length.toLocaleString("ru-RU")} · больниц: ${new Set(cells.map((c) => c.organizationId)).size}`
        : "Готовим сетку по сохранённым зонам…";
      ui.setData(
        "access-results",
        O.MODES.map((mode) => {
          const a = s[mode];
          return {
            mode,
            label: A.LABELS[mode],
            count: a.measured + a.neighbor + a.distance,
            total: cells.length,
            ...a,
          };
        }),
      );
      const missing = jobs().length;
      $("access-status").textContent =
        gridError ||
        fillCache.error?.message ||
        message ||
        (gridPromise
          ? "Строим сетку в фоне…"
          : !cells.length
            ? "Загрузите копию проекта с адресами и зонами."
            : !result
              ? "Заполняем времена в фоне…"
              : missing
                ? `Не запрошено маршрутов: ${missing.toLocaleString("ru-RU")}. Показаны предварительные оценки.`
                : "Все маршруты проверены. Пропуски заполнены оценками.");
      $("access-fill-note").textContent =
        "≈ — оценка по ближайшим рассчитанным ячейкам той же больницы. Если таких ячеек нет, используется оценка по расстоянию. Это не подтверждение наличия маршрута.";
      $("access-legend").hidden = !cells.length;
      $("access-legend-mode").textContent = A.LABELS[options.mode];
      const active = s[options.mode];
      $("access-legend-detail").textContent =
        `OSRM: ${active.measured} · по соседям: ≈ ${active.neighbor}${active.distance ? " · по расстоянию: ≈ " + active.distance : ""}`;
      $("access-legend-method").textContent =
        (options.mode === "pedestrian"
          ? "Цветом показана доступность до 60 минут включительно. Более долгие пути и ячейки без времени показаны серым. "
          : "Время до закреплённой больницы. ") +
        "Нажмите на ячейку, чтобы увидеть источник значения.";
      ui.setData("access-active", true);
      $("travel-mode").value = options.mode;
    }
    function refresh() {
      if (disposed) return;
      const c = context();
      if (mapRef !== c.map) {
        mapRef = c.map;
        cellLayer = null;
        lineLayer = null;
        rendered.clear();
        drawStamp = "";
        drawToken++;
        if (mapRef) {
          cellLayer = new c.ym.GeoObjectCollection();
          lineLayer = new c.ym.GeoObjectCollection();
          mapRef.geoObjects.add(cellLayer).add(lineLayer);
        }
      }
      sync();
      if (
        !running &&
        !c.pending &&
        c.zones.size &&
        gridStamp !== wantedGrid() &&
        failedStamp !== wantedGrid()
      )
        ensureGrid()
          .then(() => {
            if (gridStamp !== wantedGrid()) refresh();
          })
          .catch(() => sync());
      draw();
    }
    function draw() {
      drawNow().catch((error) => {
        if (disposed || error.name === "AbortError") return;
        message = "Не удалось показать время на карте: " + error.message;
        sync();
      });
    }
    async function drawNow() {
      if (disposed || !mapRef || !cellLayer) return;
      const c = context(),
        stamp = JSON.stringify([
          c.epoch,
          gridStamp,
          recordRevision,
          options.mode,
          [...destinations()],
        ]);
      if (stamp === drawStamp) return;
      drawStamp = stamp;
      const token = ++drawToken,
        layer = cellLayer;
      if (gridStamp !== wantedGrid()) return;
      const result = await fillCache.ensure();
      if (disposed || token !== drawToken) return;
      lineLayer?.removeAll();
      // Removing thousands of SDK polygons at once blocks the browser too.
      await root.HospitalZoneJobs.chunks(
        [...rendered],
        (polygon) => {
          layer.remove(polygon);
          rendered.delete(polygon);
        },
        { budget: 4, cancelled: () => disposed || token !== drawToken },
      );
      if (disposed || token !== drawToken || gridStamp !== wantedGrid()) return;
      await root.HospitalZoneJobs.chunks(
        cells,
        (cell) => {
          const value = result.values.get(cell.id)[options.mode];
          const name = c.organizations.find(
              (o) => o.id === cell.organizationId,
            )?.shortName,
            color = A.COLORS[A.displayBand(options.mode, value.seconds)];
          const polygon = new c.ym.Polygon(
            cell.geometry.map((r) => r.map(([lon, lat]) => [lat, lon])),
            {
              hintContent:
                esc(name) +
                " · " +
                (value.source === "osrm" ? "" : "≈ ") +
                minutes(value.seconds),
            },
            {
              fillColor: color,
              fillOpacity: 0.48,
              strokeColor: color,
              strokeOpacity: 0.6,
              strokeWidth: 1,
              zIndex: 240,
            },
          );
          polygon.events.add("click", () => {
            selectedCell = cell;
            showCell();
          });
          layer.add(polygon);
          rendered.add(polygon);
        },
        { cancelled: () => disposed || token !== drawToken },
      );
    }
    function showCell() {
      showCellNow().catch((error) => {
        if (!disposed && error.name !== "AbortError") {
          message = error.message;
          sync();
        }
      });
    }
    async function showCellNow() {
      if (disposed || !selectedCell) return;
      const cell = selectedCell,
        completed = await fillCache.ensure();
      if (disposed || selectedCell !== cell) return;
      const c = context(),
        name = c.organizations.find(
          (o) => o.id === cell.organizationId,
        )?.shortName,
        result = completed.values.get(cell.id);
      if (!result) return;
      $("access-cell-title").textContent = name;
      $("access-cell-origin").textContent =
        `Точка ячейки: ${selectedCell.origin.map((v) => v.toFixed(5)).join(", ")}`;
      const source = (value) =>
        value.source === "osrm"
          ? "Маршрут OSRM"
          : value.source === "neighbor"
            ? `Оценка по ${value.donors.length} соседним ячейкам той же больницы; ближайшая — ${(value.nearestMeters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`
            : value.source === "distance"
              ? "Резервная оценка по расстоянию"
              : "Нет координат больницы";
      ui.setData(
        "access-cell-times",
        O.MODES.map((mode) => {
          const v = result[mode];
          return {
            mode: A.LABELS[mode],
            minutes: (v.source === "osrm" ? "" : "≈ ") + minutes(v.seconds),
            source: source(v),
            unreachable: v.routeStatus === "unreachable",
          };
        }),
      );
      $("access-cell-method").textContent =
        "Оценки заполняют цветовую карту и не подменяют исходные ответы OSRM. Для ненайденного пути линия маршрута не создаётся.";
      lineLayer?.removeAll();
      const raw = A.cellRoutes(
        selectedCell,
        destinations().get(selectedCell.organizationId),
        records,
        options.osrm,
      )[options.mode];
      if (mapRef && raw?.status === "found" && A.visibleTime(options.mode, raw.seconds))
        for (const line of raw.lines)
          lineLayer.add(
            new c.ym.Polyline(
              line,
              { hintContent: name },
              {
                strokeColor: "#243f36",
                strokeWidth: 4,
                strokeOpacity: 0.9,
                zIndex: 400,
              },
            ),
          );
      if (!$("access-cell-dialog").open) $("access-cell-dialog").showModal();
    }
    async function calculate() {
      if (running) return;
      running = true;
      controller = new AbortController();
      const signal = controller.signal;
      stage = "coverage";
      message = "Готовим полное покрытие области…";
      done = 0;
      total = 0;
      lastRun = false;
      sync();
      try {
        await beforeRun(signal);
        if (signal.aborted) throw new DOMException("Остановлено", "AbortError");
        stage = "grid";
        message = "Строим сетку для всей области…";
        sync();
        if (!(await ensureGrid()))
          throw new Error(
            "Дождитесь восстановления зон или загрузите резервную копию.",
          );
        const dest = destinations();
        if (cells.some((c) => !dest.has(c.organizationId)))
          throw new Error(
            "Для части больниц не заданы координаты места приёма.",
          );
        if (unsaved.size) {
          if ((await persist([...unsaved.values()])) === false)
            throw new Error("Не удалось сохранить результаты в браузере.");
          unsaved.clear();
        }
        const all = [
            ...new Map(
              A.pending(cells, dest, new Map(), O.MODES, options.osrm).map(
                (j) => [j.key, j],
              ),
            ).values(),
          ],
          queue = all.filter((j) => !records.has(j.key));
        total = all.length;
        done = total - queue.length;
        stage = "routes";
        let cursor = 0,
          failure = null,
          buffer = [],
          saving = Promise.resolve(),
          lastPaint = 0;
        const flush = () => {
          if (!buffer.length) return;
          const batch = buffer;
          buffer = [];
          saving = saving
            .then(async () => {
              if ((await persist(batch)) === false)
                throw new Error(
                  "Не удалось сохранить результаты в браузере. Скачайте резервную копию.",
                );
              for (const item of batch) unsaved.delete(item.key);
            })
            .catch((error) => {
              failure = failure || error;
              controller.abort();
            });
        };
        const progress = () => {
          message = `Маршруты: ${done.toLocaleString("ru-RU")} / ${total.toLocaleString("ru-RU")} · ${Math.floor((done / Math.max(total, 1)) * 100)}%`;
          sync();
        };
        progress();
        async function routeWorker() {
          while (!signal.aborted) {
            const job = queue[cursor++];
            if (!job) return;
            try {
              const result = await O.requestRoute(
                options.osrm[job.mode],
                job,
                signal,
              );
              const item = A.record(
                {
                  type: "route",
                  organizationId: job.cell.organizationId,
                  origin: job.cell.origin,
                  destination: job.destination,
                  mode: job.mode,
                  ...result,
                  at: new Date().toISOString(),
                },
                knownIds,
              );
              if (!item) throw new Error("Некорректный ответ маршрутизатора.");
              records.set(item.key, item);
              unsaved.set(item.key, item);
              buffer.push(item);
              recordRevision++;
              done++;
              if (buffer.length >= 50) flush();
              if (Date.now() - lastPaint > 250) {
                lastPaint = Date.now();
                progress();
              }
            } catch (error) {
              if (error.name !== "AbortError") failure = failure || error;
              controller.abort();
            }
          }
        }
        await Promise.all(Array.from({ length: 4 }, routeWorker));
        flush();
        await saving;
        if (failure) throw failure;
        if (signal.aborted) throw new DOMException("Остановлено", "AbortError");
        stage = "fill";
        message = "Заполняем оставшиеся ячейки по соседям…";
        fillCache.retry();
        sync();
        const result = await fillCache.ensure();
        if (signal.aborted) throw new DOMException("Остановлено", "AbortError");
        if (O.MODES.some((mode) => result.summary[mode].missing))
          throw new Error(
            "Для полного заполнения нужны координаты всех больниц.",
          );
        lastRun = true;
        done = total;
        message =
          "Полный расчёт завершён. Все ячейки заполнены; результаты сохранены локально.";
      } catch (error) {
        message =
          error.name === "AbortError"
            ? "Расчёт остановлен. Найденные маршруты сохранены; повторный запуск продолжит оставшиеся."
            : "Расчёт приостановлен: " + error.message;
      } finally {
        running = false;
        controller = null;
        fillCache.retry();
        drawStamp = "";
        save();
        refresh();
        onChange();
      }
    }
    $("access-calculate").onclick = calculate;
    $("access-stop").onclick = () => controller?.abort();
    $("access-step").onchange = () => {
      options.step = Number($("access-step").value);
      gridError = "";
      failedStamp = "";
      lastRun = false;
      message = "";
      selectedCell = null;
      save();
      refresh();
      onChange();
    };
    $("access-cell-close").onclick = () => {
      $("access-cell-dialog").close();
      selectedCell = null;
      lineLayer?.removeAll();
    };
    $("travel-mode").onchange = () => {
      options.mode = $("travel-mode").value;
      save();
      drawStamp = "";
      refresh();
      if ($("access-cell-dialog").open) showCell();
    };
    sync();
    return {
      refresh,
      dispose() {
        if (disposed) return;
        disposed = true;
        controller?.abort();
        cancelGrid();
        worker?.terminate();
        worker = null;
        fillCache.dispose();
        drawToken++;
        cellLayer?.removeAll();
        lineLayer?.removeAll();
        rendered.clear();
        mapRef = null;
        cellLayer = null;
        lineLayer = null;
      },
      stop: () => controller?.abort(),
      get enabled() {
        return true;
      },
      get busy() {
        return running;
      },
      settings: () => validateSettings(options),
      restoreSettings(value) {
        controller?.abort();
        options = validateSettings(value);
        failedStamp = "";
        gridError = "";
        fillCache.retry();
        save();
        refresh();
      },
      records: () => [...records.values()],
      restore(values, { replace = false } = {}) {
        if (replace) {
          records.clear();
          unsaved.clear();
        }
        for (const value of values || []) {
          const r = A.record(value, knownIds);
          if (r) records.set(r.key, r);
        }
        recordRevision++;
        fillCache.retry();
        refresh();
      },
    };
  }
  return { create, validateSettings };
}
