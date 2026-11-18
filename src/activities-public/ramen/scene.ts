import * as THREE from 'three';
import type { RenderQuality } from '../view.ts';
import type { RamenState } from './game.ts';

/** Practice board and dynamic noodle strands. */
export function createRamenScene() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9dfcf');
  scene.fog = new THREE.Fog('#e9dfcf', 8, 17);
  const camera = new THREE.PerspectiveCamera(39, 1, .05, 35);
  camera.position.set(2.7, 3.5, 5.2); camera.lookAt(0, .9, -.1);
  let disposed = false;
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const keepMaterial = <T extends THREE.Material>(material: T): T => { materials.add(material); return material; };
  const keepGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => { geometries.add(geometry); return geometry; };
  const standard = (params: THREE.MeshStandardMaterialParameters) => keepMaterial(new THREE.MeshStandardMaterial(params));
  const wood = standard({ color: new THREE.Color('#866142').multiply(new THREE.Color('#f3ded0')), roughness: .75 });
  const boardMaterial = standard({ color: '#e7c38a', roughness: .86 });
  const paint = standard({ color: '#d4beae', roughness: .87 });
  const doughMaterial = standard({ color: '#f5e6ba', roughness: .71 });
  const noodleMaterial = standard({ color: '#f3dfa8', roughness: .55 });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]) => {
    const object = new THREE.Mesh(keepGeometry(geometry), material); object.position.set(...position); object.castShadow = true; object.receiveShadow = true; scene.add(object); return object;
  };
  mesh(new THREE.BoxGeometry(3.9, .13, 2.3), wood, [0, .72, 0]);
  mesh(new THREE.BoxGeometry(3.15, .055, 1.62), boardMaterial, [0, .815, .1]);
  for (const x of [-1.65, 1.65]) for (const z of [-.9, .9]) mesh(new THREE.BoxGeometry(.14, .75, .14), wood, [x, .31, z]);
  mesh(new THREE.BoxGeometry(16, .15, 16), standard({ color: '#c7b9a4', roughness: .95 }), [0, -.16, -2]);
  mesh(new THREE.BoxGeometry(11, 5, .12), paint, [0, 2.3, -7]);
  const dough = mesh(new THREE.SphereGeometry(.28, 24, 16), doughMaterial, [0, .97, .1]);
  const flour = standard({ color: '#fff4da', roughness: 1 });
  for (let i = 0; i < 16; i++) {
    const grain = mesh(new THREE.SphereGeometry(.012 + (i % 3) * .004, 6, 4), flour,
      [Math.sin(i * 2.4) * .7, .85, .15 + Math.cos(i * 3.7) * .49]); grain.scale.y = .25;
  }
  const SEGMENTS = 40, MAX_STRANDS = 64;
  const strands = new THREE.InstancedMesh(keepGeometry(new THREE.CylinderGeometry(1, 1, 1, 6)), noodleMaterial, SEGMENTS * MAX_STRANDS);
  strands.instanceMatrix.setUsage(THREE.DynamicDrawUsage); strands.castShadow = true; strands.frustumCulled = false; scene.add(strands);
  const pinMaterial = standard({ color: '#ddbe8d', roughness: .7 });
  const ends = [-1, 1].map(() => mesh(new THREE.SphereGeometry(.09, 12, 8), pinMaterial, [0, 1.1, 0]));
  const hemi = new THREE.HemisphereLight('#fff8e9', '#8c816e', 2.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d4', 3.2); sun.position.set(-3, 6, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4; sun.shadow.bias = -.0005; scene.add(sun);
  const fill = new THREE.DirectionalLight('#cfdded', .7); fill.position.set(4, 2, -3); scene.add(fill);
  const dummy = new THREE.Object3D(), a = new THREE.Vector3(), b = new THREE.Vector3(), direction = new THREE.Vector3(), unitDirection = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function update(state: RamenState, seconds: number, kneadHeld: boolean) {
    const playing = state.stage === 'pulling' || state.stage === 'failed' || state.stage === 'won';
    dough.visible = !playing; strands.visible = playing;
    const press = kneadHeld && state.stage === 'kneading' ? .5 + Math.sin(seconds * 12) * .5 : 0;
    dough.scale.set(1.55 + press * .25, .65 - press * .15, .85 + press * .15);
    dough.rotation.y = state.kneaded * .6;
    const count = Math.min(MAX_STRANDS, 2 ** state.folds), radius = Math.max(.008, .047 / Math.sqrt(count));
    const span = .4 + state.length * 2.2;
    const served = state.stage === 'won';
    function point(t: number, strand: number, point: THREE.Vector3) {
      if (served) {
        const angle = t * Math.PI * 4.8 + strand * 2.4;
        const r = .12 + .18 * (.5 + .5 * Math.sin(t * Math.PI * 1.3 + strand * .8));
        return point.set(Math.cos(angle) * r, .94 + strand * .003 + Math.sin(angle * 2 + strand) * .025, .1 + Math.sin(angle) * r);
      }
      const z = .1 + (strand - (count - 1) / 2) * Math.min(.025, .48 / count);
      const sag = Math.sin(t * Math.PI) * (.06 + state.length * .12);
      const split = state.notice === 'torn' ? (t < .5 ? -.12 : .12) : 0;
      return point.set((t - .5) * span + split, 1.05 + state.length * .18 - sag, z);
    }
    let index = 0;
    for (let strand = 0; strand < count; strand++) for (let segment = 0; segment < SEGMENTS; segment++) {
      if (state.notice === 'torn' && segment === SEGMENTS / 2) continue;
      point(segment / SEGMENTS, strand, a); point((segment + 1) / SEGMENTS, strand, b);
      dummy.position.copy(a).add(b).multiplyScalar(.5); direction.copy(b).sub(a);
      dummy.quaternion.setFromUnitVectors(up, unitDirection.copy(direction).normalize()); dummy.scale.set(radius, direction.length(), radius); dummy.updateMatrix();
      strands.setMatrixAt(index++, dummy.matrix);
    }
    strands.count = index; strands.instanceMatrix.needsUpdate = true;
    ends.forEach((end, i) => { end.visible = playing && !served; end.position.set((i ? 1 : -1) * span / 2, 1.05 + state.length * .18, .1); });
  }
  function resize(width: number, height: number) {
    camera.aspect = width / Math.max(1, height);
    const narrow = camera.aspect < 1;
    camera.position.set(narrow ? 1.4 : 2.7, narrow ? 4.7 : 3.5, narrow ? 8 : 5.2);
    camera.lookAt(0, .9, -.1); camera.updateProjectionMatrix();
  }
  function setQuality(quality: RenderQuality) {
    sun.castShadow = quality.level !== 'low';
    const size = Math.min(1024, quality.shadowMapSize);
    if (sun.shadow.mapSize.x !== size) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(size, size); }
  }
  function dispose() {
    if (disposed) return; disposed = true;
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); sun.shadow.map?.dispose(); scene.clear();
  }
  return { scene, camera, update, resize, setQuality, dispose };
}
