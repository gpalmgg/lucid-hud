import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moonPhase,
  sunTimes,
  isNight,
  timePhrase,
  sparkline,
  gradientBar,
  renderAnimatedPet,
} from '../dist/vibes.js';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('moonPhase: known full moon 2024-04-23 reads full', () => {
  const moon = moonPhase(Date.UTC(2024, 3, 23, 23, 49));
  assert.equal(moon.name, 'full');
  assert.equal(moon.glyph, '🌕');
});

test('moonPhase: known new moon 2024-04-08 reads new', () => {
  assert.equal(moonPhase(Date.UTC(2024, 3, 8, 18, 21)).name, 'new');
});

test('sunTimes: Greenwich summer solstice is within a few minutes of 03:43/20:22 UTC', () => {
  const sun = sunTimes(Date.UTC(2024, 5, 21, 10), 51.4769, 0);
  assert.ok(sun);
  const rise = new Date(sun.rise);
  const set = new Date(sun.set);
  const riseMin = rise.getUTCHours() * 60 + rise.getUTCMinutes();
  const setMin = set.getUTCHours() * 60 + set.getUTCMinutes();
  assert.ok(Math.abs(riseMin - (3 * 60 + 43)) <= 5, `rise ${riseMin}`);
  assert.ok(Math.abs(setMin - (20 * 60 + 22)) <= 5, `set ${setMin}`);
});

test('isNight: midnight is night, noon is day (explicit location)', () => {
  assert.equal(isNight(Date.UTC(2024, 5, 21, 23), 51.4769, 0), true);
  assert.equal(isNight(Date.UTC(2024, 5, 21, 11), 51.4769, 0), false);
});

test('no location configured: sun times are null and nothing breaks', () => {
  assert.equal(sunTimes(Date.UTC(2024, 5, 21, 10), null, null), null);
  // falls back to the local clock
  assert.equal(isNight(new Date(2024, 5, 21, 23).getTime(), null, null), true);
  assert.equal(isNight(new Date(2024, 5, 21, 12).getTime(), null, null), false);
});

test('timePhrase returns a non-empty phrase', () => {
  assert.ok(timePhrase(Date.now()).length > 0);
});

test('sparkline scales to the max value', () => {
  assert.equal(sparkline([0, 1, 2, 4]), '▁▂▄█');
  assert.equal(sparkline([]), '');
});

test('gradientBar keeps width and fill ratio', () => {
  const bar = stripAnsi(gradientBar(50, 10));
  assert.equal(bar.length, 10);
  assert.equal([...bar].filter(c => c === '█').length, 5);
  assert.equal(stripAnsi(gradientBar(150, 4)), '████');
});

test('renderAnimatedPet: owl at night, cat by day', () => {
  assert.match(stripAnsi(renderAnimatedPet('alert', new Date(2024, 5, 21, 23).getTime())), /^\{/);
  assert.match(stripAnsi(renderAnimatedPet('alert', new Date(2024, 5, 21, 12).getTime())), /^\(/);
});
