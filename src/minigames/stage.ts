import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
type RenderQuality = { shadowMapSize: number };
import { frameWorkshopCamera } from './camera';
import { MINIGAME_PROFILES } from '../../shared/minigame-protocol.mjs';
import { displayPlayerName, placeWorkshopLabels } from './player-labels';


export interface StageEntity {
  id: string; position: [number, number, number]; size: [number, number, number];
  shape?: string; material?: string; texture?: string; color?: string; visible?: boolean; kind?: string;
}
export interface StageDefinition { width: number; depth: number; material?: string; entities: StageEntity[] }
export interface StagePlayer { id: string; slot: number; x: number; z: number; yaw: number; name?: string; connected?: boolean }
export interface StageFrame { players: StagePlayer[]; localPlayerId: string; interpolate?: boolean; entities?: Record<string, { position?: [number, number, number]; visible?: boolean; active?: boolean }> }
const MAX_PLAYERS = MINIGAME_PROFILES.party16.maxPlayers;
const PLAYER_COLORS = ['#345b50', '#a46932', '#566a98', '#9a5678', '#388b8a', '#c86645', '#8665a6', '#7d843c',
  '#3475b0', '#bb4c70', '#648e58', '#ab7939', '#77523b', '#657b88', '#a8543f', '#595399'];

