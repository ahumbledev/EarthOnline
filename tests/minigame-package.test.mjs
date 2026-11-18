import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { crc32 } from 'node:zlib';
import { createStoredZip } from '../server/package-zip.mjs';
import { MINIGAME_LIMITS, archiveGameJson, unpackMinigameZip, validateMinigamePackage } from '../server/minigame-package.mjs';
import { gameFiles, gameDefinition } from './helpers/minigame-fixture.mjs';

test('minigame ZIP validates real texture pixels and reports exact resource usage', async () => {
  const files = await gameFiles();
  const unpacked = await unpackMinigameZip(createStoredZip(files));
  const result = await validateMinigamePackage(unpacked);
  assert.equal(result.definition.id, 'test-collect'); assert.equal(result.report.imagePixels, 16);
  assert.equal(result.report.images.tile.width, 4); assert.equal(result.report.images.tile.format, 'png');
  assert.equal(result.report.unpackedBytes, [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0));
  const json = Buffer.from(JSON.stringify(gameDefinition()));
  assert.deepEqual((await unpackMinigameZip(archiveGameJson(json))).get('game.json'), json);
});

test('unsafe paths, executable/source uploads, non-package roots and CRC corruption are rejected', async () => {
  for (const path of ['../game.json', 'assets/../../evil.png', '/game.json', 'assets\\evil.png', 'source/run.js', 'source/game.blend', 'assets/run.js', 'outside/game.json']) {
    await assert.rejects(unpackMinigameZip(createStoredZip(new Map([[path, Buffer.from('{}')]]))), error => error.status === 400);
  }
  const duplicate = createStoredZip(new Map([['assets/test.png', Buffer.from('x')], ['assets/TEST.png', Buffer.from('y')]]));
  await assert.rejects(unpackMinigameZip(duplicate), error => error.status === 400);
  for (const entries of [[['assets/folder.png', 'x'], ['assets/folder.png/nested.png', 'y']], [['assets/folder.png/nested.png', 'y'], ['assets/folder.png', 'x']]]) {
    await assert.rejects(unpackMinigameZip(createStoredZip(new Map(entries))), error => error.status === 400);
  }
  const bytes = createStoredZip(await gameFiles()); bytes[30 + Buffer.byteLength('assets/tile.png')] ^= 1;
  await assert.rejects(unpackMinigameZip(bytes), error => error.status === 400);
});

test('definition/schema/missing-image errors preserve actionable JSON paths', async () => {
  await assert.rejects(validateMinigamePackage(new Map()), error => error.issues[0].path === '/game.json');
  const invalid = await gameFiles({ textured: false }); invalid.set('game.json', Buffer.from('{'));
  await assert.rejects(validateMinigamePackage(invalid), error => error.code === 'invalid_json');
  const unknown = gameDefinition({ script: 'globalThis.fetch("https://example.invalid")' });
  await assert.rejects(validateMinigamePackage(await gameFiles({ textured: false, definition: unknown })), error => error.code === 'invalid_game_definition' && error.issues.some(issue => issue.path.includes('script')));
  const missing = await gameFiles(); missing.delete('assets/tile.png');
  await assert.rejects(validateMinigamePackage(missing), error => error.code === 'missing_asset' && error.issues[0].path === '/assets/tile/path');
  const extra = await gameFiles(); extra.set('assets/unused.png', extra.get('assets/tile.png'));
  await assert.rejects(validateMinigamePackage(extra), error => error.code === 'undeclared_file');
  await assert.rejects(async () => archiveGameJson(Buffer.alloc(MINIGAME_LIMITS.definitionBytes + 1)), error => error.code === 'definition_too_large');
});

test('image extension lies, corrupt images and oversized images cannot publish', async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#404040' } }).jpeg().toBuffer();
  const large = await sharp({ create: { width: 2049, height: 1, channels: 3, background: '#404040' } }).png().toBuffer();
  for (const replacement of [Buffer.from('<svg/>'), jpeg, large, (await gameFiles()).get('assets/tile.png').subarray(0, 50)]) {
    const files = await gameFiles(); files.set('assets/tile.png', replacement);
    await assert.rejects(validateMinigamePackage(files), error => error.code === 'invalid_image');
  }
});

test('animated WebP and APNG are rejected even when the first frame decodes', async () => {
  const animated = await sharp(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  const game = gameDefinition({ assets: { tile: { path: 'assets/tile.webp' } } }); game.entities[0].texture = 'tile';
  const files = new Map([['game.json', Buffer.from(JSON.stringify(game))], ['assets/tile.webp', animated]]);
  await assert.rejects(validateMinigamePackage(files), error => error.code === 'invalid_image');
  const pngFiles = await gameFiles(), png = pngFiles.get('assets/tile.png');
  const control = Buffer.alloc(20); control.writeUInt32BE(8); control.write('acTL', 4); control.writeUInt32BE(2, 8);
  control.writeUInt32BE(crc32(control.subarray(4, 16)), 16);
  pngFiles.set('assets/tile.png', Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]));
  await assert.rejects(validateMinigamePackage(pngFiles), error => error.code === 'invalid_image');
});
