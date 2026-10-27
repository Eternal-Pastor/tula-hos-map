import { Settings2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppBrand } from "@/components/AppBrand";
import * as UI from "./DeveloperUI";
export function DeveloperHeader() {
  const store = UI.useUI(),
    view = UI.useField("view");
  return (
    <header className="header developer-header">
      <AppBrand subtitle="Тульская область · инструменты разработчика" />
      <Tabs
        value={String(view.value || "map")}
        onValueChange={(value) => {
          void store.change("view", value);
        }}
      >
        <TabsList aria-label="Представление">
          <TabsTrigger
            id="developer-tab-map"
            aria-controls="map-view"
            value="map"
          >
            Карта
          </TabsTrigger>
          <TabsTrigger
            id="developer-tab-table"
            aria-controls="table-view"
            value="table"
          >
            Таблицы
          </TabsTrigger>
          <TabsTrigger
            id="developer-tab-about"
            aria-controls="about-view"
            value="about"
          >
            О данных
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <UI.Button id="open-settings" variant="outline">
        <Settings2 />
        Подключить Яндекс Карты
      </UI.Button>
    </header>
  );
}
