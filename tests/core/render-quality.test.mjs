import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityGovernor, renderQuality, normalizeQuality } from '../../src/game/quality.ts';

test('physical pixel budgets cap 4K and retina without lowering CSS UI resolution', () => {
  for (const [level, limit] of [['low',1050000],['balanced',2100000],['high',4200000]]) {
    for (const [w,h,dpr] of [[1920,1080,2],[3840,2160,2],[1280,720,1]]) {
      const policy=renderQuality(level,w,h,dpr);
      assert.ok(w*h*policy.pixelRatio**2<=limit+1);
      assert.ok(policy.pixelRatio<=dpr);
    }
  }
  const before=1920*1080*1.75**2, after=1920*1080*renderQuality('balanced',1920,1080,2).pixelRatio**2;
  assert.ok(after<before*.34, 'real old full-HD DPR workload falls by at least 66%');
});
test('automatic policy ignores isolated stalls/loading and needs sustained pressure',()=>{
  const g=createQualityGovernor();
  for(let i=0;i<120;i++)g.sample(16.7,5);
  assert.equal(g.scale,1);
  for(let i=0;i<180;i++)g.sample(i===45?120:16.7,3);
  assert.equal(g.scale,1);
  assert.equal(g.sample(1000,600),false);
  // Restart the sample window as a scene handover does.
  g.resetSampling();
  for(let i=0;i<61;i++)g.sample(33.3,3);
  for(let i=0;i<91;i++)g.sample(33.3,3);
  assert.equal(g.scale,1);
  assert.equal(g.sample(33.3,3),true);
  assert.equal(g.scale,.9);
});
// Sustained overload steps down without any failed retry, so once the load drops the
// floor is left at the next 8-window boundary; retries that fail are covered below.
test('automatic adaptation has a resolution floor and bounded slow recovery',()=>{
  const g=createQualityGovernor();
  for(let i=0;i<1800;i++)g.sample(34,4);
  assert.equal(g.level,'low'); assert.equal(g.scale,.7);
  g.resetSampling();
  for(let i=0;i<120;i++)g.sample(16.7,3);
  for(let i=0;i<700;i++)g.sample(16.7,3);
  assert.equal(g.scale,.7);
  for(let i=0;i<100;i++)g.sample(16.7,3);
  assert.equal(g.scale,.75);
});
test('manual high stays selected under load and resuming clears stale samples',()=>{
  const g=createQualityGovernor('high');
  for(let i=0;i<500;i++)g.sample(50,25);
  assert.equal(g.level,'high');assert.equal(g.scale,1);
  g.setPreference('auto');
  for(let i=0;i<80;i++)g.sample(40,3);
  g.resetSampling();
  for(let i=0;i<250;i++)g.sample(16.7,3);
  assert.equal(g.scale,1);
  assert.equal(normalizeQuality('ultra'),'auto');
});
test('severe low FPS gets a useful fallback within four seconds instead of waiting for 120 slow frames',()=>{
  const g=createQualityGovernor();
  for(let i=0;i<60;i++)g.sample(66.7,12);
  assert.equal(g.level,'low');
  assert.equal(g.scale,.85);
});
function drive(g, frame, seconds, changes = [], start = 0) {
  let t = start;
  while (t < start + seconds * 1000) { const dt = frame(g, t); t += dt; if (g.sample(dt, 3)) changes.push({ t, scale: g.scale, level: g.level }); }
  return changes;
}
// 60Hz vsync without VRR: a device that misses the frame above 0.82 scale.
const vsyncNearBudget = g => g.scale > .82 ? 33.3 : 16.7;
test('a vsync-quantized device near budget settles instead of pumping between two scales', () => {
  const g = createQualityGovernor();
  const changes = drive(g, vsyncNearBudget, 1200);
  assert.ok(changes.length <= 14, `${changes.length} quality changes in 20 minutes`);
  assert.ok(changes.filter(change => change.t > 600_000).length <= 2, 'retries of a failed scale back off');
  assert.ok(changes.every(change => change.scale >= .8), 'a failed retry returns to the last good scale');
  const gaps = changes.filter(change => change.scale === .85).map(change => change.t).map((t, i, all) => i ? t - all[i - 1] : 0).slice(1);
  assert.ok(gaps.every((gap, i) => i === 0 || gap > gaps[i - 1]), 'each failed retry waits longer than the last');
  assert.equal(g.scale, .8); assert.equal(g.level, 'balanced');
});
test('a device whose load drops retries the failed scale after the backoff and recovers fully', () => {
  const g = createQualityGovernor();
  const changes = drive(g, (gov, t) => t < 60_000 ? vsyncNearBudget(gov) : 16.7, 180);
  assert.equal(g.scale, 1);
  assert.ok(changes.at(-1).t < 120_000, 'recovery starts once the backoff has passed');
});
test('a new scene forgets failed scales while ordinary pauses keep them', () => {
  const settle = () => { const g = createQualityGovernor(); drive(g, vsyncNearBudget, 30); assert.equal(g.scale, .8); return g; };
  const paused = settle();
  paused.resetSampling();
  assert.equal(drive(paused, () => 16.7, 15).length, 0, 'a scrub or panel pause does not reset the backoff');
  const moved = settle();
  moved.resetSampling({ newWorkload: true });
  assert.deepEqual(drive(moved, () => 16.7, 15).map(change => change.scale), [.85]);
});
test('after a short overload ends, recovery starts at the next boundary instead of waiting out a backoff', () => {
  const g = createQualityGovernor();
  for (let i = 0; i < 700; i++) g.sample(34, 4);
  assert.equal(g.level, 'low'); assert.equal(g.scale, .7);
  g.resetSampling();
  const changes = drive(g, () => 16.7, 20, [], 23_800);
  assert.equal(changes[0]?.scale, .75);
  assert.ok(changes[0].t < 23_800 + 15_000, `left the floor ${changes[0].t - 23_800} ms after the load dropped`);
});
test('isolated hitches at full scale recover after the base backoff every time', () => {
  const g = createQualityGovernor();
  const hitch = (_gov, t) => t % 600_000 > 300_000 && t % 600_000 < 303_500 ? 33.3 : 16.7;
  const changes = drive(g, hitch, 2400);
  const recoveries = changes.filter(change => change.scale === 1).map(change => change.t);
  assert.equal(recoveries.length, 4, 'every hitch is followed by a return to full scale');
  for (const [i, t] of recoveries.entries()) assert.ok(t - (300_000 + i * 600_000) < 75_000, `recovery ${i} took ${t - (300_000 + i * 600_000)} ms`);
});
test('a hitch at the good scale keeps the backoff of the higher scale that failed', () => {
  const g = createQualityGovernor();
  const changes = drive(g, (gov, t) => t % 150_000 > 140_000 && t % 150_000 < 143_500 ? 33.3 : vsyncNearBudget(gov), 1200);
  assert.ok(changes.length <= 40, `${changes.length} quality changes in 20 minutes`);
  const retries = changes.filter((change, i) => change.scale === .85 && changes[i - 1]?.scale === .8).map(change => change.t);
  for (let i = 1; i < retries.length; i++) assert.ok(retries[i] - retries[i - 1] > 40_000, 'a failed scale is never retried straight away');
});

