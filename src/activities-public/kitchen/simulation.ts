/** Accelerated, local kitchen practice. Temperatures and times are gameplay parameters. */
import { formatList, getLocale, t } from '../language.ts';

export type RecipeId = 'tomato-soup' | 'boiled-potato' | 'carrot-soup' | 'pan-mushroom' | 'potato-tomato-soup'
  | 'salmon-potato' | 'tomato-mushroom-soup' | 'carrot-potato-soup' | 'salmon-tomato' | 'mushroom-potato'
  | 'salmon-tomato-potato' | 'salmon-mushroom-potato' | 'salmon-carrot-potato' | 'garden-vegetable-soup' | 'salmon-garden-platter';
export type FoodKind = 'salmon' | 'potato' | 'tomato' | 'carrot' | 'mushroom';
export type ItemKind = FoodKind | 'pan' | 'pot' | 'plate' | 'knife' | 'salt' | 'pepper' | 'oil';
export type ItemLocation = 'held' | 'counter' | 'floor' | 'board' | 'burner-left' | 'burner-right' | 'pan' | 'pot' | 'plate';
export type Heat = 0 | 1 | 2;
export interface KitchenItem {
  id: string;
  kind: ItemKind;
  location: ItemLocation;
  grams: number;
  cut: boolean;
  cooked: number;
  scorched: number;
  waterMl: number;
  oilMl: number;
  saltGrams: number;
  pepperGrams: number;
  temperature: number;
  side?: 0 | 1;
  sideCooked?: [number, number];
}
export interface KitchenResult {
  score: number;
  stars: 1 | 2 | 3;
  title: string;
  feedback: string;
  issues: string[];
  breakdown: { ingredients: number; method: number; doneness: number; seasoning: number };
}
export interface KitchenState {
  recipeId: RecipeId | null;
  items: KitchenItem[];
  heldId: string | null;
  burners: { left: Heat; right: Heat };
  result: KitchenResult | null;
  elapsed: number;
}
export interface KitchenActionResult { ok: boolean; message: string }
export interface RecipeRequirement { kind: FoodKind; grams: number; method: 'fried' | 'boiled'; cut: boolean }
export interface KitchenRecipe {
  id: RecipeId;
  name: string;
  ingredients: readonly string[];
  steps: readonly string[];
  requirements: readonly RecipeRequirement[];
  /** Absent for a drained plate; soup recipes keep their cooking water when served. */
  soupWaterMl?: number;
}
export interface KitchenInteractionOptions { doseMultiplier?: number }

export const ITEM_LABELS: Readonly<Record<ItemKind, string>> = {
  salmon: t`三文鱼`, potato: t`土豆`, tomato: t`番茄`, carrot: t`胡萝卜`, mushroom: t`蘑菇`, pan: t`煎锅`, pot: t`汤锅`, plate: t`餐盘`,
  knife: t`菜刀`, salt: t`盐`, pepper: t`黑胡椒`, oil: t`食用油`,
};
/** Several ingredients in one phrase: 番茄、土豆 in Chinese, "tomato and potato" elsewhere. */
const listOf = (labels: readonly string[]) => getLocale() === 'zh-CN' ? labels.join('、') : formatList(labels); // i18n-ignore: the Chinese list separator
export const FOOD_KINDS: readonly FoodKind[] = ['salmon', 'potato', 'tomato', 'carrot', 'mushroom'];
export const FOOD_PORTIONS: Readonly<Record<FoodKind, number>> = { salmon: 210, potato: 150, tomato: 150, carrot: 150, mushroom: 100 };
const boiled = (kind: FoodKind, grams: number, cut = true): RecipeRequirement => ({ kind, grams, method: 'boiled', cut });
const fried = (kind: FoodKind, grams: number): RecipeRequirement => ({ kind, grams, method: 'fried', cut: false });

