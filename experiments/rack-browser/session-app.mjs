// SPDX-License-Identifier: AGPL-3.0-only
import {SessionController} from './session-controller.mjs';
const $=id=>document.getElementById(id),states={idle:'Prepare two phrases, then press Start. Nothing plays automatically.',preparing:'Preparing two phrases. You can cancel.',ready:'Two phrases are ready. Press Start.',resuming:'Waiting for audio permission…',playing:'Playing and preparing the next phrase. Switching tabs will stop.',error:'Session stopped.',disposed:'Audio closed.'};
let controller,generation=0;
function makeController(){
 const local=++generation;
 const c=new SessionController({makeWorker:()=>new Worker(new URL('./session-worker.mjs',import.meta.url),{type:'module'}),makeContext:()=>new AudioContext(),onChange:s=>{
  if(local!==generation)return;
  $('status').textContent=s.error||states[s.state];$('play').disabled=s.state!=='ready';$('stop').disabled=!['preparing','ready','resuming','playing'].includes(s.state);$('midi').disabled=!s.phrase;
  if(s.state==='preparing')$('diagnostics').textContent='Preparing…';
  if(s.phrase)$('diagnostics').textContent=JSON.stringify({phrase:s.phrase,report:s.report,queued:s.queued,midiScope:'This phrase only; not the entire session.'},null,2);
 }});c.setVolume(Number($('volume').value)/100);c.emit();return c;
}
controller=makeController();
$('settings').addEventListener('submit',e=>{
 e.preventDefault();if(!e.target.reportValidity())return;
 if(!window.isSecureContext||!crypto.subtle){$('status').textContent='Open on localhost or HTTPS, not as a file.';return;}
 controller.prepare({composer:'expressive',drumKit:$('drum-kit').value,score:{style:$('style').value,bars:Number($('bars').value),bpm:Number($('bpm').value),seed:Number($('seed').value),sampleRate:48000,drums:$('drums-enabled').checked,outputGainDb:Number($('render-gain').value)},phrasing:$('phrasing').value,drumVelocityScale:Number($('drum-velocity').value)});
});
$('play').addEventListener('click',()=>{void controller.play();});$('stop').addEventListener('click',()=>controller.stop());
$('volume').addEventListener('input',()=>{const v=Number($('volume').value);$('volume-value').textContent=v+'%';controller.setVolume(v/100);});
$('midi').addEventListener('click',()=>{
 const p=controller.latest;if(!p?.midiBytes)return;
 const url=URL.createObjectURL(new Blob([p.midiBytes],{type:'audio/midi'})),link=document.createElement('a');
 link.href=url;link.download='sou1-phrase-'+p.phrase.index+'-seed-'+p.phrase.seed+'.mid';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.stop();});
window.addEventListener('pagehide',()=>{void controller.dispose();});window.addEventListener('pageshow',e=>{if(e.persisted){controller=makeController();$('diagnostics').textContent='No render yet.';}});
