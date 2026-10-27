import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import * as UI from "./DeveloperUI";

interface CellTime {
  mode: string;
  minutes: string;
  source: string;
  unreachable: boolean;
}

export function CellDialog() {
  return (
    <UI.Dialog
      id="access-cell-dialog"
      title="Время от ячейки"
      description="Время до закреплённой больницы и источник каждого значения."
    >
      <div className="dialog-heading">
        <UI.Button
          id="access-cell-close"
          variant="ghost"
          size="icon"
          aria-label="Закрыть время ячейки"
        >
          <X aria-hidden="true" />
        </UI.Button>
      </div>
      <UI.Text id="access-cell-title" as="h3" />
      <UI.Text id="access-cell-origin" as="p" />
      <Table className="access-times">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Способ</TableHead>
            <TableHead scope="col">Время</TableHead>
            <TableHead scope="col">Источник</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody id="access-cell-times">
          <UI.Data id="access-cell-times">
            {(rows: CellTime[] | undefined) =>
              rows?.map((row) => (
                <TableRow key={row.mode}>
                  <TableHead scope="row">{row.mode}</TableHead>
                  <TableCell>{row.minutes}</TableCell>
                  <TableCell>
                    {row.source}
                    {row.unreachable && <p>OSRM не нашёл путь.</p>}
                  </TableCell>
                </TableRow>
              ))
            }
          </UI.Data>
        </TableBody>
      </Table>
      <UI.Text id="access-cell-method" as="p" className="small muted" />
    </UI.Dialog>
  );
}
