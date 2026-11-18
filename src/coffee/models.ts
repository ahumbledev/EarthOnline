// The shop and everything on the counter, modelled in code: turned profiles for anything round, rounded boxes for
// casework, tubes for pipework. Sizes are in metres and true to the real objects, because they are seen from arm's length.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Look } from './look.ts';
import type { CupKind } from './rules.ts';

type M = THREE.Material;
const shade = (mesh: THREE.Mesh, cast = true) => { mesh.castShadow = cast; mesh.receiveShadow = true; return mesh; };
export const put = <T extends THREE.Object3D>(object: T, parent: THREE.Object3D, x = 0, y = 0, z = 0) => { object.position.set(x, y, z); parent.add(object); return object; };
/** A solid of revolution from [radius, height] points. */
export const lathe = (points: [number, number][], material: M, segments = 40) => shade(new THREE.Mesh(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments), material));
export const rbox = (w: number, h: number, d: number, material: M, radius = .008) => shade(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2.01, h / 2.01, d / 2.01)), material));
export const cyl = (rt: number, rb: number, h: number, material: M, segments = 32, open = false) => shade(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments, 1, open), material));
export const tube = (points: [number, number, number][], radius: number, material: M) => shade(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 32, radius, 12), material));
export const sphere = (r: number, material: M) => shade(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), material));

export const cupShape: Record<CupKind, [number, number]> = { demi: [.031, .058], small: [.038, .092], medium: [.042, .118], large: [.046, .142] };

/** A paper cup. The outer wall takes the drawing; the inside is plain so ink never shows through. */
export function buildCup(look: Look, kind: CupKind, texture: THREE.Texture) {
  const [r, h] = cupShape[kind], b = r * .76, group = new THREE.Group();
  const outer = put(cyl(r, b, h, new THREE.MeshStandardMaterial({ map: texture, roughness: .86, bumpMap: look.mats.tooth, bumpScale: .35 }), 48, true), group, 0, h / 2, 0);
  put(lathe([[b - .002, .004], [r - .002, h - .001], [r + .0012, h + .0012], [r + .0026, h], [r + .0012, h - .0025]], look.mats.paper, 48), group); look.mats.paper.side = THREE.DoubleSide;
  put(cyl(b - .001, b - .001, .004, look.mats.paper, 32), group, 0, .004, 0);
  return { group, outer, radius: r, height: h, inner: b };
}

export const printed = (w: number, h: number, draw: (d: CanvasRenderingContext2D, w: number, h: number) => void) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

export function buildPitcher(look: Look) {
  const group = new THREE.Group(), r = .046, h = .105, steel = look.mats.steel.clone(); steel.side = THREE.DoubleSide;
  put(lathe([[0, 0], [r, 0], [r + .002, .012], [r - .004, h * .62], [r - .002, h - .004], [r + .001, h]], steel, 48), group);
  const spout = put(cyl(.012, .02, .03, steel, 16, true), group, 0, h - .012, -(r - .002)); spout.rotation.x = -.55; spout.scale.set(1, 1, .6);
  put(new THREE.Mesh(new THREE.TorusGeometry(.03, .0042, 10, 24, Math.PI), look.mats.steel), group, 0, h * .52, r + .004).rotation.set(0, Math.PI / 2, -Math.PI / 2);
  return { group, radius: r - .004, height: h, inner: r - .004 };
}

export function buildPortafilter(look: Look) {
  const group = new THREE.Group(), steel = look.mats.steel.clone(); steel.side = THREE.DoubleSide;
  put(lathe([[.03, -.026], [.035, -.022], [.0365, .0], [.041, .001], [.041, .006], [.035, .006], [.033, -.018], [0, -.02]], steel, 40), group);
  put(cyl(.007, .005, .016, look.mats.steel, 12), group, .011, -.034, 0); put(cyl(.007, .005, .016, look.mats.steel, 12), group, -.011, -.034, 0);
  const handle = put(lathe([[.0, 0], [.011, .0], [.012, .02], [.015, .05], [.016, .1], [.012, .125], [0, .13]], look.mats.dark, 20), group, 0, -.006, .04); handle.rotation.x = Math.PI / 2 + .1;
  put(cyl(.012, .012, .016, look.mats.chrome, 20), group, 0, -.004, .042).rotation.x = Math.PI / 2;
  const puck = put(cyl(.0325, .0325, .012, look.mats.std('#4a2c17', .95), 28), group, 0, -.005, 0); puck.visible = false;
  return { group, puck };
}

