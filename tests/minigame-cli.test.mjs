import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { runMinigameCli } from '../scripts/minigame.mjs';

const exec = promisify(execFile), fixturePath = new URL('../public/minigames/examples/collect.json', import.meta.url);
const example = async () => JSON.parse(await readFile(fixturePath, 'utf8'));
async function temporary(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'minigame-kit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function entries(bytes) {
  return new Promise((accept, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, archive) => {
    if (error) return reject(error);
    const files = new Map(); archive.on('error', reject); archive.on('end', () => accept(files));
    archive.on('entry', item => archive.openReadStream(item, (error, stream) => {
      if (error) return reject(error);
      const chunks = []; stream.on('error', reject); stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => { files.set(item.fileName, Buffer.concat(chunks)); archive.readEntry(); });
    })); archive.readEntry();
  }));
}

test('creator CLI reports exact invalid definition and checks real replay expectations', async t => {
  const dir = await temporary(t), game = await example(), gamePath = resolve(dir, 'game.json');
  await writeFile(gamePath, JSON.stringify(game));
  assert.equal((await runMinigameCli(['validate', gamePath])).valid, true);
  game.rules = [{ id: 'instant-win', on: { type: 'start' }, actions: [{ type: 'win' }] }];
  await writeFile(gamePath, JSON.stringify(game));
  const replay = resolve(dir, 'win.json');
  await writeFile(replay, JSON.stringify({ steps: [{ frames: 1, input: { x: 0, z: 0 } }], expect: { status: 'won' } }));
  assert.equal((await runMinigameCli(['replay', gamePath, replay])).valid, true);
  await writeFile(replay, JSON.stringify({ steps: [], expect: { status: 'lost' } }));
  assert.equal((await runMinigameCli(['replay', gamePath, replay])).valid, false);
  await writeFile(replay, JSON.stringify({ steps: [], expect: { status: 'won' }, runtimeVersion: 'future-runtime' }));
  await assert.rejects(runMinigameCli(['replay', gamePath, replay]), /Replay needs runtime/);
  game.rules[0].actions = [{ type: 'fetch', url: 'https://invalid.example' }];
  await writeFile(gamePath, JSON.stringify(game));
  await assert.rejects(runMinigameCli(['validate', gamePath]), error => error.issues.some(issue => issue.path.startsWith('/rules/0')));
});

test('cooperative CLI replays the complete roster and rejects foreign actors or solo-shaped inputs', async t => {
  const dir = await temporary(t), game = await example();
  game.schemaVersion = 2; game.players = { min: 2, max: 2 };
  game.arena.spawns = [game.arena.spawn, [game.arena.spawn[0], game.arena.spawn[1] + 1]];
  delete game.arena.spawn;
  game.entities = [
    { id: 'left', shape: 'box', material: 'timber', position: [-3, .5, 0], size: [1, 1, 1], interactable: true },
    { id: 'right', shape: 'box', material: 'stone', position: [3, .5, 0], size: [1, 1, 1], interactable: true },
  ];
  game.arena.spawns = [[-3, 0], [3, 0]];
  game.variables = { ready: 0 }; game.timers = [];
  game.rules = [
    ...['left', 'right'].map(id => ({ id: `press-${id}`, on: { type: 'interact', entity: id }, once: true, actions: [{ type: 'add', variable: 'ready', value: 1 }] })),
    ...['left', 'right'].map(id => ({ id: `win-${id}`, on: { type: 'interact', entity: id }, when: [{ variable: 'ready', op: 'eq', value: 2 }], actions: [{ type: 'win' }] })),
  ];
  const gamePath = resolve(dir, 'game.json'), replayPath = resolve(dir, 'replay.json');
  await writeFile(gamePath, JSON.stringify(game));
  const replay = { players: [{ id: 'alice', slot: 0 }, { id: 'bob', slot: 1 }], steps: [{ frames: 1,
    inputs: { alice: { x: 0, z: 0, interact: true }, bob: { x: 0, z: 0, interact: true } } }], expect: { status: 'won', variables: { ready: 2 } } };
  await writeFile(replayPath, JSON.stringify(replay));
  const report = await runMinigameCli(['replay', gamePath, replayPath]);
  assert.equal(report.valid, true); assert.equal(report.snapshot.players.length, 2);
  delete replay.steps[0].inputs.bob; replay.expect = { status: 'playing', variables: { ready: 1 } };
  await writeFile(replayPath, JSON.stringify(replay));
  assert.equal((await runMinigameCli(['replay', gamePath, replayPath])).valid, true);
  replay.steps[0].inputs.stranger = { x: 0, z: 0 };
  await writeFile(replayPath, JSON.stringify(replay));
  await assert.rejects(runMinigameCli(['replay', gamePath, replayPath]), /roster player ID/);
  delete replay.steps[0].inputs; replay.steps[0].input = { x: 0, z: 0 };
  await writeFile(replayPath, JSON.stringify(replay));
  await assert.rejects(runMinigameCli(['replay', gamePath, replayPath]), /roster player ID/);
});

