// SPDX-License-Identifier: AGPL-3.0-only
// Original sample-free synthesis. No music quotations, assets, or external dependencies.
const SIZE = 4096;
const SINE = new Float64Array(SIZE + 1);
for (let i = 0; i <= SIZE; i++) SINE[i] = Math.sin(i * 2 * Math.PI / SIZE);
const SCALE = Object.freeze([0, 2, 4, 7, 9]);
const DEFAULTS = Object.freeze({intensity: .5, brightness: .45, motion: .35, timbre: .5});
const wrap = x => x - Math.floor(x);
function sine(phase) {
  const position = wrap(phase) * SIZE;
  const index = Math.floor(position);
  return SINE[index] + (SINE[index + 1] - SINE[index]) * (position - index);
}
function voice() { return {phase: 0, age: 1, duration: 1, frequency: 0, panL: 0, panR: 0}; }
function frequency(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function clamp(value, fallback) { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback; }

/** Single-render-thread stereo engine. Seed uses its low 32 bits. */
export class AmbientEngine {
  constructor(sampleRate, seed = 1) {
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
      throw new RangeError('sampleRate must be an integer in 8000..192000');
    this.sampleRate = sampleRate;
    this.randomState = Number.isFinite(seed) ? seed >>> 0 : 1;
    this.parameters = DEFAULTS;
    this.intensity = .5; this.brightness = .45; this.motion = .35; this.timbre = .5;
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 1.5));
    this.dcPole = Math.exp(-2 * Math.PI * 12 / sampleRate);
    this.damping = 1 - Math.exp(-2 * Math.PI * 1800 / sampleRate);
    this.delayL = new Float64Array(Math.floor(sampleRate * .293) + 1);
    this.delayR = new Float64Array(Math.floor(sampleRate * .419) + 1);
    this.delayPositionL = 0; this.delayPositionR = 0;
    this.filteredL = 0; this.filteredR = 0; this.previousL = 0; this.previousR = 0;
    this.dcL = 0; this.dcR = 0; this.driftPhase = 0; this.fade = 0;
    this.outputL = 0; this.outputR = 0; this.playing = false;
    this.pads = Array.from({length: 6}, () => {
      const v = voice(); this.renewPad(v); v.age = this.random() * v.duration; v.phase = this.random(); return v;
    });
    this.notes = Array.from({length: 3}, voice);
    this.nextNoteVoice = 0; this.noteCountdown = sampleRate * 3;
  }
  start() { this.playing = true; }
  stop() { this.playing = false; }
  isSilent() { return this.fade === 0 && !this.playing; }
  /** Produces a new frozen target; missing keys preserve previous values. */
  setParameters(update) {
    if (!update || typeof update !== 'object') throw new TypeError('parameters must be an object');
    const previous = this.parameters;
    this.parameters = Object.freeze({
      intensity: clamp(update.intensity, previous.intensity),
      brightness: clamp(update.brightness, previous.brightness),
      motion: clamp(update.motion, previous.motion),
      timbre: clamp(update.timbre, previous.timbre)
    });
  }
  /** Overwrites equal-length planar Float32Array channels; no rendering allocations. */
  render(left, right) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length)
      throw new TypeError('equal-length Float32Array stereo channels required');
    const target = this.parameters, playing = this.playing;
    for (let i = 0; i < left.length; i++) {
      this.next(target, playing); left[i] = this.outputL; right[i] = this.outputR;
    }
  }
  next(target, playing) {
    this.intensity += this.smoothing * (target.intensity - this.intensity);
    this.brightness += this.smoothing * (target.brightness - this.brightness);
    this.motion += this.smoothing * (target.motion - this.motion);
    this.timbre += this.smoothing * (target.timbre - this.timbre);
    if (!playing && this.fade === 0) { this.outputL = 0; this.outputR = 0; return; }
    let left = 0, right = 0;
    this.driftPhase = wrap(this.driftPhase + (.008 + .017 * this.motion) / this.sampleRate);
    const drift = sine(this.driftPhase);
    const colour = .2 + this.timbre * 1.6;
    for (let i = 0; i < this.pads.length; i++) {
      const v = this.pads[i];
      if (v.age >= v.duration) this.renewPad(v);
      const envelope = .5 - .5 * sine(v.age / v.duration + .25);
      const harmonic = sine(v.phase * 2) * (.06 + .19 * this.brightness) * colour
        + sine(v.phase * 3) * (.015 + .065 * this.brightness) * colour
        + sine(v.phase * 4) * .035 * this.timbre * this.brightness;
      const value = (sine(v.phase) + harmonic) * envelope * .095;
      left += value * v.panL; right += value * v.panR;
      v.phase = wrap(v.phase + v.frequency * (1 + drift * .0012 * this.motion) / this.sampleRate);
      v.age += (.75 + this.motion * .5) / this.sampleRate;
    }
    if (--this.noteCountdown <= 0) {
      const v = this.notes[this.nextNoteVoice];
      this.nextNoteVoice = (this.nextNoteVoice + 1) % this.notes.length;
      v.age = 0; v.duration = 7 + this.random() * 5;
      v.frequency = frequency(60 + SCALE[Math.floor(this.random() * SCALE.length)]);
      this.setPan(v);
      this.noteCountdown = Math.floor((8 + this.random() * 9) * this.sampleRate / (.7 + .6 * this.motion));
    }
    for (let i = 0; i < this.notes.length; i++) {
      const v = this.notes[i];
      if (v.age >= v.duration) continue;
      const envelope = .5 - .5 * sine(v.age / v.duration + .25);
      const value = sine(v.phase) * envelope * envelope * (.012 + this.intensity * .028);
      left += value * v.panL; right += value * v.panR;
      v.phase = wrap(v.phase + v.frequency / this.sampleRate); v.age += 1 / this.sampleRate;
    }
    const echoL = this.delayL[this.delayPositionL], echoR = this.delayR[this.delayPositionR];
    this.filteredL += this.damping * (echoL - this.filteredL);
    this.filteredR += this.damping * (echoR - this.filteredR);
    this.delayL[this.delayPositionL] = left + this.filteredR * .58;
    this.delayR[this.delayPositionR] = right + this.filteredL * .58;
    if (++this.delayPositionL === this.delayL.length) this.delayPositionL = 0;
    if (++this.delayPositionR === this.delayR.length) this.delayPositionR = 0;
    left = (left + echoL * .28) * (.30 + this.intensity * .65);
    right = (right + echoR * .28) * (.30 + this.intensity * .65);
    this.dcL = left - this.previousL + this.dcPole * this.dcL;
    this.dcR = right - this.previousR + this.dcPole * this.dcR;
    this.previousL = left; this.previousR = right;
    this.outputL = .85 * this.dcL / (1 + Math.abs(this.dcL)) * this.fade;
    this.outputR = .85 * this.dcR / (1 + Math.abs(this.dcR)) * this.fade;
    const step = 1 / (2 * this.sampleRate);
    this.fade = playing ? Math.min(1, this.fade + step) : Math.max(0, this.fade - step);
    if (!playing && this.fade < 1e-12) this.fade = 0;
  }
  renewPad(v) {
    v.age = 0; v.duration = 25 + this.random() * 28;
    const note = 36 + SCALE[Math.floor(this.random() * SCALE.length)] + (this.random() < .45 ? 12 : 0);
    v.frequency = frequency(note) * (1 + (this.random() - .5) * .0015);
    this.setPan(v);
  }
  setPan(v) { const pan = .12 + .76 * this.random(); v.panL = Math.sqrt(1 - pan); v.panR = Math.sqrt(pan); }
  random() {
    // Mulberry32: bounded unsigned state; all seeds valid, including zero.
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.randomState ^ (this.randomState >>> 15), this.randomState | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
