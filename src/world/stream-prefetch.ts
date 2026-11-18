/** Bounded raw-byte prefetch. No decoded model/texture cache survives a lease. */
/** `data` is glTF JSON, or the untouched GLB bytes when the file carries everything it needs. */
export interface PrefetchedModel { data: string | ArrayBuffer; path: string; release(): void }
interface Bytes { data: ArrayBuffer; url: string; type: string; release(): void }
interface Entry<T> { priority?: number; refs: number; controller: AbortController; promise: Promise<T> }
interface Job { url: string; priority: number; signal: AbortSignal; run(): Promise<void>; cancel(): void }
const aborted = () => new DOMException('Aborted', 'AbortError');
export function createStreamPrefetch(options: { concurrency?: number; fetch?: typeof fetch } = {}) {
  const concurrency = options.concurrency ?? 10, request = options.fetch ?? fetch;
  if (!Number.isInteger(concurrency) || concurrency < 2 || concurrency > 16) throw new Error('Invalid prefetch concurrency');
  const bytes = new Map<string, Entry<Bytes>>(), models = new Map<string, Entry<PrefetchedModel>>(), queue: Job[] = [];
  let active = 0, visualActive = 0, disposed = false, downloadedBytes = 0;
  function pump() {
    queue.sort((a, b) => a.priority - b.priority);
    for (let index = 0; index < queue.length && active < concurrency;) {
      const job = queue[index];
      if (job.signal.aborted) { queue.splice(index, 1); job.cancel(); continue; }
      if (job.priority && visualActive >= concurrency - 1) { index++; continue; }
      queue.splice(index, 1); active++; if (job.priority) visualActive++;
      void job.run().finally(() => { active--; if (job.priority) visualActive--; pump(); });
    }
  }
  function network(url: string, signal: AbortSignal, priority: number): Promise<Bytes> {
    return new Promise((resolve, reject) => {
      const cancel = () => { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); reject(aborted()); };
      const job: Job = { url, priority, signal, cancel, async run() {
        signal.removeEventListener('abort', cancel);
        try {
          const response = await request(url, { signal });
          if (!response.ok) throw new Error(`Prefetch HTTP ${response.status}: ${url}`);
          const data = await response.arrayBuffer(); if (signal.aborted) throw aborted();
          downloadedBytes += data.byteLength;
          resolve({ data, url: response.url || url, type: response.headers.get('Content-Type') ?? '', release() {} });
        } catch (error) { reject(error); }
      } };
      if (disposed || signal.aborted) { reject(aborted()); return; }
      signal.addEventListener('abort', cancel, { once: true }); queue.push(job); pump();
    });
  }
  async function acquire<T extends { release(): void }>(cache: Map<string, Entry<T>>, key: string,
    signal: AbortSignal, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (disposed || signal.aborted) throw aborted();
    let entry = cache.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { refs: 0, controller, promise: Promise.resolve().then(() => load(controller.signal)) }; cache.set(key, entry);
    }
    entry.refs++;
    const owned = entry; let released = false;
    const release = () => {
      if (released) return; released = true; signal.removeEventListener('abort', release);
      if (--owned.refs === 0) {
        if (cache.get(key) === owned) cache.delete(key); owned.controller.abort();
        void owned.promise.then(value => value.release(), () => {});
      }
    };
    signal.addEventListener('abort', release, { once: true });
    try {
      const value = await owned.promise;
      if (disposed || signal.aborted || released) throw aborted();
      // A consumer parsing this data holds its lease until parse completes,
      // even if its own signal aborts midway through texture decoding.
      signal.removeEventListener('abort', release);
      return { ...value, release };
    } catch (error) { release(); throw error; }
  }
  function acquireBytes(url: string, signal: AbortSignal, priority: number) {
    const pending = acquire(bytes, url, signal, own => network(url, own, bytes.get(url)?.priority ?? priority));
    const entry = bytes.get(url);
    if (entry) entry.priority = Math.min(entry.priority ?? priority, priority);
    // A collision consumer may reuse a visual request that has not started.
    // Promote that same job so shared bytes can use the reserved physics slot.
    if (priority === 0) { const job = queue.find(job => job.url === url); if (job) { job.priority = 0; pump(); } }
    return pending;
  }
  async function model(url: string, geometryOnly: boolean, signal: AbortSignal): Promise<PrefetchedModel> {
    const leases: Bytes[] = [], urls: string[] = [];
    const release = () => { for (const lease of leases) lease.release(); for (const url of urls) URL.revokeObjectURL(url); };
    try {
      const root = await acquireBytes(url, signal, geometryOnly ? 0 : 1); leases.push(root);
      const path = new URL('.', root.url).href, data = new DataView(root.data); let json, binary: Uint8Array<ArrayBuffer> | undefined, glb = false;
      if (data.byteLength >= 12 && data.getUint32(0, true) === 0x46546c67) {
        if (data.getUint32(4, true) !== 2 || data.getUint32(8, true) !== data.byteLength) throw new Error('Invalid GLB header');
        glb = true;
        for (let offset = 12; offset + 8 <= data.byteLength;) {
          const length = data.getUint32(offset, true), kind = data.getUint32(offset + 4, true); offset += 8;
          if (offset + length > data.byteLength) throw new Error('Invalid GLB chunk');
          // Views, not copies: a street cell can be tens of megabytes, and this runs on the thread that draws.
          if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(root.data, offset, length)));
          else if (kind === 0x004e4942) binary = new Uint8Array(root.data, offset, length);
          offset += length;
        }
      } else json = JSON.parse(new TextDecoder().decode(root.data));
      if (!json?.asset || json.asset.version !== '2.0') throw new Error('Invalid glTF prefetch source');
      const blob = (data: BlobPart, type = 'application/octet-stream') => { const value = URL.createObjectURL(new Blob([data], { type })); urls.push(value); return value; };
      const resources = [...json.buffers ?? [], ...geometryOnly ? [] : json.images ?? []];
      // A binary file that refers to nothing outside itself needs no rewriting: the loader reads the
      // downloaded bytes as they are, without a second copy behind an object URL.
      const external = (resource: { uri?: unknown }) => typeof resource.uri === 'string' && !/^(data:|blob:)/.test(resource.uri);
      if (glb && !resources.some(external)) { if (signal.aborted) throw aborted(); return { data: root.data, path, release }; }
      if (binary && json.buffers?.[0] && !json.buffers[0].uri) json.buffers[0].uri = blob(binary);
      const results = await Promise.allSettled(resources.map(async resource => {
        if (typeof resource.uri !== 'string' || /^(data:|blob:)/.test(resource.uri)) return;
        const item = await acquireBytes(new URL(resource.uri, path).href, signal, geometryOnly ? 0 : 1); leases.push(item);
        resource.uri = blob(item.data, item.type || resource.mimeType);
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (signal.aborted) throw aborted();
      return { data: JSON.stringify(json), path, release };
    } catch (error) { release(); throw error; }
  }
  return {
    async json<T>(url: string, signal: AbortSignal): Promise<{ value: T; url: string }> {
      const item = await acquireBytes(url, signal, 0);
      try { return { value: JSON.parse(new TextDecoder().decode(item.data)), url: item.url }; } finally { item.release(); }
    },
    acquire(url: string, geometryOnly: boolean, signal: AbortSignal) {
      return acquire(models, `${geometryOnly ? 'collision' : 'visual'}:${url}`, signal, own => model(url, geometryOnly, own));
    },
    snapshot() { return { active, queued: queue.length, models: models.size, byteEntries: bytes.size, downloadedBytes }; },
    dispose() { if (disposed) return; disposed = true; for (const entry of [...models.values(), ...bytes.values()]) entry.controller.abort(); pump(); },
  };
}
