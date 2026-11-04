// SPDX-License-Identifier: AGPL-3.0-only
// Cancellation terminates dedicated work, not merely a promise. Caller remains
// responsible for current-request checks before activating a returned bank.
export function loadRecordedMelodies(preset,sampleRate,{signal,makeWorker=()=>new Worker(new URL('./melodic-loader-worker.js',import.meta.url),{type:'module'})}={}){
 return new Promise((resolve,reject)=>{
  let worker,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(value);};
  const abort=()=>finish(new DOMException('Melodic preparation cancelled','AbortError'));
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  try{worker=makeWorker();if(settled){worker.terminate();return;}worker.onmessage=({data})=>{if(data?.type==='ready')finish(null,data);else if(data?.type==='error')finish(new Error(data.message||'Melodic preparation failed'));else finish(new Error('Invalid melodic worker response'));};worker.onerror=e=>finish(new Error(e.message||'Melodic worker failed'));worker.postMessage({preset,sampleRate});}
  catch(e){finish(e);}
 });
}
