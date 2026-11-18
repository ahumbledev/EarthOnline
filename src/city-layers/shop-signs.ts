import * as THREE from 'three';
import { HONG_KONG } from './cities/hong-kong.ts';
import type { FacadeCity } from './cities/types.ts';
import { createLatinSignAtlas } from './cities/latin-signs.ts';

/** Trade words only: the base layer never invents a shop's name or shows a brand. */
export const SHOP_TRADES = HONG_KONG.trades;
export const SIGN_COLUMNS = 4, SIGN_ROWS = 8;

/** Fascia boards for the street floor, one trade per cell. */
export function createShopSignAtlas(anisotropy: number, city: FacadeCity = HONG_KONG) {
  if (city.signWriting === 'latin') return createLatinSignAtlas(anisotropy, city, false);
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  const width = canvas.width / SIGN_COLUMNS, height = canvas.height / SIGN_ROWS;
  city.trades.forEach((trade, index) => {
    const x = (index % SIGN_COLUMNS) * width, y = Math.floor(index / SIGN_COLUMNS) * height;
    const [board, ink] = city.palette[(index * 5 + 2) % city.palette.length];
    context.fillStyle = board; context.fillRect(x, y, width, height);
    // light falls across a board from above; a keyline a hand's width in from the edge, as sign painters set one
    const shade = context.createLinearGradient(0, y, 0, y + height);
    shade.addColorStop(0, 'rgba(255,255,255,0.10)'); shade.addColorStop(.55, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.20)');
    context.fillStyle = shade; context.fillRect(x, y, width, height);
    context.fillStyle = 'rgba(0,0,0,0.18)'; context.fillRect(x, y, width, 4); context.fillRect(x, y + height - 4, width, 4);
    if (index % 2 === 0) { context.strokeStyle = ink; context.globalAlpha = .55; context.lineWidth = 2; context.strokeRect(x + 9, y + 11, width - 18, height - 22); context.globalAlpha = 1; }
    context.fillStyle = ink; context.textAlign = 'center'; context.textBaseline = 'middle';
    const weight = index % 3 === 0 ? 900 : 700;
    context.font = `${weight} 78px ${city.font}`;
    // Letter-spaced like a painted board: one glyph per equal step across the cell.
    const glyphs = [...trade], room = width - 24, step = Math.min(92, room / glyphs.length);
    context.save(); context.translate(x + width / 2, y + height / 2 + 4);
    glyphs.forEach((glyph, i) => {
      context.save(); context.translate((i - (glyphs.length - 1) / 2) * step, 0); context.scale(Math.min(1, step / 80), 1);
      context.fillText(glyph, 0, 0); context.restore();
    });
    context.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.anisotropy = anisotropy;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, canvas };
}

export const TALL_SIGN_COLUMNS = 8, TALL_SIGN_ROWS = 4;

/** The same trades written top to bottom, for the boards that stand out over the street. */
export function createTallSignAtlas(anisotropy: number, city: FacadeCity = HONG_KONG) {
  if (city.signWriting === 'latin') return createLatinSignAtlas(anisotropy, city, true);
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 2048;
  const context = canvas.getContext('2d')!;
  const width = canvas.width / TALL_SIGN_COLUMNS, height = canvas.height / TALL_SIGN_ROWS;
  city.trades.forEach((trade, index) => {
    const x = (index % TALL_SIGN_COLUMNS) * width, y = Math.floor(index / TALL_SIGN_COLUMNS) * height;
    const [board, ink] = city.palette[(index * 7 + 5) % city.palette.length];
    context.fillStyle = board; context.fillRect(x, y, width, height);
    context.fillStyle = ink; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.font = `900 104px ${city.font}`;
    const glyphs = [...trade].slice(0, 4), pitch = height / 4;
    glyphs.forEach((glyph, i) => context.fillText(glyph, x + width / 2, y + height / 2 + (i - (glyphs.length - 1) / 2) * pitch + 4));
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.anisotropy = anisotropy;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, canvas };
}