function recipe(id: RecipeId, name: string, requirements: readonly RecipeRequirement[], soupWaterMl?: number): KitchenRecipe {
  const chopping = listOf(requirements.filter(item => item.cut).map(item => ITEM_LABELS[item.kind]));
  const boiling = listOf(requirements.filter(item => item.method === 'boiled').map(item => ITEM_LABELS[item.kind]));
  const frying = listOf(requirements.filter(item => item.method === 'fried').map(item => ITEM_LABELS[item.kind]));
  const fish = requirements.some(item => item.kind === 'salmon');
  const friedMushroom = requirements.some(item => item.kind === 'mushroom' && item.method === 'fried');
  return { id, name, requirements, ...(soupWaterMl ? { soupWaterMl } : {}),
    ingredients: [
      ...requirements.map(item => `${ITEM_LABELS[item.kind]} ${item.grams}g${item.grams / FOOD_PORTIONS[item.kind] > 1 ? t`（两份）` : ''}`),
      ...(boiling ? [soupWaterMl ? t`水 ${soupWaterMl}ml` : t`煮蔬菜用水 1000ml（装盘前沥水）`] : []),
      ...(frying ? [t`煎锅用油 10ml`] : []), t`整盘盐 5g、黑胡椒 5g`,
    ],
    steps: [
      ...(chopping ? [t`把${chopping}分别放上案板；拿刀点击案板切配。`] : []),
      ...(boiling ? [`${chopping ? t`汤锅加水，放入备好的${boiling}，开小火煮熟；` : t`汤锅加水，放入完整的${boiling}，开小火煮熟；`}${soupWaterMl ? t`保留汤水，留意锅中份量。` : t`逐份拿出并沥水装盘，煮菜的水留在锅里。`}`] : []),
      ...(frying ? [`${t`煎锅加入 10ml 油，放入${frying}，开小火煎制；`}${fish ? t`鱼的第一面煎熟后，放下工具，翻面再煎。` : t`留意熟度，蘑菇熟透后及时离火。`}`] : []),
      ...(fish && friedMushroom ? [t`同锅的蘑菇会先熟，逐份夹出装盘，让鱼继续煎另一面。`] : []),
      soupWaterMl ? t`拿起汤锅，把煮熟的食材和汤水一起倒入餐盘。` : t`把所有熟透的食材装在同一餐盘中，避免把煮菜水一起倒入。`,
      t`拿调料对准锅或餐盘按 E，按住左键或 E、松开控制份量；整盘盐和黑胡椒各 5g，端到出餐台。`,
      // Designer's timing note: every view filters it out by its 试玩时间 prefix, so it is never shown.
      `试玩时间：${fish ? '鱼每面约 30 秒；' : ''}${boiling ? '切好的蔬菜约 20 秒、完整土豆约 40 秒；' : ''}${friedMushroom ? '完整蘑菇约 45 秒；' : ''}以上为热锅后的练习参数，以实际熟度为准。`, // i18n-ignore: hidden designer note, filtered out of every view
    ] };
}

/** Catalog order is also the collection journal's progression order: five dishes in each chapter. */
export const RECIPES: readonly KitchenRecipe[] = [
  recipe('tomato-soup', t`番茄汤`, [boiled('tomato', 300)], 1000),
  recipe('boiled-potato', t`海盐水煮土豆`, [boiled('potato', 300, false)]),
  recipe('carrot-soup', t`胡萝卜清汤`, [boiled('carrot', 300)], 1000),
  recipe('pan-mushroom', t`香煎蘑菇`, [fried('mushroom', 200)]),
  recipe('potato-tomato-soup', t`番茄土豆汤`, [boiled('potato', 150), boiled('tomato', 150)], 1000),
  recipe('salmon-potato', t`香煎三文鱼配土豆`, [fried('salmon', 210), boiled('potato', 150, false)]),
  recipe('tomato-mushroom-soup', t`番茄蘑菇汤`, [boiled('tomato', 150), boiled('mushroom', 200)], 1000),
  recipe('carrot-potato-soup', t`胡萝卜土豆汤`, [boiled('carrot', 150), boiled('potato', 150)], 1000),
  recipe('salmon-tomato', t`番茄佐香煎三文鱼`, [fried('salmon', 210), boiled('tomato', 150)]),
  recipe('mushroom-potato', t`香煎蘑菇配土豆`, [fried('mushroom', 200), boiled('potato', 150)]),
  recipe('salmon-tomato-potato', t`香煎三文鱼配番茄土豆`, [fried('salmon', 210), boiled('potato', 150), boiled('tomato', 150)]),
  recipe('salmon-mushroom-potato', t`三文鱼配蘑菇土豆`, [fried('salmon', 210), fried('mushroom', 100), boiled('potato', 150)]),
  recipe('salmon-carrot-potato', t`三文鱼配胡萝卜土豆`, [fried('salmon', 210), boiled('carrot', 150), boiled('potato', 150)]),
  recipe('garden-vegetable-soup', t`田园四色蔬菜汤`, [boiled('tomato', 150), boiled('potato', 150), boiled('carrot', 150), boiled('mushroom', 100)], 1000),
  recipe('salmon-garden-platter', t`庭院丰收煎鱼拼盘`, [fried('salmon', 210), fried('mushroom', 100), boiled('potato', 150), boiled('carrot', 150), boiled('tomato', 150)]),
];