/** A separate scene on the shell renderer. No city world, presence or save calls. */
export function createWorkshopStage(renderer: THREE.WebGLRenderer, host: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e7e3d8');
  const camera = new THREE.PerspectiveCamera(42, 1, .05, 200);
  const ownedTextures = new Set<THREE.Texture>();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  let world = new THREE.Group(); scene.add(world);
  let active = false, disposed = false;
  let width = 1, height = 1;
  let gameWidth = 18, gameDepth = 14;
  let cameraDefinition: StageDefinition = { width: gameWidth, depth: gameDepth, entities: [] };
  let objects = new Map<string, THREE.Object3D>();
  const target = new THREE.Vector3();
  const players = new Map<string, { object: THREE.Group; target: THREE.Vector3; yaw: number; label: HTMLDivElement; interpolate: boolean }>();
  const playerMaterials = PLAYER_COLORS.map(color => new THREE.MeshStandardMaterial({ color, roughness: .76 }));
  const headMaterial = new THREE.MeshStandardMaterial({ color: '#e8ba8e', roughness: .84 });
  const bodyGeometry = new THREE.CapsuleGeometry(.22, .37, 5, 10), headGeometry = new THREE.SphereGeometry(.19, 12, 8), noseGeometry = new THREE.BoxGeometry(.10, .08, .12);
  const projected = new THREE.Vector3();
  function clearPlayers() { for (const actor of players.values()) { actor.object.removeFromParent(); actor.label.remove(); } players.clear(); }
  function updatePlayers(frame: StageFrame) {
    const visiblePlayers = frame.players.slice(0, MAX_PLAYERS);
    const ids = new Set(visiblePlayers.map(player => player.id));
    for (const [id, actor] of players) if (!ids.has(id)) { actor.object.removeFromParent(); actor.label.remove(); players.delete(id); }
    for (const pose of visiblePlayers) {
      let actor = players.get(pose.id);
      if (!actor) {
        const object = new THREE.Group();
        const colorIndex = pose.slot % PLAYER_COLORS.length;
        const body = new THREE.Mesh(bodyGeometry, playerMaterials[colorIndex]); body.position.y = .405;
        const head = new THREE.Mesh(headGeometry, headMaterial); head.position.y = .9;
        const nose = new THREE.Mesh(noseGeometry, headMaterial); nose.position.set(0, .89, -.19);
        for (const mesh of [body, head, nose]) { mesh.castShadow = true; object.add(mesh); }
        object.position.set(pose.x, 0, pose.z); scene.add(object);
        const label = document.createElement('div'); label.className = 'mg-player-label'; label.style.setProperty('--player-color', PLAYER_COLORS[colorIndex]); host.append(label);
        actor = { object, target: object.position.clone(), yaw: pose.yaw, label, interpolate: !!frame.interpolate }; players.set(pose.id, actor);
      }
      actor.target.set(pose.x, 0, pose.z); actor.yaw = pose.yaw; actor.interpolate = !!frame.interpolate;
      if (!actor.interpolate || actor.object.position.distanceToSquared(actor.target) > 16) { actor.object.position.copy(actor.target); actor.object.rotation.y = pose.yaw; }
      actor.object.visible = true;
      actor.label.textContent = `${pose.slot + 1} · ${displayPlayerName(pose.name, pose.slot)}${pose.id === frame.localPlayerId ? ' · You' : ''}${pose.connected === false ? ' · Offline' : ''}`;
      actor.label.dataset.playerId = pose.id; actor.label.dataset.local = String(pose.id === frame.localPlayerId);
    }
  }
  scene.add(new THREE.HemisphereLight('#f2f5ff', '#797562', 2.3));
  const sun = new THREE.DirectionalLight('#fff4db', 3.3);
  sun.position.set(-10, 18, 12); sun.castShadow = true;
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = .1; sun.shadow.camera.far = 70; sun.shadow.normalBias = .035;
  sun.shadow.mapSize.set(1024, 1024); scene.add(sun, sun.target);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentScene = new RoomEnvironment();
  const environment = pmrem.fromScene(environmentScene, .06);
  scene.environment = environment.texture; scene.environmentIntensity = .45;
  environmentScene.dispose(); pmrem.dispose();
  const ready = (async () => {
    const loader = new THREE.TextureLoader();
    for (const [name, prefix] of [['concrete', 'concrete'], ['stone', 'stone'], ['wood', 'timber'], ['plaster', 'plaster']] as const) {
      const textures = await Promise.all(['color', 'normal', 'roughness'].map(async channel => {
        const texture = await loader.loadAsync(`/materials/outskirts/v1/${prefix}-${channel}.webp`);
        ownedTextures.add(texture);
        if (disposed) { texture.dispose(); throw new DOMException('Workshop closed', 'AbortError'); }
        texture.colorSpace = channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        return texture;
      }));
      materials.set(name, new THREE.MeshStandardMaterial({ map: textures[0], normalMap: textures[1], roughnessMap: textures[2], roughness: .9, normalScale: new THREE.Vector2(.6, .6) }));
    }
  })();

  function disposeGroup(group: THREE.Object3D) {
    group.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (object.userData.ownMaterial) (object.material as THREE.Material).dispose(); } });
    group.removeFromParent();
  }

  function frameCamera() {
    const frame = frameWorkshopCamera(cameraDefinition, width / height);
    camera.aspect = frame.aspect; camera.fov = frame.fov; camera.near = frame.near; camera.far = frame.far;
    target.set(...frame.target); camera.position.set(...frame.position);
    camera.lookAt(target); camera.updateProjectionMatrix();
  }

  function setDefinition(definition: StageDefinition, custom: Map<string, THREE.Texture> = new Map()) {
    if (disposed) return;
    const next = new THREE.Group();
    const nextObjects = new Map<string, THREE.Object3D>();
    try {
      gameWidth = definition.width; gameDepth = definition.depth;
      const groundMaterial = definition.material === 'timber' ? 'wood' : definition.material ?? 'concrete';
      const floor = new THREE.Mesh(new THREE.BoxGeometry(gameWidth + 1.2, .35, gameDepth + 1.2), materials.get(groundMaterial));
      const uv = floor.geometry.getAttribute('uv');
      for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * gameWidth / 2, uv.getY(index) * gameDepth / 2);
      floor.position.set(0, -.175, 0); floor.receiveShadow = true; next.add(floor);
      for (const entity of definition.entities) {
        const [sx, sy, sz] = entity.size;
        const geometry = entity.shape === 'sphere' ? new THREE.SphereGeometry(.5, 20, 12)
          : entity.shape === 'cylinder' ? new THREE.CylinderGeometry(.5, .5, 1, 20) : new THREE.BoxGeometry(1, 1, 1);
        const materialId = entity.material === 'timber' ? 'wood' : entity.material;
        const base = materials.get(materialId ?? 'wood') ?? materials.get('wood')!;
        const material = base.clone();
        if (entity.color && /^#[\da-f]{6}$/i.test(entity.color)) material.color.set(entity.color);
        if (entity.texture && custom.has(entity.texture)) material.map = custom.get(entity.texture)!;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.ownMaterial = true;
        mesh.name = entity.id; mesh.scale.set(sx, sy, sz); mesh.position.set(...entity.position);
        mesh.visible = entity.visible !== false; mesh.castShadow = true; mesh.receiveShadow = true;
        next.add(mesh); nextObjects.set(entity.id, mesh);
      }
    } catch (error) { disposeGroup(next); throw error; }
    disposeGroup(world); world = next; objects = nextObjects; cameraDefinition = definition; scene.add(next); frameCamera();
  }

  return {
    ready,
    setDefinition,
    update(frame: StageFrame) {
      updatePlayers(frame);
      for (const [id, state] of Object.entries(frame.entities ?? {})) {
        const object = objects.get(id); if (!object) continue;
        if (state.position) object.position.set(...state.position);
        if (state.visible !== undefined) object.visible = state.visible;
        else if (state.active !== undefined) object.visible = state.active;
      }
    },
    render(delta = 1 / 60) {
      if (!active || disposed || !width || !height) return;
      const rect = host.getBoundingClientRect();
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const x = rect.left - canvasRect.left, y = canvasRect.height - (rect.bottom - canvasRect.top);
      const alpha = 1 - Math.exp(-18 * Math.min(.1, Math.max(0, delta)));
      for (const actor of players.values()) {
        if (actor.interpolate) { actor.object.position.lerp(actor.target, alpha); actor.object.rotation.y += Math.atan2(Math.sin(actor.yaw - actor.object.rotation.y), Math.cos(actor.yaw - actor.object.rotation.y)) * alpha; }
      }
      renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.setClearColor('#e7e3d8'); renderer.clear(); renderer.setScissorTest(true);
      renderer.setViewport(x, y, rect.width, rect.height); renderer.setScissor(x, y, rect.width, rect.height);
      renderer.render(scene, camera); renderer.setScissorTest(false);
      const labels = [];
      for (const [id, actor] of players) {
        projected.copy(actor.object.position); projected.y += 1.35; projected.project(camera);
        actor.label.hidden = Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z < -1 || projected.z > 1;
        if (!actor.label.hidden) labels.push({ id, x: (projected.x + 1) * .5 * rect.width, y: (1 - projected.y) * .5 * rect.height,
          width: actor.label.offsetWidth, height: actor.label.offsetHeight });
      }
      for (const label of placeWorkshopLabels(labels, rect.width, rect.height)) players.get(label.id)!.label.style.transform = `translate(${label.x}px,${label.y}px)`;
      renderer.setViewport(0, 0, canvasRect.width, canvasRect.height);
    },
    resize(nextWidth: number, nextHeight: number) { width = Math.max(1, nextWidth); height = Math.max(1, nextHeight); frameCamera(); },
    activate() {
      active = true;
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true; renderer.shadowMap.autoUpdate = true; renderer.autoClear = true;
      renderer.setRenderTarget(null); renderer.setScissorTest(false);
    },
    deactivate() { active = false; renderer.setScissorTest(false); },
    setQuality(quality: RenderQuality) {
      if (sun.shadow.mapSize.x !== quality.shadowMapSize) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.setScalar(quality.shadowMapSize); }
    },
    dispose() {
      if (disposed) return; disposed = true; active = false;
      disposeGroup(world); clearPlayers(); playerMaterials.forEach(material => material.dispose()); headMaterial.dispose(); bodyGeometry.dispose(); headGeometry.dispose(); noseGeometry.dispose();
      materials.forEach(material => material.dispose()); ownedTextures.forEach(texture => texture.dispose());
      sun.shadow.map?.dispose(); environment.dispose(); scene.clear();
    },
  };
}
