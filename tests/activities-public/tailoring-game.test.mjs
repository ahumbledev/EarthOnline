import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FABRICS, PATTERNS, INVENTORY_LIMIT,
  createTailoringState, configureDesign, startNewDesign,
  startCutting, traceCut, resetCurrentPiece, startSewing, advanceSewing,
  resetCurrentSeam, finishGarment, getRunView, getPatternPieces,
  pathLength, interpolatePath, pathPointAt, resamplePath,
  parseTailoringState, serializeTailoringState, restoreTailoringState,
  loadTailoringState, saveTailoringState, levelProgress,
} from '../../src/activities-public/tailoring/game.ts';

function cutAll(state) {
  if (state.stage === 'design') state = startCutting(state);
  for (const piece of getPatternPieces(state.design)) {
    for (const sample of resamplePath(piece.outline, .008)) state = traceCut(state, sample, 1 / 60);
  }
  assert.ok(getRunView(state).cutsComplete, 'every labelled cloth piece must be manually traced');
  return state;
}
function sewAll(state, steer = true, pedal) {
  state = startSewing(state);
  const fabric = FABRICS.find(f => f.id === state.design.fabric);
  for (let frame = 0; frame < 20000 && state.stage === 'sew'; frame++) {
    const view = getRunView(state);
    state = advanceSewing(state, {
      deltaSeconds: 1 / 30,
      pedal: pedal ?? fabric.idealPedal,
      steer: steer ? Math.max(-1, Math.min(1, -view.offset * 32)) : 0,
    });
  }
  assert.equal(state.stage, 'finish', 'all seams can be completed with pedal and hand steering');
  return state;
}

test('distance based geometry handles repeated vertices, end points and different fits without mutating patterns', () => {
  const path = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  assert.equal(pathLength(path), 2);
  assert.deepEqual(interpolatePath(path, 1.5), { x: 1, y: .5 });
  assert.deepEqual(pathPointAt(path, .75), { x: 1, y: .5 });
  assert.deepEqual(resamplePath(path, .5), [path[0], { x: .5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .5 }, path[3]]);
  const before = JSON.stringify(PATTERNS);
  const state = configureDesign(createTailoringState(), { fit: 'relaxed' });
  assert.notDeepEqual(getPatternPieces(state.design)[0].outline, PATTERNS[0].pieces[0].outline);
  assert.equal(JSON.stringify(PATTERNS), before);
  for (const pattern of PATTERNS) for (const piece of pattern.pieces) {
    assert.ok(piece.outline.length > 4);
    assert.deepEqual(piece.outline[0], piece.outline.at(-1));
    assert.ok(piece.seams.length >= 1);
  }
});

test('unworked pieces cannot be completed, later contour clicks cannot skip progress and redo preserves earlier work', () => {
  let state = startCutting(createTailoringState());
  assert.equal(startSewing(state), state);
  assert.equal(finishGarment(state), state);
  const piece = getRunView(state).piece;
  state = traceCut(state, piece.outline[0], .016);
  const before = state;
  for (let i = 0; i < 100; i++) state = traceCut(state, piece.outline[5], .016);
  assert.equal(state.run.cut.distance, 0, 'repeating a distant pointer click never grants progress');
  state = traceCut(state, pathPointAt(piece.outline, .003), .016);
  assert.ok(state.run.cut.distance > 0);
  assert.ok(state.run.cut.distance < pathLength(piece.outline) * .01);
  state = resetCurrentPiece(state);
  assert.equal(state.run.cut.distance, 0);
  assert.equal(state.run.cut.attempts, 2);
  assert.equal(before.run.cut.distance, 0, 'transitions do not mutate caller state');
  for (const p of resamplePath(piece.outline, .008)) state = traceCut(state, p, 1 / 60);
  assert.equal(state.run.cut.pieceIndex, 1);
  assert.equal(state.run.cut.results[0].attempts, 2);
  const completed = state.run.cut.results[0];
  state = resetCurrentPiece(state);
  assert.deepEqual(state.run.cut.results, [completed]);
  assert.equal(state.run.cut.pieceIndex, 1);
});

