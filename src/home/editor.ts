import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ISO_FOV, isometricPose, wallsFacingCamera, type QuarterTurn } from './camera.ts';
import { createSelectionOutline } from './selection-outline.ts';
import {
  carryPose, checkPlacementGroup, checkSupportedPlacement, createPlacementId, placementLimit, restsOn,
  sanitizeHomeLayout, snapToWall, snapValue, snapYaw, supportAt,
  type HomeItemDefinition, type HomeLayoutState, type HomePlacement, type PlacedHomeItem,
} from './state.ts';
import './editor.css';

const bounds = { width: 6, depth: 4.8, height: 2.6 };
const key = 'earthonline.room-layout.v1';

function item(id: string, name: string, mount: 'floor' | 'small', width: number, depth: number,
  height: number, surface?: number): HomeItemDefinition {
  return { id, name, mount, category: mount === 'floor' ? 'living' : 'small',
    pack: 'room', node: id, size: { width, depth, height }, ...(surface ? { surface: { height: surface } } : {}) };
}
const catalog = [
  item('wooden_stool_01', 'Wooden stool', 'floor', .45, .45, .54, .54),
  item('steel_frame_shelves_03', 'Steel shelves', 'floor', 1.32, .54, 1.55, 1.55),
  item('cardboard_box_01', 'Cardboard box', 'small', .43, .32, .31),
  item('plastic_crate_02', 'Plastic crate', 'small', .46, .35, .27),
  item('ceramic_pot', 'Ceramic pot', 'small', .24, .24, .31),
  item('potted_plant_04', 'Potted plant', 'small', .34, .34, .48),
];
const definitions = new Map(catalog.map(definition => [definition.id, definition]));
function initialLayout(): HomeLayoutState {
  const places: [number, number, number, number][] = [
    [1, -1.75, -1.5, 0], [0, .6, .05, 0], [5, .6, .05, .54], [3, -1.3, .55, 0],
  ];
  return { version: 1, placements: places.map(([index, x, z, y], i) => ({
    id: 'initial-' + i, item: catalog[index].id, x, y, z, yaw: 0,
  })) };
}

