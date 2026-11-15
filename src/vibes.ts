import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { getHudPluginDir } from './claude-config-dir.js';
import type { PetMood } from './pet.js';

/**
 * Vibes: the sky line + whisper line of the HUD, plus the animated pet.
 * Everything here is best-effort and must never slow the statusline:
 * network (weather) and subprocess (fortune) results are cached on disk and
 * refreshed in a detached child, so a render only ever reads files.
 *
 * There is no default location. Set LUCID_HUD_CITY (weather) and/or
 * LUCID_HUD_LAT + LUCID_HUD_LON (sun times, and weather when no city is set).
 * With neither set, the sun and weather segments are simply hidden.
 */

function envNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const envLat = envNumber('LUCID_HUD_LAT');
const envLon = envNumber('LUCID_HUD_LON');
const LAT = envLat !== null && envLon !== null && Math.abs(envLat) <= 90 ? envLat : null;
const LON = LAT !== null && envLon !== null && Math.abs(envLon) <= 180 ? envLon : null;
const CITY = process.env.LUCID_HUD_CITY?.trim() || null;

const WEATHER_TTL_MS = 30 * 60_000;
const FORTUNE_TTL_MS = 60 * 60_000;
const SPARK_SESSIONS = 12;
const STATE_FILE = 'vibes-state.json';
const WEATHER_FILE = 'vibes-weather.txt';

// Rosé Pine Moon
export const ROSE_PINE = {
  muted: '#6e6a86',
  subtle: '#908caa',
  text: '#e0def4',
  love: '#eb6f92',
  gold: '#f6c177',
  rose: '#ea9a97',
  pine: '#3e8fb0',
  foam: '#9ccfd8',
  iris: '#c4a7e7',
} as const;

const RESET = '\x1b[0m';

export function hex(color: string, text: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

// ── state ────────────────────────────────────────────────

interface VibesState {
  fortune?: string;
  fortuneAt?: number;
  costs?: Record<string, { cost: number; at: number }>;
  moods?: Record<string, PetMood>;
}

function stateDir(): string {
  return getHudPluginDir(os.homedir());
}

function readState(): VibesState {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(), STATE_FILE), 'utf8')) as VibesState;
  } catch {
    return {};
  }
}

function writeState(state: VibesState): void {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(path.join(stateDir(), STATE_FILE), JSON.stringify(state));
  } catch {
    /* best-effort */
  }
}

// ── moon ─────────────────────────────────────────────────

const SYNODIC_DAYS = 29.530588853;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const MOON_GLYPHS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const MOON_NAMES = ['new', 'waxing', 'first qtr', 'waxing', 'full', 'waning', 'last qtr', 'waning'];

export function moonPhase(now: number): { glyph: string; name: string; age: number } {
  const days = (now - KNOWN_NEW_MOON_MS) / 86_400_000;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const index = Math.round((age / SYNODIC_DAYS) * 8) % 8;
  return { glyph: MOON_GLYPHS[index], name: MOON_NAMES[index], age: Math.floor(age) };
}

// ── sun (NOAA simplified) ────────────────────────────────

export function sunTimes(
  now: number,
  lat: number | null = LAT,
  lon: number | null = LON,
): { rise: number; set: number } | null {
  if (lat === null || lon === null) return null; // no location configured
  const rad = Math.PI / 180;
  const date = new Date(now);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((now - startOfYear) / 86_400_000) + 1;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))
    - Math.tan(lat * rad) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null; // polar day / night
  const ha = Math.acos(cosHa) / rad;
  const midnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const riseMin = 720 - 4 * (lon + ha) - eqTime;
  const setMin = 720 - 4 * (lon - ha) - eqTime;
  return { rise: midnightUtc + riseMin * 60_000, set: midnightUtc + setMin * 60_000 };
}

