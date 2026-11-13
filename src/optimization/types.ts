import type { Cell, YandexPoint, Polygon } from '../types/domain';
export interface Facility {
  id: string;
  organizationId?: string;
  organization: string;
  name: string;
  address: string;
  type: string;
  sourceRow?: number;
  suggested: boolean;
  coords: YandexPoint | null;
  confirmed: boolean;
  legacy?: boolean;
}
export interface GridCell extends Cell { step: number }
export interface Assignment {
  cellId: string;
  beforeId: string;
  beforeSeconds: number | null;
  afterId: string | null;
  afterSeconds: number | null;
  deltaSeconds: number | null;
  complete: boolean;
  status: 'pending' | 'found' | 'unreachable';
}
export interface Solution {
  version: string;
  rows: Assignment[];
  summary: { cells: number; paired: number; beforeSeconds: number | null; afterSeconds: number | null;
    savedSeconds: number | null; improved: number; worsened: number; changed: number; unreachable: number; pending: number };
}
export interface MatrixEntry { key: string; seconds: number | null }
export interface OptimizationResult { solution: Solution; zones: [string, Polygon[]][]; mode: 'auto' | 'pedestrian'; at: string; fingerprint: string }
