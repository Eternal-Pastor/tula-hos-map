import type { YandexPoint } from "../types/domain";

export type TableKind =
  | "organizations"
  | "areas"
  | "territories"
  | "addresses"
  | "capacity"
  | "population";

export interface TableRequest {
  kind: TableKind;
  organizationId?: string;
  search?: string;
}

interface CapacityBlock {
  organization: string;
  branch: string;
  total: number | null;
  adultMixed: number | null;
  sourceRow: number;
}

interface AddressRule {
  address: string;
  houses: string;
  sourceRow: number;
}

export interface TableOrganization {
  id: string;
  shortName: string;
  areas: readonly {
    number: string;
    category: string;
    attached: number | null;
    duplicate: boolean;
    sourceRow: number;
  }[];
  territories: readonly {
    category: string;
    table: number;
    rules: readonly AddressRule[];
  }[];
  capacity: readonly CapacityBlock[];
  location?: { address?: string };
}

interface TerritoryGroup {
  id: string;
  key: string;
  organizationId: string;
  address: string;
  rules: readonly (AddressRule & { table: number })[];
}

export interface TableSource {
  data: {
    organizations: readonly TableOrganization[];
    populations: readonly {
      id: string;
      name: string;
      type: string;
      value: number | null;
    }[];
    capacityBlocks: readonly CapacityBlock[];
  };
  territoryIndex: {
    byOrganization: ReadonlyMap<string, readonly TerritoryGroup[]>;
    byAddress: ReadonlyMap<string, readonly TerritoryGroup[]>;
    shared: readonly unknown[];
    organizationCount: number;
  };
  organizationValues: ReadonlyMap<
    string,
    {
      attached: number | null;
      population: { name: string; value: number | null } | null;
      metric: number | null;
      coords: YandexPoint | null;
    }
  >;
  metricLabel: string;
  populationValues: Readonly<Record<string, number>>;
  ruleLocations: ReadonlyMap<string, string>;
  ruleAttempts: ReadonlySet<string>;
  ruleFailures: ReadonlyMap<string, string>;
}

export type TableCell = string | number | null;
export interface TableData {
  headers: string[];
  rows: TableCell[][];
  description: string;
}

