import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { RenderQuality } from '../game/quality.ts';
import { LightVolumePass, type VolumeLight } from '../rendering/light-volumes.ts';
import { WetReflectionPass } from '../rendering/wet-reflections.ts';

export interface CinematicLook {
  /** Night blend and sunset warmth, both between zero and one. */
  night: number;
  warmth: number;
  /** Elapsed real seconds, independent of the accelerated world clock. */
  elapsed: number;
  /** An authored street grade and atmosphere; omitted, the stock grade applies. */
  street?: StreetGrade;
}

/** Grade, glow and air for one moment of a street's colour script. */
export interface StreetGrade {
  saturation: number; contrast: number;
  shadowTint: THREE.Vector3; highlightTint: THREE.Vector3;
  bloom: number; bloomThreshold: number;
  /** Haze colour and density per metre; `inscatter` brightens haze seen toward `sunDirection`. */
  haze: THREE.Color; hazeDensity: number;
  inscatter: THREE.Color; inscatterStrength: number;
  sunDirection: THREE.Vector3;
}

export type CinematicPreset = 'street' | 'room' | 'landscape';

/**
 * Reconstruct normals from the main scene depth instead of drawing the entire
 * neighborhood again. Keeping a world-space radius makes this contact shading
 * behave consistently when moving between the street, rooms and overview.
 */
export class ContactOcclusionPass extends GTAOPass {
  sourceDepth: THREE.DepthTexture | null = null;
  resolutionScale = .75;
  maxDimension = 1280;
  private distanceFade = false;

