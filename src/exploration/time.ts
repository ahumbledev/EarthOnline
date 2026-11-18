/** A local visual day clock. It advances only from supplied elapsed seconds. */
export interface WorldClock {
  readonly hour: number;
  readonly day: number;
  readonly paused: boolean;
  readonly speed: number;
  /** Shared clocks reject local time controls and advance independently of scene pauses. */
  readonly authoritative?: boolean;
  update(realSeconds: number): void;
  setHour(hour: number): void;
  setPaused(paused: boolean): void;
  setSpeed(multiplier: number): void;
}

export interface DaylightSample {
  /** Unit vector pointing from the world toward the sun. +X is sunrise. */
  sunDirection: [number, number, number];
  sunHeight: number;
  daylight: number;
  twilight: number;
  night: number;
  warmth: number;
  phase: string;
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function wrapHour(hour: number): number {
  const wrapped = hour % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped === 0 ? 0 : wrapped;
}

/**
 * Invalid numeric inputs throw rather than silently corrupting the clock.
 * Scrubbing changes the hour within the current day; only update advances days.
 */
export function createWorldClock(initialHour = 17.2, dayDurationSeconds = 720): WorldClock {
  finite(initialHour, 'initialHour');
  finite(dayDurationSeconds, 'dayDurationSeconds');
  if (dayDurationSeconds <= 0) throw new RangeError('dayDurationSeconds must be positive');

  let hour = wrapHour(initialHour);
  let day = 1;
  let paused = false;
  let speed = 1;
  // Compensated summation prevents many small frames drifting across midnight.
  let roundingError = 0;

  return {
    get hour() { return hour; },
    get day() { return day; },
    get paused() { return paused; },
    get speed() { return speed; },
    update(realSeconds) {
      finite(realSeconds, 'realSeconds');
      if (realSeconds < 0) throw new RangeError('realSeconds must not be negative');
      if (paused || speed === 0 || realSeconds === 0) return;

      const advance = (realSeconds / dayDurationSeconds) * 24 * speed;
      const correctedAdvance = advance - roundingError;
      const nextHour = hour + correctedAdvance;
      const carriedDays = Math.floor(nextHour / 24);
      if (!Number.isFinite(nextHour) || !Number.isSafeInteger(day + carriedDays)) {
        throw new RangeError('Time advance exceeds the supported day range');
      }
      roundingError = (nextHour - hour) - correctedAdvance;
      hour = nextHour - carriedDays * 24;
      day += carriedDays;
    },
    setHour(nextHour) {
      finite(nextHour, 'hour');
      hour = wrapHour(nextHour);
      roundingError = 0;
    },
    setPaused(nextPaused) { paused = nextPaused; },
    setSpeed(multiplier) {
      finite(multiplier, 'multiplier');
      if (multiplier < 0) throw new RangeError('multiplier must not be negative');
      speed = multiplier;
    },
  };
}

function smoothstep(min: number, max: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

/**
 * Fixed cinematic sun arc: sunrise at 06:00, sunset at 18:00, a tilted noon
 * sun and broad golden hours. All numeric lighting factors are continuous.
 * This is an art-directed local cycle, rather than a geographic solar model.
 */
export function sampleDaylight(worldHour: number): DaylightSample {
  finite(worldHour, 'hour');
  const hour = wrapHour(worldHour);
  const angle = (hour - 6) * Math.PI / 12;
  const northTilt = -Math.sqrt(1 - 0.86 ** 2);
  const sunDirection: [number, number, number] = [
    Math.cos(angle),
    Math.sin(angle) * 0.86,
    Math.sin(angle) * northTilt,
  ];
  const sunHeight = sunDirection[1];
  const daylight = smoothstep(-0.1, 0.22, sunHeight);
  const twilight = smoothstep(-0.22, -0.015, sunHeight)
    * (1 - smoothstep(0.05, 0.28, sunHeight));
  const warmth = smoothstep(-0.07, 0.045, sunHeight)
    * (1 - smoothstep(0.09, 0.42, sunHeight));

  let phase: string;
  if (hour < 4.75 || hour >= 22) phase = 'Night';
  else if (hour < 6) phase = 'Dawn';
  else if (hour < 9) phase = 'Morning';
  else if (hour < 16.5) phase = 'Day';
  else if (hour < 18.5) phase = 'Dusk';
  else phase = 'Evening';

  return { sunDirection, sunHeight, daylight, twilight, night: 1 - daylight, warmth, phase };
}
