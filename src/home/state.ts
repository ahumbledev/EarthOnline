import { physicalItemProfile } from './physical-items-profile.mjs';
import { physicalPlacementBounds, physicalItemSolidBoxes, physicalSolidPlacementsOverlap } from './physical-items-protocol.mjs';
import { containerLocalPose, containerWorldPose } from './container-state.ts';

/**
 * Home furnishing data stays independent of Three.js and Rapier, so layouts can
 * be saved, validated on a server and tested headlessly. Units are metres and
 * radians; the room is centred on x = z = 0 with its floor at y = 0.
 */
export type HomeMount = 'floor' | 'wall' | 'small';
export type HomeCategory = 'living' | 'bedroom' | 'dining' | 'kitchen' | 'study' | 'decor' | 'small';

export interface HomeItemSize { width: number; depth: number; height: number }
export type HomePhysicsShape =
  | { kind: 'box' }
  | { kind: 'cylinder' }
  | { kind: 'ball' }
  | { kind: 'hull'; points: number[] };

export type HomeShelfSide = '+x' | '-x' | '+z' | '-z';
/** One board inside a piece of furniture, measured from its model at yaw 0. */
export interface HomeShelf {
  /** Board top above the item's base. */
  y: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Free height above the board; absent when nothing is overhead. */
  clearance?: number;
  /** Sides a hand reaches straight in through. */
  open: HomeShelfSide[];
}

export interface HomeItemDefinition {
  /** Stable catalog ID. Saves never depend on pack order or node names. */
  id: string;
  name: string;
  category: HomeCategory;
  mount: HomeMount;
  /** Footprint at yaw 0. The model origin is its base centre unless `center` says otherwise. */
  size: HomeItemSize;
  center?: { x: number; z: number };
  /** Small items may rest on this top. Height is from the item's base. */
  surface?: { height: number; inset?: number };
  /** Boards below the top: bookshelf shelves, the inside of a cabinet, a counter under its splashback. */
  shelves?: HomeShelf[];
  /** Rugs and mats are walked over: other floor items may overlap them. */
  rug?: boolean;
  pack: string;
  node: string;
  physics?: HomePhysicsShape;
  mass?: number;
  /** Gameplay tags override the legacy mount-derived defaults. */
  tags?: string[];
  capabilities?: { carry?: boolean; decorate?: boolean; tip?: boolean };
  container?: { interior: Box3; closable: boolean };
}

export const homeItemTags = (item: HomeItemDefinition): string[] => physicalItemProfile(item).tags;
export const canCarryItem = (item: HomeItemDefinition): boolean => physicalItemProfile(item).capabilities.carry;
export const canDecorateItem = (item: HomeItemDefinition): boolean => physicalItemProfile(item).capabilities.decorate;
export const canTipItem = (item: HomeItemDefinition): boolean => physicalItemProfile(item).capabilities.tip;

export interface HomePlacement {
  /** Instance ID, unique within one layout. */
  id: string;
  item: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Physical orientation, including a fallen piece of furniture: [x, y, z, w]. */
  tilt?: [number, number, number, number];
}

export interface HomeBounds { width: number; depth: number; height: number }
export interface HomeLayoutState { version: 1; placements: HomePlacement[] }
export interface HomeLimits { placements: number; small: number; perItem: number }
export type PlacementProblem = 'unknown-item' | 'invalid-number' | 'outside-room' | 'overlap' | 'not-on-wall' | 'wall-height' | 'limit' | 'unsupported' | 'clearance';
export interface PlacementCheck { ok: boolean; problem?: PlacementProblem }
export interface SupportInfo {
  /** Placement ID of the furniture under the small item, or undefined for the floor. */
  on?: string;
  /** Resting height of the item's base. */
  height: number;
  /** False when the centre hangs past the supporting top: physics will tip it. */
  stable: boolean;
}

export const HOME_GRID = .05;
export const HOME_YAW_STEP = Math.PI / 12;
export const WALL_SNAP_DISTANCE = .22;
export const HOME_LIMITS: Readonly<HomeLimits> = Object.freeze({ placements: 160, small: 60, perItem: 16 });
const EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;
const WALL_YAW_TOLERANCE = .02;
const WALL_DISTANCE_TOLERANCE = .02;

