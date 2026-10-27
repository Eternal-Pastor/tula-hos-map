import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  LoaderCircle,
  Map,
  Maximize,
  Square,
  Table2,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppBrand } from "@/components/AppBrand";
import { YandexMap, type YandexMapHost } from "../components/YandexMap";
import { ViewerStore, type ViewerState } from "../services/viewer-store";
import { ViewerMap } from "../services/viewer-map";
import { loadYandex } from "../services/yandex-loader";
import { viewerEngine as V } from "../services/engine";
import type { Hospital, MapMode } from "../types/domain";
import { ViewerLegend } from "./ViewerLegend";
import "../styles.css";
import "../viewer.css";

const fmt = (value: number | null) =>
  Number.isFinite(value)
    ? value!.toLocaleString("ru-RU", { maximumFractionDigits: 1 })
    : "нет данных";
const modes: [MapMode, string][] = [
  ["travel", "Длительность пути"],
  ["zones", "Зоны прикрепления"],
  ["load", "Нагруженность"],
];

function Header() {
  return (
    <header className="header viewer-header">
      <AppBrand subtitle="Больницы Тульской области" />
      <TabsList aria-label="Представление" className="viewer-page-tabs">
        <TabsTrigger
          value="map"
          id="viewer-map-tab"
          aria-controls="viewer-map-page"
          data-page="map"
        >
          <Map aria-hidden="true" />
          Карта
        </TabsTrigger>
        <TabsTrigger
          value="table"
          id="viewer-table-tab"
          aria-controls="viewer-table-page"
          data-page="table"
        >
          <Table2 aria-hidden="true" />
          Таблицы
        </TabsTrigger>
      </TabsList>
    </header>
  );
}

