import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createMinigameZip } from './minigame-archive.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  ['LICENSE', 'LICENSE'],
  ['PROTOCOL.md', 'public/minigames/PROTOCOL.md'],
  ['game.json', 'public/minigames/examples/collect.json'],
  ['shared/minigame-protocol.mjs', 'shared/minigame-protocol.mjs'],
  ['shared/minigame-runtime.mjs', 'shared/minigame-runtime.mjs'],
  ['shared/minigame-sync.mjs', 'shared/minigame-sync.mjs'],
  ['scripts/minigame.mjs', 'scripts/minigame.mjs'],
  ['scripts/minigame-archive.mjs', 'scripts/minigame-archive.mjs'],
  ...['collect', 'switches', 'survival', 'cooperative', 'standard8', 'party16'].map(name => [`examples/${name}.json`, `public/minigames/examples/${name}.json`]),
  ['tests/survival-win.json', 'public/minigames/replays/survival-win.json'],
  ...['cooperative', 'standard8', 'party16'].map(name => [`tests/${name}-win.json`, `public/minigames/replays/${name}-win.json`]),
];
const entries = await Promise.all(files.map(async ([target, source]) => [target, await readFile(resolve(root, source))]));
const archive = createMinigameZip(entries), output = resolve(root, 'public/minigames/creator-kit.zip');
await mkdir(dirname(output), { recursive: true }); await writeFile(output, archive);
// The public kit is a deliberate tool download, never an accepted game archive.
process.stdout.write(JSON.stringify({ file: 'public/minigames/creator-kit.zip', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), files: entries.map(([name]) => name) }) + '\n');