  /** Contact-scale AO becomes sub-pixel on kilometre landscapes. In particular,
   * reconstructed far-depth normals must not tint the already fogged skyline.
   * Existing street/room presets retain their original shading.
   */
  setDistanceFade(near: number, far: number) {
    this.distanceFade = true;
    Object.assign(this.blendMaterial.uniforms, {
      tSceneDepth: { value: null },
      sceneProjectionMatrixInverse: { value: new THREE.Matrix4() },
      occlusionDistance: { value: new THREE.Vector2(near, far) },
    });
    this.blendMaterial.fragmentShader = /* glsl */ `
      uniform float intensity;
      uniform sampler2D tDiffuse;
      uniform sampler2D tSceneDepth;
      uniform mat4 sceneProjectionMatrixInverse;
      uniform vec2 occlusionDistance;
      varying vec2 vUv;
      void main() {
        float depth = texture2D(tSceneDepth, vUv).r;
        vec4 view = sceneProjectionMatrixInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        float distance = -view.z / view.w;
        if (depth >= 1.0 || distance >= occlusionDistance.y) {
          gl_FragColor = vec4(1.0);
          return;
        }
        vec3 occlusion = texture2D(tDiffuse, vUv).rgb;
        // NaN/Inf from grazing depth normals cannot be allowed into HDR bloom.
        // Comparisons also reject NaN, whereas clamp alone propagates it.
        if (!all(greaterThanEqual(occlusion, vec3(0.0))) || !all(lessThanEqual(occlusion, vec3(1.0)))) occlusion = vec3(1.0);
        float weight = 1.0 - smoothstep(occlusionDistance.x, occlusionDistance.y, distance);
        gl_FragColor = vec4(mix(vec3(1.0), occlusion, intensity * weight), 1.0);
      }
    `;
    this.blendMaterial.needsUpdate = true;
  }
  override setSize(width: number, height: number) {
    // Composer supplies physical pixels. Cap AO independently of retina/DPR;
    // the beauty pass and UI retain their normal full-resolution rendering.
    const scale = Math.min(this.resolutionScale, this.maxDimension / Math.max(width, height));
    super.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    // The composer swaps buffers; always bind the depth written by this frame's
    // RenderPass. Sky/transparent overlays keep their original depthWrite rules.
    this.setGBuffer(this.sourceDepth ?? readBuffer.depthTexture!);
    if (this.distanceFade) {
      this.blendMaterial.uniforms.tSceneDepth.value = this.sourceDepth ?? readBuffer.depthTexture;
      this.blendMaterial.uniforms.sceneProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  override dispose() {
    super.dispose();
    // r186's disposal omits these two shader materials.
    this.gtaoMaterial.dispose();
    this.blendMaterial.dispose();
  }
}

class BoundedBloomPass extends UnrealBloomPass {
  maxDimension = 1280;
  override setSize(width: number, height: number) {
    const scale = Math.min(1, (this.maxDimension ?? 1280) / Math.max(width, height));
    super.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  }
}

/**
 * Scene-linear grading, before the single ACES/output transform in OutputPass.
 * Keep the toe gentle so dim interiors remain navigable. This intentionally
 * avoids depth of field, motion blur, and heavy grain during character movement.
 */
/**
 * Miniature tilt-shift for the home's decorating diorama: a soft disc blur that
 * grows with distance from a horizontal focus band. Off (strength 0) everywhere else.
 */
const tiltShift = {
  name: 'CityTiltShift',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    strength: { value: 0 },
    focus: { value: 0.5 },
    band: { value: 0.16 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float strength;
    uniform float focus;
    uniform float band;
    varying vec2 vUv;
    void main() {
      vec4 centre = texture2D(tDiffuse, vUv);
      float away = abs(vUv.y - focus);
      float radius = smoothstep(band, band + 0.36, away) * strength;
      if (radius < 0.4) { gl_FragColor = centre; return; }
      vec2 px = radius / resolution;
      vec4 sum = centre * 2.0;
      sum += texture2D(tDiffuse, vUv + vec2(-0.326, -0.406) * px);
      sum += texture2D(tDiffuse, vUv + vec2(-0.840, -0.074) * px);
      sum += texture2D(tDiffuse, vUv + vec2(-0.696, 0.457) * px);
      sum += texture2D(tDiffuse, vUv + vec2(-0.203, 0.621) * px);
      sum += texture2D(tDiffuse, vUv + vec2(0.962, -0.195) * px);
      sum += texture2D(tDiffuse, vUv + vec2(0.473, -0.480) * px);
      sum += texture2D(tDiffuse, vUv + vec2(0.519, 0.767) * px);
      sum += texture2D(tDiffuse, vUv + vec2(0.185, -0.893) * px);
      sum += texture2D(tDiffuse, vUv + vec2(0.507, 0.064) * px);
      sum += texture2D(tDiffuse, vUv + vec2(0.896, 0.412) * px);
      sum += texture2D(tDiffuse, vUv + vec2(-0.322, -0.933) * px);
      sum += texture2D(tDiffuse, vUv + vec2(-0.792, -0.598) * px);
      gl_FragColor = sum / 14.0;
    }
  `,
};

const cinematicGrade = {
  name: 'CityCinematicGrade',
  uniforms: {
    tDiffuse: { value: null },
    night: { value: 0 },
    warmth: { value: 0 },
    elapsed: { value: 0 },
    aspect: { value: 1 },
    grainStrength: { value: 0.0013 },
    diorama: { value: 0 },
    street: { value: 0 },
    streetSaturation: { value: 1 }, streetContrast: { value: 1 },
    streetShadowTint: { value: new THREE.Vector3(1, 1, 1) }, streetHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    tSceneDepth: { value: null },
    sceneProjectionInverse: { value: new THREE.Matrix4() }, sceneCameraWorld: { value: new THREE.Matrix4() },
    hazeColor: { value: new THREE.Color() }, hazeDensity: { value: 0 },
    inscatterColor: { value: new THREE.Color() }, inscatterStrength: { value: 0 }, hazeSun: { value: new THREE.Vector3(0, 1, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float night;
    uniform float warmth;
    uniform float elapsed;
    uniform float aspect;
    uniform float grainStrength;
    uniform float diorama;
    uniform float street, streetSaturation, streetContrast;
    uniform vec3 streetShadowTint, streetHighlightTint;
    uniform sampler2D tSceneDepth;
    uniform mat4 sceneProjectionInverse, sceneCameraWorld;
    uniform vec3 hazeColor, inscatterColor, hazeSun;
    uniform float hazeDensity, inscatterStrength;
    varying vec2 vUv;

    float grain(vec2 pixel, float frame) {
      return fract(sin(dot(pixel + frame, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = max(source.rgb, vec3(0.0));
      if (street > 0.5) {
        // A lens, not a perfect pinhole: colours part a little toward the corners,
        // and the sensor's own sharpening lifts edges it has resolved.
        vec2 texel = 1.0 / vec2(textureSize(tDiffuse, 0));
        vec2 off = vUv - 0.5;
        vec2 fringe = off * dot(off, off) * 0.0045;
        color.r = max(texture2D(tDiffuse, vUv - fringe).r, 0.0);
        color.b = max(texture2D(tDiffuse, vUv + fringe).b, 0.0);
        vec3 around = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
          + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        vec3 detail = color - max(around, vec3(0.0)) * 0.25;
        // clamp the lift so a lamp or a specular point does not grow a halo
        color = max(color + clamp(detail, -0.25 * color - 0.02, 0.25 * color + 0.02) * 0.32, vec3(0.0));
      }
      // Aerial perspective: distance gathers the colour of the air, thickest at
      // street level and warmest looking toward the sun. Depth layers a long
      // street the way haze does, which flat distance fog alone cannot.
      if (street > 0.5 && hazeDensity > 0.0) {
        float sceneDepth = texture2D(tSceneDepth, vUv).r;
        if (sceneDepth < 1.0) {
          vec4 view = sceneProjectionInverse * vec4(vUv * 2.0 - 1.0, sceneDepth * 2.0 - 1.0, 1.0);
          vec3 viewPosition = view.xyz / view.w;
          float range = length(viewPosition);
          vec3 ray = normalize((sceneCameraWorld * vec4(viewPosition, 0.0)).xyz);
          float thin = mix(1.0, 0.3, smoothstep(0.0, 220.0, ray.y * range));
          float air = 1.0 - exp(-range * hazeDensity * thin);
          float toward = pow(max(dot(ray, hazeSun), 0.0), 5.0);
          color = mix(color, hazeColor + inscatterColor * (toward * inscatterStrength), air);
        }
      }
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float shadow = 1.0 - smoothstep(0.015, 0.65, luma);
      float highlight = smoothstep(0.22, 1.8, luma);

      // A slight blue bias in shadows and amber in sunlit/practical highlights.
      // Multiplication retains real darkness instead of painting a blue overlay.
      vec3 shadowTint = vec3(0.965, 0.991, 1.035);
      shadowTint = mix(shadowTint, vec3(0.945, 0.985, 1.065), night);
      vec3 highlightTint = mix(vec3(1.015, 1.002, 0.983),
                               vec3(1.065, 1.012, 0.936), warmth);
      if (street > 0.5) { shadowTint = streetShadowTint; highlightTint = streetHighlightTint; }
      color *= mix(vec3(1.0), shadowTint, shadow * 0.65);
      color *= mix(vec3(1.0), highlightTint, highlight * 0.7);

      // Subtle saturation/contrast; reduce contrast at night to keep the toe open.
      float gradedLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = max(mix(vec3(gradedLuma), color, street > 0.5 ? streetSaturation : mix(0.975, 0.96, night)), vec3(0.0));
      color = 0.18 * pow(max(color / 0.18, vec3(0.0)),
                         vec3(street > 0.5 ? streetContrast : mix(1.025, 1.005, night)));

      // The decorating diorama is graded like a lit model: richer colour, a firmer
      // S-curve, cooler shadows against the warm key, and a tighter frame.
      if (diorama > 0.0) {
        float dioramaLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(dioramaLuma), color, 1.0 + 0.3 * diorama);
        color = 0.18 * pow(max(color / 0.18, vec3(0.0)), vec3(1.0 + 0.16 * diorama));
        float cool = 1.0 - smoothstep(0.02, 0.5, dioramaLuma);
        color *= mix(vec3(1.0), vec3(0.93, 0.975, 1.07), cool * 0.55 * diorama);
        color *= 1.0 + 0.06 * diorama;
      }

      // Broad, mild vignette. Aspect correction avoids a narrow tunnel on PCs.
      vec2 centered = (vUv - 0.5) * 2.0;
      centered.x *= min(aspect, 1.65) / 1.3;
      float vignette = smoothstep(0.38, 1.75, dot(centered, centered));
      color *= 1.0 - vignette * (mix(0.12, 0.085, night) + 0.2 * diorama);

      // Very fine monochrome grain, held at film cadence, below ~one display step.
      float noise = grain(gl_FragCoord.xy, floor(elapsed * 24.0)) - 0.5;
      color += noise * grainStrength * (street > 0.5 ? 9.0 : 1.0) * sqrt(clamp(gradedLuma, 0.02, 1.0));
      gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
    }
  `,
};

/** GLSL test for a colour that is NaN or infinite; half-float targets hold nothing finite above 65504. */
const NON_FINITE = (rgb: string) => `(any(isnan(${rgb})) || any(isinf(${rgb})) || !(dot(abs(${rgb}), vec3(1.0)) < 1.0e6))`;

/**
 * Copy the resolved scene, dropping pixels that are not finite. One such pixel
 * (a degenerate normal, a zero-length vector in a material) is invisible by
 * itself, but every blur after it spreads it: through bloom it blanks the
 * whole frame for as long as the pixel is in view, which reads as a flash
 * whenever the camera turns.
 */
const finiteCopy = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: CopyShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      if (${NON_FINITE('texel.rgb')}) texel.rgb = vec3(0.0);
      gl_FragColor = texel;
    }
  `,
};

/** Resolve only geometry MSAA; full-screen passes remain single-sampled. */
export class SceneAntialiasPass extends RenderPass {
  readonly target: THREE.WebGLRenderTarget;
  private copy = new ShaderPass(finiteCopy);
  constructor(scene: THREE.Scene, camera: THREE.Camera, samples: number) {
    super(scene, camera);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, samples,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.copy.material.toneMapped = false;
    this.copy.material.depthTest = false;
    this.copy.material.depthWrite = false;
  }
  override setSize(width: number, height: number) { this.target.setSize(width, height); }
  /** Changing the sample count reallocates the target on its next use. */
  setSamples(samples: number) { if (this.target.samples === samples) return; this.target.samples = samples; this.target.dispose(); }
  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, delta: number, mask: boolean) {
    super.render(renderer, write, this.target, delta, mask);
    this.copy.render(renderer, read, this.target, delta, mask);
  }
  override dispose() { this.target.dispose(); this.copy.dispose(); }
}

/** Program keys are selected synchronously, even when compilation returns a promise. */
export function withRenderTarget<T>(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, operation: () => T): T {
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  renderer.setRenderTarget(target);
  try { return operation(); }
  finally { renderer.setRenderTarget(previous, face, mip); }
}

export function createCinematicPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  preset: CinematicPreset = 'street',
  antialiasSamples = 0,
  options: { street?: boolean } = {},
) {
  const room = preset === 'room';
  const size = renderer.getSize(new THREE.Vector2());
  // The compositor stays single-sampled. Only scene geometry needs MSAA.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType),
    samples: 0,
  });
  const composer = new EffectComposer(renderer, target);
  const samples = Math.min(antialiasSamples, renderer.capabilities.maxSamples);
  // Street passes read the scene depth while writing colour, so the scene
  // needs a target of its own even without multisampling.
  const scenePass = samples > 0 || options.street ? new SceneAntialiasPass(scene, camera, samples) : new RenderPass(scene, camera);
  const sceneDepth = scenePass instanceof SceneAntialiasPass ? scenePass.target.depthTexture : null;
  const volumes = options.street && sceneDepth ? new LightVolumePass(camera) : undefined;
  const wet = options.street && sceneDepth ? new WetReflectionPass(camera as THREE.PerspectiveCamera) : undefined;
  if (volumes) volumes.sourceDepth = sceneDepth;
  if (wet) wet.sourceDepth = sceneDepth;
  const contact = new ContactOcclusionPass(scene, camera);
  if (scenePass instanceof SceneAntialiasPass) contact.sourceDepth = scenePass.target.depthTexture;
  if (preset === 'landscape') contact.setDistanceFade(25, 70);
  contact.updateGtaoMaterial({
    radius: room ? 0.2 : 0.65, thickness: room ? 0.18 : 0.45, distanceExponent: 1.5,
    distanceFallOff: 1, scale: 1, samples: 12, screenSpaceRadius: false,
  });
  contact.updatePdMaterial({ radius: 4, samples: 12, depthPhi: 0.15, normalPhi: 4, lumaPhi: 1 });
  contact.blendIntensity = room ? 0.32 : 0.45;
  const bloom = new BoundedBloomPass(size, room ? 0.055 : 0.12, 0.38, room ? 1.6 : 1.25);
  // Bound only the signal entering bloom: nearby point lights can create very
  // large specular values on the imported bulb/metal geometry. Their original
  // HDR radiance still reaches ACES untouched, but cannot wash out the whole
  // frame through the large blur mips. Scale RGB together to retain lamp color.
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );',
    `vec4 texel = texture2D( tDiffuse, vUv );
     // Infinity times the zero scale below is NaN, and the blur mips carry a NaN across the frame.
     if (${NON_FINITE('texel.rgb')}) texel.rgb = vec3(0.0);
     float bloomPeak = max(max(texel.r, texel.g), max(texel.b, 0.0001));
     texel.rgb *= min(1.0, 8.0 / bloomPeak);`,
  );
  bloom.materialHighPassFilter.needsUpdate = true;
  const tilt = new ShaderPass(tiltShift);
  tilt.enabled = false; tilt.material.toneMapped = false;
  const grade = new ShaderPass(cinematicGrade);
  grade.uniforms.grainStrength.value = room ? 0.0003 : 0.0013;
  const output = new OutputPass();
  const fxaa = new ShaderPass(FXAAShader);

  // Neither custom pass performs another tone-map or color-space conversion.
  // FXAA expects sRGB, so it runs after OutputPass (as required by Three.js).
  grade.material.toneMapped = false;
  fxaa.material.toneMapped = false;
  composer.addPass(scenePass);
  // Lamps and signs light the scene before occlusion and glow are derived from it.
  if (volumes) composer.addPass(volumes);
  composer.addPass(contact);
  composer.addPass(tilt);
  composer.addPass(bloom);
  // After bloom, so a sign's halo is reflected with it.
  if (wet) composer.addPass(wet);
  composer.addPass(grade);
  if (sceneDepth) grade.uniforms.tSceneDepth.value = sceneDepth;
  composer.addPass(output);
  fxaa.enabled = samples === 0;
  composer.addPass(fxaa);

  let enabled = true;
  let disposed = false;
  let customOcclusion: number | undefined;
  let dioramaStrength = 0, dioramaBlurPixels = 7;
  let pixelRatio = renderer.getPixelRatio();
  let dimensions = size.clone();
  let qualityKey = '';

  function resize(width: number, height: number) {
    if (disposed) return;
    const logicalWidth = Math.max(1, Math.floor(width));
    const logicalHeight = Math.max(1, Math.floor(height));
    dimensions.set(logicalWidth, logicalHeight);
    const nextPixelRatio = renderer.getPixelRatio();
    if (pixelRatio !== nextPixelRatio) {
      pixelRatio = nextPixelRatio;
      composer.setPixelRatio(pixelRatio);
    }
    composer.setSize(logicalWidth, logicalHeight);
    fxaa.uniforms.resolution.value.set(
      1 / (logicalWidth * pixelRatio),
      1 / (logicalHeight * pixelRatio),
    );
    tilt.uniforms.resolution.value.set(logicalWidth * pixelRatio, logicalHeight * pixelRatio);
    tilt.uniforms.strength.value = dioramaStrength * dioramaBlurPixels * pixelRatio;
    grade.uniforms.aspect.value = logicalWidth / logicalHeight;
  }

  resize(size.x, size.y);

  return {
    get sceneRenderTarget() { return enabled ? (scenePass instanceof SceneAntialiasPass ? scenePass.target : composer.readBuffer) : null; },
    withSceneTarget<T>(operation: () => T): T {
      return withRenderTarget(renderer, enabled ? (scenePass instanceof SceneAntialiasPass ? scenePass.target : composer.readBuffer) : null, operation);
    },
    render(delta: number) {
      if (disposed) return;
      if (enabled) {
        grade.uniforms.sceneProjectionInverse.value.copy(camera.projectionMatrixInverse);
        grade.uniforms.sceneCameraWorld.value.copy(camera.matrixWorld);
        composer.render(delta);
      } else renderer.render(scene, camera);
    },
    resize,
    setQuality(quality: RenderQuality) {
      const key = `${quality.level}:${quality.aoScale}:${quality.aoSamples}:${quality.bloom}:${quality.sceneSamples}:${quality.reflectionSteps}`;
      if (disposed || key === qualityKey) return;
      qualityKey = key;
      if (scenePass instanceof SceneAntialiasPass && samples > 0) {
        const sceneSamples = Math.min(samples, quality.sceneSamples ?? samples, renderer.capabilities.maxSamples);
        scenePass.setSamples(sceneSamples); fxaa.enabled = sceneSamples === 0;
      }
      wet?.setSteps(quality.reflectionSteps ?? 0);
      contact.enabled = quality.aoScale > 0;
      contact.resolutionScale = Math.max(.01, quality.aoScale);
      contact.maxDimension = quality.level === 'high' ? 1280 : 768;
      contact.updateGtaoMaterial({ samples: quality.aoSamples });
      contact.updatePdMaterial({ samples: quality.aoSamples });
      bloom.enabled = quality.bloom;
      bloom.maxDimension = quality.level === 'high' ? 1280 : 768;
      resize(dimensions.x, dimensions.y);
    },
    setEnabled(value: boolean) {
      enabled = value;
    },
    setLook(look: CinematicLook) {
      grade.uniforms.night.value = THREE.MathUtils.clamp(look.night, 0, 1);
      grade.uniforms.warmth.value = THREE.MathUtils.clamp(look.warmth, 0, 1);
      grade.uniforms.elapsed.value = look.elapsed;
      // Let streetlights glow a little more at night while preserving their shape.
      bloom.strength = preset === 'landscape' ? .18 * THREE.MathUtils.smoothstep(grade.uniforms.night.value, .08, .85)
        : THREE.MathUtils.lerp(room ? 0.055 : 0.12, room ? 0.075 : 0.18, grade.uniforms.night.value);
      const street = look.street, uniforms = grade.uniforms;
      uniforms.street.value = street ? 1 : 0;
      if (street) {
        uniforms.streetSaturation.value = street.saturation; uniforms.streetContrast.value = street.contrast;
        uniforms.streetShadowTint.value.copy(street.shadowTint); uniforms.streetHighlightTint.value.copy(street.highlightTint);
        uniforms.hazeColor.value.copy(street.haze); uniforms.hazeDensity.value = sceneDepth ? street.hazeDensity : 0;
        uniforms.inscatterColor.value.copy(street.inscatter); uniforms.inscatterStrength.value = street.inscatterStrength;
        uniforms.hazeSun.value.copy(street.sunDirection);
        bloom.strength = street.bloom; bloom.threshold = street.bloomThreshold; bloom.radius = .42;
      }
      // Night readability comes from real practical lights; avoid crushing the
      // corners that are already dark when direct daylight disappears.
      contact.blendIntensity = customOcclusion === undefined
        ? THREE.MathUtils.lerp(room ? 0.32 : 0.45, room ? 0.24 : 0.32, grade.uniforms.night.value)
        : THREE.MathUtils.lerp(customOcclusion, customOcclusion * .72, grade.uniforms.night.value);
    },
    /** Lamps and signs to draw as light volumes this frame; `strength` is the night blend. */
    setStreetLights(lights: readonly VolumeLight[], strength: number, elapsed = 0) { volumes?.setLights(lights, strength, elapsed); },
    get streetLightCapacity() { return volumes?.capacity ?? 0; },
    /** How strongly gathered lamp light brightens a surface: `ceiling` bounds the gain, `lift` is the absolute share for near-black surfaces. */
    setStreetLightResponse(ceiling: number, lift: number) { volumes?.setResponse(ceiling, lift); },
    /** Light-volume buffer size relative to the scene (0.25-1; half by default). */
    setStreetLightResolution(scale: number) { volumes?.setResolutionScale(scale); },
    /** 0 is a dry street; 1 is standing water after rain. */
    setWetness(value: number, strength = 1) { wet?.setWetness(value, strength); },
    /** Wider contact shading for the home's distant isometric camera. */
    setOcclusion(options: { radius: number; thickness: number; intensity: number }) {
      if (disposed) return;
      contact.updateGtaoMaterial({ radius: options.radius, thickness: options.thickness });
      customOcclusion = options.intensity;
      contact.blendIntensity = THREE.MathUtils.lerp(customOcclusion, customOcclusion * .72, grade.uniforms.night.value);
    },
    /** Opt-in miniature grading and tilt-shift; defaults remain unchanged elsewhere. */
    setDiorama(strength: number, options: { focus?: number; band?: number; blurPixels?: number } = {}) {
      if (disposed) return;
      dioramaStrength = THREE.MathUtils.clamp(strength, 0, 1);
      dioramaBlurPixels = options.blurPixels ?? 7;
      tilt.enabled = dioramaStrength > .001;
      tilt.uniforms.strength.value = dioramaStrength * dioramaBlurPixels * pixelRatio;
      tilt.uniforms.focus.value = options.focus ?? .5;
      tilt.uniforms.band.value = options.band ?? .16;
      grade.uniforms.diorama.value = dioramaStrength;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scenePass.dispose();
      volumes?.dispose(); wet?.dispose();
      contact.dispose();
      bloom.dispose();
      // r186's UnrealBloomPass.dispose() does not release this material itself.
      bloom.materialHighPassFilter.dispose();
      tilt.dispose();
      grade.dispose();
      output.dispose();
      fxaa.dispose();
      composer.dispose();
    },
  };
}
