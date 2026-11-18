import * as THREE from 'three';
import type { FacadeCity } from './types.ts';

/** French trade words stay whole: accents and kerning are handled by the font. */
export function createLatinSignAtlas(anisotropy: number, city: FacadeCity, plaque: boolean) {
  const canvas = document.createElement('canvas');
  const columns = plaque ? 8 : 4, rows = plaque ? 4 : 8;
  canvas.width = 2048; canvas.height = plaque ? 640 : 768;
  const context = canvas.getContext('2d')!;
  const width = canvas.width / columns, height = canvas.height / rows;
  city.trades.forEach((trade, index) => {
    const x = (index % columns) * width, y = Math.floor(index / columns) * height;
    const [board, ink] = city.palette[(index * 5 + 2) % city.palette.length];
    context.fillStyle = board; context.fillRect(x, y, width, height);
    context.strokeStyle = ink; context.lineWidth = plaque ? 2 : 1.5;
    context.strokeRect(x + 9, y + 9, width - 18, height - 18);
    context.fillStyle = ink; context.textAlign = 'center'; context.textBaseline = 'middle';
    const maximum = plaque ? 42 : 48;
    context.font = `600 ${maximum}px ${city.font}`;
    const size = Math.min(maximum, maximum * (width - 38) / Math.max(1, context.measureText(trade).width));
    context.font = `600 ${size}px ${city.font}`;
    context.fillText(trade, x + width / 2, y + height / 2 + size * 0.025);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.anisotropy = anisotropy;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, canvas };
}
