// Проверенные вычисления остаются самостоятельными JS-модулями на первом этапе.
import "../engine/vendor/clipper.js";
import "../engine/vendor/d3-delaunay.min.js";
import "../engine/zones.js";
import "../engine/accessibility.js";
import "../engine/zone-jobs.js";
import "../engine/routing-osrm.js";
import "../engine/viewer-core.js";
import type {
  Cell,
  CompletedTime,
  Hospital,
  Polygon,
  RouteJob,
  RouteRecord,
  TravelMode,
  YandexPoint,
} from "../types/domain";

interface Accessibility {
  COLORS: string[];
  band(seconds: number | null): number;
  visibleTime(mode: TravelMode, seconds: number | null): boolean;
  displayBand(mode: TravelMode, seconds: number | null): number;
  record(value: unknown, knownIds: Set<string>): RouteRecord | null;
  pending(
    cells: Cell[],
    destinations: Map<string, YandexPoint>,
    records: Map<string, RouteRecord>,
    modes: TravelMode[],
    services: Record<TravelMode, string>,
  ): RouteJob[];
}
interface ViewerEngine {
  COLORS: Record<string, string>;
  loadBand(value: number | null): string;
  minutes(seconds: number | null): string;
  complete(
    a: Accessibility,
    cells: Cell[],
    baseline: Cell[],
    destinations: Map<string, YandexPoint>,
    records: Map<string, RouteRecord>,
    services: Record<TravelMode, string>,
  ): Map<string, Record<TravelMode, CompletedTime>>;
}
export interface ViewerPack {
  encoding: string;
  checksum: string;
  data: string;
}
declare global {
  interface Window {
    HospitalAccessibility: Accessibility;
    HospitalViewer: ViewerEngine;
    HospitalViewerData: ViewerPack;
    HospitalViewerConfig: { mapKey: string };
    HospitalRoutingOSRM: {
      requestRoute(
        service: string,
        job: RouteJob,
        signal: AbortSignal,
      ): Promise<Partial<RouteRecord>>;
    };
    HospitalZoneJobs: {
      chunks<T>(
        items: Iterable<T>,
        visit: (item: T) => void,
        options?: { budget?: number; cancelled?: () => boolean },
      ): Promise<boolean>;
    };
  }
}
export const accessibility = window.HospitalAccessibility;
export const viewerEngine = window.HospitalViewer;
export const routing = window.HospitalRoutingOSRM;
export const jobs = window.HospitalZoneJobs;
export type { Hospital, Polygon };
