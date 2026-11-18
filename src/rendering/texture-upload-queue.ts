export interface TextureUploadFrameRunner {
  requestFrame(callback: () => void): unknown;
  cancelFrame?(handle: unknown): void;
}
export type TextureUploadScheduler = (callback: () => void, signal?: AbortSignal) => Promise<void>;

interface UploadTask {
  callback(): void;
  signal?: AbortSignal;
  resolve(): void;
  reject(reason: unknown): void;
  detach(): void;
}
type FrameHandle = { animation: number } | { timer: ReturnType<typeof setTimeout> };
const defaultFrames: TextureUploadFrameRunner = {
  requestFrame(callback): FrameHandle {
    return typeof requestAnimationFrame === 'function'
      ? { animation: requestAnimationFrame(callback) }
      : { timer: setTimeout(callback, 16) };
  },
  cancelFrame(value) {
    const handle = value as FrameHandle;
    if ('animation' in handle) cancelAnimationFrame(handle.animation);
    else clearTimeout(handle.timer);
  },
};

/** Inject a frame runner for deterministic tests; production shares one queue. */
export function createTextureUploadQueue(frames: TextureUploadFrameRunner = defaultFrames) {
  const tasks: UploadTask[] = [];
  let framePending = false;
  let frameToken = 0;
  let handle: unknown;
  function arm() {
    if (framePending || !tasks.length) return;
    framePending = true;
    const token = ++frameToken;
    try { handle = frames.requestFrame(() => { if (token === frameToken) run(); }); }
    catch (error) {
      framePending = false;
      for (const task of tasks.splice(0)) { task.detach(); task.reject(error); }
    }
  }
  function run() {
    framePending = false; handle = undefined;
    const task = tasks.shift();
    if (!task) return;
    task.detach();
    try {
      task.signal?.throwIfAborted();
      task.callback(); task.resolve();
    } catch (error) { task.reject(error); }
    finally { arm(); }
  }
  const schedule: TextureUploadScheduler = (callback, signal) => {
    const pending = new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const task: UploadTask = { callback, signal, resolve, reject, detach: () => signal?.removeEventListener('abort', abort) };
      function abort() {
        const index = tasks.indexOf(task);
        if (index < 0) return;
        tasks.splice(index, 1); task.detach(); reject(signal?.reason);
        if (!tasks.length && framePending) {
          frames.cancelFrame?.(handle); ++frameToken; framePending = false; handle = undefined;
        }
      }
      tasks.push(task); signal?.addEventListener('abort', abort, { once: true }); arm();
    });
    // Fire-and-forget consumers are safe too. Awaiting consumers still receive
    // their own rejection; one failed upload never poisons another task.
    void pending.catch(() => {});
    return pending;
  };
  return { schedule, get pending() { return tasks.length; } };
}

const shared = createTextureUploadQueue();
/** Every importer in this window shares one FIFO and at most one upload/frame. */
export const scheduleTextureUpload: TextureUploadScheduler = (callback, signal) => shared.schedule(callback, signal);
