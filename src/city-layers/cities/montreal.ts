import type { FacadeCity } from './types.ts';
import { MONTREAL_FRAGMENT } from './montreal-shader.ts';
import { MONTREAL_GROUND_PARS } from './montreal-ground.ts';
import { MONTREAL_SHOP_HASH } from './montreal-shops.ts';
import { MONTREAL_GLASS } from './montreal-glass.ts';
import { MONTREAL_MASONRY } from './montreal-masonry.ts';
import { MONTREAL_OPENINGS } from './montreal-openings.ts';

/** Inferred architectural families, not surveyed window positions or present-day tenants. */
export const MONTREAL: FacadeCity = {
  id: 'montreal',
  styles: ['greystone', 'warehouse', 'plex', 'postwar', 'glass', 'civic', 'infrastructure'],
  fragment: MONTREAL_FRAGMENT,
  parameters: /* glsl */`const float BC_FLOOR[7] = float[7](3.5, 3.8, 3.1, 3.1, 3.8, 5.0, 4.0);
const float BC_BAY[7] = float[7](2.8, 3.5, 3.0, 3.5, 1.5, 5.8, 8.0);
const float BC_OCCUPIED[7] = float[7](0.4, 0.3, 0.48, 0.24, 0.2, 0.1, 0.0);
const vec3 BC_WALLS[42] = vec3[42](
  vec3(0.64, 0.63, 0.58), vec3(0.7, 0.68, 0.61), vec3(0.56, 0.57, 0.54), vec3(0.75, 0.72, 0.64), vec3(0.61, 0.60, 0.56), vec3(0.67, 0.65, 0.59),
  vec3(0.57, 0.32, 0.23), vec3(0.48, 0.27, 0.2), vec3(0.62, 0.4, 0.29), vec3(0.47, 0.33, 0.27), vec3(0.66, 0.43, 0.3), vec3(0.54, 0.36, 0.29),
  vec3(0.61, 0.59, 0.53), vec3(0.57, 0.35, 0.26), vec3(0.65, 0.62, 0.55), vec3(0.49, 0.29, 0.22), vec3(0.62, 0.42, 0.31), vec3(0.55, 0.53, 0.49),
  vec3(0.72, 0.7, 0.65), vec3(0.64, 0.59, 0.51), vec3(0.76, 0.74, 0.68), vec3(0.54, 0.4, 0.31), vec3(0.69, 0.68, 0.64), vec3(0.62, 0.62, 0.59),
  vec3(0.4, 0.53, 0.59), vec3(0.35, 0.49, 0.5), vec3(0.49, 0.54, 0.56), vec3(0.44, 0.47, 0.46), vec3(0.4, 0.51, 0.61), vec3(0.32, 0.42, 0.48),
  vec3(0.68, 0.67, 0.61), vec3(0.61, 0.6, 0.55), vec3(0.73, 0.69, 0.6), vec3(0.58, 0.59, 0.56), vec3(0.66, 0.64, 0.58), vec3(0.76, 0.74, 0.68),
  vec3(0.57, 0.57, 0.55), vec3(0.62, 0.61, 0.57), vec3(0.53, 0.54, 0.52), vec3(0.6, 0.59, 0.56), vec3(0.56, 0.56, 0.53), vec3(0.64, 0.62, 0.58));
${MONTREAL_GROUND_PARS}
${MONTREAL_SHOP_HASH}
${MONTREAL_GLASS}
${MONTREAL_MASONRY}
${MONTREAL_OPENINGS}`,
  trades: ['Boulangerie', 'Café', 'Librairie', 'Fleuriste', 'Dépanneur', 'Pharmacie', 'Quincaillerie', 'Nettoyeur',
    'Coiffeur', 'Épicerie', 'Boucherie', 'Fromagerie', 'Pâtisserie', 'Bistro', 'Galerie', 'Antiquités',
    'Chocolaterie', 'Cordonnier', 'Buanderie', 'Papeterie', 'Opticien', 'Bijouterie', 'Crêperie', 'Tabagie'],
  palette: [['#e2d5b5', '#2f332b'], ['#213d32', '#f1dfb7'], ['#5a2724', '#eddbb9'], ['#252f3b', '#f0e2c4'],
    ['#342e28', '#dfcaa1'], ['#d8c7a6', '#56382e']],
  font: 'Georgia,"Times New Roman",serif',
  signWriting: 'latin',
};
