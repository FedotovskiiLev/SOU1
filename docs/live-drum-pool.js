// SPDX-License-Identifier: AGPL-3.0-only
// Recorded-drums-only render seam. Decode, resample and pitch materialization
// happen BEFORE construction. No sample selection arrays or voice objects are
// allocated by trigger(), next(), setEnabled(), stop(), release() or reset().
const IDS = Object.freeze(['kick', 'snare', 'closed-hat', 'toms', 'short-clash']);
const MAX_BYTES = 16 * 1024 * 1024;
const NO_GROUP = 65535;
const typedArrayLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Float32Array.prototype), 'length').get;
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const gain = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Compile every possible key/velocity match set once, including exact inclusive
 * velocity boundaries. Each distinct set has its own round-robin cursor. Thus
 * hard hits cannot consume soft-hit alternates, and unmapped hits cannot advance
 * any cursor. Metadata is bounded by 128 keys and <=130 velocity boundaries.
 */
function compileInstrument(definition, sampleCount) {
  if (!definition || typeof definition !== 'object' || !IDS.includes(definition.id) ||
      !unit(definition.gain) || definition.oneShot !== true ||
      !(definition.chokeGroup === null || (typeof definition.chokeGroup === 'string' &&
        definition.chokeGroup.length > 0 && definition.chokeGroup.length <= 32)) ||
      !Array.isArray(definition.zones) || !integer(definition.zones.length, 1, 64)) {
    throw new TypeError('Invalid live drum instrument');
  }
  const zones = [], edges = new Set([0, 1]);
  for (const z of definition.zones) {
    if (!z || !integer(z.keyLow, 0, 127) || !integer(z.keyHigh, z.keyLow, 127) ||
        !unit(z.velocityLow) || !unit(z.velocityHigh) || z.velocityLow > z.velocityHigh ||
        !integer(z.sampleIndex, 0, sampleCount - 1)) throw new TypeError('Invalid live drum zone');
    const copy = Object.freeze({keyLow: z.keyLow, keyHigh: z.keyHigh,
      velocityLow: z.velocityLow, velocityHigh: z.velocityHigh, sampleIndex: z.sampleIndex});
    zones.push(copy);
    edges.add(copy.velocityLow); edges.add(copy.velocityHigh);
  }
  const boundaries = Float64Array.from([...edges].sort((a, b) => a - b));
  const bands = boundaries.length * 2 - 1;
  const lookup = new Uint16Array(128 * bands).fill(NO_GROUP);
  const groups = [], groupIds = new Map();
  for (let pitch = 0; pitch < 128; pitch++) {
    for (let band = 0; band < bands; band++) {
      const edge = band >> 1;
      // Open bands are checked by endpoints, not a rounded midpoint: adjacent
      // representable velocity values must not manufacture an inclusive match.
      const low = boundaries[edge], high = boundaries[edge + (band & 1)];
      const matches = [];
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if (pitch >= z.keyLow && pitch <= z.keyHigh &&
            ((band & 1) ? z.velocityLow < high && z.velocityHigh > low :
              z.velocityLow <= low && z.velocityHigh >= low)) matches.push(i);
      }
      if (!matches.length) continue;
      const key = matches.join(',');
      let id = groupIds.get(key);
      if (id === undefined) {
        id = groups.length;
        groupIds.set(key, id);
        groups.push({zones: Uint8Array.from(matches), cursor: 0});
      }
      lookup[pitch * bands + band] = id;
    }
  }
  return Object.freeze({gain: definition.gain, chokeGroup: definition.chokeGroup,
    zones: Object.freeze(zones), boundaries, bands, lookup, groups: Object.freeze(groups)});
}

/** Bounded mono sample voices mixed into stereo, before the engine's shared
 * effects and output limiter. Prepared PCM may overshoot unity after sinc
 * reconstruction, but must be finite and |PCM|<=2. No normalization/clipping is
 * performed here. Private owned sample copies are never exposed to callers.
 *
 * Layers 5..9 always route to kick/snare/closed-hat/toms/short-clash, regardless
 * of the supplied instrument array order. A full pool drops the NEW hit; it does
 * not steal a tail or choke an old hit for a rejected event.
 */
export class LiveDrumPool {
  #sampleRate;
  #polyphony;
  #samples;
  #instruments;
  #voices;
  #active = 0;
  #enabled = true;
  #attackFrames;
  #endFrames;
  #releaseFrames;
  #chokeFrames;

