import test from 'node:test';
import assert from 'node:assert/strict';
import { createKitchenSimulation, RECIPES, FOOD_KINDS, FOOD_PORTIONS } from '../../src/activities-public/kitchen/simulation.ts';

// Independent expected meals, used to play the kitchen rather than synthesizing results or editing state.
const MEALS = [
  ['tomato-soup', [['tomato', 2, 'boiled', true]], true],
  ['boiled-potato', [['potato', 2, 'boiled', false]], false],
  ['carrot-soup', [['carrot', 2, 'boiled', true]], true],
  ['pan-mushroom', [['mushroom', 2, 'fried', false]], false],
  ['potato-tomato-soup', [['potato', 1, 'boiled', true], ['tomato', 1, 'boiled', true]], true],
  ['salmon-potato', [['salmon', 1, 'fried', false], ['potato', 1, 'boiled', false]], false],
  ['tomato-mushroom-soup', [['tomato', 1, 'boiled', true], ['mushroom', 2, 'boiled', true]], true],
  ['carrot-potato-soup', [['carrot', 1, 'boiled', true], ['potato', 1, 'boiled', true]], true],
  ['salmon-tomato', [['salmon', 1, 'fried', false], ['tomato', 1, 'boiled', true]], false],
  ['mushroom-potato', [['mushroom', 2, 'fried', false], ['potato', 1, 'boiled', true]], false],
  ['salmon-tomato-potato', [['salmon', 1, 'fried', false], ['potato', 1, 'boiled', true], ['tomato', 1, 'boiled', true]], false],
  ['salmon-mushroom-potato', [['salmon', 1, 'fried', false], ['mushroom', 1, 'fried', false], ['potato', 1, 'boiled', true]], false],
  ['salmon-carrot-potato', [['salmon', 1, 'fried', false], ['carrot', 1, 'boiled', true], ['potato', 1, 'boiled', true]], false],
  ['garden-vegetable-soup', [['tomato', 1, 'boiled', true], ['potato', 1, 'boiled', true], ['carrot', 1, 'boiled', true], ['mushroom', 1, 'boiled', true]], true],
  ['salmon-garden-platter', [['salmon', 1, 'fried', false], ['mushroom', 1, 'fried', false], ['potato', 1, 'boiled', true], ['carrot', 1, 'boiled', true], ['tomato', 1, 'boiled', true]], false],
];

const item = (sim, id) => sim.state.items.find(value => value.id === id);
const ok = result => assert.equal(result.ok, true, result.message);
const use = (sim, target) => ok(sim.interact(target));
const put = (sim, where = 'counter') => ok(sim.drop(where));
function advance(sim, seconds, dt = 1 / 60) {
  let remaining = seconds;
  while (remaining > 1e-10) {
    const frame = Math.min(remaining, dt);
    sim.tick(frame); remaining -= frame;
  }
}
function season(sim, target = 'plate') {
  for (const kind of ['salt', 'pepper']) { use(sim, `item:${kind}`); use(sim, `item:${target}`); put(sim); }
}
function choppedInto(sim, kind, target = 'pot') {
  use(sim, `source:${kind}`);
  const id = sim.state.heldId;
  use(sim, 'station:board'); use(sim, 'item:knife'); use(sim, 'station:board'); put(sim);
  use(sim, `item:${id}`); use(sim, `item:${target}`);
  return id;
}
function waterAndHeat(sim, burner = 'left', high = false) {
  use(sim, 'item:pot'); use(sim, 'station:sink'); use(sim, `station:burner-${burner}`);
  use(sim, `heat:${burner}`); if (high) use(sim, `heat:${burner}`);
}
function fishOnStove(sim, high = false) {
  use(sim, 'source:salmon'); use(sim, 'item:pan');
  use(sim, 'item:oil'); use(sim, 'item:pan'); put(sim);
  use(sim, 'item:pan'); use(sim, 'station:burner-right'); use(sim, 'heat:right');
  if (high) use(sim, 'heat:right');
}
function serve(sim) { use(sim, 'item:plate'); use(sim, 'station:serve'); return sim.state.result; }

