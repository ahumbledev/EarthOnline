import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { scheduleTextureUpload } from './texture-upload-queue.ts';

export type TextureQuality = 'smooth' | 'standard' | 'high';
interface ImageAsset { url: string; sha256: string; bytes: number; width?: number; height?: number }
interface FullImage extends ImageAsset { tiers?: Partial<Record<TextureQuality, ImageAsset>> }
interface ImageJob {
  original: FullImage;
  textures: Set<THREE.Texture>;
  previews: Map<THREE.Texture, THREE.Texture['source']>;
  bindings: { material: THREE.Material; slot: string; texture: THREE.Texture }[];
  bounds: THREE.Box3[];
  colour: boolean;
  attempts: number;
  state: 'queued' | 'loading' | 'done' | 'failed';
  loaded?: { asset: ImageAsset; bitmap: ImageBitmap; bytes: number };
  request?: AbortController;
  restoring?: boolean;
}
const MiB = 1024 * 1024;
export const TEXTURE_BUDGETS = {
  smooth: { radius: 65, residentBytes: 64 * MiB, concurrency: 2 },
  standard: { radius: 110, residentBytes: 192 * MiB, concurrency: 2 },
  high: { radius: Infinity, residentBytes: 512 * MiB, concurrency: 3 },
} as const;

export interface ProgressiveTextures {
  update(position: THREE.Vector3, camera?: THREE.Camera): void;
  start(): void;
  setActive(active: boolean): void;
  setQuality(quality: TextureQuality): void;
  /** Replan after another material pack replaces authored texture bindings. */
  refresh(): void;
  dispose(): void;
  /** Resolves when the initial visible budget is settled, including deferred maps. */
  readonly finished: Promise<void>;
  readonly report: { total: number; completed: number; failed: number; active: number; deferred: number; residentBytes: number; uploads: number; quality: TextureQuality };
}
interface StreamOptions {
  signal?: AbortSignal;
  concurrency?: number;
  quality?: TextureQuality;
  renderer?: Pick<THREE.WebGLRenderer, 'initTexture'>;
  request?: typeof fetch;
  decode?: (blob: Blob, options: ImageBitmapOptions) => Promise<ImageBitmap>;
  /** Test seam for animation frames; at most one image group commits per call. */
  schedule?: (callback: () => void) => void;
}
const validAsset = (value: ImageAsset | undefined): value is ImageAsset => Boolean(value
  && /^[a-f0-9]{64}$/.test(value.sha256)
  && new RegExp(`^/textures/stream/${value.sha256}\\.(?:png|jpg|jpeg|webp|avif)$`).test(value.url));

/** Decode serially and install at most one shared image group per animation
 * frame. Nearby maps have a bounded resident budget; distant maps keep the
 * embedded preview. Changing quality selects build-time sizes before download. */
