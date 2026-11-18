import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Wet streets: lit signs, shop fronts and lamps reflected in the road and
 * footway. Upward-facing surfaces are found from the scene depth, a reflected
 * ray is marched across the screen at half resolution, and the result is
 * smeared along the reflection the way rough wet asphalt stretches a light.
 * The same pixels are darkened, as wet stone is.
 *
 * Nothing is rendered twice and no material changes: the cost is one
 * half-resolution trace and one composite, and only while the street is wet.
 * What is off screen cannot be reflected; reflections fade toward the edges.
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const shared = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 sceneProjectionInverse;
  uniform mat4 sceneCameraWorld;
  uniform vec3 sceneCameraPosition;
  uniform float wetness;
  varying vec2 vUv;
  vec3 worldAt(vec2 uv, float depth) {
    vec4 view = sceneProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return (sceneCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  /** How wet this spot is: standing water gathers in broad patches, the rest is damp. */
  float wetAt(vec3 world, vec3 normal) {
    float flatness = smoothstep(0.93, 0.985, normal.y);
    float pool = smoothstep(0.38, 0.7, noise(world.xz * 0.21) * 0.65 + noise(world.xz * 0.9 + 7.3) * 0.35);
    return flatness * wetness * mix(0.42, 1.0, pool);
  }
`;
const traceShader = /* glsl */ `
  ${shared}
  uniform sampler2D tColor;
  uniform mat4 sceneViewProjection;
  uniform float cameraNear, cameraFar, reach;
  const int STEPS = SSR_STEPS;
  float viewDepth(float depth) { return cameraNear * cameraFar / (cameraFar - depth * (cameraFar - cameraNear)); }
  void main() {
    float depth = texture2D(tDepth, vUv).r;
    gl_FragColor = vec4(0.0);
    if (depth >= 1.0) return;
    vec3 world = worldAt(vUv, depth);
    vec3 normal = normalize(cross(dFdx(world), dFdy(world)));
    float wet = wetAt(world, normal);
    if (wet <= 0.01) return;
    vec3 view = normalize(world - sceneCameraPosition);
    // Wind ripples and the grain of the surface break up a perfect mirror.
    vec2 ripple = vec2(noise(world.xz * 2.7), noise(world.xz * 2.7 + 19.7)) - 0.5;
    vec3 mirror = normalize(vec3(ripple.x * 0.05, 1.0, ripple.y * 0.05));
    vec3 ray = reflect(view, mirror);
    if (ray.y <= 0.01) return;
    float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(dot(-view, mirror), 0.0, 1.0), 5.0);
    vec3 start = world + mirror * 0.06;
    vec4 clip0 = sceneViewProjection * vec4(start, 1.0);
    vec4 clip1 = sceneViewProjection * vec4(start + ray * reach, 1.0);
    if (clip0.w <= 0.0 || clip1.w <= 0.0) return;
    // Depth is affine along a screen-space line, so the ray can be stepped in pixels.
    vec3 ndc0 = clip0.xyz / clip0.w, ndc1 = clip1.xyz / clip1.w;
    float jitter = hash(gl_FragCoord.xy + 0.37);
    vec3 colour = vec3(0.0); float found = 0.0;
    for (int i = 1; i <= STEPS; i++) {
      float s = (float(i) - jitter) / float(STEPS);
      // Finer steps near the surface, where contact reflections live.
      s = s * s * 0.55 + s * 0.45;
      vec3 ndc = mix(ndc0, ndc1, s);
      vec2 uv = ndc.xy * 0.5 + 0.5;
      if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) break;
      float scene = texture2D(tDepth, uv).r;
      float rayDepth = ndc.z * 0.5 + 0.5;
      if (scene < 1.0 && rayDepth > scene) {
        float behind = viewDepth(rayDepth) - viewDepth(scene);
        // Something thin in front of the ray is not what it hits.
        if (behind < 1.5 + viewDepth(scene) * 0.06) {
          float edge = smoothstep(0.0, 0.07, uv.x) * smoothstep(1.0, 0.93, uv.x) * smoothstep(1.0, 0.9, uv.y);
          colour = texture2D(tColor, uv).rgb;
          found = edge * (1.0 - smoothstep(0.7, 1.0, s));
          break;
        }
      }
    }
    // Bound a single hot pixel so the smear stays a glow rather than a flare.
    gl_FragColor = vec4(min(colour, vec3(10.0)) * found * fresnel * wet, wet);
  }
