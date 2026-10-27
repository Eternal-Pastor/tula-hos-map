import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import * as UI from "./DeveloperUI";
const fmt = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "нет данных"
    : value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
export function OrganizationDetail() {
  return (
    <UI.Section id="detail-panel" as="div" className="detail-panel">
      <UI.Data id="detail-panel">
        {(detail: any) => {
          if (!detail) return null;
          const {
            organization: o,
            population: p,
            location: loc,
            zone,
          } = detail;
          return (
            <>
              <UI.Button
                id="close-detail"
                variant="ghost"
                size="icon"
                className="detail-close"
                aria-label="Закрыть карточку"
              >
                <X />
              </UI.Button>
              <p className="eyebrow">Организация</p>
              <h2>{o.shortName}</h2>
              <Badge variant="outline">
                <i className="dot" style={{ background: detail.color }} />
                {detail.metric}
              </Badge>
              <div className="stats-grid">
                <div>
                  <div className="stat-value">{detail.attached}</div>
                  <div className="stat-label">
                    прикреплено по выбранным категориям
                  </div>
                </div>
                <div>
                  <div className="stat-value">{detail.areaCount}</div>
                  <div className="stat-label">
                    записей терапевтических участков
                  </div>
                </div>
              </div>
              {detail.warning.length > 0 && (
                <Alert>
                  <AlertDescription>
                    {detail.warning.map((warning: string) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              <div className="detail-section">
                <h3>Территория для поправки на население</h3>
                <Label htmlFor="detail-population">Город или район</Label>
                <UI.Select
                  id="detail-population"
                  options={[
                    { value: "", label: "Не выбрана" },
                    ...detail.populations,
                  ]}
                />
                {p ? (
                  <>
                    <Label htmlFor="population-value">
                      Население территории, человек
                    </Label>
                    <UI.Input
                      id="population-value"
                      type="number"
                      min="1"
                      step="1"
                    />
                    <UI.Button id="save-population" variant="outline">
                      Применить численность
                    </UI.Button>
                    <p className="coordinate-note">
                      Данные пользователя, дата не указана. Привязка территории
                      предварительная. Город и район не суммируются.
                    </p>
                  </>
                ) : (
                  <p className="small muted">
                    Выберите территорию, чтобы включить организацию в
                    относительную шкалу.
                  </p>
                )}
              </div>
              <div className="detail-section">
                <h3>Зона обслуживания больницы</h3>
                <p>
                  {fmt(o.territoryRuleCount)} правил домов · {fmt(zone.total)}{" "}
                  улиц и населённых пунктов
                </p>
                <p className="coordinate-note">
                  По адресным спискам DOCX для взрослого и смешанного населения.
                  Полигональных границ в источнике нет.
                </p>
                <p id="polygon-status" className="coordinate-note">
                  {detail.outlineStatus}
                </p>
                <p className="zone-progress">
                  Найдено {zone.found} из {zone.total}. Не подтверждено:{" "}
                  {zone.failed}. Осталось: {zone.remaining}.
                </p>
                {detail.sharedCount > 0 && (
                  <Alert>
                    <AlertDescription>
                      {detail.sharedCount} адресов встречаются и у других
                      больниц. Дома могут быть разделены диапазонами или
                      чётностью; список сохраняет эти правила.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="button-row">
                  <UI.Button id="show-rules" variant="outline">
                    Найти следующие 20 адресов
                  </UI.Button>
                  <UI.Button id="fit-zone" variant="outline">
                    Показать найденную часть зоны
                  </UI.Button>
                  <UI.Button id="open-addresses" variant="outline">
                    Улицы и дома зоны
                  </UI.Button>
                  {zone.failed > 0 && (
                    <>
                      <UI.Button id="review-rules" variant="outline">
                        Неподтверждённые адреса
                      </UI.Button>
                      <UI.Button id="retry-rules" variant="outline">
                        Повторить ненайденные
                      </UI.Button>
                    </>
                  )}
                </div>
              </div>
              <div className="detail-section">
                <h3>Положение на карте</h3>
                <p className="small">{o.mapQueryType}</p>
                <p className="coordinate-note">
                  {o.mapQuery ||
                    "Адрес не указан в файле; положение задано координатами."}
                </p>
                {loc ? (
                  <>
                    <p className="coordinate-note">
                      {loc.label}
                      <br />
                      {fmt(loc.coords[0], 6)}, {fmt(loc.coords[1], 6)}
                    </p>
                    <p className="coordinate-note">
                      Эта точка используется для маркера и конечной точки
                      маршрутов.
                    </p>
                  </>
                ) : (
                  <p className="coordinate-note">Координаты ещё не получены.</p>
                )}
                {detail.colocated.length > 0 && (
                  <Alert>
                    <AlertDescription>
                      Та же точка указана для: {detail.colocated.join("; ")}.
                      Организации и их зоны сохранены отдельно.
                    </AlertDescription>
                  </Alert>
                )}
                <UI.Button id="locate-one" variant="outline">
                  Показать больницу
                </UI.Button>
                <details>
                  <summary>Указать проверенные координаты</summary>
                  <div className="inline-fields">
                    <div>
                      <Label htmlFor="manual-lat">Широта</Label>
                      <UI.Input
                        id="manual-lat"
                        type="number"
                        step="any"
                        min="-90"
                        max="90"
                      />
                    </div>
                    <div>
                      <Label htmlFor="manual-lon">Долгота</Label>
                      <UI.Input
                        id="manual-lon"
                        type="number"
                        step="any"
                        min="-180"
                        max="180"
                      />
                    </div>
                  </div>
                  <UI.Button id="save-coordinates" variant="outline">
                    Применить координаты
                  </UI.Button>
                  {o.location && loc?.kind === "manual" && (
                    <UI.Button id="reset-coordinates" variant="outline">
                      Вернуть координаты из файла
                    </UI.Button>
                  )}
                </details>
              </div>
              <div className="detail-section">
                <h3>Плановая пропускная способность</h3>
                <p>
                  <strong>
                    {fmt(detail.plannedCapacity)} посещений / смену
                  </strong>
                </p>
                {o.capacity.length ? (
                  <ul className="mini-list">
                    {o.capacity.map((branch: any, index: number) => (
                      <li key={index}>
                        <span>{branch.branch}</span>
                        <strong>{fmt(branch.total)} / смену</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">
                    Однозначного сопоставления с формой мощности нет.
                  </p>
                )}
                <p className="coordinate-note">
                  Сумма плановой мощности сопоставленных подразделений по всем
                  профилям, форма 30 на 01.01.2026. Число смен и спрос пока не
                  заданы, загрузка не рассчитана. Проверьте состав филиалов и
                  соответствие зоне обслуживания.
                </p>
              </div>
              <div className="detail-section">
                <h3>Записи участков</h3>
                {o.areas.length ? (
                  <>
                    <ul className="mini-list">
                      {o.areas.slice(0, 6).map((area: any, index: number) => (
                        <li key={index}>
                          <span>
                            {area.number}
                            {area.duplicate ? " · повтор номера" : ""}
                          </span>
                          <strong>{fmt(area.attached)}</strong>
                        </li>
                      ))}
                    </ul>
                    <UI.Button id="open-areas" variant="link">
                      Все записи участков
                    </UI.Button>
                  </>
                ) : (
                  <p className="small muted">
                    Нет записей терапевтических участков.
                  </p>
                )}
                <p className="coordinate-note">
                  ID организации для импорта: {o.id}
                </p>
              </div>
            </>
          );
        }}
      </UI.Data>
    </UI.Section>
  );
}
