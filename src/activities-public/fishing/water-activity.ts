import type { FishId } from './fish-catalog.ts';
import type { FishingBait, FishingDepth, FishingZone } from './gameplay.ts';
import { fishingZoneAt, lakeDistance } from './resort-navigation.ts';

export type WaterActivityKind = 'bubbles' | 'rises' | 'chase';
export interface WaterActivity {
  readonly id: string;
  readonly kind: WaterActivityKind;
  readonly x: number;
  readonly z: number;
  /** Cast placement tolerance in world metres, not a screen-space target. */
  readonly radius: number;
  readonly zone: FishingZone;
  readonly bait: FishingBait;
  readonly depth: FishingDepth;
  readonly targetSpecies: readonly FishId[];
  readonly title: string;
  /** Describes the visible evidence without revealing an undiscovered fish. */
  readonly clue: string;
}

/** Authored feeding places in the fictional lake. All other water retains its
 * normal encounter pool; these clues reward reading water and placing a cast. */
const activityDefinitions = [
  {
    id: 'dock-rings', kind: 'rises', x: 4, z: 7.5, radius: 2.8,
    zone: 'shallows', bait: 'worm', depth: 'mid',
    targetSpecies: ['bluegill', 'pumpkinseed'],
    title: 'Rings off the dock',
    clue: 'Small feeding rings gather just right of the dock. Place an earthworm among them at mid depth.',
  },
  {
    id: 'willow-bubbles', kind: 'bubbles', x: -52.48, z: -48, radius: 2.6,
    zone: 'mud-bay', bait: 'corn', depth: 'bottom',
    targetSpecies: ['common-carp', 'crucian-carp', 'tench'],
    title: 'Bubbles in Willow bay',
    clue: 'Clusters of bubbles break the still water in Willow bay. Sweet corn on the bottom reaches the feeding fish.',
  },
  {
    id: 'inlet-hatch', kind: 'rises', x: 0, z: -110.79, radius: 2.8,
    zone: 'inlet', bait: 'insect', depth: 'surface',
    targetSpecies: ['rainbow-trout', 'brook-trout'],
    title: 'The inlet hatch',
    clue: 'Watch for insects and widening rings at Clearwater inlet. Drift a stream insect at the surface, close to a rise.',
  },
  {
    id: 'reed-chase', kind: 'chase', x: 54.3088, z: -28.9671, radius: 2.6,
    zone: 'reeds', bait: 'minnow', depth: 'mid',
    targetSpecies: ['largemouth-bass', 'chain-pickerel', 'northern-pike'],
    title: 'A chase by the reeds',
    clue: 'A fast wake splits the water at Reedwater bend. Place a minnow at mid depth where the chase begins.',
  },
] satisfies readonly WaterActivity[];
export const WATER_ACTIVITIES: readonly WaterActivity[] = Object.freeze(
  activityDefinitions.map(activity => Object.freeze({ ...activity, targetSpecies: Object.freeze(activity.targetSpecies) })),
);

export function getWaterActivity(id: string | undefined): WaterActivity | undefined {
  return id === undefined ? undefined : WATER_ACTIVITIES.find(activity => activity.id === id);
}

/** Only a correctly placed, compatible cast earns the feeding-place benefit.
 * The caller supplies the actual landing point, never the player's position. */
export function matchWaterActivity(x: number, z: number, bait: FishingBait, depth: FishingDepth): WaterActivity | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(z) || lakeDistance(x, z) >= -.8) return undefined;
  const zone = fishingZoneAt(x, z);
  let nearest: WaterActivity | undefined, nearestDistance = Infinity;
  for (const activity of WATER_ACTIVITIES) {
    if (activity.zone !== zone || activity.bait !== bait || activity.depth !== depth) continue;
    const distance = Math.hypot(x - activity.x, z - activity.z);
    if (distance <= activity.radius && distance < nearestDistance) { nearest = activity; nearestDistance = distance; }
  }
  return nearest;
}