const FOODS = FOOD_KINDS;
const PORTIONS = FOOD_PORTIONS;
const STEP = 1 / 60;
const EPSILON = 1e-9;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const complete = (n: number) => n >= 1 - EPSILON ? 1 : clamp01(n);
const isFood = (item: KitchenItem): item is KitchenItem & { kind: FoodKind } => FOODS.includes(item.kind as FoodKind);
const isCookware = (item: KitchenItem) => item.kind === 'pan' || item.kind === 'pot';
const isContainer = (item: KitchenItem) => isCookware(item) || item.kind === 'plate';
const answer = (ok: boolean, message: string): KitchenActionResult => ({ ok, message });
const doneAmount = (item: KitchenItem) => item.sideCooked ? (item.sideCooked[0] + item.sideCooked[1]) / 2 : item.cooked;

function makeItem(id: string, kind: ItemKind): KitchenItem {
  return { id, kind, location: 'counter', grams: FOODS.includes(kind as FoodKind) ? PORTIONS[kind as FoodKind] : kind === 'salt' || kind === 'pepper' ? 100 : 0,
    cut: false, cooked: 0, scorched: 0, waterMl: 0, oilMl: kind === 'oil' ? 250 : 0,
    saltGrams: kind === 'salt' ? 100 : 0, pepperGrams: kind === 'pepper' ? 100 : 0, temperature: 22,
    ...(kind === 'salmon' ? { side: 0 as const, sideCooked: [0, 0] as [number, number] } : {}) };
}
function fresh(recipeId: RecipeId | null = null): KitchenState {
  const equipment: ItemKind[] = ['pan', 'pot', 'plate', 'knife', 'salt', 'pepper', 'oil'];
  return { recipeId, items: equipment.map(kind => makeItem(kind, kind)), heldId: null, burners: { left: 0, right: 0 }, result: null, elapsed: 0 };
}