test('pedal, steering, fabric slip and speed materially affect machine sewing; paused frames never sew', () => {
  const cut = cutAll(configureDesign(createTailoringState(),{kind:'dress',fabric:'satin'}));
  let state = startSewing(cut);
  const before = state.run.sew.distance;
  state = advanceSewing(state, { deltaSeconds: 1000000, pedal: 0, steer: .5 });
  assert.equal(state.run.sew.distance, before);
  state = advanceSewing(state, { deltaSeconds: 1000000, pedal: 1, steer: 0 });
  assert.ok(state.run.sew.distance < .04, 'tab suspension cannot finish a seam');
  state = resetCurrentSeam(state);
  assert.equal(state.run.sew.distance, 0);
  assert.equal(state.run.sew.attempts, 2);
  const careful = sewAll(cut, true);
  const rushing = sewAll(cut, false, 1);
  const good = finishGarment(careful, 100000).inventory[0];
  const bad = finishGarment(rushing, 100000).inventory[0];
  assert.ok(good.sewScore > 85, `steady correction should give precise seams (${good.sewScore})`);
  assert.ok(bad.sewScore < good.sewScore - 25, `unsteered fast sewing must be visibly worse (${bad.sewScore})`);
});

test('all three garments complete a finite design → cut → sew → finish → wardrobe loop and award once', () => {
  for(const [kind,fabric] of [['tshirt','jersey'],['jeans','denim'],['dress','linen']]){
    const prepared=configureDesign(createTailoringState(),{kind,fabric});
    const sewn = sewAll(cutAll(prepared));
    assert.equal(sewn.inventory.length, 0);
    const finished = finishGarment(sewn, 1700000000000);
    assert.equal(finished.stage, 'wardrobe');
    assert.equal(finished.inventory.length, 1);
    const item = finished.inventory[0];
    assert.equal(item.descriptor.kind, prepared.design.kind);
    assert.equal(item.descriptor.fabric, prepared.design.fabric);
    assert.equal(item.descriptor.fit, prepared.design.fit);
    assert.ok(item.cutScore >= 98);
    assert.ok(item.descriptor.quality >= 88);
    assert.ok(finished.xp > 0);
    assert.equal(finishGarment(finished, 1700000000001), finished, 'repeated finish cannot duplicate garment or XP');
    const next = startNewDesign(finished);
    assert.equal(next.stage, 'design');
    assert.equal(next.run, null);
    assert.equal(next.inventory[0].id, item.id);
    assert.equal(next.xp, finished.xp);
    assert.deepEqual(parseTailoringState(serializeTailoringState(finished)), finished);
  }
});

test('scoped storage resumes the active contour and machine without awarding inventory early', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  let state = startCutting(createTailoringState());
  const points = resamplePath(getRunView(state).piece.outline, .008);
  for (const point of points.slice(0, 35)) state = traceCut(state, point, 1 / 60);
  assert.equal(saveTailoringState(storage, 'atelier:a', state), true);
  const resumed = loadTailoringState(storage, 'atelier:a');
  assert.deepEqual(resumed, state);
  assert.equal(loadTailoringState(storage, 'atelier:b').run, null);
  for (const point of points.slice(35)) state = traceCut(state, point, 1 / 60);
  assert.equal(state.run.cut.pieceIndex, 1);
  let sewing = startSewing(cutAll(createTailoringState()));
  for (let frame = 0; frame < 50; frame++) sewing = advanceSewing(sewing, { deltaSeconds: 1 / 60, pedal: .5, steer: -.1 });
  assert.equal(saveTailoringState(storage, 'atelier:a', sewing), true);
  assert.deepEqual(loadTailoringState(storage, 'atelier:a'), sewing);
  assert.equal(sewing.inventory.length, 0);
  assert.equal(saveTailoringState({ setItem() { throw new Error('quota'); } }, 'full', sewing), false);
  assert.deepEqual(loadTailoringState({ getItem() { throw new Error('blocked'); } }, 'blocked'), createTailoringState());
});

