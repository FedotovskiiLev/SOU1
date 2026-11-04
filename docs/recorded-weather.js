// SPDX-License-Identifier: AGPL-3.0-only
// Prepared PCM only. No fetch, decoding, allocation or random global state while rendering.
const smooth=(v,t,c)=>Math.abs(v-t)<1e-7?t:v+c*(t-v);
export class RecordedWeather {
 constructor(rate,seed,bank){
  if(!bank||bank.schema!=='sou1.weather-prepared.v1'||bank.sampleRate!==rate||!Array.isArray(bank.samples)||bank.samples.length!==3||!bank.samples.every(s=>s instanceof Float32Array&&s.buffer instanceof ArrayBuffer&&s.length>=rate&&s.length<=rate*17))throw new TypeError('Prepared weather bank');
  this.sampleRate=rate;this.seed=seed>>>0;this.samples=bank.samples;this.parameters={rainType:0,rain:0,wind:0,thunder:0};this.smoothing=1-Math.exp(-1/(rate*.12));this.rainPole=1-Math.exp(-2*Math.PI*Math.min(3500,rate*.4)/rate);this.reset();
 }
 setParameters(p){this.parameters=p;}
 start(){this.playing=true;}
 stop(){this.playing=false;}
 isSilent(){return this.rain===0&&this.wind===0&&this.thunder===0;}
 random(){this.randomState=(Math.imul(this.randomState,1664525)+1013904223)>>>0;return this.randomState/4294967296;}
 reset(){this.playing=false;this.randomState=(this.seed^0x02e5be93)>>>0;this.rain=this.wind=this.thunder=0;this.rainAt=Math.floor(this.random()*this.samples[0].length);this.windAt=Math.floor(this.random()*this.samples[1].length);this.thunderAt=-1;this.countdown=Math.round(this.sampleRate*(6+6*this.random()));this.thunderEvents=0;this.rainL=this.rainR=0;this.outputL=this.outputR=0;}
 reseed(seed){this.seed=seed>>>0;this.reset();}
 next(){
  const p=this.parameters,c=this.smoothing,on=this.playing,type=p.rainType||1;
  this.rain=smooth(this.rain,on&&p.rainType>0?p.rain*(type===1?.18:type===2?.29:.40):0,c);this.wind=smooth(this.wind,on?p.wind:0,c);this.thunder=smooth(this.thunder,on?p.thunder:0,c);
  if(!on&&this.isSilent()){this.outputL=this.outputR=0;this.thunderAt=-1;return;}
  const r=this.samples[0],w=this.samples[1],t=this.samples[2];
  this.rainL+=this.rainPole*(r[this.rainAt]-this.rainL);this.rainR+=this.rainPole*(r[(this.rainAt+Math.round(this.sampleRate*.031))%r.length]-this.rainR);
  const rainGain=this.rain,windGain=this.wind*.35;
  let l=this.rainL*rainGain+w[this.windAt]*windGain,rr=this.rainR*rainGain+w[(this.windAt+Math.round(this.sampleRate*.047))%w.length]*windGain;
  this.rainAt=(this.rainAt+1)%r.length;this.windAt=(this.windAt+1)%w.length;
  if(on&&p.thunder>0&&this.thunderAt<0&&--this.countdown<=0){this.thunderAt=0;this.thunderEvents++;this.countdown=Math.round(this.sampleRate*(25+35*this.random())/(.35+.65*p.thunder));}
  if(this.thunderAt>=0){const x=t[this.thunderAt++]*this.thunder*.45;l+=x;rr+=x;if(this.thunderAt>=t.length)this.thunderAt=-1;}
  this.outputL=l;this.outputR=rr;
 }
}
