import * as THREE from 'three';

/** A screen-width silhouette on the selected model, including its separate parts. */
export function createSelectionOutline() {
  const resolution = new THREE.Vector2(1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#51e08b') }, resolution: { value: resolution }, width: { value: 2.5 } },
    vertexShader: `uniform vec2 resolution; uniform float width;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * view;
        vec3 n = normalize(normalMatrix * normal);
        vec2 projected = (projectionMatrix * vec4(n, 0.0)).xy;
        float lengthN = length(projected);
        if (lengthN > 0.00001) clip.xy += projected / lengthN * width * 2.0 / resolution * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: 'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }',
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
  });
  let selected: readonly THREE.Object3D[] = [];
  const outlines: THREE.Mesh[] = [];
  function clear() {
    for (const outline of outlines) outline.removeFromParent();
    outlines.length = 0; selected = [];
  }
  return {
    select(objects: readonly THREE.Object3D[], color: THREE.ColorRepresentation) {
      material.uniforms.color.value.set(color);
      if (objects.length === selected.length && objects.every((object, i) => object === selected[i])) return;
      clear(); selected = [...objects];
      const meshes: THREE.Mesh[] = [];
      for (const object of objects) object.traverse(child => {
        if (child instanceof THREE.Mesh && !child.userData.selectionOutline && child.geometry.hasAttribute('normal')) meshes.push(child);
      });
      for (const mesh of meshes) {
        const outline = new THREE.Mesh(mesh.geometry, material);
        outline.name = 'selection-outline'; outline.userData.selectionOutline = true; outline.userData.collision = false;
        outline.raycast = () => {}; outline.renderOrder = 30;
        mesh.add(outline); outlines.push(outline);
      }
    },
    resize(width: number, height: number) { resolution.set(Math.max(1, width), Math.max(1, height)); },
    clear,
    dispose() { clear(); material.dispose(); },
  };
}