test('malformed numbers, forged stages, invalid enums and oversized saves cannot enter live state', () => {
  const valid = startCutting(createTailoringState());
  for (const mutate of [
    s => { s.xp = Infinity; },
    s => { s.xp = -1; },
    s => { s.design.fabric = 'unknown'; },
    s => { s.design.color = 'red'; },
    s => { s.run.cut.distance = NaN; },
    s => { s.run.cut.pieceIndex = 4; },
    s => { s.run.cut.distance = .3; s.run.cut.travelled = .3; },
    s => { s.run.sew.tension = 1.1; },
    s => { s.stage = 'finish'; },
    s => { s.stage = 'wardrobe'; },
    s => { s.lastFinishedId = 'missing'; },
    s => { s.run.cut.trace = Array.from({ length: 601 }, () => ({ x: .5, y: .5 })); },
    s => { s.inventory = new Array(INVENTORY_LIMIT + 1).fill({}); },
  ]) {
    const corrupted = structuredClone(valid); mutate(corrupted);
    assert.throws(() => parseTailoringState(corrupted));
    assert.deepEqual(restoreTailoringState(corrupted), createTailoringState());
  }
  assert.deepEqual(restoreTailoringState('{broken'), createTailoringState());
  assert.throws(() => parseTailoringState(' '.repeat(256 * 1024 + 1)), /too large/);
  assert.equal(traceCut(valid, { x: Infinity, y: .5 }, .016), valid);
  assert.equal(traceCut(valid, { x: .5, y: .5 }, NaN), valid);
});

test('every seam boundary, paused machine adjustment and finish stage survives durable reload', () => {
  let state = startSewing(cutAll(configureDesign(createTailoringState(),{kind:'jeans',fabric:'denim'})));
  let previousSeam = 0, boundaries = 0;
  for (let frame = 0; frame < 20000 && state.stage === 'sew'; frame++) {
    state = advanceSewing(state, { deltaSeconds: 1 / 30, pedal: .48, steer: -getRunView(state).offset * 30, tension: .64 });
    if (state.run.sew.seamIndex !== previousSeam) {
      previousSeam = state.run.sew.seamIndex; boundaries++;
      const serialized = serializeTailoringState(state);
      state = parseTailoringState(serialized);
      assert.equal(state.run.sew.tension, .64);
      assert.equal(state.run.sew.distance, 0);
      assert.equal(state.run.sew.trace.length, 0);
      assert.equal(state.run.sew.results.length, previousSeam);
      assert.equal(state.inventory.length, 0);
    }
  }
  assert.equal(state.stage, 'finish');
  assert.equal(boundaries, getRunView(state).seamCount);
  assert.deepEqual(restoreTailoringState(serializeTailoringState(state)), state);
  assert.equal(finishGarment(state, 1700000000000).inventory.length, 1);
});

test('wardrobe has a bounded durable history with unique ids and level progress stays finite', () => {
  const completed = sewAll(cutAll(createTailoringState()));
  let state = completed;
  for (let i = 0; i < INVENTORY_LIMIT + 8; i++) {
    state = finishGarment({ ...state, stage: 'finish', run: structuredClone(completed.run) }, 1700000000000);
  }
  assert.equal(state.inventory.length, INVENTORY_LIMIT);
  assert.equal(new Set(state.inventory.map(item => item.id)).size, INVENTORY_LIMIT);
  assert.deepEqual(parseTailoringState(serializeTailoringState(state)), state);
  const progress = levelProgress(state.xp);
  assert.ok(progress.level > 1);
  assert.ok(progress.progress >= 0 && progress.progress < 1);
});
