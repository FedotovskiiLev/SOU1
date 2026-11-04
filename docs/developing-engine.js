// SPDX-License-Identifier: AGPL-3.0-only
// Replace only the score producer. Shared synthesis, recorded percussion,
// macros, weather, note history and click-free seed transitions retain their paths.
import {AmbientEngine} from './audio-engine.js';
import {RecordedDrumEngine} from './recorded-drum-engine.js';
import {DevelopmentScore} from './development-score.js';
class DevelopingProceduralEngine extends AmbientEngine {
 constructor(rate,seed){super(rate,seed);this.score=new DevelopmentScore(rate,this.seed);}
 applySeed(){super.applySeed();this.score=new DevelopmentScore(this.sampleRate,this.seed);}
}
class DevelopingRecordedEngine extends RecordedDrumEngine {
 constructor(rate,seed,bank){super(rate,seed,bank);this.score=new DevelopmentScore(rate,this.seed);}
 applySeed(){super.applySeed();this.score=new DevelopmentScore(this.sampleRate,this.seed);}
}
export function createDevelopingEngine(rate,seed,bank){
 return bank===undefined||bank===null?new DevelopingProceduralEngine(rate,seed):new DevelopingRecordedEngine(rate,seed,bank);
}
