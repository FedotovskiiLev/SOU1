// SPDX-License-Identifier: AGPL-3.0-only
import {PlaybackController} from './controller.mjs';
const $=id=>document.getElementById(id),states={idle:'Ready to prepare. Nothing will play automatically.',preparing:'Preparing locally. You can cancel at any time.',ready:'Sound is ready. Press Play to listen.',resuming:'Waiting for the browser to enable audio…',playing:'Playing. Switching tabs will stop playback.',error:'Preparation failed.',disposed:'Audio closed.'};
let uiGeneration=0,controller;
function createController(){const generation=++uiGeneration;const c=new PlaybackController({makeWorker:()=>new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'}),makeContext:()=>new AudioContext(),onChange:s=>{
 if(generation!==uiGeneration)return;
 if(s.progress!==undefined){$('progress').value=s.progress;return;}
 $('status').textContent=s.error||states[s.state];$('midi').disabled=!s.report?.midi;$('play').disabled=!['ready'].includes(s.state);$('stop').disabled=!['preparing','playing','resuming'].includes(s.state);$('prepare').textContent=s.state==='preparing'?'Restart preparation':'Prepare sound';
 if(s.state==='preparing'){$('progress').value=0;$('diagnostics').textContent='Preparing…';}
 if(s.report){$('progress').value=1;$('diagnostics').textContent=JSON.stringify(s.report,null,2);}
}});c.setVolume(Number($('volume').value)/100);c.emit();return c;}
controller=createController();
function syncComposerControls(){const expressive=$('composer').value==='expressive';$('legacy-controls').hidden=expressive;$('expressive-controls').hidden=!expressive;for(const id of ['profile','duration'])$(id).disabled=expressive;for(const id of ['style','phrasing','bars','bpm','drum-velocity','drums-enabled'])$(id).disabled=!expressive;}
$('composer').addEventListener('change',syncComposerControls);syncComposerControls();
$('settings').addEventListener('submit',e=>{
 e.preventDefault();if(!e.target.reportValidity())return;
 if(!window.isSecureContext||!crypto.subtle){$('status').textContent='Open this prototype on localhost or HTTPS, not as a file.';return;}
 const composer=$('composer').value||'legacy',drumKit=$('drum-kit').value||'vcsl',seed=Number($('seed').value),outputGainDb=Number($('render-gain').value);
 const options=composer==='expressive'?{composer,drumKit,score:{style:$('style').value,seed,bars:Number($('bars').value),bpm:Number($('bpm').value),sampleRate:48000,drums:$('drums-enabled').checked,outputGainDb},phrasing:$('phrasing').value,drumVelocityScale:Number($('drum-velocity').value)}:{composer,drumKit,profile:$('profile').value,seed,duration:Number($('duration').value),sampleRate:48000,outputGainDb};
 controller.prepare(options);
});
$('midi').addEventListener('click',()=>{
 const pcm=controller.pcm;if(!pcm?.midiBytes)return;
 const url=URL.createObjectURL(new Blob([pcm.midiBytes],{type:'audio/midi'})),link=document.createElement('a');
 link.href=url;link.download='sou1-'+pcm.report.options.style+'-'+pcm.report.options.seed+'.mid';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
});
$('play').addEventListener('click',()=>{void controller.play();});$('stop').addEventListener('click',()=>controller.cancel());$('volume').addEventListener('input',()=>{const v=Number($('volume').value);$('volume-value').textContent=v+'%';controller.setVolume(v/100);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.stop();});window.addEventListener('pagehide',()=>{void controller.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted){controller=createController();$('progress').value=0;$('diagnostics').textContent='No render yet.';}});