function playMeal(id, { methodOverrides = {}, cutOverrides = {}, portionOffsets = {}, pourWater = false, drainSoup = false, extraKind } = {}) {
  const [, requirements, soup] = MEALS.find(meal => meal[0] === id);
  const sim = createKitchenSimulation(); ok(sim.chooseRecipe(id));
  const foods = [];
  const add = (kind, method, cut) => {
    const vessel = method === 'fried' ? 'pan' : 'pot';
    let foodId;
    if (cut) foodId = choppedInto(sim, kind, vessel);
    else { use(sim, `source:${kind}`); foodId = sim.state.heldId; use(sim, `item:${vessel}`); }
    foods.push({ id: foodId, vessel });
  };
  for (const [kind, portions, method, cut] of requirements) {
    for (let i = 0; i < portions + (portionOffsets[kind] ?? 0); i++) add(kind, methodOverrides[kind] ?? method, cutOverrides[kind] ?? cut);
  }
  if (extraKind) add(extraKind, 'boiled', true);
  if (foods.some(food => food.vessel === 'pot')) waterAndHeat(sim);
  if (foods.some(food => food.vessel === 'pan')) {
    use(sim, 'item:oil'); use(sim, 'item:pan'); put(sim);
    use(sim, 'item:pan'); use(sim, 'station:burner-right'); use(sim, 'heat:right');
  }
  const drained = new Set();
  let poured = false;
  for (let frame = 0; frame < 1500; frame++) {
    advance(sim, .1);
    for (const food of foods) {
      const current = item(sim, food.id);
      if (current.kind === 'salmon' && current.sideCooked[current.side] === 1 && current.cooked < 1) ok(sim.flip());
      if (current.cooked !== 1 || drained.has(food.id)) continue;
      if (food.vessel === 'pot' && soup && !drainSoup) continue;
      use(sim, `item:${food.id}`); use(sim, 'item:plate'); drained.add(food.id);
    }
    const allBoiled = foods.filter(food => food.vessel === 'pot');
    if (soup && !drainSoup && !poured && allBoiled.every(food => item(sim, food.id).cooked === 1)) {
      use(sim, 'item:pot'); use(sim, 'item:plate'); put(sim); poured = true;
      for (const food of allBoiled) drained.add(food.id);
    }
    if (drained.size === foods.length) break;
    assert.ok(frame < 1499, `the actual kitchen failed to finish ${id}`);
  }
  if (pourWater) { use(sim, 'item:pot'); use(sim, 'item:plate'); put(sim); }
  season(sim);
  invariant(sim);
  return sim;
}
// All foods travel through the same pickup, cutting, heating and plating operations as play.
function advancedMeal({ omitTomato = false, pourWater = false, secondSide = 30, cutPotato = true, extraPotato = false } = {}) {
  const sim = createKitchenSimulation();
  ok(sim.chooseRecipe('salmon-tomato-potato'));
  if (cutPotato) choppedInto(sim, 'potato');
  else { use(sim, 'source:potato'); use(sim, 'item:pot'); }
  if (!omitTomato) choppedInto(sim, 'tomato');
  if (extraPotato) choppedInto(sim, 'potato');
  waterAndHeat(sim); fishOnStove(sim);
  advance(sim, 25);
  const drain = id => { use(sim, `item:${id}`); use(sim, 'item:plate'); };
  if (!omitTomato) drain('tomato-1');
  if (cutPotato) drain('potato-1');
  if (extraPotato) drain('potato-2');
  advance(sim, 11); ok(sim.flip());
  if (!cutPotato) {
    advance(sim, 10); drain('potato-1');
    advance(sim, secondSide - 10);
  } else advance(sim, secondSide);
  use(sim, 'item:pan'); use(sim, 'item:plate'); put(sim);
  if (pourWater) { use(sim, 'item:pot'); use(sim, 'item:plate'); put(sim); }
  season(sim);
  return sim;
}

function invariant(sim) {
  const state = sim.state;
  assert.equal(new Set(state.items.map(value => value.id)).size, state.items.length);
  const held = state.items.filter(value => value.location === 'held');
  assert.equal(held.length, state.heldId ? 1 : 0);
  if (state.heldId) assert.equal(held[0].id, state.heldId);
  for (const value of state.items) {
    assert.ok(['held', 'counter', 'floor', 'board', 'burner-left', 'burner-right', 'pan', 'pot', 'plate'].includes(value.location));
    for (const key of ['grams', 'cooked', 'scorched', 'waterMl', 'oilMl', 'saltGrams', 'pepperGrams', 'temperature']) assert.ok(Number.isFinite(value[key]) && value[key] >= 0, `${value.id}.${key}`);
  }
}

test('recipes describe fifteen distinct dishes; changing an order does not do work or discard held food', () => {
  assert.deepEqual(RECIPES.map(recipe => recipe.id), MEALS.map(meal => meal[0]));
  assert.equal(new Set(RECIPES.map(recipe => recipe.name)).size, 15);
  assert.deepEqual(FOOD_KINDS, ['salmon', 'potato', 'tomato', 'carrot', 'mushroom']);
  assert.deepEqual(FOOD_PORTIONS, { salmon: 210, potato: 150, tomato: 150, carrot: 150, mushroom: 100 });
  const sim = createKitchenSimulation();
  use(sim, 'heat:left'); // A recipe does not lock the kitchen controls.
  use(sim, 'source:tomato');
  const food = item(sim, 'tomato-1');
  ok(sim.chooseRecipe('salmon-potato')); ok(sim.chooseRecipe('tomato-soup'));
  assert.deepEqual(item(sim, 'tomato-1'), food);
  assert.equal(sim.state.heldId, 'tomato-1');
  assert.equal(sim.state.burners.left, 1);
  assert.equal(sim.chooseRecipe('unknown').ok, false);
  assert.equal(sim.chooseRecipe('tomato-soup').ok, false);
  invariant(sim);
});

for (const [id, requirements, soup] of MEALS) {
  test(`${id} earns 100 through actual pickup, cutting, heating, draining and seasoning actions`, () => {
    const sim = playMeal(id);
    const plated = sim.state.items.filter(value => value.location === 'plate');
    for (const [kind, portions] of requirements) {
      assert.equal(plated.filter(value => value.kind === kind).length, portions);
      assert.equal(plated.filter(value => value.kind === kind).reduce((sum, value) => sum + value.grams, 0), portions * FOOD_PORTIONS[kind]);
    }
    assert.equal(item(sim, 'plate').waterMl, soup ? 1000 : 0);
    for (const fish of plated.filter(value => value.kind === 'salmon')) assert.deepEqual(fish.sideCooked, [1, 1]);
    const result = serve(sim);
    assert.deepEqual(result.breakdown, { ingredients: 100, method: 100, doneness: 100, seasoning: 100 }, result.feedback);
    assert.equal(result.score, 100, result.feedback);
    assert.equal(result.stars, 3);
    assert.deepEqual(result.issues, []);
    invariant(sim);
  });
}