export function mountRoomEditor(host: HTMLElement): () => void {
  const root = document.createElement('section');
  root.className = 'room-editor';
  root.innerHTML = `<div class="room-tools"><label>Furniture <select data-palette></select></label>
    <button data-add>Add to room</button><label>Selection <select data-select></select></label>
    <button data-move>Move</button><button data-rotate>Rotate 15°</button><button data-remove>Remove</button>
    <button data-camera>Turn view</button></div><div class="room-canvas"></div>
    <output class="room-status" aria-live="polite">Loading furniture…</output>`;
  host.append(root);
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const canvasHost = get('.room-canvas');
  const status = get('output');
  const palette = get<HTMLSelectElement>('[data-palette]');
  const picker = get<HTMLSelectElement>('[data-select]');
  const tools = ['move', 'rotate', 'remove'].map(name => get<HTMLButtonElement>(`[data-${name}]`));
  const add = get<HTMLButtonElement>('[data-add]');
  add.disabled = true;
  catalog.forEach(entry => palette.add(new Option(entry.name, entry.id)));
  let layout = initialLayout();
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) layout = sanitizeHomeLayout(JSON.parse(saved), catalog, bounds).state;
  } catch { /* The current session also works without browser storage. */ }
  let active = '', mode: 'select' | 'add' | 'move' = 'select';
  let quarter: QuarterTurn = 0;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasHost.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdadbd4);
  const camera = new THREE.PerspectiveCamera(ISO_FOV.default, 1, .05, 150);
  const sun = new THREE.DirectionalLight(0xffefd7, 2.05);
  sun.position.set(3, 5, 2);
  scene.add(sun, new THREE.HemisphereLight(0xe8f4ff, 0xcebaa0, 2.1));
  const room = new THREE.Group();
  scene.add(room);
  function panel(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .87 }));
    mesh.position.set(x, y, z); room.add(mesh); return mesh;
  }
  panel(bounds.width, .08, bounds.depth, 0, -.04, 0, 0xd4ad7e);
  const walls = {
    back: panel(bounds.width, bounds.height, .06, 0, bounds.height / 2, -bounds.depth / 2 - .03, 0x9fbdba),
    front: panel(bounds.width, bounds.height, .06, 0, bounds.height / 2, bounds.depth / 2 + .03, 0x9fbdba),
    left: panel(.06, bounds.height, bounds.depth, -bounds.width / 2 - .03, bounds.height / 2, 0, 0xeae1cb),
    right: panel(.06, bounds.height, bounds.depth, bounds.width / 2 + .03, bounds.height / 2, 0, 0xeae1cb),
  };
  const models = new Map<string, THREE.Object3D>();
  const instances = new Map<string, THREE.Object3D>();
  const outline = createSelectionOutline();
  let live = true, ready = false;
  const draw = () => { if (live) renderer.render(scene, camera); };
  function resize() {
    if (!live) return;
    const w = Math.max(1, canvasHost.clientWidth), h = Math.max(1, canvasHost.clientHeight);
    renderer.setSize(w, h, false); outline.resize(w, h);
    camera.aspect = w / h;
    const pose = isometricPose(bounds, quarter, ISO_FOV.default, camera.aspect);
    camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateProjectionMatrix();
    const hidden = wallsFacingCamera(bounds, camera.position);
    for (const side of Object.keys(walls) as (keyof typeof walls)[]) walls[side].visible = !hidden.has(side);
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvasHost);
  function rebuild() {
    outline.clear();
    for (const object of instances.values()) scene.remove(object);
    instances.clear(); picker.replaceChildren(new Option('Choose an item', ''));
    for (const placement of layout.placements) {
      const template = models.get(placement.item);
      if (!template) continue;
      const instance = template.clone(true);
      instance.userData.instance = placement.id;
      instance.position.set(placement.x, placement.y, placement.z);
      instance.rotation.y = placement.yaw;
      instances.set(placement.id, instance); scene.add(instance);
      picker.add(new Option(definitions.get(placement.item)!.name + ' · ' + (picker.length), placement.id));
    }
    if (!instances.has(active)) active = '';
    picker.value = active;
    const selected = instances.get(active);
    outline.select(selected ? [selected] : [], 0xffb42d);
    tools.forEach(button => { button.disabled = !selected; });
    draw();
  }
  function save(message: string) {
    mode = 'select'; canvasHost.classList.remove('placing');
    try { localStorage.setItem(key, JSON.stringify(layout)); status.textContent = message; }
    catch { status.textContent = message + ' Browser storage is unavailable.'; }
    rebuild();
  }
  const placed = (): PlacedHomeItem[] => layout.placements.map(placement => ({ placement, definition: definitions.get(placement.item)! }));
  function supportedGroup(source: PlacedHomeItem) {
    return [source, ...placed().filter(entry => entry.placement.id !== source.placement.id && restsOn(entry.placement, source))];
  }
  function place(original: HomePlacement, x: number, z: number, yaw: number, isNew: boolean) {
    const definition = definitions.get(original.item)!;
    if (isNew && placementLimit(layout, definition, catalog)) { status.textContent = 'Furniture limit reached.'; return; }
    const group = isNew ? [] : supportedGroup({ definition, placement: original });
    const ids = new Set(group.map(entry => entry.placement.id));
    const others = placed().filter(entry => !ids.has(entry.placement.id));
    const candidate = snapToWall(definition, { ...original, x: snapValue(x), z: snapValue(z), yaw: snapYaw(yaw) }, bounds);
    candidate.y = definition.mount === 'small' ? supportAt(candidate.x, candidate.z, others).height : 0;
    const changes = [{ definition, placement: candidate }, ...group.slice(1).map(entry => ({
      definition: entry.definition, placement: carryPose(original, candidate, entry.placement),
    }))];
    const check = checkSupportedPlacement(definition, candidate, bounds, others);
    const accepted = check.ok ? checkPlacementGroup(changes, bounds, others) : check;
    if (!accepted.ok) { status.textContent = 'Cannot place here (' + accepted.problem + '). Choose another position.'; return; }
    const updates = new Map(changes.map(entry => [entry.placement.id, entry.placement]));
    layout.placements = isNew ? [...layout.placements, candidate] : layout.placements.map(entry => updates.get(entry.id) ?? entry);
    active = candidate.id; save(definition.name + ' placed.');
  }
  function select(id: string) {
    active = id; mode = 'select'; canvasHost.classList.remove('placing'); rebuild();
    status.textContent = active ? 'Use Move or Rotate to adjust this item.' : 'Select a furnishing or add an item.';
  }
  add.onclick = () => { mode = 'add'; canvasHost.classList.add('placing'); status.textContent = 'Click the floor where you want this item.'; };
  picker.onchange = () => select(picker.value);
  tools[0].onclick = () => { mode = 'move'; canvasHost.classList.add('placing'); status.textContent = 'Click the new floor position.'; };
  tools[1].onclick = () => {
    const source = layout.placements.find(entry => entry.id === active);
    if (source) place(source, source.x, source.z, source.yaw + Math.PI / 12, false);
  };
  tools[2].onclick = () => {
    const removed = placed().find(entry => entry.placement.id === active);
    if (!removed) return;
    if (supportedGroup(removed).length > 1) { status.textContent = 'Move the items resting on this piece first.'; return; }
    layout.placements = layout.placements.filter(entry => entry.id !== active); active = ''; save('Item removed.');
  };
  get('[data-camera]').onclick = () => { quarter = ((quarter + 1) % 4) as QuarterTurn; resize(); };
  const ray = new THREE.Raycaster();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  renderer.domElement.onclick = event => {
    if (!ready) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2), camera);
    if (mode === 'select') {
      let object = ray.intersectObjects([...instances.values()], true)[0]?.object as THREE.Object3D | undefined;
      while (object && !object.userData.instance) object = object.parent ?? undefined;
      select(object?.userData.instance ?? ''); return;
    }
    const point = ray.ray.intersectPlane(floor, new THREE.Vector3());
    if (!point) return;
    const entry = mode === 'move' ? layout.placements.find(p => p.id === active)
      : { item: palette.value, id: createPlacementId(), x: 0, y: 0, z: 0, yaw: 0 };
    if (entry) place(entry, point.x, point.z, entry.yaw, mode === 'add');
  };
  function release(obj: THREE.Object3D) {
    obj.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      for (const mat of Array.isArray(child.material) ? child.material : [child.material]) {
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
        mat.dispose();
      }
    });
  }
  const loader = new GLTFLoader();
  Promise.all(catalog.map(async entry => {
    const { scene: object } = await loader.loadAsync(import.meta.env.BASE_URL + 'room/' + entry.id + '.glb');
    if (!live) { release(object); return; }
    // Use the visible plant and pot. The scan also includes a detached sample of ground.
    if (entry.id === 'potted_plant_04') {
      const ground = object.getObjectByName('potted_plant_04_ground');
      if (ground) { ground.visible = false; ground.removeFromParent(); ground.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); }); }
    }
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    object.position.set(-center.x, -box.min.y, -center.z);
    const scaled = new THREE.Group(); scaled.add(object);
    scaled.scale.set(entry.size.width / size.x, entry.size.height / size.y, entry.size.depth / size.z);
    const model = new THREE.Group(); model.add(scaled); models.set(entry.id, model);
  })).then(() => {
    if (!live) return;
    ready = true; add.disabled = false; rebuild(); resize(); status.textContent = 'Select a furnishing or add an item.';
  }).catch(() => { if (live) status.textContent = 'Furniture failed to load. Reopen the editor to retry.'; });
  rebuild(); resize();
  return () => {
    live = false; observer.disconnect(); outline.dispose(); release(room); models.forEach(release);
    renderer.dispose(); root.remove();
  };
}
