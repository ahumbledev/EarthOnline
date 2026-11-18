import type { createFishingSession } from './gameplay.ts';
import { evaluateFightResponse } from './fight-response.ts';
import './fight-hud.css';
type State = ReturnType<typeof createFishingSession>['state'];
export interface FightHudOptions { paused?: boolean; castDistance?: number }

/** Presentation reads the same response assessment that awards a real counter. */
export function getFightHudPresentation(s: State, reeling: boolean, charging = 0, options: FightHudOptions = {}) {
  const active = s.phase === 'reeling', casting = charging > 0;
  const visible = !options.paused && (active || casting || s.phase === 'bite');
  const response = evaluateFightResponse(s, reeling);
  const warning = active && s.tension > .84 ? 'high' : active && (s.tension < .16 || response.reason === 'tension-low') ? 'low' : 'none';
  const landing = active && (s.landingProgress > 0 || s.bankReady);
  const bank = active && s.cue === 'bring-to-water';
  const settling = active && s.cue === 'settle-fish';
  const opening = active && s.openingRemaining > 0 && !landing && !bank && !settling;
  let cue = '', mode = 'hidden';
  if (visible) {
    if (warning !== 'none') { mode = 'warning'; cue = warning === 'high' ? 'Ease off the reel' : 'Keep contact'; }
    else if (s.phase === 'bite') { mode = 'bite'; cue = 'Lift now'; }
    else if (bank) { mode = 'bank'; cue = 'Reach open water'; }
    else if (landing) { mode = 'landing'; cue = 'Guide to net'; }
    else if (settling) { mode = 'settling'; cue = 'Lower & reel'; }
    else if (opening) { mode = 'opening'; cue = 'Reel now'; }
    else if (active && response.correct) { mode = 'controlled'; cue = 'Hold steady'; }
    else if (active) {
      mode = s.telegraph ? 'telegraph' : 'attack';
      cue = response.reason === 'drag-too-loose' ? 'Tighten drag' : response.reason === 'drag-too-tight' ? 'Loosen drag'
        : s.behavior === 'jump' ? 'Ease & lower' : s.behavior === 'dive' ? 'Ease & lift'
        : s.behavior === 'perch-pause' || s.behavior === 'steady' ? 'Reel gently'
        : s.behavior === 'recover' ? 'Reel now' : 'Give line';
    } else if (casting) { mode = 'charge'; cue = 'Release to cast'; }
  }
  const distance = active ? bank ? '' : landing ? `Net · ${Math.round(s.landingProgress * 100)}%`
    : s.bankApproach ? s.bankControl > 0 || settling ? `Settle · ${Math.round(s.bankControl * 100)}%` : 'Tire the fish' : `${Math.ceil(s.distance)} m`
    : casting && Number.isFinite(options.castDistance) ? `${Math.round(options.castDistance!)} m` : '';
  return { visible, active, casting, response, warning, landing, bank, settling, opening, cue, mode, distance,
    sideTarget: landing || settling ? 0 : response.sideTarget,
    angleTarget: landing || settling ? -1 : response.angleTarget,
    controls: active && !bank && (landing || settling || !opening && response.reelTarget !== null),
    amount: casting ? charging : s.phase === 'bite' ? .98 : s.tension };
}

