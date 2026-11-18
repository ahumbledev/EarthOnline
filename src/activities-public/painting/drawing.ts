export const MAX_ARTWORK_CHARS = 180_000;
const PAINTING_COORDINATE_SCALE = 10_000;
import { t } from '../language.ts';
export type BrushKind = 'brush' | 'spray' | 'steady';
export interface Stroke {
  color: string;
  width: number;
  points: [number, number][];
  tool?: BrushKind;
  seed?: number;
}
export interface Drawing { version: 1; strokes: Stroke[]; aspect?: number }
export const MAX_POINTS = 100_000;
export const MAX_STROKES = 1000;
export const PAPER = '#f5f2e9';
export const PALETTE = ['#242a2b','#737b80','#dce1df','#63432e','#b17b56','#e4cda0','#7e202a','#e34b42','#eda6ad','#ee8946','#e4b943','#f0d96c','#285d42','#398962','#a7ba64','#244a68','#357fa6','#94c6d6','#343d78','#6967ad','#afb2d2','#814c86','#b773ae','#d5b3cf'];

export function parseDrawing(value: string): Drawing {
  if (typeof value !== 'string' || value.length > 4_000_000) throw Error(t`画作数据过大`);
  const drawing = JSON.parse(value) as Drawing;
  if (!drawing || drawing.version !== 1 || !Array.isArray(drawing.strokes) || drawing.strokes.length > MAX_STROKES) throw Error('Invalid drawing');
  if (drawing.aspect !== undefined && (!Number.isFinite(drawing.aspect) || drawing.aspect < .5 || drawing.aspect > 2)) throw Error('Invalid canvas aspect');
  let total = 0;
  for (const stroke of drawing.strokes) {
    if (!stroke || !/^#[0-9a-f]{6}$/i.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 100 || !Array.isArray(stroke.points)) throw Error('Invalid stroke');
    if (stroke.tool !== undefined && !['brush','spray','steady'].includes(stroke.tool)) throw Error('Invalid drawing tool');
    if (stroke.tool === 'spray' && (!Number.isInteger(stroke.seed) || stroke.seed! < 0 || stroke.seed! > 0xffffffff)) throw Error('Invalid spray seed');
    total += stroke.points.length;
    if (total > MAX_POINTS || !stroke.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) throw Error('Invalid drawing coordinates');
  }
  return drawing;
}

// One persisted point is one 1/60 s spray stamp. The seed makes replay exact.
export function sprayDots(stroke: Stroke, index: number): [number, number][] {
  let state = ((stroke.seed ?? 0) ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  const radius = stroke.width / 2;
  const count = Math.max(2, Math.min(200, Math.round(Math.PI * radius * radius * .035)));
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * radius;
    return [Math.cos(angle) * distance, Math.sin(angle) * distance];
  });
}

export function sprayTicks(elapsed: number, remainder: number) {
  const accumulated = Math.max(0, Math.min(elapsed, .1)) + remainder;
  const count = Math.floor((accumulated + 1e-9) * 60);
  return { count, remainder: Math.max(0, accumulated - count / 60) };
}

export function steadyPoint(from: [number, number], to: [number, number], elapsed: number): [number, number] {
  const alpha = 1 - Math.exp(-Math.max(0, Math.min(elapsed, .1)) * 10);
  return [from[0] + (to[0] - from[0]) * alpha, from[1] + (to[1] - from[1]) * alpha];
}

export function renderStrokePoint(canvas: HTMLCanvasElement, stroke: Stroke, index: number) {
  const context = canvas.getContext('2d')!;
  const point = stroke.points[index], scale = canvas.width / 1024;
  context.fillStyle = context.strokeStyle = stroke.color;
  if (stroke.tool === 'spray') {
    context.save(); context.beginPath(); context.rect(0, 0, canvas.width, canvas.height); context.clip();
    for (const [x, y] of sprayDots(stroke, index)) context.fillRect(Math.floor(point[0] * canvas.width + x * scale), Math.floor(point[1] * canvas.height + y * scale), Math.max(1, scale), Math.max(1, scale));
    context.restore();
  } else {
    context.lineWidth = stroke.width * scale;
    context.lineCap = context.lineJoin = 'round';
    context.beginPath();
    if (index === 0) {
      context.arc(point[0] * canvas.width, point[1] * canvas.height, context.lineWidth / 2, 0, Math.PI * 2); context.fill();
    } else {
      const previous = stroke.points[index - 1];
      context.moveTo(previous[0] * canvas.width, previous[1] * canvas.height);
      context.lineTo(point[0] * canvas.width, point[1] * canvas.height); context.stroke();
    }
  }
}

export function renderDrawing(canvas: HTMLCanvasElement, drawing: Drawing) {
  const context = canvas.getContext('2d')!;
  context.fillStyle = PAPER; context.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of drawing.strokes) for (let index = 0; index < stroke.points.length; index++) renderStrokePoint(canvas, stroke, index);
}

/** Coordinates retain subpixel precision on the 1024px working canvas. */
export const quantizePoint = (point: [number,number]): [number,number] => point.map(value=>Math.round(value*PAINTING_COORDINATE_SCALE)/PAINTING_COORDINATE_SCALE) as [number,number];
export function compactDrawing(drawing: Drawing): Drawing {
  return {...drawing,strokes:drawing.strokes.map(stroke=>({...stroke,points:stroke.points.map(quantizePoint)}))};
}
export function serializeDrawing(drawing: Drawing) {
  const value=JSON.stringify(compactDrawing(drawing));
  if(value.length>MAX_ARTWORK_CHARS)throw Error(t`画作已达到保存容量，请撤销部分笔迹或导出 PNG。`);
  parseDrawing(value);return value;
}
