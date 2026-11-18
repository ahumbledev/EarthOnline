/** Geographic source data is immutable; authored changes belong in overlays. */
export type MapPoint = [number, number]; // local metres: +X east, +Z south
export type MapPolygon = MapPoint[][]; // outer ring followed by holes
export interface RegionOrigin { longitude: number; latitude: number; elevation: number }
export interface RegionBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface RegionSource { id: string; url: string; fetchedAt: string; license: string; attribution: string; sha256: string; release?: string }
export interface GeographicRegion {
  schemaVersion: 1;
  id: string;
  name: string;
  revision: string;
  geographicStatus: 'source-aligned';
  origin: RegionOrigin;
  coordinateSystem: 'WGS84-ECEF-ENU';
  verticalDatum: string;
  bbox: [number, number, number, number]; // WGS84 west,south,east,north
  bounds: RegionBounds;
  sources: RegionSource[];
  terrain: { columns: number; rows: number; bounds: RegionBounds; heights: number[]; sourceResolutionMetres: number; kind: 'DSM'; sourceId: string };
  buildings: { id: string; sourceId: string; name?: string; polygons: MapPolygon[]; height: number; heightSource: 'source' | 'levels' | 'estimated'; minHeight?: number }[];
  roads: { id: string; sourceId: string; name?: string; kind: string; points: MapPoint[]; width: number; widthSource: 'source' | 'estimated'; bridge: boolean; tunnel: boolean }[];
  water: { id: string; sourceId: string; kind: string; polygons: MapPolygon[] }[];
  landcover: { id: string; sourceId: string; kind: string; polygons: MapPolygon[] }[];
  spawn: [number, number, number];
  spawnYaw: number;
  landmarks: { id: string; name: string; position: [number, number, number]; description: string }[];
  limitations: string[];
}