test('a frame held up by script goes straight to the low tier at full resolution; a GPU-bound frame lowers resolution first', () => {
  const run = cpuMs => { const g = createQualityGovernor(); let changed = false; for (let i = 0; i < 400 && !changed; i++) changed = g.sample(30, cpuMs); return g; };
  // 24 of 30 ms in the frame callback: fewer pixels cannot help.
  const cpuBound = run(24);
  assert.equal(cpuBound.level, 'low'); assert.equal(cpuBound.scale, 1);
  // 3 of 30 ms in script: the GPU is the limit, so resolution drops and effects stay.
  const gpuBound = run(3);
  assert.equal(gpuBound.level, 'balanced'); assert.equal(gpuBound.scale, .9);
  // Three seconds of someone else's CPU spike is not enough to give up the effects, and resolution is left alone meanwhile.
  const spike = createQualityGovernor();
  for (let i = 0; i < 70 + 3 * 50; i++) spike.sample(30, 24);
  for (let i = 0; i < 400; i++) spike.sample(16.7, 4);
  assert.equal(spike.level, 'balanced'); assert.equal(spike.scale, 1);
  const manual = createQualityGovernor('high');
  for (let i = 0; i < 400; i++) manual.sample(30, 24);
  assert.equal(manual.level, 'high', 'a chosen tier is never overridden');
});
test('lower tiers draw less, not only fewer pixels', () => {
  const low = renderQuality('low', 1600, 900, 1), balanced = renderQuality('balanced', 1600, 900, 1), high = renderQuality('high', 1600, 900, 1);
  assert.ok(low.detailDistance < balanced.detailDistance && balanced.detailDistance < high.detailDistance);
  assert.ok(low.shadowMovingHz < balanced.shadowMovingHz && balanced.shadowMovingHz <= high.shadowMovingHz);
  assert.ok(low.volumeLights < balanced.volumeLights && balanced.volumeLights < high.volumeLights);
  assert.equal(low.reflectionSteps, 0, 'no wet-street reflection pass on the low tier');
  assert.ok(low.sceneSamples < balanced.sceneSamples);
  for (const quality of [low, balanced, high]) assert.ok(quality.shadowMovingHz >= quality.shadowHz, 'a moving caster never refreshes shadows less often than a still scene');
});
