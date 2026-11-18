import * as THREE from 'three';
import type { RenderQuality } from '../game/quality.ts';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { sampleDaylight, type DaylightSample } from './time.ts';

interface PracticalSource { position: THREE.Vector3; power: number; distance: number; indoor: boolean; nightOnly?: boolean; color?: THREE.Color }
interface EmissiveSurface { material: THREE.MeshStandardMaterial; color: THREE.Color; strength: number; kind: 'window' | 'lamp' | 'sign' | 'paint' | 'lightbox' | 'external-lamp' | 'original' }

// These prefixes describe the luminous surface, not its housing or mounting.
const paintedSign = /^Signage \| paint\b/i;
const lightboxFace = /^Signage \| lightbox face\b/i;
const externalSignLamp = /^Signage \| external lamp\b/i;
const signWarmWhite = new THREE.Color('#fff0d7');
const practicalWarmWhite = new THREE.Color('#ffd49a');

function isSignLampEmitter(material: THREE.Material): boolean {
  return externalSignLamp.test(material.name) && !/\bhousing\b/i.test(material.name);
}

/** Whether the day and night rig drives this material's glow or colour by its name. */
export function hasDayNightRole(material: THREE.Material): boolean {
  const name = material.name;
  return paintedSign.test(name) || lightboxFace.test(name) || isSignLampEmitter(material) || /Window glass variant [124]/.test(name)
    || /phosphor|diffuser|Warm interior light/i.test(name) || /Lettering warm ivory|dark screen/.test(name);
}

/** Retain authored relative brightness while bounding near-camera bloom. */
function signRadiance(strength: number, lightbox: boolean): number {
  const authored = Number.isFinite(strength) ? Math.max(0, strength) : 1;
  return Math.min(lightbox ? .9 : 2.1, authored * .45);
}

/** Recover individual fixtures from the static model's material batches. */
function fixtureCenters(mesh: THREE.Mesh): THREE.Vector3[] {
  const geometry: THREE.BufferGeometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const unique = new Map<string, number>();
  const points: THREE.Vector3[] = [];
  const lookup: number[] = [];
  const parent: number[] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    const key = `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)},${Math.round(point.z * 1000)}`;
    let index = unique.get(key);
    if (index === undefined) {
      index = points.length; unique.set(key, index); points.push(point.clone()); parent.push(index);
    }
    lookup.push(index);
  }
  const find = (start: number) => {
    let index = start;
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  const count = geometry.index?.count ?? positions.count;
  for (let i = 0; i < count; i += 3) {
    const a = lookup[geometry.index ? geometry.index.getX(i) : i];
    const b = lookup[geometry.index ? geometry.index.getX(i + 1) : i + 1];
    const c = lookup[geometry.index ? geometry.index.getX(i + 2) : i + 2];
    parent[find(b)] = find(a); parent[find(c)] = find(a);
  }
  const bounds = new Map<number, THREE.Box3>();
  points.forEach((value, index) => {
    const root = find(index);
    if (!bounds.has(root)) bounds.set(root, new THREE.Box3());
    bounds.get(root)!.expandByPoint(value);
  });
  return [...bounds.values()].map((box) => box.getCenter(new THREE.Vector3()));
}

