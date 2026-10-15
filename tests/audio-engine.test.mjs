// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../docs/audio-engine.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {AmbientEngine} = await import(moduleUrl);
const buffer = n => new Float32Array(n);
const a = new AmbientEngine(8000, 0), b = new AmbientEngine(8000, 0), c = new AmbientEngine(8000, 1);
a.start(); b.start(); c.start();
let l = buffer(8000), r = buffer(8000), bl = buffer(8000), br = buffer(8000);
a.render(l, r);
for (let i = 0; i < 8000; i += 100) b.render(bl.subarray(i, i + 100), br.subarray(i, i + 100));
assert.deepEqual(l, bl); assert.deepEqual(r, br);
c.render(bl, br); assert.notDeepEqual(l, bl);
a.setParameters({timbre: 1, intensity: 1});
assert(Object.isFrozen(a.parameters));
assert.equal(a.parameters.brightness, .45);
a.render(l.subarray(0, 1), r.subarray(0, 1));
b.render(bl.subarray(0, 1), br.subarray(0, 1));
assert(Math.abs(l[0] - bl[0]) < .0001);
a.setParameters({motion: NaN, brightness: Infinity, intensity: -100});
assert.equal(a.parameters.motion, .35); assert.equal(a.parameters.intensity, 0);
a.stop(); a.render(l, r); a.render(l, r); a.render(l, r);
assert(a.isSilent()); assert(l.every(x => x === 0));
a.start(); a.render(l, r); assert(l.some(x => x !== 0));
assert.throws(() => new AmbientEngine(7999));
assert.throws(() => new AmbientEngine(48000.5));
assert.throws(() => a.render(buffer(1), buffer(2)));
assert.throws(() => a.setParameters(null));
for (const rate of [8000, 44100, 48000, 96000, 192000]) {
  const engine = new AmbientEngine(rate, 42);
  const seconds = rate === 8000 ? 600 : 20;
  const frames = rate * seconds;
  l = buffer(128); r = buffer(128);
  engine.start();
  let peak = 0, power = 0, mean = 0, delta = 0, lastL = 0, lastR = 0, rendered = 0;
  while (rendered < frames) {
    if (rendered % (128 * 71) === 0) engine.setParameters({
      intensity: (rendered / 128) % 2, brightness: 1, motion: 1, timbre: (rendered / 128) % 2
    });
    engine.render(l, r);
    for (let i = 0; i < 128; i++) {
      if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) throw new Error('nonfinite PCM');
      peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      power += l[i] ** 2 + r[i] ** 2;
      mean += l[i] + r[i];
      delta = Math.max(delta, Math.abs(l[i] - lastL), Math.abs(r[i] - lastR));
      lastL = l[i]; lastR = r[i];
    }
    rendered += 128;
  }
  const rms = Math.sqrt(power / (rendered * 2));
  assert(peak < .85 && rms > .005 && rms < .2);
  assert(Math.abs(mean / (rendered * 2)) < .001); assert(delta < .1);
  console.log(`${rate} Hz: ${seconds}s, peak ${peak.toFixed(4)}, RMS ${rms.toFixed(4)}, delta ${delta.toFixed(4)}`);
}
// Exercise the real adapter using a minimal AudioWorklet host shim.
let Processor;
globalThis.sampleRate = 8000;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = {postMessage: m => this.messages.push(m)}; }
};
globalThis.registerProcessor = (name, cls) => { assert.equal(name, 'sou1-ambient'); Processor = cls; };
const adapter = (await readFile(new URL('../docs/audio-worklet.js', import.meta.url), 'utf8'))
  .replace("'./audio-engine.js'", JSON.stringify(moduleUrl));
await import(`data:text/javascript;base64,${Buffer.from(adapter).toString('base64')}`);
const processor = new Processor({processorOptions: {seed: 7}});
const channels = [buffer(128), buffer(128)];
const outputs = [channels];
processor.port.onmessage({data: {type: 'start'}});
for (let i = 0; i < 200; i++) assert.equal(processor.process([], outputs), true);
assert(channels[0].some(x => x !== 0));
processor.port.onmessage({data: {type: 'parameters', parameters: {timbre: 1}}});
processor.port.onmessage({data: {type: 'stop'}});
for (let i = 0; i < 200; i++) processor.process([], outputs);
assert.deepEqual(processor.messages, [{type: 'silent'}]);
assert(channels[0].every(x => x === 0));
processor.port.onmessage({data: {type: 'start'}}); processor.process([], outputs);
assert(channels[0].some(x => x !== 0));
console.log('PASS: JS DSP and AudioWorklet contract');
