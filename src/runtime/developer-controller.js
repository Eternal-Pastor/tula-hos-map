import { createDeveloperAccessibility } from "./developer-accessibility.js";
import { loadDeveloperYandex } from "./developer-yandex.js";

/** Calculation/storage coordinator. It publishes headless view state; React owns the UI. */
export function mountDeveloperController(ui, mapHost, tables) {
  let disposed = false;
  const lifecycle = new AbortController();
  const timeouts = new Set(),
    intervals = new Set(),
    objectUrls = new Set();
  let tableUpdateTimer;
  const setTimeout = (callback, delay) => {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      callback();
    }, delay);
    timeouts.add(id);
    return id;
  };
  const clearTimeout = (id) => {
    timeouts.delete(id);
    window.clearTimeout(id);
  };
  const setInterval = (callback, delay) => {
    const id = window.setInterval(callback, delay);
    intervals.add(id);
    return id;
  };
  const clearInterval = (id) => {
    intervals.delete(id);
    window.clearInterval(id);
  };
  const AccessibilityUI = createDeveloperAccessibility(ui);
  let mapSdkRelease = () => {};

  ("use strict");
  const data = window.HOSPITAL_DATA,
    C = window.HospitalCore,
    T = window.HospitalTerritories,
    L = window.HospitalLocalCache,
    J = window.HospitalZoneJobs,
    B = window.HospitalBackup;
  const $ = ui.get;
  const esc = (v) =>
    String(v == null ? "" : v).replace(
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
  const fmt = (v, d = 0) =>
    v === null || v === undefined
      ? "нет данных"
      : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d });
  const defaults = {
    selectedOrganization: null,
    showZones: true,
    showAddressPoints: false,
    fullCoverage: false,
    mapColor: "organization",
    metric: "per1000",
    includeMixed: false,
    showEmpty: false,
    populationLinks: {},
    populationValues: {},
    coordinates: {},
    coordinateVersions: {},
    geojson: [],
  };
  let settings = { ...defaults },
    selected = null,
    map = null,
    ym = null,
    sessionKey = "",
    geoKey = "",
    routingKey = "",
    loadedKey = "",
    busy = false,
    cancelRequested = false,
    toastTimer,
    bulkActive = false,
    cacheProblem = null,
    cacheReady = Promise.resolve();
  let orgLayer, ruleLayer, geometryLayer, zoneLayer, bounds;
  const zoneGeometryCache = new Map();
  let addressRevision = 0,
    requestedRevision = -1,
    requestedGeometry = null,
    partitionRevision = 0,
    fitPending = false,
    mapEpoch = 0,
    zoneDrawing = false,
    mapDrawError = "";
  let partitionResult = {
    zones: new Map(),
    sharedAnchors: 0,
    importedConflicts: 0,
  };
  let savedZoneSnapshot = null,
    zoneSnapshotInput = null,
    zoneStorageState = "loading",
    zoneSource = "",
    localLoaded = false;
  let savedCoverageSnapshot = null,
    coverageResult = null,
    coverageInput = null,
    coverageSignature = "",
    coverageError = "",
    coverageProgress = null,
    coverageStarted = 0,
    coverageUpdated = 0,
    coverageTimer = null,
    coverageSaving = false,
    coverageResetting = false;
  let mapLoadState = "waiting",
    restoreDrawn = 0,
    restoreTotal = 0,
    restoreVectorsReady = false;
  let calculationProgress = null,
    calculationStarted = 0,
    calculationUpdated = 0,
    calculationTimer = null;
  const layerStamps = {},
    layerTokens = {},
    layerPromises = {},
    activeRequests = new Set();
  const orgLocations = new Map(),
    geocodeCache = new Map(),
    ruleLocations = new Map(),
    ruleAttempts = new Set(),
    ruleFailures = new Map();
  const territoryIndex = T.index(data),
    organizationColors = T.colors(data.organizations.map((o) => o.id));
  const partitionJobs = J.create({
    makeWorker: () => new Worker(new URL("workers/zones.js", document.baseURI)),
    onResult: async (message) => {
      if (disposed) return;
      partitionResult = message.error
        ? { ...partitionResult, error: message.error }
        : message.result;
      partitionRevision++;
      if (zoneSnapshotInput?.key === message.key)
        restoreVectorsReady = !message.error;
      if (!message.error && zoneSnapshotInput?.key === message.key) {
        savedZoneSnapshot = L.zoneSnapshot(
          zoneSnapshotInput.signature,
          message.result,
        );
        zoneSource = "calculated";
        zoneStorageState = "saving";
        persistLocal([savedZoneSnapshot]).then((ok) => {
          zoneStorageState = ok ? "saved" : "failed";
          showCacheStatus();
          updateTopologyNote();
        });
      }
      if (!$("bulk-progress").hidden) updateBulkProgress();
      if (selected) renderDetail(getOrg(selected));
      await renderMap();
      if (fitPending) {
        fitPending = false;
        fitMap(false);
      }
    },
    onProgress: (message) => {
      if (zoneSnapshotInput?.key !== message.key) return;
      calculationProgress = message.progress;
      calculationUpdated = Date.now();
      updateRestoreProgress();
    },
    onError: (error) => {
      partitionResult = {
        ...partitionResult,
        error: String(error.message || error),
      };
      partitionRevision++;
      renderMap();
    },
    onStatus: () => {
      if (disposed) return;
      updateTopologyNote();
      if (!$("bulk-progress").hidden) updateBulkProgress();
      accessibility.refresh();
      if (partitionJobs.busy && !calculationTimer) {
        calculationStarted = calculationUpdated = Date.now();
        calculationTimer = setInterval(updateRestoreProgress, 1000);
      }
      if (!partitionJobs.busy && calculationTimer) {
        clearInterval(calculationTimer);
        calculationTimer = null;
      }
      updateRestoreProgress();
      if (localLoaded && !partitionJobs.busy) renderMap();
    },
  });
  const coverageJobs = J.create({
    makeWorker: () => new Worker(new URL("workers/zones.js", document.baseURI)),
    onResult: async (message) => {
      if (disposed) return;
      if (message.key !== coverageInput?.key) return;
      if (message.error) {
        coverageError = message.error;
        return;
      }
      coverageResult = message.result;
      partitionRevision++;
      savedCoverageSnapshot = {
        ...L.zoneSnapshot(coverageInput.signature, coverageResult),
        key: "geometry:coverage-v1",
      };
      coverageSaving = true;
      await persistLocal([savedCoverageSnapshot]);
      coverageSaving = false;
      if (disposed) return;
      if (!$("bulk-progress").hidden) updateBulkProgress();
      if (selected) renderDetail(getOrg(selected));
      await renderMap();
      if (map) fitMap(false);
    },
    onProgress: (message) => {
      if (message.key === coverageInput?.key) {
        coverageProgress = message.progress;
        coverageUpdated = Date.now();
        updateCoverageStatus();
      }
    },
    onError: (error) => {
      coverageError = String(error.message || error);
      updateCoverageStatus();
    },
    onStatus: () => {
      if (disposed) return;
      if (coverageJobs.busy && !coverageTimer)
        coverageTimer = setInterval(updateCoverageStatus, 1000);
      if (!coverageJobs.busy && coverageTimer) {
        clearInterval(coverageTimer);
        coverageTimer = null;
      }
      updateCoverageStatus();
      if (localLoaded && !coverageJobs.busy && !coverageResetting) renderMap();
    },
  });
  try {
    const saved = JSON.parse(
      localStorage.getItem("hospital-map-settings") || "null",
    );
    if (saved) settings = validateSettings(saved);
  } catch (_) {}
  selected = settings.selectedOrganization;
  settings.showEmpty = true;
  settings.showZones = true;
  settings.showAddressPoints = false;
  selected = null;
  settings.selectedOrganization = null;

  const accessibility = AccessibilityUI.create({
    context: () => ({
      map,
      ym,
      routingKey,
      epoch: mapEpoch,
      zones: activePartition().zones,
      revision: partitionRevision,
      pending:
        partitionJobs.busy || (settings.fullCoverage && coverageJobs.busy),
      organizations: data.organizations,
      selected,
      visible: listed().map((o) => o.id),
      destinations: new Map(
        data.organizations.map((o) => [o.id, locationFor(o.id)?.coords]),
      ),
    }),
    persist: persistLocal,
    notify: toast,
    onChange: () => renderMap(),
    download,
    beforeRun: prepareFullCalculation,
    onRoutingKeyRequired: () => {
      $("access-cell-dialog").close();
      openSettings();
      ui.setStatus(
        "key-status",
        "Для расчёта маршрутов заполните третье поле: «Ключ API получения деталей маршрута». Ключ карты и ключ геокодера его не заменяют.",
        "error",
      );
      $("routing-key").focus();
    },
  });
  async function prepareFullCalculation(signal) {
    await cacheReady;
    if (disposed || signal.aborted)
      throw new DOMException("Остановлено", "AbortError");
    settings.showEmpty = true;
    settings.showZones = true;
    $("org-search").value = "";
    selected = null;
    $("detail-panel").hidden = true;
    if (!settings.fullCoverage) await enableCoverage({ forCalculation: true });
    if (disposed || signal.aborted)
      throw new DOMException("Остановлено", "AbortError");
    if (!settings.fullCoverage)
      throw new Error(
        "Не удалось подготовить полное покрытие. Проверьте локальное сохранение.",
      );
    const started = Date.now();
    renderMap();
    while (partitionJobs.busy || coverageJobs.busy || !coverageResult) {
      if (signal.aborted) throw new DOMException("Остановлено", "AbortError");
      if (coverageError || partitionResult.error)
        throw new Error(coverageError || partitionResult.error);
      if (Date.now() - started > 180000)
        throw new Error(
          "Подготовка границ занимает слишком много времени. Можно повторить запуск без потери данных.",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    save();
    render();
  }

  function validateSettings(s) {
    if (!s || typeof s !== "object")
      throw new Error("Некорректный файл настроек.");
    const out = {
      ...defaults,
      populationLinks: {},
      populationValues: {},
      coordinates: {},
      coordinateVersions: {},
      geojson: [],
    };
    if (data.organizations.some((o) => o.id === s.selectedOrganization))
      out.selectedOrganization = s.selectedOrganization;
    if (["absolute", "perArea", "per1000"].includes(s.metric))
      out.metric = s.metric;
    if (["load", "organization"].includes(s.mapColor))
      out.mapColor = s.mapColor;
    out.showZones = s.showZones !== false;
    out.showAddressPoints = s.showAddressPoints === true;
    out.fullCoverage = s.fullCoverage === true;
    out.includeMixed = s.includeMixed === true;
    out.showEmpty = s.showEmpty === true;
    for (const [id, value] of Object.entries(s.populationValues || {})) {
      if (
        !data.populations.some((p) => p.id === id) ||
        C.number(value) === null ||
        value <= 0
      )
        throw new Error("Недопустимая численность населения.");
      out.populationValues[id] = value;
    }
    for (const [id, value] of Object.entries(s.populationLinks || {})) {
      if (
        !data.organizations.some((o) => o.id === id) ||
        (value !== "" && !data.populations.some((p) => p.id === value))
      )
        throw new Error("Неизвестная связь территории.");
      out.populationLinks[id] = value;
    }
    for (const [id, value] of Object.entries(s.coordinates || {})) {
      if (
        !data.organizations.some((o) => o.id === id) ||
        !Array.isArray(value) ||
        value.length !== 2 ||
        value.some((v) => C.number(v) === null) ||
        Math.abs(value[0]) > 90 ||
        Math.abs(value[1]) > 180
      )
        throw new Error("Некорректные координаты организации.");
      out.coordinates[id] = value;
      if (typeof s.coordinateVersions?.[id] === "string")
        out.coordinateVersions[id] = s.coordinateVersions[id];
    }
    if (s.geojson?.length)
      out.geojson = C.validateGeoJSON(
        { type: "FeatureCollection", features: s.geojson },
        data.organizations.map((o) => o.id),
      );
    return out;
  }
  function save() {
    if (disposed) return;
    settings.selectedOrganization = selected;
    try {
      localStorage.setItem("hospital-map-settings", JSON.stringify(settings));
    } catch (_) {
      toast(
        "Браузер не сохранил настройки. Можно скачать их в разделе «О данных».",
      );
    }
  }
  function toast(message) {
    if (disposed) return;
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 6500);
  }
  function setMessage(message) {
    if (disposed) return;
    $("map-message").textContent = message;
  }
  function updateRestoreProgress() {
    if (disposed) return;
    const panel = $("restore-progress"),
      bar = $("restore-progress-bar");
    if (!panel) return;
    const error = cacheProblem || partitionResult.error || mapDrawError;
    let title,
      label,
      complete = 0,
      indeterminate = false;
    if (error) {
      title = "Восстановление приостановлено";
      label = String(error);
    } else if (!localLoaded) {
      title = "Восстановление · этап 1 из 4";
      label = "Читаем сохранённые адреса и векторы из IndexedDB…";
      indeterminate = true;
    } else if (!restoreVectorsReady || requestedRevision !== addressRevision) {
      title = "Восстановление · этап 2 из 4";
      indeterminate = true;
      complete = 1;
      const names = {
        prepare: "Подготовка больниц",
        imports: "Проверка загруженных границ",
        overlaps: "Поиск перекрывающихся зон",
        triangulation: "Построение триангуляции адресов",
        cells: "Построение адресных ячеек",
        merge: "Объединение фрагментов больниц",
        cleanup: "Удаление остаточных пересечений",
        gap: "Разделение границ",
        verify: "Итоговая проверка отсутствия наложений",
        done: "Подготовка готовых векторов",
      };
      const p = calculationProgress,
        elapsed = calculationStarted
          ? Math.floor((Date.now() - calculationStarted) / 1000)
          : 0,
        quiet = calculationUpdated
          ? Math.floor((Date.now() - calculationUpdated) / 1000)
          : 0;
      label = p
        ? (names[p.stage] || "Расчёт зон") +
          (p.organizationId
            ? " · " + (getOrg(p.organizationId)?.shortName || p.organizationId)
            : "") +
          (p.total ? " · " + fmt(p.completed) + " / " + fmt(p.total) : "")
        : "Запускаем построение векторов по сохранённым адресам…";
      if (p?.operation === "clip-cells")
        label += ` · обрезка ячеек ${fmt(p.fragmentCompleted)} / ${fmt(p.fragmentTotal)}`;
      if (p?.operation === "trace-edges")
        label += ` · сборка границ: ячейки ${fmt(p.fragmentCompleted)} / ${fmt(p.fragmentTotal)}`;
      if (p?.operation === "trace-rings")
        label += ` · сшивание рёбер ${fmt(p.edgeCompleted)} / ${fmt(p.edgeTotal)}`;
      if (p?.operation === "clip-outline")
        label += " · обрезка готовой границы";
      if (p?.operation === "batch-union")
        label += ` · проход ${p.pass}, пакеты ${fmt(p.batchCompleted)} / ${fmt(p.batchTotal)}`;
      label += ` · прошло ${elapsed} с · без обновлений ${quiet} с.`;
      if (quiet >= 30)
        label +=
          " Новых сообщений от расчёта нет; текущая операция может ещё выполняться. Можно перезапустить её без потери адресов.";
    } else if (!map || mapLoadState === "loading") {
      title = "Восстановление · этап 3 из 4";
      label =
        mapLoadState === "loading"
          ? "Подключаем Яндекс Карты…"
          : mapLoadState === "error"
            ? "Карта не подключена. Повторите подключение в настройках."
            : "Локальные данные готовы. Подключите карту для отображения векторов.";
      complete = 2;
      indeterminate = mapLoadState === "loading";
    } else if (zoneDrawing) {
      title = "Восстановление · этап 4 из 4";
      label = `Отрисовка фрагментов зон: ${fmt(restoreDrawn)} / ${fmt(restoreTotal)}${restoreTotal ? " · " + Math.floor((restoreDrawn / restoreTotal) * 100) + "%" : ""}`;
      complete = 3;
    } else {
      title = "Восстановление завершено · 100%";
      label = !settings.showZones
        ? "Векторы восстановлены. Слой «Векторные зоны» выключен."
        : !restoreTotal && partitionResult.zones.size
          ? "Нет видимых зон: проверьте фильтры организаций."
          : !partitionResult.zones.size
            ? "Сохранённых векторных зон пока нет."
            : `На карту добавлено фрагментов: ${fmt(restoreDrawn)} / ${fmt(restoreTotal)}. Геокодер не вызывался.`;
      complete = 4;
    }
    $("restore-progress-title").textContent = title;
    $("restore-progress-label").textContent = label;
    $("restore-progress-counts").textContent = localLoaded
      ? `Адресов: ${fmt(ruleLocations.size)} · векторных зон: ${fmt(activePartition().zones.size)}`
      : "";
    panel.complete = complete === 4;
    panel.error = Boolean(error) || mapLoadState === "error";
    $("restart-zone-calculation").hidden = !(
      localLoaded &&
      (partitionResult.error ||
        (!restoreVectorsReady &&
          calculationStarted &&
          Date.now() - calculationUpdated >= 30000))
    );
    if (
      complete === 1 &&
      ["clip-cells", "trace-edges"].includes(calculationProgress?.operation)
    ) {
      bar.max = Math.max(calculationProgress.fragmentTotal, 1);
      bar.value = calculationProgress.fragmentCompleted;
      indeterminate = false;
    } else if (
      complete === 1 &&
      calculationProgress?.operation === "trace-rings"
    ) {
      bar.max = Math.max(calculationProgress.edgeTotal, 1);
      bar.value = calculationProgress.edgeCompleted;
      indeterminate = false;
    } else if (
      complete === 1 &&
      calculationProgress?.operation === "clip-outline"
    ) {
      indeterminate = true;
    } else if (
      complete === 1 &&
      calculationProgress?.operation === "batch-union"
    ) {
      bar.max = Math.max(calculationProgress.batchTotal, 1);
      bar.value = calculationProgress.batchCompleted;
      indeterminate = false;
    } else if (
      complete === 1 &&
      calculationProgress?.total > 0 &&
      calculationProgress.stage !== "triangulation"
    ) {
      bar.max = calculationProgress.total;
      bar.value = calculationProgress.completed;
      indeterminate = false;
    }
    if (indeterminate) bar.value = undefined;
    else if (complete !== 1 || !calculationProgress?.total) {
      bar.max = zoneDrawing ? Math.max(restoreTotal, 1) : 4;
      bar.value = zoneDrawing ? restoreDrawn : complete;
    }
    bar["aria-valuetext"] = title + ". " + label;
  }
  function localRecords() {
    const records = [];
    for (const groups of territoryIndex.byOrganization.values())
      for (const group of groups) {
        const record = L.recordForGroup(
          group,
          ruleLocations,
          ruleAttempts,
          ruleFailures,
        );
        if (record) records.push(record);
      }
    for (const organization of data.organizations) {
      const record = L.recordForOrganization(
        organization,
        orgLocations.get(organization.id),
      );
      if (record) records.push(record);
    }
    return [
      ...records,
      ...accessibility.records(),
      ...(savedZoneSnapshot ? [savedZoneSnapshot] : []),
      ...(savedCoverageSnapshot ? [savedCoverageSnapshot] : []),
    ];
  }
  function showCacheStatus() {
    if (disposed) return;
    const vectorStatus =
      (zoneStorageState === "saved"
        ? ` Готовых исходных векторных зон: ${savedZoneSnapshot?.zones.length || 0}.`
        : zoneStorageState === "saving"
          ? " Сохраняем готовые векторы…"
          : zoneStorageState === "failed"
            ? " Готовые векторы не удалось сохранить."
            : "") +
      (savedCoverageSnapshot
        ? ` Зон полного покрытия: ${savedCoverageSnapshot.zones.length}.`
        : "");
    const message =
      (cacheProblem
        ? "Локальное сохранение недоступно: " +
          cacheProblem +
          ". Скачайте резервную копию данных."
        : `Сохранено в этом браузере: ${fmt(ruleLocations.size)} адресов, ${fmt(ruleAttempts.size)} неподтверждённых. Положений больниц: ${fmt(data.organizations.filter((o) => locationFor(o.id)).length)}; из файла пользователя: ${fmt(data.organizations.filter((o) => o.location).length)}.`) +
      vectorStatus;
    $("local-data-status").textContent = message;
    $("local-cache-status").textContent = message;
    $("retry-cache").hidden = !cacheProblem;
    updateRestoreProgress();
  }
  async function persistLocal(records) {
    try {
      await L.write(records.filter(Boolean));
      showCacheStatus();
      return true;
    } catch (error) {
      if (!cacheProblem)
        toast(
          "Не удалось сохранить результаты локально. Подробности в разделе «О данных».",
        );
      cacheProblem = String(error.message || error);
      showCacheStatus();
      return false;
    }
  }
  function persistGroup(group) {
    if (ruleLocations.has(group.id)) addressRevision++;
    scheduleTables();
    return persistLocal([
      L.recordForGroup(group, ruleLocations, ruleAttempts, ruleFailures),
    ]);
  }
  function applyLocal(restored) {
    if (restored.locations.size) addressRevision++;
    for (const [id, result] of restored.locations) {
      ruleLocations.set(id, result);
      ruleAttempts.delete(id);
      ruleFailures.delete(id);
      geocodeCache.set(
        T.normalizeAddress("Тульская область, " + result.address),
        result,
      );
    }
    for (const id of restored.attempts)
      if (!ruleLocations.has(id)) {
        ruleAttempts.add(id);
        ruleFailures.set(id, restored.failures.get(id));
      }
    for (const [id, result] of restored.orgLocations) {
      orgLocations.set(id, result);
      geocodeCache.set(T.normalizeAddress(getOrg(id).mapQuery), result);
    }
  }
  async function restoreLocal() {
    updateRestoreProgress();
    $("local-data-status").textContent = "Загружаем сохранённые адреса…";
    try {
      const records = await L.read();
      if (disposed) return;
      savedZoneSnapshot =
        records.find((r) => r.key === "geometry:zones-v1") || null;
      savedCoverageSnapshot =
        records.find((r) => r.key === "geometry:coverage-v1") || null;
      applyLocal(L.restore(records, data, territoryIndex));
      accessibility.restore(records);
      zoneStorageState = savedZoneSnapshot ? "saved" : "missing";
    } catch (error) {
      if (disposed) return;
      cacheProblem = String(error.message || error);
    }
    localLoaded = true;
    showCacheStatus();
    render();
    showCacheStatus();
    if (ruleLocations.size || ruleAttempts.size || orgLocations.size) {
      updateBulkProgress("Восстановлено. ");
      $("cached-placeholder").textContent =
        `Восстановлено локально: ${fmt(ruleLocations.size)} адресов. Положений больниц: ${fmt(data.organizations.filter((o) => locationFor(o.id)).length)}. Подключите Яндекс Карты — зоны появятся без повторного поиска.`;
      setMessage(
        `Восстановлено ${fmt(ruleLocations.size)} адресов из локального хранилища. Повторный поиск для них не нужен.`,
      );
    }
  }
  async function retryLocalSave() {
    await cacheReady;
    if (disposed) return;
    try {
      await L.write(localRecords());
      cacheProblem = null;
      if (savedZoneSnapshot) zoneStorageState = "saved";
      showCacheStatus();
      toast("Все текущие результаты сохранены локально.");
    } catch (error) {
      cacheProblem = String(error.message || error);
      showCacheStatus();
    }
  }
  function metricLabel() {
    return {
      absolute: "прикреплённых",
      perArea: "прикреплённых на запись участка",
      per1000: "прикреплённых на 1 000 жителей",
    }[settings.metric];
  }
  function value(o) {
    return C.metric(o, settings.metric, data, settings);
  }
  function band(o) {
    return C.band(value(o), bounds);
  }
  function colorFor(o) {
    return settings.mapColor === "organization"
      ? organizationColors[o.id]
      : C.COLORS[band(o)];
  }
  function getOrg(id) {
    return data.organizations.find((o) => o.id === id);
  }
  function listed() {
    const query = $("org-search").value.trim().toLocaleLowerCase("ru");
    return data.organizations
      .filter(
        (o) =>
          (settings.showEmpty || o.attached !== null) &&
          (!query ||
            [o.name, o.shortName, ...o.aliases]
              .join(" ")
              .toLocaleLowerCase("ru")
              .includes(query)),
      )
      .sort(
        (a, b) =>
          (value(b) ?? -1) - (value(a) ?? -1) ||
          a.shortName.localeCompare(b.shortName, "ru"),
      );
  }
  function showView(name) {
    if (disposed) return;
    for (const n of ["map", "table", "about"])
      $(n + "-view").hidden = n !== name;
    $("view").value = name;
    if (name === "map" && map) {
      const target = map;
      requestAnimationFrame(() => {
        if (!disposed && map === target) target.container.fitToViewport();
      });
    }
    if (name === "table") publishTables();
  }
  function render() {
    if (disposed) return;
    bounds = C.scale(data, settings);
    $("detail-panel").hidden = !selected;
    $("show-zones").checked = settings.showZones;
    $("show-address-points").checked = settings.showAddressPoints;
    $("map-color").value = settings.mapColor;
    $("metric").value = settings.metric;
    $("include-mixed").checked = settings.includeMixed;
    $("show-empty").checked = settings.showEmpty;
    $("metric-description").textContent =
      settings.metric === "per1000"
        ? "Взрослые прикреплённые / всё население территории × 1 000. Население справочное, границы требуют проверки."
        : settings.metric === "perArea"
          ? "Среднее по записям терапевтических участков. Число работающих врачей неизвестно."
          : "Сумма численности из исходной книги. Показатель не учитывает мощность приёма.";
    const orgs = listed();
    $("org-count").textContent = orgs.length;
    ui.setData(
      "org-list",
      orgs.map((o) => ({
        id: o.id,
        name: o.shortName,
        color: colorFor(o),
        selected: selected === o.id,
        attached: o.areas.length
          ? fmt(C.attachedFor(o, settings.includeMixed)) + " чел."
          : "Численность не указана",
        value: fmt(value(o), 1),
      })),
    );
    $("select-organization").onclick = (id) => selectOrg(id);
    const items = bounds.count
      ? [
          ["low", "≤ " + fmt(bounds.low, 2)],
          ["middle", "> " + fmt(bounds.low, 2) + " — ≤ " + fmt(bounds.high, 2)],
          ["high", "> " + fmt(bounds.high, 2)],
          ["missing", "нет данных"],
        ]
      : [["missing", "нет данных"]];
    ui.setData(
      "legend-bands",
      items.map(([band, label]) => ({ color: C.COLORS[band], label })),
    );
    $("legend-note").textContent =
      `${metricLabel()}. Границы по ${bounds.count} организациям. ${settings.includeMixed ? "Смешанные категории включены." : "Категория «взрослые, дети» исключена."}`;
    $("legend-heading").textContent =
      settings.mapColor === "organization"
        ? "Больница закрепления"
        : "Относительная численность";
    $("legend-caption").textContent =
      settings.mapColor === "organization"
        ? "Один цвет — одна организация"
        : "Цвет не означает перегрузку";
    if (settings.mapColor === "organization") {
      const o = selected ? getOrg(selected) : null;
      ui.setData(
        "legend-bands",
        o ? [{ color: organizationColors[o.id], label: o.shortName }] : [],
      );
      $("legend-note").textContent =
        "Цвет различает больницы. Контур строится по найденным адресам. Выберите больницу и загрузите её адреса.";
    }
    $("territory-summary").textContent =
      `В источнике: ${territoryIndex.organizationCount} зон больниц. В списке: ${orgs.filter((o) => o.territories.length).length}. Для остальных включите организации без численности.`;
    if (selected) renderDetail(getOrg(selected));
    renderMap();
    publishTables();
    save();
  }
  function selectOrg(id) {
    selected = id;
    render();
    const loc = locationFor(id);
    if (map && loc)
      map.setCenter(
        loc.coords,
        ["manual", "provided"].includes(loc.kind) ? 14 : 12,
        { duration: 250 },
      );
  }
  function renderDetail(o) {
    if (disposed || !o) return;
    const panel = $("detail-panel");
    panel.hidden = false;
    const p = C.populationFor(o, data, settings),
      loc = locationFor(o.id),
      mixed = o.mixedAttached || 0;
    const colocated = loc
      ? data.organizations.filter(
          (other) =>
            other.id !== o.id &&
            locationFor(other.id)?.coords.every((v, i) => v === loc.coords[i]),
        )
      : [];
    const groups = territoryIndex.byOrganization.get(o.id) || [],
      zone = T.coverage(groups, ruleLocations, ruleAttempts);
    const plannedCapacity =
      o.capacity.length && o.capacity.every((b) => C.number(b.total) !== null)
        ? o.capacity.reduce((sum, b) => sum + b.total, 0)
        : null;
    const ring = zoneRing(o.id);
    const importedOutline = settings.geojson.some(
      (f) =>
        f.properties.organizationId === o.id && f.geometry.type !== "Point",
    );
    const partition = zonePartition(),
      hasZone = partition.zones.has(o.id);
    const outlineStatus = partition.pending
      ? "Границы обновляются в фоне. Уже построенная версия остаётся на карте."
      : partition.coverage
        ? "Единая расширенная зона: пустые территории добавлены по ближайшей больнице. Внутренняя граница расширения не показывается. Дополнительное население не приписывается."
        : partition.error
          ? "Контуры временно скрыты: " + partition.error
          : importedOutline
            ? hasZone
              ? "Загруженный контур показан без пересечений с другими зонами."
              : "Загруженный контур полностью попал в спорную область и не окрашен."
            : hasZone
              ? `Зона без наложений: по ${zone.found} из ${zone.total} адресов (${fmt((zone.found / zone.total) * 100, 1)}%). Граница разделена по закреплённым адресным ориентирам.`
              : ring
                ? "Контур не окрашен: найденных координат недостаточно для однозначного разделения с соседями. Адресные правила сохранены."
                : "Для векторного контура нужны минимум 3 найденных адреса, не лежащие на одной прямой.";
    const sharedCount = groups.filter(
      (g) => territoryIndex.byAddress.get(g.key).length > 1,
    ).length;
    const metricValue = value(o),
      warning = [];
    if (p && C.attachedFor(o, settings.includeMixed) > p.value)
      warning.push(
        "Прикреплённых больше, чем жителей выбранной территории. Проверьте границы, дату населения и привязку организации: показатель не является долей охвата.",
      );
    if (o.duplicateAreaCount)
      warning.push(
        `${o.duplicateAreaCount} записей с повторяющимися номерами участков — требуют уточнения.`,
      );
    if (mixed && !settings.includeMixed)
      warning.push(
        `${fmt(mixed)} прикреплённых из смешанных категорий исключены из показателя.`,
      );
    if (o.attached === null)
      warning.push(
        "В исходной книге нет записей терапевтических участков для этой организации. Это не означает нулевое прикрепление.",
      );
    ui.setData("detail-panel", {
      organization: o,
      population: p,
      location: loc,
      colocated: colocated.map((other) => other.shortName),
      zone,
      plannedCapacity,
      outlineStatus,
      sharedCount,
      warning,
      metric: fmt(metricValue, 1) + " " + metricLabel(),
      color: colorFor(o),
      attached: fmt(C.attachedFor(o, settings.includeMixed)),
      areaCount: o.areas.length
        ? o.areas.filter(
            (a) => settings.includeMixed || a.category === "Взрослые",
          ).length
        : "—",
      populations: data.populations.map((item) => ({
        value: item.id,
        label: item.type + ": " + item.name,
      })),
    });
    $("detail-population").value = p?.id || "";
    $("population-value").value = p?.value || "";
    $("manual-lat").value = loc?.coords[0] ?? "";
    $("manual-lon").value = loc?.coords[1] ?? "";
    $("show-rules").disabled =
      !map || !zone.remaining || busy || !$("allow-geocoder").checked;
    $("fit-zone").disabled = !map || !zone.found;
    $("retry-rules").disabled = busy;
    $("locate-one").disabled =
      !map || busy || (!loc && !$("allow-geocoder").checked);
    $("locate-one").textContent = loc ? "Показать больницу" : "Найти на карте";
    $("close-detail").onclick = () => {
      selected = null;
      panel.hidden = true;
      render();
    };
    $("detail-population").onchange = (e) => {
      settings.populationLinks[o.id] = e.target.value;
      render();
    };
    if ($("save-population"))
      $("save-population").onclick = () => {
        const v = Number($("population-value").value);
        if (!Number.isSafeInteger(v) || v <= 0)
          return toast("Введите положительное целое число жителей.");
        settings.populationValues[p.id] = v;
        render();
        toast("Численность изменена. Цветовые границы пересчитаны.");
      };
    $("open-addresses").onclick = () => openTable("territories", o.id);
    if ($("open-areas"))
      $("open-areas").onclick = () => openTable("areas", o.id);
    $("locate-one").onclick = () => locateOrganizations([o]);
    $("show-rules").onclick = () => locateRules(o);
    $("fit-zone").onclick = () => fitZone(o.id);
    if ($("review-rules"))
      $("review-rules").onclick = () =>
        openTable("territories", o.id, "Не подтверждено");
    if ($("retry-rules"))
      $("retry-rules").onclick = async () => {
        if (busy) return;
        setBusy(true);
        const pending = groups.filter(
          (g) => ruleAttempts.has(g.id) && !ruleLocations.has(g.id),
        );
        await persistLocal(
          pending.map((g) => ({
            key: "rule:" + g.id,
            type: "rule",
            id: g.id,
            status: "pending",
          })),
        );
        if (disposed) return;
        pending.forEach((g) => {
          ruleAttempts.delete(g.id);
          ruleFailures.delete(g.id);
        });
        scheduleTables();
        showCacheStatus();
        setBusy(false);
        locateRules(o);
      };
    $("save-coordinates").onclick = () => {
      const a = $("manual-lat").value,
        b = $("manual-lon").value,
        lat = Number(a),
        lon = Number(b);
      if (
        !a ||
        !b ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        return toast("Укажите корректные широту и долготу.");
      settings.coordinates[o.id] = [lat, lon];
      if (o.location) settings.coordinateVersions[o.id] = o.location.version;
      render();
      if (map) map.setCenter([lat, lon], 14);
      toast("Сохранены координаты, введённые пользователем.");
    };
    if ($("reset-coordinates"))
      $("reset-coordinates").onclick = () => {
        delete settings.coordinates[o.id];
        delete settings.coordinateVersions[o.id];
        render();
        if (map) map.setCenter(o.location.coords, 14);
      };
  }
  function openTable(kind, organizationId = "", search = "") {
    if (disposed) return;
    tables.open({ kind, organizationId, search });
    showView("table");
  }
  function publishTables() {
    if (disposed) return;
    if (tableUpdateTimer !== undefined) {
      clearTimeout(tableUpdateTimer);
      tableUpdateTimer = undefined;
    }
    // Снимки копируют изменяемые коллекции, чтобы React видел согласованную версию данных.
    tables.update({
      data,
      territoryIndex,
      metricLabel: metricLabel(),
      populationValues: { ...settings.populationValues },
      organizationValues: new Map(
        data.organizations.map((o) => {
          const loc = locationFor(o.id);
          return [
            o.id,
            {
              attached: C.attachedFor(o, settings.includeMixed),
              population: C.populationFor(o, data, settings),
              metric: value(o),
              coords: loc ? [...loc.coords] : null,
            },
          ];
        }),
      ),
      ruleLocations: new Map(
        [...ruleLocations].map(([id, location]) => [id, location.kind]),
      ),
      ruleAttempts: new Set(ruleAttempts),
      ruleFailures: new Map(ruleFailures),
    });
  }
  function scheduleTables() {
    if (disposed || tableUpdateTimer !== undefined) return;
    tableUpdateTimer = setTimeout(() => {
      tableUpdateTimer = undefined;
      publishTables();
    }, 100);
  }
  function download(content, name, type) {
    if (disposed) return;
    const url = URL.createObjectURL(new Blob([content], { type }));
    objectUrls.add(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }, 1000);
  }
  function locationFor(id) {
    return C.locationFor(getOrg(id), settings, orgLocations.get(id));
  }
  function promiseTimeout(p, ms = 15000, signal) {
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        clean();
        reject(
          Object.assign(new Error("Поиск остановлен пользователем."), {
            name: "AbortError",
            code: "SEARCH_CANCELLED",
          }),
        );
      };
      const timer = setTimeout(() => {
        clean();
        reject(
          Object.assign(new Error("Время ожидания ответа Яндекса истекло."), {
            name: "TimeoutError",
          }),
        );
      }, ms);
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      Promise.resolve(p).then(
        (value) => {
          clean();
          resolve(value);
        },
        (error) => {
          clean();
          reject(error);
        },
      );
    });
  }
  function explainApiError(error, service) {
    const raw = String(error?.message || error || "Ответ сервиса не получен.");
    let message;
    if (/Invalid api key|HTTP 40[13]/i.test(raw)) {
      message =
        service +
        ": Яндекс отклонил ключ. Проверьте в кабинете, что ключ относится к этому продукту, продукт подключён, ключ активен и ограничения разрешают текущий адрес. Ответ: " +
        raw;
    } else if (/scriptError/i.test(raw)) {
      message =
        service +
        ": запрос не выполнен. Проверьте сообщения Яндекса в консоли, активацию ключа JavaScript API и его ограничения. Появление подложки не подтверждает действительность ключа. Ответ: " +
        raw;
    } else if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
      message =
        service +
        ": браузер не получил ответ. Возможны сетевая ошибка или ограничение браузера. Проверьте доступ к Яндексу и сообщение в консоли. Ответ: " +
        raw;
    } else {
      message = service + ": " + raw;
    }
    if (location.protocol === "file:")
      message +=
        " Страница открыта как файл (file://), без обычного HTTP Referer. Ключ с ограничением по домену может отклонять такой запуск.";
    return message;
  }
  const networkGate = T.paceRequests({
    interval: 200,
    shouldStop: () => disposed || (busy && cancelRequested),
  });
  const requestCache = T.createGeocoderCache(requestGeocode, {
    values: geocodeCache,
  });
  function geocode(query, options) {
    if (disposed)
      return Promise.reject(new DOMException("Остановлено", "AbortError"));
    if (!$("allow-geocoder").checked)
      return Promise.reject(
        new Error(
          "Новый поиск адресов выключен. Используйте сохранённые данные.",
        ),
      );
    return requestCache.get(query, options);
  }
  async function requestGeocode(query) {
    try {
      return await T.retryRequest(
        () => networkGate(() => requestGeocodeOnce(query)),
        {
          shouldStop: () => disposed || (busy && cancelRequested),
          onRetry: (attempt, total) =>
            setMessage(
              `Геокодер отвечает медленно или связь прервалась. Повтор запроса ${attempt} из ${total}. Уже найденные адреса сохранены.`,
            ),
        },
      );
    } catch (error) {
      if (!(busy && cancelRequested) && T.transientError(error))
        throw Object.assign(
          new Error(
            error.status >= 500
              ? `Геокодер временно недоступен (HTTP ${error.status}) после трёх попыток. Продолжите поиск позже.`
              : "Не удалось получить ответ геокодера после трёх попыток: соединение прервалось или истекло время ожидания. Продолжите поиск позже.",
          ),
          { name: "NetworkError", status: error.status },
        );
      throw error;
    }
  }
  async function requestGeocodeOnce(query) {
    if (disposed) throw new DOMException("Остановлено", "AbortError");
    let result;
    if (geoKey) {
      let timedOut = false;
      const controller = new AbortController(),
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 30000);
      activeRequests.add(controller);
      try {
        const u = new URL("https://geocode-maps.yandex.ru/v1");
        u.search = new URLSearchParams({
          apikey: geoKey,
          geocode: query,
          format: "json",
          lang: "ru_RU",
          results: "1",
          bbox: "35.6,52.7~38.9,55.0",
          rspn: "1",
        });
        const response = await fetch(u, { signal: controller.signal });
        if (!response.ok) {
          let reason = "";
          try {
            const failure = await response.json();
            reason =
              typeof failure.message === "string"
                ? failure.message
                : typeof failure.error === "string"
                  ? failure.error
                  : "";
          } catch (_) {}
          throw Object.assign(
            new Error(
              `Геокодер отклонил запрос (HTTP ${response.status})${reason ? ": " + reason : ""}.`,
            ),
            { status: response.status },
          );
        }
        const body = await response.json(),
          g = body.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
        if (!g) throw new Error("Адрес не найден в пределах области.");
        const pos = g.Point.pos.split(/\s+/).map(Number),
          meta = g.metaDataProperty.GeocoderMetaData;
        result = {
          coords: [pos[1], pos[0]],
          kind: meta.kind,
          precision: meta.precision || "",
          label: meta.text,
        };
      } catch (error) {
        if (controller.signal.aborted) {
          if (busy && cancelRequested)
            throw Object.assign(new Error("Поиск остановлен пользователем."), {
              name: "AbortError",
              code: "SEARCH_CANCELLED",
            });
          if (timedOut)
            throw Object.assign(
              new Error(
                "Геокодер не ответил за 30 секунд. Попробуйте продолжить поиск позже.",
              ),
              { name: "TimeoutError", code: "GEOCODER_TIMEOUT" },
            );
        }
        throw error;
      } finally {
        clearTimeout(timer);
        activeRequests.delete(controller);
      }
    } else {
      const controller = new AbortController();
      activeRequests.add(controller);
      try {
        const response = await promiseTimeout(
          ym.geocode(query, {
            results: 1,
            boundedBy: [
              [52.7, 35.6],
              [55.0, 38.9],
            ],
            strictBounds: true,
          }),
          30000,
          controller.signal,
        );
        const o = response.geoObjects.get(0);
        if (!o) throw new Error("Адрес не найден в пределах области.");
        result = {
          coords: o.geometry.getCoordinates(),
          kind: o.properties.get("metaDataProperty.GeocoderMetaData.kind"),
          precision:
            o.properties.get("metaDataProperty.GeocoderMetaData.precision") ||
            "",
          label: o.getAddressLine(),
        };
      } finally {
        activeRequests.delete(controller);
      }
    }
    if (
      !result.coords.every(Number.isFinite) ||
      result.coords[0] < 52.7 ||
      result.coords[0] > 55 ||
      result.coords[1] < 35.6 ||
      result.coords[1] > 38.9
    )
      throw new Error(
        "Результат вне области проверки; координаты не добавлены.",
      );
    return result;
  }
  function setBusy(v) {
    if (disposed) return;
    busy = v;
    if (v) cancelRequested = false;
    $("stop-loading").hidden = !v;
    $("locate-all").disabled = v || !map || !$("allow-geocoder").checked;
    $("locate-all-addresses").disabled =
      v || !map || !$("allow-geocoder").checked;
    $("open-settings").disabled = v;
    if (selected) renderDetail(getOrg(selected));
  }
  async function locateOrganizations(orgs) {
    if (disposed || !map || busy) return;
    setBusy(true);
    let found = 0,
      errors = 0;
    try {
      for (const [i, o] of orgs.entries()) {
        if (cancelRequested) break;
        setMessage(
          `Поиск организаций: ${i + 1} из ${orgs.length}. Найдено ${found}.`,
        );
        if (locationFor(o.id)) {
          found++;
          continue;
        }
        try {
          const r = await geocode(o.mapQuery);
          if (disposed) return;
          orgLocations.set(o.id, {
            ...r,
            label: o.mapQueryType + " · " + r.label + " · точность: " + r.kind,
          });
          scheduleTables();
          await persistLocal([
            L.recordForOrganization(o, orgLocations.get(o.id)),
          ]);
          found++;
          renderMap();
        } catch (e) {
          errors++;
          if (
            /403|401|key|denied|forbidden|отклонил|Failed to fetch/i.test(
              String(e.message || e),
            )
          )
            throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (disposed) return;
      }
      setMessage(
        `Положений больниц: ${found} из ${orgs.length}. Без результата: ${errors}. Координаты из файла используются без геокодера.`,
      );
      if (orgs.length === 1 && locationFor(orgs[0].id))
        map.setCenter(locationFor(orgs[0].id).coords, 13);
      else fitMap();
    } catch (e) {
      setMessage(
        "Поиск остановлен: " +
          (e.message ||
            "геокодирование отклонено. Проверьте активацию и ограничения ключа."),
      );
      toast("Геокодирование не завершено. Подробности над картой.");
    } finally {
      setBusy(false);
      renderMap();
    }
  }
  function fitZone(organizationId) {
    if (!map) return;
    const points = anchorsFor(organizationId),
      b = T.fitBounds(points);
    if (!b) return;
    if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) map.setCenter(b[0], 13);
    else map.setBounds(b, { checkZoomRange: true, zoomMargin: 65 });
  }
  async function locateRules(o) {
    if (disposed || !map || busy) return;
    const groups = territoryIndex.byOrganization.get(o.id) || [];
    const batch = groups
      .filter((g) => !ruleLocations.has(g.id) && !ruleAttempts.has(g.id))
      .slice(0, 20);
    if (!batch.length)
      return toast("Новых адресов нет. Ненайденные можно проверить повторно.");
    setBusy(true);
    let found = 0,
      failed = 0,
      lastDraw = 0;
    const started = performance.now();
    try {
      await T.searchAddressGroups(batch, {
        lookup: (g) => geocode("Тульская область, " + g.address),
        locations: ruleLocations,
        attempts: ruleAttempts,
        failures: ruleFailures,
        shouldStop: () => cancelRequested,
        onResult: persistGroup,
        concurrency: 4,
        minInterval: 200,
        onProgress: (progress, g) => {
          found = progress.found;
          failed = progress.failed;
          setMessage(
            `${o.shortName}: проверено ${progress.processed} из ${batch.length}. Найдено: ${found}. Не подтверждено: ${failed}. ${searchSpeed(progress.processed, batch.length, started)}`,
          );
          if (performance.now() - lastDraw > 750) {
            renderMap();
            lastDraw = performance.now();
          }
        },
      });
      const progress = T.coverage(groups, ruleLocations, ruleAttempts);
      setMessage(
        `${cancelRequested ? "Поиск остановлен. " : ""}${o.shortName}: найдено ${progress.found} из ${progress.total} адресных ориентиров. Не подтверждено: ${progress.failed}. Осталось: ${progress.remaining}. Контуры разделены без наложений; спорные фрагменты не окрашены. Время запуска: ${fmt((performance.now() - started) / 1000, 1)} с.`,
      );
      if (selected === o.id) fitZone(o.id);
    } catch (e) {
      setMessage(
        "Поиск зоны остановлен: " +
          (e.message || "проверьте доступ к геокодеру."),
      );
    } finally {
      setBusy(false);
      renderMap();
      publishTables();
    }
  }
  function searchSpeed(processed, total, started) {
    const seconds = (performance.now() - started) / 1000,
      rate = seconds > 0 ? processed / seconds : 0;
    if (seconds < 2 || processed < 4) return "До 4 запросов одновременно.";
    const left = rate > 0 ? Math.ceil((total - processed) / rate / 60) : 0;
    return `${fmt(rate, 1)} адреса/с · осталось около ${left} мин.`;
  }
  function anchorsFor(id) {
    return (territoryIndex.byOrganization.get(id) || [])
      .map((group) => ruleLocations.get(group.id))
      .filter(Boolean);
  }
  function zoneRing(id, anchors = anchorsFor(id)) {
    const signature = anchors
        .map((anchor) => anchor.coords.join(","))
        .join("|"),
      cached = zoneGeometryCache.get(id);
    if (cached && cached.signature === signature) return cached.ring;
    const ring = T.coverageRing(anchors);
    zoneGeometryCache.set(id, { signature, ring });
    return ring;
  }
  function baseZonePartition() {
    if (!localLoaded) return { ...partitionResult, pending: false };
    if (
      requestedRevision !== addressRevision ||
      requestedGeometry !== settings.geojson
    ) {
      restoreVectorsReady = false;
      requestedRevision = addressRevision;
      requestedGeometry = settings.geojson;
      const organizations = data.organizations.map((o) => ({
        id: o.id,
        anchors: anchorsFor(o.id).map((a) => ({ coords: a.coords })),
        geometries: settings.geojson
          .filter(
            (f) =>
              f.properties.organizationId === o.id &&
              f.geometry.type !== "Point",
          )
          .map((f) => f.geometry),
      }));
      const signature = JSON.stringify(organizations),
        cached = L.restoreZones(
          savedZoneSnapshot,
          signature,
          data.organizations.map((o) => o.id),
        );
      if (cached) {
        partitionResult = cached;
        partitionRevision++;
        zoneSource = "local";
        zoneStorageState = "saved";
        restoreVectorsReady = true;
      } else {
        zoneSource = "calculated";
        calculationProgress = null;
        calculationStarted = calculationUpdated = Date.now();
        zoneSnapshotInput = { key: ++partitionRequestSequence, signature };
        partitionJobs.request(zoneSnapshotInput.key, organizations);
      }
    }
    return { ...partitionResult, pending: partitionJobs.busy };
  }
  let partitionRequestSequence = 0;
  function activePartition() {
    return settings.fullCoverage && coverageResult
      ? coverageResult
      : partitionResult;
  }
  function zonePartition() {
    const base = baseZonePartition();
    if (
      settings.fullCoverage &&
      !coverageResetting &&
      localLoaded &&
      !base.pending &&
      !base.error &&
      savedZoneSnapshot
    ) {
      const organizations = data.organizations.map((o) => ({
        id: o.id,
        coords: locationFor(o.id)?.coords,
      }));
      const signature = JSON.stringify({
        algorithm: 1,
        base: savedZoneSnapshot.signature,
        hospitals: organizations,
        boundary: window.HOSPITAL_REGION.properties.id,
      });
      if (signature !== coverageSignature) {
        coverageSignature = signature;
        coverageError = "";
        coverageResult = null;
        partitionRevision++;
        const cached = L.restoreZones(
          savedCoverageSnapshot,
          signature,
          data.organizations.map((o) => o.id),
        );
        if (cached?.coverage) coverageResult = cached;
        else {
          coverageProgress = null;
          coverageStarted = coverageUpdated = Date.now();
          coverageInput = { key: ++partitionRequestSequence, signature };
          coverageJobs.request(coverageInput.key, organizations, {
            task: "coverage",
            boundary: window.HOSPITAL_REGION,
            baseZones: base.zones,
          });
        }
      }
    }
    updateCoverageStatus();
    return {
      ...activePartition(),
      pending: base.pending || (settings.fullCoverage && coverageJobs.busy),
    };
  }
  function resetCoverage() {
    coverageResetting = true;
    coverageInput = null;
    coverageSignature = "";
    coverageResult = null;
    coverageError = "";
    coverageProgress = null;
    coverageJobs.restart();
    coverageResetting = false;
    partitionRevision++;
  }
  function updateCoverageStatus() {
    if (disposed) return;
    if (!$("coverage-status")) return;
    $("full-coverage").checked = settings.fullCoverage;
    $("full-coverage").disabled =
      !localLoaded ||
      busy ||
      coverageJobs.busy ||
      coverageSaving ||
      backupWorking ||
      accessibility.busy;
    ui.setData(
      "coverage-organization",
      settings.fullCoverage &&
        Boolean(coverageResult) &&
        settings.mapColor === "organization",
    );
    $("fill-coverage").disabled =
      !localLoaded ||
      busy ||
      coverageJobs.busy ||
      coverageSaving ||
      backupWorking;
    $("fill-coverage").textContent = coverageJobs.busy
      ? "Заполняем пробелы…"
      : coverageError
        ? "Повторить заполнение"
        : "Заполнить пробелы";
    $("coverage-progress").hidden =
      !settings.fullCoverage || !coverageJobs.busy;
    $("coverage-source").hidden = !settings.fullCoverage;
    let note =
      "Пустые территории будут отданы ближайшей больнице по прямой. Существующие зоны сохранятся; перед расчётом создаётся локальная копия.";
    if (settings.fullCoverage) {
      if (coverageError) note = "Заполнение приостановлено: " + coverageError;
      else if (coverageJobs.busy) {
        const p = coverageProgress,
          names = {
            "coverage-boundary": "Граница области",
            "coverage-clip": "Сохранение исходных зон",
            "coverage-fill": "Распределение пустых территорий",
            "coverage-mask": "Проверка покрытия области",
            "coverage-verify": "Проверка наложений",
          };
        note =
          (names[p?.stage] || "Подготовка заполнения") +
          (p?.total ? ` · ${fmt(p.completed)} / ${fmt(p.total)}` : "") +
          ` · прошло ${Math.floor((Date.now() - coverageStarted) / 1000)} с · без обновлений ${Math.floor((Date.now() - coverageUpdated) / 1000)} с.`;
        const bar = $("coverage-progress");
        bar.max = Math.max(p?.total || 1, 1);
        bar.value = p?.completed || 0;
      } else if (coverageResult) {
        note = `Полное покрытие готово · ${coverageResult.zones.size} зон. Расчётно добавлено ${fmt((coverageResult.coverage.addedArea / coverageResult.coverage.regionArea) * 100, 1)}% площади. ${coverageSaving ? "Сохраняем…" : cacheProblem ? "Сохранение недоступно — скачайте копию." : "Готовые контуры сохраняются локально."}`;
        if (settings.mapColor === "organization")
          $("legend-note").textContent =
            "Каждая больница показана единым расширенным контуром. Расширение рассчитано локально; адресные правила сохранены.";
        if (coverageResult.coverage.coLocated.length)
          note +=
            " При совпадении координат пустая территория отдана первой больнице по ID; исходные зоны каждой сохранены.";
        if (listed().length < data.organizations.length)
          note +=
            " Часть зон скрыта фильтрами: для сплошного отображения очистите поиск и включите организации без численности.";
      } else note = "Ожидаем готовые исходные векторы…";
    }
    $("coverage-status").textContent = note;
    $("zone-layer-description").textContent =
      settings.fullCoverage && coverageResult
        ? "Единый расширенный контур каждой больницы; пустые территории — по ближайшей больнице."
        : "Пунктир — приблизительная граница по найденным адресам. Пробелы означают неопределённость.";
  }
  function updateTopologyNote() {
    if (disposed) return;
    if (!$("zone-topology-note")) return;
    const error =
      mapDrawError ||
      partitionResult.error ||
      (settings.fullCoverage && coverageError);
    if (settings.fullCoverage && coverageResult && !error) {
      $("zone-topology-note").textContent =
        "Покрытие проверено с учётом сантиметрового округления стыков. Численность прикреплённых не изменена.";
      return;
    }
    $("zone-topology-note").textContent = error
      ? "Ошибка обновления границ: " + error
      : partitionJobs.busy
        ? "Границы пересчитываются в фоне. Поиск адресов и управление страницей доступны."
        : (zoneSource === "local"
            ? `Восстановлено готовых векторных зон локально: ${partitionResult.zones.size}. Без повторного построения. `
            : "") +
          "Зоны не накладываются. Неопределённые фрагменты не окрашены." +
          (partitionResult.sharedAnchors
            ? ` Общих координат адресов: ${partitionResult.sharedAnchors}.`
            : "") +
          (partitionResult.importedConflicts
            ? ` Конфликтов в загруженных границах: ${partitionResult.importedConflicts}.`
            : "");
  }
  const allAddressGroups = [...territoryIndex.byOrganization.values()].flat();
  function bulkSummary() {
    const stats = T.coverage(allAddressGroups, ruleLocations, ruleAttempts);
    const zones = zonePartition().zones.size;
    return { stats, zones };
  }
  function updateBulkProgress(prefix = "") {
    if (disposed) return;
    const { stats, zones } = bulkSummary(),
      checked = stats.found + stats.failed;
    $("bulk-progress").hidden = false;
    $("bulk-progress-bar").max = stats.total;
    $("bulk-progress-bar").value = checked;
    $("bulk-progress-label").textContent =
      `${prefix}Проверено ${fmt(checked)} / ${fmt(stats.total)}. Найдено: ${fmt(stats.found)}. Не подтверждено: ${fmt(stats.failed)}. Зон: ${zones} / ${settings.fullCoverage && coverageResult ? data.organizations.length : territoryIndex.organizationCount}.${partitionJobs.busy ? " Границы обновляются в фоне." : ""}`;
    return { stats, zones };
  }
  async function locateAllAddresses() {
    if (disposed || !map || busy) return;
    settings.mapColor = "organization";
    settings.showZones = true;
    settings.showEmpty = true;
    $("org-search").value = "";
    selected = null;
    $("detail-panel").hidden = true;
    showView("map");
    render();
    const queue = T.pendingAddressGroups(
      territoryIndex,
      ruleLocations,
      ruleAttempts,
    );
    if (!queue.length) {
      setMessage(
        updateBulkProgress("Все адреса проверены. ").stats.failed
          ? "Все адреса проверены. Неподтверждённые адреса можно повторить в карточках больниц."
          : "Все адреса найдены; зоны построены.",
      );
      fitMap();
      return;
    }
    bulkActive = true;
    setBusy(true);
    updateBulkProgress();
    const started = performance.now();
    let lastDraw = 0,
      overviewShown = false;
    $("locate-all-addresses").textContent = "Поиск всех адресов…";
    setMessage(
      `Поиск всех больниц: осталось ${fmt(queue.length)} адресов. Зоны строятся автоматически, у каждой больницы свой цвет.`,
    );
    try {
      await T.searchAddressGroups(queue, {
        lookup: (g) => geocode("Тульская область, " + g.address),
        locations: ruleLocations,
        attempts: ruleAttempts,
        failures: ruleFailures,
        shouldStop: () => cancelRequested,
        onResult: persistGroup,
        concurrency: 4,
        minInterval: 200,
        onProgress: (progress, g) => {
          if (disposed) return;
          setMessage(
            `Все больницы: ${fmt(progress.processed)} / ${fmt(queue.length)} в текущем запуске. ${getOrg(g.organizationId).shortName} · ${g.address}. ${searchSpeed(progress.processed, queue.length, started)}`,
          );
          if (performance.now() - lastDraw > 750) {
            updateBulkProgress();
            renderMap();
            if (selected) renderDetail(getOrg(selected));
            if (!overviewShown && progress.processed >= 50) {
              overviewShown = true;
              fitMap();
            }
            lastDraw = performance.now();
          }
        },
      });
      if (disposed) return;
      const { stats, zones } = updateBulkProgress(
        cancelRequested ? "Поиск остановлен. " : "Поиск завершён. ",
      );
      setMessage(
        `${cancelRequested ? "Поиск остановлен. Нажмите кнопку ещё раз, чтобы продолжить." : "Все адреса проверены."} Найдено ${fmt(stats.found)} / ${fmt(stats.total)}; не подтверждено ${fmt(stats.failed)}; осталось ${fmt(stats.remaining)}. Построено зон: ${zones}. Время запуска: ${fmt((performance.now() - started) / 1000, 1)} с.`,
      );
    } catch (error) {
      updateBulkProgress("Поиск приостановлен. ");
      setMessage(
        "Поиск приостановлен: " +
          (error.message || "геокодер недоступен.") +
          " Уже найденные адреса доступны локально; статус сохранения показан под кнопкой поиска. После устранения причины нажмите кнопку ещё раз, чтобы продолжить.",
      );
    } finally {
      bulkActive = false;
      setBusy(false);
      renderMap();
      publishTables();
      fitMap();
      if (!disposed)
        $("locate-all-addresses").textContent =
          "Найти все адреса и построить зоны";
    }
  }
  function renderChunked(kind, stamp, layer, items, make, total = 0) {
    if (layerStamps[kind] === stamp)
      return layerPromises[kind] || Promise.resolve();
    layerStamps[kind] = stamp;
    const token = (layerTokens[kind] || 0) + 1;
    layerTokens[kind] = token;
    const epoch = mapEpoch;
    layer.removeAll();
    if (kind === "zone") {
      zoneDrawing = true;
      restoreDrawn = 0;
      restoreTotal = total;
      updateRestoreProgress();
    }
    layerPromises[kind] = J.chunks(items, (item) => layer.add(make(item)), {
      cancelled: () =>
        disposed || epoch !== mapEpoch || layerTokens[kind] !== token || !map,
      onProgress: (count) => {
        if (
          kind === "zone" &&
          epoch === mapEpoch &&
          layerTokens[kind] === token
        ) {
          restoreDrawn = count;
          updateRestoreProgress();
        }
      },
    })
      .catch((error) => {
        mapDrawError = String(error.message || error);
        updateTopologyNote();
      })
      .finally(() => {
        if (kind === "zone" && layerTokens[kind] === token) {
          zoneDrawing = false;
          if (fitPending && !partitionJobs.busy) {
            fitPending = false;
            fitMap(false);
          }
          updateRestoreProgress();
        }
      });
    return layerPromises[kind];
  }
  function renderMap() {
    if (disposed) return Promise.resolve();
    const partition = zonePartition();
    accessibility.refresh();
    updateTopologyNote();
    updateRestoreProgress();
    if (!map || !ym) return Promise.resolve();
    const organizations = listed(),
      visible = new Set(organizations.map((o) => o.id));
    const colors = organizations.map((o) => [o.id, colorFor(o), value(o)]);
    const orgStamp = JSON.stringify([
      mapEpoch,
      colors,
      organizations.map((o) => locationFor(o.id)),
    ]);
    if (layerStamps.org !== orgStamp) {
      layerStamps.org = orgStamp;
      orgLayer.removeAll();
      for (const o of organizations) {
        const loc = locationFor(o.id);
        if (!loc) continue;
        const samePoint = organizations.filter(
          (other) =>
            other.id !== o.id &&
            locationFor(other.id)?.coords.every((v, i) => v === loc.coords[i]),
        );
        const marker = new ym.Placemark(
          loc.coords,
          {
            hintContent: esc(
              [o, ...samePoint].map((other) => other.shortName).join("; "),
            ),
            balloonContent: `<strong>${esc(o.shortName)}</strong><br>${fmt(value(o), 1)} ${esc(metricLabel())}<br><small>${esc(loc.label)}</small>${samePoint.length ? "<p>Та же точка: " + samePoint.map((other) => esc(other.shortName)).join("; ") + ". Выберите организацию в списке слева.</p>" : ""}`,
          },
          {
            preset: ["manual", "house", "provided"].includes(loc.kind)
              ? "islands#dotIcon"
              : "islands#circleDotIcon",
            iconColor: colorFor(o),
          },
        );
        marker.events.add("click", () => selectOrg(o.id));
        orgLayer.add(marker);
      }
    }
    const zoneStamp = JSON.stringify([
      mapEpoch,
      partitionRevision,
      settings.showZones,
      accessibility.enabled,
      selected,
      colors,
    ]);
    function* zoneItems() {
      if (settings.showZones)
        for (const o of organizations)
          for (const coordinates of partition.zones.get(o.id) || [])
            yield { o, coordinates };
    }
    const zonePromise = renderChunked(
      "zone",
      zoneStamp,
      zoneLayer,
      zoneItems(),
      ({ o, coordinates }) => {
        const total = (territoryIndex.byOrganization.get(o.id) || []).length,
          count = partition.anchorCounts?.get(o.id) ?? anchorsFor(o.id).length;
        const label = partition.coverage
          ? "Расширенная зона больницы"
          : "Зона по адресным ориентирам";
        const balloon = `<strong>${esc(o.shortName)}</strong><p>${label}. ${partition.coverage ? "Пустые территории добавлены по ближайшей больнице по прямой. Расширение расчётное; численность прикреплённых не меняется." : `Основа: ${count} из ${total} адресных ориентиров. Исходные правила домов сохранены.`}</p><p>${fmt(value(o), 1)} ${esc(metricLabel())}</p>`;
        return new ym.Polygon(
          C.yandexGeometry({ type: "Polygon", coordinates }).coordinates,
          {
            hintContent: esc(o.shortName) + " · " + label,
            balloonContent: balloon,
          },
          {
            fillColor: colorFor(o),
            fillOpacity: accessibility.enabled
              ? 0.035
              : selected && selected !== o.id
                ? 0.09
                : 0.24,
            strokeColor: colorFor(o),
            strokeWidth: selected === o.id ? 2 : 1,
            strokeStyle: partition.coverage ? "solid" : "dash",
            zIndex: selected === o.id ? 200 : 50,
          },
        );
      },
      settings.showZones
        ? organizations.reduce(
            (sum, o) => sum + (partition.zones.get(o.id)?.length || 0),
            0,
          )
        : 0,
    );
    renderZoneKey(
      settings.showZones
        ? organizations.filter((o) => partition.zones.has(o.id))
        : [],
    );
    const rules = settings.showAddressPoints
      ? [...ruleLocations.values()].filter(
          (r) =>
            visible.has(r.organizationId) &&
            (!selected || r.organizationId === selected),
        )
      : [];
    const ruleStamp = JSON.stringify([
      mapEpoch,
      selected,
      colors,
      rules.map((r) => [r.id, r.coords]),
    ]);
    const rulePromise = renderChunked(
      "rule",
      ruleStamp,
      ruleLayer,
      rules,
      (r) => {
        const o = getOrg(r.organizationId),
          rules = r.rules
            .map(
              (rule) =>
                `<li>Дома: ${esc(rule.houses)}<br><small>DOCX · таблица ${rule.table}, строка ${rule.sourceRow}</small></li>`,
            )
            .join("");
        return new ym.Placemark(
          r.coords,
          {
            hintContent: esc(o.shortName + " · " + r.address),
            balloonContent: `<strong>${esc(r.address)}</strong><br>${esc(o.shortName)}<ul>${rules}</ul><small>Ориентир: ${esc(r.kind)} · ${esc(r.precision)}<br>${esc(r.label)}</small>`,
          },
          { preset: "islands#circleIcon", iconColor: colorFor(o) },
        );
      },
    );
    const points = settings.geojson.filter(
      (f) =>
        f.geometry.type === "Point" && visible.has(f.properties.organizationId),
    );
    const geoPromise = renderChunked(
      "geo",
      JSON.stringify([mapEpoch, colors, points]),
      geometryLayer,
      points,
      (f) => {
        const o = getOrg(f.properties.organizationId),
          shape = new ym.GeoObject(
            {
              geometry: C.yandexGeometry(f.geometry),
              properties: {
                hintContent: esc(f.properties.name || o.shortName),
                balloonContent: esc(f.properties.source),
              },
            },
            { iconColor: colorFor(o) },
          );
        shape.events.add("click", () => selectOrg(o.id));
        return shape;
      },
    );
    return Promise.all([zonePromise, rulePromise, geoPromise]);
  }
  function renderZoneKey(zones) {
    $("zone-key").hidden = !zones.length;
    $("zone-key-summary").textContent =
      `Цвета построенных зон (${zones.length})`;
    ui.setData(
      "zone-key-items",
      zones.map((o) => ({ id: o.id, name: o.shortName, color: colorFor(o) })),
    );
    $("select-zone").onclick = (id) => {
      selectOrg(id);
      fitZone(id);
    };
  }
  function fitMap(track = true) {
    if (!map) return;
    if (
      track === true &&
      (partitionJobs.busy || coverageJobs.busy || zoneDrawing)
    )
      fitPending = true;
    const corners = [orgLayer, ruleLayer, geometryLayer, zoneLayer]
      .map((layer) => layer.getBounds())
      .filter(Boolean)
      .flat()
      .map((coords) => ({ coords }));
    const b = T.fitBounds(corners);
    if (b) map.setBounds(b, { checkZoomRange: true, zoomMargin: 80 });
    else
      map.setBounds(
        [
          [52.95, 35.8],
          [54.95, 38.75],
        ],
        { checkZoomRange: true },
      );
  }
  async function connect(
    key,
    geocoderKey,
    { verify = false, routingKey: nextRoutingKey = routingKey } = {},
  ) {
    if (busy || accessibility.busy) return;
    await cacheReady;
    if (disposed) return;
    if (!key.trim())
      return ui.setStatus(
        "key-status",
        "Введите ключ JavaScript API.",
        "error",
      );
    sessionKey = key.trim();
    geoKey = geocoderKey.trim();
    routingKey = String(nextRoutingKey || "").trim();
    $("submit-key").disabled = true;
    ui.setStatus("key-status", "Подключение API…", "info");
    mapLoadState = "loading";
    updateRestoreProgress();
    try {
      {
        if (map) {
          mapHost.destroy();
          map = null;
        }
        mapSdkRelease();
        mapEpoch++;
        for (const key of Object.keys(layerStamps)) delete layerStamps[key];
        mapDrawError = "";
        const loaded = await loadDeveloperYandex(sessionKey, lifecycle.signal);
        if (disposed) {
          loaded.dispose();
          return;
        }
        ym = loaded.api;
        mapSdkRelease = loaded.dispose;
        loadedKey = sessionKey;
      }
      if (!map) {
        map = mapHost.create(
          ym,
          {
            center: [54.1, 37.5],
            zoom: 8,
            controls: ["zoomControl", "typeSelector", "fullscreenControl"],
          },
          { suppressMapOpenBlock: false },
        );
        orgLayer = new ym.GeoObjectCollection();
        ruleLayer = new ym.GeoObjectCollection();
        geometryLayer = new ym.GeoObjectCollection();
        zoneLayer = new ym.GeoObjectCollection();
        map.geoObjects
          .add(zoneLayer)
          .add(geometryLayer)
          .add(orgLayer)
          .add(ruleLayer);
        $("map-placeholder").hidden = true;
        $("fit-map").disabled = false;
        $("locate-all").disabled = !$("allow-geocoder").checked;
        $("locate-all-addresses").disabled = !$("allow-geocoder").checked;
        $("open-settings").textContent = "Настройки карты";
      }
      mapLoadState = "ready";
      render();
      fitMap();
      if (verify)
        try {
          const result = await geocode(
            "Тульская область, Тула, улица Первомайская, дом 13",
            { refresh: true },
          );
          if (disposed) return;
          ui.setStatus(
            "key-status",
            "Карта и геокодирование работают. Тестовый адрес найден: " +
              result.label,
            "success",
          );
          setMessage(
            ruleLocations.size
              ? `Яндекс Карты подключены. Показаны сохранённые адреса: ${fmt(ruleLocations.size)}. Зоны восстановлены без повторного поиска.`
              : "Яндекс Карты подключены. Нажмите «Найти все адреса и построить зоны».",
          );
          $("settings-dialog").close();
          toast("Карта подключена, геокодирование проверено.");
        } catch (e) {
          if (disposed) return;
          const service = geoKey
            ? "API Геокодера"
            : "Геокодирование через JavaScript API";
          ui.setStatus("key-status", explainApiError(e, service), "error");
          setMessage(
            "Подложка загружена, но доступ к поиску адресов не подтверждён. Откройте «Настройки карты», чтобы увидеть ответ Яндекса.",
          );
        }
      if (!verify) {
        ui.setStatus(
          "key-status",
          "Яндекс Карты подключены. Геокодер не проверялся; расчёт времени пути выполняется через локальные OSRM.",
          "success",
        );
        setMessage(
          `Карта подключена без проверки геокодера. Восстановлено локально: ${fmt(ruleLocations.size)} адресов. Положений больниц: ${fmt(data.organizations.filter((o) => locationFor(o.id)).length)}. Повторный поиск не выполнялся.${zoneSource === "local" ? ` Готовые векторные зоны загружены локально: ${partitionResult.zones.size}.` : ""}`,
        );
        $("settings-dialog").close();
      }
      if ($("remember-key").checked) {
        try {
          localStorage.setItem(
            "hospital-map-keys",
            JSON.stringify({
              map: sessionKey,
              geocoder: geoKey,
              routing: routingKey,
            }),
          );
        } catch (_) {
          toast("Не удалось сохранить ключи в браузере.");
        }
      }
      render();
    } catch (e) {
      if (disposed) return;
      mapLoadState = "error";
      ui.setStatus(
        "key-status",
        explainApiError(e, "JavaScript API карты"),
        "error",
      );
      setMessage(
        "Не удалось подключить подложку карты. Сохранённые адреса доступны в таблицах; откройте настройки карты для повторного подключения.",
      );
    } finally {
      if (!disposed) {
        $("submit-key").disabled = false;
        updateRestoreProgress();
      }
    }
  }

  $("view").onchange = () => showView($("view").value);
  $("org-search").oninput = () => render();
  for (const id of [
    "show-zones",
    "show-address-points",
    "map-color",
    "metric",
    "include-mixed",
    "show-empty",
  ])
    $(id).onchange = () => {
      settings.showZones = $("show-zones").checked;
      settings.showAddressPoints = $("show-address-points").checked;
      settings.mapColor = bulkActive ? "organization" : $("map-color").value;
      settings.metric = $("metric").value;
      settings.includeMixed = $("include-mixed").checked;
      settings.showEmpty = $("show-empty").checked;
      render();
    };
  $("stop-loading").onclick = () => {
    cancelRequested = true;
    for (const controller of activeRequests) controller.abort();
    setMessage("Останавливаем поиск. Уже полученные результаты сохраняются…");
  };
  $("restart-zone-calculation").onclick = () => {
    partitionJobs.restart();
    calculationProgress = null;
    calculationStarted = calculationUpdated = 0;
    partitionResult = { ...partitionResult, error: null };
    mapDrawError = "";
    requestedRevision = -1;
    requestedGeometry = null;
    renderMap();
    setMessage(
      "Расчёт векторов перезапущен по сохранённым адресам. Геокодер не используется, найденные точки сохранены.",
    );
  };
  $("allow-geocoder").onchange = () => {
    if (busy && !$("allow-geocoder").checked) {
      cancelRequested = true;
      for (const controller of activeRequests) controller.abort();
    } else if (!busy) setBusy(false);
    render();
  };
  $("fit-map").onclick = () => fitMap();
  $("locate-all").onclick = () => locateOrganizations(listed());
  $("locate-all-addresses").onclick = locateAllAddresses;
  const openSettings = () => {
    $("settings-dialog").showModal();
    $("api-key").focus();
  };
  $("open-settings").onclick = openSettings;
  $("connect-map").onclick = openSettings;
  $("close-settings").onclick = () => $("settings-dialog").close();
  const routingInput = $("routing-key");
  $("forget-key").textContent = "Удалить сохранённый ключ карты";
  routingInput.oninput = () => {
    $("remember-key").checked = false;
  };
  $("key-form").onsubmit = (e) => {
    e.preventDefault();
    connect($("api-key").value, $("geocoder-key").value, {
      routingKey: routingInput.value,
    });
  };
  $("forget-key").onclick = () => {
    try {
      localStorage.removeItem("hospital-map-keys");
    } catch (_) {}
    accessibility.stop();
    routingKey = "";
    $("api-key").value = "";
    $("geocoder-key").value = "";
    routingInput.value = "";
    $("remember-key").checked = false;
    accessibility.refresh();
    ui.setStatus(
      "key-status",
      "Сохранённые ключи удалены. Для смены текущего подключения введите новые ключи или перезагрузите страницу.",
      "success",
    );
  };
  $("geojson-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("Максимальный размер — 25 МБ.");
      const features = C.validateGeoJSON(
        JSON.parse(await file.text()),
        data.organizations.map((o) => o.id),
      );
      settings.geojson = features;
      save();
      renderMap();
      toast(
        "Загружено " +
          features.length +
          " объектов. Этот импорт заменил предыдущий.",
      );
      if (map) fitMap();
    } catch (error) {
      toast(error.message || "Не удалось прочитать GeoJSON.");
    } finally {
      e.target.value = "";
    }
  };
  $("export-settings").onclick = () =>
    download(
      JSON.stringify({ version: 1, ...settings }, null, 2),
      "hospital-map-settings.json",
      "application/json",
    );
  $("settings-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("Слишком большой файл.");
      settings = validateSettings(JSON.parse(await file.text()));
      render();
      toast("Настройки проекта загружены.");
    } catch (error) {
      toast(error.message || "Некорректные настройки.");
    } finally {
      e.target.value = "";
    }
  };
  $("retry-cache").onclick = retryLocalSave;
  let pendingBackup = null,
    backupWorking = false,
    backupPreviewRevision = 0;
  $("full-coverage").onchange = async (e) => {
    if (e.target.checked) await enableCoverage();
    else {
      settings.fullCoverage = false;
      partitionRevision++;
      render();
    }
  };
  $("fill-coverage").onclick = enableCoverage;
  async function enableCoverage({ forCalculation = false } = {}) {
    if (
      disposed ||
      backupWorking ||
      busy ||
      (accessibility.busy && !forCalculation) ||
      coverageJobs.busy
    ) {
      $("full-coverage").checked = settings.fullCoverage;
      return;
    }
    backupLock(true);
    $("coverage-status").textContent =
      "Сохраняем текущие зоны перед заполнением…";
    try {
      const previous = await makeProjectBackup();
      if (disposed) return;
      await L.install([], { checkpoint: previous });
      if (disposed) return;
      if (coverageError) resetCoverage();
      settings.fullCoverage = true;
      settings.showEmpty = true;
      settings.showZones = true;
      settings.mapColor = "organization";
      $("org-search").value = "";
      selected = null;
      $("detail-panel").hidden = true;
      partitionRevision++;
      render();
      showView("map");
      toast(
        "Копия до заполнения сохранена в браузере. Её можно скачать в разделе «Резервные копии».",
      );
    } catch (error) {
      if (disposed) return;
      toast("Не удалось сохранить копию перед заполнением: " + error.message);
      $("full-coverage").checked = settings.fullCoverage;
    } finally {
      backupLock(false);
      updateCoverageStatus();
    }
  }
  const projectDataset = B.digest({
    organizations: data.organizations.map((o) => ({
      id: o.id,
      location: o.location,
    })),
    groups: [...territoryIndex.byOrganization].map(([id, groups]) => [
      id,
      groups.map((g) => [g.id, g.address]),
    ]),
  });
  const backupText = (counts) =>
    `Адресов: ${fmt(counts.addresses)}; неподтверждённых: ${fmt(counts.failed)}; готовых зон: ${fmt(counts.zones)}; зон полного покрытия: ${fmt(counts.coverageZones)}; маршрутов: ${fmt(counts.routes)}.`;
  async function makeProjectBackup() {
    await cacheReady;
    const dataset = await projectDataset;
    if (disposed) throw new DOMException("Остановлено", "AbortError");
    return B.create({
      settings: validateSettings({
        ...settings,
        selectedOrganization: selected,
      }),
      routing: accessibility.settings(),
      records: localRecords(),
      dataset,
    });
  }
  function backupLock(value) {
    if (disposed) return;
    backupWorking = value;
    for (const id of [
      "backup-export",
      "backup-apply",
      "backup-file",
      "local-data-file",
      "backup-mode",
    ])
      $(id).disabled = value;
    $("full-coverage").disabled =
      value ||
      !localLoaded ||
      busy ||
      coverageJobs.busy ||
      coverageSaving ||
      accessibility.busy;
  }
  async function openBackup({ isCurrent = () => !disposed } = {}) {
    await cacheReady;
    if (disposed || !isCurrent()) return;
    const previous = await L.checkpoint().catch(() => null);
    if (disposed || !isCurrent()) return;
    $("backup-current").textContent =
      "Текущий проект. " + backupText(B.summary(localRecords()));
    $("backup-previous").disabled = !previous;
    if (!$("backup-dialog").open) $("backup-dialog").showModal();
  }
  async function exportBackup() {
    if (disposed || backupWorking) return;
    backupLock(true);
    ui.setStatus(
      "backup-status",
      "Готовим полную копию и контрольную сумму…",
      "info",
    );
    try {
      const backup = await makeProjectBackup();
      if (disposed) return;
      download(
        JSON.stringify(backup),
        `hospital-project-${backup.createdAt.replace(/[:.]/g, "-")}.json`,
        "application/json",
      );
      ui.setStatus(
        "backup-status",
        "Копия подготовлена для скачивания. " + backupText(backup.summary),
        "success",
      );
    } catch (error) {
      if (disposed) return;
      ui.setStatus("backup-status", error.message, "error");
      toast(error.message);
    } finally {
      backupLock(false);
    }
  }
  async function previewBackup(event) {
    const target = event.target,
      file = target.files[0];
    if (!file) return;
    const revision = ++backupPreviewRevision,
      current = () => !disposed && revision === backupPreviewRevision;
    pendingBackup = null;
    $("backup-preview").hidden = true;
    backupLock(true);
    ui.setStatus(
      "backup-status",
      "Читаем файл и проверяем контрольную сумму…",
      "info",
    );
    try {
      await openBackup({ isCurrent: current });
      if (!current()) return;
      if (file.size > B.MAX_BYTES)
        throw new Error("Максимальный размер резервной копии — 100 МБ.");
      const text = await file.text();
      if (!current()) return;
      const input = JSON.parse(text),
        dataset = await projectDataset;
      if (!current()) return;
      const prepared = await B.prepare(input, {
        data,
        index: territoryIndex,
        validateSettings,
        validateRouting: AccessibilityUI.validateSettings,
        dataset,
      });
      if (!current()) return;
      pendingBackup = prepared;
      $("backup-preview-summary").textContent =
        backupText(prepared.summary) +
        (prepared.createdAt
          ? " Дата: " +
            new Date(prepared.createdAt).toLocaleString("ru-RU") +
            "."
          : "");
      $("backup-warning").textContent =
        (prepared.legacy
          ? "Старая версия копии: без контрольной суммы и настроек маршрутизации. "
          : "") +
        (prepared.datasetMismatch
          ? "Исходный набор проекта отличается. Известные записи сопоставлены; несовместимые контуры будут пересчитаны. "
          : "") +
        (prepared.invalid
          ? "Пропущено или объединено записей: " + fmt(prepared.invalid) + ". "
          : "") +
        "Данные ещё не изменены. Настройки выбранной копии применятся при восстановлении.";
      $("backup-preview").hidden = false;
      ui.setStatus(
        "backup-status",
        "Файл проверен. Выберите способ восстановления.",
        "success",
      );
    } catch (error) {
      if (current())
        ui.setStatus(
          "backup-status",
          error.message || "Не удалось прочитать копию.",
          "error",
        );
    } finally {
      if (current()) backupLock(false);
      if (target.files?.[0] === file) target.value = "";
    }
  }
  $("open-backup").onclick = openBackup;
  $("close-backup").onclick = () => $("backup-dialog").close();
  $("backup-export").onclick = exportBackup;
  $("export-local-data").onclick = async () => {
    await openBackup();
    await exportBackup();
  };
  $("export-local-data").textContent = "Скачать полную копию проекта";
  $("backup-file").onchange = previewBackup;
  $("local-data-file").onchange = previewBackup;
  $("backup-previous").onclick = async () => {
    try {
      const previous = await L.checkpoint();
      if (disposed) return;
      if (!previous) throw new Error("Предыдущая копия ещё не создана.");
      download(
        JSON.stringify(previous),
        "hospital-project-before-change.json",
        "application/json",
      );
    } catch (error) {
      if (!disposed) ui.setStatus("backup-status", error.message, "error");
    }
  };
  $("backup-apply").onclick = async () => {
    if (disposed || !pendingBackup || backupWorking) return;
    const plan = pendingBackup,
      replace = $("backup-mode").value === "replace";
    backupLock(true);
    ui.setStatus(
      "backup-status",
      "Сохраняем текущую версию и восстанавливаем данные…",
      "info",
    );
    try {
      if (busy || accessibility.busy)
        throw new Error(
          "Остановите поиск и расчёт маршрутов перед восстановлением.",
        );
      const previous = await makeProjectBackup();
      if (disposed) return;
      const records = replace
        ? plan.records
        : B.merge(localRecords(), plan.records);
      await L.install(records, { replace: true, checkpoint: previous });
      if (disposed) return;
      settings.fullCoverage = false;
      resetCoverage();
      partitionJobs.restart();
      ruleLocations.clear();
      ruleAttempts.clear();
      ruleFailures.clear();
      orgLocations.clear();
      geocodeCache.clear();
      zoneGeometryCache.clear();
      settings = plan.settings;
      selected = settings.selectedOrganization;
      addressRevision++;
      requestedRevision = -1;
      requestedGeometry = null;
      savedZoneSnapshot =
        records.find((r) => r.key === "geometry:zones-v1") || null;
      zoneStorageState = savedZoneSnapshot ? "saved" : "missing";
      savedCoverageSnapshot =
        records.find((r) => r.key === "geometry:coverage-v1") || null;
      applyLocal(L.restore(records, data, territoryIndex));
      accessibility.restore(records, { replace: true });
      if (plan.routing) accessibility.restoreSettings(plan.routing);
      save();
      cacheProblem = null;
      render();
      showCacheStatus();
      updateBulkProgress("Восстановлено. ");
      ui.setStatus(
        "backup-status",
        "Проект восстановлен. " +
          backupText(B.summary(records)) +
          " Предыдущая версия доступна для скачивания.",
        "success",
      );
      $("backup-current").textContent =
        "Текущий проект. " + backupText(B.summary(records));
      pendingBackup = null;
      $("backup-preview").hidden = true;
      $("backup-previous").disabled = false;
    } catch (error) {
      if (disposed) return;
      ui.setStatus(
        "backup-status",
        error.message || "Не удалось восстановить проект.",
        "error",
      );
    } finally {
      backupLock(false);
    }
  };
  ui.setData("source-list", data.sources);
  ui.setData("quality-notes", [
    ...data.notes,
    "У ГКБ № 2 повторяются номера терапевтических участков 13, 17 и 18. Строки сохранены отдельно.",
    "В смешанных категориях Щёкинской больницы 15 451 прикреплённый без разделения по возрасту.",
  ]);
  let savedKeys = null;
  try {
    const keys = JSON.parse(
      localStorage.getItem("hospital-map-keys") || "null",
    );
    if (keys?.map) {
      savedKeys = keys;
      $("api-key").value = keys.map;
      $("geocoder-key").value = keys.geocoder || "";
      routingInput.value = keys.routing || "";
      $("remember-key").checked = true;
    }
  } catch (_) {}
  render();
  cacheReady = restoreLocal();
  cacheReady.then(() => {
    if (!disposed && savedKeys?.map)
      return connect(savedKeys.map, savedKeys.geocoder || "", {
        verify: false,
        routingKey: savedKeys.routing || "",
      });
  });

  return () => {
    if (disposed) return;
    disposed = true;
    cancelRequested = true;
    mapEpoch++;
    lifecycle.abort();
    for (const controller of activeRequests) controller.abort();
    activeRequests.clear();
    accessibility.dispose();
    partitionJobs.dispose();
    coverageJobs.dispose();
    for (const id of timeouts) window.clearTimeout(id);
    for (const id of intervals) window.clearInterval(id);
    timeouts.clear();
    intervals.clear();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    ui.clearCommands();
    mapHost.destroy();
    map = null;
    mapSdkRelease();
  };
}
