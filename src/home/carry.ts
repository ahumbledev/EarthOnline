import * as THREE from 'three';
import { footprintCorners, pointInsideCorners, supportAt, type HomeBounds, type HomePlacement, type PlacedHomeItem, type SupportInfo } from './state.ts';

/**
 * Hand placement for small things. The resident looks at a table or the floor;
 * the spot under the view centre becomes the candidate, measured in room metres.
 */
export interface AimRay { origin: THREE.Vector3; direction: THREE.Vector3 }
export interface AimResult { x: number; z: number; support: SupportInfo; distance: number }
export const CARRY_REACH = 2.6;
/** Where a carried item sits relative to the resident's feet origin: in front of the chest, right of centre. */
export const CARRY_SOCKET = new THREE.Vector3(.17, 1.0, .34);

/** Nearest table top or floor spot along the view ray within reach, or undefined when looking at nothing useful. */
export function aimPlacement(ray: AimRay, furniture: readonly PlacedHomeItem[], bounds: HomeBounds, reach = CARRY_REACH, footRadius = 0): AimResult | undefined {
  const { origin, direction } = ray;
  if (!Number.isFinite(direction.y) || direction.lengthSq() < 1e-9) return;
  let best: AimResult | undefined;
  const consider = (height: number, inside: (x: number, z: number) => boolean) => {
    if (direction.y >= -1e-6) return;
    const distance = (height - origin.y) / direction.y;
    if (distance <= 0 || distance > reach) return;
    const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance;
    if (!inside(x, z)) return;
    if (best && best.distance <= distance) return;
    best = { x, z, distance, support: supportAt(x, z, furniture, footRadius) };
  };
  for (const { definition, placement } of furniture) {
    if (definition.mount !== 'floor' || !definition.surface) continue;
    const corners = footprintCorners(definition, placement);
    consider(placement.y + definition.surface.height, (x, z) => pointInsideCorners(x, z, corners));
  }
  consider(0, (x, z) => Math.abs(x) <= bounds.width / 2 - .05 && Math.abs(z) <= bounds.depth / 2 - .05);
  // The candidate rests at supportAt's height: the highest top under the spot, never inside a table.
  return best;
}

/** The small item under the view ray, nearest first, within reach. */
export function aimPickup(ray: AimRay, items: readonly { placement: HomePlacement; radius: number; height: number }[], reach = CARRY_REACH): { placement: HomePlacement; distance: number } | undefined {
  let best: { placement: HomePlacement; distance: number } | undefined;
  const centre = new THREE.Vector3(), toCentre = new THREE.Vector3();
  for (const item of items) {
    centre.set(item.placement.x, item.placement.y + item.height / 2, item.placement.z);
    toCentre.subVectors(centre, ray.origin);
    const along = toCentre.dot(ray.direction);
    if (along <= 0 || along > reach) continue;
    const miss = Math.sqrt(Math.max(0, toCentre.lengthSq() - along * along));
    if (miss > Math.max(item.radius, item.height / 2) + .06) continue;
    if (!best || along < best.distance) best = { placement: item.placement, distance: along };
  }
  return best;
}
