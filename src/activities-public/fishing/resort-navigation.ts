export type FishingZone = 'shallows' | 'reeds' | 'mud-bay' | 'inlet';
export interface ShorePoint { x: number; z: number }
export interface ShoreObstacle extends ShorePoint { radius: number }

/** Distance to the lake shore in world metres. */
export function lakeDistance(x: number, z: number) {
  const a = Math.atan2((z + 48) / 78, x / 64);
  return (Math.hypot(x / 64, (z + 48) / 78) - 1 - .045 * Math.sin(5 * a) - .03 * Math.cos(7 * a)) * 60;
}
export function lakeGround(x: number, z: number) {
  const d = lakeDistance(x, z);
  if (d < 0) return Math.max(-5.6, d * .27);
  const h = .035 + d * .065 + Math.max(0, d - 9) * (.22 + .14 * Math.sin(x * .036 + z * .023))
    + Math.max(0, d - 28) * (.26 + .13 * Math.cos(x * .051 - z * .013))
    + Math.min(1, d / 8) * (.28 * Math.sin(x * .24) + .23 * Math.cos(z * .19) + .17 * Math.sin(x * .1 + z * .32));
  return 32 * (1 - Math.exp(-h / 32));
}
export function shorePoint(angle: number, bankDistance = 4.4): ShorePoint {
  const r = 1 + .045 * Math.sin(5 * angle) + .03 * Math.cos(7 * angle) + bankDistance / 60;
  return { x: Math.cos(angle) * 64 * r, z: -48 + Math.sin(angle) * 78 * r };
}
export const FISHING_ZONES = [
  { id: 'shallows', name: 'Dock shallows', note: 'Small ripples, gentle bites', angle: Math.PI / 2, bait: 'worm' },
  { id: 'reeds', name: 'Reedwater bend', note: 'A hunter waits by the reeds', angle: .28, bait: 'minnow' },
  { id: 'inlet', name: 'Clearwater inlet', note: 'Cool currents, quick turns', angle: -Math.PI / 2, bait: 'insect' },
  { id: 'mud-bay', name: 'Willow bay', note: 'Bubbles rising from the lake bed', angle: Math.PI, bait: 'corn' },
] as const;
export function fishingZoneAt(x: number, z: number): FishingZone {
  let nearest: FishingZone = 'shallows', distance = Infinity;
  for (const zone of FISHING_ZONES) {
    const p = shorePoint(zone.angle), d = Math.hypot(p.x - x, p.z - z);
    if (d < distance) { nearest = zone.id; distance = d; }
  }
  return nearest;
}
