import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PlayerAvatar } from '../exploration/player.ts';
import { createCharacterAnimation, loadCharacterMotionLibrary, type CharacterModelKey } from './animation.ts';

export interface Clothing { hair?: 'short' | 'bob' | 'ponytail'; outfit?: 'casual' | 'smart' }
export interface WalkingAvatar extends PlayerAvatar { dress(options: Clothing): void }

export async function loadWalkingAvatar(body: CharacterModelKey = 'male', options: Clothing = {}): Promise<WalkingAvatar> {
  const [model, clips] = await Promise.all([
    new GLTFLoader().loadAsync(`/characters/${body}.glb`),
    loadCharacterMotionLibrary(body),
  ]);
  const object = new THREE.Group();
  object.add(model.scene);
  const motion = createCharacterAnimation(model.scene, clips);
  const clothing = { hair: options.hair ?? 'short', outfit: options.outfit ?? 'casual' };
  function dress(changes: Clothing) {
    Object.assign(clothing, changes);
    model.scene.traverse(node => {
      const { avatarSlot: slot, avatarVariant: variant } = node.userData;
      if (slot === 'outfit' || slot === 'hair') node.visible = variant === clothing[slot as keyof Clothing];
      if (node instanceof THREE.Mesh) node.castShadow = true;
    });
  }
  dress({});
  return {
    object, dress,
    updateMotion(dt, state) { motion.update(dt, state); },
    dispose() {
      motion.stop();
      const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>(), skeletons = new Set<THREE.Skeleton>();
      model.scene.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        geometries.add(node.geometry);
        if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      const bitmaps = new Set<ImageBitmap>();
      for (const texture of textures) {
        if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
        texture.dispose();
      }
      for (const bitmap of bitmaps) bitmap.close();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const skeleton of skeletons) skeleton.dispose();
      object.remove(model.scene);
    },
  };
}
