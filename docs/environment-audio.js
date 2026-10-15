// SPDX-License-Identifier: AGPL-3.0-only
// Original procedural weather; no recordings, samples, or dependencies.
const unit = (v, old) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : old;
const smooth = (v, target, c) => Math.abs(v - target) < 1e-7 ? target : v + c * (target - v);
/** One render-thread instance. Control updates allocate; rendering never does.
 * next() writes outputL/outputR. render() overwrites; mix() adds bounded weather
 * to existing planar channels (the caller must limit the final combined mix).
 */
export class EnvironmentAudio {
  constructor(sampleRate, seed = 1) {
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
      throw new RangeError('sampleRate must be an integer in 8000..192000');
    this.sampleRate = sampleRate;
    this.seed = Number.isFinite(seed) ? seed >>> 0 : 1;
    this.parameters = Object.freeze({rainType: 0, rain: 0, thunder: 0, wind: 0});
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * .12));
    this.rainPole = 1 - Math.exp(-2 * Math.PI * 1500 / sampleRate);
    this.windPole = 1 - Math.exp(-2 * Math.PI * 280 / sampleRate);
    this.thunderPole = 1 - Math.exp(-2 * Math.PI * 95 / sampleRate);
    this.dcPole = 1 - Math.exp(-2 * Math.PI * 12 / sampleRate);
    this.noiseScale = Math.sqrt(sampleRate / 48000);
    this.airPole = 1 - Math.exp(-2 * Math.PI * 1800 / sampleRate);
    this.dropDamp = Math.exp(-1 / (sampleRate * .004));
    this.dropDrive = new Float64Array(24);
    this.dropFast = Math.exp(-1 / (sampleRate * .0015));
    this.dropSlow = Math.exp(-1 / (sampleRate * .018));
    this.dropA = new Float64Array(24); this.dropB = new Float64Array(24);
    this.dropPan = new Float64Array(24); this.dropTone = new Float64Array(24);
    this.dropY = new Float64Array(24); this.dropZ = new Float64Array(24);
    this.rollDelay = new Float64Array(7); this.rollDuration = new Float64Array(7);
    this.rollGain = new Float64Array(7);
    this.reset();
  }
  setParameters(update) {
    if (!update || typeof update !== 'object') throw new TypeError('parameters must be an object');
    const p = this.parameters;
    this.parameters = Object.freeze({
      rainType: Number.isFinite(update.rainType) ? Math.max(0, Math.min(3, Math.round(update.rainType))) : p.rainType,
      rain: unit(update.rain, p.rain), thunder: unit(update.thunder, p.thunder), wind: unit(update.wind, p.wind)
    });
  }
  start() { this.playing = true; }
  stop() { this.playing = false; }
  isSilent() { return this.light === 0 && this.steady === 0 && this.heavy === 0 && this.thunder === 0 && this.wind === 0; }
  /** Immediate transport reset on the rendering thread; preserves control targets. */
  reset() {
    this.playing = false;
    this.rainState = (this.seed ^ 0x51ed270b) >>> 0;
    this.windState = (this.seed ^ 0x68bc21eb) >>> 0;
    this.thunderState = (this.seed ^ 0x02e5be93) >>> 0;
    this.light = this.steady = this.heavy = this.wind = this.thunder = 0;
    this.rainL = this.rainR = this.windL = this.windR = this.windDcL = this.windDcR = 0;
    this.rumbleL = this.rumbleR = this.rumbleDcL = this.rumbleDcR = 0;
    this.dropDrive.fill(0); this.dropA.fill(0); this.dropB.fill(0); this.dropPan.fill(0);
    this.dropTone.fill(0); this.dropY.fill(0); this.dropZ.fill(0);
    this.rollDelay.fill(0); this.rollDuration.fill(0); this.rollGain.fill(0);
    this.dropIndex = 0; this.airL = this.airR = this.crackL = this.crackR = 0;
    this.rainFineL = this.rainFineR = 0;
    this.gust = .5; this.gustTarget = .5; this.gustCountdown = 0;
    this.thunderCountdown = Math.floor(this.sampleRate * 1.5);
    this.rollAge = this.rollLength = 0;
    this.outputL = this.outputR = 0;
  }
  rainRandom() { this.rainState = (Math.imul(this.rainState, 1664525) + 1013904223) >>> 0; return this.rainState / 4294967296; }
  windRandom() { this.windState = (Math.imul(this.windState, 1664525) + 1013904223) >>> 0; return this.windState / 4294967296; }
  thunderRandom() { this.thunderState = (Math.imul(this.thunderState, 1664525) + 1013904223) >>> 0; return this.thunderState / 4294967296; }
  next() {
    const p = this.parameters, on = this.playing, c = this.smoothing;
    this.light = smooth(this.light, on && p.rainType === 1 ? p.rain : 0, c);
    this.steady = smooth(this.steady, on && p.rainType === 2 ? p.rain : 0, c);
    this.heavy = smooth(this.heavy, on && p.rainType === 3 ? p.rain : 0, c);
    this.wind = smooth(this.wind, on ? p.wind : 0, c);
    this.thunder = smooth(this.thunder, on ? p.thunder : 0, c);
    if (!on && this.isSilent()) { this.outputL = this.outputR = 0; return; }
    // Fine patter plus bounded, individually panned damped drop resonances.
    const rl = this.rainRandom() * 2 - 1, rr = this.rainRandom() * 2 - 1;
    this.rainL += this.rainPole * (rl - this.rainL);
    this.rainR += this.rainPole * (rr - this.rainR);
    this.rainFineL += this.airPole * (rl - this.rainFineL);
    this.rainFineR += this.airPole * (rr - this.rainFineR);
    const rainGain = this.light + this.steady + this.heavy;
    const density = rainGain > 0 ? (16 * this.light + 85 * this.steady + 240 * this.heavy) / rainGain : 16;
    if (this.rainRandom() < density / this.sampleRate) {
      const k = this.dropIndex; this.dropIndex = (k + 1) % 24;
      this.dropA[k] = this.dropB[k] = .45 + .55 * this.rainRandom();
      this.dropPan[k] = this.rainRandom();
      const angle = 2 * Math.PI * (650 + 2300 * this.rainRandom()) / this.sampleRate;
      this.dropTone[k] = 2 * this.dropDamp * Math.cos(angle);
      this.dropDrive[k] = 3 * (1 - this.dropDamp) * Math.sin(angle);
      // Resonance starts at zero, then receives a short noise excitation.
      this.dropY[k] = this.dropZ[k] = 0;
    }
    let dropsL = 0, dropsR = 0;
    for (let k = 0; k < 24; k++) {
      this.dropA[k] *= this.dropFast; this.dropB[k] *= this.dropSlow;
      const env = this.dropB[k] - this.dropA[k];
      const y = this.dropTone[k] * this.dropY[k] - this.dropDamp * this.dropDamp * this.dropZ[k] + this.dropDrive[k] * env * (k % 2 === 0 ? rl : rr);
      this.dropZ[k] = this.dropY[k]; this.dropY[k] = y;
      const drop = .6 * env * (k % 2 === 0 ? this.rainFineL : this.rainFineR) + y;
      dropsL += drop * (1 - this.dropPan[k]); dropsR += drop * this.dropPan[k];
    }
    const fine = .009 * this.light + .025 * this.steady + .055 * this.heavy;
    const body = .008 * this.light + .025 * this.steady + .07 * this.heavy;
    let left = this.noiseScale * (fine * (this.rainFineL - this.rainL) + body * this.rainL + .13 * rainGain * dropsL);
    let right = this.noiseScale * (fine * (this.rainFineR - this.rainR) + body * this.rainR + .13 * rainGain * dropsR);
    // Broad filtered air, not a sine-wave howl; slow asymmetric gusts.
    if (--this.gustCountdown <= 0) {
      this.gustTarget = .3 + .7 * this.windRandom();
      this.gustCountdown = Math.floor(this.sampleRate * (1.5 + this.windRandom() * 4));
    }
    this.gust += (this.gustTarget - this.gust) / this.sampleRate;
    const wl = this.windRandom() * 2 - 1, wr = this.windRandom() * 2 - 1;
    this.windL += this.windPole * (wl - this.windL);
    this.windR += this.windPole * (wr - this.windR);
    this.airL += this.airPole * (wl - this.airL); this.airR += this.airPole * (wr - this.airR);
    this.windDcL += this.dcPole * (this.windL - this.windDcL);
    this.windDcR += this.dcPole * (this.windR - this.windDcR);
    const wg = this.wind * this.gust * this.noiseScale;
    left += wg * (1.05 * (this.windL - this.windDcL) + .10 * this.gust * (this.airL - this.windL));
    right += wg * (1.05 * (this.windR - this.windDcR) + .10 * this.gust * (this.airR - this.windR));
    // A softened initial crack followed by seven delayed, overlapping rolls.
    // Independent RNG and clock: rain/wind controls never schedule thunder.
    if (this.rollAge >= this.rollLength && --this.thunderCountdown <= 0) {
      this.rollAge = 0; this.rollLength = Math.floor(this.sampleRate * 8);
      this.thunderCountdown = Math.floor(this.sampleRate * (6 + 9 * this.thunderRandom()));
      for (let k = 0; k < 7; k++) {
        this.rollDelay[k] = k === 0 ? 0 : k * .65 + this.thunderRandom() * .4;
        this.rollDuration[k] = 1.4 + this.thunderRandom() * 1.8;
        this.rollGain[k] = (1 - k * .10) * (.65 + .35 * this.thunderRandom());
      }
    }
    const tn = this.thunderRandom() * 2 - 1, tr = .8 * tn + .2 * (this.thunderRandom() * 2 - 1);
    this.rumbleL += this.thunderPole * (tn - this.rumbleL);
    this.rumbleR += this.thunderPole * (tr - this.rumbleR);
    this.crackL += this.rainPole * (tn - this.crackL); this.crackR += this.rainPole * (tr - this.crackR);
    this.rumbleDcL += this.dcPole * (this.rumbleL - this.rumbleDcL);
    this.rumbleDcR += this.dcPole * (this.rumbleR - this.rumbleDcR);
    if (this.rollAge < this.rollLength) {
      const age = this.rollAge++ / this.sampleRate;
      let envelope = 0;
      for (let k = 0; k < 7; k++) {
        const x = (age - this.rollDelay[k]) / this.rollDuration[k];
        if (x > 0 && x < 1) envelope += this.rollGain[k] * 16 * x * (1 - x) * (1 - x) * (1 - x);
      }
      const x = age / .32;
      const crack = x < 1 ? 16 * x * (1 - x) * (1 - x) * (1 - x) : 0;
      const tg = this.thunder * this.noiseScale;
      left += tg * (1.8 * envelope * (this.rumbleL - this.rumbleDcL) + .19 * crack * (this.crackL - this.rumbleL));
      right += tg * (1.8 * envelope * (this.rumbleR - this.rumbleDcR) + .19 * crack * (this.crackR - this.rumbleR));
    }
    this.outputL = left === 0 ? 0 : .45 * Math.tanh(left / .45); this.outputR = right === 0 ? 0 : .45 * Math.tanh(right / .45);
  }
  render(left, right) { this.process(left, right, false); }
  mix(left, right) { this.process(left, right, true); }
  process(left, right, add) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length || left === right)
      throw new TypeError('distinct equal-length Float32Array stereo channels required');
    for (let i = 0; i < left.length; i++) { this.next(); if (add) { left[i] += this.outputL; right[i] += this.outputR; } else { left[i] = this.outputL; right[i] = this.outputR; } }
  }
}