const skyShader = {
  uniforms: {
    topColor: { value: new THREE.Color('#5279a0') },
    horizonColor: { value: new THREE.Color('#e6c7a0') },
    sunColor: { value: new THREE.Color('#ffc17f') },
    sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    daylight: { value: 1 }, night: { value: 0 }, warmth: { value: 0 }, elapsed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDirection;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vDirection = world.xyz - cameraPosition;
      gl_Position = projectionMatrix * viewMatrix * world;
      gl_Position.z = gl_Position.w;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 topColor, horizonColor, sunColor, sunDirection;
    uniform float daylight, night, warmth, elapsed;
    varying vec3 vDirection;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    void main() {
      vec3 direction = normalize(vDirection);
      float height = max(direction.y, 0.0);
      vec3 color = mix(horizonColor, topColor, pow(height, 0.48));
      float alignment = max(dot(direction, sunDirection), 0.0);
      float glow = pow(alignment, 20.0) * (0.16 + warmth * 0.32) * daylight;
      float disc = smoothstep(0.99986, 0.99996, alignment) * daylight;
      color += sunColor * (glow + disc * 5.0);
      float moon = smoothstep(0.99978, 0.99993, dot(direction, -sunDirection));
      color += vec3(0.68,0.79,1.0) * moon * night * 1.4;
      // A small number of static stars, naturally disappearing into city haze.
      vec2 starUV = vec2(atan(direction.x, direction.z), asin(clamp(direction.y,-1.0,1.0))) * 150.0;
      float seed = hash(floor(starUV));
      float star = pow(max(0.0, 1.0 - length(fract(starUV)-0.5)*2.8), 5.0);
      color += vec3(0.43,0.56,0.8) * star * step(0.991,seed) * night * smoothstep(0.05,0.38,height);
      vec2 cloudUV = direction.xz / max(direction.y + 0.25,0.2) * 1.25 + vec2(elapsed * 0.002,0.0);
      float clouds = noise(cloudUV)*0.68 + noise(cloudUV*2.3)*0.32;
      clouds = smoothstep(0.51,0.76,clouds) * smoothstep(0.0,0.2,height) * 0.14;
      color = mix(color, mix(horizonColor*1.08,vec3(0.065,0.085,0.14),night),clouds);
      gl_FragColor = vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export interface LightingRig {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer;
  /** The shadow-casting key light. */
  sun: THREE.DirectionalLight;
  /** Unshadowed night fill of the stock rig. */
  moon: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  sky: THREE.Mesh;
}
/** A view's own colour script, applied on top of the stock day/night rig. */
export interface LightingLook {
  /** Turn `direction` (toward the sun) into the direction of the shadow-casting key, e.g. a moon after sunset. */
  keyDirection?(sample: DaylightSample, direction: THREE.Vector3): void;
  /** Set colours and intensities for this frame. Returns how far lamps and signs are switched on (0–1). */
  apply(sample: DaylightSample, rig: LightingRig, elapsed: number): number;
}
export interface DayNightLightingOptions {
  indoor?: boolean; inferFixtures?: boolean;
  /** Real point lights shared by nearby practical sources. Part of every lit shader, so fixed per view. */
  lampPool?: number;
  /** Night-time multiplier on authored always-on emitters such as lamp heads. */
  emissiveGain?: number;
  look?: LightingLook;
}
export function createDayNightLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.Camera, options: DayNightLightingOptions = {}) {
  if (options.indoor !== false) RectAreaLightUniformsLib.init();
  const sun = new THREE.DirectionalLight('#ffe1ad', 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 0.5, far: 150 });
  sun.shadow.camera.updateProjectionMatrix();
  // Cover the 3.3 cm shadow texel footprint on broad plazas without losing
  // architectural contact; GTAO supplies the smaller curb and furniture detail.
  sun.shadow.normalBias = 0.045;
  sun.shadow.bias = -0.00015;
  const moon = new THREE.DirectionalLight('#779dce', 0);
  const hemisphere = new THREE.HemisphereLight('#9dc1dc', '#655b4b', 1);
  const roomFill = options.indoor === false ? undefined : new THREE.RectAreaLight('#ffd6a0', 1.6, 2.2, 1.6);
  if (roomFill) roomFill.rotation.x = -Math.PI / 2;
  const skyMaterial = new THREE.ShaderMaterial({
    ...skyShader, uniforms: THREE.UniformsUtils.clone(skyShader.uniforms), side: THREE.BackSide, depthWrite: false, depthFunc: THREE.LessEqualDepth, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMaterial);
  sky.scale.setScalar(350); sky.frustumCulled = false; sky.renderOrder = 1000;
  scene.add(sun, sun.target, moon, moon.target, hemisphere, sky);
  if (roomFill) scene.add(roomFill);
  const lampCount = Math.max(1, Math.round(options.lampPool ?? 6)), emissiveGain = options.emissiveGain ?? 1;
  const lampPool = Array.from({ length: lampCount }, () => {
    const light = new THREE.PointLight('#ffd49a', 0, 18, 2);
    scene.add(light); return light;
  });
  let shadowHz = 60, lightBudget = lampCount, lastShadow = -Infinity;
  const rig: LightingRig = { scene, renderer, sun, moon, hemisphere, sky };
  const sunDirection = new THREE.Vector3();
  sun.shadow.autoUpdate = false;
  let sources: PracticalSource[] = [];
  let assigned: PracticalSource[] = [];
  let surfaces: EmissiveSurface[] = [];
  let lastLightAssignment = -Infinity;
  let landscape = false;
  const direction = new THREE.Vector3();
  const shadowAnchor = new THREE.Vector3(), lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3();
  const lightBasis = new THREE.Matrix4(), lightOrigin = new THREE.Vector3();
  const vertical = new THREE.Vector3(0, 1, 0);
  const skyDay = new THREE.Color('#587fa7'), skyNight = new THREE.Color('#060e26');
  const hazeDay = new THREE.Color('#b1c3ca'), hazeGold = new THREE.Color('#dc8c64'), hazeNight = new THREE.Color('#172a43');
  const skyWarm = new THREE.Color('#a58592'), directDay = new THREE.Color('#fff2da'), directWarm = new THREE.Color('#ffa85c');
  const hemiDay = new THREE.Color('#adc8df'), hemiNight = new THREE.Color('#526a98');
  const hemiWarm = new THREE.Color('#d5ad9a');
  const groundDay = new THREE.Color('#71634e'), groundNight = new THREE.Color('#26354b');
  const color = new THREE.Color(), windowEmission = new THREE.Color('#ffb768'), signEmission = new THREE.Color('#d3b185');

  const registeredRoots = new Map<THREE.Object3D, Set<THREE.MeshStandardMaterial>>();
  const materialReferences = new Map<THREE.MeshStandardMaterial, number>();
  const surfaceCache = new WeakMap<THREE.MeshStandardMaterial, EmissiveSurface>();
  function registerSceneRoot(model: THREE.Object3D) {
    if (registeredRoots.has(model)) return;
    const rootMaterials = new Set<THREE.MeshStandardMaterial>();
    registeredRoots.set(model, rootMaterials);
    model.updateWorldMatrix(true, true);
    const seen = new Set<THREE.Material>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) continue;
        seen.add(material);
        rootMaterials.add(material);
        const references = materialReferences.get(material) ?? 0;
        materialReferences.set(material, references + 1);
        if (references) continue;
        const cached = surfaceCache.get(material);
        if (cached) { surfaces.push(cached); continue; }
        const name = material.name;
        // Keep original values on the material so revisiting a cached scene restores its baseline.
        material.userData.dayNightBaseline ??= { color: material.emissive.getHex(), strength: material.emissiveIntensity };
        const baseline = material.userData.dayNightBaseline;
        const record: EmissiveSurface = { material, color: new THREE.Color(baseline.color), strength: baseline.strength, kind: 'original' };
        if (paintedSign.test(name)) record.kind = 'paint';
        else if (lightboxFace.test(name)) record.kind = 'lightbox';
        else if (isSignLampEmitter(material)) {
          record.kind = 'external-lamp';
          material.color.setRGB(0, 0, 0);
          material.roughness = 1; material.metalness = 0; material.envMapIntensity = 0;
        }
        else if (/Window glass variant [124]/.test(name)) record.kind = 'window';
        else if (/phosphor|diffuser|Warm interior light/i.test(name)) {
          record.kind = 'lamp';
          // The light source emits its own bounded radiance; it must not also
          // reflect a near-coincident point light back into the bloom signal.
          material.color.setRGB(0, 0, 0);
          material.roughness = 1; material.metalness = 0; material.envMapIntensity = 0;
        }
        else if (/Lettering warm ivory|dark screen/.test(name)) record.kind = 'sign';
        surfaceCache.set(material, record); surfaces.push(record);
      }
      // GLTFLoader sanitizes node names (spaces become underscores), whereas
      // material names preserve the author's fixture identifiers.
      if (options.inferFixtures === false) return;
      const signEmitter = materials.find((material) => material instanceof THREE.MeshStandardMaterial
        && (isSignLampEmitter(material) || lightboxFace.test(material.name))) as THREE.MeshStandardMaterial | undefined;
      if (signEmitter) {
        const lightbox = lightboxFace.test(signEmitter.name);
        const baseline = signEmitter.userData.dayNightBaseline;
        const sourceColor = new THREE.Color(baseline?.color ?? 0);
        if (sourceColor.r + sourceColor.g + sourceColor.b === 0) sourceColor.copy(signWarmWhite);
        const radiance = signRadiance(baseline?.strength ?? 1, lightbox);
        for (const position of fixtureCenters(object)) {
          if (radiance > 0) sources.push({ position: position.add(new THREE.Vector3(0, -.1, 0)),
            // These fixtures sit centimetres from their sign. Their local spill
            // must be much weaker than the existing street/interior fixtures.
            power: (lightbox ? .65 : 1) * radiance / (lightbox ? .765 : 1.8),
            distance: lightbox ? 3 : 4, indoor: true, nightOnly: true, color: sourceColor });
        }
      } else if (materials.some((material) => /Lamp phosphor|LED diffuser|stair lamp diffuser/.test(material.name))) {
        for (const position of fixtureCenters(object)) {
          const street = position.y > 7;
          sources.push({ position: position.add(new THREE.Vector3(0, street ? -0.55 : -0.32, 0)), power: street ? 180 : 24, distance: street ? 30 : 8, indoor: !street });
        }
      }
    });
  }
  function unregisterSceneRoot(model: THREE.Object3D) {
    const materials = registeredRoots.get(model); if (!materials) return;
    registeredRoots.delete(model);
    for (const material of materials) {
      const count = (materialReferences.get(material) ?? 1) - 1;
      if (count) materialReferences.set(material, count); else materialReferences.delete(material);
    }
    surfaces = surfaces.filter(surface => materialReferences.has(surface.material));
  }
  function setScene(model: THREE.Object3D, sceneId: string) {
    sources = []; surfaces = []; assigned = []; lastLightAssignment = -Infinity;
    registeredRoots.clear(); materialReferences.clear();
    landscape = model.userData.geographicStatus === 'source-aligned';
    registerSceneRoot(model);
    if (roomFill && sceneId === 'city') {
      roomFill.position.set(15.4, 6.55, 19.3);
    } else if (roomFill) {
      roomFill.position.set(0, 2.5, 0);
      sources.push({ position: new THREE.Vector3(-1.4, 1.65, -1.6), power: 1.2, distance: 4, indoor: true });
    }
  }

  return {
    sky,
    setScene,
    registerSceneRoot, unregisterSceneRoot,
    setQuality(quality: RenderQuality) {
      shadowHz = quality.shadowHz;
      if (sun.shadow.mapSize.x !== quality.shadowMapSize) {
        sun.shadow.map?.dispose(); sun.shadow.map = null;
        sun.shadow.mapSize.setScalar(quality.shadowMapSize);
      }
      // Keep six visible slots at every quality level; zero intensity disables
      // unused sources without invalidating every lit material's program key.
      lastShadow = -Infinity; sun.shadow.needsUpdate = true;
    },
    update(hour: number, elapsed: number, anchor: THREE.Vector3, overview = false, motion: { movingCasters?: boolean; movingHz?: number } = {}) {
      const sample = sampleDaylight(hour);
      const { daylight, warmth, night, twilight } = sample;
      // Angle the fictional sun path down the street for a readable golden hour.
      direction.fromArray(sample.sunDirection).applyAxisAngle(vertical, -Math.PI / 3);
      sunDirection.copy(direction);
      options.look?.keyDirection?.(sample, direction);
      // Follow the player on the light's pixel grid. World-XZ rounding is not
      // sufficient for an angled sun: both shadow-camera axes must be stable.
      lightBasis.lookAt(direction, lightOrigin, sun.shadow.camera.up);
      lightRight.setFromMatrixColumn(lightBasis, 0); lightUp.setFromMatrixColumn(lightBasis, 1);
      const texelX = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
      const texelY = (sun.shadow.camera.top - sun.shadow.camera.bottom) / sun.shadow.mapSize.y;
      const x = anchor.dot(lightRight), y = anchor.dot(lightUp);
      shadowAnchor.copy(anchor).addScaledVector(lightRight, Math.round(x / texelX) * texelX - x)
        .addScaledVector(lightUp, Math.round(y / texelY) * texelY - y);
      sun.target.position.copy(shadowAnchor);
      sun.position.copy(shadowAnchor).addScaledVector(direction, 75);
      sun.color.copy(directDay).lerp(directWarm, warmth);
      sun.intensity = Math.max(0, sample.sunHeight) ** 0.4 * daylight * (landscape ? 3.8 : 4.2);
      moon.target.position.copy(anchor); moon.position.copy(anchor).addScaledVector(direction, -75);
      moon.intensity = night * 0.65;
      hemisphere.color.copy(hemiDay).lerp(hemiWarm, warmth * 0.3).lerp(hemiNight, night);
      hemisphere.groundColor.copy(groundDay).lerp(groundNight, night);
      // The hemisphere and room environment both provide diffuse fill. A
      // smaller combined contribution preserves the shape of sunlit facades
      // and material roughness while leaving shaded rooms readable.
      hemisphere.intensity = landscape ? .58 + daylight * .82 : 0.35 + daylight * 0.56;
      scene.environmentIntensity = landscape ? .12 + daylight * .48 : 0.12 + daylight * 0.37;
      renderer.toneMappingExposure = 1.02 + night * 0.16;
      color.copy(hazeDay).lerp(hazeGold, warmth * 0.78 + twilight * 0.12).lerp(hazeNight, night);
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.copy(color);
        scene.fog.near = overview ? 350 : 70 + daylight * 20;
        scene.fog.far = overview ? 900 : 210 + daylight * 65;
      }
      skyMaterial.uniforms.horizonColor.value.copy(color);
      skyMaterial.uniforms.topColor.value.copy(skyDay).lerp(skyWarm, warmth * 0.65).lerp(skyNight, night);
      skyMaterial.uniforms.sunColor.value.copy(directDay).lerp(directWarm, warmth);
      skyMaterial.uniforms.sunDirection.value.copy(sunDirection);
      skyMaterial.uniforms.daylight.value = daylight;
      skyMaterial.uniforms.night.value = night;
      skyMaterial.uniforms.warmth.value = warmth;
      skyMaterial.uniforms.elapsed.value = elapsed;
      sky.position.copy(camera.position);
      const authored = options.look?.apply(sample, rig, elapsed);
      const lampsOn = authored === undefined ? THREE.MathUtils.smoothstep(night, 0.08, 0.85) : THREE.MathUtils.clamp(authored, 0, 1);
      // A light that contributes nothing needs no shadow map: three.js would
      // otherwise redraw every caster for a sun that has set. A moving caster
      // (a car, the player) raises the refresh rate; `movingHz` bounds it, and
      // without one the map follows every frame as before.
      const interval = motion.movingCasters ? Math.min(1 / shadowHz, 1 / (motion.movingHz ?? Infinity)) : 1 / shadowHz;
      // The small allowance keeps a 30 Hz target on every second 60 Hz frame despite rounding in accumulated time.
      if (sun.intensity > .001 && (elapsed < lastShadow || elapsed - lastShadow >= interval - 1e-4)) {
        sun.shadow.needsUpdate = true; lastShadow = elapsed;
      }
      if (roomFill) roomFill.intensity = 0.45 + lampsOn * 1.45;
      for (const surface of surfaces) {
        const { material, kind } = surface;
        if (kind === 'paint') { material.emissive.setRGB(0, 0, 0); material.emissiveIntensity = 0; }
        else if (kind === 'lightbox' || kind === 'external-lamp') {
          material.emissive.copy(surface.color.r + surface.color.g + surface.color.b > 0 ? surface.color : signWarmWhite);
          material.emissiveIntensity = lampsOn * signRadiance(surface.strength, kind === 'lightbox');
        }
        else if (kind === 'window') { material.emissive.copy(windowEmission); material.emissiveIntensity = lampsOn * 0.85; }
        else if (kind === 'lamp') {
          material.emissive.copy(surface.color.r + surface.color.g + surface.color.b > 0 ? surface.color : directWarm);
          material.emissiveIntensity = 0.3 + lampsOn * 3.2;
        } else if (kind === 'sign') { material.emissive.copy(signEmission); material.emissiveIntensity = lampsOn * 0.15; }
        else { material.emissive.copy(surface.color); material.emissiveIntensity = surface.strength * (1 + lampsOn * (emissiveGain - 1)); }
      }
      if (elapsed - lastLightAssignment > 0.35 || !assigned.length) {
        const sorted = [...sources].sort((a,b) => a.position.distanceToSquared(anchor) - b.position.distanceToSquared(anchor));
        // Reserve road coverage; shop fixtures must not consume the whole pool.
        const indoors = anchor.y > 2 || Math.abs(anchor.x) > 9;
        const streetCount = Math.min(lightBudget, indoors ? 2 : Math.ceil(lightBudget / 2));
        assigned = sorted.filter((source) => !source.indoor).slice(0, streetCount);
        assigned.push(...sorted.filter((source) => source.indoor).slice(0, lightBudget - assigned.length));
        lastLightAssignment = elapsed;
      }
      lampPool.forEach((light, i) => {
        const source = assigned[i];
        if (!source) { light.intensity = 0; return; }
        light.position.copy(source.position); light.distance = source.distance;
        light.color.copy(source.color ?? practicalWarmWhite);
        light.intensity = source.power * (source.indoor && !source.nightOnly ? 0.24 + lampsOn * 0.76 : lampsOn);
      });
      return sample;
    },
    dispose() {
      scene.remove(sun, sun.target, moon, moon.target, hemisphere, sky, ...lampPool);
      if (roomFill) scene.remove(roomFill);
      sun.dispose(); moon.dispose(); sky.geometry.dispose(); skyMaterial.dispose();
      lampPool.forEach((light) => light.dispose());
    },
  };
}
