import * as THREE from 'three';

/**
 * three.js measures a skinned mesh's bounding sphere on the first frame that draws it, by
 * posing every vertex on the CPU. For a resident's eight meshes that is tens of milliseconds
 * in the frame where the person steps into view: a visible hitch for every new face.
 *
 * Clones of one character share their geometry, so the sphere is measured once per geometry
 * and handed to every later clone. Call after the clone has its skeleton, before it is drawn.
 */
const measured = new WeakMap<THREE.BufferGeometry, THREE.Sphere>();

export function shareSkinnedBounds(root: THREE.Object3D): void {
  let posed = false;
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh) || object.boundingSphere) return;
    let sphere = measured.get(object.geometry);
    if (!sphere) {
      // The measurement reads bone world matrices; make sure this clone has them.
      if (!posed) { root.updateMatrixWorld(true); posed = true; }
      object.computeBoundingSphere();
      sphere = (object.boundingSphere as THREE.Sphere | null)?.clone() ?? new THREE.Sphere();
      // The renderer never re-measures as limbs move. A margin covers a stride or a raised arm.
      sphere.radius *= 1.25;
      measured.set(object.geometry, sphere);
    }
    object.boundingSphere = sphere.clone();
  });
}