test('new carrot and mushroom stock is finite, conserves grams and is replenished only by resetting', () => {
  for (const [kind, grams] of [['carrot', 150], ['mushroom', 100]]) {
    const sim = createKitchenSimulation();
    for (let portion = 0; portion < 4; portion++) { use(sim, `source:${kind}`); put(sim, 'floor'); }
    const before = sim.state;
    assert.equal(sim.interact(`source:${kind}`).ok, false);
    assert.deepEqual(sim.state, before);
    assert.equal(sim.state.items.filter(value => value.kind === kind).reduce((sum, value) => sum + value.grams, 0), grams * 4);
    ok(sim.reset()); use(sim, `source:${kind}`);
    assert.equal(sim.state.heldId, `${kind}-1`);
    assert.equal(item(sim, `${kind}-1`).grams, grams);
    invariant(sim);
  }
});

test('mushrooms must be fried or boiled according to the selected meal, rather than receiving credit for any heat', () => {
  for (const [id, method] of [['pan-mushroom', 'boiled'], ['tomato-mushroom-soup', 'fried'], ['salmon-mushroom-potato', 'boiled'], ['salmon-garden-platter', 'boiled']]) {
    const sim = playMeal(id, { methodOverrides: { mushroom: method } });
    const result = serve(sim);
    assert.equal(result.breakdown.ingredients, 100, result.feedback);
    assert.ok(result.breakdown.method < 85, result.feedback);
    assert.ok(result.score < 85, result.feedback);
    assert.ok(result.issues.some(issue => issue.includes(method === 'boiled' ? '蘑菇应在加过油的煎锅里' : '蘑菇应在有足够水的汤锅里')));
    invariant(sim);
  }
});

test('new soup recipes need their chopped vegetables and the cooking water', () => {
  for (const [id, kind] of [['carrot-soup', 'carrot'], ['carrot-potato-soup', 'potato'], ['tomato-mushroom-soup', 'mushroom'], ['garden-vegetable-soup', 'carrot']]) {
    const uncut = playMeal(id, { cutOverrides: { [kind]: false } });
    const uncutResult = serve(uncut);
    assert.equal(uncutResult.breakdown.ingredients, 100, uncutResult.feedback);
    assert.ok(uncutResult.score < 85);
    assert.ok(uncutResult.issues.some(issue => issue.includes('需要先切好')));
    const dry = playMeal(id, { drainSoup: true });
    const dryResult = serve(dry);
    assert.equal(item(dry, 'plate').waterMl, 0);
    assert.equal(dryResult.breakdown.method, 20);
    assert.ok(dryResult.score < 85);
    assert.ok(dryResult.issues.some(issue => issue.includes('1000ml 汤水')));
    invariant(uncut); invariant(dry);
  }
});

test('new drained dishes reject water, wrong quantities and unrequested food', () => {
  for (const id of ['boiled-potato', 'mushroom-potato', 'salmon-carrot-potato', 'salmon-garden-platter']) {
    const wet = playMeal(id, { pourWater: true });
    const wetResult = serve(wet);
    assert.equal(wetResult.breakdown.method, 70);
    assert.ok(wetResult.score < 85);
    assert.ok(wetResult.issues.some(issue => issue.includes('逐份拿出沥水')));
    invariant(wet);
  }
  const missing = playMeal('salmon-garden-platter', { portionOffsets: { carrot: -1 } });
  const missingResult = serve(missing);
  assert.ok(missingResult.breakdown.ingredients < 100);
  assert.ok(missingResult.score < 85);
  assert.ok(missingResult.issues.some(issue => issue.includes('胡萝卜需要 150g，这盘有 0g')));
  const oversized = playMeal('salmon-garden-platter', { portionOffsets: { carrot: 1 } });
  const oversizedResult = serve(oversized);
  assert.equal(oversizedResult.breakdown.ingredients, 80);
  assert.equal(oversizedResult.breakdown.method, 100);
  assert.equal(oversizedResult.breakdown.doneness, 100);
  assert.ok(oversizedResult.score < 85, 'four correct ingredients cannot hide an extra full portion of the fifth');
  assert.ok(oversizedResult.issues.some(issue => issue.includes('胡萝卜需要 150g，这盘有 300g')));
  const extra = playMeal('pan-mushroom', { extraKind: 'carrot' });
  const extraResult = serve(extra);
  assert.ok(extraResult.breakdown.ingredients < 100);
  assert.ok(extraResult.issues.some(issue => issue.includes('不需要胡萝卜')));
  invariant(missing); invariant(oversized); invariant(extra);
});