export function createProgressiveTextures(gltf: GLTF, options: StreamOptions = {}): ProgressiveTextures {
  const request = options.request ?? fetch;
  const decode = options.decode ?? ((blob: Blob, settings: ImageBitmapOptions) => createImageBitmap(blob, settings));
  const schedule = options.schedule ?? (callback => {
    void scheduleTextureUpload(callback, controller.signal).catch(() => {});
  });
  const controller = new AbortController(), jobs = new Map<string, ImageJob>();
  const allTextures = new Set<THREE.Texture>(), ownedImages = new Set<ImageBitmap>(), closedImages = new WeakSet<object>();
  const textureBindings = new Map<THREE.Texture, { material: THREE.Material; slot: string; texture: THREE.Texture; bounds?: THREE.Box3 }[]>();
  const position = new THREE.Vector3(), plannedPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  const cameraQuaternion = new THREE.Quaternion(), frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  let hasCamera = false, started = false, active = true, disposed = false, epoch = 0, frameScheduled = false;
  let quality: TextureQuality = options.quality ?? 'standard';
  const report = { total: 0, completed: 0, failed: 0, active: 0, deferred: 0, residentBytes: 0, uploads: 0, quality };
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const selected = new Set<ImageJob>();
  type Commit = { job: ImageJob; bitmap?: ImageBitmap; asset?: ImageAsset; epoch: number; resolve(value: boolean): void };
  const commits: Commit[] = [];
  let decoder: Promise<unknown> = Promise.resolve();

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const bounds = node.geometry.boundingBox?.clone().applyMatrix4(node.matrixWorld);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const [slot, texture] of Object.entries(material)) {
        if (!(texture instanceof THREE.Texture)) continue;
        allTextures.add(texture);
        const bindings = textureBindings.get(texture) ?? [];
        bindings.push({ material, slot, texture, bounds }); textureBindings.set(texture, bindings);
        const index = gltf.parser.associations.get(texture)?.textures;
        const imageIndex = index === undefined ? undefined : gltf.parser.json.textures?.[index]?.source;
        const full = gltf.parser.json.images?.[imageIndex]?.extras?.fullTexture as FullImage | undefined;
        if (!validAsset(full)) continue;
        let job = jobs.get(full.url);
        if (!job) {
          job = { original: full, textures: new Set(), previews: new Map(), bindings: [], bounds: [], colour: false, attempts: 0, state: 'queued' };
          jobs.set(full.url, job);
        }
        job.textures.add(texture); job.bindings.push({ material, slot, texture });
        if (bounds) job.bounds.push(bounds);
        if (slot === 'map' || slot === 'emissiveMap') job.colour = true;
      }
    }
  });
  for (const job of jobs.values()) {
    const sources = new Set([...job.textures].map(texture => texture.source));
    for (const texture of allTextures) if (!job.textures.has(texture) && sources.has(texture.source)) {
      job.textures.add(texture);
      for (const binding of textureBindings.get(texture) ?? []) {
        job.bindings.push(binding);
        if (binding.bounds) job.bounds.push(binding.bounds);
        if (binding.slot === 'map' || binding.slot === 'emissiveMap') job.colour = true;
      }
    }
    for (const texture of job.textures) job.previews.set(texture, texture.source);
  }
  report.total = jobs.size;

  const desired = (job: ImageJob) => validAsset(job.original.tiers?.[quality]) ? job.original.tiers![quality]! : job.original;
  const memory = (asset: ImageAsset) => asset.width && asset.height ? Math.ceil(asset.width * asset.height * 4 * 4 / 3) : 0;
  const residentCost = (job: ImageJob, asset: ImageAsset) => {
    // Three keeps separate GPU allocations for incompatible sampler/colour-space
    // variants even when they share the same Source. UV transforms do not add one.
    const variants = new Set([...job.textures].map(texture => [texture.wrapS, texture.wrapT, texture.magFilter,
      texture.minFilter, texture.anisotropy, texture.format, texture.type, texture.colorSpace, texture.flipY].join(':')));
    return memory(asset) * variants.size;
  };
  const distance = (job: ImageJob) => job.bounds.length ? Math.min(...job.bounds.map(bounds => bounds.distanceToPoint(position))) : 0;
  const inUse = (job: ImageJob) => job.bindings.some(binding => (binding.material as unknown as Record<string, unknown>)[binding.slot] === binding.texture);
  const priority = (job: ImageJob) => distance(job) + (job.colour ? 0 : 24)
    + (hasCamera && !job.bounds.some(bounds => frustum.intersectsBox(bounds)) ? 48 : 0) + job.attempts * 1000;
  function refreshReport() {
    report.completed = [...jobs.values()].filter(job => job.state === 'done').length;
    report.failed = [...jobs.values()].filter(job => job.state === 'failed').length;
    report.residentBytes = [...jobs.values()].reduce((sum, job) => sum + (job.loaded?.bytes ?? 0), 0);
    report.deferred = jobs.size - selected.size;
  }
  function close(image: unknown) {
    if (!image || typeof image !== 'object' || closedImages.has(image)) return;
    const bitmap = image as ImageBitmap;
    if (typeof bitmap.close === 'function') { bitmap.close(); closedImages.add(image); ownedImages.delete(bitmap); }
  }
  function releaseLoaded(job: ImageJob) {
    if (!job.loaded) return;
    for (const texture of job.textures) { texture.dispose(); texture.source = job.previews.get(texture)!; texture.needsUpdate = true; }
    close(job.loaded.bitmap); job.loaded = undefined; job.state = 'queued'; job.attempts = 0;
  }
  function nextFrame() {
    if (frameScheduled || disposed || !commits.length) return;
    frameScheduled = true;
    schedule(() => {
      frameScheduled = false;
      const commit = commits.shift();
      if (commit) {
        const { job, bitmap, asset } = commit;
        if (disposed || commit.epoch !== epoch || bitmap && !selected.has(job)) {
          if (bitmap) close(bitmap);
          if (job.state === 'loading' && commit.epoch === epoch) { job.state = 'queued'; job.attempts = 0; }
          job.restoring = false; commit.resolve(false);
        } else if (!bitmap || !asset) {
          releaseLoaded(job); job.restoring = false; commit.resolve(true);
        } else {
          const previous = job.loaded?.bitmap;
          try {
            for (const texture of job.textures) texture.dispose();
            const source = new THREE.TextureSource(bitmap);
            for (const texture of job.textures) { texture.source = source; texture.needsUpdate = true; options.renderer?.initTexture(texture); }
            job.loaded = { asset, bitmap, bytes: residentCost(job, asset) }; job.state = 'done'; job.attempts = 0; ++report.uploads;
            if (previous) close(previous);
            // Tiered images retain tiny preview bitmaps for later eviction. Old
            // manifests without tiers retain their original one-shot behavior.
            if (!job.original.tiers) for (const preview of job.previews.values()) {
              if (![...allTextures].some(texture => texture.source.data === preview.data)) close(preview.data);
            }
            commit.resolve(true);
          } catch {
            for (const texture of job.textures) { texture.dispose(); texture.source = job.previews.get(texture)!; texture.needsUpdate = true; }
            close(bitmap); if (previous) close(previous);
            job.loaded = undefined; job.state = job.attempts < 2 ? 'queued' : 'failed'; commit.resolve(false);
          }
        }
      }
      refreshReport(); nextFrame(); pump();
    });
  }
  function plan() {
    selected.clear();
    let bytes = 0;
    const budget = TEXTURE_BUDGETS[quality];
    const candidates = [...jobs.values()].filter(job => inUse(job)
      && (!job.original.tiers || distance(job) <= budget.radius)).sort((a, b) => priority(a) - priority(b));
    for (const job of candidates) {
      const cost = residentCost(job, desired(job));
      if (bytes + cost > budget.residentBytes) continue;
      selected.add(job); bytes += cost;
    }
    for (const job of jobs.values()) {
      if (!selected.has(job)) job.request?.abort();
      if (job.loaded && !job.restoring && (!selected.has(job) || residentCost(job, desired(job)) < job.loaded.bytes)) {
        job.restoring = true;
        commits.push({ job, epoch, resolve() {} });
      }
      if (selected.has(job) && job.loaded?.asset.url !== desired(job).url && job.state === 'done') job.state = 'queued';
    }
    refreshReport(); nextFrame();
  }
  async function load(job: ImageJob) {
    const version = epoch, asset = desired(job);
    job.state = 'loading'; ++job.attempts; ++report.active;
    const timeout = job.request = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 20_000);
    const abortRequest = () => timeout.abort(controller.signal.reason);
    controller.signal.addEventListener('abort', abortRequest, { once: true });
    try {
      const response = await request(asset.url, { signal: timeout.signal, credentials: 'same-origin', priority: 'low' });
      if (!response.ok) throw new Error(`Texture HTTP ${response.status}`);
      const blob = await response.blob();
      if (disposed || version !== epoch) return;
      const task = decoder.then(async () => {
        if (disposed || version !== epoch) return undefined;
        return decode(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      });
      decoder = task.catch(() => {});
      const bitmap = await task;
      if (!bitmap) return;
      if (disposed || version !== epoch) { close(bitmap); return; }
      ownedImages.add(bitmap);
      await new Promise<boolean>(resolve => { commits.push({ job, bitmap, asset, epoch: version, resolve }); nextFrame(); });
    } catch {
      if (!disposed && version === epoch) {
        if (!selected.has(job)) { job.state = 'queued'; job.attempts = 0; }
        else job.state = job.attempts < 2 ? 'queued' : 'failed';
      }
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abortRequest);
      if (job.request === timeout) job.request = undefined;
      if (!disposed && version !== epoch && job.state === 'loading') {
        job.state = job.loaded?.asset.url === desired(job).url ? 'done' : 'queued'; job.attempts = 0;
      }
      --report.active; refreshReport(); pump();
    }
  }
  function pump() {
    if (disposed || !started || !active) return;
    const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? TEXTURE_BUDGETS[quality].concurrency)));
    const pending = [...selected].filter(job => job.state === 'queued' && !job.restoring && inUse(job)).sort((a, b) => priority(a) - priority(b));
    while (report.active < concurrency && pending.length) void load(pending.shift()!);
    if (report.active === 0 && pending.length === 0 && commits.length === 0) finish();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; controller.abort(); options.signal?.removeEventListener('abort', dispose);
    for (const commit of commits.splice(0)) { if (commit.bitmap) close(commit.bitmap); commit.resolve(false); }
    for (const texture of allTextures) close(texture.source.data);
    for (const job of jobs.values()) for (const preview of job.previews.values()) close(preview.data);
    for (const bitmap of ownedImages) close(bitmap);
    ownedImages.clear(); finish();
  }
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return {
    report, finished,
    update(nextPosition, camera) {
      position.copy(nextPosition);
      const moved = plannedPosition.distanceToSquared(position) >= 16;
      const turned = Boolean(camera && (!hasCamera || Math.abs(cameraQuaternion.dot(camera.quaternion)) < .995));
      if (moved || turned) {
        plannedPosition.copy(position);
        if (camera) { camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection); cameraQuaternion.copy(camera.quaternion); hasCamera = true; }
        plan(); pump();
      }
    },
    start() { if (!disposed) { started = true; plan(); pump(); } },
    setActive(value) { active = value; if (value) { plan(); pump(); } },
    refresh() { if (!disposed) { plan(); pump(); } },
    setQuality(value) {
      if (disposed || quality === value) return;
      quality = value; report.quality = value; ++epoch;
      for (const commit of commits.splice(0)) { if (commit.bitmap) close(commit.bitmap); commit.job.restoring = false; commit.resolve(false); }
      for (const job of jobs.values()) { job.request?.abort(); if (job.state === 'failed') { job.state = 'queued'; job.attempts = 0; } }
      plan(); pump();
    },
    dispose,
  };
}
