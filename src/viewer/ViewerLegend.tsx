import { Car, Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { accessibility as A, viewerEngine as V } from "../services/engine";
import type { ViewerState, ViewerStore } from "../services/viewer-store";
import type { TravelMode } from "../types/domain";

const transports: [TravelMode, string][] = [
  ["auto", "На машине"],
  ["pedestrian", "Пешком"],
];

export function ViewerLegend({ state, store }: { state: ViewerState; store: ViewerStore }) {
  if (state.mode === "zones") return null;
  const walking = state.transport === "pedestrian";
  const bands = state.mode === "travel"
    ? A.COLORS.slice(0, walking ? 3 : 4).map((color, index) => [
        color,
        ["≤ 15 мин", "15–30 мин", "30–60 мин", "> 60 мин"][index],
      ])
    : [
        [V.COLORS.low, "0–<700"],
        [V.COLORS.middle, "700–1 000"],
        [V.COLORS.high, "> 1 000"],
        [V.COLORS.missing, "нет данных"],
      ];
  if (state.mode === "travel" && walking)
    bands.push([A.COLORS[4], "Вне часа / нет данных"]);
  return (
    <Card className="map-legend viewer-legend" role="region" aria-labelledby="viewer-legend-title">
      {state.mode === "travel" && (
        <div id="viewer-travel-modes" className="viewer-transport-buttons" role="group" aria-label="Способ передвижения">
          {transports.map(([transport, label]) => (
            <Button
              key={transport}
              size="sm"
              variant={state.transport === transport ? "default" : "outline"}
              data-transport={transport}
              aria-pressed={state.transport === transport}
              onClick={() => store.setTransport(transport)}
            >
              {transport === "auto" ? <Car aria-hidden="true" /> : <Footprints aria-hidden="true" />}
              {label}
            </Button>
          ))}
        </div>
      )}
      <strong id="viewer-legend-title">
        {state.mode === "travel" ? "Время до закреплённой больницы" : "Прикреплено на 1 000 жителей"}
      </strong>
      <div id="viewer-legend-bands" className="legend-bands">
        {bands.map(([color, label]) => (
          <span className="legend-band" key={label}>
            <i aria-hidden="true" className="dot" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
      {state.mode === "travel" && (
        <p className="small muted">
          {walking && "Цветом показана доступность до 60 минут включительно; более долгие пути и ячейки без времени показаны серым. "}
          ≈ — оценка; её источник указан в подсказке.
        </p>
      )}
    </Card>
  );
}