test('mushroom frying credit records the oil present during cooking; adding it afterward cannot repair a dry pan', () => {
  const sim = createKitchenSimulation(); ok(sim.chooseRecipe('pan-mushroom'));
  for (let portion = 0; portion < 2; portion++) { use(sim, 'source:mushroom'); use(sim, 'item:pan'); }
  use(sim, 'item:pan'); use(sim, 'station:burner-right'); use(sim, 'heat:right');
  advance(sim, 50.2);
  assert.equal(item(sim, 'mushroom-1').cooked, 1);
  assert.equal(item(sim, 'mushroom-2').cooked, 1);
  use(sim, 'item:oil'); use(sim, 'item:pan'); put(sim);
  advance(sim, .1);
  use(sim, 'item:pan'); use(sim, 'item:plate'); put(sim); season(sim);
  const result = serve(sim);
  assert.equal(result.breakdown.ingredients, 100);
  assert.equal(result.breakdown.method, 0);
  assert.ok(result.score < 85);
  assert.ok(result.issues.some(issue => issue.includes('蘑菇应在加过油的煎锅')));
  invariant(sim);
});

test('one hand, occupied stations and finite sources cannot clone or lose ingredients', () => {
  const sim = createKitchenSimulation();
  use(sim, 'source:potato');
  const before = sim.state;
  assert.equal(sim.interact('source:salmon').ok, false);
  assert.equal(sim.interact('item:knife').ok, false);
  assert.equal(sim.drop('not-a-place').ok, false);
  assert.deepEqual(sim.state, before);
  put(sim, 'board');
  use(sim, 'source:potato');
  assert.equal(sim.drop('board').ok, false);
  put(sim, 'plate');
  for (let count = 2; count < 4; count++) { use(sim, 'source:potato'); put(sim, 'floor'); }
  const exhausted = sim.state;
  assert.equal(sim.interact('source:potato').ok, false);
  assert.deepEqual(sim.state, exhausted);
  assert.equal(sim.state.items.filter(value => value.kind === 'potato').reduce((sum, value) => sum + value.grams, 0), 600);
  use(sim, 'item:knife'); use(sim, 'station:board');
  assert.equal(sim.interact('station:board').ok, false);
  assert.equal(item(sim, 'potato-1').grams, 150);
  assert.equal(item(sim, 'potato-1').cut, true);
  invariant(sim);
});

test('picking up and putting down a filled pot preserves parent-child ownership and pouring transfers each item once', () => {
  const sim = createKitchenSimulation();
  use(sim, 'source:tomato'); use(sim, 'item:pot');
  season(sim, 'pot');
  use(sim, 'item:pot'); use(sim, 'station:sink');
  assert.equal(item(sim, 'tomato-1').location, 'pot');
  assert.equal(item(sim, 'pot').location, 'held');
  assert.equal(sim.interact('source:tomato').ok, false);
  put(sim, 'burner-left');
  use(sim, 'item:pan');
  assert.equal(sim.drop('burner-left').ok, false);
  put(sim);
  use(sim, 'item:pot'); use(sim, 'item:plate');
  assert.equal(item(sim, 'tomato-1').location, 'plate');
  for (const key of ['waterMl', 'saltGrams', 'pepperGrams']) {
    assert.equal(item(sim, 'pot')[key], 0);
    assert.equal(item(sim, 'plate')[key], key === 'waterMl' ? 1000 : 5);
  }
  const transferred = sim.state;
  assert.equal(sim.interact('item:plate').ok, false);
  assert.deepEqual(sim.state, transferred);
  assert.equal(sim.state.items.filter(value => value.kind === 'tomato').length, 1);
  invariant(sim);
});

test('bottles have finite doses and seasoning survives proportional removal and replacement of food', () => {
  const sim = createKitchenSimulation();
  use(sim, 'source:salmon'); use(sim, 'item:pan');
  use(sim, 'source:potato'); use(sim, 'item:pan');
  use(sim, 'item:salt'); use(sim, 'item:pan'); use(sim, 'item:pan'); put(sim);
  use(sim, 'item:salmon-1');
  assert.ok(Math.abs(item(sim, 'salmon-1').saltGrams - 10 * 210 / 360) < 1e-9);
  for (let cycle = 0; cycle < 10; cycle++) { use(sim, 'item:pan'); use(sim, 'item:salmon-1'); }
  use(sim, 'item:plate');
  use(sim, 'item:potato-1'); use(sim, 'item:plate');
  assert.ok(Math.abs(item(sim, 'plate').saltGrams - 10) < 1e-9);
  assert.ok(Math.abs(sim.state.items.reduce((sum, value) => sum + value.saltGrams, 0) - 100) < 1e-9);
  assert.equal(item(sim, 'pan').saltGrams, 0);
  use(sim, 'item:oil');
  for (let dose = 0; dose < 25; dose++) use(sim, 'item:pan');
  const emptyOil = sim.state;
  assert.equal(sim.interact('item:pan').ok, false);
  assert.deepEqual(sim.state, emptyOil);
  assert.equal(item(sim, 'oil').oilMl, 0);
  assert.equal(item(sim, 'pan').oilMl, 250);
  invariant(sim);
});