type Corner = readonly [number, number];
export interface Box3 { min: [number, number, number]; max: [number, number, number] }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeYaw(yaw: number): number {
  const wrapped = yaw % TWO_PI;
  const result = wrapped < 0 ? wrapped + TWO_PI : wrapped;
  return result >= TWO_PI - EPSILON ? 0 : result;
}

export function snapValue(value: number, step = HOME_GRID): number {
  if (!finite(value) || !positive(step)) throw new RangeError('Snapped values and steps must be finite; steps positive.');
  const snapped = Math.round(value / step) * step;
  return Object.is(snapped, -0) ? 0 : Number(snapped.toFixed(6));
}

export function snapYaw(yaw: number, step = HOME_YAW_STEP): number {
  if (!finite(yaw) || !positive(step)) throw new RangeError('Yaw and step must be finite; step positive.');
  return normalizeYaw(Math.round(normalizeYaw(yaw) / step) * step);
}

/** Rotated footprint corners of a placement, in room metres. */
export function footprintCorners(item: HomeItemDefinition, placement: Pick<HomePlacement, 'x' | 'z' | 'yaw'>): Corner[] {
  const cos = Math.cos(placement.yaw), sin = Math.sin(placement.yaw);
  const cx = item.center?.x ?? 0, cz = item.center?.z ?? 0;
  const hw = item.size.width / 2, hd = item.size.depth / 2;
  const corners: Corner[] = [];
  for (const [lx, lz] of [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]]) {
    // Rotation about +Y: local +Z turns toward +X for a positive yaw.
    corners.push([placement.x + lx * cos + lz * sin, placement.z - lx * sin + lz * cos]);
  }
  return corners;
}

export function footprintCenter(item: HomeItemDefinition, placement: Pick<HomePlacement, 'x' | 'z' | 'yaw'>): Corner {
  const cos = Math.cos(placement.yaw), sin = Math.sin(placement.yaw);
  const cx = item.center?.x ?? 0, cz = item.center?.z ?? 0;
  return [placement.x + cx * cos + cz * sin, placement.z - cx * sin + cz * cos];
}

/** Separating-axis test for two convex quadrilaterals; touching edges do not overlap. */
export function cornersOverlap(a: readonly Corner[], b: readonly Corner[]): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index++) {
      const [x1, z1] = polygon[index], [x2, z2] = polygon[(index + 1) % polygon.length];
      const nx = z2 - z1, nz = x1 - x2;
      const length = Math.hypot(nx, nz);
      if (length < EPSILON) continue;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [x, z] of a) { const p = (x * nx + z * nz) / length; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
      for (const [x, z] of b) { const p = (x * nx + z * nz) / length; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
      if (maxA <= minB + 1e-4 || maxB <= minA + 1e-4) return false;
    }
  }
  return true;
}

export function cornersInsideRoom(corners: readonly Corner[], bounds: HomeBounds, margin = 0): boolean {
  const hw = bounds.width / 2 - margin, hd = bounds.depth / 2 - margin;
  return corners.every(([x, z]) => x >= -hw - 1e-4 && x <= hw + 1e-4 && z >= -hd - 1e-4 && z <= hd + 1e-4);
}

export function pointInsideCorners(x: number, z: number, corners: readonly Corner[]): boolean {
  let inside = true;
  for (let index = 0; index < corners.length; index++) {
    const [x1, z1] = corners[index], [x2, z2] = corners[(index + 1) % corners.length];
    const cross = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
    if (index === 0) inside = cross >= -1e-6; else if ((cross >= -1e-6) !== inside) return false;
  }
  return true;
}

function validPlacementNumbers(placement: HomePlacement): boolean {
  if (!finite(placement.x) || !finite(placement.y) || !finite(placement.z) || !finite(placement.yaw)) return false;
  if (Math.abs(placement.x) > 1e4 || Math.abs(placement.y) > 1e4 || Math.abs(placement.z) > 1e4) return false;
  if (placement.tilt !== undefined) {
    if (!Array.isArray(placement.tilt) || placement.tilt.length !== 4 || !placement.tilt.every(finite)) return false;
    const length = Math.hypot(...placement.tilt);
    if (length < .9 || length > 1.1) return false;
  }
  return true;
}

