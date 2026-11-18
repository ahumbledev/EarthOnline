import * as THREE from 'three';

/** Maps are redistributable CC0 scans. color.webp is a neutral dye substrate;
 * see TEXTURES.md for sources and adaptations. */
export const FABRIC_TEXTURES = Object.freeze({
  denim: 'denim',
  jersey: 'jersey',
  linen: 'linen',
  satin: 'satin',
});
export type FabricTextureId = keyof typeof FABRIC_TEXTURES;
type FabricMaps = { color: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };
const maps = new Map<FabricTextureId, FabricMaps>();
const subscribers = new Map<THREE.MeshPhysicalMaterial, { fabric: FabricTextureId; repeat: number }>();
let pending: Promise<void> | undefined;
let loadGeneration = 0;

function resolveFabric(value: string): FabricTextureId {
  if (value === 'cotton' || value === 'cotton_jersey') return 'jersey';
  return value in FABRIC_TEXTURES ? value as FabricTextureId : 'denim';
}

function applyMaps(material: THREE.MeshPhysicalMaterial, fabric: FabricTextureId, repeat: number) {
  const loaded = maps.get(fabric);
  if (!loaded) return;
  // Texture transforms belong to each material to allow close-up and garment UV scales.
  for (const [field, texture] of Object.entries(loaded)) {
    const clone = texture.clone();
    clone.repeat.set(repeat, repeat);
    clone.needsUpdate = true;
    const slot = field === 'color' ? 'map' : field === 'normal' ? 'normalMap' : 'roughnessMap';
    const old = material[slot];
    if (old?.userData.tailoringOwned) old.dispose();
    clone.userData.tailoringOwned = true;
    material[slot] = clone;
  }
  material.needsUpdate = true;
}

/** Loads only twelve 1K maps, shared between materials; errors reject so UI can report them. */
export function loadFabricMaterials(renderer?: THREE.WebGLRenderer): Promise<void> {
  if (pending) return pending;
  const generation = ++loadGeneration;
  const loader = new THREE.TextureLoader();
  const anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  pending = Promise.all(Object.entries(FABRIC_TEXTURES).map(async ([key, path]) => {
    const fabric = key as FabricTextureId;
    const result = await Promise.all(['color', 'normal', 'roughness'].map(async (channel) => {
      const texture = await loader.loadAsync(textileUrl(path,channel));
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
      texture.colorSpace = channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return texture;
    }));
    if (generation !== loadGeneration) { result.forEach(texture => texture.dispose()); return; }
    maps.set(fabric, { color: result[0], normal: result[1], roughness: result[2] });
    for (const [material, spec] of subscribers) {
      if (spec.fabric === fabric) applyMaps(material, fabric, spec.repeat);
    }
  })).then(() => undefined).catch((error) => { pending = undefined; throw error; });
  return pending;
}

export function createFabricMaterial(
  fabricValue: string,
  color: string,
  options: { repeat?: number; side?: THREE.Side } = {},
): THREE.MeshPhysicalMaterial {
  const fabric = resolveFabric(fabricValue);
  const repeat = options.repeat ?? (fabric === 'denim' ? 5 : 3);
  const satin = fabric === 'satin';
  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: satin ? 0.43 : 0.93,
    sheen: satin ? 0.85 : fabric === 'denim' ? 0.3 : 0.58,
    sheenColor: new THREE.Color(satin ? '#f2dfcf' : '#bcb8ad'),
    sheenRoughness: satin ? 0.32 : 0.85,
    clearcoat: satin ? 0.08 : 0,
    clearcoatRoughness: 0.46,
    anisotropy: satin ? 0.4 : 0,
    anisotropyRotation: Math.PI / 2,
    normalScale: new THREE.Vector2(satin ? 0.19 : fabric === 'denim' ? 0.7 : 0.48, satin ? 0.19 : fabric === 'denim' ? 0.7 : 0.48),
    side: options.side ?? THREE.DoubleSide,
  });
  material.name = `tailoring-fabric-${fabric}`;
  subscribers.set(material, { fabric, repeat });
  applyMaps(material, fabric, repeat);
  material.addEventListener('dispose', () => {
    subscribers.delete(material);
    for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
      if (texture?.userData.tailoringOwned) texture.dispose();
    }
  });
  return material;
}

/** Dispose only when the whole atelier closes; replacing a garment disposes its material. */
export function disposeFabricMaterials(): void {
  loadGeneration++;
  for (const material of [...subscribers.keys()]) material.dispose();
  for (const fabric of maps.values()) Object.values(fabric).forEach(texture => texture.dispose());
  maps.clear();
  pending = undefined;
}

const files=import.meta.glob('./textures/*/*.webp',{eager:true,import:'default',query:'?url'}) as Record<string,string>;
export function textileUrl(surface:string,channel:string){return files['./textures/'+surface+'/'+channel+'.webp'];}