test('seasoning doses follow a validated multiplier with one decimal and conserve bottle stock', () => {
  const sim = createKitchenSimulation();
  use(sim, 'source:salmon'); use(sim, 'item:pan');
  for (const [kind, field, base] of [['salt', 'saltGrams', 5], ['pepper', 'pepperGrams', 5], ['oil', 'oilMl', 10]]) {
    use(sim, `item:${kind}`);
    const stock = item(sim, kind)[field];
    let added = 0;
    for (const multiplier of [.3, .555, 1.7]) {
      const dose = Math.round(base * multiplier * 10) / 10;
      ok(sim.interact('item:pan', { doseMultiplier: multiplier }));
      added += dose;
      assert.ok(Math.abs(item(sim, 'pan')[field] - added) < 1e-9);
      assert.ok(Math.abs(item(sim, kind)[field] - (stock - added)) < 1e-9);
      if (kind !== 'oil') assert.equal(item(sim, kind).grams, item(sim, kind)[field]);
      assert.ok(Math.abs(sim.state.items.reduce((sum, value) => sum + value[field], 0) - stock) < 1e-9);
    }
    put(sim);
  }
  assert.equal(item(sim, 'salmon-1').grams, 210, 'dose adjustments never change food weight');
  invariant(sim);
});

test('invalid seasoning multipliers never spend stock or change any state', () => {
  const sim = createKitchenSimulation();
  for (const kind of ['salt', 'pepper', 'oil']) {
    use(sim, `item:${kind}`);
    for (const doseMultiplier of [0, -.3, .299, 1.701, 2, NaN, Infinity, -Infinity, '1', null, false, {}]) {
      const before = sim.state;
      assert.equal(sim.interact('item:plate', { doseMultiplier }).ok, false);
      assert.deepEqual(sim.state, before);
    }
    put(sim);
  }
  invariant(sim);
});

test('stock checks use the actual requested dose and permit the exact smaller remainder', () => {
  const sim = createKitchenSimulation();
  use(sim, 'item:salt');
  for (let dose = 0; dose < 11; dose++) ok(sim.interact('item:pan', { doseMultiplier: 1.7 }));
  assert.equal(item(sim, 'salt').saltGrams, 6.5);
  const remainingSalt = sim.state;
  assert.equal(sim.interact('item:pan', { doseMultiplier: 1.7 }).ok, false);
  assert.deepEqual(sim.state, remainingSalt);
  ok(sim.interact('item:pan', { doseMultiplier: 1.3 }));
  assert.equal(item(sim, 'salt').saltGrams, 0);
  assert.equal(item(sim, 'salt').grams, 0);
  assert.equal(item(sim, 'pan').saltGrams, 100);
  put(sim); use(sim, 'item:oil');
  for (let dose = 0; dose < 14; dose++) ok(sim.interact('item:pan', { doseMultiplier: 1.7 }));
  assert.equal(item(sim, 'oil').oilMl, 12);
  const remainingOil = sim.state;
  assert.equal(sim.interact('item:pan', { doseMultiplier: 1.7 }).ok, false);
  assert.deepEqual(sim.state, remainingOil);
  ok(sim.interact('item:pan', { doseMultiplier: 1.2 }));
  assert.equal(item(sim, 'oil').oilMl, 0);
  assert.equal(item(sim, 'pan').oilMl, 250);
  invariant(sim);
});

test('early and late seasoning change taste ratings and actual stock without changing the cooked dish', () => {
  const results = [.3, 1, 1.7].map(doseMultiplier => {
    const sim = createKitchenSimulation();
    ok(sim.chooseRecipe('tomato-soup'));
    choppedInto(sim, 'tomato'); choppedInto(sim, 'tomato');
    for (const kind of ['salt', 'pepper']) {
      use(sim, `item:${kind}`);
      ok(sim.interact('item:pot', { doseMultiplier })); put(sim);
      assert.equal(item(sim, kind).grams, 100 - 5 * doseMultiplier);
    }
    waterAndHeat(sim); advance(sim, 26);
    use(sim, 'item:pot'); use(sim, 'item:plate'); put(sim);
    const beforeServing = sim.state;
    const result = serve(sim);
    assert.equal(beforeServing.items.find(value => value.id === 'plate').saltGrams, 5 * doseMultiplier, 'old snapshots retain the actual dose');
    assert.equal(result.breakdown.ingredients, 100);
    assert.equal(result.breakdown.method, 100);
    assert.ok(result.breakdown.doneness >= 95);
    invariant(sim);
    return result;
  });
  assert.equal(results[0].breakdown.seasoning, 30);
  assert.equal(results[1].breakdown.seasoning, 100);
  assert.equal(results[2].breakdown.seasoning, 30);
  assert.equal(results[0].breakdown.doneness, results[1].breakdown.doneness);
  assert.equal(results[2].breakdown.doneness, results[1].breakdown.doneness);
  assert.ok(results[0].score < results[1].score);
  assert.ok(results[2].score < results[1].score);
  assert.ok(results[0].issues.some(issue => issue.includes('偏少')));
  assert.ok(results[2].issues.some(issue => issue.includes('偏多')));
});

