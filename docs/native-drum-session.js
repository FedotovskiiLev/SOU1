// SPDX-License-Identifier: AGPL-3.0-only
// UI-side acknowledgement/cancellation contract, not an Android audio renderer.
export function nativeDrumCapabilities(bridge,allowed){
 try{const c=JSON.parse(bridge.audioCapabilities());return c?.schema==='sou1.native-audio.v1'&&Array.isArray(c.drumKits)&&c.drumKits.length===allowed.length&&new Set(c.drumKits).size===allowed.length&&allowed.every(k=>c.drumKits.includes(k));}catch{return false;}
}
export function nativeDevelopmentCapabilities(bridge){
 try{const c=JSON.parse(bridge.audioCapabilities());return c?.schema==='sou1.native-audio.v1'&&Array.isArray(c.scoreModes)&&c.scoreModes.length===2&&c.scoreModes.includes('original')&&c.scoreModes.includes('developing');}catch{return false;}
}
const validScoreMode=value=>value===undefined||value==='original'||value==='developing';
export class NativeDrumSession {
 constructor(bridge,kits,{now=Date.now,timeoutMs=30000}={}){
  if(!bridge||!Array.isArray(kits)||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Native session configuration');
  this.bridge=bridge;this.kits=new Set(kits);this.now=now;this.timeoutMs=timeoutMs;
  this.phase='idle';this.owned=false;this.requestId=null;this.retiredThrough=-1;this.deadline=0;this.lastId=0;this.error='';this.data=null;this.stopFailed=false;this.hasPlayed=false;
 }
 read(){const value=JSON.parse(this.bridge.status());if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid native playback status');return value;}
 start(payload){
  if(this.requestId!==null||this.phase==='preparing'||this.phase==='playing')return false;
  if(!payload||!this.kits.has(payload.drumKit))throw Error('Unknown native drum bank');
  if(!validScoreMode(payload.scoreMode))throw Error('Unknown native score mode');
  const id=Math.max(this.lastId+1,Math.floor(this.now())*1024);
  if(!Number.isSafeInteger(id)||id<0)throw Error('Native request clock');
  this.lastId=id;this.owned=true;this.requestId=id;this.expectedKit=payload.drumKit;this.expectedScoreMode=payload.scoreMode??'original';this.deadline=this.now()+this.timeoutMs;this.phase='preparing';this.error='';this.data=null;this.stopFailed=false;this.hasPlayed=false;
  try{if(!this.bridge.play(JSON.stringify({...payload,requestId:id})))throw Error('Native playback request rejected');}
  catch(error){this.retire();this.requestId=null;this.phase='error';this.error=error.message;throw error;}
  return true;
 }
 retire(){if(this.requestId!==null)this.retiredThrough=Math.max(this.retiredThrough,this.requestId);}
 cancel(){
  try{this.bridge.stop();}catch(error){
   this.uncertainPhase=this.stopFailed?this.uncertainPhase:this.phase;this.stopFailed=true;this.phase='error';this.error='Native stop request failed';throw error;
  }
  this.retire();this.requestId=null;this.phase='idle';this.error='';this.data=null;this.stopFailed=false;
 }
 failTimeout(){
  try{this.cancel();this.phase='error';this.error='Native audio preparation timed out';}
  catch{this.error='Native audio preparation timed out; stop request failed';}
  return this;
 }
 poll(){
  if(this.requestId===null)return this;
  let value;try{value=this.read();}catch{}
  if(value?.requestId===this.requestId&&validScoreMode(value.scoreMode)&&this.kits.has(value.drumKit)&&typeof value.preparing==='boolean'&&typeof value.playing==='boolean'&&!(value.preparing&&value.playing)){
   if(this.hasPlayed&&value.preparing)return this;
   if(this.stopFailed){this.data=value;if(value.preparing||value.playing){this.uncertainPhase=value.playing?'playing':'preparing';return this;}this.stopFailed=false;this.retire();this.requestId=null;this.phase='idle';this.error='';return this;}
   if(value.drumKit!==this.expectedKit||(value.scoreMode??'original')!==this.expectedScoreMode){
    this.data=value;this.phase=value.playing?'playing':'preparing';
    try{this.cancel();}catch{}this.phase='error';this.error=this.stopFailed?'Native audio selection mismatch; stop request failed':'Native audio selection mismatch';return this;
   }
   this.data=value;
   if(value.playing){this.phase='playing';this.hasPlayed=true;this.error='';return this;}
   if(!value.preparing){
    const wasPreparing=this.phase==='preparing';this.retire();this.requestId=null;
    this.error=typeof value.audioError==='string'?value.audioError.slice(0,500):'';
    if(wasPreparing&&!this.error)this.error='Native playback did not start';
    this.phase=this.error?'error':'idle';return this;
   }
  }
  // Read acknowledgement first: a suspended WebView must not time out and
  // stop playback that successfully began while its JS was not running.
  if(this.phase==='preparing'&&this.now()>=this.deadline)return this.failTimeout();
  return this;
 }
 restore(){
  if(this.requestId!==null)return this.poll();
  let value;try{value=this.read();}catch{return this;}
  if(!validScoreMode(value.scoreMode)||!Number.isSafeInteger(value.requestId)||value.requestId<0||!this.kits.has(value.drumKit)||typeof value.preparing!=='boolean'||typeof value.playing!=='boolean'||(value.preparing&&value.playing))return this;
  if(value.requestId<=this.retiredThrough)return this;
  this.data=value;this.error='';
  if(value.preparing||value.playing){this.owned=false;this.requestId=value.requestId;this.expectedKit=value.drumKit;this.expectedScoreMode=value.scoreMode??'original';this.lastId=Math.max(this.lastId,value.requestId);this.deadline=this.now()+this.timeoutMs;this.phase=value.preparing?'preparing':'playing';this.hasPlayed=value.playing;}
  else this.phase='idle';
  return this;
 }
}