export function createKitchenSimulation() {
  let state = fresh(), remainder = 0;
  const history = new Map<string, { fried: number; boiled: number }>();
  const find = (id: string) => state.items.find(item => item.id === id);
  const contents = (id: string) => state.items.filter(item => item.location === id);
  const held = () => state.heldId ? find(state.heldId) : undefined;
  const finished = () => state.result ? answer(false, t`这份菜已经出餐，重新开工后再操作。`) : undefined;

  function moveSeasoning(from: KitchenItem, to: KitchenItem, fraction = 1) {
    for (const field of ['oilMl', 'saltGrams', 'pepperGrams'] as const) {
      const amount = from[field] * fraction;
      from[field] -= amount; to[field] += amount;
    }
  }
  function take(item: KitchenItem): KitchenActionResult {
    if (state.heldId) return answer(false, t`手里已有东西，先放下再拿。`);
    if (isFood(item)) {
      const parent = find(item.location);
      if (parent && isContainer(parent)) {
        const weight = contents(parent.id).filter(isFood).reduce((sum, food) => sum + food.grams, 0);
        if (weight > 0) moveSeasoning(parent, item, item.grams / weight);
      }
    }
    item.location = 'held'; state.heldId = item.id;
    return answer(true, t`拿起了${ITEM_LABELS[item.kind]}。`);
  }
  function put(location: string): KitchenActionResult {
    const item = held();
    if (!item) return answer(false, t`手里没有可放下的物件。`);
    if (location === 'counter' || location === 'floor') {
      item.location = location;
    } else if (location === 'board') {
      if (!isFood(item)) return answer(false, t`案板用来放食材，工具先放回台面。`);
      if (contents('board').length) return answer(false, t`案板上还有食材，先拿走再放下一份。`);
      item.location = 'board';
    } else if (location === 'burner-left' || location === 'burner-right') {
      if (!isCookware(item)) return answer(false, t`炉灶上只能放煎锅或汤锅。`);
      if (contents(location).length) return answer(false, t`这个炉位已有锅具。`);
      item.location = location;
    } else {
      const target = find(location);
      if (!target || !isContainer(target) || !isFood(item)) return answer(false, t`这里不能放下手中的物件。`);
      moveSeasoning(item, target);
      item.location = target.id as ItemLocation;
    }
    state.heldId = null;
    return answer(true, t`放好了${ITEM_LABELS[item.kind]}。`);
  }
  function cut(): KitchenActionResult {
    if (held()?.kind !== 'knife') return answer(false, t`拿起菜刀再切案板上的食材。`);
    const food = contents('board').find(isFood);
    if (!food) return answer(false, t`案板上还没有食材。`);
    if (food.cut) return answer(false, t`这份食材已经切好了。`);
    food.cut = true;
    return answer(true, t`切好了${ITEM_LABELS[food.kind]}，重量保持 ${food.grams}g。`);
  }
  function pour(source: KitchenItem, plate: KitchenItem): KitchenActionResult {
    const food = contents(source.id).filter(isFood);
    if (!food.length && !source.waterMl && !source.oilMl && !source.saltGrams && !source.pepperGrams) return answer(false, t`锅里没有可以装盘的东西。`);
    const oldMass = contents(plate.id).filter(isFood).reduce((sum, item) => sum + item.grams, 0) + plate.waterMl;
    const incomingMass = food.reduce((sum, item) => sum + item.grams, 0) + (source.kind === 'pot' ? source.waterMl : 0);
    if (oldMass + incomingMass > 0) plate.temperature = (plate.temperature * oldMass + source.temperature * incomingMass) / (oldMass + incomingMass);
    for (const item of food) item.location = plate.id as ItemLocation;
    moveSeasoning(source, plate);
    if (source.kind === 'pot') { plate.waterMl += source.waterMl; source.waterMl = 0; }
    return answer(true, source.kind === 'pot' ? t`锅里的食材和汤水已倒入餐盘。` : t`煎锅里的食物已装盘。`);
  }
  function season(bottle: KitchenItem, target: KitchenItem, options?: KitchenInteractionOptions): KitchenActionResult {
    const multiplier = options?.doseMultiplier === undefined ? 1 : options.doseMultiplier;
    if (!Number.isFinite(multiplier) || multiplier < .3 || multiplier > 1.7) return answer(false, t`调味份量无效，请重新控制倒入量。`);
    const field = bottle.kind === 'oil' ? 'oilMl' : bottle.kind === 'salt' ? 'saltGrams' : 'pepperGrams';
    const dose = Math.round((bottle.kind === 'oil' ? 10 : 5) * multiplier * 10) / 10;
    if (bottle[field] < dose) return answer(false, t`${ITEM_LABELS[bottle.kind]}用完了，重新开工会补齐。`);
    bottle[field] = Math.round((bottle[field] - dose) * 10) / 10;
    target[field] += dose;
    if (bottle.kind !== 'oil') bottle.grams = Math.round((bottle.grams - dose) * 10) / 10;
    return answer(true, t`加入了 ${dose}${bottle.kind === 'oil' ? 'ml' : 'g'}${ITEM_LABELS[bottle.kind]}。`);
  }

  function evaluate(): KitchenResult {
    const plate = find('plate')!, dish = contents('plate').filter(isFood), issues: string[] = [];
    const recipe = RECIPES.find(entry => entry.id === state.recipeId)!;
    const entries = recipe.requirements;
    let ingredients = 0, method = 0, doneness = 0, incorrectMethod = false, incorrectQuantity = false;
    for (const requirement of entries) {
      const { kind, grams, method: requiredMethod, cut: needsCut } = requirement;
      const matching = dish.filter(item => item.kind === kind), actual = matching.reduce((sum, item) => sum + item.grams, 0);
      ingredients += clamp01(1 - Math.abs(actual - grams) / grams) / entries.length;
      if (actual !== grams) { incorrectQuantity = true; issues.push(t`${ITEM_LABELS[kind]}需要 ${grams}g，这盘有 ${actual}g。`); }
      let technique = 0, cooked = 0;
      for (const item of matching) {
        const record = history.get(item.id), progress = doneAmount(item);
        const correct = record?.[requiredMethod] ?? 0;
        const ratio = progress > EPSILON ? clamp01(correct / progress) : 0;
        technique += ratio * (needsCut && !item.cut ? .35 : 1) * item.grams;
        cooked += item.cooked * (1 - item.scorched) * item.grams;
        if (item.cooked < .9) issues.push(kind === 'salmon' ? t`${ITEM_LABELS[kind]}还没熟，两面都需要煎到熟透。` : t`${ITEM_LABELS[kind]}还没熟。`);
        if (item.scorched > .2) issues.push(t`${ITEM_LABELS[kind]}已经过火，下一次提早离火。`);
        if (ratio < .75) {
          incorrectMethod = true;
          issues.push(requiredMethod === 'fried' ? t`${ITEM_LABELS[kind]}应在加过油的煎锅里煎制。` : t`${ITEM_LABELS[kind]}应在有足够水的汤锅里煮熟。`);
        }
        if (needsCut && !item.cut) issues.push(t`${ITEM_LABELS[kind]}需要先切好再煮。`);
      }
      if (actual) { method += technique / actual / entries.length; doneness += cooked / actual / entries.length; }
    }
    const extra = dish.filter(item => !entries.some(entry => entry.kind === item.kind));
    if (extra.length) {
      ingredients -= extra.reduce((sum, item) => sum + item.grams, 0) / entries.reduce((sum, entry) => sum + entry.grams, 0);
      issues.push(t`这份菜谱不需要${listOf([...new Set(extra.map(item => ITEM_LABELS[item.kind]))])}。`);
    }
    if (recipe.soupWaterMl) {
      const waterScore = clamp01(1 - Math.max(0, Math.abs(plate.waterMl - recipe.soupWaterMl) - 150) / (recipe.soupWaterMl - 150));
      ingredients = ingredients * .8 + waterScore * .2;
      if (Math.abs(plate.waterMl - recipe.soupWaterMl) > 150) issues.push(t`${recipe.name}需要约 ${recipe.soupWaterMl}ml 汤水，这盘有 ${Math.round(plate.waterMl)}ml。`);
      if (plate.waterMl < 200) method *= .2;
    } else if (plate.waterMl > 100) {
      method *= .7; issues.push(t`配菜需要逐份拿出沥水，煮蔬菜的水不应倒进餐盘。`);
    }
    const salt = plate.saltGrams + dish.reduce((sum, item) => sum + item.saltGrams, 0);
    const pepper = plate.pepperGrams + dish.reduce((sum, item) => sum + item.pepperGrams, 0);
    const seasoning = (clamp01(1 - Math.abs(salt - 5) / 5) + clamp01(1 - Math.abs(pepper - 5) / 5)) / 2;
    for (const [label, amount] of [[ITEM_LABELS.salt, salt], [ITEM_LABELS.pepper, pepper]] as const) {
      if (amount < 2.5 || amount > 7.5) issues.push(amount < 2.5 ? t`${label}偏少，菜谱建议整盘 5g。` : t`${label}偏多，菜谱建议整盘 5g。`);
    }
    const breakdown = { ingredients: Math.round(clamp01(ingredients) * 100), method: Math.round(clamp01(method) * 100),
      doneness: Math.round(clamp01(doneness) * 100), seasoning: Math.round(seasoning * 100) };
    let score = Math.round(breakdown.ingredients * .35 + breakdown.method * .25 + breakdown.doneness * .3 + breakdown.seasoning * .1);
    // Correct quantities cannot compensate for a clearly unfinished or incorrectly cooked dish.
    if (incorrectQuantity || incorrectMethod || extra.length || breakdown.ingredients < 75 || breakdown.method < 75 || dish.some(item => item.cooked < .9 || item.scorched > .2)) score = Math.min(score, 79);
    if (dish.some(item => entries.some(entry => entry.kind === item.kind && entry.cut) && !item.cut)) score = Math.min(score, 79);
    if (dish.some(item => item.cooked < .5)) score = Math.min(score, 49);
    if (dish.some(item => item.scorched > .6)) score = Math.min(score, 59);
    const stars = score >= 85 ? 3 : score >= 60 ? 2 : 1;
    const unique = [...new Set(issues)];
    return { score, stars, title: stars === 3 ? t`这道菜火候正好` : stars === 2 ? t`不错的一餐` : t`再调整一下做法`,
      feedback: unique.length ? unique.join(' ') : t`分量合适，食材熟透，调味也刚好。`, issues: unique, breakdown };
  }

  function heatStep() {
    for (const vessel of state.items.filter(isContainer)) {
      const burner = vessel.location === 'burner-left' ? state.burners.left : vessel.location === 'burner-right' ? state.burners.right : 0;
      const wet = vessel.kind === 'pot' && vessel.waterMl >= 200;
      const target = burner ? wet ? burner === 2 ? 100 : 92 : burner === 2 ? 220 : 165 : 22;
      const rate = burner ? wet ? burner === 2 ? 22 : 12 : burner === 2 ? 35 : 20 : vessel.kind === 'pot' ? 8 : 12;
      const difference = target - vessel.temperature;
      vessel.temperature += Math.sign(difference) * Math.min(Math.abs(difference), rate * STEP);
      if (wet && vessel.temperature >= 95) vessel.waterMl = Math.max(0, vessel.waterMl - 2 * STEP);
    }
    for (const food of state.items.filter(isFood)) {
      const vessel = find(food.location);
      if (!vessel || !isCookware(vessel)) {
        food.temperature = Math.max(22, food.temperature - 8 * STEP); continue;
      }
      food.temperature = vessel.temperature;
      const wet = vessel.kind === 'pot' && vessel.waterMl >= 200;
      const power = wet ? food.temperature >= 72 ? clamp01((food.temperature - 65) / 25) : 0
        : Math.max(0, Math.min(1.5, (food.temperature - 80) / 85));
      if (!power) continue;
      const before = doneAmount(food);
      const overdone = food.sideCooked && !wet ? food.sideCooked[food.side!] >= 1 : food.cooked >= 1;
      if (food.sideCooked) {
        if (wet) food.sideCooked = food.sideCooked.map(value => complete(value + power * STEP / 35)) as [number, number];
        else food.sideCooked[food.side!] = complete(food.sideCooked[food.side!] + power * STEP / 30);
        food.cooked = Math.min(...food.sideCooked);
      } else food.cooked = complete(food.cooked + power * STEP / (food.cut ? 20 : food.kind === 'potato' ? 40 : 45));
      const delta = doneAmount(food) - before;
      const record = history.get(food.id)!;
      if (vessel.kind === 'pan' && vessel.oilMl >= 5) record.fried += delta;
      if (wet) record.boiled += delta;
      const burning = !wet ? Math.max(0, (food.temperature - 185) / 35) / 45 : 0;
      food.scorched = clamp01(food.scorched + STEP * (burning + (overdone ? 1 / 100 : 0)));
    }
  }

  function interact(target: string, options?: KitchenInteractionOptions): KitchenActionResult {
    const blocked = finished(); if (blocked) return blocked;
    if (typeof target !== 'string') return answer(false, t`没有可操作的目标。`);
    if (target.startsWith('source:')) {
      const kind = target.slice(7) as FoodKind;
      if (!FOODS.includes(kind)) return answer(false, t`这里没有这种食材。`);
      if (state.heldId) return answer(false, t`先放下手里的物件，再拿食材。`);
      const count = state.items.filter(item => item.kind === kind).length;
      if (count >= 4) return answer(false, t`这轮的这种食材已经取完，重新开工会补齐。`);
      const food = makeItem(`${kind}-${count + 1}`, kind);
      state.items.push(food); history.set(food.id, { fried: 0, boiled: 0 });
      return take(food);
    }
    if (target === 'heat:left' || target === 'heat:right') {
      const side = target === 'heat:left' ? 'left' : 'right';
      state.burners[side] = ((state.burners[side] + 1) % 3) as Heat;
      const heat = [t`关火`, t`小火`, t`大火`][state.burners[side]];
      return answer(true, side === 'left' ? t`左炉：${heat}。` : t`右炉：${heat}。`);
    }
    if (target === 'station:board') return held()?.kind === 'knife' ? cut() : put('board');
    if (target === 'station:counter') return put('counter');
    if (target === 'station:burner-left' || target === 'station:burner-right') return put(target.slice(8));
    if (target === 'station:sink') {
      const pot = held();
      if (pot?.kind !== 'pot') return answer(false, t`拿着汤锅对准水槽加水。`);
      if (pot.waterMl > 2000) return answer(false, t`汤锅最多装 3000ml 水。`);
      pot.temperature = (pot.temperature * (pot.waterMl + 300) + 22 * 1000) / (pot.waterMl + 1300);
      pot.waterMl += 1000;
      return answer(true, t`加入 1000ml 水，锅里共有 ${Math.round(pot.waterMl)}ml。`);
    }
    if (target === 'station:serve') {
      if (held()?.kind !== 'plate') return answer(false, t`拿起餐盘再放到出餐台。`);
      if (!state.recipeId) return answer(false, t`先选择这次想做的菜谱。`);
      state.result = evaluate();
      state.burners = { left: 0, right: 0 };
      return answer(true, t`已经出餐，看看这次的料理评价。`);
    }
    if (target.startsWith('item:')) {
      const item = find(target.slice(5));
      if (!item) return answer(false, t`这个物件已经不在这里。`);
      const carrying = held();
      if (!carrying) return take(item);
      if (carrying.kind === 'knife' && isFood(item) && item.location === 'board') return cut();
      if (isContainer(item)) {
        if (isFood(carrying)) return put(item.id);
        if (carrying.kind === 'salt' || carrying.kind === 'pepper' || carrying.kind === 'oil') return season(carrying, item, options);
        if (isCookware(carrying) && item.kind === 'plate') return pour(carrying, item);
      }
      return answer(false, t`先把手里的物件放到台面，再拿取其他东西。`);
    }
    return answer(false, t`这里暂时没有可用的操作。`);
  }

  return {
    get state(): Readonly<KitchenState> {
      return { ...state, items: state.items.map(item => ({ ...item, ...(item.sideCooked ? { sideCooked: [...item.sideCooked] as [number, number] } : {}) })),
        burners: { ...state.burners }, result: state.result && { ...state.result, issues: [...state.result.issues], breakdown: { ...state.result.breakdown } } };
    },
    chooseRecipe(id: string): KitchenActionResult {
      const blocked = finished(); if (blocked) return blocked;
      if (!RECIPES.some(recipe => recipe.id === id)) return answer(false, t`没有找到这份菜谱。`);
      if (state.recipeId === id) return answer(false, t`当前就是这份菜谱。`);
      state.recipeId = id as RecipeId;
      return answer(true, t`这次做${RECIPES.find(recipe => recipe.id === id)!.name}，台面上已有的东西都会保留。`);
    },
    interact,
    drop(location: string = 'counter'): KitchenActionResult { return finished() ?? put(location); },
    flip(): KitchenActionResult {
      const blocked = finished(); if (blocked) return blocked;
      if (state.heldId) return answer(false, t`先放下手中的物件，再给鱼翻面。`);
      const fish = contents('pan').filter(item => item.kind === 'salmon');
      if (!fish.length) return answer(false, t`煎锅里没有可以翻面的鱼。`);
      for (const item of fish) item.side = item.side === 0 ? 1 : 0;
      return answer(true, t`已经给煎锅里的鱼翻面。`);
    },
    tick(dt: number): void {
      if (state.result || !Number.isFinite(dt) || dt <= 0 || dt > .25) return;
      state.elapsed += dt; remainder += dt;
      while (remainder >= STEP - 1e-12) { heatStep(); remainder = Math.max(0, remainder - STEP); }
    },
    reset(): KitchenActionResult {
      state = fresh(state.recipeId); remainder = 0; history.clear();
      return answer(true, t`已重新备好食材和工具，炉火全部关闭。`);
    },
  };
}
