import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import * as UI from "./DeveloperUI";
export function CalculationSidebar() {
  const store = UI.useUI();
  return (
    <aside className="sidebar routing-sidebar" aria-label="Расчёт доступности">
      <div className="sidebar-top">
        <p className="eyebrow">Тульская область</p>
        <h2>Время до больницы</h2>
        <p className="small muted">
          Расчёт для всех больниц — на машине и пешком.
        </p>
      </div>
      <section id="access-panel" className="routing-calculation">
        <Label htmlFor="access-step">Размер сетки</Label>
        <UI.Select
          id="access-step"
          options={[
            { value: 5000, label: "5 км" },
            { value: 10000, label: "10 км" },
            { value: 20000, label: "20 км" },
          ]}
        />
        <UI.Button id="access-calculate" className="full">
          Рассчитать всю область
        </UI.Button>
        <UI.Button id="access-stop" variant="outline" className="full">
          Остановить расчёт
        </UI.Button>
        <UI.Progress
          id="access-progress"
          aria-label="Прогресс полного расчёта"
        />
        <UI.Text
          id="access-status"
          className="routing-status"
          role="status"
          aria-live="polite"
        />
        <UI.Text id="access-summary" className="small muted" />
        <div id="access-results" className="travel-results">
          <UI.Data id="access-results">
            {(results: any[]) =>
              (results ?? []).map((result) => (
                <div className="travel-result" key={result.mode}>
                  <span>{result.label}</span>
                  <strong>
                    {result.count.toLocaleString("ru-RU")} /{" "}
                    {result.total.toLocaleString("ru-RU")}
                  </strong>
                  <small>
                    OSRM: {result.measured.toLocaleString("ru-RU")} · ≈{" "}
                    {result.neighbor + result.distance}
                    {result.missing
                      ? " · нет координат: " + result.missing
                      : ""}
                  </small>
                </div>
              ))
            }
          </UI.Data>
        </div>
        <UI.Text id="access-fill-note" className="small muted" />
      </section>
      <div className="routing-help">
        <strong>Как читать карту</strong>
        <p>
          Цвет показывает время до закреплённой больницы. Нажмите на ячейку для
          подробностей. Значения ≈ получены заполнением пропусков.
          В пешем режиме цветом показана доступность до 60 минут включительно,
          остальные ячейки показаны серым.
          Счётчики включают все рассчитанные значения.
        </p>
      </div>
      <Separator />
      <details id="legacy-map-controls" className="advanced-map-controls">
        <summary>Организации и границы</summary>
        <div className="sidebar-top">
          <h2>
            Организации <UI.Text as="span" id="org-count" className="count" />
          </h2>
          <Label htmlFor="org-search">Найти организацию</Label>
          <UI.Input
            type="search"
            id="org-search"
            placeholder="Название или населённый пункт…"
          />
        </div>
        <details id="coverage-panel" className="coverage-panel" open>
          <summary>Покрытие области</summary>
          <UI.Switch id="full-coverage">Полное покрытие области</UI.Switch>
          <UI.Progress
            id="coverage-progress"
            aria-label="Ход заполнения области"
          />
          <UI.Text
            id="coverage-status"
            className="small muted"
            role="status"
            aria-live="polite"
          />
          <UI.Section id="coverage-source" as="p" className="small muted">
            Граница: ©{" "}
            <a
              href="https://www.openstreetmap.org/relation/81993"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap contributors
            </a>{" "}
            · ODbL. Расстояния по прямой, без учёта дорог.
          </UI.Section>
        </details>
        <div className="filter-block">
          <Label htmlFor="map-color">Цвет на карте</Label>
          <UI.Select
            id="map-color"
            options={[
              { value: "load", label: "По численности прикреплённых" },
              { value: "organization", label: "По больнице закрепления" },
            ]}
          />
          <Label htmlFor="metric">Показатель численности</Label>
          <UI.Select
            id="metric"
            options={[
              { value: "per1000", label: "Прикреплённых на 1 000 жителей" },
              { value: "perArea", label: "Прикреплённых на запись участка" },
              { value: "absolute", label: "Всего прикреплённых" },
            ]}
          />
          <UI.Text id="metric-description" className="small muted" />
          <UI.Switch id="include-mixed">
            Включать категории «взрослые, дети»
          </UI.Switch>
          <UI.Switch id="show-empty">
            Показать организации без численности
          </UI.Switch>
        </div>
        <UI.Text
          id="territory-summary"
          className="small muted territory-summary"
        />
        <div id="org-list" className="org-list" aria-label="Список организаций">
          <UI.Data id="org-list">
            {(organizations: any[]) =>
              organizations?.length ? (
                organizations.map((organization) => (
                  <Button
                    variant="ghost"
                    key={organization.id}
                    className={
                      "org-item" + (organization.selected ? " selected" : "")
                    }
                    aria-pressed={organization.selected}
                    onClick={() => {
                      void store.invoke(
                        "select-organization",
                        "click",
                        organization.id,
                      );
                    }}
                  >
                    <i
                      className="dot"
                      style={{ background: organization.color }}
                    />
                    <span>
                      <span className="org-name">{organization.name}</span>
                      <span className="org-meta">
                        <span>{organization.attached}</span>
                        <span className="org-value">{organization.value}</span>
                      </span>
                    </span>
                  </Button>
                ))
              ) : (
                <p className="empty">
                  Организации не найдены. Измените поиск или фильтры.
                </p>
              )
            }
          </UI.Data>
        </div>
        <div className="sidebar-bottom">
          <UI.Switch id="allow-geocoder">
            Разрешить новый поиск адресов
          </UI.Switch>
          <p className="small muted">
            Без разрешения используются сохранённые точки. Подключение карты не
            проверяет геокодер.
          </p>
          <UI.Button id="locate-all-addresses" className="full">
            Найти все адреса и построить зоны
          </UI.Button>
          <UI.Section id="bulk-progress" as="div" className="bulk-progress">
            <UI.Progress
              id="bulk-progress-bar"
              aria-label="Проверено адресов"
            />
            <UI.Text
              id="bulk-progress-label"
              role="status"
              aria-live="polite"
            />
          </UI.Section>
          <p className="small muted">
            Поиск охватывает все больницы независимо от фильтров: до четырёх
            запросов одновременно. Результаты сохраняются локально; поиск можно
            продолжить после перезагрузки. Действуют лимиты геокодера.
          </p>
          <UI.Text id="local-data-status" className="small muted" role="status">
            Локальные данные: загрузка…
          </UI.Text>
          <UI.Button id="locate-all" variant="outline" className="full">
            Найти организации на карте
          </UI.Button>
        </div>
      </details>
    </aside>
  );
}