function validDefinition(item: HomeItemDefinition): boolean {
  return positive(item.size?.width) && positive(item.size?.depth) && positive(item.size?.height)
    && (item.center === undefined || (finite(item.center.x) && finite(item.center.z)));
}

/** The wall a yaw faces away from. Wall items face into the room, so yaw 0 hangs on the back wall (z = -depth / 2). */
export function wallForYaw(yaw: number): 'back' | 'left' | 'front' | 'right' | undefined {
  const quarter = normalizeYaw(yaw) / (Math.PI / 2);
  const nearest = Math.round(quarter) % 4;
  if (Math.abs(quarter - Math.round(quarter)) > WALL_YAW_TOLERANCE / (Math.PI / 2)) return undefined;
  return (['back', 'left', 'front', 'right'] as const)[nearest];
}

/** Project a point onto the nearest wall, facing into the room. */
export function nearestWallPose(bounds: HomeBounds, x: number, z: number): { x: number; z: number; yaw: number } {
  const hw = bounds.width / 2, hd = bounds.depth / 2;
  const candidates = [
    { distance: Math.abs(z + hd), pose: { x: clamp(x, -hw, hw), z: -hd, yaw: 0 } },
    { distance: Math.abs(x + hw), pose: { x: -hw, z: clamp(z, -hd, hd), yaw: Math.PI / 2 } },
    { distance: Math.abs(z - hd), pose: { x: clamp(x, -hw, hw), z: hd, yaw: Math.PI } },
    { distance: Math.abs(x - hw), pose: { x: hw, z: clamp(z, -hd, hd), yaw: Math.PI * 1.5 } },
  ];
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].pose;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A floor item whose side is within reach of a wall and nearly parallel to it
 * is pushed flush against that wall and squared up. Any side may touch a wall.
 */
export function snapToWall(item: HomeItemDefinition, placement: HomePlacement, bounds: HomeBounds, reach = WALL_SNAP_DISTANCE): HomePlacement {
  const quarter = placement.yaw / (Math.PI / 2);
  const squared = Math.round(quarter);
  if (Math.abs(quarter - squared) > .2) return placement;
  const yaw = normalizeYaw(squared * Math.PI / 2);
  const corners = footprintCorners(item, { x: placement.x, z: placement.z, yaw });
  const hw = bounds.width / 2, hd = bounds.depth / 2;
  const minX = Math.min(...corners.map(c => c[0])), maxX = Math.max(...corners.map(c => c[0]));
  const minZ = Math.min(...corners.map(c => c[1])), maxZ = Math.max(...corners.map(c => c[1]));
  const gaps = [
    { gap: minX + hw, dx: -(minX + hw), dz: 0 },
    { gap: hw - maxX, dx: hw - maxX, dz: 0 },
    { gap: minZ + hd, dx: 0, dz: -(minZ + hd) },
    { gap: hd - maxZ, dx: 0, dz: hd - maxZ },
  ].filter(entry => Math.abs(entry.gap) <= reach).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
  let x = placement.x, z = placement.z;
  const used = new Set<string>();
  for (const entry of gaps) {
    const axis = entry.dx !== 0 ? 'x' : 'z';
    if (used.has(axis)) continue;
    used.add(axis);
    x += entry.dx; z += entry.dz;
  }
  return { ...placement, x: Number(x.toFixed(6)), z: Number(z.toFixed(6)), yaw };
}

export function wallBox(item: HomeItemDefinition, placement: HomePlacement): Box3 {
  const corners = footprintCorners(item, placement);
  const xs = corners.map(c => c[0]), zs = corners.map(c => c[1]);
  return { min: [Math.min(...xs), placement.y, Math.min(...zs)], max: [Math.max(...xs), placement.y + item.size.height, Math.max(...zs)] };
}

