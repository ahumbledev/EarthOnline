export type Ing = 'espresso' | 'milk' | 'foam' | 'water';
export type CupKind = 'demi' | 'small' | 'medium' | 'large';
export const DOSE = 9, SHOT = 30, BASKET = 27;
export const yieldOf = (grams: number) => grams / DOSE * SHOT;
export interface Recipe { name: string; kind: CupKind; blend?: boolean; parts(kind: CupKind): Partial<Record<Ing, number>> }
function recipe(name: string, kind: CupKind, target: Partial<Record<Ing, number>>): Recipe {
  return { name, kind, parts: () => target };
}
export const recipes = [
  recipe('浓缩练习', 'demi', { espresso: 30 }),
  recipe('双份长黑', 'small', { espresso: 60, water: 105 }),
  recipe('奶咖练习', 'small', { espresso: 30, milk: 78, foam: 12 }),
];
export interface Cup { kind: CupKind; fills: Partial<Record<Ing, number>>; hot: number; drawn: boolean; blended?: boolean }
export const volume = (fills: Partial<Record<Ing, number>>) => Object.values(fills).reduce((a, n) => a + (n ?? 0), 0);

export type Grade = 'perfect' | 'good' | 'fair' | 'poor' | 'bad';
export const gradeOf = (score: number): Grade => score >= 90 ? 'perfect' : score >= 70 ? 'good' : score >= 40 ? 'fair' : score >= 25 ? 'poor' : 'bad';
/**
 * 0–100 for one cup against one drink. Each ingredient scores by how close its volume is, too much and too little
 * alike, weighted by its share of the drink, so the milk matters more than the syrup. Things that do not belong,
 * the wrong cup and an incorrect preparation style reduce the score.
 */
export function scoreCup(cup: Cup, recipe: Recipe, kind: CupKind): number {
  const want = recipe.parts(kind);
  let whole = 0, got = 0, belongs = 0;
  for (const [id, target] of Object.entries(want) as [Ing, number][]) {
    const have = cup.fills[id] ?? 0;
    whole += target; belongs += have; got += target * Math.max(0, 1 - Math.abs(have - target) / target);
  }
  const all = volume(cup.fills);
  let score = 100 * got / whole * (all > 0 ? belongs / all : 1);
  if (cup.kind !== kind) score *= .6;
  if (!!recipe.blend !== !!cup.blended) score *= .5;
  return Math.round(score);
}
