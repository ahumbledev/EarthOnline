import type { FacadeCity } from './types.ts';

/** The original Hong Kong values, preserved verbatim for visual compatibility. */
export const HONG_KONG: FacadeCity = {
  id: 'hong-kong',
  styles: ['lowrise', 'tonglau', 'composite', 'tower', 'glass', 'podium', 'infrastructure'],
  parameters: /* glsl */`const float BC_FLOOR[7] = float[7](3.3, 3.15, 2.9, 2.95, 3.9, 4.6, 4.0);
const float BC_BAY[7] = float[7](3.6, 2.9, 3.1, 3.4, 1.5, 6.0, 8.0);
const float BC_OCCUPIED[7] = float[7](0.35, 0.5, 0.58, 0.55, 0.32, 0.2, 0.0);
const vec3 BC_WALLS[42] = vec3[42](
  vec3(0.82, 0.80, 0.75), vec3(0.75, 0.77, 0.75), vec3(0.85, 0.79, 0.66), vec3(0.70, 0.70, 0.68), vec3(0.80, 0.74, 0.70), vec3(0.66, 0.72, 0.76),
  vec3(0.85, 0.80, 0.69), vec3(0.79, 0.82, 0.74), vec3(0.89, 0.76, 0.71), vec3(0.78, 0.78, 0.77), vec3(0.89, 0.80, 0.56), vec3(0.73, 0.78, 0.83),
  vec3(0.81, 0.77, 0.66), vec3(0.56, 0.44, 0.35), vec3(0.84, 0.84, 0.81), vec3(0.85, 0.69, 0.65), vec3(0.62, 0.71, 0.65), vec3(0.76, 0.71, 0.61),
  vec3(0.91, 0.89, 0.85), vec3(0.90, 0.76, 0.69), vec3(0.85, 0.80, 0.71), vec3(0.81, 0.83, 0.84), vec3(0.93, 0.87, 0.68), vec3(0.78, 0.70, 0.63),
  vec3(0.44, 0.58, 0.69), vec3(0.37, 0.58, 0.53), vec3(0.54, 0.58, 0.61), vec3(0.60, 0.50, 0.36), vec3(0.50, 0.64, 0.75), vec3(0.31, 0.44, 0.54),
  vec3(0.81, 0.82, 0.80), vec3(0.90, 0.89, 0.85), vec3(0.72, 0.71, 0.67), vec3(0.85, 0.82, 0.77), vec3(0.62, 0.64, 0.66), vec3(0.88, 0.84, 0.74),
  vec3(0.58, 0.57, 0.55), vec3(0.62, 0.61, 0.58), vec3(0.54, 0.54, 0.53), vec3(0.60, 0.59, 0.57), vec3(0.56, 0.56, 0.54), vec3(0.64, 0.62, 0.58));`,
  trades: [
  '茶餐廳', '藥房', '五金', '海味', '粥麵', '找換店', '髮型屋', '電器',
  '文具', '生果', '燒臘', '洗衣', '眼鏡', '鐘錶', '花店', '麵包',
  '雜貨', '診所', '涼茶', '車仔麵', '甜品', '鮮肉', '玉器', '布藝',
  '茶莊', '書店', '玩具', '鞋店', '時裝', '手機配件', '地產', '補習社',
],
  palette: [
  ['#b3221c', '#fff3d2'], ['#f4efe2', '#b3221c'], ['#f2c531', '#1c1a17'], ['#14603a', '#fbf3d0'],
  ['#1d3f8a', '#ffffff'], ['#161616', '#f0c040'], ['#e9e2d0', '#1a1a1a'], ['#7a1016', '#f6d36a'],
  ['#0f6b70', '#ffffff'], ['#f08a1c', '#ffffff'], ['#ffffff', '#1d3f8a'], ['#3a2412', '#f3e3b8'],
],
  font: '"PingFang HK","PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei","Heiti TC",sans-serif',
  signWriting: 'han',
};
