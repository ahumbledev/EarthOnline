import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureUploadQueue } from '../../src/rendering/texture-upload-queue.ts';

function clock({ cancellable = true } = {}) {
  let identity = 0, frame = 0, cancelled = 0;
  const callbacks = new Map();
  const runner = { requestFrame(callback) { callbacks.set(++identity, callback); return identity; } };
  if (cancellable) runner.cancelFrame = handle => { callbacks.delete(handle); ++cancelled; };
  return {
    runner,
    get frame() { return frame; }, get scheduled() { return callbacks.size; }, get cancelled() { return cancelled; },
    advance() { ++frame; const current = [...callbacks.values()]; callbacks.clear(); for (const callback of current) callback(); },
  };
}

test('two independent consumers share one FIFO upload callback per real scheduled frame', async () => {
  const frames = clock(), queue = createTextureUploadQueue(frames.runner), events = [];
  const realism = name => queue.schedule(() => events.push({ consumer: 'realism', name, frame: frames.frame }));
  const progressive = name => queue.schedule(() => events.push({ consumer: 'progressive', name, frame: frames.frame }));
  const pending = [realism('floor'), progressive('street'), realism('wall'), progressive('sign')];
  assert.equal(queue.pending, 4); assert.equal(frames.scheduled, 1); assert.equal(events.length, 0);
  for (let index = 0; index < pending.length; ++index) {
    frames.advance(); assert.equal(events.length, index + 1, 'a frame executes one callback across both callers');
    assert.equal(frames.scheduled, index === pending.length - 1 ? 0 : 1);
  }
  await Promise.all(pending);
  assert.deepEqual(events.map(event => event.name), ['floor', 'street', 'wall', 'sign']);
  assert.equal(new Set(events.map(event => event.frame)).size, 4); assert.equal(queue.pending, 0);
});

test('a callback exception rejects only its own task and never starves later consumers', async () => {
  const frames = clock(), queue = createTextureUploadQueue(frames.runner), events = [];
  const failing = queue.schedule(() => { events.push('failed'); throw new Error('upload failed'); });
  const accepted = queue.schedule(() => events.push('next-consumer'));
  frames.advance(); await assert.rejects(failing, /upload failed/);
  assert.deepEqual(events, ['failed']); assert.equal(frames.scheduled, 1);
  frames.advance(); await accepted; assert.deepEqual(events, ['failed', 'next-consumer']);
});

test('aborting one caller removes its pending callback without consuming another caller frame', async () => {
  const frames = clock(), queue = createTextureUploadQueue(frames.runner), abort = new AbortController(), events = [];
  const cancelled = queue.schedule(() => events.push('must-not-upload'), abort.signal);
  const sibling = queue.schedule(() => events.push('still-upload'));
  abort.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(queue.pending, 1); assert.equal(frames.scheduled, 1);
  frames.advance(); await sibling; assert.deepEqual(events, ['still-upload']);
});

test('an empty cancelled queue releases its scheduled frame and can accept future uploads', async () => {
  const frames = clock(), queue = createTextureUploadQueue(frames.runner), abort = new AbortController();
  const cancelled = queue.schedule(() => assert.fail('aborted upload executed'), abort.signal);
  abort.abort(); await assert.rejects(cancelled); assert.equal(frames.cancelled, 1); assert.equal(frames.scheduled, 0);
  let uploaded = false;
  const next = queue.schedule(() => { uploaded = true; }); frames.advance(); await next;
  assert.equal(uploaded, true); assert.equal(queue.pending, 0);
});

test('stale callbacks are inert even with a frame runner that cannot physically cancel a frame', async () => {
  const frames = clock({ cancellable: false }), queue = createTextureUploadQueue(frames.runner), abort = new AbortController(), events = [];
  const cancelled = queue.schedule(() => events.push('cancelled'), abort.signal);
  abort.abort(); await assert.rejects(cancelled);
  const pending = [queue.schedule(() => events.push('next-a')), queue.schedule(() => events.push('next-b'))];
  frames.advance(); assert.deepEqual(events, ['next-a'], 'the stale request cannot drain a second callback in the same frame');
  frames.advance(); await Promise.all(pending); assert.deepEqual(events, ['next-a', 'next-b']);
});

test('work queued from inside an upload waits for a later frame', async () => {
  const frames = clock(), queue = createTextureUploadQueue(frames.runner), events = [];
  let child;
  const parent = queue.schedule(() => { events.push('parent'); child = queue.schedule(() => events.push('child')); });
  frames.advance(); await parent; assert.deepEqual(events, ['parent']);
  frames.advance(); await child; assert.deepEqual(events, ['parent', 'child']);
});

test('the Node fallback schedules asynchronously without installing browser globals', async () => {
  const previous = globalThis.requestAnimationFrame;
  assert.equal(previous, undefined);
  const queue = createTextureUploadQueue(); let uploaded = false;
  const pending = queue.schedule(() => { uploaded = true; });
  assert.equal(uploaded, false); await pending; assert.equal(uploaded, true);
  assert.equal(globalThis.requestAnimationFrame, previous);
});
