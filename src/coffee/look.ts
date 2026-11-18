import * as THREE from 'three';

export function createLook(anisotropy: number) {
  let seed = 7; const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const drawn = (size: number, paint: (g: CanvasRenderingContext2D, n: number) => void) => { const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d')!, size); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; return t; };
  const tiled = (t: THREE.Texture, x: number, y = x) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
  const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
  const brushing = drawn(512, (g, n) => { g.fillStyle = grey(128); g.fillRect(0, 0, n, n);
    for (let i = 0; i < 14000; i++) { const x = rand() * n, y = rand() * n, w = 30 + rand() * 220; g.fillStyle = grey(60 + rand() * 150, .2); g.fillRect(x, y, w, 1); if (x + w > n) g.fillRect(x - n, y, w, 1); } });
  const smudges = drawn(512, (g, n) => { g.fillStyle = grey(118); g.fillRect(0, 0, n, n);
    for (let i = 0; i < 90; i++) { const x = rand() * n, y = rand() * n, r = 18 + rand() * 90, v = rand() < .6 ? 215 : 50; for (const [ox, oy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) { const blot = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); blot.addColorStop(0, grey(v, .16)); blot.addColorStop(1, grey(v, 0)); g.fillStyle = blot; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
    g.lineCap = 'round'; for (let i = 0; i < 26; i++) { const x = rand() * n, y = rand() * n, a = rand() * 6.3; g.strokeStyle = grey(225, .14); g.lineWidth = 5 + rand() * 9; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30, x + Math.cos(a + .5) * 62, y + Math.sin(a + .5) * 62); g.stroke(); } // wiped and touched
    for (let i = 0; i < 160; i++) { const x = rand() * n, y = rand() * n, a = rand() * 6.3, l = 6 + rand() * 40; g.strokeStyle = grey(235, .22); g.lineWidth = .6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } }); // hairline scratches
  const tooth = drawn(256, (g, n) => { const image = g.createImageData(n, n); for (let i = 0; i < n * n; i++) { const v = 128 + (rand() - .5) * 110; image.data.set([v, v, v, 255], i * 4); } g.putImageData(image, 0, 0); });
  const weave = drawn(64, (g, n) => { g.fillStyle = grey(110); g.fillRect(0, 0, n, n); for (let y = 0; y < n; y += 8) for (let x = 0; x < n; x += 8) { const over = (x + y) / 8 % 2 === 0; g.fillStyle = grey(over ? 200 : 60); g.fillRect(x + 1, y + 1, over ? 6 : 3, over ? 3 : 6); } });
  // Nothing made is one flat colour with one even finish. Every plain material therefore carries a faint mottling of its colour
  // and a patchy, slightly scuffed finish, unless it brings a texture of its own.
  const mottle = drawn(256, (g, n) => { g.fillStyle = grey(238); g.fillRect(0, 0, n, n);
    for (let i = 0; i < 70; i++) { const x = rand() * n, y = rand() * n, r = 14 + rand() * 60, v = rand() < .5 ? 255 : 196; for (const [ox, oy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) { const blot = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); blot.addColorStop(0, grey(v, .2)); blot.addColorStop(1, grey(v, 0)); g.fillStyle = blot; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
    for (let i = 0; i < 2600; i++) { g.fillStyle = grey(rand() < .5 ? 255 : 150, .07); g.fillRect(rand() * n, rand() * n, 1.5, 1.5); } }); mottle.colorSpace = THREE.SRGBColorSpace;
  const finish = drawn(256, (g, n) => { g.fillStyle = grey(232); g.fillRect(0, 0, n, n);
    for (let i = 0; i < 60; i++) { const x = rand() * n, y = rand() * n, r = 12 + rand() * 50, v = rand() < .65 ? 255 : 150; for (const [ox, oy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) { const blot = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); blot.addColorStop(0, grey(v, .22)); blot.addColorStop(1, grey(v, 0)); g.fillStyle = blot; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
    for (let i = 0; i < 90; i++) { const x = rand() * n, y = rand() * n, a = rand() * 6.3, l = 8 + rand() * 50; g.strokeStyle = grey(255, .25); g.lineWidth = .7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } });
  // The worktops are a plain pale composite: one even colour with only the fine fleck such a surface has close up, and no veining.
  const slab = drawn(512, (g, n) => { g.fillStyle = '#b3ada3'; g.fillRect(0, 0, n, n); for (let i = 0; i < 5200; i++) { g.fillStyle = rand() < .5 ? 'rgba(255,255,255,.12)' : 'rgba(92,90,96,.08)'; g.fillRect(rand() * n, rand() * n, 1 + rand(), 1 + rand()); } }); slab.colorSpace = THREE.SRGBColorSpace;
  const std = (color: THREE.ColorRepresentation, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: extra.roughnessMap ? roughness : Math.min(1, roughness * 1.1), metalness,
    ...(extra.map || extra.transparent || extra.emissive ? {} : { map: mottle }), ...(extra.roughnessMap ? {} : { roughnessMap: finish }), ...extra });
  // A roughness map scales the roughness it is given, and these average about a half, so the base values are doubled.
  const worn = tiled(smudges, 1.5), mats = {
    steel: std('#d5d8db', .5, 1, { roughnessMap: worn }), brushed: std('#aeb3b8', .8, 1, { roughnessMap: tiled(brushing, 1, 3), bumpMap: tiled(brushing, 1, 3), bumpScale: .08 }), chrome: std('#e4e7ea', .26, 1, { roughnessMap: worn }),
    dark: std('#17181a', .8, .2, { roughnessMap: worn }), rubber: std('#0f0f10', .85, 0, { bumpMap: tiled(tooth, 6), bumpScale: .6 }),
    brass: std('#c9993a', .44, 1, { roughnessMap: worn }), paper: std('#f1ebdf', .88, 0, { bumpMap: tiled(tooth, 3), bumpScale: .35 }), ceramic: std('#f4f1ea', .42, 0, { roughnessMap: worn }), bean: std('#3a2114', .55),
    glass: new THREE.MeshPhysicalMaterial({ color: '#eef6f7', roughness: .05, metalness: 0, transparent: true, opacity: .14, side: THREE.DoubleSide, envMapIntensity: 1, clearcoat: 1, depthWrite: false }),
    ice: new THREE.MeshPhysicalMaterial({ color: '#dff3fb', roughness: .12, transparent: true, opacity: .62, clearcoat: 1, envMapIntensity: 1.4 }),
    /** Woven cloth; `threads` is how many times the weave repeats across the piece. */
    cloth: (color: THREE.ColorRepresentation, threads = 40) => std(color, 1, 0, { bumpMap: tiled(weave, threads), bumpScale: 1.2 }),
    tooth: tiled(tooth, 3), std,
    /** A plain honed worktop, `long` metres by `deep`. */
    marble: (long: number, deep: number, shift = 0) => { const face = slab.clone(); face.repeat.set(long * 2.2, deep * 2.2); face.offset.set(shift, shift); face.needsUpdate = true;
      return new THREE.MeshPhysicalMaterial({ map: face, roughness: .5, roughnessMap: worn, metalness: 0, clearcoat: .35, clearcoatRoughness: .25, envMapIntensity: 1.1 }); },
  };

  return { mats };
}
export type Look = ReturnType<typeof createLook>;