function CalculationPanel({
  state,
  store,
}: {
  state: ViewerState;
  store: ViewerStore;
}) {
  return (
    <section
      id="viewer-calculation"
      className="routing-calculation viewer-calculation"
      hidden={state.mode !== "travel"}
      aria-label="Расчёт времени пути"
    >
      <Label htmlFor="viewer-step">Размер сетки</Label>
      <Select
        value={String(state.step)}
        disabled={state.loading || state.busy || state.gridBusy}
        onValueChange={(value) => void store.changeGrid(Number(value))}
      >
        <SelectTrigger
          id="viewer-step"
          className="w-full"
          aria-describedby="viewer-grid-note"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[5000, 10000, 20000].map((step) => (
            <SelectItem value={String(step)} key={step}>
              {step / 1000} км
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        id="viewer-calculate"
        className="w-full"
        disabled={state.loading || state.busy || state.gridBusy}
        onClick={() => void store.calculate()}
      >
        {(state.busy || state.gridBusy) && (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        )}
        {state.gridBusy
          ? "Подготовка сетки…"
          : state.busy
            ? "Идёт расчёт…"
            : "Рассчитать всю область"}
      </Button>
      {state.busy && (
        <Button
          id="viewer-stop"
          variant="outline"
          className="w-full"
          onClick={store.stop}
        >
          <Square aria-hidden="true" />
          Остановить расчёт
        </Button>
      )}
      {(state.status || state.busy) && (
        <div id="viewer-progress" className="viewer-progress">
          <Progress
            id="viewer-progress-bar"
            value={state.total ? (state.count / state.total) * 100 : 0}
            aria-label="Расчёт маршрутов"
            aria-valuetext={`${fmt(state.count)} из ${fmt(state.total)} маршрутов`}
          />
          <p id="viewer-status" role="status" aria-live="polite">
            {state.status || "Подготовка расчёта…"}
          </p>
        </div>
      )}
    </section>
  );
}

function Sidebar({ state, store }: { state: ViewerState; store: ViewerStore }) {
  return (
    <aside className="sidebar viewer-sidebar" aria-label="Параметры карты">
      <div className="mode-select" role="group" aria-label="Режим карты">
        {modes.map(([mode, label]) => (
          <Button
            key={mode}
            variant={state.mode === mode ? "default" : "outline"}
            data-mode={mode}
            aria-pressed={state.mode === mode}
            onClick={() => store.setMode(mode)}
          >
            {label}
          </Button>
        ))}
      </div>
      <CalculationPanel state={state} store={store} />
      <section
        className="viewer-hospitals"
        aria-labelledby="viewer-hospitals-heading"
      >
        <div className="viewer-section-heading">
          <h3 id="viewer-hospitals-heading">Больницы</h3>
          <Badge
            variant="secondary"
            aria-label={`Количество больниц: ${state.hospitals.length}`}
          >
            {state.hospitals.length}
          </Badge>
        </div>
        <div id="viewer-hospitals" className="viewer-hospital-list">
          {state.loading && !state.hospitals.length && (
            <p className="viewer-field-note" role="status">
              Загрузка данных…
            </p>
          )}
          {state.hospitals.map((hospital) => (
            <Button
              key={hospital.id}
              variant="ghost"
              data-hospital={hospital.id}
              aria-pressed={state.selected === hospital.id}
              className="viewer-hospital-button"
              onClick={() => store.select(hospital.id)}
            >
              <i
                aria-hidden="true"
                className="dot"
                style={{
                  background:
                    state.mode === "load"
                      ? V.COLORS[V.loadBand(hospital.per1000)]
                      : hospital.color,
                }}
              />
              <span>{hospital.name}</span>
            </Button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function HospitalDetail({
  hospital,
  close,
}: {
  hospital?: Hospital;
  close: () => void;
}) {
  if (!hospital) return null;
  return (
    <Card
      id="viewer-detail"
      className="detail-panel viewer-detail"
      role="region"
      aria-labelledby="viewer-detail-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <CardHeader>
        <CardTitle>
          <h2 id="viewer-detail-title">{hospital.name}</h2>
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="detail-close"
          id="viewer-close-detail"
          aria-label="Закрыть карточку больницы"
          onClick={close}
        >
          <X aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="viewer-metrics">
          <div>
            <dt>Прикреплено на 1 000 жителей</dt>
            <dd>{fmt(hospital.per1000)}</dd>
          </div>
          <div>
            <dt>Зона обслуживания</dt>
            <dd>
              {fmt(hospital.areaKm2)}
              {Number.isFinite(hospital.areaKm2) ? " км²" : ""}
            </dd>
          </div>
          <div>
            <dt>Плановая пропускная способность</dt>
            <dd>
              {fmt(hospital.capacity)}
              {Number.isFinite(hospital.capacity) ? (
                <span className="viewer-unit"> посещений / смену</span>
              ) : (
                ""
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function MapWorkspace({
  state,
  store,
}: {
  state: ViewerState;
  store: ViewerStore;
}) {
  const [host, setHost] = useState<YandexMapHost | null>(null);
  const [map, setMap] = useState<ViewerMap | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const latestPage = useRef(state.page);
  const pendingInitialFit = useRef<ViewerMap | null>(null);
  useLayoutEffect(() => {
    latestPage.current = state.page;
  }, [state.page]);
  const onHostReady = useCallback(
    (value: YandexMapHost | null) => setHost(value),
    [],
  );
  useEffect(() => {
    if (!host || state.loading) return;
    let active = true,
      renderer: ViewerMap | undefined;
    setConnecting(true);
    setError(null);
    void loadYandex(window.HospitalViewerConfig.mapKey)
      .then((api) => {
        if (!active) return;
        renderer = new ViewerMap(api, host, store);
        // Яндекс не может подобрать масштаб для скрытой вкладки с нулевым размером.
        pendingInitialFit.current = latestPage.current === "map" ? null : renderer;
        setMap(renderer);
        setConnecting(false);
      })
      .catch((cause) => {
        if (active) {
          setConnecting(false);
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось подключить Яндекс Карты.",
          );
        }
      });
    return () => {
      active = false;
      if (pendingInitialFit.current === renderer) pendingInitialFit.current = null;
      renderer?.dispose();
      setMap(null);
    };
  }, [host, state.loading, retry, store]);
  useEffect(() => {
    if (map)
      void map
        .draw()
        .catch(() =>
          setError("Не удалось обновить карту. Повторите подключение."),
        );
  }, [map, state.revision]);
  useEffect(() => {
    if (state.page !== "map" || !map) return;
    map.resize();
    if (pendingInitialFit.current === map) {
      pendingInitialFit.current = null;
      map.fit();
    }
  }, [map, state.page]);
  return (
    <div className="map-workspace">
      <YandexMap
        id="map"
        ariaLabel="Карта больниц Тульской области"
        onHostReady={onHostReady}
      />
      {(state.loading || connecting) && !error && !state.error && (
        <div id="viewer-loading" className="viewer-loading" role="status">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          <span>
            {state.loading ? "Загрузка данных…" : "Подключение Яндекс Карт…"}
          </span>
        </div>
      )}
      {(error || state.error) && (
        <Alert id="viewer-error" className="viewer-error">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>
            {state.error
              ? "Не удалось завершить действие"
              : "Карта не подключена"}
          </AlertTitle>
          <AlertDescription>
            <p id="viewer-error-text">{state.error || error}</p>
            <Button
              id="viewer-retry"
              variant="outline"
              size="sm"
              onClick={() => {
                if (state.error) void store.start();
                else setRetry((value) => value + 1);
              }}
            >
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="map-toolbar">
        <Button
          id="viewer-fit"
          variant="outline"
          disabled={!map}
          onClick={() => map?.fit()}
        >
          <Maximize aria-hidden="true" />
          Вся область
        </Button>
      </div>
      <HospitalDetail
        hospital={state.hospitals.find(
          (hospital) => hospital.id === state.selected,
        )}
        close={() => store.select(null)}
      />
      <ViewerLegend state={state} store={store} />
    </div>
  );
}

function HospitalTable({
  state,
  store,
}: {
  state: ViewerState;
  store: ViewerStore;
}) {
  return (
    <TabsContent
      value="table"
      forceMount
      id="viewer-table-page"
      aria-labelledby="viewer-table-tab"
      className="view table-view viewer-table"
      hidden={state.page !== "table"}
    >
      <div className="page-heading">
        <div>
          <h2>Больницы</h2>
          <p className="viewer-field-note">
            Выберите больницу, чтобы открыть её карточку на карте.
          </p>
        </div>
        <Badge variant="outline">{state.hospitals.length}</Badge>
      </div>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Таблица больниц, прокручивается по горизонтали"
      >
        <Table aria-label="Показатели больниц Тульской области">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Больница</TableHead>
              <TableHead scope="col" className="numeric">
                Прикреплено на 1 000 жителей
              </TableHead>
              <TableHead scope="col" className="numeric">
                Зона обслуживания, км²
              </TableHead>
              <TableHead scope="col" className="numeric">
                Плановая пропускная способность,
                <br />
                посещений / смену
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody id="viewer-table">
            {state.hospitals.map((hospital) => (
              <TableRow key={hospital.id}>
                <TableCell>
                  <Button
                    variant="link"
                    className="viewer-table-link"
                    data-table-hospital={hospital.id}
                    onClick={() => store.select(hospital.id)}
                  >
                    {hospital.name}
                  </Button>
                </TableCell>
                <TableCell className="numeric">
                  {fmt(hospital.per1000)}
                </TableCell>
                <TableCell className="numeric">
                  {fmt(hospital.areaKm2)}
                </TableCell>
                <TableCell className="numeric">
                  {fmt(hospital.capacity)}
                </TableCell>
              </TableRow>
            ))}
            {!state.hospitals.length && (
              <TableRow>
                <TableCell colSpan={4}>
                  {state.loading
                    ? "Загрузка данных…"
                    : state.error ||
                      "Данные о больницах недоступны. Перейдите на карту и повторите загрузку."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </TabsContent>
  );
}

function ViewerApp() {
  const [store] = useState(() => new ViewerStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.start();
    return () => store.dispose();
  }, [store]);
  return (
    <Tabs
      className="viewer-app"
      value={state.page}
      onValueChange={(value) => store.setPage(value as ViewerState["page"])}
    >
      <Header />
      <main>
        <TabsContent
          value="map"
          forceMount
          id="viewer-map-page"
          aria-labelledby="viewer-map-tab"
          className="view map-layout viewer-layout"
          hidden={state.page !== "map"}
        >
          <Sidebar state={state} store={store} />
          <MapWorkspace state={state} store={store} />
        </TabsContent>
        <HospitalTable state={state} store={store} />
      </main>
    </Tabs>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ViewerApp />
  </StrictMode>,
);
