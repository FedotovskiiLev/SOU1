// SPDX-License-Identifier: AGPL-3.0-only
// Replace only the score producer. Shared synthesis, recorded percussion,
// macros, weather, note history and click-free seed transitions retain their paths.
import {AmbientEngine} from './audio-engine.js';
import {RecordedDrumEngine} from './recorded-drum-engine.js';
import {DevelopmentScore} from './development-score.js';
class DevelopingProceduralEngine extends AmbientEngine {
 constructor(rate,seed,config){super(rate,seed);this.score=new DevelopmentScore(rate,this.seed,config);}
 applySeed(){const score=this.score;super.applySeed();score.reseed(this.seed);this.score=score;}
}
class DevelopingRecordedEngine extends RecordedDrumEngine {
 constructor(rate,seed,bank,config){super(rate,seed,bank);this.score=new DevelopmentScore(rate,this.seed,config);}
 applySeed(){const score=this.score;super.applySeed();score.reseed(this.seed);this.score=score;}
}
export function createDevelopingEngine(rate,seed,bank,config){
 return bank===undefined||bank===null?new DevelopingProceduralEngine(rate,seed,config):new DevelopingRecordedEngine(rate,seed,bank,config);
}