`;
const compositeShader = /* glsl */ `
  ${shared}
  uniform sampler2D tReflection;
  uniform vec2 reflectionTexel;
  uniform float strength, darkening;
  void main() {
    float depth = texture2D(tDepth, vUv).r;
    if (depth >= 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 world = worldAt(vUv, depth);
    vec3 normal = normalize(cross(dFdx(world), dFdy(world)));
    float wet = wetAt(world, normal);
    if (wet <= 0.01) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    // Stretch along the reflection (screen vertical) far more than across it.
    vec3 sum = vec3(0.0); float total = 0.0;
    for (int i = -4; i <= 4; i++) {
      float offset = float(i), weight = exp(-offset * offset * 0.11);
      vec2 uv = vUv + vec2(sin(offset * 2.4) * 0.6, offset * 1.6) * reflectionTexel;
      vec4 tap = texture2D(tReflection, uv);
      // Only wet neighbours contribute, so a kerb does not bleed onto a wall.
      float valid = step(0.01, tap.a);
      sum += tap.rgb * weight * valid; total += weight;
    }
    vec3 reflection = sum / max(total, 0.001) * strength;
    // rgb is added; alpha multiplies what is already there (wet stone is darker).
    gl_FragColor = vec4(reflection, mix(1.0, darkening, wet));
  }
`;

export class WetReflectionPass extends Pass {
  sourceDepth: THREE.DepthTexture | null = null;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly trace: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly viewProjection = new THREE.Matrix4();
  private wetness = 0;
  private steps: number;

  constructor(camera: THREE.PerspectiveCamera, steps = 24) {
    super();
    this.camera = camera; this.needsSwap = false; this.steps = Math.max(0, Math.round(steps));
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.LinearFilter;
    const common = () => ({
      tDepth: { value: null as THREE.Texture | null }, sceneProjectionInverse: { value: new THREE.Matrix4() },
      sceneCameraWorld: { value: new THREE.Matrix4() }, sceneCameraPosition: { value: new THREE.Vector3() }, wetness: { value: 0 },
    });
    this.trace = new THREE.ShaderMaterial({
      name: 'WetStreetTrace', vertexShader, fragmentShader: traceShader, defines: { SSR_STEPS: Math.max(8, Math.round(steps)) },
      uniforms: { ...common(), tColor: { value: null }, sceneViewProjection: { value: new THREE.Matrix4() }, cameraNear: { value: .1 }, cameraFar: { value: 1000 }, reach: { value: 90 } },
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.composite = new THREE.ShaderMaterial({
      name: 'WetStreetComposite', vertexShader, fragmentShader: compositeShader,
      uniforms: { ...common(), tReflection: { value: this.target.texture }, reflectionTexel: { value: new THREE.Vector2(1, 1) }, strength: { value: 1 }, darkening: { value: .84 } },
      depthTest: false, depthWrite: false, toneMapped: false, transparent: true,
      // result = reflection + destination * alpha
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
  }

  /** 0 is a dry street (the pass does nothing); 1 is standing water after rain. */
  setWetness(value: number, strength = 1) {
    this.wetness = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
    this.composite.uniforms.strength.value = strength;
  }
  get active() { return this.wetness > .01 && this.steps > 0; }
  /** Fewer steps on slower tiers; 0 turns the pass off. */
  setSteps(steps: number) {
    const next = Math.max(0, Math.round(steps));
    if (next === this.steps) return;
    this.steps = next;
    if (next > 0) { this.trace.defines.SSR_STEPS = Math.max(8, next); this.trace.needsUpdate = true; }
  }

  override setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / 2)), h = Math.max(1, Math.round(height / 2));
    this.target.setSize(w, h);
    this.composite.uniforms.reflectionTexel.value.set(1 / w, 1 / h);
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.active || !this.sourceDepth) return;
    const camera = this.camera;
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const material of [this.trace, this.composite]) {
      const uniforms = material.uniforms;
      uniforms.tDepth.value = this.sourceDepth; uniforms.wetness.value = this.wetness;
      uniforms.sceneProjectionInverse.value.copy(camera.projectionMatrixInverse);
      uniforms.sceneCameraWorld.value.copy(camera.matrixWorld);
      uniforms.sceneCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    }
    const trace = this.trace.uniforms;
    trace.tColor.value = read.texture; trace.sceneViewProjection.value.copy(this.viewProjection);
    trace.cameraNear.value = camera.near; trace.cameraFar.value = camera.far;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      this.quad.material = this.trace;
      renderer.setRenderTarget(this.target); renderer.clear(true, false, false); this.quad.render(renderer);
      this.quad.material = this.composite;
      renderer.setRenderTarget(read); this.quad.render(renderer);
    } finally { renderer.autoClear = autoClear; }
  }

  override dispose() { this.target.dispose(); this.trace.dispose(); this.composite.dispose(); this.quad.dispose(); }
}
