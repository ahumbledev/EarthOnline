import * as THREE from 'three';
import { icecreamMeltFraction, icecreamPlacementOffset, type IcecreamConfig, type IcecreamState } from './rules.ts';
import type { RenderQuality } from '../view.ts';

const flavorColors: Record<string, string> = { vanilla: '#fff1ce', strawberry: '#e9a0a9', chocolate: '#794c39', matcha: '#a4b977', mango: '#f4c16a', mint: '#add4bc' };
export function icecreamColor(flavor: string): string {
  if (flavorColors[flavor]) return flavorColors[flavor];
  let hash = 0; for (const char of flavor) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return new THREE.Color().setHSL((Math.abs(hash) % 360) / 360, .35, .7).getStyle();
}

/** Local metre-scale serving station. */
export function createIcecreamScene(config: IcecreamConfig) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#f2ebe0');
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 30);
  camera.position.set(3.6, 3.1, 5.4); camera.lookAt(0, 1.12, -.05);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  let disposed = false;
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const material = (params: THREE.MeshStandardMaterialParameters) => { const value = new THREE.MeshStandardMaterial(params); materials.add(value); return value; };
  const wood = material({ color: '#f1d7ae', roughness: .74, normalScale: new THREE.Vector2(.35, .35) });
  const porcelain = material({ color: '#f5efe3', roughness: .35 });
  const creamPaint = material({ color: '#f4eddc', roughness: .85 });
  const pinkPaint = material({ color: '#e4abb1', roughness: .8 });
  const tealPaint = material({ color: '#78aaa6', roughness: .72 });
  const metal = material({ color: '#becbc9', metalness: .8, roughness: .27 });
  const mesh = (shape: THREE.BufferGeometry, mat: THREE.Material, position: [number, number, number], parent: THREE.Object3D = scene) => {
    const object = new THREE.Mesh(geometry(shape), mat); object.position.set(...position); object.castShadow = true; object.receiveShadow = true;
    parent.add(object); return object;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, at: [number, number, number]) => mesh(new THREE.BoxGeometry(w, h, d), mat, at);
  box(8, .12, 7, creamPaint, [0, -.08, 0]);
  box(8, 4, .12, pinkPaint, [0, 1.96, -2.6]);
  box(.12, 4, 5.2, creamPaint, [-3.9, 1.96, 0]);
  box(4.3, .7, 1.55, tealPaint, [0, .35, -.12]);
  box(4.48, .1, 1.68, wood, [0, .75, -.12]);
  box(4.2, .07, .08, metal, [0, .4, .67]);
  for (const x of [-1.85, 1.85]) box(.07, .35, .07, metal, [x, .2, .67]);
  box(3.1, .08, .42, wood, [0, 1.65, -2.15]);
  box(3.1, .08, .42, wood, [0, 2.3, -2.15]);
  // Visible inventory stays separate from the live serving object.
  for (let i = 0; i < 5; i++) {
    mesh(new THREE.CylinderGeometry(.13, .09, .25, 18, 1, true), porcelain, [-1.03 + i * .49, 1.82, -2.15]);
    const jar = mesh(new THREE.CylinderGeometry(.10, .10, .26, 16), i % 2 ? pinkPaint : tealPaint, [-.98 + i * .49, 2.48, -2.15]);
    mesh(new THREE.CylinderGeometry(.11, .11, .035, 16), wood, [jar.position.x, 2.625, -2.15]);
  }
  const tubs: { object: THREE.Mesh; x: number }[] = [];
  config.flavors.forEach((flavor, index) => {
    const x = (index - (config.flavors.length - 1) / 2) * .55;
    mesh(new THREE.BoxGeometry(.47, .16, .42), metal, [x, .87, -.59]);
    const object = mesh(new THREE.SphereGeometry(.22, 16, 10), material({ color: icecreamColor(flavor), roughness: .9 }), [x, .96, -.59]);
    object.scale.set(1, .35, .83); tubs.push({ object, x });
  });

  const serving = new THREE.Group(); serving.name = 'icecream-serving'; scene.add(serving);
  const cupMaterial = material({ color: '#fdfaf1', roughness: .75, side: THREE.DoubleSide });
  const cup = mesh(new THREE.CylinderGeometry(.22, .16, .34, 28, 1, true), cupMaterial, [0, .98, .25], serving);
  const rim = mesh(new THREE.TorusGeometry(.22, .018, 6, 28), porcelain, [0, 1.15, .25], serving); rim.rotation.x = Math.PI / 2;
  const coneMaterial = material({ color: '#ce9b61', roughness: .95 });
  const cone = mesh(new THREE.ConeGeometry(.2, .39, 28), coneMaterial, [0, .995, .25], serving); cone.rotation.z = Math.PI;
  const coneRim = mesh(new THREE.TorusGeometry(.197, .015, 6, 28), coneMaterial, [0, 1.19, .25], serving); coneRim.rotation.x = Math.PI / 2;
  // Thin rings and ribs give the wafer real geometry instead of a decorative raster substitute.
  const wafer = new THREE.Group(); serving.add(wafer);
  for (let i = 0; i < 6; i++) {
    const t = (i + 1) / 7;
    const ring = mesh(new THREE.TorusGeometry(.2 * t, .004, 4, 20), coneMaterial, [0, .80 + .39 * t, .25], wafer); ring.rotation.x = Math.PI / 2;
  }
  const scoopMaterials = Array.from({ length: 3 }, () => material({ color: '#fff1ce', roughness: .88 }));
  const scoops = scoopMaterials.map(mat => mesh(new THREE.SphereGeometry(.235, 22, 16), mat, [0, 1.31, .25], serving));
  const spoonHead = mesh(new THREE.SphereGeometry(.17, 18, 12), metal, [0, 1.7, .25]); spoonHead.scale.set(1, .32, 1);
  const spoonHandle = mesh(new THREE.CylinderGeometry(.025, .025, .7, 8), metal, [.32, 1.78, .25]); spoonHandle.rotation.z = Math.PI / 2 - .16;
  const pendingMaterial = material({ color: '#fff1ce', roughness: .88 });
  const pending = mesh(new THREE.SphereGeometry(.23, 22, 16), pendingMaterial, [0, 1.72, .25]);
  const puddle = mesh(new THREE.CylinderGeometry(.31, .31, .008, 26), material({ color: '#e6b3bd', transparent: true, opacity: .65, roughness: .3 }), [0, .807, .25]);
  const toppingMaterial = material({ color: '#ffffff', roughness: .7 });
  const sprinkles = new THREE.InstancedMesh(geometry(new THREE.CylinderGeometry(.008, .008, .055, 5)), toppingMaterial, 36);
  sprinkles.castShadow = true; sprinkles.frustumCulled = false; scene.add(sprinkles);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 36; i++) sprinkles.setColorAt(i, new THREE.Color(['#d67787', '#73a09b', '#efc676', '#82543d'][i % 4]));
  const cookie = mesh(new THREE.CylinderGeometry(.13, .13, .045, 20), coneMaterial, [.08, 1.7, .25]); cookie.rotation.z = .55;
  const hemi = new THREE.HemisphereLight('#fff8ee', '#afc1bd', 2.4); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3dc', 3); sun.position.set(-3, 5, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4; sun.shadow.bias = -.0006; scene.add(sun);
  const fill = new THREE.DirectionalLight('#d9eeef', .6); fill.position.set(4, 2, -1); scene.add(fill);

  return {
    scene, camera,
    setQuality(quality: RenderQuality) {
      sun.castShadow = quality.level !== 'low'; sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    },
    update(state: IcecreamState, now: number) {
      const frozenNow = state.result?.servedAt ?? (state.phase === 'failed' ? state.updatedAt : now);
      const melt = icecreamMeltFraction(state, config, frozenNow);
      cup.visible = rim.visible = state.container === 'cup'; cone.visible = coneRim.visible = wafer.visible = state.container === 'cone';
      let x = 0;
      scoops.forEach((scoop, index) => {
        const placed = state.scoops[index]; scoop.visible = !!placed;
        if (!placed) return;
        x += placed.offset * .1;
        scoop.position.set(x, 1.26 + index * .32 * (1 - melt * .4), .25);
        scoop.scale.set(1 + melt * .12, (1 - melt * .45) * (.8 + placed.quality * .2), 1 + melt * .12);
        scoopMaterials[index].color.set(icecreamColor(placed.flavor));
        if (state.failure === 'toppled') { scoop.rotation.z = index * .6; scoop.position.x += index * .22; scoop.position.y -= index * .13; }
      });
      pending.visible = !!state.pendingScoop; spoonHead.visible = spoonHandle.visible = !!(state.pendingScoop || state.activeScoop);
      if (state.pendingScoop) {
        const px = icecreamPlacementOffset(state, now) * .62;
        pending.position.set(px, 1.65 + state.scoops.length * .3, .25);
        pendingMaterial.color.set(icecreamColor(state.pendingScoop.flavor));
        pending.scale.setScalar(.8 + state.pendingScoop.quality * .2);
        spoonHead.position.set(px, pending.position.y - .16, .25); spoonHandle.position.set(px + .34, pending.position.y - .10, .25);
      } else if (state.activeScoop) {
        const index = config.flavors.indexOf(state.activeScoop.flavor), tub = tubs[index];
        const angle = (now - state.activeScoop.startedAt) / 900 * Math.PI * 2;
        spoonHead.position.set((tub?.x ?? 0) + Math.cos(angle) * .08, 1.05, -.59 + Math.sin(angle) * .08);
        spoonHandle.position.copy(spoonHead.position).add(new THREE.Vector3(.34, .06, 0));
      }
      puddle.visible = melt > .1; puddle.scale.setScalar(.4 + melt * 1.2);
      const top = scoops[Math.max(0, state.scoops.length - 1)];
      sprinkles.visible = !!state.topping && state.topping !== 'cookie'; cookie.visible = state.topping === 'cookie';
      cookie.position.set(top.position.x + .11, top.position.y + .17, .25);
      if (sprinkles.visible) {
        for (let i = 0; i < 36; i++) {
          const angle = i * 2.4, radius = Math.sqrt((i + 1) / 37) * .2;
          dummy.position.set(top.position.x + Math.cos(angle) * radius, top.position.y + .18 * Math.sqrt(1 - radius * radius / .055), .25 + Math.sin(angle) * radius);
          dummy.rotation.set(Math.PI / 2, angle, i % 3); dummy.updateMatrix(); sprinkles.setMatrixAt(i, dummy.matrix);
        }
        sprinkles.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const value of geometries) value.dispose();
      for (const value of materials) value.dispose();
      sun.shadow.map?.dispose(); scene.clear();
    },
  };
}
