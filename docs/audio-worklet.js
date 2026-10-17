// SPDX-License-Identifier: AGPL-3.0-only
import {NoteHistory} from './note-history.js';
import {AmbientEngine} from './audio-engine.js';

class Sou1AmbientProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.engine = new AmbientEngine(sampleRate, options?.processorOptions?.seed ?? 1);
    this.history = new NoteHistory();
    const noteOn = this.engine.noteOn.bind(this.engine);
    this.engine.noteOn = (...event) => { this.history.add(...event); noteOn(...event); };
    const applySeed = this.engine.applySeed.bind(this.engine);
    this.engine.applySeed = () => { this.history.clear(); applySeed(); };
    this.silenceReported = true;
    this.port.onmessage = ({data}) => {
      if (!data || typeof data !== 'object') return;
      switch (data.type) {
        case 'score': this.port.postMessage({type:'score',score:{...this.history.snapshot(this.engine.frame,sampleRate),seed:this.engine.seed}}); break;
        case 'start': this.engine.start(); this.silenceReported = false; break;
        case 'reseed': this.engine.reseed(data.seed); break;
        case 'stop': this.engine.stop(); this.silenceReported = false; this.port.postMessage({type:'score',score:{...this.history.snapshot(this.engine.frame,sampleRate),seed:this.engine.seed}}); break;
        case 'score-export': this.port.postMessage({type:'score-export',requestId:data.requestId,score:{...this.history.snapshot(this.engine.frame,sampleRate),seed:this.engine.seed}}); break;
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
      this.port.postMessage({type:'score',score:{...this.history.snapshot(this.engine.frame,sampleRate),seed:this.engine.seed}});
      this.port.postMessage({type: 'silent'});
      this.silenceReported = true;
    }
    return true;
  }
}
registerProcessor('sou1-ambient', Sou1AmbientProcessor);
