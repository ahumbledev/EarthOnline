import * as THREE from 'three';
import type { CityLook } from './city-look.ts';

/**
 * Sky dome for the street view. The horizon is warmer toward the sun and
 * cooler away from it, so a sunset has a direction; a broad cloud layer takes
 * its lit and shaded colours from the colour script; after dark the horizon
 * keeps a band of city glow under a field of stars.
 *
 * It is drawn on the existing dome mesh and is also what the environment
 * capture sees, so reflections follow the same sky.
 */
const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDirection = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w;
  }
`;
const fragmentShader = /* glsl */ `
  uniform vec3 zenithColor, horizonColor, antisolarColor, groundColor;
  uniform vec3 sunColor, sunDirection, moonDirection;
  uniform vec3 cloudLit, cloudShade, cityGlow;
  uniform float sunHalo, sunDisc, moonDisc, stars, cloudOpacity, cloudCover, cityGlowStrength, elapsed;
  varying vec3 vDirection;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0, weight = 0.5;
    for (int i = 0; i < 4; i++) { sum += noise(p) * weight; p = p * 2.03 + vec2(17.3, 9.1); weight *= 0.5; }
    return sum / 0.9375;
  }
  void main() {
    vec3 direction = normalize(vDirection);
    float height = direction.y, up = clamp(height, 0.0, 1.0);
    vec2 azimuth = normalize(direction.xz + vec2(1e-5));
    vec2 sunAzimuth = normalize(sunDirection.xz + vec2(1e-5));
    float toward = dot(azimuth, sunAzimuth) * 0.5 + 0.5;
    // The warm band hugs the horizon on the sun's side and thins with height.
    vec3 rim = mix(antisolarColor, horizonColor, pow(toward, 1.6));
    vec3 color = mix(rim, zenithColor, pow(up, 0.46));
    color = mix(color, mix(rim, zenithColor, 0.35), smoothstep(0.0, 0.5, up) * (1.0 - toward) * 0.25);
    float alignment = max(dot(direction, sunDirection), 0.0);
    color += sunColor * (pow(alignment, 5.0) * 0.16 + pow(alignment, 40.0) * 0.5) * sunHalo;
    color += sunColor * smoothstep(0.99986, 0.99996, alignment) * 5.0 * sunDisc;
    float moon = dot(direction, moonDirection);
    color += vec3(0.72, 0.82, 1.0) * (smoothstep(0.99972, 0.99990, moon) * 1.8 + pow(max(moon, 0.0), 220.0) * 0.12) * moonDisc;
    vec2 starUV = vec2(atan(direction.x, direction.z), asin(clamp(height, -1.0, 1.0))) * 150.0;
    float seed = hash(floor(starUV));
    float star = pow(max(0.0, 1.0 - length(fract(starUV) - 0.5) * 2.8), 5.0);
    float twinkle = 0.75 + 0.25 * sin(elapsed * (1.5 + seed * 3.0) + seed * 40.0);
    color += vec3(0.55, 0.66, 0.9) * star * step(0.989, seed) * stars * twinkle * smoothstep(0.06, 0.4, height);
    // A cloud deck projected from above; the second sample toward the sun
    // tells whether this patch sits behind thicker cloud.
    vec2 cloudUV = direction.xz / max(height + 0.14, 0.1) * 0.85 + vec2(elapsed * 0.0024, elapsed * 0.0007);
    float density = fbm(cloudUV);
    float cover = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.3, density) * smoothstep(0.015, 0.2, height);
    float towardSun = fbm(cloudUV + sunAzimuth * 0.11);
    float lit = clamp(0.62 + (density - towardSun) * 2.6, 0.0, 1.0);
    vec3 cloud = mix(cloudShade, cloudLit, lit);
    // Thin edges facing the sun pick up its colour.
    cloud += sunColor * pow(alignment, 6.0) * (1.0 - cover) * 0.35 * sunHalo;
    color = mix(color, cloud, cover * cloudOpacity);
    // Light pollution: brightest at the horizon, gone a third of the way up.
    color += cityGlow * cityGlowStrength * exp(-up * 6.5);
    color = mix(color, groundColor, smoothstep(0.0, -0.22, height));
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCitySkyMaterial(): THREE.ShaderMaterial {
  const color = () => ({ value: new THREE.Color() }), number = (value = 0) => ({ value });
  return new THREE.ShaderMaterial({
    name: 'CitySky', vertexShader, fragmentShader,
    uniforms: {
      zenithColor: color(), horizonColor: color(), antisolarColor: color(), groundColor: color(),
      sunColor: color(), cloudLit: color(), cloudShade: color(), cityGlow: color(),
      sunDirection: { value: new THREE.Vector3(1, 0, 0) }, moonDirection: { value: new THREE.Vector3(-1, 0, 0) },
      sunHalo: number(), sunDisc: number(), moonDisc: number(), stars: number(), cloudOpacity: number(),
      cloudCover: number(.46), cityGlowStrength: number(), elapsed: number(),
    },
    side: THREE.BackSide, depthWrite: false, depthFunc: THREE.LessEqualDepth, fog: false,
  });
}

/** `sun` points toward the sun; the moon sits opposite it. */
export function updateCitySky(material: THREE.ShaderMaterial, look: CityLook, sun: THREE.Vector3, elapsed: number, cloudCover?: number) {
  const uniforms = material.uniforms;
  uniforms.zenithColor.value.copy(look.zenith); uniforms.horizonColor.value.copy(look.horizon);
  uniforms.antisolarColor.value.copy(look.antisolar); uniforms.groundColor.value.copy(look.haze);
  uniforms.sunColor.value.copy(look.sunGlow); uniforms.cloudLit.value.copy(look.cloudLit);
  uniforms.cloudShade.value.copy(look.cloudShade); uniforms.cityGlow.value.copy(look.cityGlow);
  uniforms.sunDirection.value.copy(sun); uniforms.moonDirection.value.copy(sun).negate();
  uniforms.sunHalo.value = look.sunHalo; uniforms.sunDisc.value = look.sunDisc;
  uniforms.moonDisc.value = look.dusk * .6 + look.night; uniforms.stars.value = look.stars;
  uniforms.cloudOpacity.value = look.cloudOpacity; uniforms.cityGlowStrength.value = look.cityGlowStrength;
  uniforms.elapsed.value = elapsed;
  if (cloudCover !== undefined) uniforms.cloudCover.value = THREE.MathUtils.clamp(cloudCover, 0, 1);
}