/** Presentation rows only: metric and location decisions remain with their owner. */
export function buildTable(source: TableSource, request: TableRequest): TableData {
  const { data, territoryIndex } = source;
  const orgId = request.organizationId;
  const orgs = data.organizations.filter((o) => !orgId || o.id === orgId);
  let headers: string[], rows: TableCell[][], description: string;

  if (request.kind === "organizations") {
    headers = ["Организация", "Прикреплено", "Записей участков", "Территория населения", "Население", "Показатель", "ID", "Широта", "Долгота", "Адрес объекта"];
    rows = orgs.map((o) => {
      const values = source.organizationValues.get(o.id);
      if (!values) throw new Error(`Нет значений таблицы для организации ${o.id}.`);
      const p = values.population;
      return [o.shortName, values.attached, o.areas.length || null, p?.name || "Не выбрана", p?.value ?? null, values.metric, o.id, values.coords?.[0] ?? null, values.coords?.[1] ?? null, o.location?.address || "Не указан"];
    });
    description = "Показатель: " + source.metricLabel + ". Отсутствующая численность не заменяется нулём. Числа отражают записи исходной книги; повторы номеров не удалены.";
  } else if (request.kind === "areas") {
    headers = ["Организация", "Участок", "Категория", "Прикреплено", "Замечание", "Источник"];
    rows = orgs.flatMap((o) => o.areas.map((a) => [o.shortName, a.number, a.category, a.attached, a.duplicate ? "Повтор номера внутри организации" : "", `Исходные данные.xlsx · Лист1 · строка ${a.sourceRow}`]));
    description = "Все 560 исходных записей терапевтических участков, включая смешанные категории. Фильтр категорий влияет на окраску карты, но не удаляет исходные строки из этой таблицы.";
  } else if (request.kind === "territories") {
    headers = ["Больница", "Улица / населённый пункт", "Правила домов", "Также в зоне других больниц", "Проверка координат", "Источник"];
    const names = new Map(data.organizations.map((o) => [o.id, o.shortName]));
    rows = orgs.flatMap((o) => (territoryIndex.byOrganization.get(o.id) || []).map((g) => [
      o.shortName,
      g.address,
      [...new Set(g.rules.map((r) => r.houses))].join("; "),
      (territoryIndex.byAddress.get(g.key) || []).filter((other) => other.organizationId !== o.id).map((other) => names.get(other.organizationId)).join("; "),
      source.ruleLocations.has(g.id) ? "Найдено: " + source.ruleLocations.get(g.id) : source.ruleAttempts.has(g.id) ? "Не подтверждено: " + (source.ruleFailures.get(g.id) || "нужна проверка адреса") : "Ещё не проверено",
      g.rules.map((r) => `DOCX · таблица ${r.table} · строка ${r.sourceRow}`).join("; "),
    ]));
    description = `${territoryIndex.organizationCount} зон обслуживания. ${territoryIndex.shared.length} текстов адресов встречаются у разных больниц; это не доказывает пересечение домов. Чётность и диапазоны сохранены. Строки одной улицы объединены только для отображения.`;
  } else if (request.kind === "addresses") {
    headers = ["Организация", "Адрес / улица", "Дома", "Категория", "Источник"];
    rows = orgs.flatMap((o) => o.territories.flatMap((t) => t.rules.map((r) => [o.shortName, r.address, r.houses, t.category, `_прикрепление новое.docx · таблица ${t.table} · строка ${r.sourceRow}`])));
    description = "Адресные правила для взрослого и смешанного населения. Диапазоны, чётность и формулировки «все дома» сохранены. Это не перечень индивидуально проверенных домов и не номерные терапевтические участки.";
  } else if (request.kind === "capacity") {
    headers = ["Организация в форме", "Филиал", "План, всего / смену", "Взрослая / смешанная поликлиника", "Источник"];
    const blocks = orgId ? orgs.flatMap((o) => o.capacity) : data.capacityBlocks;
    rows = blocks.map((b) => [b.organization, b.branch, b.total, b.adultMixed, `30_1010_МОЩНОСТЬ.xls · Лист1 · строка ${b.sourceRow}`]);
    description = "На 01.01.2026. Общая амбулаторная плановая мощность по разным профилям. Не используется для расчёта загрузки терапевтов. Итоговая строка «ВСЕГО» исключена, чтобы не считать её вместе с деталями.";
  } else {
    headers = ["Территория", "Тип", "Население", "Статус", "Дата"];
    rows = data.populations.map((p) => [p.name, p.type, source.populationValues[p.id] ?? p.value, "Предоставлено пользователем; не проверено", "Не указана"]);
    description = "Города и районы не складываются. Для изменения значения выберите соответствующую территорию в карточке организации. Повторяющиеся значения 67 754 сохранены как предоставлено.";
  }

  const q = request.search?.trim().toLocaleLowerCase("ru");
  if (q) rows = rows.filter((row) => row.some((v) => String(v ?? "").toLocaleLowerCase("ru").includes(q)));
  return { headers, rows, description };
}

export function formatTableCell(value: TableCell, header: string): string {
  if (value === null) return "нет данных";
  return typeof value === "number"
    ? value.toLocaleString("ru-RU", { maximumFractionDigits: ["Широта", "Долгота"].includes(header) ? 6 : 2 })
    : value;
}

export function tableCsv(table: TableData): string {
  const cell = (value: TableCell) => {
    let text = value === null ? "" : String(value);
    if (/^[=+@\-]/.test(text) && typeof value !== "number") text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return "\ufeff" + [table.headers, ...table.rows].map((row) => row.map(cell).join(";")).join("\r\n");
}

export const TABLE_PAGE_SIZE = 75;

export function tablePage(table: TableData, requestedPage: number) {
  const pageCount = Math.ceil(table.rows.length / TABLE_PAGE_SIZE);
  const page = Math.max(0, Math.min(requestedPage, Math.max(0, pageCount - 1)));
  return { page, pageCount, rows: table.rows.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE) };
}
