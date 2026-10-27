/** Карта Яндекса/OSRM-cache: latitude, longitude. GeoJSON: longitude, latitude. */
export type YandexPoint = [latitude: number, longitude: number];
export type GeoPoint = [longitude: number, latitude: number];
export type Polygon = GeoPoint[][];
export type TravelMode = "auto" | "pedestrian";
export type RoutingMode = TravelMode | "masstransit";
export type MapMode = "travel" | "zones" | "load";
export interface Hospital {
  id: string;
  name: string;
  coords: YandexPoint;
  color: string;
  per1000: number | null;
  areaKm2: number | null;
  capacity: number | null;
}
export interface Organization {
  id: string;
  name: string;
  location?: { coords?: YandexPoint; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Cell {
  id: string;
  organizationId: string;
  origin: YandexPoint;
  geometry: Polygon;
}
export interface RouteRecord {
  key: string;
  type: "route";
  organizationId: string;
  origin: YandexPoint;
  destination: YandexPoint;
  mode: RoutingMode;
  status: "found" | "unreachable";
  seconds: number | null;
  lines: YandexPoint[][];
  at: string;
  provider: "osrm" | "http" | "jsapi";
  routingService?: string;
  trafficType?: string;
  routeReason?: string;
  snapDistances?: number[];
}
export interface RouteJob {
  key: string;
  cell: Cell;
  destination: YandexPoint;
  mode: TravelMode;
}
export interface CompletedTime {
  seconds: number | null;
  source: "osrm" | "neighbor" | "distance" | "missing";
  routeStatus: string;
  donors: { id: string; weight: number }[];
}
export interface ViewerSnapshot {
  hospitals: Hospital[];
  zones: [string, Polygon[]][];
  step: number;
  cells: Cell[];
  routes: RouteRecord[];
  services: Record<TravelMode, string>;
}
export interface ViewerSettings {
  mode: MapMode;
  transport: TravelMode;
  step: number;
  checksum: string;
}
export interface ProjectSettings {
  selectedOrganization: string | null;
  fullCoverage: boolean;
  showZones: boolean;
  showAddressPoints: boolean;
  includeMixed: boolean;
  showEmpty: boolean;
  mapColor: "organization" | "load";
  metric: "absolute" | "perArea" | "per1000";
  populationLinks: Record<string, string>;
  populationValues: Record<string, number>;
  coordinates: Record<string, YandexPoint>;
  coordinateVersions: Record<string, string>;
  geojson: unknown[];
  [key: string]: unknown;
}
export interface RoutingSettings {
  source: "osrm";
  osrm: Record<TravelMode, string>;
  enabled: boolean;
  mode: TravelMode;
  step: 5000 | 10000 | 20000;
  scope: "all";
  shape: "cells";
  lines: false;
  fillMissing: "same-hospital-idw4-v1";
  gridPreset: string;
  routingPreset: string;
  model: {
    auto: number;
    pedestrian: number;
    masstransit: number;
    detour: number;
    wait: number;
  };
  [key: string]: unknown;
}
export interface BackupRecord {
  key: string;
  type: string;
  [key: string]: unknown;
}
export interface BackupSummary {
  addresses: number;
  failed: number;
  hospitals: number;
  routes: number;
  zones: number;
  coverageZones: number;
}
export interface BackupPayload {
  settings: ProjectSettings;
  routing?: RoutingSettings;
  records: BackupRecord[];
  dataset?: string;
}
export type ProjectBackup =
  | {
      type: "hospital-map-local-data";
      version: 2;
      createdAt: string;
      checksum: string;
      summary: BackupSummary;
      payload: BackupPayload;
    }
  | ({
      type: "hospital-map-local-data";
      version: 1;
      createdAt?: string;
    } & BackupPayload);
