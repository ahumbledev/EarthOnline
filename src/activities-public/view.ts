import type { WebGLRenderer } from 'three';

export interface RenderQuality {
  level: 'low' | 'high';
  shadowMapSize: number;
}

export interface GameViewContext {
  container: HTMLElement;
  renderer: WebGLRenderer;
  quality?: RenderQuality;
}

export interface GameView {
  activate(): void;
  deactivate(): void;
  render(now: number): void;
  resize(width: number, height: number): void;
  setQuality(quality: RenderQuality): void;
  dispose(): void;
}
