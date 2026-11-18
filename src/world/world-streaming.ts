import { createCellIndex } from './cell-index.ts';
/** Position-driven residency. Coordinates are in the existing common world;
 * this module never translates geometry or creates a substitute floor. */
export type WorldPoint = [number, number, number];
export interface WorldCell {
  id: string;
  bounds: { min: WorldPoint; max: WorldPoint };
  sceneUrl: string;
  hasCollision?: boolean;
  bootstrapVisual?: boolean; loadPriority?: number;
  hasVisualLod?: boolean;
  estimatedVisualBytes?: number;
  visualDependencies?: { url: string; bytes: number }[];
}
export interface WorldRegion {
  id: string; label: string; spawn: WorldPoint;
  bounds?: WorldCell['bounds'];
  overview?: { position: WorldPoint; target: WorldPoint };
  yaw?: number; pitch?: number; bootstrapVisualCellIds?: string[];
}
export interface WorldManifest {
  schemaVersion: number; cells: WorldCell[]; regions?: WorldRegion[];
  collisionLoadDistance?: number; collisionUnloadDistance?: number;
  visualLoadDistance?: number; visualUnloadDistance?: number;
  maxConcurrent?: number;
  maxPrefetch?: number;
  progressiveLoadDistance?: number; progressiveDelaySeconds?: number;
  progressiveIntervalSeconds?: number; progressiveStepDistance?: number;
}
export interface VisualViewDemand {
  candidates: { id: string; priority: number }[];
  maxCells?: number; maxBytes?: number;
  peripheralDistance?: number;
}
export interface Resident { release(): void; pinned?: boolean; ownsVisual?: boolean }
interface Hooks<F> {
  fragment(cell: WorldCell): Promise<F>;
  prefetch?(cell: WorldCell, fragment: F, signal: AbortSignal, kind: 'collision' | 'visual', distant: boolean): Promise<{ release(): void }>;
  collision(cell: WorldCell, fragment: F, signal: AbortSignal): Promise<Resident>;
  visual(cell: WorldCell, fragment: F, signal: AbortSignal, distant: boolean): Promise<Resident>;
  changed?(): void;
  now?: () => number;
}
type Kind = 'collision' | 'visual';
interface Slot { stage?: 'network' | 'ready' | 'prepare'; run?: () => void; distant?: boolean; pendingDistant?: boolean; value?: Resident; pending?: Promise<void>; abort?: AbortController; error?: string; retryAt: number }
interface State { order: number; cell: WorldCell; fragment?: Promise<unknown>; collision: Slot; visual: Slot; pinned: boolean }
export function cellDistance(cell: WorldCell, point: readonly number[]) {
  const { min, max } = cell.bounds;
  return Math.hypot(Math.max(min[0] - point[0], 0, point[0] - max[0]), Math.max(min[2] - point[2], 0, point[2] - max[2]));
}
export function validateWorldManifest(manifest: WorldManifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cells) || !manifest.cells.length) throw new Error('Unsupported or empty world manifest');
  const ids = new Set<string>(), urls = new Set<string>();
  for (const cell of manifest.cells) {
    if (!cell.id || ids.has(cell.id) || !cell.sceneUrl || urls.has(cell.sceneUrl)) throw new Error(`Duplicate or missing world cell: ${cell.id}`);
    ids.add(cell.id); urls.add(cell.sceneUrl);
    if (cell.estimatedVisualBytes !== undefined && (!Number.isFinite(cell.estimatedVisualBytes) || cell.estimatedVisualBytes < 0) || cell.visualDependencies?.some(d => !d.url || !Number.isFinite(d.bytes) || d.bytes < 0)) throw new Error(`Invalid visual byte metadata: ${cell.id}`);
    const { min, max } = cell.bounds ?? {};
    if (!min || !max || min.length !== 3 || max.length !== 3 || ![...min, ...max].every(Number.isFinite) || min.some((x, i) => x > max[i])) throw new Error(`Invalid world bounds: ${cell.id}`);
  }
}
/** Share in-flight loads, but never retain a rejected request as a permanent cache entry. */
export function cachedLoad<T>(cache:Map<string,Promise<T>>,key:string,load:()=>Promise<T>):Promise<T>{
  const previous=cache.get(key);if(previous)return previous;
  const pending=Promise.resolve().then(load).catch(error=>{if(cache.get(key)===pending)cache.delete(key);throw error;});
  cache.set(key,pending);return pending;
}
export function createWorldStreaming<F>(manifest: WorldManifest, hooks: Hooks<F>) {
  validateWorldManifest(manifest);
  const collisionLoad = manifest.collisionLoadDistance ?? 85, collisionUnload = manifest.collisionUnloadDistance ?? 160;
  const visualLoad = manifest.visualLoadDistance ?? 300, visualUnload = manifest.visualUnloadDistance ?? 420;
  if (![collisionLoad, collisionUnload, visualLoad, visualUnload].every(x => Number.isFinite(x) && x > 0) || collisionUnload <= collisionLoad || visualUnload <= visualLoad) throw new Error('Streaming unload distances must exceed positive load distances');
  const configuredLimit = manifest.maxConcurrent ?? 4;
  const limit = Math.min(4, configuredLimit);
  const networkLimit = hooks.prefetch ? manifest.maxPrefetch ?? 10 : limit;
  if (!Number.isInteger(configuredLimit) || configuredLimit < 2 || configuredLimit > 16) throw new Error('Streaming requires 2–16 concurrent slots so collision always has a reserved slot');
  if (!Number.isInteger(networkLimit) || networkLimit < 2 || networkLimit > 16) throw new Error('Invalid prefetch queue limit');
  const states: State[] = manifest.cells.map((cell, order) => ({ cell, order, collision: { retryAt: 0 }, visual: { retryAt: 0 }, pinned: false }));
  const byCell = new Map(states.map(state => [state.cell, state]));
  const byId = new Map(states.map(state => [state.cell.id, state]));
  const visualIndex = createCellIndex(manifest.cells);
  const collisionIndex = createCellIndex(manifest.cells.filter(cell => cell.hasCollision !== false));
  const tracked = new Set<State>(); // Owns a resident or has a load in flight.
  const failedStates = new Set<State>(); // Keep errors visible after their street leaves the neighbourhood.
  const manifestOrder = (a: State, b: State) => a.order - b.order;
  const now = hooks.now ?? (() => performance.now());
  let physics: WorldPoint | undefined, view: WorldPoint | undefined, forced: WorldPoint | undefined, visualForced: WorldPoint | undefined, retained: WorldPoint | undefined, disposed = false, active = 0;
  let loads = 0, releases = 0, discarded = 0, activeNetwork = 0, activePrepare = 0;
  let visualForcedCells: Set<string> | undefined, firstUpdateAt: number | undefined;
  const requiredDistance = 8; // larger than the character radius and one running frame
  let neighbourhood: Set<State> | undefined;
  function nearbyStates() {
    if (neighbourhood) return neighbourhood;
    const result = new Set<State>();
    const include = (cells: WorldCell[]) => { for (const cell of cells) result.add(byCell.get(cell)!); };
    if (physics) include(collisionIndex(physics, collisionLoad));
    // Include the final radius here; wanted() still applies the time-dependent entry ramp.
    if (view) include(visualIndex(view, visualLoad));
    if (retained) include(collisionIndex(retained, requiredDistance));
    if (forced) include(collisionIndex(forced, requiredDistance));
    if (visualForcedCells) {
      for (const id of visualForcedCells) { const state = byId.get(id); if (state) result.add(state); }
    } else if (visualForced) include(visualIndex(visualForced, requiredDistance));
    neighbourhood = result;
    return result;
  }
  function samePosition(a?: WorldPoint, b?: WorldPoint) {
    return a?.[0] === b?.[0] && a?.[2] === b?.[2];
  }
  const progressiveMax = Math.max(visualLoad, manifest.progressiveLoadDistance ?? visualLoad);
  const progressiveDelay = Math.max(0, manifest.progressiveDelaySeconds ?? 4) * 1000;
  const progressiveInterval = Math.max(.25, manifest.progressiveIntervalSeconds ?? 2) * 1000;
  const progressiveStep = Math.max(1, manifest.progressiveStepDistance ?? 100);
  function warmAge() { return firstUpdateAt === undefined ? 0 : now()-firstUpdateAt; }
  function nearLoadDistance() { return Math.min(visualLoad, warmAge()<2000?60:warmAge()<6000?140:visualLoad); }
  function progressiveDistance() {
    if(firstUpdateAt===undefined||warmAge()<progressiveDelay)return 0;
    return Math.min(progressiveMax,visualLoad+Math.floor((warmAge()-progressiveDelay)/progressiveInterval)*progressiveStep);
  }
  let farCells = new Set<string>();
  let farBudget = { candidates: 0, selected: [] as string[], estimatedAdditionalBytes: 0, maxBytes: 160 * 1024 * 1024, maxCells: 64, excludedForBudget: 0 };
  function nearVisual(s: State) {
    return !!(visualForced && (visualForcedCells ? visualForcedCells.has(s.cell.id) : cellDistance(s.cell, visualForced) <= 8)) || distance(s, 'visual') <= (s.visual.value && !s.visual.distant ? visualUnload : nearLoadDistance());
  }
  function distant(s: State) { return !nearVisual(s) && farCells.has(s.cell.id); }
  function selectFar(demand?: VisualViewDemand) {
    const maxBytes = Math.min(160 * 1024 * 1024, Math.max(0, demand?.maxBytes ?? 160 * 1024 * 1024));
    const maxCells = Math.min(64, Math.max(0, demand?.maxCells ?? 64));
    farCells = new Set();
    const seen = new Set<string>();
    const dependencies = (s: State) => s.cell.visualDependencies?.length ? s.cell.visualDependencies : [{ url: s.cell.sceneUrl, bytes: s.cell.estimatedVisualBytes ?? 32 * 1024 * 1024 }];
    // The extra-view budget is declared file bytes, not decoded GPU memory.
    // Shared library/image URLs already needed locally are charged only once.
    const near = nearbyStates();
    const chargeNear = (s: State) => {
      if (nearVisual(s) || s.collision.value?.ownsVisual) for (const d of dependencies(s)) seen.add(d.url);
    };
    for (const s of near) chargeNear(s);
    for (const s of tracked) if (!near.has(s)) chargeNear(s);
    const candidates = new Map((demand?.candidates??[]).map(item=>[item.id,item]));
    const progressive = Math.min(progressiveDistance(), demand?.peripheralDistance ?? Infinity);
    if (view && progressive > visualLoad) for (const cell of visualIndex(view, progressive)) {
      if (!candidates.has(cell.id)) candidates.set(cell.id, { id: cell.id, priority: 1 / (1 + cellDistance(cell, view)) });
    }
    farBudget = { candidates: candidates.size, selected: [], estimatedAdditionalBytes: 0, maxBytes, maxCells, excludedForBudget: 0 };
    for (const candidate of [...candidates.values()].sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id))) {
      const s = byId.get(candidate.id);
      if (!s || nearVisual(s) || s.collision.value?.ownsVisual || farCells.has(s.cell.id)) continue;
      if (farCells.size >= maxCells) { farBudget.excludedForBudget++; continue; }
      const unique = new Map(dependencies(s).map(d => [d.url, d.bytes]));
      const bytes = [...unique].reduce((sum,[url,n]) => sum + (seen.has(url) ? 0 : n), 0);
      if (farBudget.estimatedAdditionalBytes + bytes > maxBytes) { farBudget.excludedForBudget++; continue; }
      farCells.add(s.cell.id); farBudget.selected.push(s.cell.id); farBudget.estimatedAdditionalBytes += bytes;
      for (const url of unique.keys()) seen.add(url);
    }
  }
  const waiters = new Set<() => void>();
  function changed() { hooks.changed?.(); for (const wake of waiters) wake(); waiters.clear(); }
  function distance(s: State, kind: Kind) {
    const point = kind === 'collision' ? physics : view;
    return point ? cellDistance(s.cell, point) : Infinity;
  }
  function wanted(s: State, kind: Kind) {
    if (kind === 'collision') {
      if (s.cell.hasCollision === false) return false;
      return s.pinned || (retained && cellDistance(s.cell,retained)<=requiredDistance) || (forced && cellDistance(s.cell, forced) <= requiredDistance) || distance(s, kind) <= (s[kind].value ? collisionUnload : collisionLoad);
    }
    return !s.collision.value?.ownsVisual && (nearVisual(s) || farCells.has(s.cell.id));
  }
  function release(slot: Slot) { if (slot.value) { slot.value.release(); slot.value = undefined; releases++; } }
  function forgetInactive(s: State) {
    if (!s.collision.value && !s.visual.value && !s.collision.pending && !s.visual.pending) tracked.delete(s);
  }
  function start(s: State, kind: Kind) {
    tracked.add(s);
    const slot = s[kind], controller = new AbortController(); slot.abort = controller; const requestedDistant = kind === 'visual' && distant(s); slot.pendingDistant = requestedDistant; slot.stage = 'network'; active++; activeNetwork++; loads++;
    slot.pending = (async () => {
      let value: Resident | undefined, prefetched: { release(): void } | undefined, preparing = false, networking = true;
      try {
        s.fragment ??= hooks.fragment(s.cell).catch(error => { s.fragment = undefined; throw error; });
        const fragment = await s.fragment as F;
        if (controller.signal.aborted) return;
        prefetched = await hooks.prefetch?.(s.cell, fragment, controller.signal, kind, requestedDistant);
        activeNetwork--; networking = false;
        if (controller.signal.aborted) return;
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { slot.run = undefined; reject(new DOMException('Aborted', 'AbortError')); };
          controller.signal.addEventListener('abort', cancel, { once: true });
          slot.stage = 'ready'; slot.run = () => {
            controller.signal.removeEventListener('abort', cancel); slot.run = undefined;
            slot.stage = 'prepare'; activePrepare++; preparing = true; resolve();
          };
          pump();
        });
        if (controller.signal.aborted) return;
        value = kind === 'visual' ? await hooks.visual(s.cell, fragment, controller.signal, requestedDistant) : await hooks.collision(s.cell, fragment, controller.signal);
        if (disposed || controller.signal.aborted || !wanted(s, kind) || kind === 'visual' && requestedDistant !== distant(s)) { value.release(); value = undefined; discarded++; return; }
        release(slot); slot.distant = requestedDistant; slot.value = value; if(kind==='collision'&&value.pinned)s.pinned=true; if(kind==='collision'&&value.ownsVisual){s.visual.error=undefined;s.visual.retryAt=0;} value = undefined; slot.error = undefined; slot.retryAt = 0;
      } catch (error) {
        value?.release();
        if (!controller.signal.aborted && !disposed) { slot.error = error instanceof Error ? error.message : String(error); slot.retryAt = now() + 3000; }
      } finally {
        prefetched?.release();
        if (networking) activeNetwork--;
        if (preparing) activePrepare--;
        active--; slot.stage = undefined; slot.run = undefined; slot.pending = undefined; slot.abort = undefined; slot.pendingDistant = undefined;
        if (s.collision.error || s.visual.error) failedStates.add(s); else failedStates.delete(s);
        forgetInactive(s);
        changed(); if (!disposed) pump();
      }
    })();
  }
  function pump() {
    if (disposed) return;
    // Old residents and in-flight work must still be visited after a jump outside the index query.
    const candidates = new Set(nearbyStates());
    for (const s of tracked) candidates.add(s);
    for (const id of farCells) candidates.add(byId.get(id)!);
    const live: State[] = [];
    for (const s of [...candidates].sort(manifestOrder)) {
      let relevant = false;
      for (const kind of ['collision', 'visual'] as const) {
        if (wanted(s, kind)) relevant = true; else { s[kind].abort?.abort(); release(s[kind]); }
        if (s[kind].value || s[kind].pending || s[kind].run) relevant = true;
      }
      if (relevant) live.push(s);
      forgetInactive(s);
    }
    for (const s of live) if (s.visual.pending && s.visual.pendingDistant !== distant(s)) s.visual.abort?.abort();
    const priority = (s: State, kind: Kind) => kind === 'collision' ? 0 :
      visualForcedCells?.has(s.cell.id) ? 1 : distant(s) ? 5 : 2 + (s.cell.loadPriority ?? 2) / 10;
    const compare = (a: { s: State; kind: Kind }, b: { s: State; kind: Kind }) => priority(a.s,a.kind)-priority(b.s,b.kind)||distance(a.s,a.kind)-distance(b.s,b.kind);
    const ready = live.flatMap(s => (['collision','visual'] as const).filter(kind => s[kind].run && !s[kind].abort?.signal.aborted).map(kind=>({s,kind}))).sort(compare);
    for (const {s,kind} of ready) {
      if (activePrepare >= limit) break;
      const visualCount = live.filter(item=>item.visual.stage==='prepare').length;
      if (kind==='visual' && !visualForcedCells?.has(s.cell.id) && visualCount >= limit-1) continue;
      if (kind==='visual' && distant(s) && visualCount) continue;
      s[kind].run?.();
    }
    const queue = live.flatMap(s => (['collision', 'visual'] as const).filter(kind => wanted(s, kind) && (!s[kind].value || kind === 'visual' && s.visual.distant !== distant(s)) && !s[kind].pending && s[kind].retryAt <= now()).map(kind => ({ s, kind }))).sort(compare);
    for (const item of queue) {
      if (activeNetwork >= networkLimit || active >= (hooks.prefetch ? networkLimit + limit : limit)) break;
      // Both queues reserve capacity for collision. A queued prepared visual
      // cannot take the physics slot while its network stage is already free.
      const visualCount = live.filter(s=>s.visual.pending).length;
      if(item.kind==='visual'&&!visualForcedCells?.has(item.s.cell.id)&&live.filter(s=>s.visual.stage==='network').length>=networkLimit-1)continue;
      if(item.kind==='visual'&&!visualForcedCells?.has(item.s.cell.id)&&visualCount >= (hooks.prefetch ? networkLimit+limit-1 : limit-1)) continue;
      if(item.kind==='visual'&&distant(item.s)&&(live.some(s=>s.visual.pending)||queue.some(other=>other.kind==='visual'&&!distant(other.s)&&!other.s.visual.value)))continue;
      start(item.s,item.kind);
    }
  }
  function required(point: WorldPoint) { return collisionIndex(point, requiredDistance).map(cell => byCell.get(cell)!); }
  return {
    maxVisualDistance: progressiveMax,
    progressiveVisualDistance: progressiveDistance,
    update(position: WorldPoint, visualPosition: WorldPoint, retainedPosition?: WorldPoint, demand?: VisualViewDemand) {
      if (!samePosition(physics, position) || !samePosition(view, visualPosition) || !samePosition(retained, retainedPosition)) neighbourhood = undefined;
      firstUpdateAt ??= now(); physics = [...position]; view = [...visualPosition]; retained = retainedPosition ? [...retainedPosition] : undefined; selectFar(demand); pump();
    },
    canEnter(point: WorldPoint) { const cells = required(point); return cells.length > 0 && cells.every(s => !!s.collision.value); },
    /** Ids of collision-bearing cells within `distance` of a point, so per-frame
     * probes test a few cells' proxies instead of every resident collider. */
    visualCellsNear(point: WorldPoint, distance = requiredDistance) { return visualIndex(point,distance).map(cell=>cell.id); },
    collisionCellsNear(point: WorldPoint, distance = requiredDistance) { return collisionIndex(point, distance).map(cell => cell.id); },
    // Keep the destination floor resident while entrance visuals load. The
    // callback commits navigation and updates streaming anchors before returning.
    async ensureCollision(point: WorldPoint, enter?: () => void | Promise<void>) {
      if (disposed) throw new Error('World streaming disposed');
      if (forced) throw new Error('Another collision destination is still loading');
      forced = [...point]; neighbourhood = undefined;
      try {
        const cells = required(point);
        if (!cells.length) throw new Error('No authored collision coverage at this destination');
        for (;;) {
          pump();
          const failed = cells.find(s => s.collision.error && !s.collision.pending);
          if (failed) throw new Error(`${failed.cell.id}: ${failed.collision.error}`);
          if (cells.every(s => !!s.collision.value)) { await enter?.(); return; }
          if (disposed) throw new Error('World streaming disposed');
          await new Promise<void>(resolve => waiters.add(resolve));
        }
      } finally { forced = undefined; neighbourhood = undefined; }
    },
    async ensureVisual(point: WorldPoint, criticalCellIds?: string[]) {
      if(disposed)throw new Error('World streaming disposed');
      neighbourhood = undefined; visualForced=[...point];visualForcedCells=criticalCellIds?new Set(criticalCellIds):undefined;
      let complete=false;
      try{
        if(visualForcedCells)for(const id of visualForcedCells)if(!byId.has(id))throw new Error(`Unknown bootstrap visual: ${id}`);
        const cells = visualForcedCells ? [...visualForcedCells].map(id => byId.get(id)!).sort(manifestOrder)
          : visualIndex(point, requiredDistance).map(cell => byCell.get(cell)!);
        if(!cells.length)throw new Error('No declared visible ground covers the spawn');
        for(;;){
          pump();
          const failed=cells.find(s=>!s.collision.value?.ownsVisual&&s.visual.error&&!s.visual.pending);
          if(failed)throw new Error(`${failed.cell.id}: ${failed.visual.error}`);
          if(cells.every(s=>!!s.visual.value || s.collision.value?.ownsVisual)){complete=true;return;}
          if(disposed)throw new Error('World streaming disposed');
          await new Promise<void>(resolve=>waiters.add(resolve));
        }
      }finally{if(complete)view=[...point];visualForced=undefined;visualForcedCells=undefined;neighbourhood=undefined;}
    },
    /** The player core bakes its initial environment once. Pin only these small
     * spawn-neighbourhood colliders; all subsequent cells use dynamic IDs. */
    pinBootstrap() { for (const s of tracked) if (s.collision.value) s.pinned = true; },
    snapshot() {
      const working = [...tracked].sort(manifestOrder);
      return { cells: states.length, active, activeNetwork, activePrepare, preparedWaiting: working.filter(s=>s.collision.stage==='ready'||s.visual.stage==='ready').length, networkLimit, preparationLimit: limit, loads, releases, discarded, disposed, nearVisualDistance: nearLoadDistance(), progressiveVisualDistance: progressiveDistance(), distantVisuals: farBudget,
        collisionResident: working.filter(s => s.collision.value).length, visualResident: working.filter(s => s.visual.value || s.collision.value?.ownsVisual).length,
        loadedCells: working.filter(s => s.collision.value || s.visual.value).map(s => s.cell.id),
        loadingCells: working.filter(s => s.collision.pending || s.visual.pending).map(s => s.cell.id),
        errors: [...failedStates].sort(manifestOrder).flatMap(s => (['collision', 'visual'] as const).filter(k => s[k].error).map(k => ({ id: s.cell.id, kind: k, error: s[k].error }))),
        resident: working.filter(s => s.collision.value || s.visual.value).map(s => ({ id: s.cell.id, collision: !!s.collision.value, visual: !!s.visual.value || !!s.collision.value?.ownsVisual, interactiveVisual: !!s.collision.value?.ownsVisual, distant: !!s.visual.distant, pinned: s.pinned })) };
    },
    /** Entry loading: drop the closest-first warm-up ramp, so the whole near view is asked for at once. */
    warm() { firstUpdateAt = now() - 6000; },
    /** Entry loading: cells the near view still lacks. A cell that failed and is waiting to retry is not counted. */
    nearOutstanding() {
      let count = 0;
      for (const s of nearbyStates()) {
        if (wanted(s, 'collision') && !s.collision.value && (s.collision.pending || !s.collision.error)) count++;
        if (!s.collision.value?.ownsVisual && nearVisual(s) && !(s.visual.value && !s.visual.distant) && (s.visual.pending || !s.visual.error)) count++;
      }
      return count;
    },
    async whenIdle() { while (active) await new Promise<void>(resolve => waiters.add(resolve)); },
    dispose() { if (disposed) return; disposed = true; for (const s of [...tracked].sort(manifestOrder)) for (const k of ['collision', 'visual'] as const) { s[k].abort?.abort(); release(s[k]); } changed(); },
  };
}
