import * as THREE from 'three';

/** Grid nodes in game east/up/south coordinates; Float32LE rows run toward +Z. */
export interface TerrainHeightFieldEntry {
  url: string; width: number; height: number; origin: [number, number]; step: number;
  nodata: number; bytes: number; sha256: string;
}
export interface TerrainHeightField {
  texture: THREE.DataTexture; width: number; height: number;
  origin: [number, number]; step: number; nodata: number;
}

/** Decode independently of the host's byte order. Non-finite source cells become nodata. */
export function decodeTerrainHeightField(entry: TerrainHeightFieldEntry, buffer: ArrayBuffer): TerrainHeightField {
  const { width, height, origin, step, nodata, bytes } = entry;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2
    || !Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite)
    || !Number.isFinite(step) || step <= 0 || !Number.isFinite(nodata)) throw new Error('Invalid base-city terrain heightfield grid');
  const expected = width * height * 4;
  if (!Number.isSafeInteger(expected) || bytes !== expected || buffer.byteLength !== expected) throw new Error('Base-city terrain heightfield byte length does not match its grid');
  const source = new DataView(buffer), values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const value = source.getFloat32(i * 4, true);
    values[i] = Number.isFinite(value) ? value : nodata;
  }
  const texture = new THREE.DataTexture(values, width, height, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
  return { texture, width, height, origin, step, nodata };
}

export async function loadTerrainHeightField(entry: TerrainHeightFieldEntry, base: URL): Promise<TerrainHeightField> {
  const response = await fetch(new URL(entry.url, base), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Base-city terrain heightfield failed (${response.status})`);
  const buffer = await response.arrayBuffer();
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) throw new Error('Missing base-city terrain heightfield SHA-256');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== entry.sha256.toLowerCase()) throw new Error('Base-city terrain heightfield SHA-256 mismatch');
  return decodeTerrainHeightField(entry, buffer);
}

/** CPU equivalent used to anchor preview sunlight near the terrain, without raycasting the full TIN. */
export function sampleTerrainHeightField(field: TerrainHeightField, x: number, z: number, fallback: number): number {
  const gx = (x - field.origin[0]) / field.step, gz = (z - field.origin[1]) / field.step;
  if (!Number.isFinite(gx) || !Number.isFinite(gz) || gx < 0 || gz < 0 || gx > field.width - 1 || gz > field.height - 1) return fallback;
  const ix = Math.min(Math.floor(gx), field.width - 2), iz = Math.min(Math.floor(gz), field.height - 2);
  const fx = gx - ix, fz = gz - iz, data = field.texture.image.data as Float32Array, start = iz * field.width + ix;
  const a = data[start], b = data[start + 1], c = data[start + field.width], d = data[start + field.width + 1];
  if ([a, b, c, d].some(value => !Number.isFinite(value) || value === field.nodata)) return fallback;
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
