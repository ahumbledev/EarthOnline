import type { Group } from 'three';
import type { Building } from '../../maps/index.ts';

export function createCityHall(building: Building, assetBase: string): {
  walls: Group;
  details: Group;
  dispose(): void;
};
