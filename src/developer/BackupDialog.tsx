import { Label } from "@/components/ui/label";
import { X, Download } from "lucide-react";
import * as UI from "./DeveloperUI";

export function BackupDialog() {
  return (
    <UI.Dialog
      id="backup-dialog"
      title="Резервные копии проекта"
      description="JSON содержит адреса и результаты их проверки, контуры, маршруты, координаты и настройки расчёта. Ключи API в копию не входят."
    >
      <div className="dialog-heading">
        <UI.Button
          id="close-backup"
          variant="ghost"
          size="icon"
          aria-label="Закрыть резервные копии"
        >
          <X aria-hidden="true" />
        </UI.Button>
      </div>
      <UI.Text id="backup-current" as="p" className="small muted" />
      <div className="button-row">
        <UI.Button id="backup-export">
          <Download aria-hidden="true" /> Скачать полную копию
        </UI.Button>
        <UI.File
          id="backup-file"
          label="Выбрать копию"
          accept=".json,application/json"
        />
        <UI.Button id="backup-previous" variant="outline">
          Скачать копию до последнего изменения
        </UI.Button>
      </div>
      <UI.Status id="backup-status" />
      <UI.Section id="backup-preview" hidden>
        <h3>Содержимое выбранной копии</h3>
        <UI.Text id="backup-preview-summary" as="p" />
        <UI.Text id="backup-warning" as="p" className="small muted" />
        <div className="field">
          <Label htmlFor="backup-mode">Способ восстановления</Label>
          <UI.Select
            id="backup-mode"
            options={[
              { value: "merge", label: "Объединить с текущими данными" },
              {
                value: "replace",
                label: "Восстановить проект целиком из копии",
              },
            ]}
          />
        </div>
        <p className="small muted">
          Перед восстановлением текущий проект сохраняется в браузере. Эту
          версию можно скачать кнопкой выше. Объединение сохраняет найденные
          адреса и более свежие маршруты. Полное восстановление возвращает
          данные и настройки выбранной копии.
        </p>
        <UI.Button id="backup-apply">Восстановить выбранную копию</UI.Button>
      </UI.Section>
    </UI.Dialog>
  );
}
