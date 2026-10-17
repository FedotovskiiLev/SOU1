// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../docs/audio-engine.js', import.meta.url), 'utf8');
const weather = await readFile(new URL('../docs/environment-audio.js', import.meta.url), 'utf8');
const historySource=await readFile(new URL('../docs/note-history.js',import.meta.url),'utf8');
const historyUrl=`data:text/javascript;base64,${Buffer.from(historySource).toString('base64')}`;
const weatherUrl = `data:text/javascript;base64,${Buffer.from(weather).toString('base64')}`;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source.replace("'./environment-audio.js'", JSON.stringify(weatherUrl))).toString('base64')}`;
const {AmbientEngine, MacroBus} = await import(moduleUrl);
const neutral = {warmth: 0, strength: 0, width: .5, wash: 0};
for (const rate of [8000, 48000, 192000]) {
  const dry = new MacroBus(rate);
  dry.process(.123, -.234, neutral);
  assert.equal(dry.left, .123); assert.equal(dry.right, -.234);
  const mono = new MacroBus(rate), wide = new MacroBus(rate);
  for (let i = 0; i < rate; i++) {
    mono.process(.2, -.1, {...neutral, width: 0});
    wide.process(.2, -.1, {...neutral, width: 1});
  }
  assert(Math.abs(mono.left - mono.right) < 1e-8);
  assert(Math.abs(wide.left - .175) < 1e-8 && Math.abs(wide.right + .125) < 1e-8);
  const wash = new MacroBus(rate), target = {...neutral, wash: 1};
  for (let i = 0; i < rate; i++) wash.process(0, 0, target);
  let early = 0, late = 0, stereo = 0;
  for (let i = 0; i < rate * 5; i++) {
    wash.process(i === 0 ? 1 : 0, 0, target);
    assert(Number.isFinite(wash.left) && Number.isFinite(wash.right));
    if (i > rate * .02 && i < rate) early += wash.left ** 2 + wash.right ** 2;
    if (i > rate * 4) late += wash.left ** 2 + wash.right ** 2;
    stereo += Math.abs(wash.left - wash.right);
  }
  assert(early > 1e-5 && late < early * 1e-8 && stereo > .1);
}
const transition = new MacroBus(8000);
for(let i=0;i<8000;i++) transition.process(.1,-.05,neutral);
const before = transition.left;
transition.process(.1,-.05,{warmth:1,strength:1,width:0,wash:1});
assert(Math.abs(transition.left-before)<.001, '50ms macro transition boundary');
for (const macro of ['warmth', 'strength']) {
  const bus = new MacroBus(8000), target = {...neutral, [macro]: 1};
  let error = 0;
  for (let i = 0; i < 8000; i++) {
    const x = .1 * Math.sin(i * 1.7);
    bus.process(x, x, target);
    if (i > 4000) error += Math.abs(bus.left - x);
  }
  assert(error > 1, macro + ' has an audible numerical effect');
}
const buffer = n => new Float32Array(n);
const a = new AmbientEngine(8000, 0), b = new AmbientEngine(8000, 0), c = new AmbientEngine(8000, 1);
a.setParameters({warmth:1,strength:1,width:1,wash:1});
b.setParameters({warmth:1,strength:1,width:1,wash:1});
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
      warmth: (rendered / 128) % 2, strength: 1, width: (rendered / 128) % 2, wash: 1,
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
  .replace("'./note-history.js'",JSON.stringify(historyUrl)).replace("'./audio-engine.js'", JSON.stringify(moduleUrl));
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
assert.deepEqual(processor.messages.map(m=>m.type), ['score','score','silent']);
assert(processor.messages[0].score.events.length>0);
assert.deepEqual(processor.messages[0].score.events,processor.messages[1].score.events);
assert.equal(processor.messages[1].score.seed,7);
assert(processor.messages[1].score.frame>=processor.messages[0].score.frame);
processor.port.onmessage({data:{type:'score-export',requestId:123}});
assert.equal(processor.messages.at(-1).type,'score-export');
assert.equal(processor.messages.at(-1).requestId,123);
assert.deepEqual(processor.messages.at(-1).score.events,processor.messages[1].score.events);
assert(channels[0].every(x => x === 0));
processor.port.onmessage({data: {type: 'start'}}); processor.process([], outputs);
assert(channels[0].some(x => x !== 0));
const sameEngine=processor.engine;
processor.port.onmessage({data:{type:'parameters',parameters:{ambient:.3,counterpoint:.7,rhythmic:.4,arpeggio:.2,density:.8,complexity:.9,swing:.4,bpm:117}}});
const savedControls=processor.engine.parameters;
processor.port.onmessage({data:{type:'reseed',seed:987}});
for(let i=0;i<20;i++)processor.process([],outputs);
assert.equal(processor.engine,sameEngine);assert.equal(processor.engine.seed,987);assert.equal(processor.engine.parameters,savedControls);assert(processor.engine.playing);
console.log('PASS: JS DSP and AudioWorklet contract, including knob snapshot and same-engine reseed');

processor.port.onmessage({data:{type:'score'}});
const scoreMessage=processor.messages.at(-1);
assert.equal(scoreMessage.type,'score');assert.equal(scoreMessage.score.seed,987);
assert(scoreMessage.score.events.length>0&&scoreMessage.score.events.length<=512);
assert(scoreMessage.score.events.every(e=>e[0]<=processor.engine.frame));
console.log('PASS actual worklet generated-note telemetry after reseed');