  constructor(sampleRate, wireBank, {polyphony = 16} = {}) {
    if (!integer(sampleRate, 8000, 192000) || !integer(polyphony, 1, 16)) {
      throw new RangeError('Live drum rate/polyphony limits');
    }
    if (!wireBank || wireBank.sampleRate !== sampleRate || !Array.isArray(wireBank.samples) ||
        !integer(wireBank.samples.length, 1, 32) || !Array.isArray(wireBank.instruments) ||
        wireBank.instruments.length !== IDS.length) throw new TypeError('Invalid live drum bank');
    let decodedBytes = 0;
    const sampleFrames = new Uint32Array(wireBank.samples.length);
    // Check all lengths and the aggregate budget before allocating any copies.
    for (let i = 0; i < wireBank.samples.length; i++) {
      const pcm = wireBank.samples[i];
      const frames = pcm instanceof Float32Array ? typedArrayLength.call(pcm) : 0;
      if (!integer(frames, 2, sampleRate * 10)) {
        throw new TypeError('Invalid live drum PCM frames/type');
      }
      sampleFrames[i] = frames;
      decodedBytes += frames * Float32Array.BYTES_PER_ELEMENT;
      if (decodedBytes > MAX_BYTES) throw new RangeError('Live drum decoded budget exceeded');
    }
    const samples = [];
    for (let i = 0; i < wireBank.samples.length; i++) {
      const pcm = wireBank.samples[i];
      // Allocate only the checked frame count. Typed-array set also rejects a
      // resized/source view whose actual length exceeds that bounded target.
      const copy = new Float32Array(sampleFrames[i]);
      copy.set(pcm);
      for (let i = 0; i < copy.length; i++) {
        if (!Number.isFinite(copy[i]) || Math.abs(copy[i]) > 2) throw new TypeError('Invalid live drum PCM range');
      }
      samples.push(copy);
    }
    const instruments = new Array(IDS.length);
    for (const definition of wireBank.instruments) {
      const instrument = compileInstrument(definition, samples.length);
      const index = IDS.indexOf(definition.id);
      if (instruments[index]) throw new TypeError('Duplicate live drum instrument');
      instruments[index] = instrument;
    }
    this.#sampleRate = sampleRate;
    this.#polyphony = polyphony;
    this.#samples = Object.freeze(samples);
    this.#instruments = Object.freeze(instruments);
    this.#voices = new Array(polyphony);
    for (let i = 0; i < polyphony; i++) {
      this.#voices[i] = {active: false, sample: null, instrument: null, layer: 0,
        age: 0, level: 0, panL: 0, panR: 0, releaseLeft: 0, releaseLevel: 1, releaseStep: 0};
    }
    this.#attackFrames = Math.max(1, Math.round(sampleRate * .001));
    this.#endFrames = Math.max(1, Math.round(sampleRate * .002));
    this.#releaseFrames = Math.max(2, Math.round(sampleRate * .05));
    this.#chokeFrames = Math.max(2, Math.round(sampleRate * .005));
    this.outputL = 0; this.outputR = 0;
    this.stats = Object.seal({accepted: 0, dropped: 0, unmapped: 0, choked: 0});
  }

  get sampleRate() { return this.#sampleRate; }
  get polyphony() { return this.#polyphony; }
  get activeVoices() { return this.#active; }
  get enabled() { return this.#enabled; }

  /** Apply before score dispatch when changing controls. Disabled events are
   * dropped immediately, never queued. Re-enable never cancels a release. */
  setEnabled(enabled) {
    const next = enabled === true;
    if (this.#enabled && !next) this.stop();
    this.#enabled = next;
  }

  /** Returns whether the hit was accepted. Invalid events and disabled/full
   * pool hits increment dropped; valid keys with no matching zone increment
   * unmapped. Zero velocity is valid and follows normal selection/voice bounds. */
  trigger(layer, pitch, velocity, pan) {
    if (!integer(layer, 5, 9) || !integer(pitch, 0, 127) || !unit(velocity) || !unit(pan) || !this.#enabled) {
      this.stats.dropped++; return false;
    }
    const instrument = this.#instruments[layer - 5], boundaries = instrument.boundaries;
    let low = 0, high = boundaries.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (boundaries[mid] < velocity) low = mid + 1; else high = mid;
    }
    const band = boundaries[low] === velocity ? low * 2 : low * 2 - 1;
    const groupId = instrument.lookup[pitch * instrument.bands + band];
    if (groupId === NO_GROUP) { this.stats.unmapped++; return false; }
    let voice = null;
    for (let i = 0; i < this.#polyphony; i++) {
      if (!this.#voices[i].active) { voice = this.#voices[i]; break; }
    }
    if (voice === null) { this.stats.dropped++; return false; }
    if (instrument.chokeGroup !== null) {
      for (let i = 0; i < this.#polyphony; i++) {
        const current = this.#voices[i];
        if (current.active && current.instrument.chokeGroup === instrument.chokeGroup &&
            this.#fade(current, this.#chokeFrames)) this.stats.choked++;
      }
    }
    const group = instrument.groups[groupId];
    const zone = instrument.zones[group.zones[group.cursor]];
    group.cursor = (group.cursor + 1) % group.zones.length;
    voice.active = true;
    voice.sample = this.#samples[zone.sampleIndex];
    voice.instrument = instrument;
    voice.layer = layer - 5;
    voice.age = 0;
    voice.level = velocity * instrument.gain;
    voice.panL = Math.sqrt(1 - pan); voice.panR = Math.sqrt(pan);
    voice.releaseLeft = 0; voice.releaseLevel = 1; voice.releaseStep = 0;
    this.#active++; this.stats.accepted++;
    return true;
  }

  #fade(voice, frames) {
    // Repeated stop/mute/choke must never extend a release or raise its level.
    if (voice.releaseLeft > 0 && voice.releaseLeft <= frames) return false;
    voice.releaseLeft = frames;
    voice.releaseStep = voice.releaseLevel / (frames - 1);
    return true;
  }

  stop() {
    for (let i = 0; i < this.#polyphony; i++) {
      const voice = this.#voices[i];
      if (voice.active) this.#fade(voice, this.#releaseFrames);
    }
  }

  release() { this.stop(); }

  /** Advance one frame. Current layer gains apply to existing tails too; the
   * caller owns gain smoothing. Bad gains are safely silent. The output is a
   * finite unbounded mix (up to 32 at 16 voices), not independently limited. */
  next(gains, enabled) {
    this.setEnabled(enabled);
    const validGains = gains instanceof Float64Array && gains.length === 5;
    let left = 0, right = 0;
    for (let i = 0; i < this.#polyphony; i++) {
      const voice = this.#voices[i];
      if (!voice.active) continue;
      let env = Math.min(1, voice.age / this.#attackFrames) *
        Math.min(1, (voice.sample.length - voice.age - 1) / this.#endFrames);
      if (voice.releaseLeft > 0) env *= voice.releaseLeft === 1 ? 0 : voice.releaseLevel;
      const value = voice.sample[voice.age] * voice.level * env *
        (validGains ? gain(gains[voice.layer]) : 0);
      left += value * voice.panL; right += value * voice.panR;
      voice.age++;
      if (voice.releaseLeft > 0) {
        voice.releaseLeft--;
        voice.releaseLevel = Math.max(0, voice.releaseLevel - voice.releaseStep);
        if (voice.releaseLeft === 0) { voice.active = false; this.#active--; }
      }
      if (voice.active && voice.age >= voice.sample.length) { voice.active = false; this.#active--; }
    }
    this.outputL = left; this.outputR = right;
  }

  /** Transport reset, without changing the current enable target. */
  reset() {
    for (let i = 0; i < this.#polyphony; i++) {
      const voice = this.#voices[i];
      voice.active = false; voice.sample = null; voice.instrument = null;
      voice.age = 0; voice.level = 0; voice.panL = 0; voice.panR = 0;
      voice.releaseLeft = 0; voice.releaseLevel = 1; voice.releaseStep = 0;
    }
    for (let i = 0; i < this.#instruments.length; i++) {
      const groups = this.#instruments[i].groups;
      for (let j = 0; j < groups.length; j++) groups[j].cursor = 0;
    }
    this.#active = 0; this.outputL = 0; this.outputR = 0;
    this.stats.accepted = 0; this.stats.dropped = 0;
    this.stats.unmapped = 0; this.stats.choked = 0;
  }
}
