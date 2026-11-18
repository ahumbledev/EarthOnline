import * as THREE from 'three';
import type { GeographicRegion } from '../world/region.ts';
import { pointInPolygon } from '../world/geography.ts';

export type GroundSurface = 'concrete' | 'dirt' | 'grass' | 'gravel' | 'wood';

/** Authored metadata takes priority; material names cover the existing GLB library. */
export function classifyGroundSurface(name: string): GroundSurface | undefined {
  if (/paint|foliage|leaves|leaf|glaz|glass|canop|crown|bark|trunk/i.test(name)) return undefined;
  if (/gravel|pebble|碎石|砂砾/i.test(name)) return 'gravel';
  if (/wood|timber|plywood|oak|walnut|木板|木地/i.test(name)) return 'wood';
  if (/dirt|soil|earth|mud|geographic paths|土路|泥土/i.test(name)) return 'dirt';
  if (/grass|meadow|turf|草地/i.test(name)) return 'grass';
  if (/concrete|asphalt|pavement|paving|stone|granite|terrazzo|porcelain|ceramic|tile|cement|floor base|outskirts road|混凝土|沥青|水泥|瓷砖/i.test(name)) return 'concrete';
  return undefined;
}

/**
 * Query only at a footfall, with cached bounds around static walkable materials.
 * A short downward ray reads the surface under the feet, including raised floors
 * and bridges. It never walks the decorative tree/leaf hierarchy each frame.
 */
export function createGroundSurfaceSampler(root: THREE.Object3D, region?: GeographicRegion) {
  const candidates: Array<{ mesh: THREE.Mesh; bounds: THREE.Box3 }> = [];
  const wooded = region?.landcover.filter(item => /forest|wood|scrub|orchard|tree/i.test(item.kind))
    .flatMap(item => item.polygons) ?? [];
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    let parent: THREE.Object3D | null = object;
    while (parent) {
      if (!parent.visible || parent.userData.footstepSurface === 'silent') return;
      if (parent === root) break;
      parent = parent.parent;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!object.userData.footstepSurface && !materials.some(mat => classifyGroundSurface(mat.name) || /terrain/i.test(mat.name))) return;
    if (object instanceof THREE.InstancedMesh) object.computeBoundingBox();
    else if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const box = object instanceof THREE.InstancedMesh ? object.boundingBox : object.geometry.boundingBox;
    if (box) candidates.push({ mesh: object, bounds: box.clone().applyMatrix4(object.matrixWorld) });
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, .8);
  const hits: THREE.Intersection[] = [];
  const normalMatrix = new THREE.Matrix3(), normal = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4();
  const supports: THREE.Mesh[] = [];
  return (feet: THREE.Vector3): GroundSurface => {
    supports.length = 0;
    for (const { mesh, bounds } of candidates) {
      let visible = true;
      for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
        if (!parent.visible || parent.userData.footstepSurface === 'silent') { visible = false; break; }
        if (parent === root) break;
      }
      if (!visible) continue;
      if (feet.x >= bounds.min.x - .02 && feet.x <= bounds.max.x + .02
        && feet.z >= bounds.min.z - .02 && feet.z <= bounds.max.z + .02
        && bounds.max.y >= feet.y - .55 && bounds.min.y <= feet.y + .25) supports.push(mesh);
    }
    ray.ray.origin.copy(feet).y += .25;
    hits.length = 0;
    ray.intersectObjects(supports, false, hits);
    for (const hit of hits) {
      if (!hit.face) continue;
      worldMatrix.copy(hit.object.matrixWorld);
      if (hit.object instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
        hit.object.getMatrixAt(hit.instanceId, instanceMatrix); worldMatrix.multiply(instanceMatrix);
      }
      normal.copy(hit.face.normal).applyMatrix3(normalMatrix.getNormalMatrix(worldMatrix)).normalize();
      if (Math.abs(normal.y) < .5) continue;
      const mesh = hit.object as THREE.Mesh;
      const override = mesh.userData.footstepSurface;
      if (['concrete', 'dirt', 'grass', 'gravel', 'wood'].includes(override)) return override as GroundSurface;
      const material = Array.isArray(mesh.material) ? mesh.material[hit.face.materialIndex] : mesh.material;
      if (/terrain/i.test(material?.name ?? '')) {
        return wooded.some(polygon => pointInPolygon([feet.x, feet.z], polygon)) ? 'dirt' : 'grass';
      }
      const surface = classifyGroundSurface(material?.name ?? '');
      if (surface) return surface;
    }
    return region ? (wooded.some(polygon => pointInPolygon([feet.x, feet.z], polygon)) ? 'dirt' : 'grass') : 'concrete';
  };
}
