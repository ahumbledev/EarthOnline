import * as THREE from 'three';

/** SkeletonUtils clones a palette for every primitive, even when all of them
 * use the same bones. Call only on an owned avatar clone, before adding clothes:
 * templates and other avatars must keep their own animation and resource life. */
export function shareAvatarSkeletons(root: THREE.Object3D): void {
  const palettes: THREE.Skeleton[] = [], redundant = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const skeleton = object.skeleton;
    if (palettes.includes(skeleton) || !skeleton.bones.length
      || skeleton.constructor !== THREE.Skeleton || skeleton.update !== THREE.Skeleton.prototype.update
      || skeleton.boneInverses.length !== skeleton.bones.length) return;
    const shared = palettes.find(candidate => candidate.bones.length === skeleton.bones.length
      && candidate.bones.every((bone, index) => bone === skeleton.bones[index]
        && candidate.boneInverses[index].equals(skeleton.boneInverses[index])));
    if (shared) {
      // Bind transforms belong to each mesh and remain unchanged. Identical
      // ordered bones/inverses produce the same palette for every animated pose.
      object.skeleton = shared; redundant.add(skeleton);
    } else palettes.push(skeleton);
  });
  // Each rejected palette is owned by this clone. The retained palette is
  // released once by the avatar's existing Set-based skeleton disposal.
  for (const skeleton of redundant) skeleton.dispose();
}
