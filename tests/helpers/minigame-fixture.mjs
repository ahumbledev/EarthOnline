import sharp from 'sharp';
import { createStoredZip } from '../../server/package-zip.mjs';

export function gameDefinition(overrides = {}) {
  return { schemaVersion: 1, id: 'test-collect', title: 'Collect test', description: 'Collect one token.', author: 'Test fixture', version: '1.0.0', players: 1,
    arena: { width: 16, depth: 16, spawn: [0, 0], playerSpeed: 4, playerRadius: 0.35, material: 'concrete' },
    entities: [{ id: 'token', shape: 'sphere', position: [3, 0.5, 0], size: [1, 1, 1], material: 'stone', trigger: true }],
    variables: { score: 0 }, rules: [{ id: 'collect', on: { type: 'enter', entity: 'token' }, once: true,
      actions: [{ type: 'add', variable: 'score', value: 1 }, { type: 'win' }] }], ...overrides };
}
export async function gameFiles({ textured = true, definition } = {}) {
  const game = definition ?? gameDefinition();
  const files = new Map();
  if (textured) {
    game.assets = { tile: { path: 'assets/tile.png' } }; game.entities[0].texture = 'tile';
    files.set('assets/tile.png', await sharp({ create: { width: 4, height: 4, channels: 4, background: '#588080' } }).png().toBuffer());
  }
  files.set('game.json', Buffer.from(JSON.stringify(game)));
  return files;
}
export async function gameArchive(options) { return createStoredZip(await gameFiles(options)); }
