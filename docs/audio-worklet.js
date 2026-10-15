// SPDX-License-Identifier: AGPL-3.0-only
import {AmbientEngine} from './audio-engine.js';

class Sou1AmbientProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.engine = new AmbientEngine(sampleRate, options?.processorOptions?.seed ?? 1);
    this.silenceReported = true;
    this.port.onmessage = ({data}) => {
      if (!data || typeof data !== 'object') return;
      switch (data.type) {
        case 'start': this.engine.start(); this.silenceReported = false; break;
        case 'reseed': this.engine.reseed(data.seed); break;
        case 'stop': this.engine.stop(); this.silenceReported = false; break;
        case 'parameters':
          if (data.parameters && typeof data.parameters === 'object') this.engine.setParameters(data.parameters);
          break;
      }
    };
  }
  process(inputs, outputs) {
    const channels = outputs[0];
    if (channels && channels.length >= 2) this.engine.render(channels[0], channels[1]);
    if (this.engine.isSilent() && !this.silenceReported) {
      this.port.postMessage({type: 'silent'});
      this.silenceReported = true;
    }
    return true;
  }
}
registerProcessor('sou1-ambient', Sou1AmbientProcessor);
