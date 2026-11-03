// SPDX-License-Identifier: AGPL-3.0-only
import {PlaybackController} from './controller.mjs';
const $=id=>document.getElementById(id),states={idle:'Ready to prepare. Nothing will play automatically.',preparing:'Preparing locally. You can cancel at any time.',ready:'Sound is ready. Press Play to listen.',resuming:'Waiting for the browser to enable audio…',playing:'Playing. Switching tabs will stop playback.',error:'Preparation failed.',disposed:'Audio closed.'};
let uiGeneration=0,controller;
function createController(){const generation=++uiGeneration;const c=new PlaybackController({makeWorker:()=>new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'}),makeContext:()=>new AudioContext(),onChange:s=>{
 if(generation!==uiGeneration)return;
 if(s.progress!==undefined){$('progress').value=s.progress;return;}
 $('status').textContent=s.error||states[s.state];$('play').disabled=!['ready'].includes(s.state);$('stop').disabled=!['preparing','playing','resuming'].includes(s.state);$('prepare').textContent=s.state==='preparing'?'Restart preparation':'Prepare sound';
 if(s.state==='preparing'){$('progress').value=0;$('diagnostics').textContent='Preparing…';}
 if(s.report){$('progress').value=1;$('diagnostics').textContent=JSON.stringify(s.report,null,2);}
}});c.setVolume(Number($('volume').value)/100);c.emit();return c;}
controller=createController();
$('settings').addEventListener('submit',e=>{e.preventDefault();if(!e.target.reportValidity())return;if(!window.isSecureContext||!crypto.subtle){$('status').textContent='Open this prototype on localhost or HTTPS, not as a file.';return;}controller.prepare({profile:$('profile').value,seed:Number($('seed').value),duration:Number($('duration').value),sampleRate:48000,outputGainDb:12});});
$('play').addEventListener('click',()=>{void controller.play();});$('stop').addEventListener('click',()=>controller.cancel());$('volume').addEventListener('input',()=>{const v=Number($('volume').value);$('volume-value').textContent=v+'%';controller.setVolume(v/100);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.stop();});window.addEventListener('pagehide',()=>{void controller.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted){controller=createController();$('progress').value=0;$('diagnostics').textContent='No render yet.';}});
