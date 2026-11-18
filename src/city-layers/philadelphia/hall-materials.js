import * as THREE from "three";

/** Candidate surface only: .8 m is an artist estimate, not surveyed block size.
 * Geometry carries this scale in UV0; texture transforms stay at identity so the
 * same standard PBR material can be exported to Blender / glTF without a shader.
 */
export const HALL_STONE_SURFACE = Object.freeze({
  family_id: "hall-white-stone",
  variant_id: "matte-pale-grain",
  revision: "r001",
  repeatM: 0.8,
  normalScale: 0.18,
  roughness: 1,
  metalness: 0,
  color: "maps/stone/color.jpg",
  normal: "maps/stone/normal.jpg",
  roughnessMap: "maps/stone/roughness.jpg",
  normalConvention: "OpenGL +Y",
  projection: "local-metre dominant-axis box projection; signed outward UV basis",
});

// Mortar/joints remain solid by default: their darker authored geometry already
// separates blocks. A caller may explicitly include hall-joint after comparison.
export const HALL_STONE_MATERIALS = Object.freeze([
  "hall-stone",
  "hall-stone-warm",
  "hall-stone-muted",
  "hall-trim",
]);

/** Apply three shared, loaded Texture objects to one standard PBR material.
 * Retains authored tint, opacity and vertex colors. Does not allocate or own
 * textures/materials: the caller's existing resource disposer retains ownership.
 * `maps` has { color, normal, roughness }; all files are supplied by the manifest.
 */
export function configureHallStoneMaterial(material, maps) {
  if (!material?.isMeshStandardMaterial)
    throw new TypeError("Hall stone requires a MeshStandardMaterial");
  for (const role of ["color", "normal", "roughness"])
    if (!maps?.[role]?.isTexture)
      throw new TypeError(`Hall stone is missing its ${role} Texture`);
  for (const [role, texture] of Object.entries(maps)) {
    if (!["color", "normal", "roughness"].includes(role)) continue;
    texture.colorSpace = role === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.offset.set(0, 0);
    texture.repeat.set(1, 1);
    texture.center.set(0, 0);
    texture.rotation = 0;
    texture.updateMatrix();
    texture.needsUpdate = true;
  }
  material.map = maps.color;
  material.normalMap = maps.normal;
  material.normalMapType = THREE.TangentSpaceNormalMap;
  material.normalScale.set(HALL_STONE_SURFACE.normalScale, HALL_STONE_SURFACE.normalScale);
  material.roughnessMap = maps.roughness;
  material.roughness = HALL_STONE_SURFACE.roughness;
  material.metalness = HALL_STONE_SURFACE.metalness;
  material.userData.hallSurface = { ...HALL_STONE_SURFACE };
  material.needsUpdate = true;
  return material;
}

/** Adapt one Batches instance; its storage, geometry, normals and colors remain
 * unchanged. Calls through box/quad/cylinder still reach this tri override.
 *
 * options.materials: eligible input names (defaults to HALL_STONE_MATERIALS).
 *
 * Each planar chart uses a shared Hall-local origin, never triangle bounds.
 * Choose the largest normal component, with deterministic X/Y/Z tie breaks.
 * This bounds projected length compression to 1/sqrt(3), and area compression
 * to 1/sqrt(3). Curved surfaces have explicit seams where the chart changes;
 * this is standard UV data, not blended triplanar shading. Geometry normals are
 * retained, and U x V points outward on all six box faces for tangent normals.
 */
export function withHallSurfaceUV(batch, frame, options = {}) {
  if (typeof batch?.tri !== "function" || typeof frame?.local !== "function")
    throw new TypeError("Hall UV needs a Batches instance and City Hall frame");
  const repeatM = HALL_STONE_SURFACE.repeatM;
  const allowed = new Set(options.materials ?? HALL_STONE_MATERIALS);
  const originalTri = batch.tri;
  const tri = (material, a, b, c, uv, color) => {
    if (!allowed.has(material))
      return originalTri.call(batch, material, a, b, c, uv, color);
    const points = [a, b, c].map((p) => {
      const [x, z] = frame.local([p[0], p[2]]);
      return [x, p[1], z];
    });
    const ab = points[1].map((v, i) => v - points[0][i]);
    const ac = points[2].map((v, i) => v - points[0][i]);
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const magnitude = n.map(Math.abs), largest = Math.max(...magnitude);
    // A degenerate source triangle cannot define a tangent chart. Preserve it
    // unchanged; this adapter is not a topology repair stage.
    if (!Number.isFinite(largest) || largest < 1e-12)
      return originalTri.call(batch, material, a, b, c, uv, color);
    const axis = magnitude.findIndex((v) => largest - v <= largest * 1e-10);
    const sign = n[axis] < 0 ? -1 : 1;
    const projected = points.map(([x, y, z]) => {
      const pair = axis === 0 ? [-z * sign, y] :
        axis === 1 ? [x, -z * sign] : [x * sign, y];
      return pair.map((v) => v / repeatM);
    });
    return originalTri.call(batch, material, a, b, c, projected, color);
  };
  return new Proxy(batch, {
    get(target, key, receiver) {
      return key === "tri" ? tri : Reflect.get(target, key, receiver);
    },
  });
}
