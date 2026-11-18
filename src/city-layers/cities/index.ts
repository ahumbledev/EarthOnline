import { MONTREAL } from './montreal.ts';
import { HONG_KONG } from './hong-kong.ts';
import type { FacadeCity } from './types.ts';

/** Omitted city identifies the existing Hong Kong layout-2 packages. */
export function facadeCity(id = 'hong-kong'): FacadeCity {
  if (id === HONG_KONG.id) return HONG_KONG;
  if (id === MONTREAL.id) return MONTREAL;
  throw new Error(`Unsupported base city: ${id}`);
}