/** A quiet, hollow instrument around the line of sight; never an opaque card. */
export function createFightHud(parent: HTMLElement) {
  const node = document.createElement('div'); node.id = 'fight-hud'; node.className = 'fight-hud fight-instrument';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `<svg viewBox="0 0 180 180" fill="none"><circle class="fight-track" cx="90" cy="90" r="68"/><circle class="fight-load" cx="90" cy="90" r="68" pathLength="100"/><circle class="fight-reel" cx="90" cy="90" r="59" pathLength="100"/><path class="fight-left" d="m21 80-9 10 9 10"/><path class="fight-right" d="m159 80 9 10-9 10"/><g class="fight-steering"><path class="fight-steering-track" d="M48 124Q90 153 132 124"/><circle class="fight-steering-target" r="4.5"/><path class="fight-steering-actual" d="M0-5V5"/></g><g class="fight-tip-control"><path class="fight-tip-track" d="M131 64V112"/><circle class="fight-tip-target" cx="131" r="4.5"/><path class="fight-tip-actual" d="M126 0H136"/></g><path class="fight-tip-up" d="m123 57 8-8 8 8"/><path class="fight-tip-down" d="m123 119 8 8 8-8"/><path class="fight-bite-mark" d="M84 72h12m-6-9v19m0 12v1"/></svg><span class="fight-window"></span><span class="fight-distance"></span><span class="fight-cue"></span>`;
  parent.append(node);
  const load = node.querySelector<SVGCircleElement>('.fight-load')!;
  const distance = node.querySelector<HTMLElement>('.fight-distance')!;
  const cue = node.querySelector<HTMLElement>('.fight-cue')!;
  const windowLabel = node.querySelector<HTMLElement>('.fight-window')!;
  const sideTarget = node.querySelector<SVGCircleElement>('.fight-steering-target')!;
  const sideActual = node.querySelector<SVGPathElement>('.fight-steering-actual')!;
  const tipTarget = node.querySelector<SVGCircleElement>('.fight-tip-target')!;
  const tipActual = node.querySelector<SVGPathElement>('.fight-tip-actual')!;
  let openingDuration = 2.55, previousOpening = 0, disposed = false;
  const sidePoint = (value: number) => { const control = Math.max(-1, Math.min(1, value)); return [90 + control * 39, 138.5 - control * control * 12] as const; };
  return {
    update(_dt: number, s: State, reeling: boolean, charging = 0, options: FightHudOptions = {}) {
      if (disposed) return;
      const p = getFightHudPresentation(s, reeling, charging, options);
      node.dataset.visible = String(p.visible);
      node.dataset.reeling = String(p.active && reeling);
      node.dataset.danger = String(p.warning === 'high');
      node.dataset.slack = String(p.warning === 'low');
      node.dataset.warning = p.warning;
      node.dataset.mode = p.mode;
      node.dataset.charge = String(p.casting);
      node.dataset.landing = String(p.landing);
      node.dataset.opening = String(p.opening);
      node.dataset.controls = String(p.controls);
      node.dataset.correct = String(p.active && p.response.correct && p.warning === 'none');
      node.dataset.response = p.response.reason;
      node.dataset.telegraph = String(p.active && s.telegraph);
      node.dataset.direction = p.controls ? String(p.sideTarget) : '0';
      node.dataset.tip = p.controls ? String(p.angleTarget) : '0';
      if (s.openingRemaining > previousOpening + .04) openingDuration = s.openingRemaining;
      previousOpening = s.openingRemaining;
      node.style.setProperty('--opening-progress', `${Math.max(0, Math.min(100, s.openingRemaining / openingDuration * 100))}`);
      node.style.setProperty('--net-progress', `${Math.round(s.landingProgress * 100)}`);
      load.style.strokeDasharray = `${Math.max(2, Math.min(98, p.amount * 96))} 100`;
      const target = sidePoint(p.sideTarget * .8), actual = sidePoint(s.rodDirection);
      sideTarget.setAttribute('cx', String(target[0])); sideTarget.setAttribute('cy', String(target[1]));
      sideActual.setAttribute('transform', `translate(${actual[0]} ${actual[1]})`);
      tipTarget.setAttribute('cy', String(88 - p.angleTarget * 19));
      tipActual.setAttribute('transform', `translate(0 ${88 - Math.max(-1, Math.min(1, s.rodAngle)) * 24})`);
      distance.textContent = p.distance;
      cue.textContent = p.cue;
      windowLabel.textContent = p.opening && p.warning === 'none' ? `${s.openingRemaining.toFixed(1)}s` : '';
    }, dispose() { disposed = true; node.remove(); },
  };
}
