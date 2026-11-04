// SPDX-License-Identifier: AGPL-3.0-only
// Numerical and runtime-contract checks in Node. Not browser/device latency QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../docs/live-drum-pool.js', import.meta.url), 'utf8');
const {LiveDrumPool} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const IDS = ['kick', 'snare', 'closed-hat', 'toms', 'short-clash'];
const RATE = 8000;
const GAINS = new Float64Array([1, 1, 1, 1, 1]);
const pcm = (value, frames = 8000) => new Float32Array(frames).fill(value);
const zone = (sampleIndex, keyLow = 0, keyHigh = 127, velocityLow = 0, velocityHigh = 1) =>
  ({sampleIndex, keyLow, keyHigh, velocityLow, velocityHigh});
function bank(samples = [pcm(.25)], rate = RATE) {
  return {sampleRate: rate, samples, instruments: IDS.map(id =>
    ({id, gain: 1, oneShot: true, chokeGroup: null, zones: [zone(0)]}))};
}
function advance(pool, frames, gains = GAINS, enabled = true) {
  for (let i = 0; i < frames; i++) pool.next(gains, enabled);
  return pool.outputL;
}
function hit(pool, layer = 5, pitch = 36, velocity = 1, pan = 0) {
  assert.equal(pool.trigger(layer, pitch, velocity, pan), true);
  return advance(pool, 9);
}
function close(actual, expected, eps = 1e-12) { assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`); }
function sampleAndFinish(pool, layer, pitch, velocity, gains = GAINS) {
  assert.equal(pool.trigger(layer, pitch, velocity, 0), true);
  const value = advance(pool, 9, gains);
  advance(pool, 71, gains);
  assert.equal(pool.activeVoices, 0);
  return value;
}

test('all five layers route by exact id regardless of bank order', () => {
  const input = bank([pcm(.125), pcm(.25), pcm(.375), pcm(.5), pcm(.625)]);
  input.instruments.forEach((instrument, i) => { instrument.zones = [zone(i)]; });
  input.instruments.reverse();
  const pool = new LiveDrumPool(RATE, input);
  assert.equal(pool.polyphony, 16); assert.equal(pool.sampleRate, RATE);
  for (let i = 0; i < 5; i++) {
    pool.reset(); close(hit(pool, i + 5), (i + 1) * .125);
  }
});

test('constructor owns copies of PCM, arrays, zones and instrument parameters', () => {
  const input = bank();
  const pool = new LiveDrumPool(RATE, input);
  input.samples[0].fill(2); input.samples[0] = pcm(-2);
  input.instruments[0].gain = 0; input.instruments[0].zones[0].sampleIndex = 100;
  input.instruments[0].zones[0].keyLow = 127; input.instruments.length = 0;
  close(hit(pool), .25);
});

test('one-shot tail, exact silent first/last frames and bounded envelope', () => {
  const frames = 80, pool = new LiveDrumPool(RATE, bank([pcm(.5, frames)]));
  assert.equal(pool.trigger(5, 36, 1, 0), true);
  for (let age = 0; age < frames; age++) {
    pool.next(GAINS, true);
    const envelope = Math.min(1, age / 8) * Math.min(1, (frames - age - 1) / 16);
    close(pool.outputL, .5 * envelope); assert.equal(pool.outputR, 0);
    assert.equal(pool.activeVoices, age === frames - 1 ? 0 : 1);
  }
  advance(pool, 10); assert.equal(pool.outputL, 0);
});

test('velocity, instrument gain, current layer gain and equal-power pan multiply', () => {
  const input = bank([pcm(.5)]); input.instruments[3].gain = .4;
  const pool = new LiveDrumPool(RATE, input);
  assert.equal(pool.trigger(8, 45, .8, .25), true);
  const gains = new Float64Array([1, 1, 1, .3, 1]);
  advance(pool, 9, gains);
  close(pool.outputL, .5 * .4 * .8 * .3 * Math.sqrt(.75));
  close(pool.outputR, .5 * .4 * .8 * .3 * .5);
  gains[3] = .6; pool.next(gains, true);
  close(pool.outputL, .5 * .4 * .8 * .6 * Math.sqrt(.75));
  gains[3] = 0; pool.next(gains, true); assert.equal(pool.outputL, 0);
  gains[3] = 1; pool.next(gains, true); assert.ok(pool.outputL > 0);
});

test('round robin is independent for exact matching soft/hard cohorts', () => {
  const input = bank([pcm(.125, 80), pcm(.25, 80), pcm(.5, 80), pcm(.75, 80)]);
  input.instruments[1].zones = [zone(0, 38, 38, 0, .49), zone(1, 38, 38, 0, .49),
    zone(2, 38, 38, .5, 1), zone(3, 38, 38, .5, 1)];
  const pool = new LiveDrumPool(RATE, input);
  close(sampleAndFinish(pool, 6, 38, .4), .125 * .4);
  close(sampleAndFinish(pool, 6, 38, .8), .5 * .8);
  close(sampleAndFinish(pool, 6, 38, .4), .25 * .4);
  close(sampleAndFinish(pool, 6, 38, .8), .75 * .8);
  close(sampleAndFinish(pool, 6, 38, .4), .125 * .4);
  assert.equal(pool.trigger(6, 38, .495, 0), false);
  assert.equal(pool.trigger(6, 37, .4, 0), false);
  assert.equal(pool.stats.unmapped, 2);
  close(sampleAndFinish(pool, 6, 38, .4), .25 * .4);
});

test('inclusive velocity boundaries and overlapping key ranges select only matches', () => {
  const input = bank([pcm(.125, 80), pcm(.25, 80), pcm(.5, 80)]);
  input.instruments[3].zones = [zone(0, 41, 43, 0, .5), zone(1, 43, 45, .5, 1), zone(2, 48, 48)];
  const pool = new LiveDrumPool(RATE, input);
  close(sampleAndFinish(pool, 8, 43, .5), .125 * .5);
  close(sampleAndFinish(pool, 8, 43, .5), .25 * .5);
  close(sampleAndFinish(pool, 8, 41, .5), .125 * .5);
  close(sampleAndFinish(pool, 8, 45, .5), .25 * .5);
  close(sampleAndFinish(pool, 8, 48, 1), .5);
  assert.equal(pool.trigger(8, 47, 1, 0), false);
});

test('adjacent floating-point velocity boundaries do not create false matches', () => {
  const boundary = .5, nextBoundary = .5 + Number.EPSILON / 2;
  const input = bank([pcm(.125, 80), pcm(.5, 80)]);
  input.instruments[0].zones = [zone(0, 36, 36, 0, boundary), zone(1, 36, 36, nextBoundary, 1)];
  const pool = new LiveDrumPool(RATE, input);
  close(sampleAndFinish(pool, 5, 36, boundary), .125 * boundary);
  close(sampleAndFinish(pool, 5, 36, nextBoundary), .5 * nextBoundary);
});

test('invalid, full and disabled hits do not advance round robin', () => {
  const input = bank([pcm(.125, 80), pcm(.5, 80)]);
  input.instruments[0].zones = [zone(0), zone(1)];
  const pool = new LiveDrumPool(RATE, input, {polyphony: 1});
  assert.equal(pool.trigger(5, 36, 1, 0), true);
  assert.equal(pool.trigger(5, 36, 1, 0), false);
  assert.equal(pool.trigger(5, 36, NaN, 0), false);
  advance(pool, 80);
  pool.setEnabled(false); assert.equal(pool.trigger(5, 36, 1, 0), false);
  pool.setEnabled(true);
  close(sampleAndFinish(pool, 5, 36, 1), .5);
  assert.deepEqual(pool.stats, {accepted: 2, dropped: 3, unmapped: 0, choked: 0});
});

test('sixteen voices are bounded, overflow drops new notes without stealing', () => {
  const pool = new LiveDrumPool(RATE, bank());
  for (let i = 0; i < 16; i++) assert.equal(pool.trigger(5, 36, 1, 0), true);
  for (let i = 0; i < 3000; i++) assert.equal(pool.trigger(6, 38, 1, 0), false);
  assert.equal(pool.activeVoices, 16); close(advance(pool, 9), 4);
  assert.deepEqual(pool.stats, {accepted: 16, dropped: 3000, unmapped: 0, choked: 0});
  advance(pool, RATE); assert.equal(pool.activeVoices, 0);
  assert.equal(pool.trigger(6, 38, 1, 0), true);
});

test('choke fades only matching groups over 5 ms, without disturbing other tails', () => {
  const input = bank([pcm(.25)]);
  input.instruments[2].chokeGroup = 'metal'; input.instruments[4].chokeGroup = 'metal';
  const pool = new LiveDrumPool(RATE, input);
  hit(pool, 7); hit(pool, 5);
  assert.equal(pool.trigger(9, 49, 1, 1), true);
  assert.equal(pool.stats.choked, 1); assert.equal(pool.activeVoices, 3);
  pool.next(GAINS, true); close(pool.outputL, .5); close(pool.outputR, 0);
  advance(pool, 39); close(pool.outputL, .25); close(pool.outputR, .25);
  assert.equal(pool.activeVoices, 2);
});

test('a rejected choke hit cannot silence existing voices', () => {
  const input = bank(); input.instruments[2].chokeGroup = 'hat';
  const pool = new LiveDrumPool(RATE, input, {polyphony: 1});
  hit(pool, 7); assert.equal(pool.trigger(7, 42, 1, 0), false);
  advance(pool, 80); close(pool.outputL, .25);
  assert.equal(pool.stats.choked, 0); assert.equal(pool.activeVoices, 1);
});

test('stop/release are exactly 50 ms, idempotent and do not extend fade', () => {
  for (const method of ['stop', 'release']) {
    const pool = new LiveDrumPool(RATE, bank()); hit(pool);
    pool[method]();
    let previous = .25;
    for (let i = 0; i < 400; i++) {
      pool[method](); pool.next(GAINS, true);
      assert.ok(pool.outputL <= previous + 1e-14); previous = pool.outputL;
      if (i === 0) close(pool.outputL, .25);
      if (i === 398) assert.equal(pool.activeVoices, 1);
    }
    assert.equal(pool.outputL, 0); assert.equal(pool.activeVoices, 0);
    assert.equal(pool.trigger(5, 36, 1, 0), true);
  }
});

test('shorter choke release preserves current release level and never extends it', () => {
  const input = bank(); input.instruments[2].chokeGroup = 'hat';
  const pool = new LiveDrumPool(RATE, input);
  hit(pool, 7); pool.stop(); advance(pool, 100);
  const prior = pool.outputL;
  pool.trigger(7, 42, 1, 1); pool.next(GAINS, true);
  assert.ok(pool.outputL <= prior); assert.ok(pool.outputL > 0);
  assert.equal(pool.stats.choked, 1);
  advance(pool, 20); pool.trigger(7, 42, 1, 1);
  // The first voice is already due to end sooner than another 5 ms fade.
  assert.equal(pool.stats.choked, 2);
  advance(pool, 19); assert.equal(pool.outputL, 0);
});

test('mute and re-enable never queue, retrigger or revive released hits', () => {
  const pool = new LiveDrumPool(RATE, bank()); hit(pool);
  pool.next(GAINS, false); assert.equal(pool.enabled, false);
  for (let i = 0; i < 20; i++) assert.equal(pool.trigger(5, 36, 1, 0), false);
  advance(pool, 100, GAINS, false);
  pool.setEnabled(true);
  advance(pool, 299);
  assert.equal(pool.activeVoices, 0); assert.equal(pool.outputL, 0);
  advance(pool, 100); assert.equal(pool.outputL, 0);
  assert.equal(pool.stats.accepted, 1); assert.equal(pool.stats.dropped, 20);
  assert.equal(pool.trigger(5, 36, 1, 0), true);
});

test('setEnabled enables first-frame dispatch without calling next first', () => {
  const pool = new LiveDrumPool(RATE, bank());
  pool.setEnabled(false); assert.equal(pool.trigger(5, 36, 1, 0), false);
  pool.setEnabled(true); assert.equal(pool.trigger(5, 36, 1, 0), true);
  close(advance(pool, 9), .25);
});

test('reset clears voices, stats and round robin but preserves disabled target', () => {
  const input = bank([pcm(.125), pcm(.5)]);
  input.instruments[0].zones = [zone(0), zone(1)];
  const pool = new LiveDrumPool(RATE, input); hit(pool);
  pool.setEnabled(false); pool.reset();
  assert.equal(pool.enabled, false); assert.equal(pool.activeVoices, 0);
  assert.equal(pool.outputL, 0); assert.equal(pool.outputR, 0);
  assert.deepEqual(pool.stats, {accepted: 0, dropped: 0, unmapped: 0, choked: 0});
  assert.equal(pool.trigger(5, 36, 1, 0), false);
  pool.setEnabled(true); close(hit(pool), .125);
  pool.reset(); assert.equal(pool.enabled, true); close(hit(pool), .125);
});

test('current gain validation never poisons output; invalid events do not throw', () => {
  const pool = new LiveDrumPool(RATE, bank()); hit(pool);
  for (const gains of [null, [], new Float32Array(5), new Float64Array(4),
    new Float64Array([NaN, 1, 1, 1, 1]), new Float64Array([Infinity, 1, 1, 1, 1]),
    new Float64Array([-1, 1, 1, 1, 1])]) {
    pool.next(gains, true); assert.equal(pool.outputL, 0);
  }
  pool.next(new Float64Array([3, 1, 1, 1, 1]), true); close(pool.outputL, .25);
  for (const args of [[4, 36, 1, 0], [10, 36, 1, 0], [5.5, 36, 1, 0], [5, -1, 1, 0],
    [5, 128, 1, 0], [5, 36.5, 1, 0], [5, 36, Infinity, 0], [5, 36, -1, 0],
    [5, 36, 1.1, 0], [5, 36, 1, NaN], [5, 36, 1, -.1], [5, 36, 1, 1.1]]) {
    assert.equal(pool.trigger(...args), false);
  }
  assert.equal(pool.trigger(5, 0, 0, 1), true);
});

test('partitioned block loops produce identical deterministic outputs and counters', () => {
  function render(blockSize) {
    const input = bank([pcm(.25, 800), pcm(-.125, 800)]);
    input.instruments[1].zones = [zone(0), zone(1)]; input.instruments[2].chokeGroup = 'hat';
    const pool = new LiveDrumPool(RATE, input), left = new Float64Array(5000), right = new Float64Array(5000);
    const gains = new Float64Array(GAINS);
    for (let block = 0; block < left.length; block += blockSize) {
      for (let frame = block; frame < Math.min(left.length, block + blockSize); frame++) {
        if (frame % 83 === 0) pool.trigger(5 + (frame % 5), frame % 128, .7, (frame % 3) / 2);
        if (frame === 1500) pool.setEnabled(false);
        if (frame === 1800) pool.setEnabled(true);
        if (frame === 2500) gains[1] = .2;
        if (frame === 3500) pool.stop();
        pool.next(gains, !(frame >= 1500 && frame < 1800));
        left[frame] = pool.outputL; right[frame] = pool.outputR;
        assert.ok(Number.isFinite(left[frame]) && Number.isFinite(right[frame]));
        assert.ok(pool.activeVoices <= 16);
      }
    }
    return {left, right, stats: {...pool.stats}, active: pool.activeVoices};
  }
  const reference = render(5000);
  for (const block of [1, 7, 128, 257]) assert.deepEqual(render(block), reference);
});

test('hot paths contain no dynamic collections, object creation or per-sample trig', () => {
  const hot = source.slice(source.indexOf('  setEnabled('));
  assert.doesNotMatch(hot, /\bnew\s|\.(?:filter|map|shift|splice|push|slice|concat)\s*\(|\.\.\./);
  const next = source.slice(source.indexOf('  next('), source.indexOf('  /** Transport reset'));
  assert.doesNotMatch(next, /Math\.(?:sin|cos|tan|pow|sqrt|exp)\s*\(/);
  const pool = new LiveDrumPool(RATE, bank([pcm(.25, 80)]));
  const saved = {};
  const methods = ['filter', 'map', 'shift', 'splice', 'push', 'slice', 'concat'];
  for (const method of methods) saved[method] = Array.prototype[method];
  const forbidden = () => { throw new Error('Hot-path array allocation/mutation'); };
  let completed = false;
  try {
    for (const method of methods) Array.prototype[method] = forbidden;
    for (let frame = 0; frame < 12000; frame++) {
      if (frame % 10 === 0) pool.trigger(5 + (frame % 5), 36, .5, .5);
      pool.next(GAINS, true);
      if (frame % 1000 === 0) { pool.stop(); pool.release(); pool.reset(); }
    }
    completed = true;
  } finally {
    for (const method of methods) Array.prototype[method] = saved[method];
  }
  assert.ok(completed);
});

test('prepared sinc overshoot is preserved without clipping or normalization', () => {
  for (const value of [-2, -1.25, 1.25, 2]) {
    const pool = new LiveDrumPool(RATE, bank([pcm(value)]));
    close(hit(pool), value);
  }
});

test('valid target sample rates preserve exact 50 ms stop at every engine rate', () => {
  for (const rate of [8000, 44100, 48000, 96000, 192000]) {
    const pool = new LiveDrumPool(rate, bank([pcm(.25, rate)], rate));
    pool.trigger(5, 36, 1, 0); advance(pool, Math.round(rate * .001) + 1);
    close(pool.outputL, .25); pool.stop();
    advance(pool, Math.round(rate * .05) - 1); assert.equal(pool.activeVoices, 1);
    pool.next(GAINS, true); assert.equal(pool.activeVoices, 0); assert.equal(pool.outputL, 0);
  }
});

test('malformed whole banks fail construction without accepting partial definitions', () => {
  const cases = [
    b => { b.sampleRate = RATE + 1; }, b => { b.samples = []; }, b => { b.samples = [null]; },
    b => { b.samples = [new Float64Array(10)]; }, b => { b.samples = [new Float32Array(1)]; },
    b => { b.samples = [new Float32Array(RATE * 10 + 1)]; },
    b => { b.samples = new Array(33).fill(pcm(0, 2)); },
    b => { b.samples[0][5] = NaN; }, b => { b.samples[0][5] = Infinity; },
    b => { b.samples[0][5] = -Infinity; }, b => { b.samples[0][5] = 2.01; },
    b => { b.samples[0][5] = -2.01; }, b => { b.instruments.pop(); },
    b => { b.instruments.push(b.instruments[0]); }, b => { b.instruments[4].id = 'kick'; },
    b => { b.instruments[0].id = 'pad'; }, b => { b.instruments[0].gain = NaN; },
    b => { b.instruments[0].gain = 1.1; }, b => { b.instruments[0].gain = -.1; },
    b => { b.instruments[0].oneShot = false; }, b => { b.instruments[0].oneShot = 1; },
    b => { delete b.instruments[0].chokeGroup; }, b => { b.instruments[0].chokeGroup = ''; },
    b => { b.instruments[0].chokeGroup = 'x'.repeat(33); },
    b => { b.instruments[0].chokeGroup = 1; }, b => { b.instruments[0].zones = []; },
    b => { b.instruments[0].zones = Array.from({length: 65}, () => zone(0)); },
    b => { b.instruments[0].zones[0] = null; }, b => { b.instruments[0].zones[0].keyLow = -1; },
    b => { b.instruments[0].zones[0].keyHigh = 128; }, b => { b.instruments[0].zones[0].keyLow = .5; },
    b => { b.instruments[0].zones[0].keyLow = 80; b.instruments[0].zones[0].keyHigh = 79; },
    b => { b.instruments[0].zones[0].velocityLow = -.1; },
    b => { b.instruments[0].zones[0].velocityHigh = 1.1; },
    b => { b.instruments[0].zones[0].velocityHigh = NaN; },
    b => { b.instruments[0].zones[0].velocityLow = .9; b.instruments[0].zones[0].velocityHigh = .8; },
    b => { b.instruments[0].zones[0].sampleIndex = 1; },
    b => { b.instruments[0].zones[0].sampleIndex = -.1; },
    b => { delete b.instruments[0].zones[0].velocityLow; },
  ];
  for (let i = 0; i < cases.length; i++) {
    const input = bank(); cases[i](input);
    assert.throws(() => new LiveDrumPool(RATE, input), undefined, `case ${i}`);
  }
  for (const rate of [NaN, Infinity, 7999, 192001, 48000.5]) assert.throws(() => new LiveDrumPool(rate, bank()));
  for (const polyphony of [0, 17, 1.5, NaN]) assert.throws(() => new LiveDrumPool(RATE, bank(), {polyphony}));
  assert.throws(() => new LiveDrumPool(RATE, null));
});

test('16 MiB decoded budget includes every sample including unreferenced PCM', () => {
  const rate = 192000, sample = new Float32Array(rate * 10);
  assert.throws(() => new LiveDrumPool(rate, bank([sample, sample, sample], rate)), /budget/);
  const framesLeft = (16 * 1024 * 1024) / 4 - 2 * sample.length;
  const exact = bank([sample, sample, new Float32Array(framesLeft)], rate);
  const pool = new LiveDrumPool(rate, exact); assert.equal(pool.activeVoices, 0);
  exact.samples[2] = new Float32Array(framesLeft + 1);
  assert.throws(() => new LiveDrumPool(rate, exact), /budget/);
});

test('all 64 zones and 32 samples remain addressable with exact key routing', () => {
  const input = bank(Array.from({length: 32}, (_, i) => pcm((i + 1) / 64, 80)));
  input.instruments[3].zones = Array.from({length: 64}, (_, i) => zone(i % 32, i, i));
  const pool = new LiveDrumPool(RATE, input);
  for (let pitch = 0; pitch < 64; pitch++) close(sampleAndFinish(pool, 8, pitch, 1), ((pitch % 32) + 1) / 64);
  assert.equal(pool.trigger(8, 64, 1, 0), false);
});

test('typed-array shadow properties cannot evade decoded byte/frame limits', () => {
  const rate = 192000, sample = new Float32Array(rate * 10);
  Object.defineProperty(sample, 'length', {value: 2});
  Object.defineProperty(sample, 'byteLength', {value: 0});
  assert.throws(() => new LiveDrumPool(rate, bank([sample, sample, sample], rate)), /budget/);
  const oversized = new Float32Array(RATE * 10 + 1);
  Object.defineProperty(oversized, 'length', {value: 2});
  assert.throws(() => new LiveDrumPool(RATE, bank([oversized])), /frames/);
});

test('compiled lookup and independent RR match direct selection for sparse overlapping zones', () => {
  let state = 291297;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const input = bank(Array.from({length: 32}, (_, i) => pcm((i + 1) / 64, 80)));
  const zones = Array.from({length: 64}, (_, i) => {
    const keyLow = Math.floor(random() * 128), velocityLow = Math.floor(random() * 8) / 8;
    return zone(i % 32, keyLow, Math.min(127, keyLow + Math.floor(random() * 40)),
      velocityLow, Math.min(1, velocityLow + Math.floor(random() * 4) / 8));
  });
  input.instruments[0].zones = zones;
  const pool = new LiveDrumPool(RATE, input), counters = new Map();
  let accepted = 0, unmapped = 0;
  for (let trial = 0; trial < 3000; trial++) {
    const pitch = Math.floor(random() * 128);
    const velocity = trial % 2 ? Math.floor(random() * 9) / 8 : random();
    const matches = [];
    zones.forEach((z, i) => {
      if (pitch >= z.keyLow && pitch <= z.keyHigh && velocity >= z.velocityLow && velocity <= z.velocityHigh) matches.push(i);
    });
    if (!matches.length) {
      assert.equal(pool.trigger(5, pitch, velocity, 0), false); unmapped++; continue;
    }
    const key = matches.join(','), cursor = counters.get(key) || 0;
    const chosen = zones[matches[cursor]];
    counters.set(key, (cursor + 1) % matches.length);
    close(sampleAndFinish(pool, 5, pitch, velocity), input.samples[chosen.sampleIndex][8] * velocity);
    accepted++;
  }
  assert.deepEqual(pool.stats, {accepted, dropped: 0, unmapped, choked: 0});
});
