import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  buildTable,
  formatTableCell,
  tableCsv,
  tablePage,
  type TableKind,
  type TableRequest,
  type TableSource,
} from "./table-data";

/** Контроллер передаёт снимки данных и запросы навигации; состоянием таблицы управляет React. */
export interface DeveloperTablesHandle {
  update(source: TableSource): void;
  open(request: TableRequest): void;
}

const emptyTable = { headers: [], rows: [], description: "" };
const count = (value: number) => value.toLocaleString("ru-RU");

export function DeveloperTables({ ref }: { ref: Ref<DeveloperTablesHandle> }) {
  const [state, setState] = useState<{
    source: TableSource | null;
    request: TableRequest;
    page: number;
  }>({ source: null, request: { kind: "organizations" }, page: 0 });
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useImperativeHandle(
    ref,
    () => ({
      update(source) {
        setState((previous) => ({
          ...previous,
          source,
          page: tablePage(buildTable(source, previous.request), previous.page)
            .page,
        }));
      },
      open(request) {
        setState((previous) => ({ ...previous, request, page: 0 }));
      },
    }),
    [],
  );

  useEffect(() => {
    const pending = downloads.current;
    return () => {
      for (const [url, timer] of pending) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      pending.clear();
    };
  }, []);

  const table = useMemo(
    () => (state.source ? buildTable(state.source, state.request) : emptyTable),
    [state.source, state.request],
  );
  const organizations = useMemo(
    () =>
      state.source?.data.organizations
        .slice()
        .sort((a, b) => a.shortName.localeCompare(b.shortName, "ru")) ?? [],
    [state.source],
  );
  const current = tablePage(table, state.page);
  const filter = (patch: Partial<TableRequest>) =>
    setState((previous) => ({
      ...previous,
      request: { ...previous.request, ...patch },
      page: 0,
    }));
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([tableCsv(table)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `hospital-${state.request.kind}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    downloads.current.set(
      url,
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloads.current.delete(url);
      }, 1000),
    );
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ИСХОДНЫЕ ЗНАЧЕНИЯ</p>
          <h2>Таблицы проекта</h2>
        </div>
        <Button
          id="export-csv"
          variant="outline"
          onClick={exportCsv}
          disabled={!state.source}
        >
          <Download aria-hidden="true" /> Скачать CSV
        </Button>
      </div>
      <div className="table-controls">
        <div className="field">
          <Label htmlFor="table-kind">Набор данных</Label>
          <Select
            value={state.request.kind}
            onValueChange={(value) => filter({ kind: value as TableKind })}
          >
            <SelectTrigger id="table-kind" aria-label="Набор данных">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organizations">Организации</SelectItem>
              <SelectItem value="areas">Терапевтические участки</SelectItem>
              <SelectItem value="territories">
                Зоны больниц: улицы и дома
              </SelectItem>
              <SelectItem value="addresses">Адресные правила</SelectItem>
              <SelectItem value="capacity">Плановая мощность</SelectItem>
              <SelectItem value="population">Население территорий</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="field">
          <Label htmlFor="table-org">Организация</Label>
          <Select
            value={state.request.organizationId || "__all__"}
            disabled={state.request.kind === "population"}
            onValueChange={(value) =>
              filter({ organizationId: value === "__all__" ? "" : value })
            }
          >
            <SelectTrigger id="table-org" aria-label="Организация">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Все организации</SelectItem>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.shortName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="field grow">
          <Label htmlFor="table-search">Поиск</Label>
          <Input
            id="table-search"
            type="search"
            placeholder="Найти в выбранной таблице…"
            value={state.request.search ?? ""}
            onChange={(event) => filter({ search: event.target.value })}
          />
        </div>
      </div>
      <Alert id="table-description">
        <AlertDescription>
          {table.description || "Загружаем данные таблицы…"}
        </AlertDescription>
      </Alert>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Таблица проекта, прокручивается по горизонтали"
      >
        <Table aria-describedby="table-description">
          <TableCaption className="sr-only">
            {count(table.rows.length)} строк в выбранном наборе данных
          </TableCaption>
          <TableHeader id="table-head">
            <TableRow>
              {table.headers.map((header) => (
                <TableHead key={header} scope="col">
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody id="table-body">
            {current.rows.length ? (
              current.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((value, column) => (
                    <TableCell
                      key={column}
                      className={typeof value === "number" ? "numeric" : ""}
                    >
                      {formatTableCell(value, table.headers[column])}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={Math.max(table.headers.length, 1)}
                  className="empty"
                >
                  {state.source
                    ? "Нет строк по выбранным условиям. Измените поиск или фильтры."
                    : "Загружаем данные…"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="pagination">
        <span id="table-count" role="status" aria-live="polite">
          {count(table.rows.length)} строк
        </span>
        <nav aria-label="Страницы таблицы">
          <Button
            id="prev-page"
            variant="outline"
            disabled={current.page === 0}
            onClick={() =>
              setState((previous) => ({ ...previous, page: current.page - 1 }))
            }
          >
            <ChevronLeft aria-hidden="true" /> Назад
          </Button>
          <span id="page-number" aria-label="Текущая страница">
            {table.rows.length ? current.page + 1 : 0} / {current.pageCount}
          </span>
          <Button
            id="next-page"
            variant="outline"
            disabled={current.page + 1 >= current.pageCount}
            onClick={() =>
              setState((previous) => ({ ...previous, page: current.page + 1 }))
            }
          >
            Далее <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      </div>
    </>
  );
}