function boxesOverlap(a: Box3, b: Box3): boolean {
  for (let axis = 0; axis < 3; axis++) if (a.max[axis] <= b.min[axis] + 1e-4 || b.max[axis] <= a.min[axis] + 1e-4) return false;
  return true;
}

export interface PlacedHomeItem { definition: HomeItemDefinition; placement: HomePlacement }

/** Bounds follow the complete physical rotation, not an upright footprint. */
export function placementBounds(item: HomeItemDefinition, placement: HomePlacement): Box3 {
  return physicalPlacementBounds(item, placement);
}

function quaternionOf(pose: Pick<HomePlacement, 'yaw' | 'tilt'>): [number, number, number, number] {
  if (!pose.tilt) return [0, Math.sin(pose.yaw / 2), 0, Math.cos(pose.yaw / 2)];
  const length = Math.hypot(...pose.tilt);
  return pose.tilt.map(value => value / length) as [number, number, number, number];
}

function rotatePoint(point: readonly number[], quaternion: readonly number[]): [number, number, number] {
  const [x, y, z] = point, [qx, qy, qz, qw] = quaternion;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

export function placementsOverlap(a: PlacedHomeItem, b: PlacedHomeItem, tolerance = .005): boolean {
  return physicalSolidPlacementsOverlap(a.definition, a.placement, b.definition, b.placement, tolerance);
}

function checkPoseBounds(item: HomeItemDefinition, placement: HomePlacement, bounds: HomeBounds): PlacementCheck {
  const box = placementBounds(item, placement), tolerance = .025;
  if (box.min[0] < -bounds.width / 2 - tolerance || box.max[0] > bounds.width / 2 + tolerance
    || box.min[2] < -bounds.depth / 2 - tolerance || box.max[2] > bounds.depth / 2 + tolerance
    || box.min[1] < -tolerance || box.max[1] > bounds.height + tolerance) return { ok: false, problem: 'outside-room' };
  return { ok: true };
}

/** Validate one placement against the room and every other placed item. The moved instance itself is ignored. */
export function checkPlacement(item: HomeItemDefinition, placement: HomePlacement, bounds: HomeBounds, others: readonly PlacedHomeItem[]): PlacementCheck {
  if (!validDefinition(item) || !positive(bounds.width) || !positive(bounds.depth) || !positive(bounds.height)) return { ok: false, problem: 'unknown-item' };
  if (!validPlacementNumbers(placement)) return { ok: false, problem: 'invalid-number' };
  const corners = footprintCorners(item, placement);
  if (item.mount === 'wall') {
    const wall = wallForYaw(placement.yaw);
    if (!wall) return { ok: false, problem: 'not-on-wall' };
    const hw = bounds.width / 2, hd = bounds.depth / 2;
    const onWall = wall === 'back' ? Math.abs(placement.z + hd) : wall === 'front' ? Math.abs(placement.z - hd)
      : wall === 'left' ? Math.abs(placement.x + hw) : Math.abs(placement.x - hw);
    if (onWall > WALL_DISTANCE_TOLERANCE) return { ok: false, problem: 'not-on-wall' };
    // The thin footprint straddles the wall line; only the along-wall extent must fit.
    if (!cornersInsideRoom(corners, bounds, -(item.size.depth + WALL_DISTANCE_TOLERANCE))) return { ok: false, problem: 'outside-room' };
    if (placement.y < 0 || placement.y + item.size.height > bounds.height + 1e-4) return { ok: false, problem: 'wall-height' };
    const box = wallBox(item, placement);
    for (const other of others) {
      if (other.placement.id === placement.id || other.definition.mount !== 'wall') continue;
      if (boxesOverlap(box, wallBox(other.definition, other.placement))) return { ok: false, problem: 'overlap' };
    }
    return { ok: true };
  }
  const inRoom = checkPoseBounds(item, placement, bounds);
  if (!inRoom.ok) return inRoom;
  if (item.mount === 'floor' && ((!placement.tilt && Math.abs(placement.y) > 1e-4) || (placement.tilt && !canTipItem(item)))) return { ok: false, problem: 'invalid-number' };
  for (const other of others) {
    if (other.placement.id === placement.id) continue;
    if (placementsOverlap({ definition: item, placement }, other)) return { ok: false, problem: 'overlap' };
  }
  return { ok: true };
}

/** Validate every member at its proposed pose, including objects carried on furniture. */
export function checkPlacementGroup(group: readonly PlacedHomeItem[], bounds: HomeBounds, others: readonly PlacedHomeItem[]): PlacementCheck {
  const ids = new Set(group.map(entry => entry.placement.id));
  if (ids.size !== group.length) return { ok: false, problem: 'invalid-number' };
  const candidates = [...others.filter(entry => !ids.has(entry.placement.id)), ...group];
  for (const entry of group) {
    const check = checkPlacement(entry.definition, entry.placement, bounds, candidates);
    if (!check.ok) return check;
  }
  return { ok: true };
}

/** A strict put-down query; ordinary hand movement may still pass through the air. */
export function checkSupportedPlacement(item: HomeItemDefinition, placement: HomePlacement, bounds: HomeBounds, others: readonly PlacedHomeItem[]): PlacementCheck {
  const check = checkPlacement(item, placement, bounds, others);
  if (!check.ok || item.mount !== 'small') return check;
  const box = placementBounds(item, placement), tolerance = .025;
  if (Math.abs(box.min[1]) <= tolerance) return { ok: true };
  const center = [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2];
  for (const surface of restSurfaces(others)) {
    if (Math.abs(box.min[1] - surface.height) > tolerance) continue;
    const [x, z] = roomToSurface(surface, center[0], center[1]);
    if (x < surface.minX || x > surface.maxX || z < surface.minZ || z > surface.maxZ) continue;
    if (box.max[1] > surface.height + surface.clearance + tolerance) return { ok: false, problem: 'clearance' };
    return { ok: true };
  }
  for (const other of others) {
    if (other.placement.id === placement.id || other.definition.mount !== 'small') continue;
    const support = placementBounds(other.definition, other.placement);
    if (Math.abs(box.min[1] - support.max[1]) <= tolerance && center[0] >= support.min[0] && center[0] <= support.max[0]
      && center[1] >= support.min[2] && center[1] <= support.max[2]) return { ok: true };
  }
  return { ok: false, problem: 'unsupported' };
}

/** A board small things can rest on, placed in the room with its furniture. */
export interface RestSurface {
  /** Placement ID of the furniture. */
  on: string;
  /** Index into the item's shelves, or -1 for its declared top. */
  shelf: number;
  /** Furniture pose: board coordinates turn by `yaw` about +Y, then move to (x, z). */
  x: number; z: number; yaw: number;
  /** Height of the board above the room floor. */
  height: number;
  /** Free height above the board; Infinity when it is open to the room. */
  clearance: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Sides a hand reaches through; a board open to the room is reached from above. */
  open: readonly HomeShelfSide[];
  /** How far a small item's centre must stay inside the edge to rest without tipping. */
  inset: number;
}

const NO_SIDES: readonly HomeShelfSide[] = Object.freeze([]);

/** Every board in the room that can carry small things: furniture tops and the shelves inside them. */
export function restSurfaces(furniture: readonly PlacedHomeItem[]): RestSurface[] {
  const surfaces: RestSurface[] = [];
  for (const { definition, placement } of furniture) {
    if (definition.mount !== 'floor') continue;
    // A toppled shelf no longer presents its authored horizontal support faces.
    if (placement.tilt && rotatePoint([0, 1, 0], quaternionOf(placement))[1] < .999) continue;
    const pose = { on: placement.id, x: placement.x, z: placement.z, yaw: placement.yaw };
    if (definition.surface) {
      const cx = definition.center?.x ?? 0, cz = definition.center?.z ?? 0, hw = definition.size.width / 2, hd = definition.size.depth / 2;
      surfaces.push({ ...pose, shelf: -1, height: placement.y + definition.surface.height, clearance: Infinity,
        minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd, open: NO_SIDES, inset: definition.surface.inset ?? 0 });
    }
    definition.shelves?.forEach((shelf, index) => {
      surfaces.push({ ...pose, shelf: index, height: placement.y + shelf.y, clearance: shelf.clearance ?? Infinity,
        minX: shelf.minX, maxX: shelf.maxX, minZ: shelf.minZ, maxZ: shelf.maxZ, open: shelf.open, inset: definition.surface?.inset ?? .03 });
    });
  }
  return surfaces;
}

/** Room coordinates of a point given in a surface's own frame. */
export function surfaceToRoom(surface: Pick<RestSurface, 'x' | 'z' | 'yaw'>, localX: number, localZ: number): [number, number] {
  const cos = Math.cos(surface.yaw), sin = Math.sin(surface.yaw);
  return [surface.x + localX * cos + localZ * sin, surface.z - localX * sin + localZ * cos];
}

/** A room point in a surface's own frame, where its board is an axis-aligned rectangle. */
export function roomToSurface(surface: Pick<RestSurface, 'x' | 'z' | 'yaw'>, x: number, z: number): [number, number] {
  const cos = Math.cos(surface.yaw), sin = Math.sin(surface.yaw);
  const dx = x - surface.x, dz = z - surface.z;
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

/** Where a small item dropped from above would rest at (x, z): the highest open board under it, else the floor. */
export function supportAt(x: number, z: number, floorItems: readonly PlacedHomeItem[], footRadius = 0): SupportInfo {
  let best: SupportInfo = { height: 0, stable: true };
  for (const surface of restSurfaces(floorItems)) {
    if (surface.clearance !== Infinity || surface.height <= best.height) continue;
    const [lx, lz] = roomToSurface(surface, x, z);
    if (lx < surface.minX - 1e-6 || lx > surface.maxX + 1e-6 || lz < surface.minZ - 1e-6 || lz > surface.maxZ + 1e-6) continue;
    const inset = surface.inset + footRadius;
    const halfX = Math.max(.005, (surface.maxX - surface.minX) / 2 - inset), halfZ = Math.max(.005, (surface.maxZ - surface.minZ) / 2 - inset);
    const stable = Math.abs(lx - (surface.minX + surface.maxX) / 2) <= halfX + 1e-6 && Math.abs(lz - (surface.minZ + surface.maxZ) / 2) <= halfZ + 1e-6;
    best = { on: surface.on, height: surface.height, stable };
  }
  return best;
}

/** True when a resting small item is carried by the furniture: on its top or on any board inside it. */
export function restsOn(small: HomePlacement, furniture: PlacedHomeItem, tolerance = .12): boolean {
  const { definition, placement } = furniture;
  if (!definition.surface && !definition.shelves?.length) return false;
  if (!pointInsideCorners(small.x, small.z, footprintCorners(definition, placement))) return false;
  const lowest = Math.min(definition.surface?.height ?? Infinity, ...(definition.shelves ?? []).map(shelf => shelf.y));
  return small.y >= placement.y + lowest - tolerance && small.y <= placement.y + (definition.surface?.height ?? definition.size.height) + definition.size.height;
}

/**
 * Solid boxes standing in for a piece of furniture with shelves, at yaw 0 with
 * its base on y = 0: every board, the closed sides of each bay and the top. A
 * single hull would fill the bays; these leave them open for small things.
 */
export function shelfBlocks(item: Pick<HomeItemDefinition, 'size' | 'center' | 'surface' | 'shelves'>): Box3[] {
  return item.shelves?.length ? physicalItemSolidBoxes(item) : [];
}

type CarrierPose = Pick<HomePlacement, 'x' | 'z' | 'yaw'> & Partial<Pick<HomePlacement, 'y' | 'tilt'>>;

/** Keep the full relative pose when moving or righting furniture and its riders. */
export function carryPose(before: CarrierPose, after: CarrierPose, pose: HomePlacement): HomePlacement {
  const local = containerLocalPose({ ...before, y: before.y ?? 0 }, pose);
  const result = containerWorldPose({ ...after, y: after.y ?? 0 }, local);
  result.yaw = normalizeYaw(result.yaw);
  if (!pose.tilt && !before.tilt && !after.tilt) delete result.tilt;
  return result;
}

export function createEmptyLayout(): HomeLayoutState {
  return { version: 1, placements: [] };
}

export function countPlacements(state: HomeLayoutState, itemId: string): number {
  return state.placements.reduce((total, placement) => total + Number(placement.item === itemId), 0);
}

/** Why one more copy of an item cannot be placed, or undefined when it can. */
export function placementLimit(state: HomeLayoutState, item: HomeItemDefinition, definitions: readonly HomeItemDefinition[], limits: HomeLimits = HOME_LIMITS): 'placements' | 'perItem' | 'small' | undefined {
  if (state.placements.length >= limits.placements) return 'placements';
  if (countPlacements(state, item.id) >= limits.perItem) return 'perItem';
  if (item.mount !== 'small') return undefined;
  const small = new Set(definitions.filter(definition => definition.mount === 'small').map(definition => definition.id));
  const count = state.placements.reduce((total, placement) => total + Number(small.has(placement.item)), 0);
  return count >= limits.small ? 'small' : undefined;
}

export interface SanitizedLayout { state: HomeLayoutState; dropped: number }

/** Validate saved placements in order. The first of two conflicting placements wins. */
export function sanitizeHomeLayout(saved: unknown, definitions: readonly HomeItemDefinition[], bounds: HomeBounds, limits: HomeLimits = HOME_LIMITS, mode: 'placement' | 'preview' = 'placement'): SanitizedLayout {
  const known = new Map<string, HomeItemDefinition>();
  for (const item of definitions) if (typeof item.id === 'string' && item.id && !known.has(item.id) && validDefinition(item)) known.set(item.id, item);
  const compatible = isRecord(saved) && saved.version === 1 && Array.isArray(saved.placements) ? saved.placements : [];
  const accepted: PlacedHomeItem[] = [];
  const ids = new Set<string>();
  const perItem = new Map<string, number>();
  let dropped = 0, small = 0;
  for (const candidate of compatible) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(candidate.id) || ids.has(candidate.id)
      || typeof candidate.item !== 'string') { dropped++; continue; }
    const definition = known.get(candidate.item);
    if (!definition) { dropped++; continue; }
    const placement: HomePlacement = { id: candidate.id, item: candidate.item, x: candidate.x as number, y: candidate.y as number, z: candidate.z as number, yaw: candidate.yaw as number };
    if (candidate.tilt !== undefined) placement.tilt = candidate.tilt as HomePlacement['tilt'];
    if (!validPlacementNumbers(placement)) { dropped++; continue; }
    placement.yaw = normalizeYaw(placement.yaw);
    if (placement.tilt) placement.tilt = placement.tilt.map(value => Number(value)) as HomePlacement['tilt'];
    const count = perItem.get(definition.id) ?? 0;
    if (accepted.length >= limits.placements || count >= limits.perItem || (definition.mount === 'small' && small >= limits.small)) { dropped++; continue; }
    // Saved physical poses can contain tiny solver penetrations or a fallen
    // object beside its support. Re-running an upright preview check must not
    // erase those instances. Physics rebuilds their contacts after loading.
    // Read-only displays can retain arrangements from before the new collision rules.
    const checkBoundsOnly = definition.mount !== 'wall' && (mode === 'preview' || definition.mount === 'small' || (placement.tilt && canTipItem(definition)));
    const check = checkBoundsOnly ? checkPoseBounds(definition, placement, bounds)
      : checkPlacement(definition, placement, bounds, mode === 'preview' ? [] : accepted);
    if (!check.ok) { dropped++; continue; }
    accepted.push({ definition, placement });
    ids.add(placement.id); perItem.set(definition.id, count + 1);
    if (definition.mount === 'small') small++;
  }
  return { state: { version: 1, placements: accepted.map(entry => entry.placement) }, dropped };
}

/** Short, URL-safe instance IDs; collisions inside one layout are retried by the caller. */
export function createPlacementId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let index = 0; index < 8; index++) id += alphabet[Math.floor(clamp(random(), 0, .999999) * alphabet.length)];
  return id;
}
