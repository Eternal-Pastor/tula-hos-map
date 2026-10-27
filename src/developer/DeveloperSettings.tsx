import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import * as UI from "./DeveloperUI";

export function DeveloperSettings() {
  return (
    <UI.Dialog
      id="settings-dialog"
      title="Яндекс Карты"
      description="Ключ нужен для подложки. Время пути рассчитывается через локальные серверы OSRM."
    >
      <UI.Form id="key-form">
        <div className="dialog-heading">
          <UI.Button
            type="button"
            id="close-settings"
            variant="ghost"
            size="icon"
            aria-label="Закрыть настройки карты"
          >
            <X aria-hidden="true" />
          </UI.Button>
        </div>
        <div className="field">
          <Label htmlFor="api-key">Ключ JavaScript API</Label>
          <UI.Input
            id="api-key"
            type="password"
            autoComplete="off"
            placeholder="Вставьте ключ JavaScript API"
          />
        </div>
        <div hidden>
          <Label htmlFor="geocoder-key">Ключ API Геокодера</Label>
          <UI.Input
            id="geocoder-key"
            type="password"
            autoComplete="off"
            placeholder="Отдельный ключ геокодера, необязательно"
          />
          <Label htmlFor="routing-key">
            Ключ API получения деталей маршрута
          </Label>
          <UI.Input
            id="routing-key"
            type="password"
            autoComplete="off"
            placeholder="Отдельный ключ HTTP API маршрутов"
          />
        </div>
        <UI.Switch id="remember-key">
          Сохранить ключ на этом устройстве и подключать карту автоматически
        </UI.Switch>
        <UI.Status id="key-status" />
        <div className="button-row">
          <UI.Button type="submit" id="submit-key">
            Подключить карту
          </UI.Button>
          <UI.Button type="button" id="forget-key" variant="outline">
            Удалить сохранённый ключ
          </UI.Button>
        </div>
        <details>
          <summary>Как получить ключ и открыть страницу</summary>
          <ol>
            <li>
              Войдите в{" "}
              <a
                href="https://developer.tech.yandex.ru/"
                target="_blank"
                rel="noopener noreferrer"
              >
                кабинет разработчика Яндекс Карт
              </a>
              .
            </li>
            <li>Подключите JavaScript API и скопируйте ключ.</li>
            <li>Дождитесь активации ключа.</li>
            <li>
              В ограничении по HTTP Referer укажите localhost. Проверьте
              требования к ограничениям в кабинете Яндекса.
            </li>
          </ol>
          <p>
            Для запуска откройте START.cmd в корне поставки. Обычный адрес —
            http://localhost:8765/; если порт занят, скрипт выберет следующий.
            При открытии HTML-файла двойным щелчком заголовок HTTP Referer
            отсутствует, поэтому доменное ограничение ключа может блокировать
            карту.
          </p>
          <p>
            Для нового поиска адресов нужен доступ к геокодированию. Подключение
            подложки само по себе не подтверждает, что геокодер доступен.
            Локальный расчёт времени пути не использует ключи Яндекса.
          </p>
        </details>
      </UI.Form>
    </UI.Dialog>
  );
}