test('interaction options leave nonseasoning operations unchanged and omitted doses keep their original size', () => {
  const baseline = createKitchenSimulation(), withOptions = createKitchenSimulation();
  const targets = ['source:potato', 'station:board', 'item:knife', 'station:board'];
  for (const target of targets) {
    assert.deepEqual(withOptions.interact(target, { doseMultiplier: NaN }), baseline.interact(target));
    assert.deepEqual(withOptions.state, baseline.state);
  }
  put(withOptions); use(withOptions, 'item:salt');
  const snapshot = withOptions.state;
  ok(withOptions.interact('item:plate', {}));
  ok(withOptions.interact('item:plate', { doseMultiplier: undefined }));
  assert.equal(item(withOptions, 'plate').saltGrams, 10);
  assert.equal(item(withOptions, 'salt').saltGrams, 90);
  assert.equal(snapshot.items.find(value => value.id === 'salt').saltGrams, 100);
  assert.equal(snapshot.items.find(value => value.id === 'plate').saltGrams, 0);
  snapshot.items.find(value => value.id === 'salt').grams = 999;
  assert.equal(item(withOptions, 'salt').grams, 90);
  invariant(withOptions);
});

test('a recipe can be completed through physical actions without a prescribed action order', () => {
  const sim = createKitchenSimulation();
  // Season the empty pot before choosing the recipe or finding ingredients.
  season(sim, 'pot');
  choppedInto(sim, 'tomato'); choppedInto(sim, 'tomato');
  ok(sim.chooseRecipe('tomato-soup'));
  waterAndHeat(sim);
  advance(sim, 26);
  assert.equal(item(sim, 'tomato-1').cooked, 1);
  use(sim, 'item:pot'); use(sim, 'item:plate'); put(sim);
  const result = serve(sim);
  assert.ok(result.score >= 95, result.feedback);
  assert.equal(result.stars, 3);
  assert.equal(result.breakdown.method, 100);
  assert.equal(item(sim, 'plate').waterMl, 1000);
  invariant(sim);
});

test('fish needs two independently cooked sides while boiled potatoes are lifted out of their water', () => {
  const sim = createKitchenSimulation();
  ok(sim.chooseRecipe('salmon-potato'));
  choppedInto(sim, 'potato'); waterAndHeat(sim);
  fishOnStove(sim);
  advance(sim, 25);
  use(sim, 'item:potato-1'); use(sim, 'item:plate');
  season(sim);
  advance(sim, 11); // First side also needs to warm the initially cold pan.
  assert.equal(item(sim, 'salmon-1').cooked, 0);
  assert.equal(item(sim, 'salmon-1').sideCooked[0], 1);
  ok(sim.flip()); advance(sim, 30);
  assert.equal(item(sim, 'salmon-1').cooked, 1);
  use(sim, 'item:pan');
  assert.equal(sim.flip().ok, false, 'the pan occupies the only hand');
  use(sim, 'item:plate'); put(sim);
  const result = serve(sim);
  assert.ok(result.score >= 95, result.feedback);
  assert.equal(result.stars, 3);
  assert.equal(item(sim, 'plate').waterMl, 0);
  assert.equal(item(sim, 'pot').waterMl, 1000);
  invariant(sim);
});

test('the advanced recipe cooks three separate ingredients and drains both vegetables while the fish is frying', () => {
  const sim = advancedMeal();
  const plate = item(sim, 'plate');
  const foods = sim.state.items.filter(value => value.location === 'plate');
  assert.deepEqual(foods.map(value => [value.kind, value.grams]).sort(), [['potato', 150], ['salmon', 210], ['tomato', 150]]);
  assert.equal(item(sim, 'potato-1').cut, true);
  assert.equal(item(sim, 'tomato-1').cut, true);
  assert.deepEqual(item(sim, 'salmon-1').sideCooked, [1, 1]);
  assert.equal(plate.waterMl, 0, 'lifting vegetables individually leaves the boiling water in the pot');
  assert.equal(item(sim, 'pot').waterMl, 1000);
  assert.equal(plate.saltGrams, 5);
  assert.equal(plate.pepperGrams, 5);
  assert.equal(item(sim, 'oil').oilMl, 240);
  const result = serve(sim);
  assert.ok(result.score >= 95, result.feedback);
  assert.equal(result.stars, 3);
  assert.equal(result.breakdown.ingredients, 100);
  assert.equal(result.breakdown.method, 100);
  invariant(sim);
});

test('the advanced recipe does not treat a missing tomato or extra portion as the old salmon meal', () => {
  const missing = advancedMeal({ omitTomato: true });
  const missingResult = serve(missing);
  assert.equal(missingResult.breakdown.ingredients, 67);
  assert.ok(missingResult.score < 85);
  assert.ok(missingResult.issues.some(issue => issue.includes('番茄需要 150g，这盘有 0g')));
  const extra = advancedMeal({ extraPotato: true });
  const extraResult = serve(extra);
  assert.equal(extraResult.breakdown.ingredients, 67);
  assert.ok(extraResult.score < 85);
  assert.ok(extraResult.issues.some(issue => issue.includes('土豆需要 150g，这盘有 300g')));
  invariant(missing); invariant(extra);
});

test('pouring vegetable cooking water into the advanced dish loses the drained plating method', () => {
  const sim = advancedMeal({ pourWater: true });
  assert.equal(item(sim, 'plate').waterMl, 1000);
  const result = serve(sim);
  assert.equal(result.breakdown.ingredients, 100);
  assert.equal(result.breakdown.method, 70);
  assert.ok(result.score < 85);
  assert.ok(result.issues.some(issue => issue.includes('逐份拿出沥水')));
  invariant(sim);
});

