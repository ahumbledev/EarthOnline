export interface PhysicalItemProfileInput {
  id?: string;
  mount?: string;
  size?: { width: number; depth: number; height: number };
  rug?: boolean;
  tags?: readonly string[];
  capabilities?: { carry?: boolean; decorate?: boolean; tip?: boolean };
  container?: { interior: { min: readonly number[]; max: readonly number[] }; closable?: boolean };
}
export interface PhysicalItemProfile {
  tags: string[];
  capabilities: { carry: boolean; decorate: boolean; tip: boolean };
  container?: { interior: { min: [number, number, number]; max: [number, number, number] }; closable: boolean };
}
export function physicalItemProfile(definition: PhysicalItemProfileInput): PhysicalItemProfile;
