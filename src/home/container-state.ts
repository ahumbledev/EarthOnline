import { physicalItemProfile } from './physical-items-profile.mjs';
import { physicalPlacementBounds, physicalPlacementsOverlap } from './physical-items-protocol.mjs';
import type { HomeItemDefinition, HomePlacement, PlacedHomeItem } from './state.ts';

type Quaternion = [number, number, number, number];
type Pose = Pick<HomePlacement, 'x' | 'y' | 'z' | 'yaw' | 'tilt'>;
export type PhysicalItemLocation = { kind: 'home' | 'warehouse' | 'carried' } | { kind: 'container'; containerId: string };
export interface LocatedHomeItem extends HomePlacement { location: PhysicalItemLocation; closed?: boolean }

function rotation(pose: Pose): Quaternion {
  if (!pose.tilt) return [0, Math.sin(pose.yaw / 2), 0, Math.cos(pose.yaw / 2)];
  const length = Math.hypot(...pose.tilt);
  if (!Number.isFinite(length) || length < 1e-8) throw new RangeError('Invalid physical rotation');
  return pose.tilt.map(value => value / length) as Quaternion;
}

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [x, y, z, w] = a, [bx, by, bz, bw] = b;
  return [w * bx + x * bw + y * bz - z * by, w * by - x * bz + y * bw + z * bx,
    w * bz + x * by - y * bx + z * bw, w * bw - x * bx - y * by - z * bz];
}

function rotate(x: number, y: number, z: number, q: Quaternion): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

function heading(q: Quaternion): number { return Math.atan2(2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] ** 2 + q[1] ** 2)); }

/** Store an item's pose relative to its box while keeping the same instance. */
export function containerLocalPose<T extends HomePlacement>(container: Pose, world: T): T {
  const q = rotation(container), inverse: Quaternion = [-q[0], -q[1], -q[2], q[3]];
  const [x, y, z] = rotate(world.x - container.x, world.y - container.y, world.z - container.z, inverse);
  const tilt = multiply(inverse, rotation(world));
  return { ...world, x, y, z, yaw: heading(tilt), tilt };
}

/** Opening or moving a box restores every item's world pose without cloning it. */
export function containerWorldPose<T extends HomePlacement>(container: Pose, local: T): T {
  const q = rotation(container), offset = rotate(local.x, local.y, local.z, q), tilt = multiply(q, rotation(local));
  return { ...local, x: container.x + offset[0], y: container.y + offset[1], z: container.z + offset[2], yaw: heading(tilt), tilt };
}

export function containerDescendants(containerId: string, items: readonly LocatedHomeItem[]): string[] {
  const result: string[] = [], visited = new Set([containerId]), queue = [containerId];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const item of items) {
      if (item.location.kind !== 'container' || item.location.containerId !== parent || visited.has(item.id)) continue;
      visited.add(item.id); result.push(item.id); queue.push(item.id);
    }
  }
  return result;
}

/** Would this reparenting make a container contain itself, directly or indirectly? */
export function containerWouldCycle(itemId: string, destinationId: string, items: readonly LocatedHomeItem[]): boolean {
  return itemId === destinationId || containerDescendants(itemId, items).includes(destinationId);
}

export type ContainerPlacementProblem = 'not-container' | 'outside-container' | 'overlap';
export function checkContainerPlacement(container: HomeItemDefinition, item: HomeItemDefinition, local: HomePlacement,
  contents: readonly PlacedHomeItem[]): { ok: boolean; problem?: ContainerPlacementProblem } {
  const profile = physicalItemProfile(container);
  if (!profile.container) return { ok: false, problem: 'not-container' };
  const box = physicalPlacementBounds(item, local), interior = profile.container.interior, tolerance = .001;
  if (box.min.some((value, axis) => !Number.isFinite(value) || value < interior.min[axis] - tolerance)
    || box.max.some((value, axis) => !Number.isFinite(value) || value > interior.max[axis] + tolerance)) return { ok: false, problem: 'outside-container' };
  if (contents.some(other => other.placement.id !== local.id
    && physicalPlacementsOverlap(item, local, other.definition, other.placement, tolerance))) return { ok: false, problem: 'overlap' };
  return { ok: true };
}

/** Find a real floor position inside a container; there is no abstract slot count. */
export function findContainerPlacement(container: HomeItemDefinition, item: HomeItemDefinition, instanceId: string,
  contents: readonly PlacedHomeItem[]): HomePlacement | undefined {
  const profile = physicalItemProfile(container);
  if (!profile.container) return;
  const interior = profile.container.interior, gap = .004;
  const occupied = contents.filter(other => other.placement.id !== instanceId).map(other => physicalPlacementBounds(other.definition, other.placement));
  for (const yaw of [0, Math.PI / 2]) {
    const origin: HomePlacement = { id: instanceId, item: item.id, x: 0, y: 0, z: 0, yaw };
    const box = physicalPlacementBounds(item, origin);
    const xs = [interior.min[0] - box.min[0] + gap, ...occupied.map(other => other.max[0] - box.min[0] + gap)];
    const zs = [interior.min[2] - box.min[2] + gap, ...occupied.map(other => other.max[2] - box.min[2] + gap)];
    for (const x of xs) for (const z of zs) {
      const placement = { ...origin, x, y: interior.min[1] - box.min[1] + gap, z };
      if (checkContainerPlacement(container, item, placement, contents).ok) return placement;
    }
  }
  return;
}
