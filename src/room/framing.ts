import { Vector3 } from 'three';

export interface RoomFramingBounds { width: number; depth: number; height: number }
export interface RoomViewport { width: number; height: number }
export interface RoomSafeInsets { top: number; right: number; bottom: number; left: number }
interface Point3 { x: number; y: number; z: number }
export interface RoomFramingOptions {
  bounds: RoomFramingBounds;
  viewport: RoomViewport;
  zoom?: number;
  insets?: Partial<RoomSafeInsets>;
  /** Optional authored hull in world coordinates; omit grid and expansion previews. */
  points?: readonly Point3[];
}

const viewRight = new Vector3(1, 0, -1).normalize();
const viewUp = new Vector3(-1, 2, -1).normalize();
const viewBack = new Vector3(1, 1, 1).normalize();

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
}

/** The two back walls and the floor, including the shipped trim and base. */
export function roomCutawayHull({ width, depth, height }: RoomFramingBounds): Vector3[] {
  positive(width, 'Room width'); positive(depth, 'Room depth'); positive(height, 'Room height');
  // Authored window/wall trim extends 0.18 m; the rendered plinth extends 0.14 m.
  const x = width / 2 + .18, z = depth / 2 + .18;
  const points = [-.26, 0].flatMap(y => [
    new Vector3(-x, y, -z), new Vector3(x, y, -z),
    new Vector3(-x, y, z), new Vector3(x, y, z),
  ]);
  // The extra 0.025 m covers the thin cube outline above the walls.
  const top = height + .025;
  points.push(new Vector3(-x, top, -z), new Vector3(x, top, -z), new Vector3(-x, top, z));
  return points;
}

/** Fit the room into the HUD's safe rectangle without changing its isometric angle. */
export function fitRoomCamera({ bounds, viewport, zoom = 1, insets, points }: RoomFramingOptions) {
  positive(viewport.width, 'Viewport width'); positive(viewport.height, 'Viewport height'); positive(zoom, 'Zoom');
  const hull = points ?? roomCutawayHull(bounds);
  if (hull.length === 0) throw new RangeError('The room hull must contain points');
  const narrow = viewport.width <= 700;
  const safe: RoomSafeInsets = {
    top: 68, right: narrow ? 12 : 20, bottom: narrow ? 84 : 85, left: narrow ? 12 : 20, ...insets,
  };
  for (const [name, value] of Object.entries(safe)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Safe inset ${name} must be finite and non-negative`);
  }
  // Very short transient resize states still need a usable, finite projection.
  const horizontalScale = Math.min(1, viewport.width * .8 / (safe.left + safe.right || 1));
  const verticalScale = Math.min(1, viewport.height * .8 / (safe.top + safe.bottom || 1));
  safe.left *= horizontalScale; safe.right *= horizontalScale;
  safe.top *= verticalScale; safe.bottom *= verticalScale;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minWorldX = Infinity, maxWorldX = -Infinity, minWorldY = Infinity, maxWorldY = -Infinity;
  let minWorldZ = Infinity, maxWorldZ = -Infinity;
  for (const point of hull) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError('Room hull points must be finite');
    const x = viewRight.dot(point), y = viewUp.dot(point);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minWorldX = Math.min(minWorldX, point.x); maxWorldX = Math.max(maxWorldX, point.x);
    minWorldY = Math.min(minWorldY, point.y); maxWorldY = Math.max(maxWorldY, point.y);
    minWorldZ = Math.min(minWorldZ, point.z); maxWorldZ = Math.max(maxWorldZ, point.z);
  }
  const projectedWidth = maxX - minX, projectedHeight = maxY - minY;
  positive(projectedWidth, 'Projected room width'); positive(projectedHeight, 'Projected room height');
  const center = new Vector3((minWorldX + maxWorldX) / 2, (minWorldY + maxWorldY) / 2, (minWorldZ + maxWorldZ) / 2);
  const target = viewRight.clone().multiplyScalar((minX + maxX) / 2)
    .addScaledVector(viewUp, (minY + maxY) / 2)
    .addScaledVector(viewBack, center.dot(viewBack));
  const unitsPerPixel = Math.max(
    projectedWidth / (viewport.width - safe.left - safe.right),
    projectedHeight / (viewport.height - safe.top - safe.bottom),
  ) / Math.min(1.65, Math.max(.7, zoom));
  const centerX = (safe.left + viewport.width - safe.right) / 2;
  const centerY = (safe.top + viewport.height - safe.bottom) / 2;

  return {
    target,
    position: target.clone().add(new Vector3(14, 14, 14)),
    left: -centerX * unitsPerPixel,
    right: (viewport.width - centerX) * unitsPerPixel,
    top: centerY * unitsPerPixel,
    bottom: -(viewport.height - centerY) * unitsPerPixel,
  };
}
