import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Street lamps and signs as light volumes applied to the finished scene colour.
 *
 * A forward-lit material pays for every real point light at every pixel, so a
 * street can only afford a handful, and the rest of the block stays unlit.
 * Here each light is one instanced sphere. Its pixels read the scene depth,
 * rebuild the world position and add the light arriving there to a
 * half-resolution light buffer. One full-screen step then brightens the scene
 * by that light: `colour * (1 + light)`, so albedo, texture and existing
 * shading are kept and the spill lands on road, walls, props and characters
 * alike. Scene materials never learn these lights exist: no extra shader
 * variants and no per-pixel cost outside each light's own footprint.
 *
 * Because the light is gathered before it is applied, a crowd of signs
 * approaches a ceiling instead of multiplying without bound, a surface that
 * already glows is not lit again, and a small absolute term lifts surfaces that
 * are nearly black under ambient light (asphalt at night), where a multiplier
 * alone would leave no pool under a lamp.
 */
export interface VolumeLight {
  position: THREE.Vector3;
  color: THREE.Color;
  /** Metres at which the light has faded to nothing. */
  radius: number;
  /** Multiplier on what the surface already shows at the light's centre. */
  intensity: number;
  /** 0–1 offset so neighbouring tubes do not flicker in unison; negative for a steady light. */
  flicker?: number;
}

const vertexShader = /* glsl */ `
  attribute vec4 volumeColor;
  varying vec3 vLightPosition;
  varying float vRadius;
  varying vec4 vColor;
  void main() {
    vLightPosition = instanceMatrix[3].xyz;
    vRadius = length(instanceMatrix[0].xyz);
    vColor = volumeColor;
    gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec2 resolution;
  uniform mat4 sceneProjectionInverse;
  uniform mat4 sceneCameraWorld;
  uniform float strength;
  uniform float elapsed;
  varying vec3 vLightPosition;
  varying float vRadius;
  varying vec4 vColor;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    float depth = texture2D(tDepth, uv).r;
    // The sky has no surface to light.
    if (depth >= 1.0) discard;
    vec4 view = sceneProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 world = (sceneCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
    vec3 toLight = vLightPosition - world;
    float distance = length(toLight);
    float reach = clamp(1.0 - distance / vRadius, 0.0, 1.0);
    if (reach <= 0.0) discard;
    // Smooth to zero at the radius; a little inverse-square shape near the source.
    float falloff = reach * reach / (1.0 + 2.5 * (distance / vRadius) * (distance / vRadius));
    // Facing from the depth surface itself. Depth edges give unreliable
    // derivatives, so surfaces turned away keep a share instead of going black.
    vec3 normal = normalize(cross(dFdx(world), dFdy(world)));
    float facing = clamp(dot(normal, toLight / max(distance, 0.001)), 0.0, 1.0);
    float shaped = mix(0.3, 1.0, facing);
    float flicker = 1.0;
    if (vColor.a >= 0.0) {
      // A worn tube: mostly steady, with brief dips.
      float phase = elapsed * (5.0 + vColor.a * 4.0) + vColor.a * 37.0;
      flicker = 0.9 + 0.1 * sin(phase) * sin(phase * 0.37 + 1.7) - 0.25 * step(0.985, fract(sin(floor(elapsed * 9.0) + vColor.a * 91.7) * 43758.5453));
    }
    gl_FragColor = vec4(vColor.rgb * (falloff * shaped * strength * flicker), 1.0);
  }
`;

const applyShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tLight;
  uniform float ceiling;
  uniform float lift;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    vec3 light = texture2D(tLight, vUv).rgb;
    // Overlapping lamps and signs approach a ceiling rather than stacking.
    float peak = max(max(light.r, light.g), light.b);
    light /= 1.0 + peak / ceiling;
    // A surface that already glows is a source of light, not a receiver.
    float luma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
    float receive = 1.0 - smoothstep(0.7, 2.2, luma);
    gl_FragColor = vec4(base.rgb * (1.0 + light * receive) + light * (lift * receive), base.a);
  }