/**
 * A two-group espresso machine, seen from the barista's side (+z). The upper body overhangs the groups and carries
 * the keypad; the cup bay under each group is tall enough for the largest cup with the portafilter locked in.
 * Heads sit at the given x offsets; returns their lock points and where each brew button is.
 */
export function buildMachine(look: Look, headX: number[]) {
  const g = new THREE.Group(), { steel, brushed, chrome, dark, rubber, ceramic, brass, std } = look.mats, HZ = .05;
  const fascia = std('#0b0c0d', .1, .4, { envMapIntensity: 1.2 }), walnut = std('#9a7458', .45);
  for (const [x, z] of [[-.33, -.31], [.33, -.31], [-.33, 0], [.33, 0]]) { put(cyl(.024, .028, .04, chrome, 20), g, x, .022, z); put(cyl(.03, .03, .006, rubber, 20), g, x, .003, z); }
  put(rbox(.78, .06, .4, dark, .012), g, 0, .07, -.17);                               // chassis
  put(rbox(.72, .044, .2, brushed, .008), g, 0, .072, .08);                           // drip tray
  put(rbox(.68, .004, .16, dark, .001), g, 0, .095, .08);
  for (let i = 0; i < 24; i++) put(rbox(.012, .004, .156, chrome, .001), g, -.322 + i * .028, .098, .08);
  put(rbox(.72, .012, .01, chrome, .004), g, 0, .096, .177); for (const x of [-.356, .356]) put(rbox(.01, .012, .19, chrome, .004), g, x, .096, .083);
  put(rbox(.74, .3, .32, steel, .012), g, 0, .24, -.19);                              // boiler column
  put(rbox(.7, .25, .006, brushed, .002), g, 0, .235, -.028);                         // backsplash
  put(rbox(.78, .15, .46, steel, .022), g, 0, .455, -.12);                            // upper body over the groups
  put(rbox(.7, .084, .006, fascia, .002), g, 0, .455, .111);                          // keypad strip
  for (const x of [-.397, .397]) { put(rbox(.024, .5, .48, dark, .01), g, x, .29, -.12); put(rbox(.006, .3, .3, walnut, .003), g, x + Math.sign(x) * .012, .3, -.13); }
  // Cup warmer on top: a railed tray with cups resting upside down.
  put(rbox(.7, .006, .36, brushed, .002), g, 0, .533, -.14);
  for (const x of [-.345, .345]) put(tube([[x, .535, -.31], [x, .572, -.31], [x, .572, .03], [x, .535, .03]], .005, chrome), g);
  put(tube([[-.345, .572, -.31], [.345, .572, -.31]], .005, chrome), g); put(tube([[-.345, .572, .03], [.345, .572, .03]], .005, chrome), g);
  const cup = () => lathe([[.036, 0], [.037, .004], [.027, .052], [.025, .056], [0, .056]], ceramic, 28);
  for (let i = 0; i < 6; i++) { put(cup(), g, -.26 + i * .085, .536, -.24); if (i < 3) put(cup(), g, -.26 + i * .085, .566, -.24); if (i < 5) put(cup(), g, -.2 + i * .085, .536, -.13); }
  put(cyl(.06, .06, .028, ceramic, 32), g, .25, .55, -.13);
  // Back, toward the customers: vents and a blank plate.
  for (let i = 0; i < 6; i++) put(rbox(.22, .006, .004, dark, .001), g, 0, .19 + i * .022, -.351); put(rbox(.14, .032, .004, brass, .001), g, 0, .455, -.351);
  // Two working gauges: boiler pressure on the left, pump pressure on the right. Each needle hangs from a pivot the game turns.
  const SWEEP = 2.25, dial = (max: number, step: number, from: number, to: number, zone: string) => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const d = c.getContext('2d')!, at = (v: number) => -Math.PI / 2 - SWEEP + v / max * SWEEP * 2;
    d.fillStyle = '#f5f2ea'; d.fillRect(0, 0, 256, 256); d.translate(128, 128);
    d.strokeStyle = zone; d.lineWidth = 12; d.beginPath(); d.arc(0, 0, 100, at(from), at(to)); d.stroke();
    d.strokeStyle = d.fillStyle = '#1d1b19'; d.font = '600 26px system-ui, sans-serif'; d.textAlign = 'center'; d.textBaseline = 'middle';
    for (let v = 0; v <= max + 1e-6; v += step / 2) { const a = at(v), whole = Math.round(v / step) * step, major = Math.abs(v - whole) < 1e-6; d.lineWidth = major ? 5 : 2.5; d.beginPath(); d.moveTo(Math.cos(a) * (major ? 86 : 94), Math.sin(a) * (major ? 86 : 94)); d.lineTo(Math.cos(a) * 108, Math.sin(a) * 108); d.stroke(); if (major) d.fillText(String(Math.round(v * 10) / 10), Math.cos(a) * 62, Math.sin(a) * 62); }
    d.font = '20px system-ui, sans-serif'; d.fillText('bar', 0, 58);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  };
  const gauge = (x: number, max: number, step: number, from: number, to: number, zone: string) => {
    put(cyl(.027, .027, .012, chrome, 32), g, x, .455, .116).rotation.x = Math.PI / 2; put(cyl(.023, .023, .013, std('#f5f2ea', .5), 32), g, x, .455, .1165).rotation.x = Math.PI / 2;
    put(new THREE.Mesh(new THREE.CircleGeometry(.0225, 40), std('#ffffff', .45, 0, { map: dial(max, step, from, to, zone) })), g, x, .455, .1233);
    const pivot = put(new THREE.Group(), g, x, .455, .1242); put(rbox(.0016, .019, .0012, std('#b3261e', .5), .0005), pivot, 0, .0065, 0).castShadow = false; put(cyl(.0032, .0032, .002, dark, 16), pivot).rotation.x = Math.PI / 2;
    const glass = put(new THREE.Mesh(new THREE.CircleGeometry(.0228, 40), look.mats.glass), g, x, .455, .1262); glass.renderOrder = 2;
    /** Point the needle at a reading. */
    return (value: number) => { pivot.rotation.z = SWEEP - Math.min(1, Math.max(0, value / max)) * SWEEP * 2; };
  };
  const gauges = { boiler: gauge(-.032, 2.5, .5, 1, 1.5, '#4c9a5a'), pump: gauge(.032, 16, 4, 8, 10, '#4c9a5a') };
  const key = std('#3a3d40', .4);
  const heads = headX.map(x => {
    const head = new THREE.Group(); put(head, g, x, 0, 0);
    put(cyl(.058, .058, .012, chrome, 36), head, 0, .377, HZ); put(cyl(.05, .047, .034, chrome, 36), head, 0, .356, HZ); put(cyl(.044, .044, .012, dark, 36), head, 0, .339, HZ);
    const button = put(cyl(.014, .014, .012, std('#f2efe8', .35, 0, { emissive: '#ffb168', emissiveIntensity: .5 }), 24), head, 0, .455, .116); button.rotation.x = Math.PI / 2;
    put(new THREE.Mesh(new THREE.TorusGeometry(.017, .003, 10, 28), chrome), head, 0, .455, .117);
    for (const dx of [-.044, .044]) put(cyl(.007, .007, .008, key, 16), head, dx, .455, .115).rotation.x = Math.PI / 2;
    return { group: head, button, lock: new THREE.Vector3(x, .33, HZ), press: new THREE.Vector3(x, .455, .117) };
  });
  return { group: g, heads, gauges };
}
const knob = (look: Look, g: THREE.Group) => { put(cyl(.02, .023, .028, look.mats.dark, 24), g, 0, .455, .126).rotation.x = Math.PI / 2; put(cyl(.012, .012, .004, look.mats.chrome, 20), g, 0, .455, .142).rotation.x = Math.PI / 2; };
export function buildSteamWand(look: Look) {
  const g = new THREE.Group(), { chrome, dark } = look.mats;
  put(tube([[0, .378, .062], [0, .35, .085], [.004, .25, .1], [.012, .1, .1]], .0055, chrome), g);
  put(cyl(.007, .004, .016, chrome, 12), g, .012, .094, .1); put(sphere(.014, chrome), g, 0, .378, .062);
  put(cyl(.012, .012, .04, dark, 16), g, .006, .215, .1);
  knob(look, g);
  return g;
}
export function buildWaterTap(look: Look) {
  const g = new THREE.Group(), { chrome } = look.mats;
  put(tube([[0, .378, .062], [0, .35, .088], [0, .29, .095], [0, .25, .095]], .006, chrome), g); put(cyl(.008, .006, .014, chrome, 12), g, 0, .245, .095);
  put(sphere(.014, chrome), g, 0, .378, .062);
  knob(look, g);
  return g;
}
export function buildGrinder(look: Look) {
  const g = new THREE.Group(), { dark, chrome, glass, bean, brushed } = look.mats;
  put(rbox(.17, .3, .2, dark, .025), g, 0, .15, -.03); put(rbox(.19, .02, .22, brushed, .008), g, 0, .01, -.03);
  const hopper = glass.clone(); hopper.opacity = .12; hopper.envMapIntensity = .7;   // clear enough that the beans keep their colour
  put(lathe([[.045, 0], [.05, .01], [.085, .13], [.088, .15]], hopper, 40), g, 0, .3, -.03).renderOrder = 2;
  put(cyl(.089, .089, .008, dark, 40), g, 0, .455, -.03);
  // The hopper holds a heap, not loose beans: a solid mound that fills the cone, its top and its sides packed with beans half sunk into it.
  const wall = (y: number) => y < .01 ? .045 + y * .5 : .05 + (y - .01) * .29, LEVEL = .095, heap = put(new THREE.Group(), g, 0, .3, -.03);
  put(lathe([[0, .004], [wall(.004) - .007, .004], [wall(.05) - .007, .05], [wall(LEVEL) - .007, LEVEL], [.05, LEVEL + .012], [.025, LEVEL + .018], [0, LEVEL + .02]], look.mats.std('#24130b', .8), 36), heap).castShadow = false;
  const spots: [number, number, number][] = []; let seed = 7; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) { const t = Math.sqrt((i + .5) / 300), r = (wall(LEVEL) - .008) * t, a = i * 2.39996; spots.push([Math.cos(a) * r, LEVEL + .004 + .02 * (1 - t * t) + rnd() * .003, Math.sin(a) * r]); }
  for (let y = .008; y < LEVEL; y += .0072) { const r = wall(y) - .0065, n = Math.floor(r * 6.283 / .0088), turn = rnd() * 6; for (let k = 0; k < n; k++) { const a = turn + k / n * 6.283; spots.push([Math.cos(a) * r, y + (rnd() - .5) * .003, Math.sin(a) * r]); } }
  const beans = new THREE.InstancedMesh(new THREE.SphereGeometry(.0058, 7, 5), look.mats.std('#ffffff', .5), spots.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, .58, .72), tint = new THREE.Color();
  spots.forEach((at, i) => { q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)); m.compose(new THREE.Vector3(...at), q, s); beans.setMatrixAt(i, m); beans.setColorAt(i, tint.set(bean.color).multiplyScalar(.75 + rnd() * .6)); });
  beans.castShadow = false; beans.receiveShadow = true; heap.add(beans);
  put(rbox(.06, .05, .05, dark, .01), g, 0, .2, .085); put(cyl(.012, .016, .03, chrome, 16), g, 0, .165, .095);
  const fork = put(new THREE.Mesh(new THREE.TorusGeometry(.036, .0045, 10, 28, Math.PI * 1.25), chrome), g, 0, .105, .1); fork.rotation.set(Math.PI / 2, 0, Math.PI * .375);
  put(cyl(.011, .011, .01, look.mats.std('#f2efe8', .35, 0, { emissive: '#7fd08b', emissiveIntensity: .6 }), 20), g, .06, .26, .072).rotation.x = Math.PI / 2;
  /** How full the hopper looks, 0 to 1: the heap sinks into the narrow of the cone as beans are used. */
  g.userData.fill = (full: number) => { const f = Math.max(.14, Math.min(1, full)), wide = wall(LEVEL * f) / wall(LEVEL); heap.visible = full > .004; heap.scale.set(wide, f, wide); };
  return g;
}

export function buildMilk(look: Look) {
  const g = new THREE.Group(), steel = look.mats.steel;
  put(lathe([[0, 0], [.05, 0], [.052, .01], [.052, .16], [.04, .2], [.03, .215], [.032, .225]], steel, 36), g);
  put(cyl(.034, .034, .012, look.mats.dark, 28), g, 0, .232, 0);
  put(new THREE.Mesh(new THREE.TorusGeometry(.03, .004, 10, 24, Math.PI), steel), g, 0, .13, .054).rotation.set(0, Math.PI / 2, -Math.PI / 2);
  return g;
}
