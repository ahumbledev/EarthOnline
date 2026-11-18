import { t, tc, td, formatDate } from '../activities-public/language.ts';
import * as THREE from 'three';
import type { RenderQuality } from '../game/quality';
import { createMinigameApi, MinigameApiError, mergeMinigameMutationState } from './api';
import type { MinigameConfig, MinigameRevision, MinigameState } from './api';
import { createWorkshopStage } from './stage';
import { displayPlayerName } from './player-labels.ts';
import { parseWorkshopGame, createWorkshopRuntime, workshopBrief, workshopRoomUnsupportedReason } from './adapter';
import type { WorkshopGame, WorkshopRuntime } from './adapter';
import { createMinigameNetwork } from './network';
import './style.css';
import { MINIGAME_LIMITS } from '../../shared/minigame-protocol.mjs';
import { MINIGAME_RUNTIME_VERSION } from '../../shared/minigame-runtime.mjs';

const EXAMPLES = ['collect', 'switches', 'survival', 'cooperative', 'standard8', 'party16'];
const phaseLabel = { playing: t`试玩进行中`, won: t`挑战完成`, lost: t`这次差一点` };
const roomReason = (reason: string | null) => ({
  member_disconnected: t`有队友暂时断线`, member_left: t`队友已离开，请重新创建一局。`,
  reconnect_expired: t`队友未能及时重连，请重新创建一局。`, room_expired: t`房间已过期，请重新创建。`,
  room_empty: t`所有人都已离开。`, server_shutdown: t`服务正在重启，请稍后重新创建房间。`,
} as Record<string, string>)[reason ?? ''] ?? '';