`;
const applyVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), identity = new THREE.Quaternion();

export class LightVolumePass extends Pass {
  /** Depth written by the scene pass of this frame. */
  sourceDepth: THREE.DepthTexture | null = null;
  readonly capacity: number;
  private readonly camera: THREE.Camera;
  private readonly volumes = new THREE.Scene();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly apply: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly light: THREE.WebGLRenderTarget;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly black = new THREE.Color(0, 0, 0);
  private readonly previousClear = new THREE.Color();
  private strength = 0;
  /** Light buffer size relative to the scene; half by default. A full buffer keeps pools exact at depth edges. */
  private resolutionScale = .5;
  private fullSize = new THREE.Vector2(1, 1);

  constructor(camera: THREE.Camera, capacity = 96) {
    super();
    this.camera = camera; this.capacity = capacity;
    // Reads the scene colour and writes the lit result; disabled while there is nothing to draw.
    this.needsSwap = true; this.enabled = false;
    const geometry = new THREE.IcosahedronGeometry(1.08, 1);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('volumeColor', this.colors);
    this.material = new THREE.ShaderMaterial({
      name: 'StreetLightVolumes', vertexShader, fragmentShader,
      uniforms: {
        tDepth: { value: null }, resolution: { value: new THREE.Vector2(1, 1) },
        sceneProjectionInverse: { value: new THREE.Matrix4() }, sceneCameraWorld: { value: new THREE.Matrix4() },
        strength: { value: 0 }, elapsed: { value: 0 },
      },
      // Back faces without depth testing: correct with the camera inside a volume.
      side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.volumes.add(this.mesh);
    this.volumes.matrixWorldAutoUpdate = false;
    this.light = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.apply = new THREE.ShaderMaterial({
      name: 'StreetLightApply', vertexShader: applyVertex, fragmentShader: applyShader,
      uniforms: { tDiffuse: { value: null }, tLight: { value: this.light.texture }, ceiling: { value: 5 }, lift: { value: .03 } },
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.apply);
  }

  /** `strength` scales every light, e.g. the dusk-to-night blend. Lights beyond capacity are ignored. */
  setLights(lights: readonly VolumeLight[], strength: number, elapsed = 0) {
    const count = Math.min(lights.length, this.capacity), colors = this.colors.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const light = lights[i];
      scale.setScalar(light.radius);
      this.mesh.setMatrixAt(i, matrix.compose(light.position, identity, scale));
      colors[i * 4] = light.color.r * light.intensity; colors[i * 4 + 1] = light.color.g * light.intensity;
      colors[i * 4 + 2] = light.color.b * light.intensity; colors[i * 4 + 3] = light.flicker ?? -1;
    }
    this.mesh.count = count; this.mesh.instanceMatrix.needsUpdate = true; this.colors.needsUpdate = true;
    this.strength = Number.isFinite(strength) ? Math.max(0, strength) : 0;
    this.material.uniforms.elapsed.value = elapsed;
    this.enabled = this.active && !!this.sourceDepth;
  }

  get active() { return this.mesh.count > 0 && this.strength > .001; }
  get count() { return this.mesh.count; }

  /** `ceiling` bounds how many times brighter gathered light can make a surface; `lift` is the absolute share for near-black surfaces. */
  setResponse(ceiling: number, lift: number) { this.apply.uniforms.ceiling.value = Math.max(.1, ceiling); this.apply.uniforms.lift.value = Math.max(0, lift); }

  override setSize(width: number, height: number) {
    this.fullSize.set(width, height);
    const w = Math.max(1, Math.round(width * this.resolutionScale)), h = Math.max(1, Math.round(height * this.resolutionScale));
    this.light.setSize(w, h); this.material.uniforms.resolution.value.set(w, h);
  }

  setResolutionScale(scale: number) {
    const next = THREE.MathUtils.clamp(scale, .25, 1);
    if (next === this.resolutionScale) return;
    this.resolutionScale = next; this.setSize(this.fullSize.x, this.fullSize.y);
  }

  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const uniforms = this.material.uniforms;
    uniforms.tDepth.value = this.sourceDepth; uniforms.strength.value = this.strength;
    uniforms.sceneProjectionInverse.value.copy(this.camera.projectionMatrixInverse);
    uniforms.sceneCameraWorld.value.copy(this.camera.matrixWorld);
    const autoClear = renderer.autoClear, shadows = renderer.shadowMap.autoUpdate, alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.previousClear);
    renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(this.light); renderer.setClearColor(this.black, 0); renderer.clear(true, false, false);
      renderer.render(this.volumes, this.camera);
      this.apply.uniforms.tDiffuse.value = read.texture;
      renderer.setRenderTarget(this.renderToScreen ? null : write); this.quad.render(renderer);
    } finally { renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = shadows; renderer.setClearColor(this.previousClear, alpha); }
  }

  override dispose() { this.mesh.geometry.dispose(); this.material.dispose(); this.mesh.dispose(); this.apply.dispose(); this.quad.dispose(); this.light.dispose(); }
}

const offset = new THREE.Vector3();
/** Nearest lights first, dropping those that cannot reach the view. */
export function selectVolumeLights<T extends VolumeLight>(lights: readonly T[], view: THREE.Vector3, capacity: number, maxDistance = 150): T[] {
  const ranked: { light: T; score: number }[] = [];
  for (const light of lights) {
    const distance = offset.subVectors(light.position, view).length() - light.radius;
    if (distance <= maxDistance) ranked.push({ light, score: distance });
  }
  ranked.sort((a, b) => a.score - b.score);
  return ranked.slice(0, capacity).map(entry => entry.light);
}
