import { MapPinned, RotateCcw, ShieldCheck, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { YandexMap, type YandexMapHost } from "../components/YandexMap";
import { OrganizationDetail } from "./OrganizationDetail";
import * as UI from "./DeveloperUI";
const travelBands = [
  ["#2f9e62", "≤ 15 мин"],
  ["#d8b42a", "15–30 мин"],
  ["#e48335", "30–60 мин"],
  ["#d64a4a", "> 60 мин"],
  ["#9ba6aa", "нет координат"],
];
export function DeveloperMap({
  onHostReady,
}: {
  onHostReady: (host: YandexMapHost | null) => void;
}) {
  const store = UI.useUI(),
    travel = UI.useField("travel-mode"),
    restore = UI.useField("restore-progress");
  return (
    <div
      className={
        "map-workspace" + (store.data("access-active") ? " access-active" : "")
      }
    >
      <YandexMap
        id="map"
        ariaLabel="Карта Тульской области"
        onHostReady={onHostReady}
      />
      <UI.Section id="map-placeholder" as="div" className="map-placeholder">
        <div>
          <MapPinned className="placeholder-icon" aria-hidden="true" />
          <h2>Территории обслуживания</h2>
          <UI.Text id="cached-placeholder">
            Подключите Яндекс Карты для отображения результатов. Расчёт и
            таблицы доступны без подложки.
          </UI.Text>
          <UI.Button id="connect-map">Подключить карту</UI.Button>
        </div>
      </UI.Section>
      <div className="map-toolbar">
        <UI.Button id="stop-loading" variant="outline">
          Остановить поиск
        </UI.Button>
        <UI.Button id="fit-map" variant="outline">
          <MapPinned />
          Вся область
        </UI.Button>
        <UI.Button id="fill-coverage" variant="outline">
          Заполнить пробелы
        </UI.Button>
        <UI.Button id="open-backup" variant="outline">
          <ShieldCheck />
          Резервные копии
        </UI.Button>
        <UI.File
          id="geojson-file"
          label="Загрузить границы / точки"
          accept=".json,.geojson,application/json"
        />
      </div>
      <div className="map-message">
        <UI.Text id="map-message" as="div" role="status" aria-live="polite">
          Нет координат и границ в исходных файлах. Адресные списки доступны в
          карточках.
        </UI.Text>
        <section
          id="restore-progress"
          className={
            "restore-progress" +
            (restore.complete ? " restore-complete" : "") +
            (restore.error ? " restore-error" : "")
          }
          aria-label="Прогресс восстановления"
        >
          <div className="restore-progress-heading">
            <span className="inline-flex items-center gap-2">
              {restore.error && (
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              )}
              <UI.Text id="restore-progress-title" as="strong">
                Восстановление · этап 1 из 4
              </UI.Text>
            </span>
            <UI.Text id="restore-progress-counts" as="span" />
          </div>
          <UI.Progress
            id="restore-progress-bar"
            aria-label="Ход восстановления локальных векторов"
          />
          <UI.Text id="restore-progress-label" role="status" aria-live="polite">
            Читаем сохранённые данные…
          </UI.Text>
          <UI.Button id="restart-zone-calculation" variant="outline">
            <RotateCcw />
            Перезапустить расчёт зон
          </UI.Button>
        </section>
      </div>
      <OrganizationDetail />
      <UI.Section
        id="access-legend"
        as="div"
        className="map-legend access-legend"
      >
        <div
          className="travel-mode-tabs"
          role="group"
          aria-label="Показать результат"
        >
          {[
            ["auto", "На машине"],
            ["pedestrian", "Пешком"],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant={travel.value === value ? "default" : "outline"}
              aria-pressed={travel.value === value}
              onClick={() => {
                void store.change("travel-mode", value);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="legend-title">
          <strong>Время до закреплённой больницы</strong>
          <UI.Text id="access-legend-mode" as="span" />
        </div>
        <div className="legend-bands">
          {(travel.value === "pedestrian"
            ? [...travelBands.slice(0, 3), [travelBands[4][0], "Вне часа / нет данных"]]
            : travelBands).map(([color, label]) => (
            <span className="legend-band" key={label}>
              <i className="dot" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        <UI.Text id="access-legend-detail" className="small muted" />
        <UI.Text id="access-legend-method" className="small muted" />
      </UI.Section>
      <div className="map-legend base-legend">
        <div className="legend-title">
          <UI.Text id="legend-heading" as="span">
            Относительная численность
          </UI.Text>
          <UI.Text id="legend-caption" as="span">
            Цвет не означает перегрузку
          </UI.Text>
        </div>
        <div className="zone-layer-controls">
          <UI.Switch id="show-zones">Векторные зоны</UI.Switch>
          <UI.Switch id="show-address-points">Адресные точки</UI.Switch>
        </div>
        <p id="zone-layer-description" className="small muted zone-layer-note">
          Пунктир — приблизительная граница по найденным адресам. Зоны не
          накладываются; пробелы означают неопределённость.
        </p>
        <div id="legend-bands" className="legend-bands">
          <UI.Data id="legend-bands">
            {(bands: any[]) =>
              (bands ?? []).map((band, index) => (
                <span className="legend-band" key={index}>
                  <i className="dot" style={{ background: band.color }} />
                  {band.label}
                </span>
              ))
            }
          </UI.Data>
        </div>
        <UI.Text
          id="zone-topology-note"
          className="small muted zone-layer-note"
        />
        <UI.Text id="legend-note" className="small muted" />
        <UI.Section id="zone-key" as="details" className="zone-key">
          <UI.Text id="zone-key-summary" as="summary">
            Цвета построенных зон
          </UI.Text>
          <div id="zone-key-items">
            <UI.Data id="zone-key-items">
              {(zones: any[]) =>
                (zones ?? []).map((zone) => (
                  <Button
                    key={zone.id}
                    variant="ghost"
                    className="zone-key-item"
                    onClick={() => {
                      void store.invoke("select-zone", "click", zone.id);
                    }}
                  >
                    <i className="dot" style={{ background: zone.color }} />
                    <span>{zone.name}</span>
                  </Button>
                ))
              }
            </UI.Data>
          </div>
        </UI.Section>
      </div>
    </div>
  );
}
