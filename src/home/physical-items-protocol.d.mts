export interface PhysicalBounds { width: number; depth: number; height: number }
export interface PhysicalBox { min: [number, number, number]; max: [number, number, number] }
export interface PhysicalPose { x: number; y: number; z: number; yaw: number; tilt?: [number, number, number, number] }
export interface PhysicalItemDefinition {
  id?: string; size: PhysicalBounds; center?: { x: number; z: number }; mount?: string; rug?: boolean;
  physics?: { kind: string; points?: number[] }; surface?: { height: number; inset?: number };
  shelves?: { y: number; minX: number; maxX: number; minZ: number; maxZ: number; clearance?: number; open: readonly string[] }[];
  tags?: readonly string[]; capabilities?: { carry?: boolean; decorate?: boolean; tip?: boolean };
  container?: { interior: PhysicalBox; closable: boolean };
}
export function physicalPlacementBounds(definition: PhysicalItemDefinition, placement: PhysicalPose): PhysicalBox;
export function physicalPlacementsOverlap(a: PhysicalItemDefinition, pa: PhysicalPose, b: PhysicalItemDefinition, pb: PhysicalPose, tolerance?: number): boolean;
export function physicalItemSolidBoxes(definition: PhysicalItemDefinition, placement?: { closed?: boolean }): PhysicalBox[];
export function physicalSolidPlacementsOverlap(a: PhysicalItemDefinition, pa: PhysicalPose & { closed?: boolean }, b: PhysicalItemDefinition, pb: PhysicalPose & { closed?: boolean }, tolerance?: number): boolean;
