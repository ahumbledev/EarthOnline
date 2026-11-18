import * as THREE from 'three';
import { HONG_KONG } from './cities/hong-kong.ts';

/** One straightened photograph of a real front: a whole number of window bays by storeys, cut to tile. */
export interface FacadePanel {
  file: string; style: string; bays: number; storeys: number;
  /** Width of one bay and height of one storey in the photographed building, metres. */
  bay_m: number; storey_m: number;
  /** Glazed openings as [x0, y0, x1, y1] in panel coordinates, origin top left. */
  glass: [number, number, number, number][];
}
export interface FacadePanelSet { texture: THREE.DataArrayTexture; panels: FacadePanel[] }

export const MAX_PANELS = 24;
/** Panel style names in the order of the facade's style ids. */
export const PANEL_STYLES = HONG_KONG.styles;

/**
 * Photographed fronts as one array texture. Colour is the photograph; alpha
 * marks glass with a soft edge, so the facade can mirror the sky in it and
 * light the room behind it at night. Panels are grouped by style.
 */
export async function loadFacadePanels(url: string, size = 512, anisotropy = 8, styles: readonly string[] = PANEL_STYLES): Promise<FacadePanelSet> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Facade panels failed (${response.status})`);
  const listed = (await response.json() as { panels: FacadePanel[] }).panels.filter(panel => styles.includes(panel.style));
  const panels = listed.sort((a, b) => styles.indexOf(a.style) - styles.indexOf(b.style)).slice(0, MAX_PANELS);
  if (!panels.length) throw new Error('Facade panel list is empty');
  const data = new Uint8Array(size * size * 4 * panels.length);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  await Promise.all(panels.map(async (panel, layer) => {
    const image = await fetch(new URL(panel.file, new URL(url, location.href)).href).then(result => { if (!result.ok) throw new Error(`${panel.file}: ${result.status}`); return result.blob(); }).then(blob => createImageBitmap(blob));
    return { image, layer, panel };
  })).then(loaded => {
    for (const { image, layer, panel } of loaded) {
      context.clearRect(0, 0, size, size); context.imageSmoothingQuality = 'high'; context.drawImage(image, 0, 0, size, size); image.close();
      const pixels = context.getImageData(0, 0, size, size).data, offset = layer * size * size * 4, soft = 2.5 * size / 512;
      const alpha = new Float32Array(size * size);
      for (const [x0, y0, x1, y1] of panel.glass ?? []) {
        const left = x0 * size, top = y0 * size, right = x1 * size, bottom = y1 * size;
        for (let y = Math.max(0, Math.floor(top - soft)); y < Math.min(size, bottom + soft); y++) for (let x = Math.max(0, Math.floor(left - soft)); x < Math.min(size, right + soft); x++) {
          const inside = Math.min(x + 0.5 - left, right - x - 0.5, y + 0.5 - top, bottom - y - 0.5);
          alpha[y * size + x] = Math.max(alpha[y * size + x], Math.min(1, Math.max(0, inside / soft + 0.5)));
        }
      }
      for (let i = 0; i < size * size; i++) {
        data[offset + i * 4] = pixels[i * 4]; data[offset + i * 4 + 1] = pixels[i * 4 + 1]; data[offset + i * 4 + 2] = pixels[i * 4 + 2];
        data[offset + i * 4 + 3] = Math.round(alpha[i] * 255);
      }
    }
  });
  const texture = new THREE.DataArrayTexture(data, size, size, panels.length);
  texture.format = THREE.RGBAFormat; texture.type = THREE.UnsignedByteType; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.anisotropy = anisotropy; texture.needsUpdate = true;
  return { texture, panels };
}
