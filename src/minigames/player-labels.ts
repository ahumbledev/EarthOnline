

/** Names players typed stay as written; only the server's default "玩家 N" is translated. */
export function displayPlayerName(name: string | undefined, slot?: number): string {
  if (name == null) return slot === undefined ? '' : `Player ${slot + 1}`;
  return /^玩家 \d+$/.test(name) ? name.replace('玩家', 'Player') : name;
}

interface LabelAnchor { id: string; x: number; y: number; width: number; height: number }
interface LabelBox extends LabelAnchor {}

/** Keep names near their actor while separating dense rows of up to 16 labels. */
export function placeWorkshopLabels(labels: LabelAnchor[], width: number, height: number): LabelBox[] {
  const placed: LabelBox[] = [], gap = 3;
  for (const label of labels) {
    const w = Math.min(width, label.width), h = Math.min(height, label.height);
    const x = Math.max(0, Math.min(width - w, label.x - w / 2));
    const preferred = Math.max(0, Math.min(height - h, label.y - h));
    const overlaps = (y: number, other: LabelBox) => x < other.x + other.width + gap && x + w + gap > other.x
      && y < other.y + other.height + gap && y + h + gap > other.y;
    const candidates = [preferred, ...placed.flatMap(other => [other.y - h - gap, other.y + other.height + gap])]
      .filter(y => y >= 0 && y + h <= height).sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
    const y = candidates.find(candidate => placed.every(other => !overlaps(candidate, other))) ?? preferred;
    placed.push({ id: label.id, x, y, width: w, height: h });
  }
  return placed;
}