test('advanced portions and seasoning cannot hide a half-raw fish, burning or uncut vegetables', () => {
  for (const options of [{ secondSide: 0 }, { secondSide: 61 }, { cutPotato: false }]) {
    const sim = advancedMeal(options);
    const result = serve(sim);
    assert.equal(result.breakdown.ingredients, 100);
    assert.equal(result.breakdown.seasoning, 100);
    assert.ok(result.score < 85, result.feedback);
    if (options.secondSide === 0) {
      assert.deepEqual(item(sim, 'salmon-1').sideCooked, [1, 0]);
      assert.ok(result.score <= 49);
      assert.ok(result.issues.some(issue => issue.includes('两面')));
    } else if (options.secondSide === 61) assert.ok(result.issues.some(issue => issue.includes('过火')));
    else {
      assert.equal(item(sim, 'potato-1').cooked, 1, 'uncut potatoes can cook but do not satisfy this recipe method');
      assert.ok(result.issues.some(issue => issue.includes('土豆需要先切好')));
    }
    invariant(sim);
  }
});

test('the advanced recipe still requires frying the fish even when every ingredient is fully cooked', () => {
  const sim = createKitchenSimulation(); ok(sim.chooseRecipe('salmon-tomato-potato'));
  choppedInto(sim, 'potato'); choppedInto(sim, 'tomato');
  use(sim, 'source:salmon'); use(sim, 'item:pot');
  waterAndHeat(sim); advance(sim, 25);
  for (const id of ['potato-1', 'tomato-1']) { use(sim, `item:${id}`); use(sim, 'item:plate'); }
  advance(sim, 15); use(sim, 'item:salmon-1'); use(sim, 'item:plate'); season(sim);
  assert.equal(item(sim, 'salmon-1').cooked, 1);
  const result = serve(sim);
  assert.equal(result.breakdown.ingredients, 100);
  assert.equal(result.breakdown.method, 67);
  assert.ok(result.score < 85);
  assert.ok(result.issues.some(issue => issue.includes('加过油的煎锅')));
  invariant(sim);
});

test('lifting a pan off an active burner stops heating; replacing its food never inherits old cooking time', () => {
  const sim = createKitchenSimulation();
  fishOnStove(sim, true); advance(sim, 4);
  const temperature = item(sim, 'pan').temperature;
  use(sim, 'item:pan'); advance(sim, 1);
  assert.ok(item(sim, 'pan').temperature < temperature);
  assert.equal(sim.state.burners.right, 2, 'the stove itself stays on');
  put(sim, 'counter');
  use(sim, 'item:salmon-1'); put(sim, 'plate');
  use(sim, 'source:salmon'); use(sim, 'item:pan');
  assert.deepEqual(item(sim, 'salmon-2').sideCooked, [0, 0]);
  assert.equal(item(sim, 'salmon-2').cooked, 0);
  const previous = item(sim, 'salmon-1').sideCooked;
  advance(sim, 5);
  assert.deepEqual(item(sim, 'salmon-1').sideCooked, previous, 'food already removed is unaffected by its old pan');
  invariant(sim);
});

test('empty, raw and wrong dishes may be served but cannot receive a good rating', () => {
  const empty = createKitchenSimulation();
  ok(empty.chooseRecipe('salmon-potato'));
  assert.equal(empty.interact('station:serve').ok, false, 'serving cannot remotely move the plate');
  assert.ok(serve(empty).score < 60);
  const raw = createKitchenSimulation(); ok(raw.chooseRecipe('salmon-potato'));
  for (const kind of ['salmon', 'potato']) { use(raw, `source:${kind}`); use(raw, 'item:plate'); }
  season(raw);
  const rawResult = serve(raw);
  assert.ok(rawResult.score <= 49);
  assert.ok(rawResult.issues.some(issue => issue.includes('没熟')));
  const wrong = createKitchenSimulation(); ok(wrong.chooseRecipe('tomato-soup'));
  choppedInto(wrong, 'potato'); season(wrong, 'pot'); waterAndHeat(wrong); advance(wrong, 26);
  use(wrong, 'item:pot'); use(wrong, 'item:plate'); put(wrong);
  const wrongResult = serve(wrong);
  assert.ok(wrongResult.score < 60);
  assert.ok(wrongResult.issues.some(issue => issue.includes('番茄需要')));
  assert.ok(wrongResult.issues.some(issue => issue.includes('不需要土豆')));
  const missing = createKitchenSimulation(); ok(missing.chooseRecipe('tomato-soup'));
  choppedInto(missing, 'tomato'); season(missing, 'pot'); waterAndHeat(missing); advance(missing, 26);
  use(missing, 'item:pot'); use(missing, 'item:plate'); put(missing);
  const incomplete = serve(missing);
  assert.ok(incomplete.score < 85, 'half the required tomatoes cannot earn the highest rating');
  assert.equal(incomplete.breakdown.ingredients, 60);
});

