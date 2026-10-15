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
    // Rain changes spectral weight and density, crossfading instead of switching.
    const rl = this.rainRandom() * 2 - 1, rr = this.rainRandom() * 2 - 1;
    this.rainL += this.rainPole * (rl - this.rainL);
    this.rainR += this.rainPole * (rr - this.rainR);
    const bright = .055 * this.light + .085 * this.steady + .09 * this.heavy;
    const body = .025 * this.light + .07 * this.steady + .16 * this.heavy;
    let left = bright * (rl - this.rainL) + body * this.rainL;
    let right = bright * (rr - this.rainR) + body * this.rainR;
    if (--this.gustCountdown <= 0) {
      this.gustTarget = .25 + .75 * this.windRandom();
      this.gustCountdown = Math.floor(this.sampleRate * (1.5 + this.windRandom() * 4));
    }
    this.gust += (this.gustTarget - this.gust) / this.sampleRate;
    this.windL += this.windPole * (this.windRandom() * 2 - 1 - this.windL);
    this.windR += this.windPole * (this.windRandom() * 2 - 1 - this.windR);
    this.windDcL += this.dcPole * (this.windL - this.windDcL);
    this.windDcR += this.dcPole * (this.windR - this.windDcR);
    const wg = this.wind * this.gust * .38;
    left += wg * (this.windL - this.windDcL); right += wg * (this.windR - this.windDcR);
    // The independent clock runs even with rain off. Soft 3–7 second rolls,
    // separated by 6–15 seconds, never an impulsive lightning crack.
    if (this.rollAge >= this.rollLength && --this.thunderCountdown <= 0) {
      this.rollAge = 0; this.rollLength = Math.floor(this.sampleRate * (3 + 4 * this.thunderRandom()));
      this.thunderCountdown = Math.floor(this.sampleRate * (6 + 9 * this.thunderRandom()));
    }
    const tn = this.thunderRandom() * 2 - 1;
    this.rumbleL += this.thunderPole * (tn - this.rumbleL);
    this.rumbleR += this.thunderPole * (.8 * tn + .2 * (this.thunderRandom() * 2 - 1) - this.rumbleR);
    this.rumbleDcL += this.dcPole * (this.rumbleL - this.rumbleDcL);
    this.rumbleDcR += this.dcPole * (this.rumbleR - this.rumbleDcR);
    if (this.rollAge < this.rollLength) {
      const phase = this.rollAge++ / this.rollLength;
      const envelope = 16 * phase * phase * (1 - phase) * (1 - phase);
      const tg = this.thunder * envelope * .65;
      left += tg * (this.rumbleL - this.rumbleDcL); right += tg * (this.rumbleR - this.rumbleDcR);
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