export function isNight(now: number, lat: number | null = LAT, lon: number | null = LON): boolean {
  const sun = sunTimes(now, lat, lon);
  if (!sun) {
    // No location (or polar day/night): fall back to the local clock.
    if (lat !== null && lon !== null) return false;
    const hour = new Date(now).getHours();
    return hour >= 22 || hour < 6;
  }
  return now < sun.rise || now > sun.set;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function span(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
}

function sunLabel(now: number): string | null {
  const sun = sunTimes(now);
  if (!sun) return null;
  if (now < sun.rise) return `🌅 rises ${clock(sun.rise)} (in ${span(sun.rise - now)})`;
  if (now < sun.set) return `☀️ sets ${clock(sun.set)} (in ${span(sun.set - now)})`;
  const tomorrow = sunTimes(now + 86_400_000);
  return tomorrow ? `🌅 rises ${clock(tomorrow.rise)}` : null;
}

// ── time of day ──────────────────────────────────────────

export function timePhrase(now: number): string {
  const sun = sunTimes(now);
  const hour = new Date(now).getHours();
  if (sun) {
    if (now >= sun.set - 60 * 60_000 && now < sun.set) return 'golden hour';
    if (now >= sun.set && now < sun.set + 45 * 60_000) return 'blue hour';
    if (now >= sun.rise && now < sun.rise + 60 * 60_000) return 'first light';
  }
  if (hour >= 23 || hour < 5) return 'owl hours';
  if (hour < 9) return 'early morning';
  if (hour < 12) return 'morning flow';
  if (hour < 14) return 'midday';
  if (hour < 18) return 'afternoon drift';
  return 'evening';
}

// ── weather (cached, refreshed in a detached curl) ───────

function weatherQuery(): string | null {
  if (CITY) return CITY;
  if (LAT !== null && LON !== null) return `${LAT},${LON}`;
  return null;
}

function weatherLabel(now: number): string | null {
  const query = weatherQuery();
  if (!query) return null; // no location configured: hide the segment
  const file = path.join(stateDir(), WEATHER_FILE);
  let text: string | null = null;
  let stale = true;
  try {
    const stat = fs.statSync(file);
    stale = now - stat.mtimeMs > WEATHER_TTL_MS;
    text = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ').trim();
  } catch {
    /* no cache yet */
  }
  if (stale) refreshWeather(file, query);
  // wttr.in returns an HTML/error page on failure — only accept short answers
  if (!text || text.length > 24 || /unknown|error|<|sorry/i.test(text)) return null;
  return CITY ? `${text} ${CITY}` : text;
}

function refreshWeather(file: string, query: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Touch first so concurrent renders don't all spawn a curl.
    const fd = fs.openSync(file, 'a');
    fs.closeSync(fd);
    fs.utimesSync(file, new Date(), new Date());
    const tmp = `${file}.tmp`;
    const encoded = encodeURIComponent(query).replace(/'/g, '%27'); // keep the shell quoting safe
    const url = `https://wttr.in/${encoded}?format=%c%t`;
    const child = spawn('sh', ['-c', `curl -sfm 5 '${url}' > '${tmp}' && [ -s '${tmp}' ] && mv '${tmp}' '${file}'`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    /* best-effort */
  }
}

// ── fortune (cached hourly) ──────────────────────────────

// Calm sources only — the default pool includes zippy (anxious non-sequiturs).
const FORTUNE_FILES = ['wisdom', 'literature', 'songs-poems', 'people'];

function fortuneLabel(state: VibesState, now: number): string | null {
  if (state.fortune && state.fortuneAt && now - state.fortuneAt < FORTUNE_TTL_MS) {
    return state.fortune;
  }
  try {
    const result = spawnSync('fortune', ['-s', '-n', '70', ...FORTUNE_FILES], { encoding: 'utf8', timeout: 800 });
    const text = (result.stdout ?? '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 80) {
      state.fortune = text;
      state.fortuneAt = now;
      return text;
    }
  } catch {
    /* fortune not installed */
  }
  return state.fortune ?? null;
}

// ── cost sparkline ───────────────────────────────────────

const SPARKS = '▁▂▃▄▅▆▇█';

export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 0.01);
  return values.map(v => SPARKS[Math.min(7, Math.floor((v / max) * 7.999))]).join('');
}

function costSpark(state: VibesState, sessionId: string | undefined, cost: number, now: number): string | null {
  const costs = state.costs ?? {};
  if (sessionId && cost > 0) {
    costs[sessionId] = { cost, at: costs[sessionId]?.at ?? now };
  }
  const recent = Object.values(costs).sort((a, b) => a.at - b.at).slice(-SPARK_SESSIONS);
  state.costs = Object.fromEntries(
    Object.entries(costs).sort((a, b) => a[1].at - b[1].at).slice(-SPARK_SESSIONS * 2),
  );
  if (recent.length < 2) return null;
  return sparkline(recent.map(r => r.cost));
}

// ── animated pet (cat by day, owl by night) ──────────────

const CAT_FRAMES: Record<PetMood, string[]> = {
  sleepy: ['(=-.-=) z', '(=-.-=) zZ', '(=-.-=) zZz', '(=-.-=)'],
  alert: ['(=o.o=)~', '(=o.o=)_/', '(=-.o=)~', '(=o.o=)\\_', '(=o.-=)~'],
  sick: ['(=x.x=)', '(=@.@=);', '(=x.x=);;'],
  happy: ['(=^.^=) ♪', '(=^ω^=) ♫', '(=^.^=)♪♫'],
};

const OWL_FRAMES: Record<PetMood, string[]> = {
  sleepy: ['{-,-} z', '{-,-} zZ', '{-,-} zZz', '{-,-}'],
  alert: ['{o,o}', '{O,o}', '{o,O}', '{-,-}', '{o,o}>'],
  sick: ['{x,x}', '{@,@};'],
  happy: ['{^,^} ♪', '{^,^}♪♫'],
};

const PET_COLORS: Record<PetMood, string> = {
  sleepy: ROSE_PINE.iris,
  alert: ROSE_PINE.foam,
  sick: ROSE_PINE.love,
  happy: ROSE_PINE.gold,
};

/** One frame per statusLine refresh (refreshInterval: 2), padded so the line doesn't jitter. */
export function renderAnimatedPet(mood: PetMood, now: number = Date.now()): string {
  const frames = (isNight(now) ? OWL_FRAMES : CAT_FRAMES)[mood];
  const width = Math.max(...frames.map(f => [...f].length));
  const frame = frames[Math.floor(now / 2000) % frames.length];
  return hex(PET_COLORS[mood], frame.padEnd(width + frame.length - [...frame].length));
}

// ── sound cues on mood transitions ───────────────────────

const MOOD_SOUNDS: Partial<Record<PetMood, string>> = {
  happy: '/System/Library/Sounds/Glass.aiff',
  sick: '/System/Library/Sounds/Submarine.aiff',
};

export function petMoodTransition(sessionId: string | undefined, mood: PetMood, sounds: boolean): void {
  if (!sessionId) return;
  const state = readState();
  const moods = state.moods ?? {};
  const previous = moods[sessionId];
  if (previous === mood) return;
  moods[sessionId] = mood;
  state.moods = Object.fromEntries(Object.entries(moods).slice(-20));
  writeState(state);
  const sound = MOOD_SOUNDS[mood];
  if (sounds && previous !== undefined && sound && process.platform === 'darwin') {
    try {
      spawn('afplay', ['-v', '0.4', sound], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* best-effort */
    }
  }
}

// ── lines ────────────────────────────────────────────────

export function renderVibeLines(sessionId: string | undefined, cost: number, now: number = Date.now()): string[] {
  const state = readState();
  const dot = hex(ROSE_PINE.muted, ' · ');

  const moon = moonPhase(now);
  const sky: string[] = [
    hex(ROSE_PINE.iris, `${moon.glyph} ${moon.name} d${moon.age}`),
  ];
  const weather = weatherLabel(now);
  if (weather) sky.push(hex(ROSE_PINE.foam, weather));
  const sun = sunLabel(now);
  if (sun) sky.push(hex(ROSE_PINE.gold, sun));
  sky.push(hex(ROSE_PINE.rose, `✧ ${timePhrase(now)}`));

  const whisper: string[] = [];
  const fortune = fortuneLabel(state, now);
  if (fortune) whisper.push(hex(ROSE_PINE.subtle, `❝ ${fortune}`));
  const spark = costSpark(state, sessionId, cost, now);
  if (spark) whisper.push(`${hex(ROSE_PINE.muted, 'spend')} ${hex(ROSE_PINE.pine, spark)}`);

  writeState(state);

  const lines = [sky.join(dot)];
  if (whisper.length > 0) lines.push(whisper.join(dot));
  return lines;
}

// ── gradient bars ────────────────────────────────────────

const GRADIENT_STOPS = [ROSE_PINE.foam, ROSE_PINE.iris, ROSE_PINE.rose, ROSE_PINE.gold, ROSE_PINE.love];

function lerp(a: string, b: string, t: number): [number, number, number] {
  const ca = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const cb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return ca.map((v, i) => Math.round(v + (cb[i] - v) * t)) as [number, number, number];
}

/** A bar whose cells sweep foam → iris → rose → gold → love by position, so fuller bars run hotter. */
export function gradientBar(percent: number, width: number): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  let out = '';
  for (let i = 0; i < filled; i += 1) {
    const pos = safeWidth <= 1 ? 0 : (i / (safeWidth - 1)) * (GRADIENT_STOPS.length - 1);
    const seg = Math.min(GRADIENT_STOPS.length - 2, Math.floor(pos));
    const [r, g, b] = lerp(GRADIENT_STOPS[seg], GRADIENT_STOPS[seg + 1], pos - seg);
    out += `\x1b[38;2;${r};${g};${b}m█`;
  }
  const m = ROSE_PINE.muted;
  out += `\x1b[38;2;${parseInt(m.slice(1, 3), 16)};${parseInt(m.slice(3, 5), 16)};${parseInt(m.slice(5, 7), 16)}m${'░'.repeat(safeWidth - filled)}`;
  return `${out}${RESET}`;
}