test('extreme overcooking remains finite and adding oil after cooking cannot repair the method score', () => {
  const burnt = createKitchenSimulation(); ok(burnt.chooseRecipe('salmon-potato'));
  fishOnStove(burnt, true); advance(burnt, 40); ok(burnt.flip()); advance(burnt, 100);
  assert.equal(item(burnt, 'salmon-1').scorched, 1);
  use(burnt, 'item:pan'); use(burnt, 'item:plate'); put(burnt);
  const result = serve(burnt);
  assert.ok(result.score <= 59);
  assert.equal(result.stars, 1);
  invariant(burnt);
  const dry = createKitchenSimulation(); ok(dry.chooseRecipe('salmon-potato'));
  use(dry, 'source:salmon'); use(dry, 'item:pan');
  use(dry, 'item:pan'); use(dry, 'station:burner-right'); use(dry, 'heat:right');
  advance(dry, 35); ok(dry.flip()); advance(dry, 30);
  use(dry, 'item:oil'); use(dry, 'item:pan'); put(dry); advance(dry, 1);
  use(dry, 'item:pan'); use(dry, 'item:plate'); put(dry);
  assert.equal(serve(dry).breakdown.method, 0);
});

test('correct portions and seasoning cannot hide an unfinished, overcooked or boiled salmon dish', () => {
  for (const secondSide of [20, 61]) {
    const sim = createKitchenSimulation(); ok(sim.chooseRecipe('salmon-potato'));
    choppedInto(sim, 'potato'); waterAndHeat(sim); fishOnStove(sim);
    advance(sim, 25); use(sim, 'item:potato-1'); use(sim, 'item:plate');
    advance(sim, 11); ok(sim.flip()); advance(sim, secondSide);
    use(sim, 'item:pan'); use(sim, 'item:plate'); put(sim); season(sim);
    const result = serve(sim);
    assert.equal(result.breakdown.ingredients, 100);
    assert.equal(result.breakdown.seasoning, 100);
    assert.ok(result.score < 85, result.feedback);
    assert.ok(result.issues.some(issue => issue.includes(secondSide === 20 ? '没熟' : '过火')));
  }
  const boiled = createKitchenSimulation(); ok(boiled.chooseRecipe('salmon-potato'));
  use(boiled, 'source:salmon'); use(boiled, 'item:pot');
  choppedInto(boiled, 'potato'); waterAndHeat(boiled); advance(boiled, 40);
  for (const id of ['salmon-1', 'potato-1']) { use(boiled, `item:${id}`); use(boiled, 'item:plate'); }
  season(boiled);
  const result = serve(boiled);
  assert.equal(result.breakdown.ingredients, 100);
  assert.equal(result.breakdown.doneness > 90, true);
  assert.ok(result.score < 85);
  assert.ok(result.issues.some(issue => issue.includes('加过油的煎锅')));
});

test('the same thermal time and actions produce the same result across frame rates; ignored gaps never catch up', () => {
  const states = [30, 60, 144, 240].map(hz => {
    const sim = createKitchenSimulation();
    fishOnStove(sim, true); choppedInto(sim, 'tomato'); waterAndHeat(sim, 'left', true);
    advance(sim, 12, 1 / hz); ok(sim.flip()); advance(sim, 8, 1 / hz);
    return sim.state;
  });
  for (const state of states.slice(1)) {
    assert.ok(Math.abs(state.elapsed - states[0].elapsed) < 1e-8);
    for (const base of states[0].items) {
      const actual = state.items.find(value => value.id === base.id);
      for (const key of ['temperature', 'cooked', 'scorched', 'waterMl']) assert.ok(Math.abs(actual[key] - base[key]) < 1e-8, `${base.id}.${key}`);
    }
  }
  const sim = createKitchenSimulation(); fishOnStove(sim);
  sim.tick(1 / 120);
  const before = sim.state;
  for (const dt of [0, -1, NaN, Infinity, -Infinity, .251, 10, '0.1', null]) sim.tick(dt);
  assert.deepEqual(sim.state, before);
  sim.tick(1 / 120);
  assert.ok(item(sim, 'pan').temperature > 22, 'partial integration time is preserved without catch-up');
});

test('result and inventory snapshots are isolated; serving is final and resetting keeps only the recipe', () => {
  const sim = createKitchenSimulation(); ok(sim.chooseRecipe('tomato-soup'));
  fishOnStove(sim);
  const snapshot = sim.state;
  snapshot.items.find(value => value.id === 'salmon-1').sideCooked[0] = 1;
  snapshot.items.find(value => value.id === 'oil').oilMl = 9999;
  snapshot.burners.right = 0;
  assert.deepEqual(item(sim, 'salmon-1').sideCooked, [0, 0]);
  assert.equal(item(sim, 'oil').oilMl, 240);
  assert.equal(sim.state.burners.right, 1);
  serve(sim);
  const served = sim.state;
  for (const result of [sim.interact('station:serve'), sim.interact('source:tomato'), sim.interact('heat:left'), sim.drop(), sim.flip(), sim.chooseRecipe('salmon-potato')]) assert.equal(result.ok, false);
  advance(sim, 10);
  assert.deepEqual(sim.state, served);
  const fake = sim.state.result; fake.score = 100; fake.issues.length = 0; fake.breakdown.ingredients = 100;
  assert.deepEqual(sim.state.result, served.result);
  ok(sim.reset());
  assert.equal(sim.state.recipeId, 'tomato-soup');
  assert.equal(sim.state.items.length, 7);
  assert.equal(sim.state.result, null);
  assert.equal(sim.state.heldId, null);
  assert.deepEqual(sim.state.burners, { left: 0, right: 0 });
  assert.equal(item(sim, 'oil').oilMl, 250);
  assert.equal(sim.state.elapsed, 0);
  invariant(sim);
});
