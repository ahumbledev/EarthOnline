#!/usr/bin/env node
import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateGameDefinition } from '../shared/minigame-protocol.mjs';
import { createGameRuntime, createMultiplayerRuntime, FIXED_DT, MINIGAME_RUNTIME_VERSION, MINIGAME_COMPATIBLE_REPLAY_VERSIONS } from '../shared/minigame-runtime.mjs';
import { createMinigameZip } from './minigame-archive.mjs';

const MAX_JSON = 512 * 1024, MAX_IMAGE = 8 * 1024 * 1024, MAX_ARCHIVE = 32 * 1024 * 1024;
async function readLimited(file, limit) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error(`Expected a regular file within ${limit} bytes: ${file}`);
  return readFile(file);
}
async function definition(file) {
  const data = JSON.parse((await readLimited(file, MAX_JSON)).toString('utf8'));
  const result = validateGameDefinition(data);
  if (!result.valid) throw Object.assign(new Error('Game definition is invalid.'), { issues: result.issues });
  return data;
}

/** Local creator tooling only. It never uploads, publishes, or executes package code. */
export async function runMinigameCli(args) {
  const [command, source, destination] = args;
  if (command === 'validate' && source && !destination) {
    const game = await definition(resolve(source));
    return { valid: true, gameId: game.id, version: game.version, entities: game.entities.length, rules: game.rules.length, issues: [] };
  }
  if (command === 'pack' && source && destination && args.length === 3) {
    const root = await realpath(resolve(source)), game = await definition(resolve(root, 'game.json'));
    const entries = [['game.json', await readLimited(resolve(root, 'game.json'), MAX_JSON)]];
    const packed = new Set(['game.json']); let total = entries[0][1].length;
    for (const asset of Object.values(game.assets ?? {})) {
      if (packed.has(asset.path)) continue;
      const file = resolve(root, asset.path), actual = await realpath(file), rel = relative(root, actual);
      if (rel.startsWith('..') || isAbsolute(rel) || actual !== file) throw new Error(`Asset escapes the package or uses a symlink: ${asset.path}`);
      const bytes = await readLimited(file, MAX_IMAGE); total += bytes.length;
      if (total > MAX_ARCHIVE - 65536) throw new Error('Package exceeds 32 MiB.');
      entries.push([asset.path, bytes]); packed.add(asset.path);
    }
    for (const name of ['README.md', 'provenance.json', 'LICENSE.txt']) {
      try { entries.push([name, await readLimited(resolve(root, name), MAX_JSON)]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const archive = createMinigameZip(entries);
    if (archive.length > MAX_ARCHIVE) throw new Error('Package exceeds 32 MiB.');
    await writeFile(resolve(destination), archive, { flag: 'wx' });
    return { valid: true, gameId: game.id, file: resolve(destination), bytes: archive.length, files: entries.map(([name]) => name), note: 'Server upload also decodes and checks image resources.' };
  }
  if (command === 'replay' && source && destination && args.length <= 4) {
    const game = await definition(resolve(source)), replay = JSON.parse((await readLimited(resolve(destination), MAX_JSON)).toString('utf8'));
    if (!replay || !Array.isArray(replay.steps) || replay.steps.length > 1024) throw new Error('Replay requires at most 1024 steps.');
    if (replay.runtimeVersion !== undefined && !MINIGAME_COMPATIBLE_REPLAY_VERSIONS.includes(replay.runtimeVersion)) throw new Error(`Replay needs runtime ${replay.runtimeVersion}; this kit provides ${MINIGAME_RUNTIME_VERSION}.`);
    if (!replay.expect || !['playing', 'won', 'lost'].includes(replay.expect.status)) throw new Error('Replay requires expect.status: playing, won, or lost.');
    const multiplayer = game.schemaVersion !== 1;
    const runtime = multiplayer ? createMultiplayerRuntime(game, { players: replay.players }) : createGameRuntime(game);
    const playerIds = multiplayer ? new Set(runtime.snapshot().players.map(player => player.id)) : null;
    const validInput = input => input && typeof input === 'object' && !Array.isArray(input)
      && Object.keys(input).every(key => ['x', 'z', 'interact'].includes(key))
      && Number.isFinite(input.x) && Math.abs(input.x) <= 1 && Number.isFinite(input.z) && Math.abs(input.z) <= 1
      && (input.interact === undefined || typeof input.interact === 'boolean');
    let frames = 0;
    for (const step of replay.steps) {
      if (!step || !Number.isInteger(step.frames) || step.frames < 1 || step.frames > 36000) throw new Error('Each replay step needs 1 to 36000 frames.');
      if (multiplayer) {
        if (step.input !== undefined || !step.inputs || typeof step.inputs !== 'object' || Array.isArray(step.inputs)
          || Object.entries(step.inputs).some(([id, input]) => !playerIds.has(id) || !validInput(input))) {
          throw new Error('Cooperative replay steps need inputs keyed by roster player ID, each with x/z in [-1,1] and optional boolean interact.');
        }
      } else if (step.inputs !== undefined || !validInput(step.input)) {
        throw new Error('Single-player replay steps need input.x/input.z in [-1,1] and optional boolean interact.');
      }
      frames += step.frames;
    }
    if (frames > 36000) throw new Error('Replay exceeds 10 minutes at 60 Hz.');
    for (const step of replay.steps) for (let frame = 0; frame < step.frames; frame++) runtime.step(FIXED_DT, multiplayer ? step.inputs : step.input);
    const snapshot = runtime.snapshot(), failures = [];
    if (snapshot.status !== replay.expect.status) failures.push(`Expected status ${replay.expect.status}, got ${snapshot.status}.`);
    if (replay.expect.variables !== undefined && (!replay.expect.variables || typeof replay.expect.variables !== 'object' || Array.isArray(replay.expect.variables))) throw new Error('expect.variables must be an object.');
    for (const [key, value] of Object.entries(replay.expect.variables ?? {})) {
      if (!Number.isFinite(value)) throw new Error(`Expected variable ${key} must be finite.`);
      if (snapshot.variables[key] !== value) failures.push(`Expected ${key}=${value}, got ${snapshot.variables[key]}.`);
    }
    const report = { valid: failures.length === 0, gameId: game.id, runtimeVersion: MINIGAME_RUNTIME_VERSION, frames, failures, snapshot };
    if (args[3]) await writeFile(resolve(args[3]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    return report;
  }
  throw new Error('Usage: node scripts/minigame.mjs validate game.json | pack game-directory output.zip | replay game.json inputs.json [report.json]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runMinigameCli(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ valid: false, error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, null, 2) + '\n');
    process.exitCode = 1;
  }
}