export function createMinigamesView(context: {container: HTMLElement; renderer: THREE.WebGLRenderer; exit: () => void}) {
  const { container, renderer } = context;
  container.innerHTML = `<main class="mg-workshop">
    <div class="mg-canvas-layer"></div>
    <header class="mg-header"><button class="mg-back" type="button">${t`返回城市`}</button><div class="mg-brand"><h1>${t`街区挑战`}</h1><p>${t`把一个想法，变成一场游戏。`}</p></div><span class="mg-single">${t`单人 / 4 · 8 · 16 人`}</span></header>
    <div class="mg-layout">
      <aside class="mg-library" aria-label="${t`小游戏作品库`}"><div class="mg-section-heading"><h2>${t`从这里开始`}</h2><span>${t`6 个玩法样板`}</span></div><div class="mg-library-list mg-builtins"></div><p class="mg-library-note">${t`试试单人挑战，或和朋友一起解开机关。修改目标、地图与规则，做出你的版本。`}</p><div class="mg-section-heading mg-published-heading"><h2>${t`共享作品库`}</h2><button class="mg-refresh" type="button">${t`刷新`}</button></div><div class="mg-library-list mg-published-list"></div><div class="mg-section-heading mg-published-heading"><h2>${t`未发布草稿`}</h2></div><div class="mg-library-list mg-drafts-list"></div></aside>
      <section class="mg-playfield" tabindex="0" aria-label="${t`小游戏三维试玩区域`}">
        <div class="mg-game-header"><div><h2 class="mg-game-title">${t`准备你的第一场游戏`}</h2><p class="mg-game-description">${t`正在载入样板和真实材质…`}</p></div><div class="mg-controls-top"><button class="mg-button mg-button--primary mg-play" type="button">${t`开始试玩`}</button><button class="mg-button mg-restart" type="button">${t`重开`}</button><button class="mg-button mg-room-toggle" type="button" aria-expanded="false" aria-controls="mg-room-panel">${t`一起玩`}</button><button class="mg-button mg-open-tools" type="button" aria-expanded="false">${t`创作工具`}</button></div><label class="mg-local-control" hidden>${t`本地联调 · 控制`}<select class="mg-local-player" aria-label="${t`本地联调控制玩家`}"></select><span>${t`其余玩家静止`}</span></label></div>
        <section class="mg-room-panel" id="mg-room-panel" aria-label="${t`合作游戏房间`}" hidden>
          <div class="mg-section-heading"><h2>${t`一起玩`}</h2><button class="mg-room-close mg-button mg-button--quiet" type="button" aria-label="${t`收起联机房间`}">${tc('面板')`收起`}</button></div>
          <p class="mg-room-status" role="status" aria-live="polite">${t`创建房间，或输入朋友给你的房间码。`}</p>
          <div class="mg-room-entry"><label for="mg-room-name">${t`房间里的名字`}</label><input class="mg-room-name" id="mg-room-name" maxlength="24" autocomplete="off" placeholder="${t`例如：小林`}"><button class="mg-button mg-button--primary mg-room-create" type="button" disabled>${t`用当前作品创建房间`}</button><p class="mg-room-hint">${t`先上传并发布合作作品，即可创建房间。`}</p><form class="mg-room-join-form"><label for="mg-room-code">${t`朋友的房间码`}</label><div class="mg-key-row"><input class="mg-room-code" id="mg-room-code" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="${t`输入房间码`}" required><button class="mg-button mg-room-join" type="submit">${t`加入`}</button></div></form><p class="mg-room-auth"></p></div>
          <div class="mg-room-session" hidden><div class="mg-room-invite"><strong class="mg-room-current-code"></strong><button class="mg-button mg-room-copy" type="button">${t`复制房间码`}</button></div><p class="mg-room-control"></p><ul class="mg-room-members" aria-label="${t`房间成员`}"></ul><div class="mg-actions"><button class="mg-button mg-room-ready" type="button">${t`准备`}</button><button class="mg-button mg-button--primary mg-room-start" type="button">${t`开始合作`}</button><button class="mg-button mg-room-restart" type="button">${t`再开一局`}</button></div><div class="mg-actions mg-room-footer"><button class="mg-button mg-room-reconnect" type="button">${t`重新连接`}</button><button class="mg-button mg-button--quiet mg-room-leave" type="button">${t`离开房间`}</button></div><p class="mg-room-note">${t`开局后固定成员；一人断线，全局暂停 ${30} 秒等待重连。`}</p></div>
        </section>
        <div class="mg-stage" aria-hidden="true"></div>
        <div class="mg-notice" hidden><strong></strong><p></p></div>
        <div class="mg-hud"><div class="mg-hud-readout"><span class="mg-phase">${t`预览中`}</span><strong class="mg-score">${t`${(0).toFixed(1)} 秒`}</strong></div><span class="mg-help">${t`WASD / 方向键移动 · E / Enter 交互 · Esc ${t`暂停`}`}</span></div>
        <div class="mg-touch" aria-label="${t`触屏游戏控制`}"><div class="mg-dpad"><button type="button" data-move="up" aria-label="${t`向前移动`}">↑</button><button type="button" data-move="left" aria-label="${t`向左移动`}">←</button><button type="button" data-move="down" aria-label="${t`向后移动`}">↓</button><button type="button" data-move="right" aria-label="${t`向右移动`}">→</button></div><button type="button" class="mg-interact" aria-label="${t`与附近机关交互`}">${t`交互`}</button></div>
      </section>
      <aside class="mg-inspector" aria-label="${t`创作、发布与运行记录`}">
        <div class="mg-section-heading"><h2>${t`做成你的游戏`}</h2><button class="mg-button mg-button--quiet mg-close-tools" type="button" aria-label="${t`收起创作工具`}">${tc('面板')`收起`}</button></div>
        <p class="mg-intro">${t`编辑规则后在这里试玩，满意了再上传、发布。`}</p>
        <button class="mg-button mg-button--primary mg-agent" type="button"><span>${t`复制规则`}</span><span aria-hidden="true">↗</span></button>
        <a class="mg-kit" href="/minigames/creator-kit.zip" download>${t`下载创作包与校验工具`}</a>
        <textarea class="mg-copy-fallback" aria-label="${t`手动复制规则`}" readonly hidden></textarea>
        <label class="mg-file-label" for="mg-json-import">${t`导入 game.json，本地立即试玩`}</label><input id="mg-json-import" class="mg-file mg-json-import" type="file" accept=".json,application/json">
        <details class="mg-details"><summary>${t`编辑游戏规则`}</summary><label class="mg-editor-label" for="mg-rules">${t`可编辑 game.json`}</label><textarea id="mg-rules" class="mg-editor" aria-label="${t`游戏规则 JSON`}" spellcheck="false"></textarea><div class="mg-actions"><button class="mg-button mg-apply" type="button">${t`应用并试玩`}</button><button class="mg-button mg-download" type="button">${t`保存 JSON`}</button></div></details>
        <p class="mg-feedback" role="status" aria-live="polite"></p>
        <hr class="mg-divider"><h2>${t`上传与发布`}</h2><span class="mg-server">${t`正在连接共享创作服务…`}</span>
        <form class="mg-key" hidden><label for="mg-key">${t`内部测试口令`}</label><div class="mg-key-row"><input id="mg-key" type="password" autocomplete="off" aria-label="${t`内部测试口令`}"><button class="mg-button" type="submit">${t`连接`}</button></div></form>
        <label class="mg-file-label" for="mg-zip-import">${t`上传完整作品 ZIP`}</label><input id="mg-zip-import" class="mg-file mg-zip-import" type="file" accept=".zip,application/zip">
        <button class="mg-button mg-upload" type="button" disabled>${t`上传并检查 ZIP`}</button>
        <div class="mg-actions" style="margin-top:8px"><button class="mg-button mg-upload-json" type="button" disabled>${t`上传当前规则`}</button><button class="mg-button mg-publish mg-button--primary" type="button" disabled>${t`发布此修订`}</button></div>
        <button class="mg-button mg-button--quiet mg-withdraw" type="button" hidden>${t`撤回已发布版本`}</button>
        <p class="mg-intro" style="font-size:10px;margin-top:9px">${t`上传保留独立修订；有发布权限的成员可将作品发布到共享作品库。游戏分数不写入城市资产。`}</p>
        <details class="mg-details mg-history-details"><summary>${t`修订历史与回退`}</summary><div class="mg-history"></div></details>
        <hr class="mg-divider"><h2>${t`正在发生什么`}</h2><dl class="mg-variables"></dl><details class="mg-details"><summary>${t`事件与规则记录`}</summary><pre class="mg-trace"></pre></details><button class="mg-button mg-export" type="button">${t`导出运行记录`}</button>
      </aside>
    </div>
  </main>`;
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const root = get('.mg-workshop'), canvasLayer = get('.mg-canvas-layer'), viewport = get('.mg-stage'), playfield = get('.mg-playfield');
  const feedback = get('.mg-feedback'), editor = get<HTMLTextAreaElement>('.mg-editor');
  const playButton = get<HTMLButtonElement>('.mg-play');
  const jsonInput = get<HTMLInputElement>('.mg-json-import'), zipInput = get<HTMLInputElement>('.mg-zip-import');
  const keyForm = get<HTMLFormElement>('.mg-key'), keyInput = get<HTMLInputElement>('#mg-key');
  const abort = new AbortController(), listen = { signal: abort.signal };
  const api = createMinigameApi();
  const stage = createWorkshopStage(renderer, viewport);
  const keys = new Set<string>(), touch = new Set<string>();
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  let active = false, disposed = false, playing = false, busy = false, connected = false, revisionLoading = false, roomEnabled = false;
  let roomError = '', internalService = true, resumeGraceMs = 30000;
  let serviceConfig: MinigameConfig | null = null;
  let publicCatalog: MinigameState = { version: 0, gameVersions: {}, active: {}, revisions: [] };
  let observedRoomPhase = '';
  let pageFocused = document.hasFocus();
  let game: WorkshopGame | null = null, runtime: WorkshopRuntime | null = null;
  let examples: WorkshopGame[] = [];
  let state: MinigameState = { version: 0, gameVersions: {}, active: {}, revisions: [] };
  let selectedRevision: MinigameRevision | null = null;
  let uploadedTextures = new Map<string, THREE.Texture>();
  let operation: AbortController | null = null, loadOperation: AbortController | null = null;
  let operationVersion = 0, loadVersion = 0;
  let lastTick = 0, lastReadout = 0, interact = false;
  type RecordedInput = { x: number; z: number; interact: boolean };
  let inputLog: Array<{ frames: number; input?: RecordedInput; inputs?: Record<string, RecordedInput> }> = [];
  let recordedFrames = 0, traceTruncated = false;
  let dynamicListeners = new AbortController();
  const network = createMinigameNetwork({ api,
    onChange() { if (!disposed) { updateRoomUi(); updateControls(); refreshReadout(); } },
    async onBootstrap(bootstrap, signal) {
      roomError = '';
      if (selectedRevision?.id === bootstrap.revision.id && !!game && game.schemaVersion !== 1) return !signal.aborted;
      return loadRevision(bootstrap.revision, true, signal);
    },
    onError(message) { roomError = message; tell(message, true); get('.mg-room-status').textContent = message; showRoom(true); },
    onDiagnostics(report) { if (game) { download(report, `${game.id}-online-run.json`); tell(t`已导出服务器诊断与固定修订信息；是否可完整回放以记录中的 replayable 字段为准。`); } },
  });

  function publishedId(id: string) { return Object.hasOwn(state.gameVersions, id) ? state.active[id] : publicCatalog.active[id]; }
  function canPublish() { const permission = game && state.permissions?.[game.id]; return internalService || !!permission && ['owner', 'publisher'].includes(permission.role); }
  function tell(message: string, error = false) { feedback.textContent = message; feedback.dataset.error = String(error); }
  function clearInput() { keys.clear(); touch.clear(); interact = false; lastTick = 0; network.neutral(); }
  let inputCaptured = false;
  function canInput() { return !inputCaptured && active && pageFocused && !disposed && !container.inert && !root.classList.contains('mg-show-tools') && !root.classList.contains('mg-show-room'); }
  function updateControls() {
    const locked = network.locked;
    get<HTMLButtonElement>('.mg-upload').disabled = locked || !connected || busy || revisionLoading || !zipInput.files?.length;
    get<HTMLButtonElement>('.mg-upload-json').disabled = locked || !connected || busy || revisionLoading || !game || !!Object.keys(game.assets ?? {}).length;
    get<HTMLButtonElement>('.mg-publish').disabled = locked || !connected || busy || revisionLoading || !selectedRevision || !canPublish();
    get<HTMLButtonElement>('.mg-withdraw').disabled = locked || busy || revisionLoading || !connected || !canPublish();
    get('.mg-withdraw').hidden = !game || !state.active[game.id] || !canPublish();
    playButton.disabled = locked || !runtime || busy || revisionLoading;
    get<HTMLButtonElement>('.mg-restart').disabled = locked || !runtime || revisionLoading;
    for (const element of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('.mg-game,.mg-history button,.mg-apply,.mg-json-import,.mg-zip-import,.mg-editor')) element.disabled = locked;
    get<HTMLSelectElement>('.mg-local-player').disabled = locked;
    get<HTMLButtonElement>('.mg-export').disabled = network.diagnosticsPending || (locked && network.status !== 'online');
    updateRoomUi();
  }
  function pause() { playing = false; clearInput(); playButton.textContent = t`继续试玩`; refreshReadout(); }
  function showTools(open: boolean) { root.classList.toggle('mg-show-tools', open); get('.mg-open-tools').setAttribute('aria-expanded', String(open)); if (open) { get('.mg-room-panel').hidden = true; root.classList.remove('mg-show-room'); get('.mg-room-toggle').setAttribute('aria-expanded', 'false'); pause(); } else clearInput(); }
  function disposeTextures(textures: Map<string, THREE.Texture>) { textures.forEach(texture => texture.dispose()); textures.clear(); }

  function showRoom(open: boolean) {
    get('.mg-room-panel').hidden = !open; get('.mg-room-toggle').setAttribute('aria-expanded', String(open));
    root.classList.toggle('mg-show-room', open);
    if (open) { pause(); showTools(false); }
  }
  function updateRoomUi() {
    const room = network.room, member = network.member, locked = network.locked;
    if (room?.phase === 'playing' && network.assetsReady && observedRoomPhase !== 'playing') showRoom(false);
    observedRoomPhase = room?.phase ?? '';
    const host = !!room && member?.id === room.hostMemberId;
    const self = room?.members.find(value => value.id === member?.id);
    const unsupported = game ? workshopRoomUnsupportedReason(game, serviceConfig) : t`选择合作样板，上传并发布后，即可创建房间。`;
    get('.mg-room-entry').hidden = !!room; get('.mg-room-session').hidden = !room;
    get<HTMLButtonElement>('.mg-room-create').disabled = !connected || !roomEnabled || locked || busy || revisionLoading || !!unsupported || !game || !selectedRevision || publishedId(game.id) !== selectedRevision.id;
    get<HTMLButtonElement>('.mg-room-join').disabled = !connected || !roomEnabled || locked || busy;
    get<HTMLInputElement>('.mg-room-name').disabled = locked || !internalService;
    get<HTMLInputElement>('.mg-room-name').placeholder = internalService ? t`例如：小林` : t`使用当前账号名字`;
    get<HTMLInputElement>('.mg-room-code').disabled = locked;
    get('.mg-room-auth').textContent = !connected ? internalService ? t`请先在创作工具中连接测试服务。` : t`请使用城市账号连接服务。` : !roomEnabled ? t`当前服务尚未启用合作房间。` : internalService ? t`内部测试参与者，游戏结果不写入城市资产。` : t`使用当前城市账号；本局分数不兑换城市资产。`;
    get('.mg-room-hint').textContent = unsupported ?? (!game || !selectedRevision || publishedId(game.id) !== selectedRevision.id ? t`创建房间需要当前已发布的固定修订。` : t`将使用 ${selectedRevision.revision}；朋友加入时自动读取同一版本。`);
    const connectionLabel = network.status === 'connecting' ? t`正在进入房间…` : network.status === 'reconnecting' ? t`正在重新连接，房间会等待 ${Math.round(resumeGraceMs / 1000)} 秒…` : network.status === 'disconnected' ? t`连接已断开，可重试连接或离开房间。` : '';
    const phase = { lobby: t`等待大家准备`, playing: t`合作进行中`, paused: t`全局暂停，等待断线玩家恢复`, won: t`合作成功`, lost: t`本次挑战结束`, closed: t`房间已结束` };
    get('.mg-room-status').textContent = roomError || connectionLabel || (room ? `${phase[room.phase]}${roomReason(room.reason) ? ` · ${roomReason(room.reason)}` : ''}` : t`创建房间，或输入朋友给你的房间码。`);
    get('.mg-local-control').hidden = locked || (!game || game.schemaVersion === 1);
    get('.mg-room-note').textContent = internalService ? t`开局后固定成员；一人断线，全局暂停 ${Math.round(resumeGraceMs / 1000)} 秒等待重连。`
      : game?.schemaVersion === 3 && game.profile === 'party16' ? t`断线时其他玩家继续；保留席位 ${Math.round(resumeGraceMs / 1000)} 秒等待恢复。`
        : t`断线时每次最多暂停 10 秒，每局累计最多 30 秒；无法恢复时结束本局。`;
    if (!room) return;
    get('.mg-room-current-code').textContent = room.code;
    get('.mg-room-control').textContent = t`你控制 ${Number(member?.slot ?? 0) + 1} 号玩家${host ? t` · 你是房主` : ''} · 第 ${room.round} 局`;
    const members = get('.mg-room-members'); members.replaceChildren();
    for (const player of room.members) {
      const item = document.createElement('li'); item.dataset.slot = String(player.slot); item.dataset.memberId = player.id;
      const name = document.createElement('strong'), status = document.createElement('span');
      name.textContent = `${player.slot + 1} · ${displayPlayerName(player.name)}${player.id === member?.id ? t`（我）` : ''}`;
      status.textContent = !player.connected ? t`断线` : player.ready ? t`已准备` : t`未准备`; item.append(name, status); members.append(item);
    }
    const ready = get<HTMLButtonElement>('.mg-room-ready'); ready.textContent = self?.ready ? t`取消准备` : network.assetsReady ? t`准备` : t`正在载入作品…`;
    ready.disabled = network.status !== 'online' || !network.assetsReady || !['lobby', 'paused'].includes(room.phase);
    const start = get<HTMLButtonElement>('.mg-room-start'); start.hidden = !host || room.phase !== 'lobby';
    start.disabled = network.status !== 'online' || !network.assetsReady || (!game || game.schemaVersion === 1) || room.members.length < game.players.min || room.members.some(value => !value.connected || !value.ready);
    const restart = get<HTMLButtonElement>('.mg-room-restart'); restart.hidden = !host || !['won', 'lost'].includes(room.phase); restart.disabled = network.status !== 'online';
    get<HTMLButtonElement>('.mg-room-reconnect').hidden = !['disconnected', 'reconnecting'].includes(network.status) && network.assetsReady;
    get<HTMLButtonElement>('.mg-room-reconnect').disabled = network.status === 'connecting' || network.status === 'reconnecting' || room.phase === 'closed';
  }

  function setGame(next: WorkshopGame, textures = new Map<string, THREE.Texture>(), revision: MinigameRevision | null = null) {
    const nextRuntime = createWorkshopRuntime(next);
    stage.setDefinition({ width: next.arena.width, depth: next.arena.depth, material: next.arena.material, entities: next.entities }, textures);
    disposeTextures(uploadedTextures); uploadedTextures = textures;
    game = next; runtime = nextRuntime; selectedRevision = revision;
    playing = false; inputLog = []; recordedFrames = 0; traceTruncated = false; clearInput();
    get('.mg-game-title').textContent = td(next.title);
    get('.mg-game-description').textContent = td(next.description);
    editor.value = JSON.stringify(next, null, 2);
    const slots = get<HTMLSelectElement>('.mg-local-player'); slots.replaceChildren();
    for (let slot = 0; slot < (next.schemaVersion !== 1 ? next.players.max : 1); slot++) { const option = document.createElement('option'); option.value = String(slot); option.textContent = t`玩家 ${slot + 1}`; slots.append(option); }
    playButton.textContent = t`开始试玩`;
    refreshReadout(); renderLibrary(); updateRoomUi(); updateControls();
  }

  function refreshReadout() {
    if (!runtime) return;
    const room = network.room;
    get('.mg-help').textContent = t`WASD / 方向键移动 · E / Enter 交互 · Esc ${room ? t`停止操作` : t`暂停`}`;
    const snapshot = room?.snapshot ?? runtime.snapshot();
    const players = room ? room.snapshot?.players ?? room.members.map(member => ({ ...member, x: !!game && game.schemaVersion !== 1 ? game.arena.spawns[member.slot]?.[0] ?? 0 : 0, z: !!game && game.schemaVersion !== 1 ? game.arena.spawns[member.slot]?.[1] ?? 0 : 0, yaw: 0 })) : snapshot.players;
    const localId = room ? network.member?.id ?? '' : `local-${runtime.controlledSlot + 1}`;
    stage.update({ players: players.map(player => ({ ...player, name: room?.members.find(member => member.id === player.id)?.name, connected: room?.members.find(member => member.id === player.id)?.connected })), localPlayerId: localId, interpolate: !!room,
      entities: Object.fromEntries(snapshot.entities.map(entity => [entity.id, { position: [entity.x, entity.y, entity.z] as [number, number, number], visible: entity.visible }])) });
    get('.mg-phase').textContent = room ? network.status !== 'online' ? t`联机连接中断` : ({ lobby: t`等待准备`, playing: t`合作进行中`, paused: t`断线 · 全局暂停`, won: t`合作成功`, lost: t`挑战结束`, closed: t`房间已结束` })[room.phase] : snapshot.status === 'playing' ? playing ? !!game && game.schemaVersion !== 1 ? t`本地联调中` : t`试玩进行中` : snapshot.tick ? t`试玩已暂停` : !!game && game.schemaVersion !== 1 ? t`本地联调 · 可切换玩家` : t`规则已就绪` : phaseLabel[snapshot.status];
    get('.mg-score').textContent = t`${snapshot.elapsed.toFixed(1)} 秒`;
    const variables = get('.mg-variables'); variables.replaceChildren();
    for (const [name, value] of Object.entries({ ...snapshot.variables, ...Object.fromEntries(Object.entries(snapshot.timers).map(([name, value]) => [t`计时器 ${name}`, value])) })) {
      const term = document.createElement('dt'), definition = document.createElement('dd');
      term.textContent = name; definition.textContent = typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value);
      variables.append(term, definition);
    }
    const loadingRoom = room && room.phase !== 'closed' && !network.assetsReady;
    const notice = get('.mg-notice'); notice.hidden = room ? network.assetsReady && !['won', 'lost', 'paused', 'closed'].includes(room.phase) : snapshot.status === 'playing';
    notice.querySelector('strong')!.textContent = loadingRoom ? t`正在读取房间作品` : room?.phase === 'paused' ? t`等朋友回来` : room?.phase === 'closed' ? t`本局已结束` : snapshot.status === 'won' ? t`做到了！` : tc('小游戏结果')`再来一次`;
    notice.querySelector('p')!.textContent = loadingRoom ? t`规则与贴图全部就绪后，才能准备。加载失败可在房间中重新连接。` : room?.phase === 'paused' ? t`一人断线，所有人的进度与计时一起暂停。` : room?.phase === 'closed' ? roomReason(room.reason) || t`离开房间后，可以重新创建一局。` : snapshot.message != null ? td(snapshot.message) : (room ? t`房主可以再开一局。` : t`点击“重开”，换个办法再试。`);
    if (snapshot.status === 'playing' && snapshot.message) get('.mg-game-description').textContent = td(snapshot.message);
    get('.mg-trace').textContent = snapshot.trace.slice(-35).map(event => `${event.tick}  ${event.kind}${event.playerId ? ` / ${event.playerId}` : ''}${event.ruleId ? ` / ${event.ruleId}` : ''}${event.entityId ? ` / ${event.entityId}` : ''}${event.timerId ? ` / ${event.timerId}` : ''}${event.text ? `  ${td(event.text)}` : ''}`).join('\n') || t`开始试玩后，这里会记录触发的事件与规则。`;
  }

  function renderLibrary() {
    dynamicListeners.abort(); dynamicListeners = new AbortController();
    const signal = { signal: dynamicListeners.signal };
    const builtins = get('.mg-builtins'), published = get('.mg-published-list'), drafts = get('.mg-drafts-list'), history = get('.mg-history');
    builtins.replaceChildren(); published.replaceChildren(); drafts.replaceChildren(); history.replaceChildren();
    for (const example of examples) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mg-game';
      button.setAttribute('aria-pressed', String(game?.id === example.id && !selectedRevision));
      const title = document.createElement('strong'), subtitle = document.createElement('small');
      title.textContent = td(example.title); subtitle.textContent = t`${example.entities.length} 个物体 · ${example.rules.length} 条事件规则`;
      button.append(title, subtitle);
      button.addEventListener('click', () => { if (network.locked) return; cancelGameLoad(); setGame(example); tell(t`已载入样板。可以直接试玩，也可以继续修改规则。`); }, signal);
      builtins.append(button);
    }
    const catalog = new Map<string, MinigameRevision>(), unpublished = new Map<string, MinigameRevision>();
    for (const revision of state.revisions) if (revision.id !== state.active[revision.gameId]) unpublished.set(revision.gameId, revision);
    const catalogActive = Object.fromEntries(Object.entries(publicCatalog.active).filter(([id]) => !Object.hasOwn(state.gameVersions, id)));
    for (const [id, revisionId] of Object.entries({ ...catalogActive, ...state.active })) {
      const revision = [...state.revisions, ...publicCatalog.revisions].find(value => value.gameId === id && value.id === revisionId); if (revision) catalog.set(id, revision);
    }
    const entries: Array<[MinigameRevision, boolean]> = [...[...catalog.values()].map(revision => [revision, true] as [MinigameRevision, boolean]), ...[...unpublished.values()].map(revision => [revision, false] as [MinigameRevision, boolean])];
    for (const [revision, isPublished] of entries) {
      for (const mobile of [false, true]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `mg-game${mobile ? ' mg-game--mobile' : ''}`;
        button.setAttribute('aria-pressed', String(selectedRevision?.id === revision.id));
        const title = document.createElement('strong'), subtitle = document.createElement('small');
        title.textContent = td(revision.name); subtitle.textContent = `${isPublished ? t`已发布` : tc('作品状态')`未发布草稿`} · ${revision.revision}`; button.append(title, subtitle);
        button.addEventListener('click', () => void loadRevision(revision), signal); (mobile ? builtins : isPublished ? published : drafts).append(button);
      }
    }
    if (!published.childElementCount) { const empty = document.createElement('p'); empty.className = 'mg-empty'; empty.textContent = connected ? t`还没有发布的作品。` : t`连接服务后查看共享作品。`; published.append(empty); }
    if (!drafts.childElementCount) { const empty = document.createElement('p'); empty.className = 'mg-empty'; empty.textContent = t`尚无未发布的上传稿。`; drafts.append(empty); }
    const revisions = state.revisions.filter(value => value.gameId === game?.id).slice().reverse();
    for (const revision of revisions) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed', String(selectedRevision?.id === revision.id));
      button.dataset.revisionId = revision.id;
      const title = document.createElement('strong'), subtitle = document.createElement('small');
      title.textContent = `${revision.revision}${state.active[revision.gameId] === revision.id ? t` · 当前发布` : ''}`;
      subtitle.textContent = `${formatDate(revision.createdAt, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })} · ${(revision.bytes / 1024).toFixed(0)} KB`;
      button.append(title, subtitle); button.addEventListener('click', () => void loadRevision(revision), signal); history.append(button);
    }
    if (!revisions.length) { const empty = document.createElement('p'); empty.className = 'mg-empty'; empty.textContent = t`上传后，每一修订都会保留在这里。`; history.append(empty); }
  }

  function cancelGameLoad() { loadVersion++; loadOperation?.abort(); loadOperation = null; revisionLoading = false; updateControls(); }
  async function loadRevision(revision: MinigameRevision, roomLoad = false, parentSignal?: AbortSignal) {
    if (network.locked && !roomLoad) return false;
    cancelGameLoad(); const token = loadVersion, controller = loadOperation = new AbortController();
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    revisionLoading = true; updateControls();
    const textures = new Map<string, THREE.Texture>();
    tell(t`正在读取这一修订与实际贴图…`);
    try {
      const bytes = await api.file(revision.files.definition, signal);
      const definition = parseWorkshopGame(JSON.parse(new TextDecoder().decode(bytes)));
      if (roomLoad && definition.schemaVersion === 1) throw new Error(t`合作房间必须使用已发布的多人作品。`);
      for (const id of Object.keys(definition.assets ?? {})) {
        const fileUrl = revision.files.assets[id]; if (!fileUrl) throw new Error(t`贴图 ${id} 未包含在这一修订中。`);
        const imageBytes = await api.file(fileUrl, signal);
        const blobUrl = URL.createObjectURL(new Blob([imageBytes]));
        try {
          const texture = await new THREE.TextureLoader().loadAsync(blobUrl);
          texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          textures.set(id, texture);
        } finally { URL.revokeObjectURL(blobUrl); }
      }
      if (disposed || token !== loadVersion || signal.aborted) { disposeTextures(textures); return false; }
      setGame(definition, textures, revision);
      tell(t`已读取 ${revision.revision}。上传和发布各自独立；可以先试玩再决定。`);
      return true;
    } catch (error) { disposeTextures(textures); if (!disposed && token === loadVersion && !signal.aborted) { const message = t`作品资源暂未载入：${errorMessage(error)} ${roomLoad ? t`请在房间中点击重新连接重试；资源就绪前不能准备。` : t`请重新选择这一修订重试。`}`; tell(message, true); if (roomLoad) roomError = message; } return false; }
    finally { if (token === loadVersion) { loadOperation = null; revisionLoading = false; updateControls(); } }
  }

  function errorMessage(error: unknown) {
    if (error instanceof MinigameApiError && [401, 403].includes(error.status)) { keyForm.hidden = !internalService; connected = false; updateControls(); }
    return error instanceof Error ? td(error.message) : t`操作没有完成，请重试。`;
  }
  function startOperation() {
    operation?.abort(); operation = new AbortController(); busy = true; updateControls();
    return { token: ++operationVersion, signal: AbortSignal.any([operation.signal, abort.signal, AbortSignal.timeout(120000)]) };
  }
  function current(token: number) { return !disposed && active && token === operationVersion; }
  function endOperation(token: number) { if (token === operationVersion) { operation = null; busy = false; updateControls(); } }

  async function refreshServer() {
    if (disposed || !active || busy) return;
    const { token, signal } = startOperation();
    try {
      const config = await api.config(signal); if (!current(token)) return;
      serviceConfig = config;
      roomEnabled = config.realtime?.enabled === true; internalService = config.internal;
      resumeGraceMs = config.realtime?.resumeGraceMs ?? 30000; network.configure({ resumeGraceMs });
      keyForm.hidden = !config.internal || !config.authRequired;
      if (!config.enabled) { connected = false; get('.mg-server').textContent = t`共享创作服务尚未启用；样板和本地 JSON 仍可试玩。`; return; }
      const [mine, catalog] = await Promise.all([api.state(signal), config.internal ? Promise.resolve(null) : api.catalog(signal)]);
      if (!current(token)) return; state = mine; publicCatalog = catalog ?? { version: 0, gameVersions: {}, active: {}, revisions: [] };
      connected = true; get('.mg-server').textContent = config.internal ? config.authRequired ? t`已连接内部共享空间 · 口令仅保存在当前页面` : t`已连接本机内部共享空间` : t`已连接当前账号 · 草稿仅对有权限的成员可见`;
      renderLibrary(); updateRoomUi();
    } catch (error) { if (current(token)) { connected = false; get('.mg-server').textContent = errorMessage(error); } }
    finally { endOperation(token); }
  }

  async function upload(file: File | Blob) {
    if (network.locked || !connected || busy || revisionLoading) return;
    const { token, signal } = startOperation(); tell(t`正在上传并检查作品…`);
    try {
      const result = await api.upload(file, signal); if (!current(token)) return;
      state = internalService ? result.state : mergeMinigameMutationState(state, result.state); zipInput.value = ''; renderLibrary();
      const loaded = await loadRevision(result.revision);
      if (current(token) && loaded) tell(t`修订已保存，尚未发布。先试玩，再点击“发布此修订”。`);
    } catch (error) { if (current(token)) tell(errorMessage(error), true); }
    finally { endOperation(token); }
  }

  async function publish(withdraw = false) {
    if (network.locked || !connected || busy || revisionLoading || !game || (!withdraw && !selectedRevision)) return;
    const gameId = game.id, revisionId = withdraw ? null : selectedRevision!.id;
    const { token, signal } = startOperation(); tell(withdraw ? t`正在撤回这个游戏的发布…` : t`正在发布选中的固定修订…`);
    try {
      const next = await api.publish(gameId, revisionId, state.gameVersions[gameId] ?? 0, signal);
      if (!current(token)) return; state = internalService ? next : mergeMinigameMutationState(state, next); renderLibrary(); updateRoomUi();
      tell(withdraw ? t`已从共享作品库撤回，历史修订仍保留。` : t`这一修订已发布到共享作品库。`);
    } catch (error) {
      if (!current(token)) return;
      if (error instanceof MinigameApiError && error.status === 409) {
        try { state = await api.state(signal); if (current(token)) { renderLibrary(); tell(t`这个游戏已被另一位测试者更新。已刷新发布状态，请确认版本后重试。`, true); } }
        catch (nextError) { if (current(token)) tell(errorMessage(nextError), true); }
      } else tell(errorMessage(error), true);
    } finally { endOperation(token); }
  }

  function download(data: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.hidden = true; root.append(link); link.click(); link.remove();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000); downloads.set(url, timer);
  }
  function applyEditor() {
    if (network.locked) return;
    try {
      if (new TextEncoder().encode(editor.value).byteLength > MINIGAME_LIMITS.definitionBytes) throw new Error(t`game.json 超过 512 KiB，请缩小规则和物体数量。`);
      const definition = parseWorkshopGame(JSON.parse(editor.value));
      const needs = Object.keys(definition.assets ?? {});
      if (needs.some(id => !uploadedTextures.has(id) || definition.assets![id].path !== game?.assets?.[id]?.path)) throw new Error(t`当前 JSON 增加或改变了贴图路径。请上传带 assets/ 的完整 ZIP，或先使用内置 PBR 材质。`);
      cancelGameLoad();
      // A new set owns the same immutable image objects while editing this ZIP.
      const retained = new Map(uploadedTextures); uploadedTextures = new Map();
      setGame(definition, retained); playing = true; playButton.textContent = t`暂停试玩`; showTools(false);
      tell(t`规则检查通过，已开始本地试玩。还没有上传或发布。`);
    } catch (error) { tell(errorMessage(error), true); }
  }
  function restart() {
    if (!game || network.locked) return; runtime = createWorkshopRuntime(game); get<HTMLSelectElement>('.mg-local-player').value = '0'; playing = true; inputLog = []; recordedFrames = 0; traceTruncated = false;
    clearInput(); playButton.textContent = t`暂停试玩`; refreshReadout(); playfield.focus({ preventScroll: true });
  }

  playButton.addEventListener('click', () => { if (!runtime || network.locked) return; if (runtime.snapshot().status !== 'playing') { restart(); return; } playing = !playing; clearInput(); playButton.textContent = playing ? t`暂停试玩` : t`继续试玩`; refreshReadout(); playfield.focus({ preventScroll: true }); }, listen);
  get('.mg-restart').addEventListener('click', restart, listen);
  get('.mg-open-tools').addEventListener('click', () => showTools(!root.classList.contains('mg-show-tools')), listen);
  get('.mg-close-tools').addEventListener('click', () => showTools(false), listen);
  get('.mg-back').addEventListener('click', () => { network.leave(); clearInput(); context.exit(); }, listen);
  get('.mg-room-toggle').addEventListener('click', () => showRoom(Boolean(get('.mg-room-panel').hidden)), listen);
  get('.mg-room-close').addEventListener('click', () => showRoom(false), listen);
  get('.mg-room-create').addEventListener('click', () => { if (!game || !selectedRevision || workshopRoomUnsupportedReason(game, serviceConfig)) return; roomError = ''; pause(); void network.create(game.id, selectedRevision.id, get<HTMLInputElement>('.mg-room-name').value); }, listen);
  get<HTMLFormElement>('.mg-room-join-form').addEventListener('submit', event => { event.preventDefault(); roomError = ''; pause(); void network.join(get<HTMLInputElement>('.mg-room-code').value, get<HTMLInputElement>('.mg-room-name').value); }, listen);
  get('.mg-room-ready').addEventListener('click', () => { roomError = ''; network.ready(!network.room?.members.find(member => member.id === network.member?.id)?.ready); }, listen);
  get('.mg-room-start').addEventListener('click', () => { roomError = ''; if (network.start()) { showRoom(false); playfield.focus({ preventScroll: true }); } }, listen);
  get('.mg-room-restart').addEventListener('click', () => { roomError = ''; network.restart(); }, listen);
  get('.mg-room-leave').addEventListener('click', () => { roomError = ''; network.leave(); playing = false; clearInput(); tell(t`已离开联机房间。当前作品可以继续本地联调。`); }, listen);
  get('.mg-room-reconnect').addEventListener('click', () => { roomError = ''; void network.reconnect(); }, listen);
  get('.mg-room-copy').addEventListener('click', async () => { if (!network.room) return; try { await navigator.clipboard.writeText(network.room.code); tell(t`房间码已复制。朋友输入房间码即可加入。`); } catch { tell(t`请手动复制房间码：${network.room.code}`); } }, listen);
  get<HTMLSelectElement>('.mg-local-player').addEventListener('change', event => { if (network.locked) return; clearInput(); runtime?.setControlledSlot(Number((event.target as HTMLSelectElement).value)); refreshReadout(); playfield.focus({ preventScroll: true }); }, listen);
  get('.mg-agent').addEventListener('click', async () => {
    if (!game) return;
    pause();
    const brief = workshopBrief(game) + (feedback.dataset.error === 'true' ? `\n最近一次具体错误：\n${feedback.textContent}\n` : ''), fallback = get<HTMLTextAreaElement>('.mg-copy-fallback'); fallback.hidden = true;
    try { await navigator.clipboard.writeText(brief); if (!disposed) tell(t`游戏规则已复制。`); }
    catch { if (!disposed) { fallback.value = brief; fallback.hidden = false; fallback.focus(); fallback.select(); tell(t`请手动复制任务框中的内容。`); } }
  }, listen);
  get('.mg-apply').addEventListener('click', applyEditor, listen);
  get('.mg-download').addEventListener('click', () => { try { const parsed = parseWorkshopGame(JSON.parse(editor.value)); download(parsed, `${parsed.id}-game.json`); } catch (error) { tell(errorMessage(error), true); } }, listen);
  get('.mg-export').addEventListener('click', () => {
    if (network.room) { network.diagnostics(); return; }
    if (!game || !runtime) return;
    const snapshot = runtime.snapshot();
    download({ schemaVersion: game.schemaVersion, runtimeVersion: MINIGAME_RUNTIME_VERSION, gameId: game.id, gameVersion: game.version, revisionId: selectedRevision?.id ?? null, gameDefinition: game, ...(game.schemaVersion !== 1 ? { players: snapshot.players.map(({ id, slot }) => ({ id, slot })) } : {}), steps: inputLog, expect: { status: snapshot.status, variables: snapshot.variables }, truncated: traceTruncated, replayable: !traceTruncated, snapshot }, `${game.id}-run.json`);
    tell(traceTruncated ? t`已导出诊断记录，但输入超过回放上限，已明确标为截断；不要将它当作完整可重放验收。` : t`运行记录已导出，包含精确规则、修订、预期状态、输入回放与事件，可帮助定位问题。`);
  }, listen);
  jsonInput.addEventListener('change', async () => {
    if (network.locked) return;
    const file = jsonInput.files?.[0]; if (!file) return;
    cancelGameLoad(); const token = loadVersion;
    try { if (file.size > MINIGAME_LIMITS.definitionBytes) throw new Error(t`game.json 超过 512 KiB。`); const text = await file.text(); if (!disposed && token === loadVersion) { editor.value = text; applyEditor(); } }
    catch (error) { if (!disposed) tell(errorMessage(error), true); }
    finally { jsonInput.value = ''; }
  }, listen);
  zipInput.addEventListener('change', updateControls, listen);
  get('.mg-upload').addEventListener('click', () => { const file = zipInput.files?.[0]; if (file) void upload(file); }, listen);
  get('.mg-upload-json').addEventListener('click', () => { if (game) void upload(new Blob([JSON.stringify(game)], { type: 'application/json' })); }, listen);
  get('.mg-publish').addEventListener('click', () => void publish(), listen);
  get('.mg-withdraw').addEventListener('click', () => void publish(true), listen);
  get('.mg-refresh').addEventListener('click', () => void refreshServer(), listen);
  keyForm.addEventListener('submit', event => { event.preventDefault(); api.setKey(keyInput.value); keyInput.value = ''; void refreshServer(); }, listen);

  window.addEventListener('keydown', event => {
    if (!canInput() || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,button,a,summary'))) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'Enter', 'Escape'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape') { playing = false; clearInput(); playButton.textContent = t`继续试玩`; refreshReadout(); return; }
    keys.add(event.code); if (!event.repeat && ['KeyE', 'Enter'].includes(event.code)) interact = true;
  }, listen);
  window.addEventListener('keyup', event => keys.delete(event.code), listen);
  window.addEventListener('blur', () => { pageFocused = false; pause(); }, listen);
  window.addEventListener('focus', () => { pageFocused = true; clearInput(); }, listen);
  editor.addEventListener('focus', pause, listen);
  document.addEventListener('visibilitychange', clearInput, listen);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-move]')) {
    const release = () => touch.delete(button.dataset.move!);
    button.addEventListener('pointerdown', event => { if (!canInput()) return; event.preventDefault(); button.setPointerCapture(event.pointerId); touch.add(button.dataset.move!); }, listen);
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(event, release, listen);
  }
  // Native click covers touch activation and Enter/Space on the focused button.
  // Register one activation path so a pointer tap cannot interact twice.
  get('.mg-interact').addEventListener('click', () => { if (canInput()) interact = true; }, listen);

  function render(now: number) {
    if (!active || disposed || document.hidden) return;
    const dt = lastTick ? Math.min(.05, Math.max(0, (now - lastTick) / 1000)) : 0; lastTick = now;
    const input = {
      x: canInput() ? Number(keys.has('KeyD') || keys.has('ArrowRight') || touch.has('right')) - Number(keys.has('KeyA') || keys.has('ArrowLeft') || touch.has('left')) : 0,
      z: canInput() ? Number(keys.has('KeyS') || keys.has('ArrowDown') || touch.has('down')) - Number(keys.has('KeyW') || keys.has('ArrowUp') || touch.has('up')) : 0,
      interact: canInput() && interact,
    };
    if (network.room) {
      if (network.input(input)) interact = false;
    } else if (playing && runtime && !busy) {
      const previous = runtime.snapshot().tick;
      const snapshot = runtime.step(dt, input);
      if (snapshot.tick > previous) {
        const frames = snapshot.tick - previous; interact = false;
        const recorded = !!game && game.schemaVersion !== 1 ? { inputs: { [`local-${runtime.controlledSlot + 1}`]: { ...input } } } : { input: { ...input } };
        const last = inputLog.at(-1), same = last && JSON.stringify({ input: last.input, inputs: last.inputs }) === JSON.stringify(recorded);
        if (recordedFrames + frames <= 36000 && (inputLog.length < 1024 || same)) {
          if (same) last.frames += frames;
          else inputLog.push({ frames, ...recorded }); recordedFrames += frames;
        } else traceTruncated = true;
      }
      stage.update({ players: snapshot.players, localPlayerId: `local-${runtime.controlledSlot + 1}`,
        entities: Object.fromEntries(snapshot.entities.map(entity => [entity.id, { position: [entity.x, entity.y, entity.z] as [number, number, number], visible: entity.visible }])) });
      if (snapshot.status !== 'playing') { playing = false; clearInput(); playButton.textContent = t`再次试玩`; }
    }
    if (now - lastReadout > 100) { refreshReadout(); lastReadout = now; }
    stage.render(dt);
  }
  const observer = new ResizeObserver(() => { if (!disposed) { const rect = viewport.getBoundingClientRect(); stage.resize(rect.width, rect.height); } }); observer.observe(viewport);
  const ready = (async () => {
    const [loaded] = await Promise.all([Promise.all(EXAMPLES.map(async id => {
      const response = await fetch(`/minigames/examples/${id}.json`, { signal: abort.signal });
      if (!response.ok) throw new Error(t`小游戏样板 ${id} 暂未载入，请重试。`);
      return parseWorkshopGame(await response.json());
    })), stage.ready]);
    if (disposed) return;
    examples = loaded; setGame(examples[0]);
    tell(t`先试玩一场，再把它改成你自己的游戏。`);
  })();

  function deactivate() {
    clearInput(); network.setActive(false); active = false; stage.deactivate();
    operationVersion++; operation?.abort(); operation = null; busy = false;
    cancelGameLoad(); updateControls();
  }
  return {
    ready,
    activate() {
      if (disposed) return; active = true; pageFocused = document.hasFocus(); clearInput(); network.setActive(true); stage.activate(); canvasLayer.append(renderer.domElement);
      get('.mg-back').textContent = t`返回城市`;
      renderer.domElement.setAttribute('aria-label', t`创作工坊小游戏三维画面`);
      document.title = t`EarthOnline · 街区挑战`;
      const rect = viewport.getBoundingClientRect(); stage.resize(rect.width, rect.height);
      void refreshServer();
    },
    setInputCaptured(value: boolean) { inputCaptured = value; clearInput(); },
    canChat() { return active && !root.classList.contains('mg-show-tools') && !root.classList.contains('mg-show-room'); },
    deactivate, render,
    resize() { const rect = viewport.getBoundingClientRect(); stage.resize(rect.width, rect.height); },
    setQuality(quality: RenderQuality) { stage.setQuality(quality); },
    dispose() {
      if (disposed) return; deactivate(); disposed = true; abort.abort(); observer.disconnect(); dynamicListeners.abort();
      network.dispose(); stage.dispose(); disposeTextures(uploadedTextures); api.setKey(''); keyInput.value = '';
      downloads.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); }); downloads.clear();
      container.replaceChildren();
    },
  };
}