test('pack collects only declared game content and never overwrites output or follows asset links', async t => {
  const dir = await temporary(t), game = await example();
  await writeFile(resolve(dir, 'game.json'), JSON.stringify(game));
  await writeFile(resolve(dir, '.env'), 'PRIVATE=must-not-leak');
  await writeFile(resolve(dir, 'run.js'), 'throw new Error("must not execute")');
  const zip = resolve(dir, 'game.zip');
  const result = await runMinigameCli(['pack', dir, zip]);
  assert.deepEqual(result.files, ['game.json']);
  const files = await entries(await readFile(zip));
  assert.deepEqual([...files.keys()], ['game.json']);
  await assert.rejects(runMinigameCli(['pack', dir, zip]), error => error.code === 'EEXIST');
  await mkdir(resolve(dir, 'assets'));
  await symlink(resolve(dir, '.env'), resolve(dir, 'assets', 'leak.png'));
  game.assets = { leak: { path: 'assets/leak.png' } }; game.entities[0].texture = 'leak';
  await writeFile(resolve(dir, 'game.json'), JSON.stringify(game));
  await assert.rejects(runMinigameCli(['pack', dir, resolve(dir, 'unsafe.zip')]), /symlink/);
});

test('portable creator kit includes current rules and runs without repository dependencies', async t => {
  const dir = await temporary(t), archive = await readFile(new URL('../public/minigames/creator-kit.zip', import.meta.url));
  const files = await entries(archive);
  for (const name of ['shared/minigame-protocol.mjs', 'shared/minigame-runtime.mjs', 'scripts/minigame.mjs', 'scripts/minigame-archive.mjs']) {
    assert.deepEqual(files.get(name), await readFile(new URL(`../${name}`, import.meta.url)), `Regenerate stale creator kit: ${name}`);
  }
  for (const [name, bytes] of files) { await mkdir(dirname(resolve(dir, name)), { recursive: true }); await writeFile(resolve(dir, name), bytes); }
  const output = await exec(process.execPath, ['scripts/minigame.mjs', 'validate', 'game.json'], { cwd: dir });
  assert.equal(JSON.parse(output.stdout).valid, true);
  const packed = await exec(process.execPath, ['scripts/minigame.mjs', 'pack', '.', 'standalone.zip'], { cwd: dir });
  assert.equal(JSON.parse(packed.stdout).valid, true);
  assert.deepEqual([... (await entries(await readFile(resolve(dir, 'standalone.zip')))).keys()], ['game.json']);
  const replay = await exec(process.execPath, ['scripts/minigame.mjs', 'replay', 'examples/survival.json', 'tests/survival-win.json'], { cwd: dir });
  assert.equal(JSON.parse(replay.stdout).valid, true);
  const coop = await exec(process.execPath, ['scripts/minigame.mjs', 'replay', 'examples/cooperative.json', 'tests/cooperative-win.json'], { cwd: dir });
  assert.equal(JSON.parse(coop.stdout).valid, true);
  assert.equal(JSON.parse(coop.stdout).snapshot.players.length, 2);
});
