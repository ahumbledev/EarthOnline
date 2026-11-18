import { parseDrawing, type Drawing } from './drawing.ts';
import { t } from '../language.ts';

/** Save and validate a local sketch without overwriting another open tab. */
export function openSketchbookSave(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, sceneKey: string, owner: string) {
  const key = `sketchbook:v1:${encodeURIComponent(sceneKey)}:${encodeURIComponent(owner)}`;
  let expected = storage.getItem(key);
  const initial = expected === null ? undefined : JSON.stringify(parseDrawing(expected));
  return {
    key, initial,
    clear() { storage.removeItem(key); expected = null; },
    save(drawing: Drawing) {
      const value = JSON.stringify(drawing); parseDrawing(value);
      if (storage.getItem(key) !== expected) throw Error(t`另一窗口已更新画稿，请先导出备份，再刷新读取新版本`);
      storage.setItem(key, value); expected = value;
    },
  };
}
